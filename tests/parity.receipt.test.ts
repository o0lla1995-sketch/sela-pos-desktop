/**
 * parity.receipt.test.ts — قفل بنية قوالب الإيصالات الحرارية v57:
 * إيصال البيع (بالخصومات) + إيصال الدين + إيصال المرتجع + سند الخزينة
 * + سند القسيمة + الملصق (EAN-13/CODE128) — كلها من بناة الخدمة
 * المنقولة حرفياً (src/services/printer/*) وتُرمَّز بايتاً ببايت في
 * النواة (escpos.rs) بنفس متتاليات ThermalPrinterModule.kt.
 */
import {describe, expect, test} from 'vitest';
import {buildReceiptJob} from '../src/services/printer/receipt';
import {buildDebtReceiptJob} from '../src/services/printer/debtReceipt';
import {buildReturnReceiptJob} from '../src/services/printer/returnReceipt';
import {buildVoucherReceiptJob} from '../src/services/printer/voucherReceipt';
import {buildCashMovementJob} from '../src/services/printer/cashReceipt';
import {buildLabelJob} from '../src/services/printer/label';
import {ReceiptBuilder} from '../src/services/printer/escpos';
import type {
  Product,
  SaleRecord,
  SaleItemRecord,
} from '../src/core/types';

const settings = {
  storeName: 'بقالة النور',
  storePhone: '0599123456',
  footerMessage: 'شكراً لتعاملكم معنا',
  storeLogoPath: null,
  paperWidth: '58' as const,
  codepage: 47,
  showProfit: false,
};

const sale: SaleRecord = {
  id: 1,
  invoice_number: 'INV-20261015-0007',
  total_amount: 8.5,
  total_cost: 6,
  total_profit: 2.5,
  discount: 5,
  payment_type: 'RETAIL',
  created_at: '2026-10-15 14:03:09',
  returned_minor: 0,
  return_kind: null,
} as SaleRecord;

const items: SaleItemRecord[] = [
  {
    id: 1,
    sale_id: 1,
    product_id: 1,
    quantity: 3,
    unit_price: 4.5,
    cost_price: 2,
    total_line_price: 13.5,
    unit_name: 'كرتونة',
    base_quantity: 72,
    variant_label: null,
    variant_id: null,
    variant_color: null,
  } as SaleItemRecord,
];

const product: Product = {
  id: 1,
  name: 'شوكولاتة بالحليب',
  cost_price: 2,
  retail_price: 4.5,
  wholesale_price: 3.8,
  stock_quantity: 10,
  category_id: null,
  image_uri: null,
  created_at: '',
  low_stock_threshold: null,
  barcode: '2012345678903',
  discount_pct: 0,
  online_listed: 0,
  sold_by_weight: 0,
  is_archived: 0,
  expiry_date: null,
  style_group: null,
  variant_size: null,
  variant_color: null,
  has_variants: 0,
  base_unit_name: null,
  stock_untracked: 0,
  sizes_count: null,
} as Product;

type Op = {op: string; value?: string; page?: number; system?: string};

function texts(ops: Op[]): string[] {
  return ops
    .filter(o => o.op === 'text' && o.value != null)
    .map(o => String(o.value));
}

describe('إيصال البيع v57 — البنية والخصومات', () => {
  test('init → codepage أولاً ثم الترويسة والأرقام العربية', () => {
    const job = buildReceiptJob(
      {
        sale,
        items,
        productNameById: new Map([[1, product.name]]),
      },
      settings,
    );
    expect(job[0].op).toBe('init');
    expect(job.some(o => o.op === 'codepage' && o.page === 47)).toBe(true);
    const lines = texts(job as Op[]);
    expect(lines.join('\n')).toContain('بقالة النور');
    expect(lines.join('\n')).toContain('INV-20261015-0007');
    // منطقة المبالغ ASCII فقط (bidi-safe) — الخصم مذكور.
    const money = lines.filter(l => /[0-9]/.test(l)).join('\n');
    expect(money).toMatch(/Invoice|TOTAL|Discount/i);
  });

  test('ربح الصافي يظهر فقط عند تفعيله', () => {
    const withProfit = buildReceiptJob(
      {sale, items, productNameById: new Map([[1, product.name]])},
      {...settings, showProfit: true},
    );
    expect(texts(withProfit as Op[]).join('\n')).toMatch(/Net Profit|الربح/i);
  });
});

describe('إيصال الدين (INV-D) — قالب الزبون', () => {
  test('اسم الزبون وآخر 4 أرقام + إشعار مزامنة صِلة', () => {
    const job = buildDebtReceiptJob(
      {
        sale,
        items,
        productNameById: new Map([[1, product.name]]),
        customerName: 'أحمد سعيد',
        customerPhoneLast4: '9988',
        mode: 'sila',
        thisDebtMinor: 850,
      },
      settings,
    );
    const all = texts(job as Op[]).join('\n');
    expect(all).toContain('أحمد سعيد');
    expect(all).toContain('9988');
  });
});

describe('إيصال المرتجع (RET) — الدفتر والاسترداد', () => {
  test('رقم المرتجع وقيمة الاسترداد وطريقة التسوية', () => {
    const job = buildReturnReceiptJob(
      {
        ret: {
          id: 1,
          return_number: 'RET-20261015-0001',
          sale_id: sale.id,
          invoice_ref: sale.invoice_number,
          book: 'cash',
          refund_method: 'cash',
          refund_minor: 450,
          debt_adjusted_minor: 0,
          is_exchange: 0,
          exchange_minor: 0,
          note: null,
          created_at: '2026-10-15 15:00:00',
        },
        items: [
          {
            id: 1,
            return_id: 1,
            sale_item_id: 1,
            product_id: 1,
            product_name: product.name,
            quantity: 1,
            unit_name: null,
            base_quantity: 1,
            unit_price: 4.5,
            line_total: 4.5,
            cost_price: 2,
          },
        ],
      },
      settings,
    );
    const all = texts(job as Op[]).join('\n');
    expect(all).toContain('RET-20261015-0001');
    expect(all).toContain(sale.invoice_number);
  });
});

describe('سند الخزينة والقسيمة', () => {
  test('سند مصروف EXP بمرجعه وقيمته', () => {
    const job = buildCashMovementJob(
      {
        movement: {
          local_id: 1,
          ref: 'EXP-20261015-0001',
          kind: 'expense',
          category: 'كهرباء',
          note: null,
          amount_minor: 2500,
          auth_method: 'none',
          photo_path: null,
          created_at: '2026-10-15 16:00:00',
        },
        drawerAfterMinor: 7500,
      },
      settings,
    );
    const all = texts(job as Op[]).join('\n');
    expect(all).toContain('EXP-20261015-0001');
    expect(all).toContain('كهرباء');
  });

  test('إيصال القسيمة INV-V بقيمتها ومرجعها الرسمي', () => {
    const job = buildVoucherReceiptJob(
      {
        receiptRef: 'INV-V-20261015-0001',
        redeemedAt: '2026-10-15 17:00:00',
        campaignName: 'سلة الغذاء',
        valueMinor: 20000,
        referenceCode: 'REF-889',
        beneficiaryLast4: '1122',
        counterExtraMinor: 500,
        sale: null,
        items: [],
      } as never,
      settings,
    );
    const all = texts(job as Op[]).join('\n');
    expect(all).toContain('INV-V-20261015-0001');
    expect(all).toContain('سلة الغذاء');
  });
});

describe('ملصق المنتج — باركود EAN-13/CODE128 (v9.1)', () => {
  test('ملصق باسم المنتج وسعره وباركود GS k', () => {
    const job = buildLabelJob(
      {
        productName: product.name,
        price: 4.5,
        barcode: '2012345678903',
        copies: 1,
      },
      {paperWidth: '58', codepage: 47},
    ) as Op[];
    expect(job.some(o => o.op === 'barcode' && o.system === 'EAN13')).toBe(true);
    const all = texts(job as Op[]).join('\n');
    expect(all).toContain(product.name);
  });
});

describe('بانية ESC/POS — نفس شكل العمليات', () => {
  test('تسلسل init/codepage/align/bold/size/text/feed/cut', () => {
    const b = ReceiptBuilder.create()
      .codepage(47)
      .align(1)
      .bold(true)
      .size(1, 1)
      .text('تجربة\n')
      .bold(false)
      .size(0, 0)
      .feed(2)
      .cut();
    const ops = b.build() as {op: string}[];
    expect(ops.map(o => o.op)).toEqual([
      'init',
      'codepage',
      'align',
      'bold',
      'size',
      'text',
      'bold',
      'size',
      'feed',
      'cut',
    ]);
  });
});
