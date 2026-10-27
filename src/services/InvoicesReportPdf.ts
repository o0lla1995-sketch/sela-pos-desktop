/**
 * InvoicesReportPdf — v71 (الجولة 75 #7): تقرير الفواتير المفلترة
 * كملف PDF جميل ومفصّل وسهل القراءة.
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر نصاً: «لماذا لا يوجد زر في صفحة الفواتير لطباعة أو
 * استخراج التقرير pdf الخاص بالفواتير التي تمت فلترتها بتقرير
 * جميل ومفصل وسهل القراءة».
 *
 * الهندسة (نفس نمط BarcodePdfService المجرب — v70 الجولة 74 #4):
 *  ① كل صفحة A4 تُرسم على Canvas بدقة 150DPI — محرك المتصفح يشكّل
 *     العربية (RTL + ربط الحروف) بنفسه فلا حاجة لأي مكتبة تشكيل.
 *  ② كاتب PDF 1.4 خالص (بلا مكتبات): كل صفحة صورة RGB مضغوطة
 *     FlateDecode عبر CompressionStream — يفتحه أي قارئ/طابعة.
 *  ③ التقرير: ترويسة المتجر والفترة والفلاتر المطبقة + بطاقات
 *     ملخص (عدد/إجمالي/مرتجع/صافي) + توزيع طرق الدفع + جدول
 *     الفواتير كاملاً بصفوف مخططة ومرتجعات مميزة بالأحمر + صف
 *     الإجماليات + ترقيم صفحات.
 */

import {formatMoney, formatDateTime} from '../core/format';
import {paymentMethodById} from '../core/paymentMethods';

/** صف فاتورة واحد داخل التقرير. */
export interface InvoiceReportRow {
  invoice: string;
  /** نقدية / دين صِلة / دين المتجر / قسيمة / مرتجع. */
  kindLabel: string;
  /** معرف طريقة الدفع (bank_palestine…) أو null = نقدي. */
  paymentMethod: string | null;
  itemsCount: number;
  /** إجمالي الفاتورة بالشيكل (سالب للمرتجعات RET-). */
  total: number;
  /** قيمة المرتجع منها بالشيكل. */
  returned: number;
  createdAt: string;
}

export interface InvoicesReportPayload {
  storeName: string;
  /** وصف الفترة: «من 2026-10-01 إلى 2026-10-28». */
  periodLabel: string;
  /** وصف الفلاتر المطبقة للعرض في الترويسة. */
  filtersLabel: string;
  rows: InvoiceReportRow[];
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

const FONT = 'Tajawal, "Segoe UI", sans-serif';

/* أعمدة الجدول — من اليمين لليسار (RTL). */
const COLS: {key: string; width: number; align?: 'left'}[] = [
  {key: 'invoice', width: 205},
  {key: 'kind', width: 118},
  {key: 'method', width: 150},
  {key: 'items', width: 78},
  {key: 'total', width: 132},
  {key: 'returned', width: 128},
  {key: 'date', width: 309},
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

/** توزيع طرق الدفع من الصفوف (للبطاقة التفصيلية). */
function methodBreakdown(rows: InvoiceReportRow[]) {
  const map = new Map<string, {total: number; count: number}>();
  for (const row of rows) {
    const id = row.invoice.startsWith('RET-')
      ? 'cash'
      : row.paymentMethod || 'cash';
    const entry = map.get(id) ?? {total: 0, count: 0};
    entry.total += row.total;
    entry.count += 1;
    map.set(id, entry);
  }
  return [...map.entries()]
    .map(([id, v]) => ({method: paymentMethodById(id), ...v}))
    .sort((a, b) => b.total - a.total);
}

/** رسم تقرير كامل وإرجاع صفحاته. */
function renderPages(payload: InvoicesReportPayload): HTMLCanvasElement[] {
  const pages: HTMLCanvasElement[] = [];
  const {rows} = payload;

  const summary = rows.reduce(
    (acc, row) => {
      acc.count += 1;
      if (row.invoice.startsWith('RET-')) {
        acc.returns += row.total; // سالبة أصلاً
      } else {
        acc.sales += row.total;
        acc.returned += row.returned;
      }
      return acc;
    },
    {count: 0, sales: 0, returns: 0, returned: 0},
  );
  const methods = methodBreakdown(rows);

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
  text(
    ctx,
    'تقرير الفواتير',
    MARGIN + TABLE_W,
    y + 56,
    `700 20px ${FONT}`,
    BRAND,
  );
  text(
    ctx,
    `${payload.periodLabel} · ${payload.filtersLabel}`,
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

  // بطاقات الملخص (4)
  const cards: {label: string; value: string; color: string}[] = [
    {label: 'عدد العمليات', value: String(summary.count), color: INK},
    {label: 'إجمالي المبيعات', value: formatMoney(summary.sales), color: INK},
    {
      label: 'المرتجعات',
      value: formatMoney(summary.returns + summary.returned),
      color: '#DC2626',
    },
    {
      label: 'الصافي',
      value: formatMoney(summary.sales - summary.returned + summary.returns),
      color: '#16A34A',
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

  // توزيع طرق الدفع
  if (methods.length > 1) {
    text(
      ctx,
      'توزيع طرق الدفع',
      MARGIN + TABLE_W,
      y + 10,
      `800 15px ${FONT}`,
      INK,
    );
    y += 26;
    const mGap = 10;
    const mW = (TABLE_W - mGap * (methods.length - 1)) / methods.length;
    methods.forEach((m, i) => {
      const x = MARGIN + TABLE_W - i * (mW + mGap);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = LINE;
      ctx.beginPath();
      ctx.roundRect(x - mW, y, mW, 58, 9);
      ctx.fill();
      ctx.stroke();
      // نقطة اللون
      ctx.fillStyle = m.method.color;
      ctx.beginPath();
      ctx.arc(x - 16, y + 18, 6, 0, Math.PI * 2);
      ctx.fill();
      text(
        ctx,
        m.method.label,
        x - 30,
        y + 18,
        `700 13px ${FONT}`,
        INK,
      );
      text(
        ctx,
        `${formatMoney(m.total)} · ${m.count}`,
        x - 14,
        y + 41,
        `700 13px ${FONT}`,
        INK_SOFT,
      );
    });
    y += 58 + 20;
  }

  // عنوان الجدول
  text(ctx, 'تفاصيل الفواتير', MARGIN + TABLE_W, y + 10, `800 15px ${FONT}`, INK);
  y += 26;

  const rowH = 40;
  const headerH = 38;
  const tableBottom = PAGE_H_PX - MARGIN - 30;

  const drawTableHeader = (top: number): number => {
    ctx.fillStyle = '#F3F4F6';
    ctx.fillRect(MARGIN, top, TABLE_W, headerH);
    ctx.strokeStyle = LINE;
    ctx.strokeRect(MARGIN, top, TABLE_W, headerH);
    let x = MARGIN + TABLE_W;
    const labels: Record<string, string> = {
      invoice: 'رقم الفاتورة',
      kind: 'النوع',
      method: 'طريقة الدفع',
      items: 'أصناف',
      total: 'الإجمالي',
      returned: 'مرتجع منها',
      date: 'التاريخ',
    };
    for (const col of COLS) {
      text(
        ctx,
        labels[col.key],
        x - 12,
        top + headerH / 2,
        `800 13px ${FONT}`,
        INK,
      );
      x -= col.width;
    }
    return top + headerH;
  };

  let tableY = drawTableHeader(y);
  let zebra = false;
  let pageNo = 1;

  const drawPageFooter = () => {
    text(
      ctx,
      `${payload.storeName} — تقرير الفواتير · صفحة ${pageNo}`,
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

  for (const row of rows) {
    if (tableY + rowH > tableBottom) {
      drawPageFooter();
      page = newPage();
      ctx = page.canvas.getContext('2d') as CanvasRenderingContext2D;
      pages.push(page.canvas);
      pageNo += 1;
      y = MARGIN;
      // ترويسة استمرار
      text(
        ctx,
        `${payload.storeName} — تقرير الفواتير (تابع)`,
        MARGIN + TABLE_W,
        y + 10,
        `800 15px ${FONT}`,
        INK,
      );
      y += 30;
      tableY = drawTableHeader(y);
      zebra = false;
    }
    // صف مخطط
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

    const isReturn = row.invoice.startsWith('RET-');
    const isDebt =
      !isReturn &&
      (row.invoice.startsWith('INV-D-') ||
        row.invoice.startsWith('INV-L-'));
    const methodLabel = isReturn
      ? '—'
      : paymentMethodById(row.paymentMethod).label;
    const valueColor = isReturn ? '#DC2626' : isDebt ? '#B45309' : INK;

    let x = MARGIN + TABLE_W;
    const cells: Record<string, string> = {
      invoice: row.invoice,
      kind: row.kindLabel,
      method: methodLabel,
      items: String(row.itemsCount),
      total: row.total.toFixed(2),
      returned: row.returned > 0 ? row.returned.toFixed(2) : '—',
      date: row.createdAt.replace('T', ' ').slice(0, 16),
    };
    for (const col of COLS) {
      text(
        ctx,
        cells[col.key],
        x - 12,
        tableY + rowH / 2,
        `600 13px ${FONT}`,
        col.key === 'invoice' || col.key === 'total' || col.key === 'returned'
          ? valueColor
          : col.key === 'kind' && isReturn
          ? '#DC2626'
          : INK,
      );
      x -= col.width;
    }
    tableY += rowH;
  }

  // صف الإجماليات
  if (tableY + rowH + 6 > tableBottom) {
    drawPageFooter();
    page = newPage();
    ctx = page.canvas.getContext('2d') as CanvasRenderingContext2D;
    pages.push(page.canvas);
    pageNo += 1;
    y = MARGIN;
    tableY = drawTableHeader(y);
  }
  ctx.fillStyle = '#FFF7ED';
  ctx.fillRect(MARGIN, tableY, TABLE_W, rowH);
  ctx.strokeStyle = BRAND;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(MARGIN, tableY, TABLE_W, rowH);
  let x = MARGIN + TABLE_W;
  const totalCells: Record<string, string> = {
    invoice: 'الإجماليات',
    kind: `${rows.length} عملية`,
    method: '',
    items: '',
    total: (summary.sales - summary.returned).toFixed(2),
    returned: (summary.returns - summary.returned).toFixed(2),
    date: '',
  };
  for (const col of COLS) {
    text(
      ctx,
      totalCells[col.key],
      x - 12,
      tableY + rowH / 2,
      `800 14px ${FONT}`,
      BRAND,
    );
    x -= col.width;
  }
  drawPageFooter();
  return pages;
}

/* ── ضغط الصفحات وكتابة PDF (نفس نمط BarcodePdfService) ── */

async function deflateRgb(
  canvas: HTMLCanvasElement,
): Promise<Uint8Array | null> {
  try {
    const ctx = canvas.getContext('2d');
    if (ctx == null) return null;
    const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buffer = await new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      }),
    ).arrayBuffer();
    const cs = new CompressionStream('deflate');
    const compressed = await new Response(
      new Blob([buffer]).stream().pipeThrough(cs),
    ).arrayBuffer();
    return new Uint8Array(compressed);
  } catch {
    return null;
  }
}

function pageToJpeg(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function buildInvoicesReportPdf(
  payload: InvoicesReportPayload,
): Promise<{bytes: Uint8Array; pages: number}> {
  if (payload.rows.length === 0) {
    throw new Error('لا فواتير تطابق الفلاتر الحالية — غيّر الفلاتر ثم أعد');
  }
  const canvases = renderPages(payload);
  const images: {
    data: Uint8Array;
    filter: 'FlateDecode' | 'DCTDecode';
  }[] = [];
  for (const canvas of canvases) {
    const deflated = await deflateRgb(canvas);
    images.push(
      deflated != null
        ? {data: deflated, filter: 'FlateDecode'}
        : {data: pageToJpeg(canvas), filter: 'DCTDecode'},
    );
  }

  const encoder = new TextEncoder();
  const parts: {text?: string; bytes?: Uint8Array}[] = [];
  const offsets: number[] = [];
  let runningLength = 0;

  const pushText = (textBody: string): number => {
    offsets.push(runningLength);
    parts.push({text: textBody});
    runningLength += encoder.encode(textBody).length;
    return offsets.length;
  };
  const pushBinary = (
    prefix: string,
    bytes: Uint8Array,
    suffix: string,
  ): number => {
    offsets.push(runningLength);
    parts.push({text: prefix});
    const prefixLength = encoder.encode(prefix).length;
    parts.push({bytes});
    parts.push({text: suffix});
    runningLength += prefixLength + bytes.length + encoder.encode(suffix).length;
    return offsets.length;
  };

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  parts.push({text: header});
  runningLength += encoder.encode(header).length;

  const catalogId = 1;
  const pagesId = 2;
  offsets.push(runningLength);
  parts.push({text: '__CATALOG__'});
  const catalogOffsetIndex = offsets.length - 1;
  offsets.push(runningLength);
  parts.push({text: '__PAGES__'});
  const pagesOffsetIndex = offsets.length - 1;

  const pageIds: number[] = [];
  for (const image of images) {
    const imageId = offsets.length + 1;
    pushBinary(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${PAGE_W_PX} /Height ${PAGE_H_PX} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`,
      image.data,
      '\nendstream\nendobj\n',
    );
    const contentBody = `q ${PAGE_W_PT.toFixed(2)} 0 0 ${PAGE_H_PT.toFixed(2)} 0 0 cm /Im Do Q`;
    const contentId = offsets.length + 1;
    pushText(
      `${contentId} 0 obj\n<< /Length ${contentBody.length} >>\nstream\n${contentBody}\nendstream\nendobj\n`,
    );
    const pageId = offsets.length + 1;
    pushText(
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W_PT.toFixed(2)} ${PAGE_H_PT.toFixed(2)}] /Resources << /XObject << /Im ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
    pageIds.push(pageId);
  }

  const catalogBody = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
  parts[catalogOffsetIndex + 1] = {text: catalogBody};
  offsets[catalogOffsetIndex] = runningLength;
  runningLength += encoder.encode(catalogBody).length;
  offsets[pagesOffsetIndex] = runningLength;
  const pagesBody = `${pagesId} 0 obj\n<< /Type /Pages /Kids [${pageIds
    .map(id => `${id} 0 R`)
    .join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;
  parts[pagesOffsetIndex + 1] = {text: pagesBody};
  runningLength += encoder.encode(pagesBody).length;

  const finalOffsets: number[] = [];
  let cursor = encoder.encode(header).length;
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.text != null) {
      finalOffsets.push(cursor);
      cursor += encoder.encode(part.text).length;
    } else if (part.bytes != null) {
      cursor += part.bytes.length;
    }
  }

  const xrefOffset = cursor;
  const objectCount = finalOffsets.length + 1;
  const xrefLines = [`xref\n0 ${objectCount}\n0000000000 65535 f \n`];
  for (const offset of finalOffsets) {
    xrefLines.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  const trailer = `trailer\n<< /Size ${objectCount} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push({text: xrefLines.join('') + trailer});

  const totalLength = parts.reduce(
    (sum, part) =>
      sum +
      (part.bytes != null
        ? part.bytes.length
        : encoder.encode(part.text ?? '').length),
    0,
  );
  const out = new Uint8Array(totalLength);
  let writeAt = 0;
  for (const part of parts) {
    if (part.bytes != null) {
      out.set(part.bytes, writeAt);
      writeAt += part.bytes.length;
    } else {
      const encoded = encoder.encode(part.text ?? '');
      out.set(encoded, writeAt);
      writeAt += encoded.length;
    }
  }
  return {bytes: out, pages: images.length};
}

/** حوار الحفظ الأصلي + كتابة الملف — يعيد المسار. */
export async function exportInvoicesReportPdf(
  payload: InvoicesReportPayload,
): Promise<{path: string; pages: number; count: number}> {
  const {bytes, pages} = await buildInvoicesReportPdf(payload);
  const {invoke} = await import('../lib/tauri');
  const stamp = new Date().toISOString().slice(0, 10);
  const path = await invoke<string>('save_binary_file', {
    defaultName: `sela-invoices-${stamp}.pdf`,
    data: Array.from(bytes),
  });
  return {path, pages, count: payload.rows.length};
}
