/**
 * printing/receipt.ts — قالب الفاتورة الحرارية منقول حرفياً من
 * services/printer/receipt.ts الأندرويد (نفس الترتيب، نفس التسميات
 * ASCII bidi-safe، نفس الحسابات: subtotal = total + discount).
 */
import {ReceiptBuilder, type EscPosOp} from './escpos';
import {formatDateTime} from '../core/format';
import {
  APP_NAME,
  RECEIPT_WIDTH_58,
  RECEIPT_WIDTH_80,
} from '../core/config';
import type {SaleRecord, SaleItemRecord, Product} from '../core/types';

export interface ReceiptSettings {
  storeName: string;
  storePhone: string;
  footerMessage: string;
  paperWidth: '58' | '80';
  codepage: number;
  showProfit: boolean;
  storeLogoPath?: string | null;
  /** إضافة مكتبية اختيارية (§2.ب): رمز QR برقم الفاتورة — معطل افتراضياً. */
  printQr?: boolean;
}

export interface ReceiptData {
  sale: SaleRecord;
  items: SaleItemRecord[];
  /** Product lookup so receipts can print names even after re-pricing. */
  products: Product[];
}

/** ASCII-only labels used in the money area (bidi-safe). */
const LABELS = {
  invoice: 'Invoice',
  date: 'Date',
  paymentRetail: 'RETAIL',
  paymentWholesale: 'WHOLESALE',
  subtotal: 'Subtotal',
  discount: 'Discount',
  total: 'TOTAL',
  profit: 'Net Profit',
  thanks: 'Thank You!',
} as const;

export function buildReceiptJob(data: ReceiptData, settings: ReceiptSettings): EscPosOp[] {
  const width =
    settings.paperWidth === '58' ? RECEIPT_WIDTH_58 : RECEIPT_WIDTH_80;
  const rasterWidth = settings.paperWidth === '58' ? 384 : 576;
  const b = ReceiptBuilder.create();

  // ── Optional store logo (raster, centered) ──
  if (settings.storeLogoPath) {
    b.image(settings.storeLogoPath, rasterWidth).feed(1);
  }

  // ── Header ────────────────────────────────────────────────────
  b.codepage(settings.codepage)
    .align(1)
    .bold(true)
    .size(1, 1)
    .textLine(settings.storeName || APP_NAME)
    .size(0, 0)
    .bold(false);
  if (settings.storePhone.trim()) {
    b.align(1).textLine(`Tel: ${settings.storePhone.trim()}`);
  }
  b.align(1)
    .textLine(APP_NAME)
    .align(2)
    .separator(width)
    .bold(true)
    .textLine(`${LABELS.invoice}: ${data.sale.invoice_number}`)
    .bold(false)
    .textLine(`${LABELS.date}: ${formatDateTime(data.sale.created_at)}`)
    .textLine(
      `${
        data.sale.payment_type === 'WHOLESALE'
          ? LABELS.paymentWholesale
          : LABELS.paymentRetail
      }`,
    )
    .separator(width);

  // ── Items ─────────────────────────────────────────────────────
  // Arabic name on its own right-aligned line, then ASCII money line.
  b.align(2);
  const names = new Map<number, string>(
    data.products.map(p => [p.id, p.name] as const),
  );
  for (const item of data.items) {
    const name = names.get(item.product_id) ?? `#${item.product_id}`;
    const unitSuffix =
      item.unit_name && item.unit_name !== 'قطعة' ? ` (${item.unit_name})` : '';
    b.truncate(`${name}${unitSuffix}`, width);
    b.qtyPriceLine(item.quantity, item.unit_price, item.total_line_price);
  }

  // ── Totals ────────────────────────────────────────────────────
  const subtotal = data.sale.total_amount + data.sale.discount;
  b.separator(width)
    .twoColumns(LABELS.subtotal, subtotal, width)
    .twoColumns(LABELS.discount, data.sale.discount, width)
    .bold(true)
    .twoColumns(LABELS.total, data.sale.total_amount, Math.max(width - 4, 16))
    .bold(false);

  // Manager-only net profit (never printed unless explicitly enabled).
  if (settings.showProfit) {
    b.bold(true)
      .twoColumns(LABELS.profit, data.sale.total_profit, width)
      .bold(false);
  }

  // ── QR الاختياري برقم الفاتورة والإجمالي (§2.ب — معطل افتراضياً) ──
  if (settings.printQr) {
    b.separator(width)
      .align(1)
      .qr(`${data.sale.invoice_number} | TOTAL ${data.sale.total_amount.toFixed(2)}`, 6);
  }

  // ── Footer ────────────────────────────────────────────────────
  b.separator(width)
    .align(1)
    .textLine(settings.footerMessage || 'شكراً لتعاملكم معنا — عداكم خيراً')
    .align(1)
    .bold(true)
    .textLine(LABELS.thanks)
    .bold(false)
    .feed(3)
    .cut();

  return b.build();
}

/** Small self-test receipt used by «طباعة تجريبية» (من الأندرويد + عربية مكتبية). */
export function buildTestJob(settings: ReceiptSettings): EscPosOp[] {
  const width =
    settings.paperWidth === '58' ? RECEIPT_WIDTH_58 : RECEIPT_WIDTH_80;
  const rasterWidth = settings.paperWidth === '58' ? 384 : 576;
  const b = ReceiptBuilder.create();

  if (settings.storeLogoPath) {
    b.image(settings.storeLogoPath, rasterWidth).feed(1);
  }
  b.codepage(settings.codepage)
    .align(1)
    .bold(true)
    .size(1, 1)
    .textLine(settings.storeName || APP_NAME)
    .size(0, 0)
    .bold(false)
    .align(1)
    .textLine('طباعة تجريبية - Test Print')
    .separator(width)
    .align(2)
    .textLine('شوكولاتة بالحليب 40 جرام')
    .qtyPriceLine(2, 4.5, 9)
    .textLine('عصير برتقال طبيعي')
    .qtyPriceLine(1, 6, 6)
    .separator(width)
    .twoColumns(LABELS.subtotal, 15, width)
    .twoColumns(LABELS.discount, 0, width)
    .bold(true)
    .twoColumns(LABELS.total, 15, width)
    .bold(false)
    .separator(width)
    .align(1)
    .textLine('العربية: أ ب ت ث ج ح خ د ذ ر ز')
    .textLine('English: ABCDEFG 12345')
    .textLine(`${settings.paperWidth}mm - CP${settings.codepage}`)
    .textLine('تمت الطباعة بنجاح')
    .feed(3)
    .cut();
  return b.build();
}

/** ملصق باركود لمنتج (§3.3 إضافة مكتبية): اسم + سعر + GS k CODE128. */
export function buildBarcodeLabel(
  product: import('../core/types').Product,
  width: '58' | '80',
  codepage: number,
): EscPosOp[] {
  const chars = width === '58' ? RECEIPT_WIDTH_58 : RECEIPT_WIDTH_80;
  const b = ReceiptBuilder.create();
  const code = product.barcode?.trim();
  if (!code) {
    throw new Error('هذا المنتج بلا باركود — أضف واحداً له أولاً');
  }
  b.codepage(codepage)
    .align(1)
    .bold(true)
    .truncate(product.name, chars)
    .bold(false)
    .align(2)
    .twoColumns('Retail', product.retail_price, chars)
    .twoColumns('Wholesale', product.wholesale_price, chars)
    .barcode128(code, 60)
    .feed(2)
    .cut();
  return b.build();
}
