/**
 * LicenseService.ts — منقول حرفياً من الأندرويد (نفس الخوارزمية:
 * توقيع Ed25519، الزمن الموثوق، ضربات التلاعب، سماح 72/240 ساعة).
 * الفروق العتادية فقط: deviceId/uptime من نواة Rust، والزمن الأحادي
 * عبر GetTickCount64 (لا يتأثر بتغيير ساعة المستخدم).
 */
import nacl from 'tweetnacl';
import {api} from '../lib/tauri';
import {
  LICENSE_SERVER_URL,
  LICENSE_PUBLIC_KEY_HEX,
  LICENSE_GRACE_SOFT_HOURS,
  LICENSE_GRACE_HARD_HOURS,
  LICENSE_ROLLBACK_TOLERANCE_MS,
  APP_VERSION,
  APP_PLATFORM,
} from '../core/config';
import {logDiag} from '../state/storage';
import {
  getJson,
  setJson,
  getNumber,
  setNumber,
  getString,
  setString,
  storageDelete,
  KEYS,
} from '../state/storage';

export type LicensePlan = 'monthly' | 'yearly' | 'custom' | 'trial';

export interface LicensePayload {
  v: number;
  keyId: number;
  plan: LicensePlan;
  deviceId: string;
  activatedAt: number;
  expiresAt: number;
}

export interface LicenseContact {
  phone: string;
  whatsapp: string;
  telegram: string;
  email: string;
  note: string;
}

export type LicenseState = 'needs_activation' | 'active' | 'grace' | 'locked';

export interface LicenseStatus {
  state: LicenseState;
  license: LicensePayload | null;
  remainingMs: number;
  offlineHours: number;
  lockReason:
    | null
    | 'expired'
    | 'revoked'
    | 'offline_too_long'
    | 'tampered'
    | 'unknown_device';
  revoked: boolean;
}

interface Anchor {
  serverTimeMs: number;
  uptimeMs: number;
  wallMs: number;
}

const HOUR_MS = 3600 * 1000;

// ── base64 (متصفح ويندوز يوفر atob/btoa أصلاً — مع بديل داخلي) ──
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  return btoaPolyfill(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atobPolyfill(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function btoaPolyfill(input: string): string {
  if (typeof btoa === 'function') return btoa(input);
  let output = '';
  let i = 0;
  while (i < input.length) {
    const a = input.charCodeAt(i++);
    const b = i < input.length ? input.charCodeAt(i++) : NaN;
    const c = i < input.length ? input.charCodeAt(i++) : NaN;
    const triplet = (a << 16) | ((b || 0) << 8) | (c || 0);
    output +=
      B64_ALPHABET[(triplet >> 18) & 63] +
      B64_ALPHABET[(triplet >> 12) & 63] +
      (isNaN(b) ? '=' : B64_ALPHABET[(triplet >> 6) & 63]) +
      (isNaN(c) ? '=' : B64_ALPHABET[triplet & 63]);
  }
  return output;
}

function atobPolyfill(input: string): string {
  if (typeof atob === 'function') return atob(input);
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  let output = '';
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = B64_ALPHABET.indexOf(clean[i]);
    const e2 = B64_ALPHABET.indexOf(clean[i + 1]);
    const e3 = B64_ALPHABET.indexOf(clean[i + 2]);
    const e4 = B64_ALPHABET.indexOf(clean[i + 3]);
    const triplet = (e1 << 18) | (e2 << 12) | ((e3 & 63) << 6) | (e4 & 63);
    if (e1 >= 0 && e2 >= 0) {
      output += String.fromCharCode((triplet >> 16) & 255);
    }
    if (e3 >= 0) {
      output += String.fromCharCode((triplet >> 8) & 255);
    }
    if (e4 >= 0) {
      output += String.fromCharCode(triplet & 255);
    }
  }
  return output;
}

// ── Signature verification ───────────────────────────────────────
const PUBLIC_KEY_BYTES = ((): Uint8Array => {
  const hex = LICENSE_PUBLIC_KEY_HEX;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
})();

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Verifies the Ed25519 signature over the exact stored payload bytes. */
function verifyLicenseSignature(
  payloadB64: string,
  signatureB64: string,
): LicensePayload | null {
  try {
    const payloadBytes = base64ToBytes(payloadB64);
    const sigBytes = base64ToBytes(signatureB64);
    if (sigBytes.length !== 64) {
      return null;
    }
    const valid = nacl.sign.detached.verify(
      payloadBytes,
      sigBytes,
      PUBLIC_KEY_BYTES,
    );
    if (!valid) {
      return null;
    }
    const parsed = JSON.parse(utf8Decode(payloadBytes)) as LicensePayload;
    if (
      parsed == null ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.deviceId !== 'string' ||
      typeof parsed.keyId !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ── Networking ───────────────────────────────────────────────────
export class LicenseError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function apiPost<T>(
  path: string,
  body: unknown,
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getServerUrl()}${path}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as
      | (T & {ok?: boolean; error?: string})
      | null;
    if (!response.ok) {
      const code = data?.error ?? `HTTP_${response.status}`;
      throw new LicenseError(arabicError(code), code);
    }
    return data as T;
  } catch (error) {
    if (error instanceof LicenseError) {
      throw error;
    }
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new LicenseError(
      aborted
        ? 'تعذر الوصول إلى السيرفر — تحقق من الإنترنت وحاول مجدداً'
        : 'تعذر الاتصال بالسيرفر — تحقق من الإنترنت أو عنوان السيرفر',
      aborted ? 'TIMEOUT' : 'NETWORK',
    );
  } finally {
    clearTimeout(timer);
  }
}

function arabicError(code: string): string {
  switch (code) {
    case 'INVALID_KEY':
      return 'مفتاح التفعيل غير صحيح — تأكد من كتابته كما استلمته';
    case 'KEY_REVOKED':
      return 'تم إيقاف هذا المفتاح من الإدارة — تواصل معها للاشتراك';
    case 'DEVICE_LIMIT':
      return 'تم استخدام المفتاح على الحد الأقصى من الأجهزة — تواصل مع الإدارة';
    case 'KEY_EXPIRED':
      return 'انتهت صلاحية هذا المفتاح — تواصل مع الإدارة للتجديد';
    case 'INVALID_LICENSE':
      return 'بيانات التفعيل غير صالحة — أعد التفعيل بمفتاحك';
    case 'REVOKED':
      return 'تم إيقاف الاشتراك من الإدارة — تواصل معها';
    case 'EXPIRED':
      return 'انتهت صلاحية الاشتراك — جدّد عبر الإدارة';
    case 'UNKNOWN_DEVICE':
      return 'هذا الجهاز غير مرتبط بالاشتراك — أعد التفعيل بمفتاحك';
    default:
      return 'حدث خطأ أثناء الاتصال بالسيرفر — حاول مجدداً';
  }
}

export function getServerUrl(): string {
  return getString(KEYS.licenseServerUrl, LICENSE_SERVER_URL).replace(
    /\/+$/,
    '',
  );
}

export function setServerUrl(url: string): void {
  setString(KEYS.licenseServerUrl, url.trim().replace(/\/+$/, ''));
}

// ── Device identity (stable id from the Rust core) ────────────────
export async function getDeviceId(): Promise<string> {
  const cached = getString(KEYS.licenseDeviceId, '');
  if (cached.length > 0) {
    return cached;
  }
  try {
    const id = await api.deviceId();
    if (id && id.length > 0) {
      setString(KEYS.licenseDeviceId, id);
      return id;
    }
  } catch {
    // Fall through to a random id (worse binding, still functional).
  }
  const fallback = `dev-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  setString(KEYS.licenseDeviceId, fallback);
  return fallback;
}

// ── Trusted time (anti clock-tamper) ─────────────────────────────
/**
 * نفس الخوارزمية: مرساة زمن السيرفر + الزمن الأحادي منذ الإقلاع
 * (GetTickCount64 عبر النواة) — المستخدم لا يستطيع إرجاعها للخلف.
 */
export async function trustedNowMs(): Promise<number> {
  const anchor = getJson<Anchor | null>(KEYS.licenseAnchor, null);
  const wall = Date.now();
  if (anchor == null) {
    return wall;
  }
  try {
    const uptime = await api.uptimeMs();
    if (typeof uptime === 'number' && uptime >= anchor.uptimeMs) {
      return anchor.serverTimeMs + (uptime - anchor.uptimeMs);
    }
  } catch {
    // Native uptime unavailable — fall back below.
  }
  return Math.max(wall, anchor.serverTimeMs);
}

/** Detects wall-clock rollbacks relative to the trusted anchor. */
function checkRollbackStrike(): boolean {
  const anchor = getJson<Anchor | null>(KEYS.licenseAnchor, null);
  if (anchor == null) {
    return false;
  }
  if (Date.now() < anchor.serverTimeMs - LICENSE_ROLLBACK_TOLERANCE_MS) {
    const strikes = getNumber(KEYS.licenseRollbackStrikes, 0) + 1;
    setNumber(KEYS.licenseRollbackStrikes, strikes);
    logDiag(
      'license',
      `تم رصد محاولة إرجاع ساعة الجهاز للخلف (العدد ${strikes})`,
      'warn',
    );
    return true;
  }
  return false;
}

function anchorNow(serverTimeMs: number): void {
  void (async () => {
    let uptime = 0;
    try {
      uptime = (await api.uptimeMs()) ?? 0;
    } catch {
      uptime = 0;
    }
    setJson(KEYS.licenseAnchor, {
      serverTimeMs,
      uptimeMs: uptime,
      wallMs: Date.now(),
    });
  })();
}

// ── License storage ──────────────────────────────────────────────
export function loadLicense(): {
  payload: LicensePayload;
  payloadB64: string;
  signatureB64: string;
} | null {
  const payloadB64 = getString(KEYS.licensePayload, '');
  const signatureB64 = getString(KEYS.licenseSignature, '');
  if (!payloadB64 || !signatureB64) {
    return null;
  }
  const payload = verifyLicenseSignature(payloadB64, signatureB64);
  if (payload == null) {
    logDiag('license', 'فشل التحقق من توقيع الترخيص — سيتم مسحه', 'warn');
    clearLicense();
    return null;
  }
  return {payload, payloadB64, signatureB64};
}

export function clearLicense(): void {
  try {
    storageDelete(KEYS.licensePayload);
    storageDelete(KEYS.licenseSignature);
    storageDelete(KEYS.licenseAnchor);
    storageDelete(KEYS.licenseLastVerify);
    storageDelete(KEYS.licenseRollbackStrikes);
  } catch {
    // Ignore cleanup failures.
  }
}

export function getCachedContact(): LicenseContact | null {
  return getJson<LicenseContact | null>(KEYS.licenseContact, null);
}

function storeLicense(
  payloadB64: string,
  signatureB64: string,
  serverTimeMs: number,
): LicensePayload | null {
  const payload = verifyLicenseSignature(payloadB64, signatureB64);
  if (payload == null) {
    return null;
  }
  setString(KEYS.licensePayload, payloadB64);
  setString(KEYS.licenseSignature, signatureB64);
  setNumber(KEYS.licenseLastVerify, serverTimeMs);
  anchorNow(serverTimeMs);
  return payload;
}

// ── Public API ───────────────────────────────────────────────────
interface ActivateResponse {
  ok: boolean;
  license: string;
  signature: string;
  serverTime: number;
  expiresInDays: number;
  contact?: LicenseContact;
}

interface HeartbeatResponse {
  ok: boolean;
  status: 'active' | 'expired' | 'revoked' | 'unknown_device';
  serverTime: number;
  expiresAt: number;
  contact?: LicenseContact;
  license?: string;
  signature?: string;
}

/** Activates a subscription key from the management server. */
export async function activateLicense(
  key: string,
  onStatus?: (message: string) => void,
): Promise<LicenseStatus> {
  onStatus?.('جارٍ الاتصال بالسيرفر…');
  const deviceId = await getDeviceId();
  const data = await apiPost<ActivateResponse>('/api/v1/activate', {
    key: key.trim().toUpperCase(),
    deviceId,
    deviceLabel: `sela ${APP_VERSION} · ${APP_PLATFORM}`,
    appVersion: APP_VERSION,
  });
  onStatus?.('جارٍ التحقق من التوقيع…');
  const payload = storeLicense(data.license, data.signature, data.serverTime);
  if (payload == null) {
    throw new LicenseError(
      'ردّ السيرفر غير موقّع بشكل صالح — تواصل مع الإدارة',
      'BAD_SIGNATURE',
    );
  }
  if (data.contact) {
    setJson(KEYS.licenseContact, data.contact);
  }
  setNumber(KEYS.licenseRollbackStrikes, 0);
  logDiag(
    'license',
    `تم تفعيل الاشتراك (${payload.plan}) حتى ${new Date(
      payload.expiresAt,
    ).toLocaleDateString('ar')}`,
  );
  return evaluate();
}

/** Contacts the server to refresh revocation/expiry + re-anchor time. */
export async function heartbeat(force = false): Promise<LicenseStatus> {
  const current = loadLicense();
  if (current == null) {
    return evaluate();
  }
  const last = getNumber(KEYS.licenseLastVerify, 0);
  const now = await trustedNowMs();
  if (!force && now - last < HOUR_MS) {
    return evaluate();
  }
  try {
    const data = await apiPost<HeartbeatResponse>('/api/v1/heartbeat', {
      license: current.payloadB64,
      signature: current.signatureB64,
      deviceId: await getDeviceId(),
      deviceTime: Date.now(),
    });
    if (data.contact) {
      setJson(KEYS.licenseContact, data.contact);
    }
    switch (data.status) {
      case 'revoked':
        setNumber(KEYS.licenseLastVerify, -1);
        break;
      case 'unknown_device':
        clearLicense();
        break;
      case 'expired':
        break;
      default:
        if (data.license && data.signature) {
          storeLicense(data.license, data.signature, data.serverTime);
        } else {
          setNumber(KEYS.licenseLastVerify, data.serverTime);
          anchorNow(data.serverTime);
        }
        setNumber(KEYS.licenseRollbackStrikes, 0);
        break;
    }
  } catch (error) {
    if (error instanceof LicenseError && error.code === 'REVOKED') {
      setNumber(KEYS.licenseLastVerify, -1);
      return evaluate();
    }
    logDiag(
      'license',
      `فشل نبضة التحقق: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'warn',
    );
  }
  return evaluate();
}

/** Unbinds this device from the key (lets merchants switch devices). */
export async function unbindDevice(): Promise<void> {
  const current = loadLicense();
  if (current != null) {
    try {
      await apiPost('/api/v1/unbind', {
        license: current.payloadB64,
        signature: current.signatureB64,
        deviceId: await getDeviceId(),
      });
    } catch {
      // Server may be offline — local wipe still applies.
    }
  }
  clearLicense();
}

/**
 * The gate decision — runs 100% offline (server data is cached and
 * cryptographically verified). Same order as the Android app.
 */
export async function evaluate(): Promise<LicenseStatus> {
  const current = loadLicense();
  if (current == null) {
    return {
      state: 'needs_activation',
      license: null,
      remainingMs: 0,
      offlineHours: 0,
      lockReason: null,
      revoked: false,
    };
  }
  checkRollbackStrike();

  const strikes = getNumber(KEYS.licenseRollbackStrikes, 0);
  const revokedFlag = getNumber(KEYS.licenseLastVerify, 0) === -1;

  const now = await trustedNowMs();
  const lastVerify = getNumber(KEYS.licenseLastVerify, 0);
  const offlineMs = now - lastVerify;
  const offlineHours = Math.max(0, offlineMs / HOUR_MS);
  const remainingMs = current.payload.expiresAt - now;

  if (revokedFlag) {
    return {
      state: 'locked',
      license: current.payload,
      remainingMs,
      offlineHours,
      lockReason: 'revoked',
      revoked: true,
    };
  }
  if (remainingMs <= 0) {
    return {
      state: 'locked',
      license: current.payload,
      remainingMs,
      offlineHours,
      lockReason: 'expired',
      revoked: false,
    };
  }
  if (offlineMs > LICENSE_GRACE_HARD_HOURS * HOUR_MS || strikes >= 5) {
    return {
      state: 'locked',
      license: current.payload,
      remainingMs,
      offlineHours,
      lockReason: 'offline_too_long',
      revoked: false,
    };
  }
  if (offlineMs > LICENSE_GRACE_SOFT_HOURS * HOUR_MS) {
    return {
      state: 'grace',
      license: current.payload,
      remainingMs,
      offlineHours,
      lockReason: null,
      revoked: false,
    };
  }
  return {
    state: 'active',
    license: current.payload,
    remainingMs,
    offlineHours,
    lockReason: null,
    revoked: false,
  };
}
