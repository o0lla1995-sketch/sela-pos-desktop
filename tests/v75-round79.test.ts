/**
 * v75-round79.test.ts — الجولة 79 لسطح المكتب: ملاحظات التاجر.
 * ─────────────────────────────────────────────────────────────────
 *  ① الوحدات والمقاسات والألوان تبقى محفوظة: المقاس/اللون المخصص
 *     يُحفظ دائماً في الإعدادات لكل نمط متجر فيظهر في كل منتج جديد
 *     (كان يضيع مع أول «حفظ وإضافة آخر») — ووحدة جديدة تُنشأ من
 *     داخل النموذج نفسه وتُحفظ فوراً، ووحدات الطول/الحجم متاحة
 *     في القوائم.
 *  ② تعديل منتج (ملابس وأحذية): رقائق سريعة تضيف لوناً جديداً بكل
 *     المقاسات الحالية أو مقاساً جديداً لكل الألوان بلمسة واحدة.
 *  ③ أرقام إنجليزية في حقول ملء الربط اليدوي وعدد الباركودات —
 *     بلا أرقام لغة النظام (٠١٢٣) — والضغط على الحقل يحدد رقمه
 *     بالكامل فيستبدل بالكتابة فوراً.
 *  ④ استلام دفع الطلبات أونلاين: نافذة اختيار طريقة التحصيل (نقدي
 *     أو أي بنك/محفظة مفعلة) — السند على القناة الصحيحة وفاتورة
 *     الطلب تحمل الطريقة.
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const FORM = 'src/screens/ProductFormModal.tsx';
const SETTINGS = 'src/stores/settingsStore.ts';
const ORDERS = 'src/screens/online/OnlineOrdersScreen.tsx';
const ONLINE = 'src/services/online/OnlineStoreService.ts';
const CSS = 'src/screens/inventoryv57.css';
const ONLINE_CSS = 'src/screens/online/online.css';

describe('v75 — ① المقاسات والألوان والوحدات تبقى محفوظة', () => {
  test('مخزن الإعدادات يحمل القائمتين الدائمتين ومساعداتهما', () => {
    const src = read(SETTINGS);
    expect(src).toContain('customSizes: Record<string, string[]>;');
    expect(src).toContain('customColors: Record<string, string[]>;');
    expect(src).toContain('export function addCustomVariantOption(');
    expect(src).toContain('export function removeCustomVariantOption(');
    expect(src).toContain('export function customVariantOptions(');
  });

  test('النموذج يدمج المحفوظ في الرقائق ويحفظ كل إضافة', () => {
    const form = read(FORM);
    expect(form).toContain('...savedCustomSizes,');
    expect(form).toContain('...savedCustomColors,');
    expect(form).toContain("addCustomVariantOption('size'");
    expect(form).toContain("addCustomVariantOption('color'");
    expect(form).toContain('سيظهر في كل منتج جديد');
    // رقاقة الحذف من القائمة الدائمة
    expect(form).toContain('iv57-chip-x');
    expect(form).toContain('أُزيل مقاس');
  });

  test('إنشاء وحدة جديدة من داخل النموذج يحفظها فوراً', () => {
    const form = read(FORM);
    expect(form).toContain('createUnitInline');
    expect(form).toContain('UnitRepo.create(');
    expect(form).toContain('+ وحدة جديدة');
    expect(form).toContain('ستظهر في كل منتج جديد');
    // وحدات الطول والحجم صارت متاحة
    expect(form).toContain("unit.kind === 'length'");
    expect(form).toContain("unit.kind === 'volume'");
  });
});

describe('v75 — ② تعديل الربطة بسهولة (ملابس وأحذية)', () => {
  test('لون جديد بكل المقاسات ومقاس جديد لكل الألوان', () => {
    const form = read(FORM);
    expect(form).toContain('addColorWithAllSizes');
    expect(form).toContain('addSizeToAllColors');
    expect(form).toContain('إضافة لون للربطة (يدخل بكل المقاسات الحالية)');
    expect(form).toContain('إضافة مقاس للربطة (يدخل لكل الألوان الحالية)');
    const css = read(CSS);
    expect(css).toContain('.pf-quickadd-box');
  });
});

describe('v75 — ③ أرقام إنجليزية + تحديد عند الضغط', () => {
  test('مكوّن الحقل الرقمي الإنجليزي موجود ومستعمل', () => {
    const form = read(FORM);
    expect(form).toContain('function EnNumInput(');
    expect(form).toContain('toEnglishDigits');
    expect(form).toContain("dir=\"ltr\"");
    expect(form).toContain('onFocus={e => e.target.select()}');
    // خلايا الشبكة + مخزون التعديل + عدد النسخ كلها عبره
    const uses = form.split('<EnNumInput').length - 1;
    expect(uses).toBeGreaterThanOrEqual(3);
    // لا حقول number خام متبقية في مواضع الجولة
    expect(form).not.toContain('className="pf-lotcell"\n                                            type="number"');
    expect(form).not.toContain('className="pf-copies-value"\n                            type="number"');
  });

  test('عدد الربط يطبّع الأرقام العربية لحظة الكتابة', () => {
    const form = read(FORM);
    expect(form).toContain(
      'setLotBundles(\n                                  toEnglishDigits(e.target.value)',
    );
  });
});

describe('v75 — ④ استلام دفع الطلبات أونلاين بكل الطرق', () => {
  test('deliverOrder يستقبل طريقة الدفع ويقيد بها السند والفاتورة', () => {
    const online = read(ONLINE);
    expect(online).toContain("paymentMethod: string = 'cash',");
    expect(online).toContain('paymentMethod,');
    expect(online).toContain(
      'UPDATE sales SET payment_method = ? WHERE invoice_number = ?',
    );
  });

  test('نافذة التحصيل في صفحة الطلبات: بطاقات الطرق + تأكيد يحملها', () => {
    const orders = read(ORDERS);
    expect(orders).toContain('olo-collect');
    expect(orders).toContain('activePaymentMethods');
    expect(orders).toContain('confirmCollect');
    expect(orders).toContain('تأكيد التسليم واستلام الدفع');
    expect(orders).toContain('deliverOrder(order, collectMethod)');
    expect(orders).not.toContain('تأكيد التسليم (الدين → الخزينة)');
    const css = read(ONLINE_CSS);
    expect(css).toContain('.olo-collect-card');
  });
});
