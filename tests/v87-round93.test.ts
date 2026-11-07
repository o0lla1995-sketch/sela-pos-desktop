/**
 * v87-round93.test.ts — الجولة 93 (نقطة البيع سطح المكتب): مطابقة
 * أندرويد v80 — حرّوس إصلاحات التاجر الثلاثة ضد الانحدار:
 *
 *  ① لا ازدواج في أرصدة القنوات — أرقام «النقد» نقية من مبيعات
 *     ومقبوضات البنوك والمحافظ، وللقنوات سطرها المعلوماتي الخاص
 *     (شكوى التاجر: «يتم اضافة الرصيد بشكل مزدوج في النقدي والبنك»).
 *  ② كشوف التجار PDF قابل للطباعة فقط — CSV أُلغي («لغيهما»).
 *  ③ نافذة التاجر أُعيد تنظيمها (لا أزرار متراكبة).
 *  ④ عمليات التجار المختصرة في تبويب الملخص + تقرير الفترة الشامل.
 *  ⑤ قناة تسوية المرتجع تتخلف عن القناة الأصلية للفاتورة.
 *  ⑥ مسامير الإصدار 87.0.0 / 31.
 */
import {readFileSync} from 'fs';
import {join} from 'path';
import {describe, test, expect} from 'vitest';

const R = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('v87 (الجولة 93) — النقد بلا ازدواج مع القنوات', () => {
  test('ReportRepo: نطاق القنوات غير النقدية بفترة التقرير', () => {
    expect(R('src/database/repositories/ReportRepo.ts')).toContain(
      'async nonCashInRange(',
    );
    const service = R('src/services/ReportService.ts');
    expect(service).toContain('ReportRepo.nonCashInRange(range)');
    expect(service).toContain('nonCashRange.salesNetMinor / 100;');
    expect(service).toContain('nonCashRange.repaymentsMinor) /');
  });

  test('CashRepo: إجماليات مفصولة نقدي/قنوات', () => {
    const repo = R('src/database/repositories/CashRepo.ts');
    expect(repo).toContain('async totalsForSplit(');
    expect(repo).toContain(
      "GROUP BY COALESCE(payment_method, 'cash'), kind",
    );
    const service = R('src/services/ReportService.ts');
    expect(service).toContain(
      'CashRepo.totalsForSplit(range.from, range.to)',
    );
    expect(service).toContain(
      'cashMovementsSplit.cash.expensesMinor / 100',
    );
  });

  test('الخزينة اللحظية تعرض المبالغ المفصولة (شفافية بلا ازدواج)', () => {
    const service = R('src/services/ReportService.ts');
    expect(service).toContain('nonCashSalesAllTime: number;');
    expect(service).toContain('nonCashRepaymentsAllTime: number;');
    expect(service).toContain(
      'nonCashSalesAllTime: nonCashExclusions.salesNetMinor / 100',
    );
  });

  test('التقارير: بطل نقدي صافٍ + سطر معلوماتي للقنوات', () => {
    const reports = R('src/screens/ReportsScreen.tsx');
    expect(reports).toContain('النقد المحصّل بالدرج بالفترة');
    expect(reports).toContain('صافي حركة الدرج النقدي بالفترة');
    expect(reports).toContain(
      'عبر البنوك والمحافظ (أرصدتها في بطاقة القنوات)',
    );
  });
});

describe('v87 (الجولة 93) — كشوف التجار PDF فقط', () => {
  test('MerchantExports: PDF والكشف، ولا CSV', () => {
    const exports = R('src/services/MerchantExports.ts');
    expect(exports).toContain('async exportStatementPdf(');
    expect(exports).toContain('async exportBookPdf(');
    expect(exports).not.toContain('async exportStatementCsv(');
    expect(exports).not.toContain('async exportBookCsv(');
  });

  test('أزرار PDF بنافذة التاجر — لا أزرار CSV', () => {
    const screen = R('src/screens/MerchantsScreen.tsx');
    expect(screen).toContain('كشف حساب PDF قابل للطباعة');
    expect(screen).toContain('تنزيل دفتر التجار PDF');
    expect(screen).not.toContain('دفتر CSV');
    expect(screen).not.toContain('كشف CSV');
  });
});

describe('v87 (الجولة 93) — نافذة التاجر المحسّنة', () => {
  test('الهرمية: فاتورة بحجم كامل + شبكة + إدارة هامشية', () => {
    const screen = R('src/screens/MerchantsScreen.tsx');
    expect(screen).toContain('فاتورة توريد جديدة');
    expect(screen).toContain('mer-actions grid');
    expect(screen).toContain('mer-actions admin');
    const css = R('src/screens/merchants.css');
    expect(css).toContain('grid-template-columns: 1fr 1fr');
    expect(css).toContain('.btn.wide');
    expect(css).toContain('.btn.link');
  });
});

describe('v87 (الجولة 93) — عمليات التجار في التقارير + تقرير شامل', () => {
  test('بطاقة ملخص التجار في تبويب الملخص', () => {
    const reports = R('src/screens/ReportsScreen.tsx');
    expect(reports).toContain('عمليات التجار — ملخص مختصر');
    expect(reports).toContain('أكبر المستحقات:');
  });

  test('PeriodReportPdf: أقسام شاملة تشمل التجار + زر التقرير', () => {
    const service = R('src/services/PeriodReportPdf.ts');
    expect(service).toContain('exportPeriodReportPdf');
    expect(service).toContain('عمليات التجار — ملخص مختصر');
    expect(service).toContain('buildPeriodPayload');
    const reports = R('src/screens/ReportsScreen.tsx');
    expect(reports).toContain('إنشاء تقرير PDF شامل للفترة');
    expect(reports).toContain('openPeriodPdf');
  });
});

describe('v87 (الجولة 93) — قناة تسوية المرتجع الأصلية', () => {
  test('نافذة الإرجاع تتخلف عن قناة الفاتورة الأصلية', () => {
    const invoices = R('src/screens/InvoicesScreen.tsx');
    expect(invoices).toContain('setSettleMethodId(prep.sale.payment_method)');
    expect(invoices).toContain("prep.book === 'cash'");
  });
});

describe('v87 — الإصدار', () => {
  test('config.ts عند 87.0.0 / 31', () => {
    const src = R('src/core/config.ts');
    expect(src).toContain("APP_VERSION = '87.0.0'");
    expect(src).toContain('APP_BUILD_CODE = 31');
  });

  test('package.json وtauri وCargo متطابقة', () => {
    expect(R('package.json')).toContain('"version": "87.0.0"');
    expect(R('src-tauri/tauri.conf.json')).toContain('"version": "87.0.0"');
    expect(R('src-tauri/Cargo.toml')).toContain('version = "87.0.0"');
    expect(R('Cargo.lock')).toContain(
      'name = "sela-pos-desktop"\nversion = "87.0.0"',
    );
  });
});
