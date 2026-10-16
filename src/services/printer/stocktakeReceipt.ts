/**
 * stocktakeReceipt — v60 (الجولة 25 #5): الوصل الحراري لتقرير جلسة
 * الجرد — نفس لغة تصميم سندات المصروف والمرتجعات: ترويسة المتجر،
 * صندوق عنوان بارز، ملخص الجلسة (صفوف/معدود/مطابق/نقص/زيادة)، ثم
 * جدول الأصناف بفروقاتها الرقمية، والتذييل. يصلح للجلسات المنتهية
 * وللتقرير المرحلي للجلسة النشطة على حد سواء.
 */
import {ReceiptBuilder} from './escpos';
import type {ReceiptSettings} from './receipt';
import {RECEIPT_WIDTH_58, RECEIPT_WIDTH_80} from '../../core/config';
import type {
  Stocktake,
  StocktakeItem,
  StocktakeSummary,
} from '../../core/types';

/** ASCII-only labels (bidi-safe) — نفس نهج سندات المصروف. */
const L = {
  reportTitle: 'Stocktake Report',
  reportTitleAr: 'تقرير جلسة الجرد',
  session: 'Session',
  started: 'Started',
  finished: 'Finished',
  live: 'LIVE (interim)',
  rows: 'Rows',
  counted: 'Counted',
  matched: 'Matched',
  shortage: 'Shortage',
  surplus: 'Surplus',
  sysTotal: 'System total',
  cntTotal: 'Counted total',
  netVariance: 'Net variance',
  itemsTitle: 'Items / variances',
  notCounted: 'not counted',
  footer: '--- end of report ---',
};

export interface StocktakeReportReceiptData {
  session: Stocktake;
  items: StocktakeItem[];
  summary: StocktakeSummary;
  /** v60: true = تقرير مرحلي لجلسة ما تزال مفتوحة. */
  interim?: boolean;
}

/** تنسيق كمية موجزة للطابعة — أرقام لاتينية فقط. */
function qty(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function buildStocktakeReportJob(
  data: StocktakeReportReceiptData,
  settings: ReceiptSettings,
) {
  const width =
    settings.paperWidth === '58' ? RECEIPT_WIDTH_58 : RECEIPT_WIDTH_80;
  const rasterWidth = settings.paperWidth === '58' ? 384 : 576;
  const b = ReceiptBuilder.create();
  const {session, items, summary} = data;

  // ── Optional store logo ──
  if (settings.storeLogoPath) {
    b.image(settings.storeLogoPath, rasterWidth).feed(1);
  }

  // ── Header ──
  b.codepage(settings.codepage)
    .align(1)
    .bold(true)
    .size(1, 1)
    .textLine(settings.storeName || 'sela')
    .size(0, 0)
    .bold(false);
  if (settings.storePhone.trim()) {
    b.align(1).textLine(`Tel: ${settings.storePhone.trim()}`);
  }

  // ── Title box ──
  b.align(2)
    .separator(width)
    .bold(true)
    .size(1, 1)
    .align(1)
    .textLine(L.reportTitleAr)
    .size(0, 0)
    .bold(false)
    .align(2)
    .textLine(`${L.session}: #${session.id}${data.interim ? ` (${L.live})` : ''}`)
    .textLine(`${L.started}: ${session.started_at}`);
  if (session.completed_at) {
    b.textLine(`${L.finished}: ${session.completed_at}`);
  }
  b.separator(width);

  // ── Summary block ──
  b.align(2)
    .bold(true)
    .textLine(`${L.rows}: ${summary.totalItems}`)
    .textLine(`${L.counted}: ${summary.countedItems}`)
    .bold(false)
    .textLine(`${L.matched}: ${summary.matchedItems}`)
    .textLine(`${L.shortage}: ${summary.shortageItems}`)
    .textLine(`${L.surplus}: ${summary.surplusItems}`)
    .separator(width)
    .textLine(`${L.sysTotal}: ${qty(summary.totalSystem)}`)
    .textLine(`${L.cntTotal}: ${qty(summary.totalCounted)}`)
    .bold(true)
    .textLine(
      `${L.netVariance}: ${
        summary.totalCounted - summary.totalSystem >= 0 ? '+' : ''
      }${qty(summary.totalCounted - summary.totalSystem)}`,
    )
    .bold(false)
    .separator(width);

  // ── Items with variances (skip untouched matches to save paper) ──
  const rows = items.filter(item => {
    if (item.counted_qty == null) {
      return true; // أظهر غير المعدود — قد يشير لسهو
    }
    return Math.abs(item.counted_qty - item.system_qty) >= 0.0005;
  });
  b.align(2).bold(true).textLine(L.itemsTitle).bold(false);
  if (rows.length === 0) {
    b.textLine(`${L.matched} - all ${L.counted.toLowerCase()}`);
  }
  for (const item of rows) {
    const label =
      item.variantLabel != null
        ? `${item.productName} (${item.variantLabel})`
        : item.productName;
    b.truncate(label, width);
    if (item.counted_qty == null) {
      b.align(2).textLine(`  ${L.notCounted}`);
    } else {
      const variance = item.counted_qty - item.system_qty;
      const sign = variance > 0 ? '+' : '';
      b.align(2).textLine(
        `  ${qty(item.system_qty)} >> ${qty(item.counted_qty)} (${sign}${qty(variance)})`,
      );
    }
  }

  b.separator(width)
    .align(1)
    .bold(true)
    .textLine(settings.footerMessage || L.footer)
    .bold(false)
    .feed(2)
    .cut();
  return b.build();
}
