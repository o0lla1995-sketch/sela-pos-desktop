/**
 * lib/useEnterConfirm.ts — v61 (الجولة 26 #6).
 * ─────────────────────────────────────────────────────────────────
 * «عند الضغط Enter في أي نافذة بها تأكيد يتم التأكيد مباشرة» —
 * خطاف موحّد لكل نوافذ الحوار: يركّب مستمعاً فقط حين النافذة
 * مفتوحة، وEnter (العادي أو NumPad) يستدعي فعل التأكيد.
 *
 * قواعد السلامة:
 *  • Enter داخل TEXTAREA لا يُعترض أبداً — سطر جديد مقصود.
 *  • قائمة منسدلة مفتوحة (sela-select)؟ Enter ملكها — يختار
 *    الخيار ولا يؤكد النافذة.
 *  • enabled تُقيَّم لحظة الضغط (busy/تعطيل) — لا تأكيد أثناء
 *    عمل جارٍ.
 *  • skipOnInputs: لنوافذ التحرير الطويلة (ملف المنتج) — Enter
 *    داخل INPUT/SELECT لا يحفظ (مسح باركود يرسل Enter لاحقاً
 *    كان سيحفظ المنتج نصف مكتمل).
 */
import {useEffect} from 'react';
import {selaSelectOpen} from '../components/Select';

export interface EnterConfirmOptions {
  /** النافذة معروضة الآن؟ (لا تركيب أي مستمع وهي مغلقة). */
  active: boolean;
  /** فعل التأكيد (نفس ما يفعله زر التأكيد الأساسي). */
  onConfirm: () => void;
  /** شرط إضافي يُفحص لحظة الضغط (مشغول/معطّل → تجاهل). */
  enabled?: () => boolean;
  /** تجاهل Enter داخل INPUT/SELECT كذلك (نوافذ التحرير الطويلة). */
  skipOnInputs?: boolean;
}

export function useEnterConfirm(options: EnterConfirmOptions): void {
  const {active, onConfirm, enabled, skipOnInputs = false} = options;

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== 'NumpadEnter') {
        return;
      }
      // قائمة منسدلة مفتوحة؟ Enter يختار خيارها لا أكثر.
      if (selaSelectOpen()) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target != null &&
        (target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return; // سطر جديد مقصود داخل نص طويل.
      }
      if (
        skipOnInputs &&
        target != null &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if (enabled != null && !enabled()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onConfirm();
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onConfirm, enabled, skipOnInputs]);
}
