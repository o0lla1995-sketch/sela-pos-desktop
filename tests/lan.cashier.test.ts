/**
 * lan.cashier.test.ts — v58 (الجولة 62): الكاشير على الشبكة المحلية
 * (سطح المكتب) — نفس حرّوس الأندرويد فوق بيئة المحاكاة الحقيقية:
 *  ① DDL النواة يضم جداول الكاشيرين وأعمدة النسب.
 *  ② الحساب والمصادقة وكلمة المرور المملّحة.
 *  ③ دورة موافقة المدير على الجهاز ثم الدخول برمز.
 *  ④ البيع عبر البروتوكول: نسبة للكاشير + سقف الخصم + أسعار الخادم
 *     (تجاهل أسعار العميل) + خصم المخزون.
 *  ⑤ الإرجاع والإحصاءات والملكية (403 لغير صاحب الفاتورة).
 *  ⑥ مود «نقطة البيع»: الإضافة السريعة بالحبة/العلبة/الغرام.
 */
import {vi, describe, test, expect, beforeEach} from 'vitest';
import {
  bootHarness,
  harnessDb,
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

// استيراد الخدمات بعد تفعيل المحاكاة.
import {CashiersRepo} from '../src/database/repositories/CashiersRepo';
import {handleLanRequest} from '../src/services/lan/LanHandlers';
import {QuickProductService} from '../src/services/QuickProductService';
import {UnitRepo} from '../src/database/repositories/UnitRepo';
import {useSettingsStore} from '../src/stores/settingsStore';

beforeEach(() => {
  bootHarness(':memory:');
});

function loginRequest(username: string, password: string, deviceId = 'dev-1') {
  return {
    id: 't-login',
    method: 'POST' as const,
    path: '/api/auth/login',
    query: {},
    body: JSON.stringify({
      username,
      password,
      deviceId,
      deviceLabel: 'جهاز اختبار',
    }),
    auth: null,
    ip: '192.168.1.60',
  };
}

async function makeSeedProduct(
  name: string,
  price: number,
  stock: number,
): Promise<number> {
  const db = harnessDb();
  const info = db
    .prepare(
      `INSERT INTO products (name, retail_price, wholesale_price, cost_price, stock_quantity, category_id, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, '2026-01-01 10:00:00')`,
    )
    .run(name, price, price, price * 0.5, stock);
  return Number(info.lastInsertRowid);
}

/** دخول كامل: إنشاء الحساب + أول اتصال + موافقة المدير + رمز. */
async function loginApproved(
  username: string,
  deviceId: string,
  maxDiscountPct = 10,
): Promise<string> {
  await CashiersRepo.createCashier({
    username,
    password: 'pass1',
    displayName: username,
    maxDiscountPct,
  });
  await handleLanRequest(loginRequest(username, 'pass1', deviceId));
  const pending = await CashiersRepo.pendingDevices();
  expect(pending.length).toBeGreaterThan(0);
  await CashiersRepo.approveDevice(pending[0].id);
  const body = JSON.parse(
    (await handleLanRequest(loginRequest(username, 'pass1', deviceId))).body,
  );
  expect(body.status).toBe('ok');
  return body.token as string;
}

describe('v58 — الكاشير على الشبكة المحلية (سطح المكتب)', () => {
  test('① DDL النواة: جداول الكاشيرين وأعمدة cashier_id', () => {
    const db = harnessDb();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('lan_cashiers','lan_devices')",
      )
      .all() as {name: string}[];
    expect(tables.length).toBe(2);
    const salesCols = (
      db.prepare("PRAGMA table_info('sales')").all() as {name: string}[]
    ).map(c => c.name);
    expect(salesCols).toContain('cashier_id');
    const retCols = (
      db.prepare("PRAGMA table_info('sale_returns')").all() as {name: string}[]
    ).map(c => c.name);
    expect(retCols).toContain('cashier_id');
  });

  test('② الحساب: المصادقة الصحيحة وكلمة المرور مملّحة', async () => {
    await CashiersRepo.createCashier({
      username: 'ahmad',
      password: '1234',
      displayName: 'أحمد',
    });
    const okCashier = await CashiersRepo.authenticate('ahmad', '1234');
    expect(okCashier?.display_name).toBe('أحمد');
    expect(await CashiersRepo.authenticate('ahmad', '9999')).toBeNull();
    const db = harnessDb();
    const row = db
      .prepare("SELECT password_hash FROM lan_cashiers WHERE username = 'ahmad'")
      .get() as {password_hash: string};
    expect(row.password_hash).not.toContain('1234');
    expect(row.password_hash.length).toBeGreaterThanOrEqual(64);
  });

  test('③ دورة الموافقة: pending → رمز بعد موافقة المدير', async () => {
    await CashiersRepo.createCashier({
      username: 'sami',
      password: 'pass1',
      displayName: 'سامي',
    });
    const first = await handleLanRequest(loginRequest('sami', 'pass1', 'tab-9'));
    expect(JSON.parse(first.body).status).toBe('pending');
    const pending = await CashiersRepo.pendingDevices();
    expect(pending.length).toBe(1);
    await CashiersRepo.approveDevice(pending[0].id);
    const second = await handleLanRequest(loginRequest('sami', 'pass1', 'tab-9'));
    const body = JSON.parse(second.body);
    expect(body.status).toBe('ok');
    expect(body.token.length).toBeGreaterThanOrEqual(32);
    // طلب بلا رمز → 401.
    const noAuth = await handleLanRequest({
      id: 'x',
      method: 'GET',
      path: '/api/invoices',
      query: {},
      body: '',
      auth: null,
      ip: null,
    });
    expect(noAuth.status).toBe(401);
  });

  test('④ البيع: نسبة + سقف الخصم + أسعار الخادم + خصم المخزون', async () => {
    await CashiersRepo.createCashier({
      username: 'layan',
      password: 'pass1',
      displayName: 'ليان',
      maxDiscountPct: 10,
    });
    await handleLanRequest(loginRequest('layan', 'pass1', 'ph-1'));
    const pending = await CashiersRepo.pendingDevices();
    await CashiersRepo.approveDevice(pending[0].id);
    const token = JSON.parse(
      (await handleLanRequest(loginRequest('layan', 'pass1', 'ph-1'))).body,
    ).token as string;

    const productId = await makeSeedProduct('شوكولاتة', 4, 100);
    const saleRes = await handleLanRequest({
      id: 't-sale',
      method: 'POST',
      path: '/api/sale',
      query: {},
      body: JSON.stringify({
        lines: [{productId, quantity: 2, unitPrice: 0.01}],
        discount: 50,
        paymentType: 'cash',
      }),
      auth: `Bearer ${token}`,
      ip: null,
    });
    expect(saleRes.status).toBe(200);
    const invoice = JSON.parse(saleRes.body).invoice;
    // 2 × 4 = 8 − خصم 0.8 (سقف 10%) = 7.2 — سعر العميل تُجُوهل.
    expect(invoice.total).toBeCloseTo(7.2, 5);
    expect(invoice.number).toMatch(/^INV-/);

    const db = harnessDb();
    const row = db
      .prepare('SELECT cashier_id, discount FROM sales WHERE invoice_number = ?')
      .get(invoice.number) as {cashier_id: number; discount: number};
    const cashier = db
      .prepare('SELECT id FROM lan_cashiers')
      .get() as {id: number};
    expect(row.cashier_id).toBe(cashier.id);
    expect(Number(row.discount)).toBeCloseTo(0.8, 5);
    const stock = db
      .prepare('SELECT stock_quantity FROM products WHERE id = ?')
      .get(productId) as {stock_quantity: number};
    expect(stock.stock_quantity).toBe(98);
  });

  test('⑤ الإرجاع والإحصاءات والملكية', async () => {
    const token = await loginApproved('mona', 'ph-2');
    const tokenOther = await loginApproved('koko', 'ph-3');

    const productId = await makeSeedProduct('عصير', 6, 50);
    const saleRes = await handleLanRequest({
      id: 's1',
      method: 'POST',
      path: '/api/sale',
      query: {},
      body: JSON.stringify({lines: [{productId, quantity: 3}]}),
      auth: `Bearer ${token}`,
      ip: null,
    });
    const invoice = JSON.parse(saleRes.body).invoice;

    // غير صاحب الفاتورة → 403.
    const foreign = await handleLanRequest({
      id: 'f1',
      method: 'GET',
      path: '/api/invoice',
      query: {id: String(invoice.id)},
      body: '',
      auth: `Bearer ${tokenOther}`,
      ip: null,
    });
    expect(foreign.status).toBe(403);

    const detail = await handleLanRequest({
      id: 'd1',
      method: 'GET',
      path: '/api/invoice',
      query: {id: String(invoice.id)},
      body: '',
      auth: `Bearer ${token}`,
      ip: null,
    });
    const detailBody = JSON.parse(detail.body);
    expect(detailBody.lines[0].remaining).toBe(3);

    const returnRes = await handleLanRequest({
      id: 'r1',
      method: 'POST',
      path: '/api/return',
      query: {},
      body: JSON.stringify({
        saleId: invoice.id,
        lines: [
          {saleItemId: detailBody.lines[0].saleItemId, quantity: 2},
        ],
        refundMethod: 'cash',
      }),
      auth: `Bearer ${token}`,
      ip: null,
    });
    expect(returnRes.status).toBe(200);
    const returnBody = JSON.parse(returnRes.body);
    expect(returnBody.return.refundMinor).toBe(1200);

    const stats = JSON.parse(
      (
        await handleLanRequest({
          id: 'st1',
          method: 'GET',
          path: '/api/stats',
          query: {},
          body: '',
          auth: `Bearer ${token}`,
          ip: null,
        })
      ).body,
    );
    expect(stats.today.salesTotal).toBeCloseTo(18, 5);
    expect(stats.today.net).toBeCloseTo(6, 5);
  });
});

describe('v58 — مود نقطة البيع (سطح المكتب)', () => {
  beforeEach(() => {
    useSettingsStore.getState().update({storeMode: 'pos'});
  });

  test('⑥ قطعي بالحبة: وحدتان بأسعارهما والمخزون بالحبات', async () => {
    const result = await QuickProductService.createQuickProduct({
      name: 'مارلبورو',
      sellBy: 'piece',
      price: 1,
      perBox: 20,
      stockInput: 5,
    });
    expect(result.unitCount).toBe(2);
    expect(result.stockBase).toBe(100);
    const units = await UnitRepo.listForProduct(result.productId);
    const piece = units.find(u => u.conversion === 1);
    const box = units.find(u => u.conversion === 20);
    expect(piece?.retail_price).toBe(1);
    expect(box?.retail_price).toBe(20);
  });

  test('⑦ من العلبة: سعر الحبة مشتق', async () => {
    const result = await QuickProductService.createQuickProduct({
      name: 'كنت',
      sellBy: 'box',
      price: 18,
      perBox: 20,
      stockInput: 2,
    });
    const units = await UnitRepo.listForProduct(result.productId);
    const piece = units.find(u => u.conversion === 1);
    expect(piece?.retail_price).toBeCloseTo(0.9, 5);
  });

  test('⑧ وزني بالغرام: سعر الكيلو ×1000 ووحدة 0.001', async () => {
    const result = await QuickProductService.createQuickProduct({
      name: 'تبغ شبه',
      sellBy: 'gram',
      price: 0.06,
      stockInput: 500,
    });
    const db = harnessDb();
    const row = db
      .prepare('SELECT retail_price, sold_by_weight FROM products WHERE id = ?')
      .get(result.productId) as {
      retail_price: number;
      sold_by_weight: number;
    };
    expect(Number(row.retail_price)).toBeCloseTo(60, 5);
    expect(row.sold_by_weight).toBe(1);
    const units = await UnitRepo.listForProduct(result.productId);
    expect(units[0].conversion).toBe(0.001);
    expect(result.stockBase).toBeCloseTo(0.5, 8);
  });
});

// ═══════════════════════════════════════════════════════════════
// v59 (الجولة 63): الصلاحيات الدقيقة + ميزة العمل دون اتصال
// (clientRef) + دفعة المزامنة + المتغيرات في الكتالوج.
// ═══════════════════════════════════════════════════════════════
describe('v59 — الصلاحيات والمزامنة دون اتصال', () => {
  test('⑨ صلاحيات الدخول: perms تسلم مع الرمز وتُفرض من الخادم', async () => {
    await CashiersRepo.createCashier({
      username: 'sami',
      password: 'pass1',
      displayName: 'سامي',
      maxDiscountPct: 10,
      canDebt: false,
      canReturn: false,
    });
    await handleLanRequest(loginRequest('sami', 'pass1', 's-ph'));
    const pending = await CashiersRepo.pendingDevices();
    await CashiersRepo.approveDevice(pending[0].id);
    const body = JSON.parse(
      (await handleLanRequest(loginRequest('sami', 'pass1', 's-ph'))).body,
    );
    expect(body.perms.canDebt).toBe(false);
    expect(body.perms.canReturn).toBe(false);
    expect(body.perms.maxDiscountPct).toBe(10);
    const token = body.token as string;

    const productId = await makeSeedProduct('خبز', 3, 40);

    // دين مقفول → 403.
    const debtRes = await handleLanRequest({
      id: 'd1',
      method: 'POST',
      path: '/api/sale',
      query: {},
      body: JSON.stringify({
        lines: [{productId, quantity: 1}],
        paymentType: 'debt',
        localCustomerId: 1,
      }),
      auth: `Bearer ${token}`,
      ip: null,
    });
    expect(debtRes.status).toBe(403);
    expect(JSON.parse(debtRes.body).error).toContain('الدين');

    // مرتجع مقفول → 403 (بعد بيع نقدي سليم أولاً).
    await handleLanRequest({
      id: 's-ok',
      method: 'POST',
      path: '/api/sale',
      query: {},
      body: JSON.stringify({lines: [{productId, quantity: 1}]}),
      auth: `Bearer ${token}`,
      ip: null,
    });
    const invoiceRow = harnessDb()
      .prepare('SELECT id FROM sales WHERE invoice_number LIKE ?')
      .get('INV-%') as {id: number};
    const retRes = await handleLanRequest({
      id: 'r1',
      method: 'POST',
      path: '/api/return',
      query: {},
      body: JSON.stringify({
        saleId: invoiceRow.id,
        lines: [],
      }),
      auth: `Bearer ${token}`,
      ip: null,
    });
    expect(retRes.status).toBe(403);
    expect(JSON.parse(retRes.body).error).toContain('المرتجعات');
  });

  test('⑩ clientRef: إعادة المزامنة لا تُسجّل الفاتورة مرتين', async () => {
    const token = await loginApproved('rania', 'r-ph');
    const productId = await makeSeedProduct('حليب', 5, 30);
    const payload = {
      lines: [{productId, quantity: 2}],
      clientRef: 'C-rania-1737000000-a1',
      createdAt: '2026-01-15 09:30:00',
    };
    const first = JSON.parse(
      (
        await handleLanRequest({
          id: 'x1',
          method: 'POST',
          path: '/api/sale',
          query: {},
          body: JSON.stringify(payload),
          auth: `Bearer ${token}`,
          ip: null,
        })
      ).body,
    );
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBeUndefined();
    // زمن البيع الفعلي حُفظ (لا زمن المزامنة).
    expect(first.invoice.createdAt).toBe('2026-01-15 09:30:00');

    // إعادة إرسال نفس العملية (انقطعت الشبكة قبل وصول الرد).
    const second = JSON.parse(
      (
        await handleLanRequest({
          id: 'x2',
          method: 'POST',
          path: '/api/sale',
          query: {},
          body: JSON.stringify(payload),
          auth: `Bearer ${token}`,
          ip: null,
        })
      ).body,
    );
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.invoice.number).toBe(first.invoice.number);

    // صف واحد فقط — المخزون خُصم مرة واحدة.
    const db = harnessDb();
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM sales WHERE client_ref = ?')
      .get(payload.clientRef) as {c: number};
    expect(count.c).toBe(1);
    const stock = db
      .prepare('SELECT stock_quantity FROM products WHERE id = ?')
      .get(productId) as {stock_quantity: number};
    expect(stock.stock_quantity).toBe(28);
  });

  test('⑪ sync/push: دفعة عمليات بنتائج مستقلة لكل عملية', async () => {
    const token = await loginApproved('fadi', 'f-ph');
    const p1 = await makeSeedProduct('شاي', 7, 60);
    const p2 = await makeSeedProduct('قهوة', 22, 0);

    const res = await handleLanRequest({
      id: 'sync1',
      method: 'POST',
      path: '/api/sync/push',
      query: {},
      body: JSON.stringify({
        ops: [
          {
            opId: 'op-1',
            kind: 'sale',
            payload: {
              lines: [{productId: p1, quantity: 3}],
              clientRef: 'C-fadi-1',
              createdAt: '2026-01-16 11:00:00',
            },
          },
          {
            opId: 'op-2',
            kind: 'sale',
            payload: {
              lines: [{productId: p2, quantity: 1}],
              clientRef: 'C-fadi-2',
            },
          },
        ],
      }),
      auth: `Bearer ${token}`,
      ip: null,
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].ok).toBe(true);
    expect(body.results[0].invoice.number).toMatch(/^INV-/);
    // نفد المخزون → رفض نظيف لهذه العملية وحدها.
    expect(body.results[1].ok).toBe(false);
    expect(body.results[1].error).toBeTruthy();
  });

  test('⑫ المتغيرات في الكتالوج والبيع بها', async () => {
    const token = await loginApproved('zain', 'z-ph');
    const db = harnessDb();
    const info = db
      .prepare(
        `INSERT INTO products
          (name, retail_price, wholesale_price, cost_price, stock_quantity, has_variants, category_id, created_at)
         VALUES ('تيشيرت', 35, 30, 15, 3, 1, NULL, '2026-01-01 10:00:00')`,
      )
      .run();
    const productId = Number(info.lastInsertRowid);
    const vInfo = db
      .prepare(
        `INSERT INTO product_variants (product_id, kind, color, size, stock_quantity, created_at)
         VALUES (?, 'variant', 'أسود', 'L', 4, '2026-01-01')`,
      )
      .run(productId);
    const variantId = Number(vInfo.lastInsertRowid);

    // الكتالوج يحمل المتغيرات كاملة.
    const catalog = JSON.parse(
      (
        await handleLanRequest({
          id: 'cat1',
          method: 'GET',
          path: '/api/catalog',
          query: {},
          body: '',
          auth: `Bearer ${token}`,
          ip: null,
        })
      ).body,
    );
    const product = catalog.products.find((p: {id: number}) => p.id === productId);
    expect(product.hasVariants).toBe(true);
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].color).toBe('أسود');
    expect(product.variants[0].size).toBe('L');

    // بيع بلا متغير → طلب صريح لاختيار اللون/المقاس.
    const noVar = await handleLanRequest({
      id: 'nv',
      method: 'POST',
      path: '/api/sale',
      query: {},
      body: JSON.stringify({lines: [{productId, quantity: 1}]}),
      auth: `Bearer ${token}`,
      ip: null,
    });
    expect(noVar.status).toBe(400);

    // بيع بمتغير صحيح → نفس معادلة نقطة البيع.
    const withVar = JSON.parse(
      (
        await handleLanRequest({
          id: 'wv',
          method: 'POST',
          path: '/api/sale',
          query: {},
          body: JSON.stringify({
            lines: [{productId, quantity: 2, variantId}],
            clientRef: 'C-zain-var-1',
          }),
          auth: `Bearer ${token}`,
          ip: null,
        })
      ).body,
    );
    expect(withVar.ok).toBe(true);
    expect(withVar.invoice.total).toBeCloseTo(70, 5);
    const line = db
      .prepare('SELECT variant_id, variant_label FROM sale_items WHERE sale_id = ?')
      .get(withVar.invoice.id) as {variant_id: number; variant_label: string};
    expect(line.variant_id).toBe(variantId);
    expect(line.variant_label).toContain('أسود');
    expect(line.variant_label).toContain('L');
  });
});
