/**
 * backup-resilience.test.ts — v58: النسخة الاحتياطية لا تسقط كلياً
 * بسبب جدول/عمود مفقود في قاعدة قديمة (جذر «خطأ النسخ الاحتياطي
 * المتعلق بقاعدة البيانات»): كل استعلام محصّن بـ safeQuery — الجدول
 * المفقود يُتخطى مع تسجيل تحذير ويُكمل الباقي.
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

import {BackupService} from '../src/services/BackupService';

describe('v58 — تحصين النسخة الاحتياطية', () => {
  beforeEach(() => {
    bootHarness(':memory:');
  });

  test('قاعدة ناقصة الجداول الاختيارية لا تُسقط النسخة', async () => {
    const db = harnessDb();
    db.prepare(
      "INSERT INTO products (name, cost_price, retail_price, wholesale_price, stock_quantity) VALUES ('شوكولاتة', 2, 4, 3.5, 10)",
    ).run();
    db.prepare(
      "INSERT INTO sales (invoice_number, total_amount, total_cost, total_profit, discount, payment_type) VALUES ('INV-100001', 10, 6, 4, 0, 'CASH')",
    ).run();
    // إسقاط جدول كان الاستعلام القديم يموت عنده بلا معالجة.
    db.exec('DROP TABLE sila_customers;');

    const {json, summary} = await BackupService.buildBackupJson({
      compact: true,
    });
    const doc = JSON.parse(json);
    expect(doc.app).toBe('sela');
    expect(doc.products.length).toBe(1);
    expect(doc.sales.length).toBe(1);
    expect(Array.isArray(doc.sila_customers)).toBe(true);
    expect(doc.sila_customers.length).toBe(0);
    expect(summary.products).toBe(1);
  });

  test('الجداول الأساسية تعمل مع بيانات كاملة', async () => {
    const db = harnessDb();
    db.prepare(
      "INSERT INTO local_customers (id_number, name, phone) VALUES ('400123456', 'أحمد', '0597320229')",
    ).run();
    db.prepare(
      "INSERT INTO local_debts (local_customer_id, invoice_ref, amount_minor) VALUES (1, 'INV-L-20260101-0001', 5000)",
    ).run();
    const {json} = await BackupService.buildBackupJson({compact: true});
    const doc = JSON.parse(json);
    expect(doc.local_customers.length).toBe(1);
    expect(doc.local_debts.length).toBe(1);
    expect(doc.local_customers[0].phone).toBe('0597320229');
  });
});
