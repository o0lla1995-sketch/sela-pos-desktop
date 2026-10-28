/**
 * v74-round78.test.ts — الجولة 78: ملاحظات التاجر على سطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 *  ① أيقونات البنوك والمحافظ كبيرة ومرئية — كانت «صغيرة جدا ولا
 *     تكاد تري بالعين المجردة» بطلب التاجر نصاً: الرئيسية 30→46،
 *     التقارير 22→32 و26→34، الفواتير (التسوية) 22→26، الإعدادات
 *     38→46.
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
  test('الرئيسية: شعار القنوات 46px داخل رقاقة أوسع', () => {
    const src = read(HOME);
    expect(src).toContain('size={46}');
    expect(src).not.toContain('size={30}');
    const css = read(CHANNELS_CSS);
    expect(css).toContain('min-width: 186px');
  });

  test('التقارير: شعارات أرصدة القنوات 32px وسجل القناة 34px', () => {
    const src = read(REPORTS);
    expect(src).toContain('<PaymentMethodIcon method={method} size={32} />');
    expect(src).toContain('size={34}');
    expect(src).not.toContain('<PaymentMethodIcon method={method} size={22} />');
  });

  test('الإعدادات: بطاقات التفعيل بشعار 46px', () => {
    const src = read(SETTINGS);
    expect(src).toContain('<PaymentMethodIcon method={method} size={46} />');
  });

  test('فواتير المرتجع: رقائق التسوية بشعار 26px', () => {
    const src = read(INVOICES);
    expect(src).toContain('<PaymentMethodIcon method={channel} size={26} />');
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

  test('رقائق فلترة طريقة الدفع تحمل الشعار الرسمي', () => {
    const src = read(INVOICES);
    expect(src).toContain('pm-filter-chip');
    expect(src).toContain(
      '<PaymentMethodIcon method={method} size={22} />',
    );
    const css = read(STYLES);
    expect(css).toContain('.pm-filter-chip {');
    expect(css).toContain('.ih-method-badge {');
  });
});

describe('v74 — ③ الإصدار', () => {
  test('74.0.0 (18)', () => {
    const src = read(CONFIG);
    expect(src).toContain("APP_VERSION = '74.0.0'");
    expect(src).toContain('APP_BUILD_CODE = 18');
  });
});
