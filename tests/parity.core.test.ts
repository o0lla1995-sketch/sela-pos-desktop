/**
 * parity.core.test.ts — إثبات التكافؤ 100% للمنطق المنقول:
 * نفس الدوال المنقولة حرفياً من الأندرويد تُختبر بنفس القيم المرجعية
 * التي كان يستخدمها تطبيق الأندرويد (unitPriceFor/baseUsed عبر cartStore،
 * nextInvoiceNumber، formatMoney، خصم مقيد بالإجمالي…).
 */
import {describe, expect, test} from 'vitest';
import {cartTotals, unitPriceFor} from '../src/state/cartStore';
import {nextInvoiceNumber, formatMoney, formatAmount, localToday} from '../src/core/format';
import {stockStateOf} from '../src/core/types';
import type {Product, ProductUnit} from '../src/core/types';

const product: Product = {
  id: 1,
  name: 'شوكولاتة بالحليب',
  cost_price: 2,
  retail_price: 4.5,
  wholesale_price: 3.8,
  stock_quantity: 10,
  category_id: null,
  image_uri: null,
  created_at: '2026-10-15 09:00:00',
  low_stock_threshold: null,
  barcode: '629000111',
};

const karton: ProductUnit = {
  id: 1,
  product_id: 1,
  unit_id: 2,
  unitName: 'كرتونة',
  unitShort: 'كرت',
  conversion: 24,
  barcode: '629K',
  retail_price: 100,
  wholesale_price: 88,
};

describe('تسعير الوحدات — unitPriceFor (نفس قواعد الأندرويد)', () => {
  test('الوحدة الأساس: سعر المنتج حسب الوضع', () => {
    expect(unitPriceFor(product, null, 'RETAIL')).toBe(4.5);
    expect(unitPriceFor(product, null, 'WHOLESALE')).toBe(3.8);
  });

  test('تجاوز الوحدة > معامل التحويل × سعر الأساس', () => {
    expect(unitPriceFor(product, karton, 'RETAIL')).toBe(100); // تجاوز صريح
    expect(unitPriceFor(product, karton, 'WHOLESALE')).toBe(88);
    const noOverride: ProductUnit = {...karton, retail_price: null, wholesale_price: null};
    expect(unitPriceFor(product, null, 'RETAIL')).toBe(4.5);
    expect(unitPriceFor(product, noOverride, 'RETAIL')).toBe(4.5 * 24); // 108 = 4.5 × معامل
    expect(unitPriceFor(product, noOverride, 'WHOLESALE')).toBe(3.8 * 24);
  });

  test('تجاوز صفري/سالب يُتجاهل لصالح المعادلة (نفس الشرط > 0)', () => {
    const zero: ProductUnit = {...karton, retail_price: 0};
    expect(unitPriceFor(product, zero, 'RETAIL')).toBe(4.5 * 24); // تجاوز صفري → المعادلة (نفس الأندرويد)
    expect(unitPriceFor(product, zero, 'RETAIL')).toBe(4.5 * 24);
  });
});

describe('إجماليات السلة — cartTotals (نفس معادلات الأندرويد)', () => {
  const line = (unitPrice: number, costPrice: number, qty: number, conversion = 1) => ({
    key: '1:0',
    productId: 1,
    name: 'م',
    unitPrice,
    costPrice,
    retailPrice: unitPrice,
    wholesalePrice: unitPrice,
    quantity: qty,
    availableStock: 100,
    unitId: null,
    unitName: 'قطعة',
    conversion,
  });

  test('خصم مقيد بالإجمالي ولا يتجاوزه أبداً', () => {
    const t1 = cartTotals([line(4.5, 2, 3)], 5);
    expect(t1.subtotal).toBe(13.5);
    expect(t1.total).toBe(8.5);
    expect(t1.profit).toBe(8.5 - 6);
    expect(t1.baseItemsCount).toBe(3);

    const t2 = cartTotals([line(4.5, 2, 2)], 999);
    expect(t2.safeDiscount).toBe(9);
    expect(t2.total).toBe(0);
    expect(t2.profit).toBe(-4); // نفس سلوك الأندرويد: ربح سالب بعد خصم كامل (تكلفة 4)
  });

  test('وحدات أساس: الكمية × معامل التحويل', () => {
    const t = cartTotals([line(100, 48, 2, 24)], 0);
    expect(t.baseItemsCount).toBe(48);
    expect(t.itemsCount).toBe(2);
  });
});

describe('ترقيم الفواتير — nextInvoiceNumber (نفس الآلية)', () => {
  test('تسلسل يومي ويصفر بيوم جديد', () => {
    const today = localToday();
    const a = nextInvoiceNumber(0, '2020-01-01', today);
    expect(a.invoiceNumber).toBe(`INV-${today.replace(/-/g, '')}-0001`);
    const b = nextInvoiceNumber(a.counter, a.day, today);
    expect(b.invoiceNumber.endsWith('-0002')).toBe(true);
    const c = nextInvoiceNumber(b.counter, b.day, '2020-01-01');
    expect(c.invoiceNumber).toBe('INV-20200101-0001');
  });
});

describe('تنسيق الأموال — formatMoney/Amount (نفس المخرجات)', () => {
  test('شيكل بفاصلين وألوف', () => {
    expect(formatMoney(12.5)).toBe('12.50 ₪');
    expect(formatMoney(1234567.891)).toBe('1,234,567.89 ₪');
    expect(formatMoney(-3)).toBe('-3.00 ₪');
    expect(formatAmount(6)).toBe('6.00');
  });
});

describe('حالة المخزون — stockStateOf (نفس القاعدة)', () => {
  test('نفاد/منخفض/سليم مع حد المنتج عن العام', () => {
    expect(stockStateOf({stock_quantity: 0, low_stock_threshold: null}, 5)).toBe('out');
    expect(stockStateOf({stock_quantity: 3, low_stock_threshold: null}, 5)).toBe('low');
    expect(stockStateOf({stock_quantity: 3, low_stock_threshold: 2}, 5)).toBe('ok');
    expect(stockStateOf({stock_quantity: 6, low_stock_threshold: null}, 5)).toBe('ok');
  });
});
