/**
 * printing/escpos.ts — تعريف عملية ESC/POS (الشكل النهائي أندرويد v57).
 * ─────────────────────────────────────────────────────────────────
 * البانية الحية (ReceiptBuilder) في services/printer/escpos.ts — المنقولة
 * حرفياً من v57. هذا الملف يحمل نوع العملية الذي يمر للنواة (Rust)
 * للترميز إلى بايتات بنفس متتاليات ThermalPrinterModule.kt.
 */
export interface EscPosOp {
  op:
    | 'init'
    | 'codepage'
    | 'align'
    | 'bold'
    | 'size'
    | 'text'
    | 'feed'
    | 'cut'
    | 'rawBase64'
    | 'qr'
    | 'barcode128'
    | 'barcode'
    | 'image';
  /** Text payload for op:'text' / op:'rawBase64'. */
  value?: string;
  /** Barcode system for op:'barcode' (v9.1 label printing). */
  system?: 'EAN13' | 'CODE128';
  /** Image file path for op:'image'. */
  path?: string;
  /** Max raster width in dots for op:'image' (58mm=384, 80mm=576). */
  maxWidth?: number;
  /** Center the raster for op:'image'. */
  center?: boolean;
  /** Code page number for op:'codepage'. */
  page?: number;
  /** 0=left 1=center 2=right for op:'align'. */
  align?: number;
  /** Bold flag for op:'bold'. */
  on?: boolean;
  /** Double-size flags for op:'size'; barcode module width for op:'barcode'. */
  width?: number;
  height?: number;
  /** Feed line count for op:'feed'. */
  lines?: number;
  /** QR module size for op:'qr'. */
  moduleSize?: number;
}
