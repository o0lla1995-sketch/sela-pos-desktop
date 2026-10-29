/**
 * v74-round78.test.ts — الجولة 78: ملاحظات التاجر على سطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 *  ① أيقونات البنوك والمحافظ كبيرة ومرئية — كانت «صغيرة جدا ولا
 *     تكاد تري بالعين المجردة» بطلب التاجر نصاً: الرئيسية 30→46،
 *     التقارير 22→32 و26→34، الفواتير (التسوية) 22→26، الإعدادات
 *     38→46.
 *     ← حُدّثت للجولة 80 (#٤أ): الشعار يبدو صغيراً داخل إطاره
 *        (padding 6%→2.5% + قص الحواف المدمجة) فكُبّرت الأرقام
 *        مرة أخرى: الرئيسية 54، التقارير 36، التسوية 32، الإعدادات
 *        52، الفلترة 28، شارة الصف 24.
 *  ② الفواتير مميزة بطريقة الدفع التي تمت بها: كل صف يحمل شارة
 *     الشعار الرسمي + الاسم بلون العلامة — للنقدي كما للبنوك
 *     والمحافظ (النقدي كانت بلا شارة أصلاً)، ورقائق الفلترة
 *     تحمل الشعار نفسه.
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

/**
 * تطبيع أسطر الملفات المقروءة (CRLF → LF): عدّاد ويندوز يُخرج
 * الملفات بأسطر CRLF افتراضياً (لا يوجد .gitattributes يفرض LF)
 * فأي مقارنة نصية متعددة الأسطر تفشل هناك دون هذا التطبيع —
 * هذا بالضبط ما أسقط بناء v74.0.0 الأول على ويندوز بينما نجح
 * نفس الاختبار على لينكس.
 */
const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const HOME = 'src/screens/HomeScreen.tsx';
const REPORTS = 'src/screens/ReportsScreen.tsx';
const INVOICES = 'src/screens/InvoicesScreen.tsx';
const SETTINGS = 'src/screens/SettingsScreen.tsx';
const STYLES = 'src/styles.css';
const CHANNELS_CSS = 'src/screens/invoiceshome.css';
const CONFIG = 'src/core/config.ts';

describe('v74 — ① أيقونات البنوك والمحافظ كبيرة ومرئية', () => {
  test('الرئيسية: شعار القنوات 54px داخل رقاقة أوسع (حُدّث للجولة 80)', () => {
    const src = read(HOME);
    expect(src).toContain('size={54}');
    expect(src).not.toContain('size={30}');
    const css = read(CHANNELS_CSS);
    expect(css).toContain('min-width: 196px');
  });

  test('التقارير: شعارات أرصدة القنوات 36px وسجل القناة 34px (حُدّث للجولة 80)', () => {
    const src = read(REPORTS);
    expect(src).toContain('<PaymentMethodIcon method={method} size={36} />');
    expect(src).toContain('size={34}');
    expect(src).not.toContain('<PaymentMethodIcon method={method} size={22} />');
  });

  test('الإعدادات: بطاقات التفعيل بشعار 52px (حُدّث للجولة 80)', () => {
    const src = read(SETTINGS);
    expect(src).toContain('<PaymentMethodIcon method={method} size={52} />');
  });

  test('فواتير المرتجع: رقائق التسوية بشعار 32px (حُدّث للجولة 80)', () => {
    const src = read(INVOICES);
    expect(src).toContain('<PaymentMethodIcon method={channel} size={32} />');
  });
});

describe('v74 — ② الفواتير مميزة بطريقة الدفع', () => {
  test('كل صف فاتورة يحمل شارة الشعار الرسمي (النقدي أيضاً)', () => {
    const src = read(INVOICES);
    // الشارة الجديدة بشعار الجهة داخلها — للنقدي كما للبنوك.
    expect(src).toContain('ih-method-badge');
    expect(src).toContain(
      "row.return_kind != null\n                          ? null\n                          : row.payment_method || 'cash',",
    );
    // الحارس القديم (شارة نصية للنقدي فقط عند غير النقدي) أزيل.
    expect(src).not.toContain(
      "row.payment_method !== 'cash' && (",
    );
  });

  test('رقائق فلترة طريقة الدفع تحمل الشعار الرسمي (حُدّث للجولة 80)', () => {
    const src = read(INVOICES);
    expect(src).toContain('pm-filter-chip');
    expect(src).toContain(
      '<PaymentMethodIcon method={method} size={28} />',
    );
    const css = read(STYLES);
    expect(css).toContain('.pm-filter-chip {');
    expect(css).toContain('.ih-method-badge {');
  });
});

describe('v74 — ③ الإصدار', () => {
  test('77.0.0 (21) — محدّث للجولة 81', () => {
    const src = read(CONFIG);
    expect(src).toContain("APP_VERSION = '77.0.0'");
    expect(src).toContain('APP_BUILD_CODE = 21');
  });
});
