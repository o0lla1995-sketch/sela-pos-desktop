/**
 * http.ts — جسر الشبكة الموحد (v57.2).
 * ─────────────────────────────────────────────────────────────────
 * الجذر الذي منع التفعيل كله: WebView داخل Tauri يفرض سياسة CSP
 * (default-src 'self' بلا connect-src) ثم سلوك CORS على كل fetch —
 * وسيرفر التفعيل (المُعدّ لأندرويد/OkHttp) لا يرسل ترويسات CORS
 * أصلاً، فكان الطلب يُقتل مرتين قبل بلوغ الشبكة.
 *
 * الحل: كل نداءات HTTP تمر من هنا. داخل Tauri تُنفَّذ عبر إضافة
 * plugin-http (عملية Rust الأصلية) — بلا CSP ولا CORS، بنفس دلالات
 * fetch. خارج Tauri (اختبارات vitest على Node، أو المتصفح أثناء
 * التطوير) تسقط إلى fetch العام كما هي.
 *
 * طبقات الاتصال الثلاث (LicenseService / OnlineApi / SilaApi)
 * تستورد platformFetch من هنا وحدها — لا fetch مباشراً بعد اليوم.
 */

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let resolved: FetchLike | null = null;
let resolving: Promise<FetchLike> | null = null;

/** داخل نافذة Tauri؟ (المتصفح/Node لا يعرّفانها). */
function inTauri(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    '__TAURI_INTERNALS__' in globalThis
  );
}

async function resolveFetch(): Promise<FetchLike> {
  if (resolved != null) {
    return resolved;
  }
  if (resolving != null) {
    return resolving;
  }
  resolving = (async () => {
    let picked: FetchLike | null = null;
    if (inTauri()) {
      try {
        // الاستيراد الديناميكي يُحمَّل فقط داخل التطبيق الفعلي —
        // في الاختبارات (Node) لا يُلمس إطلاقاً فتبقى الحزمة بعيدة
        // عن محاكاة vitest.
        const mod = await import('@tauri-apps/plugin-http');
        picked = mod.fetch as FetchLike;
      } catch {
        picked = null;
      }
    }
    if (picked == null) {
      if (typeof fetch !== 'function') {
        throw new Error('لا توجد طبقة شبكة متاحة في هذه البيئة');
      }
      picked = fetch.bind(globalThis) as FetchLike;
    }
    resolved = picked;
    return picked;
  })();
  return resolving;
}

/**
 * fetch موحّد: عبر نواة Rust داخل التطبيق، وعبر fetch العام خارجه.
 * نفس توقيع fetch القياسي — الإسقاط في الطبقات حرفي.
 */
export async function platformFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fn = await resolveFetch();
  return fn(url, init);
}
