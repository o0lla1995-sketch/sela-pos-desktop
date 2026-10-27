/**
 * BarcodePdfService — v70 (الجولة 74 #4): تحميل رموز الباركود كملف
 * PDF مقسّم على صفحات مربعة.
 * ─────────────────────────────────────────────────────────────────
 * الغرض (طلب التاجر نصاً): طباعة ملصقات الباركود على أي طابعة
 * ورقية عادية (حبر/ليزر) عند عدم توفر طابعة باركود حرارية —
 * ملصقات مربعة بهوامش واضحة لاسم المنتج ومكان القص، جاهزة
 * للقص بالمقص وتلصيقها على المنتجات.
 *
 * التصميم الهندسي:
 *  ① محرك تخطيط نقي (planLabelPages) — عدد الأعمدة والصفوف
 *     والصفحات يُحسب رياضياً من: عدد النسخ المطلوبة لكل باركود،
 *     طول الباركود (EAN-13 = 95 وحدة، CODE128 أطول حسب المحارف)،
 *     ومقاس الملصق المربع (40/50/60مم) — الأكواد الأطول تضيّق
 *     عرض الوحدة تلقائياً كي تتسع دائماً داخل الملصق.
 *  ② الصفحة: مربعة افتراضياً (شبكة الملصقات + هوامش قص 6مم) أو
 *     A4 لمن يطبع على ورق A4 — الخيار للتاجر.
 *  ③ الرسم على Canvas بدقة 300DPI — المتصفح يشكّل العربية بنفسه
 *     (RTL وربط الحروف) فلا حاجة لأي مكتبة تشكيل، والباركود
 *     يُرسم أعمدة دقيقة من encodeBarcodeBars.
 *  ④ كاتب PDF خالص (بلا مكتبات): كل صفحة صورة RGB مضغوطة
 *     FlateDecode عبر CompressionStream (بدون فقدان — حواف
 *     الباركود حادة تماماً للماسحات)، مع بديل JPEG DCTDecode
 *     للمتصفحات القديمة. ملف PDF 1.4 صالح يفتحه أي قارئ/طابعة.
 */

import {encodeBarcodeBars} from './BarcodeService';
import {formatMoney} from '../core/format';

/** بند ملصق — منتج واحد بعدد نسخه. */
export interface BarcodeLabelEntry {
  name: string;
  barcode: string;
  /** السعر المعروض تحت الباركود (null = إخفاء السعر). */
  price?: number | null;
  copies: number;
}

export interface LabelSheetOptions {
  /** ضلع الملصق المربع بالمليمتر — 40/50/60. */
  labelMm: 40 | 50 | 60;
  /** صفحة مربعة (افتراضي — طلب التاجر) أو A4 لورق الطابعات. */
  pageKind: 'square' | 'a4';
  /** طباعة السعر على الملصق. */
  showPrice: boolean;
}

export const DEFAULT_LABEL_OPTIONS: LabelSheetOptions = {
  labelMm: 50,
  pageKind: 'square',
  showPrice: true,
};

/** هوامش الصفحة (محيط القص) بالمليمتر. */
const PAGE_MARGIN_MM = 6;
/** دقة الرسم — 300 نقطة للبوصة (جودة طباعة احترافية). */
const DPI = 300;
/** تحويل ملم → بكسل عند الدقة. */
const MM_PX = DPI / 25.4;
/** مقاسات A4 بالمليمتر. */
const A4_W_MM = 210;
const A4_H_MM = 297;
/** أقصى ضلع صفحة مربعة (تُطبع بلا تحجيم على أي ورق ≥ A4). */
const SQUARE_PAGE_MAX_MM = 200;

export interface LabelPlacement {
  entryIndex: number;
  col: number;
  row: number;
}

export interface LabelPagePlan {
  /** أبعاد الصفحة بالمليمتر (مربع أو A4). */
  pageWmm: number;
  pageHmm: number;
  /** عدد الأعمدة/الصفوف المتاح بالصفحة. */
  cols: number;
  rows: number;
  placements: LabelPlacement[];
}

export interface LabelSheetPlan {
  options: LabelSheetOptions;
  pages: LabelPagePlan[];
  /** إجمالي الملصقات (مجموع النسخ). */
  totalLabels: number;
}

/** شكل الصفحة: شبكة الملصقات المتاحة وأبعادها بالمليمتر. */
export function pageGrid(options: LabelSheetOptions): {
  cols: number;
  rows: number;
  pageWmm: number;
  pageHmm: number;
} {
  if (options.pageKind === 'a4') {
    const cols = Math.max(
      1,
      Math.floor((A4_W_MM - 2 * PAGE_MARGIN_MM) / options.labelMm),
    );
    const rows = Math.max(
      1,
      Math.floor((A4_H_MM - 2 * PAGE_MARGIN_MM) / options.labelMm),
    );
    return {cols, rows, pageWmm: A4_W_MM, pageHmm: A4_H_MM};
  }
  // صفحة مربعة: أكبر شبكة كاملة تتسع بضلع ≤ 200مم.
  const usable = SQUARE_PAGE_MAX_MM - 2 * PAGE_MARGIN_MM;
  const n = Math.max(1, Math.floor(usable / options.labelMm));
  const side = n * options.labelMm + 2 * PAGE_MARGIN_MM;
  return {cols: n, rows: n, pageWmm: side, pageHmm: side};
}

/**
 * محرك التخطيط النقي — من المدخلات إلى صفحات الملصقات.
 * «بناءً على عدد وطول الباركودات»: عدد النسخ يحدد عدد الصفحات،
 * وطول الباركود يضيّق عرض وحدته داخل الملصق عند الرسم (لا عدد
 * الأعمدة — الملصق مربع ثابت المقاسات).
 */
export function planLabelPages(
  entries: BarcodeLabelEntry[],
  options: LabelSheetOptions,
): LabelSheetPlan {
  const grid = pageGrid(options);
  const capacity = grid.cols * grid.rows;
  const pages: LabelPagePlan[] = [];
  let current: LabelPlacement[] = [];

  const pushLabel = (entryIndex: number) => {
    if (current.length === capacity) {
      pages.push({...grid, placements: current});
      current = [];
    }
    const slot = current.length;
    current.push({
      entryIndex,
      col: slot % grid.cols,
      row: Math.floor(slot / grid.cols),
    });
  };

  let total = 0;
  entries.forEach((entry, entryIndex) => {
    const copies = Math.max(1, Math.round(entry.copies || 1));
    for (let i = 0; i < copies; i += 1) {
      pushLabel(entryIndex);
      total += 1;
    }
  });
  if (current.length > 0 || pages.length === 0) {
    pages.push({...grid, placements: current});
  }
  return {options, pages, totalLabels: total};
}

/** لف نص عربي على سطرين كحد أقصى. */
export function wrapName(name: string, maxCharsPerLine: number): string[] {
  const trimmed = name.trim();
  if (trimmed.length <= maxCharsPerLine) {
    return [trimmed];
  }
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxCharsPerLine && line) {
      lines.push(line);
      line = word;
      if (lines.length === 2) {
        break;
      }
    } else {
      line = candidate;
    }
  }
  if (lines.length < 2 && line) {
    lines.push(line);
  }
  if (lines.length === 2) {
    const consumed = `${lines[0]} ${lines[1]}`.trim().length;
    if (trimmed.length > consumed) {
      lines[1] = `${lines[1].slice(0, Math.max(1, maxCharsPerLine - 1))}…`;
    }
  }
  return lines.slice(0, 2);
}

/** رسم ملصق واحد مربع — اسم + باركود + كود + سعر + إطار قص. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  entry: BarcodeLabelEntry,
  xPx: number,
  yPx: number,
  sizePx: number,
  options: LabelSheetOptions,
): void {
  const padPx = 2.2 * MM_PX;

  // إطار القص المتقطع حول الملصق (مسار المقص).
  ctx.save();
  ctx.strokeStyle = '#B9C0CC';
  ctx.lineWidth = Math.max(1, 0.25 * MM_PX);
  ctx.setLineDash([2.2 * MM_PX, 1.6 * MM_PX]);
  ctx.strokeRect(xPx + 0.5, yPx + 0.5, sizePx - 1, sizePx - 1);
  ctx.restore();

  // علامات قص بالزوايا (نمط المطبوعات الاحترافي).
  ctx.save();
  ctx.strokeStyle = '#8E97A6';
  ctx.lineWidth = Math.max(1, 0.35 * MM_PX);
  const crop = 3 * MM_PX;
  const corners: [number, number, number, number][] = [
    [xPx, yPx, 1, 1],
    [xPx + sizePx, yPx, -1, 1],
    [xPx, yPx + sizePx, 1, -1],
    [xPx + sizePx, yPx + sizePx, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * crop, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * crop);
    ctx.stroke();
  }
  ctx.restore();

  // ── اسم المنتج (عربي RTL — أعلى الملصق بهامش واضحة) ──
  const nameLines = wrapName(entry.name, options.labelMm >= 50 ? 18 : 13);
  const nameFontPx = (options.labelMm >= 50 ? 3.4 : 2.8) * MM_PX;
  ctx.save();
  ctx.fillStyle = '#111418';
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${nameFontPx}px "Tajawal", "Segoe UI", "Arial", sans-serif`;
  let textY = yPx + padPx;
  for (const lineText of nameLines) {
    ctx.fillText(lineText, xPx + sizePx / 2, textY, sizePx - 2 * padPx);
    textY += nameFontPx * 1.22;
  }
  ctx.restore();

  // ── الباركود — عرض الوحدة يتكيف مع طول الكود ──
  const pattern = encodeBarcodeBars(entry.barcode);
  const bottomPadPx = options.showPrice ? 5.2 * MM_PX : 3.4 * MM_PX;
  const barsBottom = yPx + sizePx - padPx - bottomPadPx;
  if (pattern != null) {
    const modules = pattern.bits.length;
    const maxBarWidth = (sizePx - 2 * padPx) / modules;
    // X-dimension: ≥ 0.19مم (أدنى معيار مسح EAN) وما أمكن 0.33مم —
    // الأكواد الأطول (CODE128) تضيق تلقائياً وتتسع دائماً.
    const modulePx = Math.max(
      0.19 * MM_PX,
      Math.min(0.33 * MM_PX, maxBarWidth),
    );
    const barcodeWidth = modules * modulePx;
    const barcodeLeft = xPx + (sizePx - barcodeWidth) / 2;
    const barTop = textY + 1.6 * MM_PX;
    const barHeight = Math.max(6 * MM_PX, barsBottom - barTop - 3.2 * MM_PX);
    ctx.save();
    ctx.fillStyle = '#000';
    for (let i = 0; i < modules; i += 1) {
      if (pattern.bits[i] === '1') {
        ctx.fillRect(
          barcodeLeft + i * modulePx,
          barTop,
          Math.max(1, Math.ceil(modulePx)),
          barHeight,
        );
      }
    }
    ctx.restore();

    // نص الكود تحت الأعمدة (أرقام/حروف LTR).
    ctx.save();
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#111418';
    ctx.font = `600 ${2.6 * MM_PX}px "Segoe UI", "Arial", sans-serif`;
    ctx.fillText(
      entry.barcode,
      xPx + sizePx / 2,
      barTop + barHeight + 0.6 * MM_PX,
      sizePx - 2 * padPx,
    );
    ctx.restore();
  } else {
    // باركود غير قابل للرسم — يُكتب نصاً كي لا يخرج ملصق فارغ.
    ctx.save();
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#991B1B';
    ctx.font = `600 ${2.4 * MM_PX}px "Segoe UI", "Arial", sans-serif`;
    ctx.fillText(
      entry.barcode,
      xPx + sizePx / 2,
      (textY + barsBottom) / 2,
      sizePx - 2 * padPx,
    );
    ctx.restore();
  }

  // ── السعر (اختياري) أسفل الكود ──
  if (options.showPrice && entry.price != null && Number.isFinite(entry.price)) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#0B7A3B';
    ctx.font = `800 ${3.6 * MM_PX}px "Tajawal", "Segoe UI", "Arial", sans-serif`;
    ctx.fillText(
      formatMoney(entry.price),
      xPx + sizePx / 2,
      yPx + sizePx - padPx,
      sizePx - 2 * padPx,
    );
    ctx.restore();
  }
}

interface RenderedPage {
  rgba: Uint8ClampedArray;
  widthPx: number;
  heightPx: number;
  wPt: number;
  hPt: number;
}

/** رسم صفحة واحدة على Canvas. */
function renderPage(
  plan: LabelPagePlan,
  entries: BarcodeLabelEntry[],
  options: LabelSheetOptions,
): RenderedPage {
  const widthPx = Math.round(plan.pageWmm * MM_PX);
  const heightPx = Math.round(plan.pageHmm * MM_PX);
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (ctx == null) {
    throw new Error('تعذر تهيئة محرك الرسم');
  }
  // خلفية بيضاء (الشفافية تُطبع سوداء على بعض الطابعات).
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, widthPx, heightPx);

  const labelPx = options.labelMm * MM_PX;
  for (const placement of plan.placements) {
    const entry = entries[placement.entryIndex];
    if (entry == null) {
      continue;
    }
    drawLabel(
      ctx,
      entry,
      PAGE_MARGIN_MM * MM_PX + placement.col * labelPx,
      PAGE_MARGIN_MM * MM_PX + placement.row * labelPx,
      labelPx,
      options,
    );
  }
  const image = ctx.getImageData(0, 0, widthPx, heightPx);
  return {
    rgba: image.data,
    widthPx,
    heightPx,
    wPt: (plan.pageWmm * 72) / 25.4,
    hPt: (plan.pageHmm * 72) / 25.4,
  };
}

/** ضغط بكسلات RGB بضغط بلا فقدان (zlib deflate = FlateDecode في
 *  PDF) عبر CompressionStream — null إن لم تدعمه البيئة. */
async function deflateRgb(
  rgba: Uint8ClampedArray,
): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') {
    return null;
  }
  try {
    const rgb = new Uint8Array((rgba.length / 4) * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    const stream = new Blob([rgb as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/** JPEG fallback — يُستعمل نادراً حيث لا يوجد CompressionStream. */
function pageToJpeg(page: RenderedPage): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = page.widthPx;
  canvas.height = page.heightPx;
  const ctx = canvas.getContext('2d');
  if (ctx == null) {
    throw new Error('تعذر تهيئة محرك الرسم');
  }
  ctx.putImageData(new ImageData(page.rgba, page.widthPx, page.heightPx), 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** كاتب PDF 1.4 — صفحات كصور كاملة (كل النص مرسوم داخلها بعربية
 *  صحيحة من محرك المتصفح، وحواف الباركود حادة بلا ضغط معتبر). */
export async function buildLabelsPdf(
  entries: BarcodeLabelEntry[],
  options: LabelSheetOptions,
): Promise<{bytes: Uint8Array; totalLabels: number; pages: number}> {
  const plan = planLabelPages(entries, options);
  if (plan.totalLabels === 0) {
    throw new Error('لا توجد ملصقات للتصدير — أضف منتجات أولاً');
  }

  interface PageImage {
    data: Uint8Array;
    filter: 'FlateDecode' | 'DCTDecode';
    wPt: number;
    hPt: number;
    widthPx: number;
    heightPx: number;
  }
  const images: PageImage[] = [];
  for (const page of plan.pages) {
    const rendered = renderPage(page, entries, options);
    const deflated = await deflateRgb(rendered.rgba);
    if (deflated != null) {
      images.push({
        data: deflated,
        filter: 'FlateDecode',
        wPt: rendered.wPt,
        hPt: rendered.hPt,
        widthPx: rendered.widthPx,
        heightPx: rendered.heightPx,
      });
    } else {
      images.push({
        data: pageToJpeg(rendered),
        filter: 'DCTDecode',
        wPt: rendered.wPt,
        hPt: rendered.hPt,
        widthPx: rendered.widthPx,
        heightPx: rendered.heightPx,
      });
    }
  }

  // ── كائنات PDF: 1 كتالوج، 2 صفحات، ثم لكل صفحة (صورة + محتوى
  //    + صفحة) بترتيب ثابت قابل للتجميع الخطي البسيط. ──
  const encoder = new TextEncoder();
  const parts: {text?: string; bytes?: Uint8Array}[] = [];
  const offsets: number[] = [];
  let runningLength = 0;

  const pushText = (text: string): number => {
    offsets.push(runningLength);
    parts.push({text});
    runningLength += encoder.encode(text).length;
    return offsets.length; // معرف الكائن = ترتيبه
  };
  const pushBinary = (prefix: string, bytes: Uint8Array, suffix: string): number => {
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
  // يُحجز ترتيبهما أولاً ثم تُكتب أجسادهما بعد معرفة معرفات الصفحات.
  offsets.push(runningLength);
  parts.push({text: '__CATALOG__'});
  runningLength += 0; // يُستبدل لاحقاً بطوله الفعلي
  const catalogOffsetIndex = offsets.length - 1;

  offsets.push(runningLength);
  parts.push({text: '__PAGES__'});
  const pagesOffsetIndex = offsets.length - 1;

  const pageIds: number[] = [];
  for (const image of images) {
    const imageId = offsets.length + 1;
    pushBinary(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.widthPx} /Height ${image.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`,
      image.data,
      '\nendstream\nendobj\n',
    );
    const contentBody = `q ${image.wPt.toFixed(2)} 0 0 ${image.hPt.toFixed(2)} 0 0 cm /Im Do Q`;
    const contentId = offsets.length + 1;
    pushText(
      `${contentId} 0 obj\n<< /Length ${contentBody.length} >>\nstream\n${contentBody}\nendstream\nendobj\n`,
    );
    const pageId = offsets.length + 1;
    pushText(
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${image.wPt.toFixed(2)} ${image.hPt.toFixed(2)}] /Resources << /XObject << /Im ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
    pageIds.push(pageId);
  }

  // استبدال العنصرين المحجوزين بأجساد فعلية (مع ضبط الإزاحات).
  const catalogBody = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
  parts[catalogOffsetIndex + 1] = {text: catalogBody};
  offsets[catalogOffsetIndex] = runningLength;
  runningLength += encoder.encode(catalogBody).length;
  // إزاحة كائن الصفحات الآن بعد الكتالوج.
  offsets[pagesOffsetIndex] = runningLength;
  const pagesBody = `${pagesId} 0 obj\n<< /Type /Pages /Kids [${pageIds
    .map(id => `${id} 0 R`)
    .join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;
  parts[pagesOffsetIndex + 1] = {text: pagesBody};
  runningLength += encoder.encode(pagesBody).length;

  // لكن الصور حُجزت قبل حساب إزاحات الكتالوج/الصفحات الصحيحة —
  // الإزاحات تُحسب من جديد تسلسلياً على القطع النهائية.
  const finalOffsets: number[] = [];
  let cursor = encoder.encode(header).length;
  // parts: [header, __CATALOG__ slot, __PAGES__ slot, ...rest]
  // الترتيب الفيزيائي: header ثم كتالوج ثم صفحات ثم باقي الكائنات
  // بترتيب إدراجها (صورة/محتوى/صفحة...).
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.text != null) {
      if (i - 1 < 2) {
        // أول عنصرين نصيان بعد الترويسة = الكتالوج والصفحات.
        finalOffsets.push(cursor);
        cursor += encoder.encode(part.text).length;
      } else {
        // كائن نصي — إزاحته ترتيبها.
        finalOffsets.push(cursor);
        cursor += encoder.encode(part.text).length;
      }
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

  // ── الدمج النهائي في مصفوفة بايتات واحدة ──
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

  return {
    bytes: out,
    totalLabels: plan.totalLabels,
    pages: images.length,
  };
}

/**
 * حوار الحفظ + كتابة ملف PDF — يعيد المسار أو رمي إلغاء واضح.
 */
export async function exportLabelsPdf(
  entries: BarcodeLabelEntry[],
  options: LabelSheetOptions,
): Promise<{path: string; totalLabels: number; pages: number}> {
  const {bytes, totalLabels, pages} = await buildLabelsPdf(entries, options);
  const {invoke} = await import('../lib/tauri');
  const stamp = new Date().toISOString().slice(0, 10);
  const path = await invoke<string>('save_binary_file', {
    defaultName: `sela-barcodes-${stamp}.pdf`,
    // Vec<u8> في Rust يستقبل مصفوفة أرقام JSON — الملصقات المضغوطة
    // بضع مئات الكيلوبايت للصفحة فالحجم مقبول تماماً.
    data: Array.from(bytes),
  });
  return {path, totalLabels, pages};
}
