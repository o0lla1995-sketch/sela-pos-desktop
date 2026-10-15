/**
 * native/nativeBridge.ts — غلاف توافقي لسطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 * نفس واجهة أندرويد v57 التي تستوردها الملفات المنقولة حرفياً،
 * والتنفيذ فوق أوامر Tauri/النواة:
 *  • EscPosOp — من printing/escpos (الترميز في النواة Rust).
 *  • PlatformUtilsNative — ملفات (وجود/بصمة)، كشف خزينة HTML، فتح مسار.
 *  • ImageDecoderNative.compressToWebP — ضغط JPEG عبر النواة (نفس العقد؛
 *    سطح المكتب يرفع jpg والخادم يقبل كليهما).
 *  • SelaNotificationsNative = null — إشعارات النظام غير مضامة؛ مركز
 *    الإشعارات داخل التطبيق يسجل كل شيء (نفس سلوك سطح المكتب v1).
 *  • biometricAuthenticate — يعيد false دائماً (لا مستشعر بصمة على
 *    المكتب) فتتجه العمليات المؤمّنة إلى لوحة PIN (مدعومة كاملة).
 */
import {invoke} from '../lib/tauri';

export type {EscPosOp} from '../printing/escpos';

export interface PlatformUtilsNative {
  fileExists(path: string): Promise<boolean>;
  fileSignature(path: string): Promise<string>;
  readFileBase64(path: string): Promise<string>;
  writeFileBase64(subdir: string, name: string, data: string): Promise<string>;
  exportReceiptImage(fileName: string, payloadJson: string): Promise<string>;
  createStatementPdf(fileName: string, payloadJson: string): Promise<string>;
  shareExportedPdf(fileName: string, title: string): Promise<void>;
  printExportedPdf(fileName: string, title: string): Promise<void>;
}

export interface ImageDecoderNative {
  compressToWebP(
    path: string,
    maxDim: number,
    quality: number,
  ): Promise<{
    base64: string;
    hash: string;
    ext: 'webp' | 'jpg';
    width: number;
    height: number;
  }>;
}

export interface SelaNotificationsNativeModule {
  show(
    id: number,
    title: string,
    body: string,
    channel: string,
  ): Promise<void>;
}

const platformUtils: PlatformUtilsNative = {
  async fileExists(path: string): Promise<boolean> {
    return invoke<boolean>('fs_file_exists', {path});
  },
  async fileSignature(path: string): Promise<string> {
    return invoke<string>('fs_file_signature', {path});
  },
  async readFileBase64(path: string): Promise<string> {
    return invoke<string>('fs_read_file_base64', {path});
  },
  async writeFileBase64(
    subdir: string,
    name: string,
    data: string,
  ): Promise<string> {
    return invoke<string>('fs_write_file_base64', {subdir, name, data});
  },
  async exportReceiptImage(): Promise<string> {
    throw new Error('مشاركة صورة الإيصال غير مدعومة على سطح المكتب');
  },
  /** كشف الخزينة: مستند HTML عربي (RTL) يُحفظ بحوار أصلي — يُطبع
   *  أو يُصدَّر PDF من متصفح النظام (عرض الطباعة الافتراضي). */
  async createStatementPdf(fileName: string, payloadJson: string): Promise<string> {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const html = buildStatementHtml(payload);
    const name = fileName.replace(/\.pdf$/i, '.html');
    const path = await invoke<string>('save_text_file', {
      defaultName: name,
      contents: html,
    });
    return path;
  },
  async shareExportedPdf(fileName: string): Promise<void> {
    // سطح المكتب: فتح الملف المحفوظ بالتطبيق الافتراضي (متصفح).
    await invoke('open_path', {path: fileName});
  },
  async printExportedPdf(fileName: string): Promise<void> {
    await invoke('open_path', {path: fileName});
  },
};

const imageDecoder: ImageDecoderNative = {
  async compressToWebP(path: string, maxDim: number, quality: number) {
    return invoke<{
      base64: string;
      hash: string;
      ext: 'webp' | 'jpg';
      width: number;
      height: number;
    }>('image_compress', {path, maxDim, quality});
  },
};

export const PlatformUtilsNative: PlatformUtilsNative | null = platformUtils;
export const ImageDecoderNative: ImageDecoderNative | null = imageDecoder;
export const SelaNotificationsNative: SelaNotificationsNativeModule | null = null;

export function requirePlatformUtils(): PlatformUtilsNative {
  if (PlatformUtilsNative == null) {
    throw new Error('وحدة أدوات النظام غير متوفرة في هذا الإصدار من التطبيق');
  }
  return PlatformUtilsNative;
}

/** لا مستشعر بصمة على سطح المكتب — false يفتح مسار PIN. */
export async function biometricAuthenticate(
  _title: string,
  _subtitle: string,
  _cancelText: string,
): Promise<boolean> {
  return false;
}

/** كشف الخزينة HTML — عربي RTL بطباعة نظيفة من المتصفح. */
function buildStatementHtml(payload: Record<string, unknown>): string {
  const rows = (payload.rows ?? []) as Record<string, string>[];
  const esc = (v: string) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const body = rows
    .map(
      r => `<tr><td>${esc(r.date)}</td><td>${esc(r.kind)}</td><td>${esc(
        r.category,
      )}</td><td>${esc(r.note)}</td><td class="num">${esc(r.amount)}</td></tr>`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(String(payload.title ?? 'كشف حركات الخزينة'))}</title>
<style>
  body{font-family:'Segoe UI',Tahoma,sans-serif;direction:rtl;margin:32px;color:#111}
  h1{font-size:20px;margin:0 0 4px}
  .meta{color:#555;font-size:13px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border:1px solid #ccc;padding:7px 10px;text-align:right}
  th{background:#f5f5f5}
  .num{direction:ltr;text-align:left;font-variant-numeric:tabular-nums}
  tfoot td{font-weight:700;background:#fafafa}
  .footer{margin-top:24px;color:#777;font-size:12px}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(String(payload.title ?? 'كشف حركات الخزينة'))}</h1>
<div class="meta">${esc(String(payload.subtitle ?? ''))}</div>
<table><thead><tr><th>التاريخ</th><th>النوع</th><th>التصنيف</th><th>ملاحظة</th><th>المبلغ</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><td colspan="4">الصافي</td><td class="num">${esc(
    String(payload.net ?? ''),
  )}</td></tr></tfoot>
</table>
<div class="footer">${esc(String(payload.footer ?? ''))} — سيلا POS</div>
</body></html>`;
}
