/**
 * PeriodReportPdf.ts — v87 (الجولة 93 #٧): تقرير الفترة الشامل PDF
 * قابل للطباعة — سطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر نصاً: «لا يوجد في التقارير ما يوضح عمليات التجار بشكل
 * مختصر ويضاف الي التقارير في حال طباعتها» — وثيقة A4 عربية واحدة
 * متعددة الأقسام (Canvas 150DPI → pdfWriter المجرب):
 *
 *   ١. ملخص المبيعات — الإيراد والربح والتكلفة والفواتير والخصومات.
 *   ٢. أرصدة طرق الدفع — نقدي + كل بنك/محفظة (فترة + رصيد الآن).
 *   ٣. النقد والديون — المحصّل النقدي بالدرج + الدين القائم.
 *   ٤. عمليات التجار بشكل مختصر — المستحق الآن + توريد/سداد/مرتجع/
 *      تحصيل بالفترة + أكبر المستحقات (طلب التاجر الأساسي).
 *   ٥. الأكثر إيراداً — أفضل ٨ أصناف بالفترة.
 */
import {formatMoney, formatDateTime} from '../core/format';
import {displayMethod} from '../core/paymentMethods';
import {
  deflateCanvasPage,
  buildImagePagesPdf,
  ensureFontsReady,
} from './pdfWriter';

/* ── أبعاد A4 بدقة 150DPI (كما في InvoicesReportPdf المجرب) ── */
const PAGE_W_PX = 1240;
const PAGE_H_PX = 1754;
const MARGIN = 56;
const TABLE_W = PAGE_W_PX - MARGIN * 2;

const BRAND = '#EA580C';
const INK = '#1F2937';
const INK_SOFT = '#6B7280';
const LINE = '#E5E7EB';
const ROW_BG = '#F8F9FB';
const DANGER = '#DC2626';
const OK = '#16A34A';

const FONT = 'Tajawal, "Segoe UI", sans-serif';

export interface PeriodSection {
  heading: string;
  summary?: {label: string; value: string}[];
  columns?: {label: string; w: number}[];
  rows?: {cells: {t: string; tone?: 'debt' | 'pay'; bold?: boolean}[]}[];
  note?: string;
}

export interface PeriodReportPayload {
  storeName: string;
  title: string;
  periodLabel: string;
  generatedAt: string;
  sections: PeriodSection[];
  footer: string;
}

function newPage(): HTMLCanvasElement {
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
  return canvas;
}

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

function ellipsize(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  if (value.length === 0 || maxWidth <= 12) {
    return value;
  }
  if (ctx.measureText(value).width <= maxWidth) {
    return value;
  }
  let out = value;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out.trimEnd() + '…';
}

function renderPages(payload: PeriodReportPayload): HTMLCanvasElement[] {
  const pages: HTMLCanvasElement[] = [];
  let canvas = newPage();
  let ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  pages.push(canvas);
  let pageNo = 1;
  let y = MARGIN;

  const drawFooter = () => {
    text(
      ctx,
      payload.footer,
      MARGIN + TABLE_W,
      PAGE_H_PX - MARGIN / 2,
      `500 13px ${FONT}`,
      INK_SOFT,
    );
    ctx.font = `500 13px ${FONT}`;
    ctx.fillStyle = INK_SOFT;
    ctx.textAlign = 'left';
    ctx.fillText(`صفحة ${pageNo}`, MARGIN, PAGE_H_PX - MARGIN / 2);
  };

  const startNewPage = () => {
    drawFooter();
    canvas = newPage();
    ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    pages.push(canvas);
    pageNo += 1;
    y = MARGIN;
    text(
      ctx,
      `${payload.storeName} — ${payload.title} (تابع)`,
      MARGIN + TABLE_W,
      y,
      `700 15px ${FONT}`,
      INK_SOFT,
    );
    y += 36;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H_PX - MARGIN - 30) {
      startNewPage();
    }
  };

  /* ── الترويسة ── */
  ctx.fillStyle = BRAND;
  ctx.fillRect(MARGIN, y, TABLE_W, 6);
  y += 30;
  text(ctx, payload.storeName, MARGIN + TABLE_W, y + 16, `800 30px ${FONT}`, INK);
  text(ctx, payload.title, MARGIN + TABLE_W, y + 56, `700 20px ${FONT}`, BRAND);
  text(
    ctx,
    `الفترة: ${payload.periodLabel}`,
    MARGIN + TABLE_W,
    y + 86,
    `500 15px ${FONT}`,
    INK_SOFT,
  );
  text(
    ctx,
    `صدر بتاريخ ${payload.generatedAt}`,
    MARGIN + TABLE_W,
    y + 108,
    `500 13px ${FONT}`,
    INK_SOFT,
  );
  y += 136;

  const rowH = 34;

  for (const section of payload.sections) {
    ensureSpace(64);
    text(ctx, section.heading, MARGIN + TABLE_W, y, `800 18px ${FONT}`, INK);
    y += 12;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, y);
    ctx.lineTo(MARGIN + TABLE_W, y);
    ctx.stroke();
    y += 24;

    /* بطاقات الملخص — أربع في الصف. */
    if ((section.summary?.length ?? 0) > 0) {
      const cards = section.summary!;
      const perRow = cards.length > 4 ? 4 : Math.max(2, cards.length);
      const gap = 12;
      const cardW = (TABLE_W - gap * (perRow - 1)) / perRow;
      for (let i = 0; i < cards.length; i += perRow) {
        ensureSpace(72);
        const rowCards = cards.slice(i, i + perRow);
        rowCards.forEach((card, j) => {
          const x = MARGIN + TABLE_W - j * (cardW + gap);
          ctx.fillStyle = '#FBF7F2';
          ctx.strokeStyle = LINE;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(x - cardW, y, cardW, 62, 10);
          ctx.fill();
          ctx.stroke();
          text(
            ctx,
            ellipsize(ctx, card.label, cardW - 24),
            x - 12,
            y + 20,
            `700 12.5px ${FONT}`,
            INK_SOFT,
          );
          text(
            ctx,
            ellipsize(ctx, card.value, cardW - 24),
            x - 12,
            y + 43,
            `800 18px ${FONT}`,
            INK,
          );
        });
        y += 74;
      }
      y += 8;
    }

    /* جدول بأعمدة بأوزان نسبية (RTL — الأول أقصى اليمين). */
    if ((section.columns?.length ?? 0) > 0) {
      const columns = section.columns!;
      const rows = section.rows ?? [];
      const totalW = columns.reduce((sum, c) => sum + c.w, 0);
      const xs: number[] = [];
      let x = MARGIN + TABLE_W;
      for (const c of columns) {
        xs.push(x);
        x -= (TABLE_W * c.w) / totalW;
      }

      const drawHeader = () => {
        ctx.fillStyle = '#F3F4F6';
        ctx.fillRect(MARGIN, y - 22, TABLE_W, 32);
        for (let i = 0; i < columns.length; i += 1) {
          const w = i + 1 < xs.length ? xs[i] - xs[i + 1] : xs[i] - MARGIN;
          text(
            ctx,
            ellipsize(ctx, columns[i].label, w - 16),
            xs[i] - 8,
            y - 6,
            `700 13px ${FONT}`,
            INK,
          );
        }
        y += 30;
      };

      ensureSpace(56);
      drawHeader();
      let zebra = false;
      for (const row of rows) {
        if (y + rowH > PAGE_H_PX - MARGIN - 30) {
          startNewPage();
          drawHeader();
          zebra = false;
        }
        if (zebra) {
          ctx.fillStyle = ROW_BG;
          ctx.fillRect(MARGIN, y - rowH / 2 - 4, TABLE_W, rowH);
        }
        zebra = !zebra;
        for (let i = 0; i < columns.length; i += 1) {
          const cell = row.cells[i];
          if (cell == null) {
            continue;
          }
          const w = i + 1 < xs.length ? xs[i] - xs[i + 1] : xs[i] - MARGIN;
          const color =
            cell.tone === 'debt' ? DANGER : cell.tone === 'pay' ? OK : INK;
          text(
            ctx,
            ellipsize(ctx, cell.t, w - 16),
            xs[i] - 8,
            y,
            `${cell.bold ? '800' : '600'} 13px ${FONT}`,
            color,
          );
        }
        y += rowH;
      }
      y += 10;
    }

    if (section.note != null && section.note.length > 0) {
      ensureSpace(30);
      const lines = wrapNote(ctx, section.note, TABLE_W);
      for (const line of lines) {
        text(ctx, line, MARGIN + TABLE_W, y, `500 12.5px ${FONT}`, INK_SOFT);
        y += 20;
      }
      y += 6;
    }
    y += 14;
  }

  drawFooter();
  return pages;
}

function wrapNote(
  ctx: CanvasRenderingContext2D,
  note: string,
  maxWidth: number,
): string[] {
  ctx.font = `500 12.5px ${FONT}`;
  const words = note.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
}

export async function buildPeriodReportPdf(
  payload: PeriodReportPayload,
): Promise<{bytes: Uint8Array; pages: number}> {
  await ensureFontsReady();
  const canvases = renderPages(payload);
  const images = await Promise.all(canvases.map(deflateCanvasPage));
  const bytes = buildImagePagesPdf(
    images.map(image => ({
      ...image,
      widthPx: PAGE_W_PX,
      heightPx: PAGE_H_PX,
      wPt: 595,
      hPt: 842,
    })),
  );
  return {bytes, pages: images.length};
}

/** حوار الحفظ الأصلي + كتابة الملف — يعيد المسار. */
export async function exportPeriodReportPdf(
  payload: PeriodReportPayload,
): Promise<{path: string; pages: number}> {
  const {bytes, pages} = await buildPeriodReportPdf(payload);
  const {invoke} = await import('../lib/tauri');
  const stamp = new Date().toISOString().slice(0, 10);
  const path = await invoke<string>('save_binary_file', {
    defaultName: `sela-period-report-${stamp}.pdf`,
    data: Array.from(bytes),
  });
  return {path, pages};
}

/* ── بناء الحمولة من بيانات التقارير (نفس أقسام أندرويد v80) ── */

export interface PeriodReportInput {
  rangeKey: string;
  from: string;
  to: string;
  storeName: string;
  summary: {
    revenue: number;
    netProfit: number;
    cogs: number;
    invoicesCount: number;
    avgInvoice: number;
    discountTotal: number;
    returnsCount: number;
    returnsTotal: number;
  };
  methodsLive: {
    method: string;
    net: number;
    salesIn?: number;
    salesCount?: number;
  }[];
  cash: {
    collected: number;
    netCashAfterMovements: number;
    cashNowMinor: number;
    creditSalesCount: number;
    creditSalesAmount: number;
    localOutstandingMinor: number;
    nonCashSalesAmount: number;
  };
  merchantTotals: {
    count: number;
    owedNow: number;
    creditNow: number;
    purchasesInRange: number;
    debtsInRange: number;
    paymentsInRange: number;
    returnsInRange: number;
    collectionsInRange: number;
    topOwed: {merchant: {name: string}; balance: number}[];
  };
  topByRevenue: {name: string; quantity: number; revenue: number; profit: number}[];
}

const PERIOD_LABELS: Record<string, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  last7: 'آخر ٧ أيام',
  thisMonth: 'هذا الشهر',
  all: 'كل السجل',
  custom: 'فترة مخصصة',
};

/** يحوّل بيانات التقارير إلى حمولة أقسام التقرير الشامل. */
export function buildPeriodPayload(input: PeriodReportInput): PeriodReportPayload {
  const sections: PeriodSection[] = [];

  const s = input.summary;
  sections.push({
    heading: 'ملخص المبيعات',
    summary: [
      {label: 'إجمالي المبيعات (صافي المرتجعات)', value: formatMoney(s.revenue)},
      {label: 'صافي الربح', value: formatMoney(s.netProfit)},
      {label: 'تكلفة البضاعة المباعة', value: formatMoney(s.cogs)},
      {label: 'عدد الفواتير', value: String(s.invoicesCount)},
      {label: 'متوسط الفاتورة', value: formatMoney(s.avgInvoice)},
      {label: 'إجمالي الخصومات', value: formatMoney(s.discountTotal)},
    ],
    note: `المرتجعات: ${s.returnsCount} إشعاراً بقيمة ${formatMoney(s.returnsTotal)} — الإيراد والأرقام أعلاه صافية منها تلقائياً.`,
  });

  if (input.methodsLive.length > 0) {
    sections.push({
      heading: 'أرصدة طرق الدفع (النقدي درجٌ مستقل)',
      columns: [
        {label: 'القناة', w: 2.2},
        {label: 'فواتير بالفترة', w: 1.4},
        {label: 'مبيعات الفترة', w: 1.4},
        {label: 'الرصيد الآن', w: 1.4},
      ],
      rows: input.methodsLive.map(row => {
        const method = displayMethod(row.method);
        return {
          cells: [
            {t: method.label, bold: true},
            {t: `${row.salesCount ?? 0} فاتورة`},
            {t: formatMoney(row.salesIn ?? 0)},
            {
              t: formatMoney(row.net),
              bold: true,
              tone: row.net < 0 ? ('debt' as const) : undefined,
            },
          ],
        };
      }),
      note: 'رصيد «الآن» هو دفتر القناة عبر التاريخ: مبيعات + سدادّات + إيداعات − مرتجعات − مسحوبات − مصروفات.',
    });
  }

  const cash = input.cash;
  sections.push({
    heading: 'النقد والديون',
    summary: [
      {label: 'النقد المحصّل بالدرج بالفترة', value: formatMoney(cash.collected)},
      {label: 'صافي حركة الدرج النقدي بالفترة', value: formatMoney(cash.netCashAfterMovements)},
      {label: 'النقد بالخزينة الآن', value: formatMoney(cash.cashNowMinor / 100)},
      {label: 'فواتير الدين بالفترة', value: `${cash.creditSalesCount} فاتورة · ${formatMoney(cash.creditSalesAmount)}`},
      {label: 'الدين القائم الآن (دفتر المتجر)', value: formatMoney(cash.localOutstandingMinor / 100)},
      {label: 'عبر البنوك والمحافظ بالفترة (مبيعات)', value: formatMoney(cash.nonCashSalesAmount)},
    ],
    note: 'أرقام النقد أعلاه نقية من مبيعات ومقبوضات البنوك والمحافظ — أرصدتها في قسم القنوات أعلاه، فلا ازدواج في أي مبلغ.',
  });

  if (input.merchantTotals.count > 0) {
    const mt = input.merchantTotals;
    const merchantSummary: {label: string; value: string}[] = [
      {label: `مستحق للتجار الآن · ${mt.count} تاجر`, value: formatMoney(mt.owedNow)},
      {label: 'لك عند التجار (دفعات مقدمة)', value: formatMoney(mt.creditNow)},
      {label: 'توريد بالفترة', value: formatMoney(mt.purchasesInRange)},
      {label: 'ديون مباشرة بالفترة', value: formatMoney(mt.debtsInRange)},
      {label: 'سدادات بالفترة', value: formatMoney(mt.paymentsInRange)},
      {label: 'مرتجعات/خصومات بالفترة', value: formatMoney(mt.returnsInRange)},
      {label: 'تحصيلات منه بالفترة', value: formatMoney(mt.collectionsInRange)},
    ];
    const topRows = mt.topOwed.slice(0, 8).map((row, index) => ({
      cells: [
        {t: String(index + 1)},
        {t: row.merchant.name, bold: true},
        {t: formatMoney(row.balance), tone: 'debt' as const, bold: true},
      ],
    }));
    sections.push({
      heading: 'عمليات التجار — ملخص مختصر',
      summary: merchantSummary,
      ...(topRows.length > 0
        ? {
            columns: [
              {label: '#', w: 0.5},
              {label: 'التاجر', w: 2.8},
              {label: 'المستحق له', w: 1.4},
            ],
            rows: topRows,
          }
        : {}),
      note: 'التوريد والسداد والمرتجع والتحصيل تعكس حركة هذه الفترة فقط؛ «المستحق الآن» رصيد حي عبر التاريخ.',
    });
  }

  if (input.topByRevenue.length > 0) {
    sections.push({
      heading: 'الأكثر إيراداً بالفترة',
      columns: [
        {label: '#', w: 0.5},
        {label: 'الصنف', w: 2.8},
        {label: 'الكمية', w: 1.1},
        {label: 'الإيراد', w: 1.3},
        {label: 'الربح', w: 1.3},
      ],
      rows: input.topByRevenue.slice(0, 8).map((row, index) => ({
        cells: [
          {t: String(index + 1)},
          {t: row.name, bold: true},
          {t: String(row.quantity)},
          {t: formatMoney(row.revenue)},
          {
            t: formatMoney(row.profit),
            tone: row.profit < 0 ? ('debt' as const) : ('pay' as const),
          },
        ],
      })),
    });
  }

  return {
    storeName: input.storeName,
    title: 'تقرير الفترة الشامل',
    periodLabel: `${PERIOD_LABELS[input.rangeKey] ?? input.rangeKey} — ${input.from} إلى ${input.to}`,
    generatedAt: formatDateTime(new Date().toISOString()),
    sections,
    footer: 'تقرير شامل قابل للطباعة — يشمل عمليات التجار المختصرة · تطبيق sela سطح المكتب',
  };
}
