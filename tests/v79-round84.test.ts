/**
 * v79 — الجولة 84 (سطح المكتب): ملاحظات التاجر على نقطة البيع.
 * ─────────────────────────────────────────────────────────────────
 * ١. الدين المباشر لا يُخصم من النقد بالخزينة — طلب التاجر نصاً:
 *    «عند تسجيل الدين المباشر فإنه يسجل قيمة سالبة في النقد بالخزينة
 *    وهذا غير منطقي... عند السداد من خلال محفظة أو بنك يسجَّل السداد
 *    بالمحفظة لكن يبقى بقيمته السالبة بالخزينة — أفضّل ألا يضاف
 *    الدين المباشر إلى القيمة السالبة بالخزينة ويسجل في الدين القائم
 *    فقط» (أندرويد وسطح المكتب معاً).
 *    → عمود origin بجدول local_debts ('sale'/'direct') + شفاء النواة
 *    Rust للقاعدة القائمة (كل دين بلا فاتورة مقابلة = مباشر) +
 *    معادلة الخزينة تطرح ديون البيع فقط، والدين القائم يجمع الاثنين.
 * ٢. (أندرويد فقط) حذف عبارة «السلة فارغة» من شريط السلة الفارغة —
 *    سطح المكتب لم يكن يعرضها أصلاً (يُحرَس هنا ألا تظهر).
 * ٦. الإصدار: 79.0.0 (23).
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8') as string;

const REPO = 'src/database/repositories/LocalDebtsRepo.ts';
const CORE_DB = 'crates/sela-core/src/db.rs';
const TYPES = 'src/core/types.ts';
const REPORT_SERVICE = 'src/services/ReportService.ts';
const BACKUP = 'src/services/BackupService.ts';
const DEBTS_SCREEN = 'src/screens/LocalDebtsScreen.tsx';
const POS = 'src/screens/PosScreen.tsx';
const CONFIG = 'src/core/config.ts';

describe('v79 — ١ الدين المباشر لا يلمس الخزينة', () => {
  test('نواة Rust: عمود origin في DDL + الشفاء + ترحيل القائم', () => {
    const src = read(CORE_DB);
    // DDL للتثبيتات الجديدة + قائمة الشفاء للقواعد القديمة.
    expect(src).toContain("origin TEXT NOT NULL DEFAULT 'sale'");
    expect(src).toContain('("local_debts", "origin"');
    // الترحيل: كل دين بلا فاتورة بيع مقابلة يوسم مباشراً (idempotent
    // وآمن لكل إقلاع، وNOT EXISTS لا ينكسر بNULL).
    expect(src).toContain("UPDATE local_debts SET origin = 'direct'");
    expect(src).toContain('NOT EXISTS (');
  });

  test('addDebt (المسار المباشر) يوسم origin=direct والنوع يحمل الأصل', () => {
    const src = read(REPO);
    expect(src).toContain("'direct'");
    expect(src).toContain('origin');
    const types = read(TYPES);
    expect(types).toContain("origin: 'sale' | 'direct'");
  });

  test('totals: debtsMinor ديون البيع فقط + directDebtsMinor منفصل', () => {
    const src = read(REPO);
    expect(src).toContain(
      "WHERE migrated = 0 AND COALESCE(origin, 'sale') = 'sale'",
    );
    expect(src).toContain("WHERE migrated = 0 AND origin = 'direct'");
    expect(src).toContain(
      'outstandingMinor: debtsMinor + directDebtsMinor - paymentsMinor',
    );
  });

  test('معادلة الخزينة تستثني المباشر (شرح مطبّق في الخدمة)', () => {
    const src = read(REPORT_SERVICE);
    expect(src).toContain('localBook.debtsMinor');
    expect(src).toContain('origin=');
    expect(src).toContain('لا يُطرح هنا إطلاقاً');
  });

  test('النسخة الاحتياطية تحفظ الأصل وتستنتجه للنسخ القديمة', () => {
    const src = read(BACKUP);
    expect(src).toContain('origin, migrated, migrated_ref, created_at');
    expect(src).toContain('COALESCE(?, CASE WHEN EXISTS (');
    expect(src).toContain("THEN 'sale' ELSE 'direct' END");
  });

  test('الواجهة تميّز الدين المباشر: شارة في سجل الحساب + التلميح', () => {
    const src = read(DEBTS_SCREEN);
    expect(src).toContain("d.origin === 'direct'");
    expect(src).toContain('دين مباشر');
    expect(src).toContain('لا يُخصم من النقد بالخزينة إطلاقاً');
  });
});

describe('v79 — ٢ شريط السلة الفارغة بلا عبارة «السلة فارغة»', () => {
  test('سطح المكتب لم يكن يعرضها — يُحرَس استمرار ذلك', () => {
    const src = read(POS);
    // إرشاد عملي فقط، بلا العبارة المحذوفة.
    expect(src).toContain('اضغط منتجاً لإضافته أو امسح باركوده');
    expect(src).not.toContain('السلة فارغة — اضغط');
  });
});

describe('v79 — ٦ الإصدار', () => {
  test('79.0.0 (23) في config والبناء', () => {
    expect(read(CONFIG)).toContain("APP_VERSION = '82.0.0'");
    expect(read(CONFIG)).toContain('APP_BUILD_CODE = 26');
    expect(read('package.json')).toContain('"version": "82.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain(
      '"version": "82.0.0"',
    );
    expect(read('src-tauri/Cargo.toml')).toContain('version = "82.0.0"');
  });
});

/* ── الجزء الوظيفي: المعادلة المحاسبية كاملة على قاعدة SQLite حقيقية
   (نفس DDL النواة المستخرج من db.rs) — نفس بيئة parity.core. ── */
import {vi, beforeEach as bootBeforeEach} from 'vitest';
import {
  bootHarness,
  harnessInvoke,
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

import {InvoiceService} from '../src/services/InvoiceService';
import {ProductRepo} from '../src/database/repositories/ProductRepo';
import {ReportService} from '../src/services/ReportService';
import {LocalDebtsRepo} from '../src/database/repositories/LocalDebtsRepo';
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

async function makeProduct(input: {
  name: string;
  cost: number;
  retail: number;
}): Promise<Product> {
  const id = await ProductRepo.create({
    name: input.name,
    cost_price: input.cost,
    retail_price: input.retail,
    wholesale_price: input.retail,
    stock_quantity: 100,
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

function line(product: Product, qty: number, unitPrice: number): CartLine {
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

bootBeforeEach(() => {
  bootHarness(':memory:');
});

describe('v79 — ١ (وظيفي): الدين المباشر خارج الدرج والسداد بقناته', () => {
  test('المعادلة الكاملة: بيع نقدي + دين مباشر + دين بيع + سداد محفظة/نقدي', async () => {
    const customer = await LocalDebtsRepo.createCustomer({
      name: 'سمير',
      idNumber: '400123457',
      phone: '0597320230',
    });

    // ① بيع نقدي 20 → الدرج 20.
    const water = await makeProduct({name: 'ماء', cost: 0.5, retail: 2});
    await InvoiceService.completeSale({
      lines: [line(water, 10, 2)],
      discount: 0,
      paymentType: 'RETAIL',
      print: false,
      receiptSettings: receipt(),
    });
    let treasury = await ReportService.treasurySnapshot();
    expect(Math.round(treasury.cashTotal * 100)).toBe(minor(20));

    // ② دين مباشر 30 (بلا بيع) → الدرج لا يتأثر إطلاقاً (الإصلاح
    //    الجوهري: قبل v79 كان الدرج ينقص 30 بلا سبب).
    await LocalDebtsRepo.addDebt({
      localCustomerId: customer.id,
      amountMinor: minor(30),
      description: 'دين سابق قبل التطبيق',
    });
    treasury = await ReportService.treasurySnapshot();
    expect(Math.round(treasury.cashTotal * 100)).toBe(minor(20));
    let totals = await LocalDebtsRepo.totals();
    expect(totals.directDebtsMinor).toBe(minor(30));
    expect(totals.debtsMinor).toBe(0);
    expect(totals.outstandingMinor).toBe(minor(30));

    // ③ دين بيع 18 (بضاعة خرجت، بلا نقود) → الدرج لا يتأثر، لكن
    //    debtsMinor (ديون البيع) هي التي تطرح من الإيراد.
    const cheese = await makeProduct({name: 'جبن', cost: 4, retail: 9});
    await InvoiceService.completeSale({
      lines: [line(cheese, 2, 9)],
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
    treasury = await ReportService.treasurySnapshot();
    expect(Math.round(treasury.cashTotal * 100)).toBe(minor(20));
    totals = await LocalDebtsRepo.totals();
    expect(totals.debtsMinor).toBe(minor(18));
    expect(totals.directDebtsMinor).toBe(minor(30));
    expect(totals.outstandingMinor).toBe(minor(48));

    // ④ سداد 10 من المحفظة (جوال باي) → الدرج النقدي لا يتأثر،
    //    ودفتر قناة المحفظة يستقبل العشرة (سلوك v64 القائم).
    await LocalDebtsRepo.addPayment({
      localCustomerId: customer.id,
      amountMinor: minor(10),
      method: 'jawwal_pay',
      note: null,
    });
    treasury = await ReportService.treasurySnapshot();
    expect(Math.round(treasury.cashTotal * 100)).toBe(minor(20));
    const walletBalance = await ReportService.methodBalanceNow('jawwal_pay');
    expect(Math.round(walletBalance * 100)).toBe(minor(10));
    totals = await LocalDebtsRepo.totals();
    expect(totals.outstandingMinor).toBe(minor(38));

    // ⑤ سداد 8 نقداً → يدخل الدرج فعلاً (8 + 20 = 28).
    await LocalDebtsRepo.addPayment({
      localCustomerId: customer.id,
      amountMinor: minor(8),
      method: 'cash',
      note: null,
    });
    treasury = await ReportService.treasurySnapshot();
    expect(Math.round(treasury.cashTotal * 100)).toBe(minor(28));
    totals = await LocalDebtsRepo.totals();
    expect(totals.outstandingMinor).toBe(minor(30));
  });

  test('الترحيل: دين قديم بلا فاتورة مقابلة يوسم مباشراً', async () => {
    // سطر مباشر في القاعدة (كما كانت تُنشأ الديون المباشرة قبل v79).
    const db = (
      await import('./helpers/desktopHarness')
    ).harnessDb();
    const customer = await LocalDebtsRepo.createCustomer({
      name: 'ليلى',
      idNumber: '123456782',
      phone: '0591234567',
    });
    await LocalDebtsRepo.addDebt({
      localCustomerId: customer.id,
      amountMinor: minor(5),
      description: null,
    });
    // محاكاة ترحيل النواة: نفس عبارة UPDATE حرفياً من db.rs.
    db.exec(
      `UPDATE local_debts SET origin = 'direct'
        WHERE NOT EXISTS (
          SELECT 1 FROM sales s WHERE s.invoice_number = local_debts.invoice_ref
        );`,
    );
    const rows = db
      .prepare('SELECT origin FROM local_debts')
      .all() as {origin: string}[];
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe('direct');
  });
});
