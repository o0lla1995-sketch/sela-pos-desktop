/**
 * StatementPdf — v72 (الجولة 76 #5/#6): كشوف الخزينة والقنوات بصيغة
 * PDF احترافية حقيقية.
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر نصاً: «إعادة هندسة وتنسيق الكشوفات والتقارير (وخصوصاً
 * بصيغة PDF) لتعرض الجداول والبيانات بشكل احترافي ومنسق» + «توفير
 * تقرير تفصيلي لتتبع التحويلات والمقبوضات/المدفوعات لكل محفظة أو
 * بنك خلال الفترة».
 *
 *  ① كشف حركات الخزينة: ترويسة + بطاقات ملخص (مصروفات/مسحوبات/
 *     إيداعات/نقد الخزينة) + تفصيل الفئات + جدول السندات كاملاً
 *     بقناة كل سند (نقدي/بنك/محفظة) + صف الإجماليات + ترقيم صفحات.
 *  ② كشف قناة واحدة (بنك/محفظة): كل الوارد (مبيعات + سدادات +
 *     إيداعات) والصادر (مرتجعات + مسحوبات + مصروفات) برصيد متسلسل
 *     لحظي + بطاقة الرصيد الصافي.
 * كلاهما يُرسم على Canvas A4 بدقة 150DPI (تشكيل عربي من محرك
 * المتصفح) ثم يُجمع بالكاتب المشترك المُصلَح (pdfWriter).
 */
import {formatMoney, formatDateTime} from '../core/format';
import {paymentMethodById} from '../core/paymentMethods';
import type {CashMovementRecord, CashMovementTotals} from '../core/types';
import {
  buildImagePagesPdf,
  deflateCanvasPage,
  ensureFontsReady,
} from './pdfWriter';

/* ── ثوابت الصفحة: A4 بدقة 150DPI ── */
const DPI = 150;
const MM_PX = DPI / 25.4;
const PAGE_W_PX = Math.round(210 * MM_PX);
const PAGE_H_PX = Math.round(297 * MM_PX);
const PAGE_W_PT = 595.28;
const PAGE_H_PT = 841.89;
const MARGIN = Math.round(12 * MM_PX);
const BRAND = '#EA580C';
const INK = '#1F2937';
const INK_SOFT = '#6B7280';
const LINE = '#E5E7EB';
const ROW_BG = '#F8F9FB';
const OK = '#16A34A';
const DANGER = '#DC2626';
const FONT = 'Tajawal, "Segoe UI", sans-serif';

interface Ctx2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

interface PageState {
  pages: Ctx2D[];
  storeName: string;
  title: string;
}

function newPage(): Ctx2D {
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
  return {canvas, ctx};
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  cy: number,
  font: string,
  color: string,
  align: 'right' | 'left' | 'center' = 'right',
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(value, x, cy);
}

/** بطاقات ملخص أفقية (RTL) — ترجع y الجديد. */
function drawCards(
  ctx: CanvasRenderingContext2D,
  y: number,
  cards: {label: string; value: string; color: string}[],
  tableW: number,
): number {
  const gap = 14;
  const cardW = (tableW - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, i) => {
    const x = MARGIN + tableW - i * (cardW + gap);
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
  return y + 64 + 22;
}

/** ترويسة الصفحة الأولى — ترجع y بعدها. */
function drawFirstHeader(
  ctx: CanvasRenderingContext2D,
  y: number,
  storeName: string,
  title: string,
  subtitle: string,
  tableW: number,
): number {
  ctx.fillStyle = BRAND;
  ctx.fillRect(MARGIN, y, tableW, 6);
  y += 24;
  text(ctx, storeName, MARGIN + tableW, y + 18, `800 30px ${FONT}`, INK);
  text(ctx, title, MARGIN + tableW, y + 56, `700 20px ${FONT}`, BRAND);
  text(ctx, subtitle, MARGIN + tableW, y + 86, `500 15px ${FONT}`, INK_SOFT);
  text(
    ctx,
    `صدر بتاريخ ${formatDateTime(new Date().toISOString())}`,
    MARGIN + tableW,
    y + 110,
    `500 13px ${FONT}`,
    INK_SOFT,
  );
  return y + 140;
}

function drawContinuationHeader(
  ctx: CanvasRenderingContext2D,
  storeName: string,
  title: string,
  tableW: number,
): number {
  text(
    ctx,
    `${storeName} — ${title} (تابع)`,
    MARGIN + tableW,
    MARGIN + 10,
    `800 15px ${FONT}`,
    INK,
  );
  return MARGIN + 30;
}

function drawPageFooter(
  ctx: CanvasRenderingContext2D,
  state: PageState,
  pageNo: number,
  tableW: number,
): void {
  text(
    ctx,
    `${state.storeName} — ${state.title} · صفحة ${pageNo}`,
    MARGIN + tableW,
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
    'left',
  );
}

interface TableCol {
  label: string;
  width: number;
  /** محاذاة المحتوى: يمين (نص) أو يسار (أرقام). */
  numeric?: boolean;
}

/** جدول كامل بتعدد صفحات تلقائي — يمتلئ حتى أسفل الصفحة ثم يفتح
 *  أخرى بترويسة استمرار. يرجع إزاحة y النهائية على آخر صفحة. */
function renderTable(
  state: PageState,
  startY: number,
  cols: TableCol[],
  rows: string[][],
  rowColors: ('' | 'neg' | 'pos')[],
  footer: {cells: string[]; color: string} | null,
): number {
  const tableW = cols.reduce((sum, c) => sum + c.width, 0);
  const rowH = 40;
  const headerH = 38;
  const tableBottom = PAGE_H_PX - MARGIN - 30;
  let current = state.pages[state.pages.length - 1];
  let ctx = current.ctx;

  const drawHeaderRow = (top: number): number => {
    ctx.fillStyle = '#F3F4F6';
    ctx.fillRect(MARGIN, top, tableW, headerH);
    ctx.strokeStyle = LINE;
    ctx.strokeRect(MARGIN, top, tableW, headerH);
    let x = MARGIN + tableW;
    for (const col of cols) {
      text(
        ctx,
        col.label,
        col.numeric ? x - col.width + 12 : x - 12,
        top + headerH / 2,
        `800 13px ${FONT}`,
        INK,
        col.numeric ? 'left' : 'right',
      );
      x -= col.width;
    }
    return top + headerH;
  };

  let tableY = drawHeaderRow(startY);
  let zebra = false;
  let pageNo = state.pages.length;

  for (let r = 0; r < rows.length; r += 1) {
    if (tableY + rowH > tableBottom) {
      drawPageFooter(ctx, state, pageNo, tableW);
      current = newPage();
      ctx = current.ctx;
      state.pages.push(current);
      pageNo += 1;
      tableY = drawHeaderRow(
        drawContinuationHeader(ctx, state.storeName, state.title, tableW),
      );
      zebra = false;
    }
    if (zebra) {
      ctx.fillStyle = ROW_BG;
      ctx.fillRect(MARGIN, tableY, tableW, rowH);
    }
    zebra = !zebra;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(MARGIN, tableY + rowH);
    ctx.lineTo(MARGIN + tableW, tableY + rowH);
    ctx.stroke();
    let x = MARGIN + tableW;
    const color =
      rowColors[r] === 'neg' ? DANGER : rowColors[r] === 'pos' ? OK : INK;
    for (let c = 0; c < cols.length; c += 1) {
      text(
        ctx,
        rows[r][c] ?? '',
        cols[c].numeric ? x - cols[c].width + 12 : x - 12,
        tableY + rowH / 2,
        `600 13px ${FONT}`,
        c === 0 ? INK : color,
        cols[c].numeric ? 'left' : 'right',
      );
      x -= cols[c].width;
    }
    tableY += rowH;
  }

  if (footer != null) {
    if (tableY + rowH + 6 > tableBottom) {
      drawPageFooter(ctx, state, pageNo, tableW);
      current = newPage();
      ctx = current.ctx;
      state.pages.push(current);
      tableY = drawHeaderRow(
        drawContinuationHeader(ctx, state.storeName, state.title, tableW),
      );
    }
    ctx.fillStyle = '#FFF7ED';
    ctx.fillRect(MARGIN, tableY, tableW, rowH);
    ctx.strokeStyle = BRAND;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(MARGIN, tableY, tableW, rowH);
    let x = MARGIN + tableW;
    for (let c = 0; c < cols.length; c += 1) {
      text(
        ctx,
        footer.cells[c] ?? '',
        cols[c].numeric ? x - cols[c].width + 12 : x - 12,
        tableY + rowH / 2,
        `800 14px ${FONT}`,
        footer.color,
        cols[c].numeric ? 'left' : 'right',
      );
      x -= cols[c].width;
    }
    tableY += rowH;
  }
  return tableY;
}

async function pagesToPdf(pages: Ctx2D[]): Promise<Uint8Array> {
  const images = await Promise.all(
    pages.map(page => deflateCanvasPage(page.canvas)),
  );
  return buildImagePagesPdf(
    images.map(image => ({
      ...image,
      widthPx: PAGE_W_PX,
      heightPx: PAGE_H_PX,
      wPt: PAGE_W_PT,
      hPt: PAGE_H_PT,
    })),
  );
}

async function savePdf(
  bytes: Uint8Array,
  defaultName: string,
): Promise<string> {
  const {invoke} = await import('../lib/tauri');
  return invoke<string>('save_binary_file', {
    defaultName,
    data: Array.from(bytes),
  });
}

/* ══════════════ ① كشف حركات الخزينة ══════════════ */

export interface TreasuryStatementData {
  storeName: string;
  from: string;
  to: string;
  rows: CashMovementRecord[];
  totals: CashMovementTotals;
  categories: {category: string; count: number; totalMinor: number}[];
  drawerNow: number;
}

const TREASURY_COLS: TableCol[] = [
  {label: 'السند', width: 148},
  {label: 'النوع', width: 88},
  {label: 'القناة', width: 126},
  {label: 'الفئة', width: 138},
  {label: 'الملاحظة', width: 212},
  {label: 'المبلغ', width: 118, numeric: true},
  {label: 'التاريخ', width: 200},
];

export async function exportTreasuryStatementPdf(
  data: TreasuryStatementData,
): Promise<{path: string; pages: number}> {
  await ensureFontsReady();
  const tableW = TREASURY_COLS.reduce((sum, c) => sum + c.width, 0);
  const shekels = (minor: number) => `${(minor / 100).toFixed(2)}`;
  const first = newPage();
  const state: PageState = {
    pages: [first],
    storeName: data.storeName,
    title: 'كشف حركات الخزينة',
  };
  let y = drawFirstHeader(
    first.ctx,
    MARGIN,
    data.storeName,
    state.title,
    `من ${data.from} إلى ${data.to} — السحب والمصروفات والإيداعات بكل قنواتها`,
    tableW,
  );

  y = drawCards(
    first.ctx,
    y,
    [
      {
        label: 'المصروفات',
        value: shekels(data.totals.expensesMinor),
        color: DANGER,
      },
      {
        label: 'المسحوبات',
        value: shekels(data.totals.withdrawalsMinor),
        color: DANGER,
      },
      {label: 'الإيداعات', value: shekels(data.totals.depositsMinor), color: OK},
      {
        label: 'النقد بالخزينة الآن',
        value: data.drawerNow.toFixed(2),
        color: INK,
      },
    ],
    tableW,
  );

  // تفصيل الفئات — قسم صغير قبل جدول السندات.
  if (data.categories.length > 0) {
    text(
      first.ctx,
      `حسب الفئة (${data.categories.length})`,
      MARGIN + tableW,
      y + 10,
      `800 15px ${FONT}`,
      INK,
    );
    y += 26;
    y =
      renderTable(
        state,
        y,
        [
          {label: 'الفئة', width: 500},
          {label: 'العدد', width: 170, numeric: true},
          {label: 'الإجمالي', width: 460, numeric: true},
        ],
        data.categories.map(cat => [
          cat.category,
          String(cat.count),
          shekels(cat.totalMinor),
        ]),
        data.categories.map(() => '' as const),
        null,
      ) + 20;
    text(
      state.pages[state.pages.length - 1].ctx,
      `السندات (${data.rows.length})`,
      MARGIN + tableW,
      y + 10,
      `800 15px ${FONT}`,
      INK,
    );
    y += 26;
  }

  const kindLabel = (kind: string): string =>
    kind === 'withdrawal'
      ? 'سحب'
      : kind === 'deposit'
      ? 'إيداع'
      : kind === 'online_collection'
      ? 'تحصيل أونلاين'
      : kind === 'online_refund'
      ? 'استرداد أونلاين'
      : 'مصروف';
  const isInflow = (kind: string) =>
    kind === 'deposit' || kind === 'online_collection';

  const endY = renderTable(
    state,
    y,
    TREASURY_COLS,
    data.rows.map(row => [
      row.ref,
      kindLabel(row.kind),
      paymentMethodById(row.payment_method ?? 'cash').label,
      row.category,
      row.note ?? '—',
      `${isInflow(row.kind) ? '+' : '−'}${shekels(row.amount_minor)}`,
      row.created_at.replace('T', ' ').slice(0, 16),
    ]),
    data.rows.map(row => (isInflow(row.kind) ? 'pos' : 'neg')),
    {
      cells: [
        'الإجماليات',
        `${data.rows.length} سند`,
        '',
        '',
        '',
        `صافي ${shekels(data.totals.netMinor)}`,
        '',
      ],
      color: BRAND,
    },
  );
  // أسفل الإجماليات: سطر الرصيد الحالي للخزينة النقدية.
  const lastCtx = state.pages[state.pages.length - 1].ctx;
  if (endY + 46 < PAGE_H_PX - MARGIN - 10) {
    text(
      lastCtx,
      `النقد المتوقع بالخزينة الآن: ${formatMoney(data.drawerNow)}`,
      MARGIN + tableW,
      endY + 22,
      `800 14px ${FONT}`,
      BRAND,
    );
  }
  drawPageFooter(
    lastCtx,
    state,
    state.pages.length,
    tableW,
  );

  const bytes = await pagesToPdf(state.pages);
  const path = await savePdf(
    bytes,
    `sela-cash-statement-${data.from}-to-${data.to}.pdf`,
  );
  return {path, pages: state.pages.length};
}

/* ══════════════ ② كشف قناة واحدة (بنك/محفظة/نقد) ══════════════ */

export interface MethodStatementData {
  storeName: string;
  from: string;
  to: string;
  /** معرف القناة (bank_palestine… أو cash). */
  methodId: string;
  rows: {
    at: string;
    kind: string;
    ref: string;
    label: string;
    amountIn: number;
    amountOut: number;
  }[];
  net: number;
  balanceNow: number;
}

const METHOD_COLS: TableCol[] = [
  {label: 'النوع', width: 128},
  {label: 'المرجع', width: 168},
  {label: 'الوصف', width: 332},
  {label: 'وارد', width: 130, numeric: true},
  {label: 'صادر', width: 130, numeric: true},
  {label: 'الرصيد', width: 148, numeric: true},
];

export async function exportMethodStatementPdf(
  data: MethodStatementData,
): Promise<{path: string; pages: number}> {
  await ensureFontsReady();
  const tableW = METHOD_COLS.reduce((sum, c) => sum + c.width, 0);
  const method = paymentMethodById(data.methodId);
  const first = newPage();
  const state: PageState = {
    pages: [first],
    storeName: data.storeName,
    title: `كشف ${method.label}`,
  };
  let y = drawFirstHeader(
    first.ctx,
    MARGIN,
    data.storeName,
    state.title,
    `من ${data.from} إلى ${data.to} — كل المقبوضات والمدفوعات على ${
      method.kind === 'cash' ? 'الخزينة النقدية' : method.label
    } خلال الفترة`,
    tableW,
  );

  const totalIn = data.rows.reduce((sum, r) => sum + r.amountIn, 0);
  const totalOut = data.rows.reduce((sum, r) => sum + r.amountOut, 0);
  y = drawCards(
    first.ctx,
    y,
    [
      {label: 'إجمالي الوارد', value: totalIn.toFixed(2), color: OK},
      {label: 'إجمالي الصادر', value: totalOut.toFixed(2), color: DANGER},
      {label: 'صافي الفترة', value: data.net.toFixed(2), color: INK},
      {label: 'الرصيد الآن', value: data.balanceNow.toFixed(2), color: BRAND},
    ],
    tableW,
  );

  const kindLabels: Record<string, string> = {
    sale: 'بيع',
    return: 'مرتجع',
    repayment_local: 'سداد دفتر',
    repayment_sila: 'سداد صِلة',
    deposit: 'إيداع',
    withdrawal: 'سحب',
    expense: 'مصروف',
  };

  // الرصيد المتسلسل: يبدأ من رصيد ما قبل الفترة (balanceNow − net)
  // ويتحرك مع كل عملية — فيطابق كشف الحساب البنكي سطراً بسطر.
  let running = data.balanceNow - data.net;
  const rowsText: string[][] = [];
  const rowColors: ('' | 'neg' | 'pos')[] = [];
  for (const row of data.rows) {
    running += row.amountIn - row.amountOut;
    rowsText.push([
      kindLabels[row.kind] ?? row.kind,
      row.ref,
      row.label,
      row.amountIn > 0 ? row.amountIn.toFixed(2) : '—',
      row.amountOut > 0 ? row.amountOut.toFixed(2) : '—',
      running.toFixed(2),
    ]);
    rowColors.push(row.amountOut > 0 ? 'neg' : 'pos');
  }

  const endY = renderTable(
    state,
    y,
    METHOD_COLS,
    rowsText,
    rowColors,
    {
      cells: [
        'الإجماليات',
        `${data.rows.length} عملية`,
        '',
        totalIn.toFixed(2),
        totalOut.toFixed(2),
        data.net.toFixed(2),
      ],
      color: BRAND,
    },
  );
  const lastCtx = state.pages[state.pages.length - 1].ctx;
  if (endY + 46 < PAGE_H_PX - MARGIN - 10) {
    text(
      lastCtx,
      `رصيد ${method.label} الآن: ${formatMoney(data.balanceNow)}`,
      MARGIN + tableW,
      endY + 22,
      `800 14px ${FONT}`,
      BRAND,
    );
  }
  drawPageFooter(lastCtx, state, state.pages.length, tableW);

  const bytes = await pagesToPdf(state.pages);
  const path = await savePdf(
    bytes,
    `sela-${data.methodId}-statement-${data.from}-to-${data.to}.pdf`,
  );
  return {path, pages: state.pages.length};
}
