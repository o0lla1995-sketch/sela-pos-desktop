/**
 * useAmountKeyboard — v59 (جولة المستخدم #2): كل نافذة تحتوي لوحة
 * أرقام مدمجة (الدفع النقدي، الوزن، القسيمة…) تقبل الآن الكتابة
 * المباشرة من الكيبورد الفعلي:
 *   • الأرقام والفاصلة وBackspace (بما فيها لوحة الأرقام الجانبية
 *     NumPad) تغذّي المبلغ بنفس قواعد applyAmountKey النقدية.
 *   • Enter يؤكد مباشرة (استدعاء onConfirm) — بلا لمس الفأرة.
 *   • Escape يغلق النافذة.
 *
 * أثناء فتح اللوحة يُكتم موجّه الباركود (JS + الخطاف الأصلي) كي لا
 * تُفسَّر الكتابة السريعة على الكيبورد كمسح قارئ (اندفاعة < 50مللي
 * بطول ≥ 4 كانت تُطلق «باركود غير معروف» أثناء إدخال المبالغ).
 *
 * الكتابة داخل INPUT/TEXTAREA تُترك للنظام (المستخدم يكتب في حقل
 * نصي) — لكن Enter داخلها يُؤكد أيضاً لأنه أمر إتمام صريح.
 */
import {useEffect} from 'react';
import {applyAmountKey} from '../core/amountKeypad';
import {suppressScanner} from './scanner';
import {selaSelectOpen} from '../components/Select';

export interface AmountKeyboardOptions {
  /** اللوحة معروضة الآن؟ (لا تركيب أي مستمع وهي مغلقة). */
  active: boolean;
  /** ضغطة مفتاح تُطبق على نص المبلغ. */
  onKey: (next: string) => void;
  /** نص المبلغ الحالي (لتطبيق applyAmountKey عليه). */
  text: string;
  /** Enter — التأكيد المباشر. */
  onConfirm: () => void;
  /** Escape — إغلاق اللوحة. */
  onCancel: () => void;
  /** هل يوجد حقل نصي داخل اللوحة؟ عندها الأرقام تذهب للحقل نفسه. */
  hasTextInput?: boolean;
}

export function useAmountKeyboard(options: AmountKeyboardOptions): void {
  const {active, onKey, text, onConfirm, onCancel, hasTextInput = false} = options;

  useEffect(() => {
    if (!active) {
      return;
    }
    // كتم الماسح طوال فتح اللوحة (ref-count آمن لو تداخلت لوحتان).
    void suppressScanner(true);
    return () => {
      void suppressScanner(false);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const insideInput =
        target != null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      // Enter يؤكد دائماً — حتى داخل حقل نصي (صريح وواضح) — إلا إن
      // كانت قائمة منسدلة مخصّصة مفتوحة (v61: Enter يختار خيارها).
      if (event.key === 'Enter') {
        if (selaSelectOpen()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      // داخل حقل نصي: الأرقام تكتب بشكل طبيعي في الحقل نفسه.
      if (insideInput && hasTextInput) {
        return;
      }
      // مفاتيح المبلغ: أرقام (الصف العلوي + NumPad) / فاصلة / حذف.
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        onKey(applyAmountKey(text, event.key));
        return;
      }
      if (event.key === '.' || event.key === ',') {
        event.preventDefault();
        onKey(applyAmountKey(text, '.'));
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        onKey(applyAmountKey(text, '⌫'));
        return;
      }
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  }, [active, text, onKey, onConfirm, onCancel, hasTextInput]);
}
