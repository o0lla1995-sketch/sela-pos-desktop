/**
 * v81 — الجولة 86: شعارات حقيقية لقنوات التسوية في نافذة إتمام
 * تعديل الفاتورة (سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر نصاً:
 * «اولا في تطبيق نقطة البيع سطح المكتب نافذة إتمام الفاتورة تظهر
 *  فيها خيارات الدفع وصور تظهر كنص فقط ؟!.».
 *
 * السبب: نافذة إتمام التعديل (v80) رسمت كل طريقة دفع بحرفها الأول
 * نصاً (`label.slice(0, 1)`) داخل span بلا نمط، ووسمت المختارة بفئة
 * `active` لا وجود لها في CSS — فلا شعارات ولا تمييز. الإصلاح: نفس
 * بطاقات نافذة الدفع (PaymentMethodIcon بالشعارات الرسمية + الاسم +
 * نوع القناة) وفئة sel المختارة.
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8') as string;

const POS = 'src/screens/PosScreen.tsx';
const ICON = 'src/components/PaymentMethodIcon.tsx';
const CONFIG = 'src/core/config.ts';

describe('v81 — ١ قنوات التسوية بشعاراتها الحقيقية', () => {
  test('لا حرف نصي بدل الصورة بعد الآن', () => {
    const src = read(POS);
    expect(src).not.toContain('method.label.slice(0, 1)');
    expect(src).not.toContain('pos-pay-method-icon');
  });

  test('نافذة إتمام التعديل تستخدم PaymentMethodIcon نفسها', () => {
    const src = read(POS);
    // بطاقة القناة في شبكة التسوية: شعار + اسم + نوع.
    expect(src).toContain(
      "aria-label=\"قناة التسوية\"",
    );
    expect(src).toMatch(
      /editSettleMethod === method\.id \? 'sel' : ''/,
    );
    expect(src).not.toMatch(/editSettleMethod === method\.id \? 'active' : ''/);
    // الشعار بنفس مكوّن الهوية (يظهر مرتين: نافذة الدفع + التسوية).
    const uses = src.match(/<PaymentMethodIcon method=\{method\} size=\{40\} \/>/g) ?? [];
    expect(uses.length).toBe(1);
    expect(src).toContain('<PaymentMethodIcon method={selectedPayMethod} size={52} />');
  });

  test('نوع القناة تحت الاسم في بطاقات التسوية', () => {
    const src = read(POS);
    expect(src).toContain('الخزينة النقدية');
    expect(src).toContain('تحويل بنكي');
    expect(src).toContain('محفظة إلكترونية');
  });

  test('مصدر الشعارات الرسمية موجود (بنوك ومحافظ فلسطينية)', () => {
    const src = read(ICON);
    expect(src).toContain("bank_palestine: bankPalestineLogo");
    expect(src).toContain("jawwal_pay: jawwalPayLogo");
    expect(src).toContain("malchat: malchatLogo");
  });
});

describe('v81 — ٢ الإصدار', () => {
  test('82.0.0 (26) في كل ملفات الإصدار', () => {
    expect(read(CONFIG)).toContain("APP_VERSION = '82.0.0'");
    expect(read(CONFIG)).toContain('APP_BUILD_CODE = 26');
    expect(read('package.json')).toContain('"version": "82.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain('"version": "82.0.0"');
    expect(read('src-tauri/Cargo.toml')).toContain('version = "82.0.0"');
  });
});
