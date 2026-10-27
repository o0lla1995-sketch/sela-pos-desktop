/**
 * components/PaymentMethodIcon.tsx — v70 (الجولة 74 #2): أيقونة طريقة
 * الدفع — رقاقة بلون العلامة وحرفيها + رمز النوع (بنك/محفظة/نقدي).
 * علامات أصلية بسيطة (بلا شعارات محفوظة الحقوق) بألوان كل جهة
 * المعروفة لدى التجار — نفس نمط بطاقات الدفع في تطبيقات المحافظ.
 */
import React from 'react';
import type {PaymentMethod} from '../core/paymentMethods';

export function PaymentMethodIcon({
  method,
  size = 34,
}: {
  method: PaymentMethod;
  size?: number;
}): React.ReactElement {
  const glyphSize = Math.round(size * 0.42);
  return (
    <span
      className="pmi"
      style={{
        width: size,
        height: size,
        background: method.color,
        borderColor: method.color,
      }}
      title={method.label}
      aria-label={method.label}>
      <span
        className="pmi-mark"
        style={{
          fontSize: method.mark.length > 1 ? glyphSize * 0.78 : glyphSize,
        }}>
        {method.mark}
      </span>
      {method.kind !== 'cash' && (
        <span className="pmi-kind">
          {method.kind === 'bank' ? 'بنك' : 'محفظة'}
        </span>
      )}
    </span>
  );
}
