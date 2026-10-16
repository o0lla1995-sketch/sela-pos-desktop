/**
 * parity.serverconfig.test.ts — v57.2: تكافؤ ربط الخادم مع أندرويد v57.
 * ─────────────────────────────────────────────────────────────────
 *  ١) isValidServerUrl / adoptServerUrlIfProvided — نفس منطق أندرويد
 *     v48/v53 حرفياً: تبنّي صامت لرابط التفعيل الذي تديره لوحة
 *     التحكم، ورفض أي مخطط غير http/https.
 *  ٢) mergedContact — دمج {احتياطي، مخزّن} حقلًا بحقل مثل
 *     SubscriptionSection في التطبيق.
 *  ٣) refreshServerContact — جلب GET /api/v1/config الحيّ: جهات
 *     الاتصال تتحدّث من الخادم وتربط رابط التفعيل الجديد.
 */
import {describe, expect, test, beforeEach, vi} from 'vitest';

// ── محاكاة جسر Tauri (مرآة config في الذاكرة) ─────────────────────
const cfg = vi.hoisted(() => ({store: {} as Record<string, unknown>}));
vi.mock('../src/lib/tauri', () => ({
  invoke: vi.fn(async () => {
    throw new Error('لا يُستدعى في هذه الاختبارات');
  }),
  onBarcode: async () => () => {},
  api: {
    configGetAll: async () => ({...cfg.store}),
    configSet: async (key: string, value: unknown) => {
      cfg.store[key] = value;
    },
    configRemove: async (key: string) => {
      delete cfg.store[key];
    },
    deviceId: async () => 'desk-test-device',
    uptimeMs: async () => 60_000,
  },
}));

// ── محاكاة طبقة الشبكة (platformFetch) ──────────────────────────
const http = vi.hoisted(() => ({
  next: null as null | (() => Response | Promise<Response>),
  calls: [] as string[],
}));
vi.mock('../src/lib/http', () => ({
  platformFetch: (url: string, _init?: RequestInit) => {
    http.calls.push(url);
    if (http.next == null) {
      return Promise.reject(new Error('لا مهيأ'));
    }
    return Promise.resolve(http.next());
  },
}));

import {initStorage, KEYS, setJson, storageDelete} from '../src/state/storage';
import {
  getServerUrl,
  isValidServerUrl,
  adoptServerUrlIfProvided,
  mergedContact,
  getCachedContact,
  refreshServerContact,
} from '../src/license/LicenseService';
import {LICENSE_SERVER_URL, LICENSE_CONTACT_FALLBACK} from '../src/core/config';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

beforeEach(async () => {
  cfg.store = {};
  http.next = null;
  http.calls = [];
  await initStorage();
  storageDelete(KEYS.licenseServerUrl);
  storageDelete(KEYS.licenseContact);
});

describe('isValidServerUrl — نفس تعبير أندرويد v53', () => {
  test('يقبل http/https بمضيف صالح فقط', () => {
    expect(isValidServerUrl('http://sela.example.com')).toBe(true);
    expect(isValidServerUrl('https://sela.example.com/api')).toBe(true);
    expect(isValidServerUrl('  http://8jz9.130.61.171.201.sslip.io  ')).toBe(
      true,
    );
    expect(isValidServerUrl('ftp://sela.example.com')).toBe(false);
    expect(isValidServerUrl('javascript:alert(1)')).toBe(false);
    expect(isValidServerUrl('file:///etc/passwd')).toBe(false);
    expect(isValidServerUrl('')).toBe(false);
    expect(isValidServerUrl('http://')).toBe(false);
    expect(isValidServerUrl('not a url')).toBe(false);
    // @ts-expect-error — الاختبار يمرر أنواعاً خاطئة عمداً
    expect(isValidServerUrl(null)).toBe(false);
  });
});

describe('adoptServerUrlIfProvided — تبنّي رابط الإدارة (أندرويد v48)', () => {
  test('الرابط الافتراضي قبل أي رد من الخادم', () => {
    expect(getServerUrl()).toBe(LICENSE_SERVER_URL);
  });

  test('يتبنّى رابطاً صالحاً جديداً ويجرّد الشرطة الختامية', () => {
    adoptServerUrlIfProvided({activationUrl: 'http://new.example.com///'});
    expect(getServerUrl()).toBe('http://new.example.com');
  });

  test('يتجاهل المخططات غير الصالحة تماماً', () => {
    const before = getServerUrl();
    adoptServerUrlIfProvided({activationUrl: 'javascript://evil'});
    adoptServerUrlIfProvided({activationUrl: 'http://'});
    adoptServerUrlIfProvided({activationUrl: '   '});
    expect(getServerUrl()).toBe(before);
  });

  test('لا يعيد الكتابة حين الرابط هو نفسه', () => {
    adoptServerUrlIfProvided({activationUrl: getServerUrl()});
    expect(getServerUrl()).toBe(LICENSE_SERVER_URL);
  });

  test('رد بلا activationUrl أو كائن فارغ — لا تغيير', () => {
    const before = getServerUrl();
    adoptServerUrlIfProvided({ok: true});
    adoptServerUrlIfProvided(null);
    adoptServerUrlIfProvided(undefined);
    expect(getServerUrl()).toBe(before);
  });
});

describe('mergedContact — دمج {احتياطي، مخزّن} مثل التطبيق', () => {
  test('بلا كاش: قيم الاحتياطي الجاهزة', () => {
    const merged = mergedContact();
    expect(merged.phone).toBe(LICENSE_CONTACT_FALLBACK.phone);
    expect(merged.email).toBe(LICENSE_CONTACT_FALLBACK.email);
    expect(merged.note).toBe(LICENSE_CONTACT_FALLBACK.note);
  });

  test('كاش الخادم يتقدم على الاحتياطي حقلًا بحقل', () => {
    setJson(KEYS.licenseContact, {
      phone: '0597320229',
      whatsapp: '+970597320229',
      telegram: '',
      email: 'abdala2656289@gmail.com',
      note: 'للتجديد تواصل معنا',
    });
    const merged = mergedContact();
    expect(merged.phone).toBe('0597320229');
    expect(merged.email).toBe('abdala2656289@gmail.com');
    expect(merged.note).toBe('للتجديد تواصل معنا');
    // قناة فارغة من الخادم تبقى فارغة (تُخفى في الواجهة) — نفس أندرويد.
    expect(merged.telegram).toBe('');
  });
});

describe('refreshServerContact — قسم التواصل الحي من السيرفر', () => {
  test('يجلب /api/v1/config ويخزّن التواصل ويتبنّى الرابط', async () => {
    http.next = () =>
      jsonResponse({
        ok: true,
        contact: {
          phone: '0597320229',
          whatsapp: '+970597320229',
          telegram: '',
          email: 'abdala2656289@gmail.com',
          note: 'تحديث من اللوحة',
        },
        activationUrl: 'http://moved.example.com',
        currency: '₪',
      });
    const live = await refreshServerContact();
    expect(http.calls).toEqual([`${LICENSE_SERVER_URL}/api/v1/config`]);
    expect(live?.phone).toBe('0597320229');
    expect(getCachedContact()?.email).toBe('abdala2656289@gmail.com');
    // رابط التفعيل المُدار من الإدارة تبنّي نفسه هنا أيضاً.
    expect(getServerUrl()).toBe('http://moved.example.com');
    // والقسم المعروض للmerchant صار بالبيانات الحية.
    expect(mergedContact().note).toBe('تحديث من اللوحة');
  });

  test('فشل الشبكة لا يرفع خطأ ولا يمس البيانات المخزنة', async () => {
    setJson(KEYS.licenseContact, {
      phone: '0597320229',
      whatsapp: '',
      telegram: '',
      email: 'old@example.com',
      note: '',
    });
    http.next = () => Promise.reject(new TypeError('Failed to fetch'));
    const result = await refreshServerContact();
    expect(result).toBeNull();
    // الكاش السابق باقٍ — أفضل جهد دائماً.
    expect(getCachedContact()?.email).toBe('old@example.com');
  });

  test('رد غير ok (502) يُتجاهل بصمت', async () => {
    http.next = () => jsonResponse({ok: false}, 502);
    const result = await refreshServerContact();
    expect(result).toBeNull();
    expect(getCachedContact()).toBeNull();
  });
});
