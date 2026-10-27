/**
 * services/pdfWriter.ts — v72 (الجولة 76 #2): كاتب PDF 1.4 مشترك
 * خالص (بلا مكتبات) بجدول xref صحيح.
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر نصاً: «معالجة مشكلة ظهور صفحات الـ PDF فارغة، مكسورة،
 * أو غير قابلة للطباعة بعد تطبيق الفلترة».
 *
 * السبب الجذري (شوهد في InvoicesReportPdf و BarcodePdfService معاً):
 * حلقة حساب الإزاحات كانت تدفع إزاحة لكل جزء نصي — بما فيها لواحق
 * «endstream/endobj» لكل كائن ثنائي — فتدخل إدخالات زائفة إلى جدول
 * xref ويصبح ترقيم الكائنات بعد أول صورة منزاحاً بمقدار عدد اللواحق.
 * قارئات PDF المتسامحة تعيد البناء بالمسح الخطي فتظهر أحياناً، لكن
 * الطابعات والقارئات الصارمة ترى صفحات فارغة/مكسورة.
 *
 * الإصلاح: كل كائن يُعلَّم صراحة بعلمة obj عند بدايته، والإزاحات
 * تُحسب للكائنات المعلَّمة فقط — بقياس أطوال البايتات (UTF-8) لا
 * أطوال المحارف. الصفحات صور RGB مضغوطة FlateDecode عبر
 * CompressionStream مع سقوط JPEG (DCTDecode) عند غياب الدعم.
 */

export interface PdfPart {
  text?: string;
  bytes?: Uint8Array;
  /** true = هذا الجزء بداية كائن رقمي (يدخل جدول xref). */
  obj?: boolean;
}

export interface PdfPageImage {
  /** بيانات الصورة المضغوطة (Flate أو JPEG). */
  data: Uint8Array;
  filter: 'FlateDecode' | 'DCTDecode';
  widthPx: number;
  heightPx: number;
  /** مقاس الصفحة بالنقاط (pt). */
  wPt: number;
  hPt: number;
}

/** يضغط صفحة Canvas إلى RGB FlateDecode — أو JPEG عند الفشل. */
export async function deflateCanvasPage(
  canvas: HTMLCanvasElement,
): Promise<{data: Uint8Array; filter: 'FlateDecode' | 'DCTDecode'}> {
  try {
    const ctx = canvas.getContext('2d');
    if (ctx == null) throw new Error('no ctx');
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
    return {data: new Uint8Array(compressed), filter: 'FlateDecode'};
  } catch {
    return {data: canvasToJpeg(canvas), filter: 'DCTDecode'};
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** يبني ملف PDF كامل الصفحات (كل صفحة صورة ملء الصفحة). */
export function buildImagePagesPdf(pages: PdfPageImage[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: PdfPart[] = [];
  let runningLength = 0;
  /** عدد الكائنات المعلَّمة حتى الآن — معرّف الكائن القادم = count+1. */
  let objCount = 0;

  const pushText = (textBody: string, obj: boolean): number => {
    parts.push({text: textBody, obj});
    runningLength += encoder.encode(textBody).length;
    if (obj) {
      objCount += 1;
    }
    return objCount;
  };
  const pushBinary = (
    prefix: string,
    bytes: Uint8Array,
    suffix: string,
  ): number => {
    parts.push({text: prefix, obj: true});
    parts.push({bytes});
    parts.push({text: suffix, obj: false});
    runningLength +=
      encoder.encode(prefix).length +
      bytes.length +
      encoder.encode(suffix).length;
    objCount += 1;
    return objCount;
  };

  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  parts.push({text: header});
  runningLength += encoder.encode(header).length;

  const catalogId = 1;
  const pagesId = 2;
  // حجز الكتالوج وصفحاته أولاً — تُستبدل أجسادهما بعد معرفة كل المعرفات.
  parts.push({text: '__CATALOG__', obj: true});
  objCount += 1;
  parts.push({text: '__PAGES__', obj: true});
  objCount += 1;

  const pageIds: number[] = [];
  for (const image of pages) {
    const imageId = objCount + 1;
    pushBinary(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.widthPx} /Height ${image.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`,
      image.data,
      '\nendstream\nendobj\n',
    );
    const contentBody = `q ${image.wPt.toFixed(2)} 0 0 ${image.hPt.toFixed(2)} 0 0 cm /Im Do Q`;
    const contentId = objCount + 1;
    pushText(
      `${contentId} 0 obj\n<< /Length ${contentBody.length} >>\nstream\n${contentBody}\nendstream\nendobj\n`,
      true,
    );
    const pageId = objCount + 1;
    pushText(
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${image.wPt.toFixed(2)} ${image.hPt.toFixed(2)}] /Resources << /XObject << /Im ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
      true,
    );
    pageIds.push(pageId);
  }

  // استبدال الجسدين المحجوزين (موضعهما الفيزيائي أول الملف بعد
  // الترويسة — الإزاحات تُحسب لاحقاً بمسح الأجزاء النهائية).
  const catalogBody = `${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`;
  const pagesBody = `${pagesId} 0 obj\n<< /Type /Pages /Kids [${pageIds
    .map(id => `${id} 0 R`)
    .join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;
  const catalogSlot = parts.findIndex(
    p => p.text === '__CATALOG__' && p.obj === true,
  );
  parts[catalogSlot] = {text: catalogBody, obj: true};
  const pagesSlot = parts.findIndex(
    p => p.text === '__PAGES__' && p.obj === true,
  );
  parts[pagesSlot] = {text: pagesBody, obj: true};

  // ── الإصلاح الجذري: إزاحات الكائنات المعلَّمة فقط ──
  // كل جزء obj=true هو بداية كائن؛ اللواحق والبايتات تُخطى بلا إزاحة.
  const finalOffsets: number[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.obj === true) {
      finalOffsets.push(cursor);
    }
    if (part.bytes != null) {
      cursor += part.bytes.length;
    } else {
      cursor += encoder.encode(part.text ?? '').length;
    }
  }

  const xrefOffset = cursor;
  const objectCount = finalOffsets.length + 1;
  const xrefLines = [`xref\n0 ${objectCount}\n0000000000 65535 f \n`];
  for (const offset of finalOffsets) {
    xrefLines.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  }
  const trailer = `trailer\n<< /Size ${objectCount} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push({text: xrefLines.join('') + trailer, obj: false});

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
  return out;
}

/** ينتظر جاهزية خطوط الواجهة كي يشكّل الـ Canvas العربية بثبات
 *  (Tajawal محمّل بـ @font-face — أول رسم قبله يسقط لخط نظام). */
export async function ensureFontsReady(): Promise<void> {
  try {
    if (typeof document !== 'undefined' && document.fonts?.ready != null) {
      await document.fonts.ready;
    }
  } catch {
    /* لا يعطل التقرير أبداً */
  }
}
