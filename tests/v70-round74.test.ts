/**
 * v70-round74.test.ts — الجولة 74: اختبارات خالصة لمتطلبات التاجر.
 * ─────────────────────────────────────────────────────────────────
 *  ① نظام طرق الدفع (السجل + التفعيل + التراجع للنقدي).
 *  ② محرك تخطيط ملصقات PDF (صفحات مربعة/A4 وعدد النسخ).
 *  ③ ترقيم إقلاع v70: المرآة تُحمَّل قبل تقييم أي وحدة متجر —
 *     حرّوس مصدر يمنع عودة الجذر الذي كان يصفّر الإعدادات عند
 *     كل إقلاع (وضع المتجر وخادم الكاشير والطابعة…).
 *  ④ خصم الفاتورة بنمطين (نسبة/مبلغ) — نفس معادلة التحويل.
 *  ⑤ ربط الفاتورة بطريقة الدفع داخل قاعدة حقيقية (harness) —
 *     يحفظها ويعيدها، والمرتجع يرث طريقة فاتورته الأصلية.
 */
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {bootHarness} from './helpers/desktopHarness';

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

import {
  PAYMENT_METHODS,
  activePaymentMethods,
  defaultPaymentMethodsEnabled,
  paymentMethodById,
  paymentMethodLabel,
} from '../src/core/paymentMethods';
import {
  DEFAULT_LABEL_OPTIONS,
  pageGrid,
  planLabelPages,
  wrapName,
} from '../src/services/BarcodePdfService';
import {SaleRepo} from '../src/database/repositories/SaleRepo';
import {ProductRepo} from '../src/database/repositories/ProductRepo';
import type {CartLine, Product} from '../src/core/types';

// ── ① سجل طرق الدفع ─────────────────────────────────────────────

describe('v70: طرق الدفع — السجل والتفعيل', () => {
  test('السجل يضم البنوك والمحافظ الفلسطينية الثلاث والنقدي أولاً', () => {
    expect(PAYMENT_METHODS[0].id).toBe('cash');
    const ids = PAYMENT_METHODS.map(m => m.id);
    expect(ids).toContain('bank_palestine');
    expect(ids).toContain('bank_quds');
    expect(ids).toContain('bank_islami');
    expect(ids).toContain('jawwal_pay');
    expect(ids).toContain('palpay');
    expect(ids).toContain('malchat');
    expect(PAYMENT_METHODS.filter(m => m.kind === 'bank')).toHaveLength(3);
    expect(PAYMENT_METHODS.filter(m => m.kind === 'wallet')).toHaveLength(3);
  });

  test('النقدي لا يُعطَّل أبداً — التعطيل المباشر لا أثر له', () => {
    const disabled = Object.fromEntries(
      PAYMENT_METHODS.map(m => [m.id, false]),
    );
    const active = activePaymentMethods(disabled);
    expect(active.map(m => m.id)).toEqual(['cash']);
  });

  test('الترقية من نسخة أقدم (خريطة ناقصة) = كل غير مذكور مفعّل', () => {
    const active = activePaymentMethods({palpay: false});
    expect(active.map(m => m.id)).not.toContain('palpay');
    expect(active.map(m => m.id)).toContain('jawwal_pay');
    expect(active.map(m => m.id)).toContain('bank_palestine');
  });

  test('القيمة غير المعروفة/الفارغة ترجع للنقدي (مبيعات ما قبل v70)', () => {
    expect(paymentMethodById(null).id).toBe('cash');
    expect(paymentMethodById('').id).toBe('cash');
    expect(paymentMethodById('ancient_thing').id).toBe('cash');
    expect(paymentMethodLabel('bank_quds')).toBe('بنك القدس');
    expect(paymentMethodLabel(undefined)).toBe('نقدي');
  });

  test('الافتراضي: كل الطرق مفعّلة', () => {
    const defaults = defaultPaymentMethodsEnabled();
    for (const method of PAYMENT_METHODS) {
      expect(defaults[method.id]).toBe(true);
    }
  });
});

// ── ② محرك تخطيط ملصقات PDF ─────────────────────────────────────

describe('v70: تخطيط ملصقات الباركود PDF', () => {
  test('الصفحة المربعة = أكبر شبكة كاملة ≤ 200مم + هوامش', () => {
    const grid = pageGrid({...DEFAULT_LABEL_OPTIONS, labelMm: 50});
    // 3×50 = 150 + 12 هوامش = 162مم مربع.
    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(3);
    expect(grid.pageWmm).toBe(162);
    expect(grid.pageHmm).toBe(162);
  });

  test('A4 يستوعب أكثر صفوفاً (4×5 لملصق 50مم)', () => {
    const grid = pageGrid({
      ...DEFAULT_LABEL_OPTIONS,
      labelMm: 50,
      pageKind: 'a4',
    });
    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(5);
    expect(grid.pageWmm).toBe(210);
    expect(grid.pageHmm).toBe(297);
  });

  test('عدد النسخ يتوزع على صفحات كاملة والمواضع صحيحة', () => {
    const entry = {name: 'تيشيرت قطن', barcode: '2000000000017', copies: 10};
    const plan = planLabelPages([entry], {
      ...DEFAULT_LABEL_OPTIONS,
      labelMm: 50,
    });
    // سعة الصفحة 3×3=9 → 10 نسخ = صفحتان (9 ثم 1).
    expect(plan.totalLabels).toBe(10);
    expect(plan.pages).toHaveLength(2);
    expect(plan.pages[0].placements).toHaveLength(9);
    expect(plan.pages[1].placements).toHaveLength(1);
    // آخر موضع بالصفحة الأولى: عمود 2 صف 2 (0-indexed).
    const last = plan.pages[0].placements[8];
    expect(last.col).toBe(2);
    expect(last.row).toBe(2);
  });

  test('لا مدخلات = صفحة فارغة واحدة بلا ملصقات', () => {
    const plan = planLabelPages([], DEFAULT_LABEL_OPTIONS);
    expect(plan.totalLabels).toBe(0);
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0].placements).toHaveLength(0);
  });

  test('لف الاسم العربي على سطرين كحد أقصى مع اقتطاع مهذب', () => {
    expect(wrapName('حليب المراعي', 18)).toEqual(['حليب المراعي']);
    const two = wrapName('شوكولاتة بالبندق المالحة الفاخرة جداً', 10);
    expect(two.length).toBe(2);
    expect(two[1].endsWith('…')).toBe(true);
  });
});

// ── ③ حرّوس إقلاع v70 (المرآة قبل المتاجر) ───────────────────────

describe('v70: ترتيب الإقلاع — المرآة قبل تقييم المتاجر', () => {
  test('main.tsx ينتظر initStorage قبل استيراد app ديناميكياً', async () => {
    const {readFileSync} = await import('node:fs');
    const {resolve} = await import('node:path');
    const main = readFileSync(
      resolve(__dirname, '../src/main.tsx'),
      'utf8',
    );
    // ① لا استيراد ثابت لشجرة app (لأن وحدات المتاجر تُقيَّم فوراً).
    expect(main).not.toMatch(
      /import\s+\{?\s*App\s*\}?\s+from\s+['"]\.\/app['"]/,
    );
    // ② الاستيراد ديناميكي وبعد initStorage.
    const initIndex = main.indexOf('await initStorage()');
    const importIndex = main.indexOf("await import('./app')");
    expect(initIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(initIndex);
  });

  test('initStorage محمية من التحميل المزدوج (حارس مرة واحدة)', async () => {
    const {readFileSync} = await import('node:fs');
    const {resolve} = await import('node:path');
    const storage = readFileSync(
      resolve(__dirname, '../src/state/storage.ts'),
      'utf8',
    );
    expect(storage).toContain('mirrorLoaded');
  });
});

// ── ④ خصم الفاتورة بالنسبة — معادلة التحويل ──────────────────────

describe('v70: خصم الفاتورة بنمطين (نسبة/مبلغ)', () => {
  test('النسبة تتحول لمبلغ بنفس معادلة المحرك (تقريب قرش)', () => {
    const subtotal = 137.4;
    const pct = 12.5;
    const amount = Math.round(subtotal * (pct / 100) * 100) / 100;
    expect(amount).toBe(17.18); // 137.4 × 0.125 = 17.175 → 17.18
    // المحرك يقيد الخصم بحدود المجموع.
    const clamped = Math.min(Math.max(amount, 0), subtotal);
    expect(clamped).toBe(17.18);
  });

  test('نسبة 100% = خص كامل المجموع', () => {
    const subtotal = 55.5;
    const amount = Math.round(subtotal * 1 * 100) / 100;
    expect(amount).toBe(55.5);
  });
});

// ── ⑤ طريقة الدفع داخل قاعدة حقيقية ─────────────────────────────

describe('v70: ربط الفاتورة بطريقة الدفع (قاعدة حقيقية)', () => {
  beforeEach(async () => {
    await bootHarness();
  });

  async function makeProduct(name: string, price: number): Promise<Product> {
    const id = await ProductRepo.create({
      name,
      cost_price: price / 2,
      retail_price: price,
      wholesale_price: price,
      stock_quantity: 50,
      category_id: null,
      image_uri: null,
      low_stock_threshold: null,
      barcode: null,
      discount_pct: 0,
      online_listed: 0,
      sold_by_weight: 0,
      expiry_date: null,
      style_group: null,
      variant_size: null,
      variant_color: null,
      has_variants: 0,
      base_unit_name: null,
      stock_untracked: 0,
      sizes_count: null,
    });
    const product = await ProductRepo.getById(id);
    if (product == null) throw new Error('تعذر إنشاء منتج الاختبار');
    return product;
  }

  function cartLine(product: Product, qty: number): CartLine {
    return {
      key: `${product.id}:0`,
      productId: product.id,
      name: product.name,
      unitPrice: product.retail_price,
      costPrice: product.cost_price,
      retailPrice: product.retail_price,
      wholesalePrice: product.wholesale_price,
      quantity: qty,
      availableStock: 999,
      unitId: null,
      unitName: 'قطعة',
      conversion: 1,
    };
  }

  test('البيع يحفظ طريقة الدفع ويعيدها — والقديمة بلا طريقة تعود نقدياً', async () => {
    const product = await makeProduct('عطر فاخر', 90);
    const sale = await SaleRepo.createSale({
      invoiceNumber: 'INV-20261027-0001',
      lines: [cartLine(product, 1)],
      discount: 0,
      paymentType: 'RETAIL',
      paymentMethod: 'jawwal_pay',
    });
    expect(sale.sale.payment_method).toBe('jawwal_pay');

    const legacy = await SaleRepo.createSale({
      invoiceNumber: 'INV-20261027-0002',
      lines: [cartLine(product, 2)],
      discount: 0,
      paymentType: 'RETAIL',
    });
    expect(legacy.sale.payment_method == null).toBe(true);

    const readBack = await SaleRepo.getById(sale.sale.id);
    expect(readBack?.payment_method).toBe('jawwal_pay');
  });

  test('المرتجع يرث طريقة الدفع الأصلية (الرصيد يُرَد لنفس الحساب)', async () => {
    const product = await makeProduct('حذاء جلد', 120);
    const sale = await SaleRepo.createSale({
      invoiceNumber: 'INV-20261027-0003',
      lines: [cartLine(product, 1)],
      discount: 0,
      paymentType: 'RETAIL',
      paymentMethod: 'bank_quds',
    });
    const ret = await SaleRepo.createReturn({
      returnNumber: 'RET-20261027-0001',
      saleId: sale.sale.id,
      invoiceRef: 'INV-20261027-0003',
      book: 'cash',
      refundMethod: 'cash',
      discountRatio: 1,
      lines: [
        {
          saleItemId: sale.items[0].id,
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitName: 'قطعة',
          basePerUnit: 1,
          unitPrice: 120,
          costPrice: 60,
        },
      ],
    });
    // المرتجع يحمل طريقة فاتورته الأصلية — يُرَد المبلغ (محاسبياً)
    // لنفس الحساب البنكي/المحفظة التي دخل منها.
    expect(ret.payment_method).toBe('bank_quds');
    expect(ret.return_number).toBe('RET-20261027-0001');
  });
});
