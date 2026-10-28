/**
 * scanner.ts — توجيه قراءات الباركود (المهمة §2.أ):
 *  1) الحدث الأصلي من خطاف النواة (WH_KEYBOARD_LL على ويندوز) يصل عبر
 *     «scanner://barcode».
 *  2) بديل JS داخلي بنفس منطق الاندفاعة (فجوة < 50مللي، ≥ 4، Enter/Tab
 *     إغلاق) — يعمل حين لا يوجد خطاف (تطوير لينكس) وحتى دون تركيز حقل.
 * القراءة تُمرَّر إلى «الماسح النشط» أياً كانت الشاشة المعروضة —
 * بلا أي تركيز يدوي على حقل نصي. حاجب 1.6 ثانية لنفس الكود
 * (نفس BARCODE_DEDUPE_MS الأندرويد).
 *
 * v73 (الجولة 77 #1): إدخال الباركود اللاسلكي في الحقل المركز —
 * مسار الماسح اللاسلكي (كاميرا جوال سيلّا كاشير عبر /api/scan) يعمل
 * الآن «كماسح USB حرفياً» من زاويتين:
 *  • إدخال مباشر (wedge): إن كان أي حقل نصي مركزاً عند وصول القراءة
 *    اللاسلكية تُكتب قيمته فيه (setter الأصلي + أحداث input/change +
 *    Enter الختامي) — تماماً كما تفعل ضربات ماسح USB المزروع بلوحة
 *    المفاتيح. لا ينطبق إلا على المسار اللاسلكي (الحقن الخارجي)، فأما
 *    خطاف USB فنقراته تصل الحقل بنفسها أصلاً.
 *  • مكدس معالجات النوافذ (pushBarcodeHandler): نموذج المنتج/الإضافة
 *    السريعة يسجلان معالجاً أعلى المكدس فيستقبل المسح حتى دون تركيز
 *    حقل — يملآن حقل الباركود مباشرة. PosScreen يبقى القاعدة
 *    (setActiveBarcodeHandler) والقمة تسود.
 */
import {onBarcode, api} from './tauri';
import {BARCODE_DEDUPE_MS} from '../core/config';

export type BarcodeHandler = (code: string) => void;

/** القاعدة — شاشة نقطة البيع أو مربع اختبار الإعدادات. */
let activeHandler: BarcodeHandler | null = null;
/** مكدس النوافذ فوق القاعدة — القمة تسود (نموذج المنتج، الإضافة السريعة). */
const handlerStack: BarcodeHandler[] = [];
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

/**
 * v73: تسجيل معالج نافذة فوق القاعدة — يعيد دالة إزالة (ومكدس
 * بالترتيب: آخر نافذة مفتوحة تستلم المسح أولاً). تستعمله نوافذ
 * النماذج (ملف المنتج/الإضافة السريعة) كي يصلها المسح حتى دون
 * تركيز أي حقل.
 */
export function pushBarcodeHandler(handler: BarcodeHandler): () => void {
  handlerStack.push(handler);
  return () => {
    const index = handlerStack.lastIndexOf(handler);
    if (index >= 0) {
      handlerStack.splice(index, 1);
    }
  };
}

/** نتيجة حقن قراءة لاسلكية — للتغذية الراجعة الدقيقة على الجوال. */
export interface ScanInjection {
  /** هل وصلت القراءة إلى وجهة ما (حقل مركز أو معالج نشط)؟ */
  injected: boolean;
  /** هل كُتبت داخل حقل نصي مركز (wedge)؟ */
  wedge: boolean;
  reason: 'ok' | 'short' | 'suppressed' | 'deduped' | 'no_handler';
}

const TEXT_LIKE_INPUT_TYPES = new Set([
  'text',
  'number',
  'tel',
  'search',
  'url',
  'email',
  'password',
  '',
]);

/**
 * v73: كتابة الكود داخل الحقل النصي المركز — سلوك ماسح USB بالضبط.
 * يعيد true إن كان هناك حقل صالح مركز وتمت الكتابة فيه. يعتمد
 * setter القيمة الأصلي من النموذج الأولي (طريقة React المعتمدة
 * لتحديث الحقول المتحكم بها) ثم يطلق أحداث input/change + Enter
 * الختامي الذي ترسله قارئات USB عادة.
 */
function wedgeIntoFocusedInput(code: string): boolean {
  const el = document.activeElement as HTMLInputElement | null;
  if (el == null) {
    return false;
  }
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
    return false;
  }
  if (el.disabled || el.readOnly) {
    return false;
  }
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (!TEXT_LIKE_INPUT_TYPES.has(type)) {
    return false;
  }
  if (type === 'number' && !/^[0-9]*$/.test(code)) {
    return false; // حقل رقمي وكود يحمل حروفاً — لا تدخله هناك.
  }
  const proto =
    tag === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  try {
    if (descriptor?.set != null) {
      descriptor.set.call(el, code);
    } else {
      el.value = code;
    }
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    // Enter الختامي — مثل قارئ USB (يفعّل حقول «اضغط إضافة…»).
    const enterBase = {key: 'Enter', code: 'Enter', bubbles: true};
    el.dispatchEvent(
      new KeyboardEvent('keydown', {...enterBase, keyCode: 13, which: 13}),
    );
    el.dispatchEvent(
      new KeyboardEvent('keyup', {...enterBase, keyCode: 13, which: 13}),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * v70 (الجولة 74 #7): حقن قراءة باركود من مصدر خارجي — الماسح
 * اللاسلكي (كاميرا جوال «سيلّا كاشير» المتصل بالشبكة المحلية).
 * v73: الوجهة صارت ثلاثية الدرجات — الحقل المركز أولاً (wedge)،
 * ثم قمة مكدس النوافذ، ثم المعالج القاعدي — فتعمل الكاميرا
 * اللاسلكية تماماً كماسح USB مربوط بالكيبورد: إضافة للسلة عند
 * البيع وتعبئة حقل الباركود عند إضافة المنتجات.
 */
export function injectBarcode(code: string): ScanInjection {
  const clean = code.trim();
  if (clean.length < 4) {
    return {injected: false, wedge: false, reason: 'short'};
  }
  if (suppressedCount > 0) {
    return {injected: false, wedge: false, reason: 'suppressed'};
  }
  if (
    lastCode != null &&
    lastCode.code === clean &&
    Date.now() - lastCode.at < BARCODE_DEDUPE_MS
  ) {
    return {injected: false, wedge: false, reason: 'deduped'};
  }
  lastCode = {code: clean, at: Date.now()};
  // ① الحقل النصي المركز — سلوك ماسح USB الحرفي.
  if (wedgeIntoFocusedInput(clean)) {
    beep('ok');
    return {injected: true, wedge: true, reason: 'ok'};
  }
  // ② قمة مكدس النوافذ (نموذج المنتج/الإضافة السريعة).
  const stacked = handlerStack[handlerStack.length - 1];
  if (stacked != null) {
    stacked(clean);
    return {injected: true, wedge: false, reason: 'ok'};
  }
  // ③ المعالج القاعدي (نقطة البيع / مربع اختبار الإعدادات).
  if (activeHandler != null) {
    activeHandler(clean);
    return {injected: true, wedge: false, reason: 'ok'};
  }
  return {injected: false, wedge: false, reason: 'no_handler'};
}

function route(code: string): void {
  if (suppressedCount > 0) return; // لوحة مبالغ مفتوحة أو التطبيق مقفل.
  const clean = code.trim();
  if (clean.length < 4) return;
  if (lastCode && lastCode.code === clean && Date.now() - lastCode.at < BARCODE_DEDUPE_MS) {
    return; // إعادة مسح نفس الكود خلال الحاجب — تُتجاهل.
  }
  lastCode = {code: clean, at: Date.now()};
  const stacked = handlerStack[handlerStack.length - 1];
  if (stacked != null) {
    stacked(clean);
    return;
  }
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
