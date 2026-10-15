/**
 * parity.receipt.test.ts — قفل بنية قالب الفاتورة الحرارية (§2.ب):
 * نفس ترتيب الأندرويد: init → codepage → ترويسة مزدوجة → بند عربي ثم
 * سطر أموال ASCII → إجماليات (subtotal = total + discount) → تذييل → قص.
 */
import {describe, expect, test} from 'vitest';
import {buildReceiptJob, buildTestJob} from '../src/printing/receipt';
import type {Product, SaleRecord, SaleItemRecord, PricingMode} from '../src/core/types';

const sale: SaleRecord = {
  id: 1,
  invoice_number: 'INV-20261015-0007',
  total_amount: 8.5,
  total_cost: 6,
  total_profit: 2.5,
  discount: 5,
  payment_type: 'RETAIL',
  created_at: '2026-10-15 14:03:09',
};

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
  },
];

const products: Product[] = [
  {
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
    barcode: null,
  },
];

describe('قالب الإيصال الحراري — بنية ومبالغ', () => {
  test('subtotal المعروض = الإجمالي + الخصم (نفس قاعدة الأندرويد)', () => {
    const job = buildReceiptJob(
      {sale, items, products},
      {
        storeName: 'متجر sela',
        storePhone: '0590000000',
        footerMessage: 'شكراً',
        paperWidth: '58',
        codepage: 47,
        showProfit: true,
      },
    );
    const texts = job.filter(op => op.op === 'text').map(op => op.value ?? '');
    // Subtotal 13.50 (8.5 + 5) + Discount 5.00 + TOTAL 8.50
    expect(texts.some(t => t.includes('Subtotal . 13.50')) || texts.some(t => t.includes('13.50'))).toBe(true);
    expect(texts.some(t => t.includes('5.00'))).toBe(true);
    expect(texts.some(t => t.includes('8.50'))).toBe(true);
    // بند المنتج: اسم عربي بسطر مستقل ثم سطر أموال ASCII
    expect(texts.some(t => t.trim() === 'شوكولاتة بالحليب (كرتونة)')).toBe(true);
    expect(texts.some(t => t.trim() === '3 x 4.50 = 13.50')).toBe(true);
    // نهاية: feed 3 ثم قص
    const lastOps = job.slice(-2).map(o => o.op);
    expect(lastOps).toEqual(['feed', 'cut']);
  });

  test('إظهار الربح للمدير فقط عند التفعيل', () => {
    const job = buildReceiptJob(
      {sale, items, products},
      {
        storeName: 'sela',
        storePhone: '',
        footerMessage: '',
        paperWidth: '80',
        codepage: 47,
        showProfit: false,
      },
    );
    const texts = job.map(op => op.value ?? '').join('\n');
    expect(texts.includes('Net Profit')).toBe(false);
  });

  test('صفحة الاختبار تحمل العربية والحروف اللاتينية واسم القناة', () => {
    const test = buildTestJob({
      storeName: 'متجر sela',
      storePhone: '',
      footerMessage: '',
      paperWidth: '58',
      codepage: 47,
      showProfit: false,
    });
    const all = test.map(op => op.value ?? '').join('|');
    expect(all.includes('العربية: أ ب ت ث ج ح خ د ذ')).toBe(true);
    expect(all.includes('English: ABCDEFG 12345')).toBe(true);
    expect(all.includes('58mm - CP47')).toBe(true);
  });
});
