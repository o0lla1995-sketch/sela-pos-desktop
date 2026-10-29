/**
 * InventoryReportPdf — v76 (الجولة 80 #٢): تقرير المخزون التفصيلي
 * كملف PDF مرتب ومفصل.
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر نصاً: «إضافة زر في صفحة المخزون يمكن من خلاله طباعة
 * تقرير pdf بكافة المنتجات بالمخزون بالتفصيل وبشكل مرتب ومفصل».
 *
 * الهندسة (نفس نمط InvoicesReportPdf المجرب — v71 الجولة 75 #7):
 *  ① كل صفحة A4 تُرسم على Canvas بدقة 150DPI — محرك المتصفح يشكّل
 *     العربية (RTL + ربط الحروف) بنفسه فلا حاجة لأي مكتبة تشكيل.
 *  ② كاتب PDF 1.4 الخالص المشترك (pdfWriter v72) — كل صفحة صورة
 *     RGB مضغوطة FlateDecode يفتحها أي قارئ/طابعة.
 *  ③ التقرير: ترويسة المتجر + بطاقات القيمة الإجمالية (تكلفة/بيع/
 *     عدد/كمية مفتوحة) + جدول المنتجات مجمّعاً بالتصنيف مع صفوف
 *     مجاميع لكل تصنيف وحالة ملونة للمخزون (نفد/منخفض/جيد/مفتوح)
 *     + صف الإجمالي الكبير + ترقيم صفحات.
 */

import {formatDateTime} from '../core/format';
import {
  buildImagePagesPdf,
  deflateCanvasPage,
  ensureFontsReady,
} from './pdfWriter';

/** صف منتج واحد داخل التقرير. */
export interface InventoryReportRow {
  name: string;
  /** '' = بلا باركود. */
  barcode: string;
  /** «بلا تصنيف» حين لا ينتمي لاحد. */
  category: string;
  costPrice: number;
  quantity: number;
  /** تسمية الوحدة الأساسية (قطعة/كغ…). */
  unitLabel: string;
  untracked: boolean;
  stockState: 'out' | 'low' | 'ok' | 'untracked';
}

export interface InventoryReportPayload {
  storeName: string;
  /** وصف الفلاتر المطبقة للعرض في الترويسة. */
  filtersLabel: string;
  rows: InventoryReportRow[];
}

/* ── ثوابت الصفحة: A4 بدقة 150DPI ── */
const DPI = 150;
const MM_PX = DPI / 25.4;
const PAGE_W_PX = Math.round(210 * MM_PX); // 1240
const PAGE_H_PX = Math.round(297 * MM_PX); // 1754
const PAGE_W_PT = 595.28;
const PAGE_H_PT = 841.89;
const MARGIN = Math.round(12 * MM_PX); // ~71px
const BRAND = '#EA580C';
const INK = '#1F2937';
const INK_SOFT = '#6B7280';
const LINE = '#E5E7EB';
const ROW_BG = '#F8F9FB';
const DANGER = '#DC2626';
const WARN = '#B45309';
const OK_GREEN = '#16A34A';

const FONT = 'Tajawal, "Segoe UI", sans-serif';

/* أعمدة الجدول — من اليمين لليسار (RTL). */
const COLS: {key: string; width: number}[] = [
  {key: 'name', width: 300},
  {key: 'barcode', width: 150},
  {key: 'category', width: 130},
  {key: 'cost', width: 110},
  {key: 'qty', width: 150},
  {key: 'state', width: 100},
  {key: 'value', width: 158},
];
const TABLE_W = COLS.reduce((sum, c) => sum + c.width, 0);

interface RenderedPage {
  canvas: HTMLCanvasElement;
}

function newPage(): RenderedPage {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W_PX;
  canvas.height = PAGE_H_PX;
  const ctx = canvas.getContext('2d');
  if (ctx == null) {
    throw new Error('تعذر تهيئة محرك الرسم');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAGE_W_PX, PAGE_H_PX);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  return {canvas};
}

/** رسم النص بمحاذاة يمين عند x. */
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  cy: number,
  font: string,
  color: string,
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.fillText(value, x, cy);
}

const STATE_LABELS: Record<InventoryReportRow['stockState'], string> = {
  out: 'نفد',
  low: 'منخفض',
  ok: 'جيد',
  untracked: 'مفتوح',
};
const STATE_COLORS: Record<InventoryReportRow['stockState'], string> = {
  out: DANGER,
  low: WARN,
  ok: OK_GREEN,
  untracked: INK_SOFT,
};

function formatQtyCell(row: InventoryReportRow): string {
  if (row.untracked) {
    return 'كمية مفتوحة';
  }
  const qty =
    Number.isInteger(row.quantity) || Math.abs(row.quantity) >= 100
      ? String(Math.round(row.quantity))
      : row.quantity.toFixed(2).replace(/\.?0+$/, '');
  return `${qty} ${row.unitLabel}`;
}

/** رسم تقرير كامل وإرجاع صفحاته. */
function renderPages(payload: InventoryReportPayload): HTMLCanvasElement[] {
  const pages: HTMLCanvasElement[] = [];
  const rows = payload.rows;

  // التجميع بالتصنيف — بنفس ترتيب الظهور الأول.
  const groups: {name: string; rows: InventoryReportRow[]}[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last != null && last.name === row.category) {
      last.rows.push(row);
    } else {
      groups.push({name: row.category, rows: [row]});
    }
  }

  // الملخص المالي — متتبع فقط، والمفتوح يُعد منفصلاً.
  const summary = rows.reduce(
    (acc, row) => {
      acc.count += 1;
      if (row.untracked) {
        acc.untracked += 1;
        return acc;
      }
      acc.tracked += 1;
      const qty = Math.max(0, row.quantity);
      acc.costValue += row.costPrice * qty;
      return acc;
    },
    {count: 0, tracked: 0, untracked: 0, costValue: 0},
  );
  const costValue = Math.round(summary.costValue * 100) / 100;

  /* ── الصفحة الأولى: الترويسة + الملخص + الجدول ── */
  let page = newPage();
  let ctx = page.canvas.getContext('2d') as CanvasRenderingContext2D;
  pages.push(page.canvas);
  let y = MARGIN;

  // شريط العلامة العلوي
  ctx.fillStyle = BRAND;
  ctx.fillRect(MARGIN, y, TABLE_W, 6);
  y += 24;

  // اسم المتجر + عنوان التقرير
  text(ctx, payload.storeName, MARGIN + TABLE_W, y + 18, `800 30px ${FONT}`, INK);
  text(ctx, 'تقرير المخزون التفصيلي', MARGIN + TABLE_W, y + 56, `700 20px ${FONT}`, BRAND);
  text(
    ctx,
    payload.filtersLabel,
    MARGIN + TABLE_W,
    y + 86,
    `500 15px ${FONT}`,
    INK_SOFT,
  );
  const generatedAt = formatDateTime(new Date().toISOString());
  text(
    ctx,
    `صدر بتاريخ ${generatedAt}`,
    MARGIN + TABLE_W,
    y + 110,
    `500 13px ${FONT}`,
    INK_SOFT,
  );
  y += 140;

  // بطاقات الملخص (4) — قيمة البضاعة هي البطاقة الأولى دائماً.
  const cards: {label: string; value: string; color: string}[] = [
    {label: 'قيمة البضاعة (تكلفة)', value: costValue.toFixed(2), color: INK},
    {label: 'عدد المنتجات', value: String(summary.count), color: INK},
    {
      label: 'متتبع الكمية',
      value: String(summary.tracked),
      color: OK_GREEN,
    },
    {
      label: 'كمية مفتوحة (بلا قيمة)',
      value: String(summary.untracked),
      color: WARN,
    },
  ];
  const cardGap = 14;
  const cardW = (TABLE_W - cardGap * (cards.length - 1)) / cards.length;
  cards.forEach((card, i) => {
    const x = MARGIN + TABLE_W - i * (cardW + cardGap); // RTL
    ctx.fillStyle = '#FBF7F2';
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - cardW, y, cardW, 64, 10);
    ctx.fill();
    ctx.stroke();
    text(ctx, card.label, x - 14, y + 20, `700 13px ${FONT}`, INK_SOFT);
    text(ctx, card.value, x - 14, y + 44, `800 20px ${FONT}`, card.color);
  });
  y += 64 + 22;

  // عنوان الجدول
  text(
    ctx,
    `المنتجات مجمّعة بالتصنيف (${groups.length} تصنيفاً)`,
    MARGIN + TABLE_W,
    y + 10,
    `800 15px ${FONT}`,
    INK,
  );
  y += 26;

  const rowH = 40;
  const groupH = 42;
  const headerH = 38;
  const tableBottom = PAGE_H_PX - MARGIN - 30;

  const drawTableHeader = (top: number): number => {
    ctx.fillStyle = '#F3F4F6';
    ctx.fillRect(MARGIN, top, TABLE_W, headerH);
    ctx.strokeStyle = LINE;
    ctx.strokeRect(MARGIN, top, TABLE_W, headerH);
    let x = MARGIN + TABLE_W;
    const labels: Record<string, string> = {
      name: 'المنتج',
      barcode: 'الباركود',
      category: 'التصنيف',
      cost: 'التكلفة',
      qty: 'الكمية',
      state: 'الحالة',
      value: 'القيمة (تكلفة × كمية)',
    };
    for (const col of COLS) {
      text(ctx, labels[col.key], x - 12, top + headerH / 2, `800 13px ${FONT}`, INK);
      x -= col.width;
    }
    return top + headerH;
  };

  let pageNo = 1;

  const drawPageFooter = () => {
    text(
      ctx,
      `${payload.storeName} — تقرير المخزون · صفحة ${pageNo}`,
      MARGIN + TABLE_W,
      PAGE_H_PX - MARGIN + 6,
      `500 12px ${FONT}`,
      INK_SOFT,
    );
    text(
      ctx,
      'أُنشئ بواسطة سيلا',
      MARGIN,
      PAGE_H_PX - MARGIN + 6,
      `500 12px ${FONT}`,
      INK_SOFT,
    );
  };

  const newTablePage = () => {
    drawPageFooter();
    page = newPage();
    ctx = page.canvas.getContext('2d') as CanvasRenderingContext2D;
    pages.push(page.canvas);
    pageNo += 1;
    y = MARGIN;
    // ترويسة استمرار
    text(
      ctx,
      `${payload.storeName} — تقرير المخزون (تابع)`,
      MARGIN + TABLE_W,
      y + 10,
      `800 15px ${FONT}`,
      INK,
    );
    y += 30;
    y = drawTableHeader(y);
  };

  let tableY = drawTableHeader(y);
  let zebra = false;

  for (const group of groups) {
    // صف عنوان التصنيف — لا يُيتم وحيداً أسفل الصفحة (يحجز صفه
    // + أول منتج بعده).
    if (tableY + groupH + rowH > tableBottom) {
      newTablePage();
      zebra = false;
    }
    const groupTrackedValue = group.rows.reduce(
      (sum, r) =>
        r.untracked ? sum : sum + r.costPrice * Math.max(0, r.quantity),
      0,
    );
    const groupTrackedCount = group.rows.filter(r => !r.untracked).length;
    ctx.fillStyle = '#F0F7FF';
    ctx.fillRect(MARGIN, tableY, TABLE_W, groupH);
    ctx.strokeStyle = '#BFDBFE';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, tableY + groupH);
    ctx.lineTo(MARGIN + TABLE_W, tableY + groupH);
    ctx.stroke();
    text(
      ctx,
      group.name,
      MARGIN + TABLE_W - 12,
      tableY + groupH / 2,
      `800 14px ${FONT}`,
      '#1D4ED8',
    );
    text(
      ctx,
      `${group.rows.length} منتج` +
        (groupTrackedCount !== group.rows.length
          ? ` · ${group.rows.length - groupTrackedCount} كمية مفتوحة`
          : ''),
      MARGIN + TABLE_W - 320,
      tableY + groupH / 2,
      `600 12.5px ${FONT}`,
      INK_SOFT,
    );
    text(
      ctx,
      `قيمة التصنيف: ${(Math.round(groupTrackedValue * 100) / 100).toFixed(2)}`,
      MARGIN + 12,
      tableY + groupH / 2,
      `800 13.5px ${FONT}`,
      '#1D4ED8',
    );
    tableY += groupH;
    zebra = false;

    for (const row of group.rows) {
      if (tableY + rowH > tableBottom) {
        newTablePage();
        zebra = false;
      }
      if (zebra) {
        ctx.fillStyle = ROW_BG;
        ctx.fillRect(MARGIN, tableY, TABLE_W, rowH);
      }
      zebra = !zebra;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(MARGIN, tableY + rowH);
      ctx.lineTo(MARGIN + TABLE_W, tableY + rowH);
      ctx.stroke();

      const lineValue = row.untracked
        ? null
        : row.costPrice * Math.max(0, row.quantity);
      let x = MARGIN + TABLE_W;
      const cells: Record<string, string> = {
        name: row.name,
        barcode: row.barcode || '—',
        category: row.category,
        cost: row.costPrice.toFixed(2),
        qty: formatQtyCell(row),
        state: STATE_LABELS[row.stockState],
        value: lineValue == null ? '—' : lineValue.toFixed(2),
      };
      for (const col of COLS) {
        const color =
          col.key === 'state'
            ? STATE_COLORS[row.stockState]
            : col.key === 'value'
            ? lineValue == null
              ? INK_SOFT
              : INK
            : col.key === 'cost' || col.key === 'value'
            ? INK
            : col.key === 'barcode'
            ? INK_SOFT
            : INK;
        text(
          ctx,
          cells[col.key],
          x - 12,
          tableY + rowH / 2,
          `600 13px ${FONT}`,
          color,
        );
        x -= col.width;
      }
      tableY += rowH;
    }
  }

  // صف الإجمالي الكبير — قيمة البضاعة في المخزون بالكامل.
  if (tableY + rowH + 6 > tableBottom) {
    newTablePage();
  }
  ctx.fillStyle = '#FFF7ED';
  ctx.fillRect(MARGIN, tableY, TABLE_W, rowH);
  ctx.strokeStyle = BRAND;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(MARGIN, tableY, TABLE_W, rowH);
  let tx = MARGIN + TABLE_W;
  const totalCells: Record<string, string> = {
    name: 'إجمالي قيمة البضاعة في المخزون',
    barcode: '',
    category: `${summary.tracked} متتبع`,
    cost: '',
    qty: summary.untracked > 0 ? `${summary.untracked} مفتوح` : '',
    state: '',
    value: costValue.toFixed(2),
  };
  for (const col of COLS) {
    text(
      ctx,
      totalCells[col.key],
      tx - 12,
      tableY + rowH / 2,
      `800 14px ${FONT}`,
      BRAND,
    );
    tx -= col.width;
  }
  drawPageFooter();
  return pages;
}

/* ── ضغط الصفحات وكتابة PDF (الكاتب المشترك v72) ── */

export async function buildInventoryReportPdf(
  payload: InventoryReportPayload,
): Promise<{bytes: Uint8Array; pages: number}> {
  if (payload.rows.length === 0) {
    throw new Error('لا منتجات تطابق العرض الحالي — غيّر الفلاتر ثم أعد');
  }
  await ensureFontsReady();
  const canvases = renderPages(payload);
  const images = await Promise.all(canvases.map(deflateCanvasPage));
  const bytes = buildImagePagesPdf(
    images.map(image => ({
      ...image,
      widthPx: PAGE_W_PX,
      heightPx: PAGE_H_PX,
      wPt: PAGE_W_PT,
      hPt: PAGE_H_PT,
    })),
  );
  return {bytes, pages: images.length};
}

/** حوار الحفظ الأصلي + كتابة الملف — يعيد المسار. */
export async function exportInventoryReportPdf(
  payload: InventoryReportPayload,
): Promise<{path: string; pages: number; count: number}> {
  const {bytes, pages} = await buildInventoryReportPdf(payload);
  const {invoke} = await import('../lib/tauri');
  const stamp = new Date().toISOString().slice(0, 10);
  const path = await invoke<string>('save_binary_file', {
    defaultName: `sela-inventory-${stamp}.pdf`,
    data: Array.from(bytes),
  });
  return {path, pages, count: payload.rows.length};
}
