/**
 * v85-round91.test.ts — الجولة 91 لسطح المكتب: ملاحظات التاجر الأربع
 * (مطابقة أندرويد v78.0.0).
 * ─────────────────────────────────────────────────────────────────
 *   ١ ترتيب الأحجام والوحدات تصاعدياً بالسعر — الأقل في الأعلى
 *     («من الاقل في الأعلي الي الاكبر») في نافذة البيع ونموذج
 *     المنتج.
 *   ٢ ميزة حسابات التجار: دفتر ذمم دائنة كامل (سجل + حركات موحد +
 *     كشف حساب لكل تاجر + سداد/تحصيل عبر القنوات بسندات خزينة +
 *     تقارير + نسخ احتياطي + إدخال في القائمة الجانبية).
 *   ٣ الهوية الاختيارية في دفتر الديون (إضافة/تعديل زبون) —
 *     الفارغ يُخزن NULL بعد ترحيل يسقط NOT NULL.
 *   ٤ لا إشعارات نفاد للمنتجات بلا تتبع — تنظيف الإشعارات
 *     التاريخية العالقة.
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const POS = 'src/screens/PosScreen.tsx';
const FORM = 'src/screens/ProductFormModal.tsx';
const DEBTS = 'src/screens/LocalDebtsScreen.tsx';
const DEBTS_REPO = 'src/database/repositories/LocalDebtsRepo.ts';
const CONNECTION_RUST = 'crates/sela-core/src/db.rs';
const MERCHANT_REPO = 'src/database/repositories/MerchantRepo.ts';
const MERCHANT_SCREEN = 'src/screens/MerchantsScreen.tsx';
const MERCHANT_CSS = 'src/screens/merchants.css';
const APP = 'src/app.tsx';
const REPORTS = 'src/screens/ReportsScreen.tsx';
const BACKUP = 'src/services/BackupService.ts';
const CASH = 'src/services/CashService.ts';
const ALERTS = 'src/services/StockAlertsService.ts';
const NOTIF = 'src/stores/notificationsStore.ts';
const CONFIG = 'src/core/config.ts';

describe('v85 — ① ترتيب الأحجام والوحدات تصاعدياً بالسعر', () => {
  test('نافذة البيع: الأحجام مفروزة بالسعر الفعلي (الأقل أولاً)', () => {
    const src = read(POS);
    expect(src).toContain(
      '[...variants]\n        .filter(v => v.kind === \'size\')\n        .sort(',
    );
    expect(src).toContain(
      '(a.retail_price ?? product.retail_price) -\n              (b.retail_price ?? product.retail_price) || a.id - b.id',
    );
  });

  test('نموذج المنتج: الوحدات والأحجام تُحمّل مرتبة بالسعر', () => {
    const src = read(FORM);
    expect(src).toContain(
      '(a.retail_price ?? loaded.retail_price * a.conversion) -\n                  (b.retail_price ?? loaded.retail_price * b.conversion)',
    );
    expect(src).toContain(
      '(a.retail_price ?? loaded.retail_price) -\n                      (b.retail_price ?? loaded.retail_price) || a.id - b.id',
    );
  });
});

describe('v85 — ② ميزة حسابات التجار', () => {
  test('نواة Rust: الجدولان بالفهارس + إدخال المسح الكامل', () => {
    const src = read(CONNECTION_RUST);
    expect(src).toContain('CREATE TABLE IF NOT EXISTS merchants');
    expect(src).toContain('CREATE TABLE IF NOT EXISTS merchant_movements');
    expect(src).toContain(
      "kind TEXT NOT NULL CHECK (kind IN ('invoice','payment','return','collection','debt'))",
    );
    expect(src).toContain('idx_merchant_moves');
    expect(src).toMatch(/"merchant_movements",\s*\n\s*"merchants",/);
  });

  test('المستودع: المعادلة والمراجع والحذف المحروس والكشف الجاري', () => {
    const src = read(MERCHANT_REPO);
    expect(src).toContain('invoiceTotal +');
    expect(src).toContain('debtTotal -');
    expect(src).toContain("invoice: 'توريد'");
    expect(src).toContain('لا يمكن حذف التاجر');
    expect(src).toContain('runningBalance');
    expect(src).toContain('topOwed');
  });

  test('الشاشة: كشف حساب + فاتورة توريد + سداد عبر القنوات', () => {
    const src = read(MERCHANT_SCREEN);
    expect(src).toContain('التجار والموردون');
    expect(src).toContain('كشف حساب');
    expect(src).toContain('فاتورة توريد');
    expect(src).toContain('مرتجع / خصم');
    expect(src).toContain('تحصيل منه');
    expect(src).toContain('CashService.recordExpense');
    expect(src).toContain('CashService.recordDeposit');
    expect(src).toContain('سداد لتاجر');
    expect(src).toContain('تحصيل من تاجر');
    expect(read(MERCHANT_CSS)).toContain('.mer-balance');
  });

  test('الإدخال في القائمة الجانبية + قسم التقارير', () => {
    const app = read(APP);
    expect(app).toContain(
      "import {MerchantsScreen} from './screens/MerchantsScreen';",
    );
    expect(app).toContain(
      "{key: 'merchants', label: 'التجار', icon: 'store'}",
    );
    expect(app).toMatch(
      /\{screen === 'merchants' && \(\s*\n\s*<ErrorBoundary label="التجار والموردون">/,
    );
    const reports = read(REPORTS);
    expect(reports).toContain('حسابات التجار');
    expect(reports).toContain('مستحق للتجار الآن');
    expect(reports).toContain('MerchantRepo.totals');
  });

  test('الخزينة: فئة «سداد لتاجر» + فئة إيداع اختيارية', () => {
    const src = read(CASH);
    expect(src).toContain("'سداد لتاجر',");
    expect(src).toContain('category?: string | null;');
    expect(src).toContain("input.category?.trim() || 'إيداع نقدي'");
  });

  test('النسخ الاحتياطي: تصدير واستعادة الجدولين بإعادة ربط المعرّفات', () => {
    const src = read(BACKUP);
    expect(src).toContain('merchants?: {');
    expect(src).toContain('merchant_movements?: {');
    expect(src).toContain('FROM merchants`');
    expect(src).toContain('const merchantMap = new Map<number, number>();');
    expect(src).toContain(
      "DELETE FROM sqlite_sequence WHERE name IN ('local_customers','local_debts','local_payments','merchants','merchant_movements')",
    );
  });
});

describe('v85 — ③ الهوية الاختيارية في دفتر الديون', () => {
  test('الشاشة: الفارغ مقبول والتسمية «اختياري»', () => {
    const src = read(DEBTS);
    expect(src).toContain('id.length > 0 && !isValidIdNumber(id)');
    expect(src).toContain('رقم الهوية (اختياري — 9 أرقام)');
    expect(src).toContain('بلا رقم هوية');
  });

  test('المستودع: الفارغ يُخزن NULL والإنشاء بالمعرف', () => {
    const src = read(DEBTS_REPO);
    expect(src).toContain('idNumber.length > 0 && !ID_NUMBER_RE.test(idNumber)');
    expect(src).toContain('idNumber.length > 0 ? idNumber : null');
    expect(src).toContain('await this.byId(');
  });

  test('الترحيل: إسقاط NOT NULL عن عمود الهوية (DDL + heal_v85)', () => {
    const src = read(CONNECTION_RUST);
    // التثبيتات الجديدة: العمود اختياري من اليوم الأول.
    expect(src).toContain('id_number TEXT UNIQUE,');
    expect(src).not.toContain('id_number TEXT NOT NULL UNIQUE,');
    // الترقية من تثبيتات أقدم: إعادة بناء بالمسار الرسمي.
    expect(src).toContain('fn heal_v85');
    expect(src).toContain('CREATE TABLE local_customers_v85');
    expect(src).toContain(
      'ALTER TABLE local_customers_v85 RENAME TO local_customers',
    );
    expect(src).toContain('PRAGMA foreign_keys = OFF');
    expect(src).toContain('heal_v85(conn)?;');
  });
});

describe('v85 — ④ لا إشعارات نفاد للمنتجات بلا تتبع', () => {
  test('الاستبعاد (v35) ما زال محروساً + تنظيف الإشعارات العالقة', () => {
    const alerts = read(ALERTS);
    expect(alerts).toContain('dropStockAlertsFor(untrackedIds)');
    expect(alerts).toContain('const untrackedIds = new Set<number>();');
    const notif = read(NOTIF);
    expect(notif).toContain('dropStockAlertsFor');
    expect(notif).toContain(
      "item.kind === 'out_of_stock' || item.kind === 'low_stock'",
    );
  });
});

describe('v85 — الإصدار', () => {
  test('config عند 87.0.0 / 31', () => {
    const src = read(CONFIG);
    expect(src).toContain("APP_VERSION = '87.0.0'");
    expect(src).toContain('APP_BUILD_CODE = 31');
  });
});
