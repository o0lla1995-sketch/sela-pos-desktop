/**
 * parity.core.test.ts — التكافؤ المحاسبي v57: الخدمات المنقولة حرفياً
 * من أندرويد تعمل هنا ضد قاعدة SQLite حقيقية (node:sqlite بنفس DDL
 * النواة المستخرج من db.rs) عبر محاكاة جسر Tauri — نفس مسارات
 * التشغيل الفعلية بلا أي اختصار.
 */
import {vi, describe, test, expect, beforeEach} from 'vitest';
import {
  bootHarness,
  harnessDb,
  harnessInvoke,
  ensureBooted,
} from './helpers/desktopHarness';

vi.mock('../src/lib/tauri', async () => {
  const harness = await import('./helpers/desktopHarness');
  return {
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      Promise.resolve(harness.harnessInvoke(cmd, args ?? {})),
    onBarcode: async () => () => {},
    api: new Proxy(
      {} as Record<string, unknown>,
      {
        get: (_t, prop) => {
          const name = String(prop);
          // طرق التخزين تمر عبر config_* الحقيقي (المرآة تحتاجها).
          const map: Record<string, string> = {
            configGetAll: 'config_get_all',
            configSet: 'config_set',
            configRemove: 'config_remove',
          };
          const cmd = map[name];
          return (...args: unknown[]) => {
            if (cmd === 'config_get_all') {
              return Promise.resolve(
                harness.harnessInvoke('config_get_all', {}),
              );
            }
            if (cmd === 'config_set') {
              return Promise.resolve(
                harness.harnessInvoke('config_set', {
                  key: args[0] as string,
                  value: args[1],
                }),
              );
            }
            if (cmd === 'config_remove') {
              return Promise.resolve(
                harness.harnessInvoke('config_remove', {key: args[0] as string}),
              );
            }
            throw new Error(`api.${name} غير متاح في الاختبارات`);
          };
        },
      },
    ) as unknown as Record<string, never>,
  };
});

// استيراد الخدمات بعد تفعيل المحاكاة (vitest يرفع vi.mock أولاً).
import {InvoiceService} from '../src/services/InvoiceService';
import {SaleRepo} from '../src/database/repositories/SaleRepo';
import {ProductRepo} from '../src/database/repositories/ProductRepo';
import {CashService} from '../src/services/CashService';
import {ReportService} from '../src/services/ReportService';
import {LocalDebtsRepo} from '../src/database/repositories/LocalDebtsRepo';
import {SilaRepo} from '../src/services/sila/SilaRepo';
import {cartTotals} from '../src/stores/cartStore';
import {applyAmountKey} from '../src/core/amountKeypad';
import {parseSilaQr} from '../src/services/sila/qr';
import type {Product, CartLine} from '../src/core/types';

const receipt = () => ({
  storeName: 'متجر اختبار',
  storePhone: '',
  footerMessage: '',
  storeLogoPath: null,
  paperWidth: '58' as const,
  codepage: 47,
  showProfit: false,
});

function minor(amount: number): number {
  return Math.round(amount * 100);
}

/** إنشاء منتج مباشرة في القاعدة (نفس أعمدة ProductRepo.create). */
async function makeProduct(input: {
  name: string;
  cost: number;
  retail: number;
  wholesale?: number;
  stock?: number;
  discountPct?: number;
  stockUntracked?: boolean;
}): Promise<Product> {
  const id = await ProductRepo.create({
    name: input.name,
    cost_price: input.cost,
    retail_price: input.retail,
    wholesale_price: input.wholesale ?? input.retail,
    stock_quantity: input.stock ?? 100,
    category_id: null,
    image_uri: null,
    low_stock_threshold: null,
    barcode: null,
    discount_pct: input.discountPct ?? 0,
    online_listed: 0,
    sold_by_weight: 0,
    expiry_date: null,
    style_group: null,
    variant_size: null,
    variant_color: null,
    has_variants: 0,
    base_unit_name: null,
    stock_untracked: input.stockUntracked ? 1 : 0,
    sizes_count: null,
  });
  const product = await ProductRepo.getById(id);
  if (product == null) throw new Error('تعذر إنشاء منتج الاختبار');
  return product;
}

function line(
  product: Product,
  qty: number,
  unitPrice: number,
): CartLine {
  return {
    key: `${product.id}:${unitPrice}`,
    productId: product.id,
    name: product.name,
    quantity: qty,
    unitPrice,
    costPrice: product.cost_price,
    unitName: null,
    conversion: 1,
    baseQty: qty,
    variantId: null,
    variantLabel: null,
    variantColor: null,
    bundleColor: null,
  } as unknown as CartLine;
}

beforeEach(() => {
  bootHarness(':memory:');
});

describe('بيع نقدي — الحساب والخصومات (v57)', () => {
  test('إجماليات صحيحة مع خصم فاتورة وخصم منتج، والربح صادق', async () => {
    const cola = await makeProduct({name: 'كولا', cost: 2, retail: 4, stock: 50});
    const choco = await makeProduct({
      name: 'شوكولاتة',
      cost: 3,
      retail: 6,
      stock: 50,
      discountPct: 50,
    });
    // خصم المنتج 50% → شوكولاتة فعلياً 3.
    const lines = [line(cola, 2, 4), line(choco, 1, 3)];
    const totals = cartTotals(lines, 1);
    expect(totals.subtotal).toBeCloseTo(11, 6); // 8 + 3
    expect(totals.safeDiscount).toBe(1);
    expect(totals.total).toBeCloseTo(10, 6);
    expect(totals.totalCost).toBe(7); // 2×2 + 3
    expect(totals.profit).toBeCloseTo(3, 6);

    const sale = await InvoiceService.completeSale({
      lines,
      discount: 1,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    });
    expect(sale.sale.total_amount).toBeCloseTo(10, 6);
    expect(sale.sale.total_profit).toBeCloseTo(3, 6);
    expect(sale.sale.invoice_number).toMatch(/^INV-\d{8}-\d{4}$/);

    // المخزون نقص فعلياً.
    const after = await ProductRepo.getById(cola.id);
    expect(after?.stock_quantity).toBe(48);
    const afterChoco = await ProductRepo.getById(choco.id);
    expect(afterChoco?.stock_quantity).toBe(49);
  });

  test('حارس البيع الزائد يفشل المعاملة كاملة ذرّياً', async () => {
    const milk = await makeProduct({name: 'لبن', cost: 1, retail: 2, stock: 3});
    await expect(
      InvoiceService.completeSale({
        lines: [line(milk, 5, 2)],
        discount: 0,
        paymentType: 'RETAIL',
        print: false,
        receiptSettings: receipt(),
      }),
    ).rejects.toThrow(/غير كافية/);
    // لا فاتورة ولا خصم مخزون.
    const rows = harnessDb().prepare('SELECT COUNT(*) AS c FROM sales').get() as {
      c: number;
    };
    expect(rows.c).toBe(0);
    const after = await ProductRepo.getById(milk.id);
    expect(after?.stock_quantity).toBe(3);
  });

  test('المخزون بلا تتبع لا يُخصم أبداً (مطعم/كافيتريا)', async () => {
    const coffee = await makeProduct({
      name: 'قهوة',
      cost: 1,
      retail: 5,
      stock: 0,
      stockUntracked: true,
    });
    const sale = await InvoiceService.completeSale({
      lines: [line(coffee, 3, 5)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    });
    expect(sale.sale.total_amount).toBe(15);
    const after = await ProductRepo.getById(coffee.id);
    expect(after?.stock_quantity).toBe(0);
  });

  test('حجز أرقام الفواتير لا يعود للخلف أبداً', async () => {
    const p = await makeProduct({name: 'علكة', cost: 0.5, retail: 1, stock: 100});
    const s1 = await InvoiceService.completeSale({
      lines: [line(p, 1, 1)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    });
    const s2 = await InvoiceService.completeSale({
      lines: [line(p, 1, 1)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    });
    const n1 = Number(s1.sale.invoice_number.split('-').pop());
    const n2 = Number(s2.sale.invoice_number.split('-').pop());
    expect(n2).toBe(n1 + 1);
  });
});

describe('الديون — صِلة ودفتر المتجر (v11/v16)', () => {
  test('دين صِلة: صف الطابور يُنشأ في نفس معاملة الفاتورة (INV-D)', async () => {
    const p = await makeProduct({name: 'أرز', cost: 4, retail: 8, stock: 20});
    const sale = await InvoiceService.completeSale({
      lines: [line(p, 2, 8)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
      debt: {
        customerId: 'cus-123',
        customerName: 'أحمد',
        customerPhoneLast4: '9988',
        customerCard: null,
        offlineQr: null,
        amountMinor: minor(16),
      },
    });
    expect(sale.sale.invoice_number).toMatch(/^INV-D-/);
    const queue = harnessDb().prepare('SELECT * FROM sila_debt_queue').all() as {
      state: string;
      amount_minor: number;
      pos_invoice_ref: string;
      customer_id: string;
    }[];
    expect(queue).toHaveLength(1);
    expect(queue[0].state).toBe('pending');
    expect(queue[0].amount_minor).toBe(minor(16));
    expect(queue[0].pos_invoice_ref).toBe(sale.sale.invoice_number);
    expect(queue[0].customer_id).toBe('cus-123');
  });

  test('دين المتجر المحلي: صف INV-L + رصيد قائم + سداد ينقصه', async () => {
    const customer = await LocalDebtsRepo.createCustomer({
      name: 'سمير',
      idNumber: '123456782',
      phone: '0599123456',
    });
    const p = await makeProduct({name: 'سكر', cost: 3, retail: 5, stock: 30});
    const sale = await InvoiceService.completeSale({
      lines: [line(p, 4, 5)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
      localDebt: {
        localCustomerId: customer.id,
        customerName: customer.name,
        customerPhoneLast4: '3456',
      },
    });
    expect(sale.sale.invoice_number).toMatch(/^INV-L-/);
    const balances = await LocalDebtsRepo.listWithBalances();
    expect(balances[0].outstandingMinor).toBe(minor(20));

    // سداد جزئي 7.50 ثم كامل المتبقي.
    await LocalDebtsRepo.addPayment({
      localCustomerId: customer.id,
      amountMinor: minor(7.5),
      method: 'cash',
      note: null,
    });
    const after = await LocalDebtsRepo.listWithBalances();
    expect(after[0].outstandingMinor).toBe(minor(12.5));
    await LocalDebtsRepo.addPayment({
      localCustomerId: customer.id,
      amountMinor: minor(12.5),
      method: 'cash',
      note: null,
    });
    const settled = await LocalDebtsRepo.listWithBalances();
    expect(settled[0].outstandingMinor).toBe(0);
  });
});

describe('المرتجعات — محرك RET (v23/v40)', () => {
  test('إرجاع جزئي نقدي: صف RET سالب + returned_minor على الأصل + استرجاع المخزون', async () => {
    const p = await makeProduct({name: 'زيت', cost: 5, retail: 10, stock: 10});
    const sale = await InvoiceService.completeSale({
      lines: [line(p, 3, 10)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    });
    expect((await ProductRepo.getById(p.id))?.stock_quantity).toBe(7);

    const prep = await InvoiceService.prepareReturn(sale.sale.id);
    expect(prep.book).toBe('cash');
    expect(prep.lines).toHaveLength(1);
    const saleItem = prep.lines[0];
    expect(saleItem.remaining).toBe(3);

    const ret = await InvoiceService.createReturn({
      saleId: sale.sale.id,
      lines: [
        {
          saleItemId: saleItem.item.id,
          productId: p.id,
          productName: p.name,
          quantity: 2,
          unitName: null,
          basePerUnit: 1,
          unitPrice: 10,
          costPrice: 5,
          variantId: null,
        },
      ],
      refundMethod: 'cash',
      print: false,
      receiptSettings: receipt(),
    });
    expect(ret.return_number).toMatch(/^RET-/);
    expect(ret.refund_minor).toBe(minor(20));

    // الأصل يحمل قيمة المرتجع.
    const original = await SaleRepo.getById(sale.sale.id);
    expect(original?.returned_minor).toBe(minor(20));
    // المخزون استُرجع.
    expect((await ProductRepo.getById(p.id))?.stock_quantity).toBe(9);
    // صف RET في sales بقيمة سالبة (تتصفى به التقارير).
    const retRow = harnessDb().prepare(
      'SELECT total_amount, return_kind FROM sales WHERE invoice_number = ?',
    ).get(ret.return_number) as {total_amount: number; return_kind: string};
    expect(retRow.total_amount).toBeLessThan(0);
    expect(retRow.return_kind).toBe('cash');
  });

  test('إرجاع فاتورة دين محلي ينقص الدين بقدر المرتجع', async () => {
    const customer = await LocalDebtsRepo.createCustomer({
      name: 'ليلى',
      idNumber: '123456782',
      phone: '0591234567',
    });
    const p = await makeProduct({name: 'جبن', cost: 4, retail: 9, stock: 12});
    const sale = await InvoiceService.completeSale({
      lines: [line(p, 2, 9)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
      localDebt: {
        localCustomerId: customer.id,
        customerName: customer.name,
        customerPhoneLast4: null,
      },
    });
    let balances = await LocalDebtsRepo.listWithBalances();
    expect(balances[0].outstandingMinor).toBe(minor(18));

    const prep = await InvoiceService.prepareReturn(sale.sale.id);
    expect(prep.book).toBe('local');
    const item = prep.lines[0];
    await InvoiceService.createReturn({
      saleId: sale.sale.id,
      lines: [
        {
          saleItemId: item.item.id,
          productId: p.id,
          productName: p.name,
          quantity: 1,
          unitName: null,
          basePerUnit: 1,
          unitPrice: 9,
          costPrice: 4,
          variantId: null,
        },
      ],
      refundMethod: 'none',
      print: false,
      receiptSettings: receipt(),
    });
    balances = await LocalDebtsRepo.listWithBalances();
    expect(balances[0].outstandingMinor).toBe(minor(9));
  });
});

describe('الخزينة — معادلة النقد المتوقع (v25)', () => {
  test('مبيعات نقدية − مصروف − سحب + إيداع = النقد المتوقع', async () => {
    const p = await makeProduct({name: 'شاي', cost: 1, retail: 3, stock: 100});
    await InvoiceService.completeSale({
      lines: [line(p, 4, 3)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    }); // +12 نقداً
    await CashService.recordExpense({
      category: 'كهرباء',
      note: 'فاتورة الكهرباء',
      amountMinor: minor(2.5),
      authMethod: 'none',
    });
    await CashService.recordWithdrawal({
      note: 'سحب رأس المال',
      amountMinor: minor(5),
      authMethod: 'none',
    });
    await CashService.recordDeposit({
      note: 'إيداع افتتاحي',
      amountMinor: minor(1.25),
      authMethod: 'none',
    });
    const drawer = await CashService.drawerNowMinor();
    // 12 − 2.5 − 5 + 1.25 = 5.75
    expect(drawer).toBe(minor(5.75));
  });

  test('سجل الحركات غير قابل للتعديل وكل سند له مرجع فريد', async () => {
    const p = await makeProduct({name: 'بسكويت', cost: 1, retail: 2, stock: 50});
    await InvoiceService.completeSale({
      lines: [line(p, 2, 2)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    }); // +4 نقداً للدرج قبل المصروفات
    await CashService.recordExpense({
      category: 'أخرى',
      note: null,
      amountMinor: minor(1),
      authMethod: 'none',
    });
    await CashService.recordExpense({
      category: 'أخرى',
      note: null,
      amountMinor: minor(1),
      authMethod: 'none',
    });
    const rows = harnessDb().prepare('SELECT ref FROM cash_movements').all() as {
      ref: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.ref)).size).toBe(2);
    expect(rows[0].ref).toMatch(/^EXP-\d{8}-\d{4}$/);
  });
});

describe('التقارير — لقطة الخزينة وصافي الفترة', () => {
  test('treasurySnapshot تطابق معادلة الدرج بدقة الأغورة', async () => {
    const p = await makeProduct({name: 'ماء', cost: 0.5, retail: 2, stock: 100});
    await InvoiceService.completeSale({
      lines: [line(p, 3, 2)],
      discount: 0.5,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    }); // صافي 5.5
    await CashService.recordExpense({
      category: 'نقل',
      note: null,
      amountMinor: minor(0.75),
      authMethod: 'none',
    });
    const treasury = await ReportService.treasurySnapshot();
    expect(Math.round(treasury.cashTotal * 100)).toBe(minor(4.75));
  });
});

describe('منطق نقي — لوحة المبلغ ورموز صِلة', () => {
  test('applyAmountKey: أغورات فقط بلا سوابق صفرية', () => {
    expect(applyAmountKey('', '5')).toBe('5');
    expect(applyAmountKey('0', '7')).toBe('7');
    expect(applyAmountKey('5', '.')).toBe('5.');
    expect(applyAmountKey('5.', '.')).toBe('5.');
    expect(applyAmountKey('5.2', '9')).toBe('5.29');
    expect(applyAmountKey('5.29', '9')).toBe('5.29');
    expect(applyAmountKey('5.2', '⌫')).toBe('5.');
    expect(applyAmountKey('5', '⌫')).toBe('');
  });

  test('parseSilaQr: بطاقة صِلة من JWS-like بثلاث قطع', () => {
    const b64 = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    const qr = [
      b64({typ: 'sila-card-qr'}),
      b64({cid: 'cus-9', name: 'خالد', phone: '0599887766'}),
      'sig',
    ].join('.');
    const parsed = parseSilaQr(qr);
    expect(parsed.payload.kind).toBe('card');
    if (parsed.payload.kind === 'card') {
      expect(parsed.payload.cid).toBe('cus-9');
      expect(parsed.payload.name).toBe('خالد');
    }
    expect(parseSilaQr('شيء عشوائي').payload.kind).toBe('unknown');
  });
});
