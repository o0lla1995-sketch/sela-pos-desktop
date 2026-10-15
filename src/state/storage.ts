/**
 * storage.ts — مرآة config.json في الذاكرة (بديل MMKV).
 * القراءة متزامنة من المرآة (كما كان مع MMKV) والكتابة تحدّث المرآة
 * فوراً وتكتب config.json خلف الكواليس — نفس مفاتيح الأندرويد حرفياً
 * حتى تُستورد نسخة أندرويد الاحتياطية وتعمل مباشرة.
 */
import {api} from '../lib/tauri';

export const KEYS = {
  settings: 'settings_json_v1',
  cartDraft: 'cart_draft_v2',
  invoiceCounter: 'invoice_counter_v1',
  invoiceDay: 'invoice_day_v1',
  savedPrinter: 'saved_printer_v1',
  desktopPrinter: 'desktop_printer_v1',
  seededFlag: 'db_seeded_v1',
  notifications: 'notifications_v1',
  stockAlertLedger: 'stock_alert_ledger_v1',
  diagnosticsLog: 'diagnostics_log_v1',
  schemaVersion: 'db_schema_version',
  themeMode: 'theme_mode_v1',
  licensePayload: 'license_payload_b64_v1',
  licenseSignature: 'license_signature_b64_v1',
  licenseAnchor: 'license_anchor_v1',
  licenseLastVerify: 'license_last_verify_v1',
  licenseRollbackStrikes: 'license_rollback_strikes_v1',
  licenseServerUrl: 'license_server_url_v1',
  licenseDeviceId: 'license_device_id_v1',
  licenseContact: 'license_contact_v1',
} as const;

let mirror: Record<string, unknown> = {};

/** تحميل المرآة عند الإقلاع (مرة واحدة). */
export async function initStorage(): Promise<void> {
  mirror = await api.configGetAll();
}

function raw(key: string): unknown {
  return mirror[key];
}

export function getJson<T>(key: string, fallback: T): T {
  try {
    const value = raw(key);
    if (value == null) return fallback;
    if (typeof value === 'string') {
      // بذور أندرويد قديمة كانت تخزن بعض القيم كسلاسل JSON.
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
    return value as T;
  } catch {
    return fallback;
  }
}

export function setJson(key: string, value: unknown): void {
  mirror[key] = value;
  void api.configSet(key, value).catch(() => {
    /* أفضل جهد — المرآة محدثة محلياً على أي حال */
  });
}

export function getNumber(key: string, fallback: number): number {
  const value = raw(key);
  if (value == null) return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function setNumber(key: string, value: number): void {
  setJson(key, value);
}

export function getString(key: string, fallback: string): string {
  const value = raw(key);
  if (value == null) return fallback;
  return typeof value === 'string' ? value : String(value);
}

export function setString(key: string, value: string): void {
  setJson(key, value);
}

export function storageDelete(key: string): void {
  delete mirror[key];
  void api.configRemove(key).catch(() => {});
}

export const storage = {delete: storageDelete};

/** سجل حلقي للتشخيصات (نمط diagnostics الأندرويد). */
export function logDiag(
  scope: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const entry = {
    at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    scope,
    level,
    message,
  };
  const log = getJson<{at: string; scope: string; level: string; message: string}[]>(
    KEYS.diagnosticsLog,
    [],
  );
  log.push(entry);
  setJson(KEYS.diagnosticsLog, log.slice(-400));
}
