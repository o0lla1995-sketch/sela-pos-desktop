/**
 * cashierReportReceipt — v59 (الجولة 63): تقرير الكاشير الحراري.
 * ─────────────────────────────────────────────────────────────────
 * ملخص فترة زمنية لحساب كاشير واحد (طلب التاجر): مطبوع وسهل
 * القراءة — إجماليات المبيعات والدفع والمرتجعات، أهم المنتجات، ثم
 * سجل الفواتير. نفس لغة تصميم وصل الجرد (ترويسة المتجر، صندوق
 * عنوان بارز، صفوف ASCII ثنائية الأعمدة للمنطقة المالية).
 */
import {ReceiptBuilder} from './escpos';
import type {ReceiptSettings} from './receipt';
import {RECEIPT_WIDTH_58, RECEIPT_WIDTH_80} from '../../core/config';
import type {CashierDetailedReport} from '../../database/repositories/CashiersRepo';

/** ASCII-only labels (bidi-safe) — نفس نهج وصل الجرد. */
const L = {
  reportTitle: 'Cashier Report',
  reportTitleAr: 'تقرير الكاشير التفصيلي',
  cashier: 'Cashier',
  period: 'Period',
  all: 'All Time',
  invoices: 'Invoices',
  cash: 'Cash',
  debt: 'Debt Book',
  returns: 'Returns',
  discount: 'Discounts',
  net: 'NET',
  topTitle: 'Top Products',
  ledgerTitle: 'Invoice Ledger',
  footer: '--- end of report ---',
};

export interface CashierReportReceiptData {
  report: CashierDetailedReport;
  cashierName: string;
}

export function buildCashierReportJob(
  data: CashierReportReceiptData,
  settings: ReceiptSettings,
) {
  const {report} = data;
  const width =
    settings.paperWidth === '58' ? RECEIPT_WIDTH_58 : RECEIPT_WIDTH_80;
  const b = ReceiptBuilder.create();

  // ── الترويسة ──
  b.codepage(settings.codepage)
    .align(1)
    .bold(true)
    .size(1, 1)
    .textLine(settings.storeName || 'sela')
    .size(0, 0)
    .bold(false)
    .align(1)
    .textLine(L.reportTitle)
    .align(2)
    .separator(width)
    .bold(true)
    .textLine(data.cashierName)
    .bold(false)
    .textLine(
      `${L.period}: ${
        report.from && report.to ? `${report.from} ~ ${report.to}` : L.all
      }`,
    )
    .separator(width);

  // ── الإجماليات ──
  b.align(2)
    .twoColumns(L.invoices, report.salesCount, width)
    .twoColumns(L.cash, report.cashTotal, width)
    .twoColumns(L.debt, report.debtTotal, width)
    .twoColumns(L.returns, report.returnsTotal, width)
    .twoColumns(L.discount, report.discountTotal, width)
    .bold(true)
    .size(1, 1)
    .twoColumns(L.net, report.netTotal, Math.max(width - 4, 16))
    .size(0, 0)
    .bold(false)
    .separator(width);

  // ── أهم المنتجات ──
  if (report.topProducts.length > 0) {
    b.align(1).bold(true).textLine(L.topTitle).bold(false).align(2);
    for (const product of report.topProducts.slice(0, 10)) {
      b.truncate(product.name, width);
      b.textLine(`${product.qty.toFixed(2)} x = ${product.total.toFixed(2)}`);
    }
    b.separator(width);
  }

  // ── سجل الفواتير (آخر 40) ──
  if (report.invoices.length > 0) {
    b.align(1).bold(true).textLine(L.ledgerTitle).bold(false).align(2);
    for (const invoice of report.invoices.slice(0, 40)) {
      const mark =
        invoice.kind === 'return'
          ? 'RET'
          : invoice.kind === 'debt'
          ? 'DEBT'
          : 'CASH';
      b.textLine(`${invoice.number} [${mark}]`);
      b.textLine(`${invoice.createdAt.slice(0, 16)}  ${invoice.total.toFixed(2)}`);
    }
  }

  b.separator(width).align(1).textLine(L.footer).feed(2).cut();
  return b.build();
}
