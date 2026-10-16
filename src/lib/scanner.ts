/**
 * scanner.ts — توجيه قراءات الباركود (المهمة §2.أ):
 *  1) الحدث الأصلي من خطاف النواة (WH_KEYBOARD_LL على ويندوز) يصل عبر
 *     «scanner://barcode».
 *  2) بديل JS داخلي بنفس منطق الاندفاعة (فجوة < 50مللي، ≥ 4، Enter/Tab
 *     إغلاق) — يعمل حين لا يوجد خطاف (تطوير لينكس) وحتى دون تركيز حقل.
 * القراءة تُمرَّر إلى «الماسح النشط» أياً كانت الشاشة المعروضة —
 * بلا أي تركيز يدوي على حقل نصي. حاجب 1.6 ثانية لنفس الكود
 * (نفس BARCODE_DEDUPE_MS الأندرويد).
 */
import {onBarcode, api} from './tauri';
import {BARCODE_DEDUPE_MS} from '../core/config';

export type BarcodeHandler = (code: string) => void;

let activeHandler: BarcodeHandler | null = null;
let lastCode: {code: string; at: number} | null = null;

/**
 * v59: كتم الماسح مؤقتاً — تستدعيه لوحات إدخال المبالغ (كي لا
 * تُفسَّر الكتابة على الكيبورد كمسح باركود) وشاشة قفل الدخول
 * (لا بيع قبل الدخول). يكتم المسارين معاً: توجيه JS والخطاف
 * الأصلي على ويندوز.
 */
let suppressedCount = 0;

export async function suppressScanner(suppress: boolean): Promise<void> {
  suppressedCount = Math.max(0, suppressedCount + (suppress ? 1 : -1));
  const on = suppressedCount === 0;
  try {
    if ('__TAURI_INTERNALS__' in window) {
      await api.scannerSetEnabled(on);
    }
  } catch {
    /* أفضل جهد */
  }
}

export function setActiveBarcodeHandler(handler: BarcodeHandler | null): void {
  activeHandler = handler;
}

function route(code: string): void {
  if (suppressedCount > 0) return; // لوحة مبالغ مفتوحة أو التطبيق مقفل.
  const clean = code.trim();
  if (clean.length < 4) return;
  if (lastCode && lastCode.code === clean && Date.now() - lastCode.at < BARCODE_DEDUPE_MS) {
    return; // إعادة مسح نفس الكود خلال الحاجب — تُتجاهل.
  }
  lastCode = {code: clean, at: Date.now()};
  activeHandler?.(clean);
}

/** يركّب المسارين (الحدث الأصلي + بديل JS) — يستدعى مرة عند الإقلاع. */
export async function installGlobalScanner(minLength: number): Promise<void> {
  // 1) الحدث الأصلي من النواة.
  try {
    await onBarcode(route);
  } catch {
    /* ليس داخل تauri (اختبارات) — تجاهل */
  }

  // 2) بديل JS: نفس منطق اندفاعة القارئ لكن من أحداث المتصفح —
  //    يعمل دون تركيز حقل نصي، ويتجاهل الكتابة داخل عناصر الإدخال
  //    (المستخدم يكتب بنفسه: فجوات أبطأ وغالباً داخل حقل).
  let buffer = '';
  let lastAt = 0;
  const GAP = 50;
  window.addEventListener(
    'keydown',
    event => {
      // v59: لوحة مبالغ مفتوحة أو التطبيق مقفل — الكتابة الإنسانية
      // لا تُجمع كاندفاعة قارئ أبداً.
      if (suppressedCount > 0) {
        buffer = '';
        return;
      }
      const target = event.target as HTMLElement | null;
      const insideInput =
        target != null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (insideInput) {
        // الحقل النشط يستقبل الكتابة الطبيعية؛ القارئ الذي يكتب داخل حقل
        // يُغلق بالـ Enter — نتركه للنظام.
        buffer = '';
        return;
      }
      const now = Date.now();
      if (now - lastAt > GAP) {
        buffer = '';
      }
      lastAt = now;
      if (event.key === 'Enter' || event.key === 'Tab') {
        const code = buffer;
        buffer = '';
        if (code.length >= Math.max(4, minLength)) {
          event.preventDefault();
          route(code);
        }
        return;
      }
      if (event.key.length === 1) {
        buffer += event.key;
        if (buffer.length > 64) buffer = '';
      } else if (event.key === 'Backspace') {
        buffer = buffer.slice(0, -1);
      } else if (event.key === 'Escape') {
        buffer = '';
      }
    },
    true,
  );
}

/** صافرة إضافة منتج (WebAudio — بديل beep الأندرويد الأصلي). */
export function beep(kind: 'ok' | 'error' = 'ok'): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext})
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = kind === 'ok' ? 880 : 320;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
    osc.onended = () => void ctx.close();
  } catch {
    /* بلا صوت — ليست حرجة */
  }
}
