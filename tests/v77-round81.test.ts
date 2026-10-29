/**
 * v77-round81.test.ts — الجولة 81 لسطح المكتب: ملاحظات التاجر.
 * ─────────────────────────────────────────────────────────────────
 *  ٤. منع تكرار اسم المنتج والباركود عند إدخال منتج جديد — طلب
 *     التاجر نصاً: «لا اريد عند إدخال منتج جديد ان يتكرر اسم
 *     المنتج والباركود اذا كان موجود بمنتج سابق». حارس في
 *     ProductRepo (إنشاء وتعديل) والوحدات، الاسم غير حساس للحالة،
 *     والمؤرشف لا يمنع إعادة الإضافة (الحي يفوز عند المسح).
 *  ٥أ. فلاتر تنبيهات المخزون: نفذ/منخفض/بلا تتبع برقم كل مجموعة
 *      على الشريحة نفسها — «ان تضيف فلاتر التنبيه للمخزون مثل
 *      نفذ والصلاحية وغيرها».
 *  ٥ب. ملف المنتج صفحة مستقلة نظيفة بدل النافذة المنبثقة —
 *      «ممكن تحويلها لصفحة مستقلة يكون شكلها مرتب ونظيف»:
 *      طبقة كاملة الشاشة برأس (رجوع + هوية) وجهاز حفظ دائم.
 *  ٥ج. حذف المنتج من الكيبورد مباشرة من قائمة المخزون دون فتحه
 *      — «ان يستطيع ايضا يحذف المنتج من الكيبورد بدون فتح
 *      المنتج» — مع مربع التأكيد نفسه وبقاء التحديد على الصف
 *      التالي.
 *  ٥د. تقرير PDF للمخزون: نص «قيمة التصنيف» كان يُرسم خارج حد
 *      الصفحة — حُذف مباشرة بطلب التاجر.
 *  ٥هـ. شريط تبويبات التقارير: كان sticky فيطفو ويتحرك أثناء
 *      التمرير — الآن الرأس كله ثابت بالبنية والمحتوى وحده
 *      يتمرر (التفصيل في اختبارات v76 المحدّثة).
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const PRODUCT_REPO = 'src/database/repositories/ProductRepo.ts';
const UNIT_REPO = 'src/database/repositories/UnitRepo.ts';
const ONLINE_STORE = 'src/services/online/OnlineStoreService.ts';
const INVENTORY = 'src/screens/InventoryScreen.tsx';
const INVENTORY_CSS = 'src/screens/inventoryv57.css';
const FORM = 'src/screens/ProductFormModal.tsx';
const PDF_SERVICE = 'src/services/InventoryReportPdf.ts';
const REPORTS = 'src/screens/ReportsScreen.tsx';
const REPORTS_CSS = 'src/screens/settingsv57.css';

describe('v77 — ٤ منع تكرار اسم المنتج والباركود', () => {
  test('الحارس في الإنشاء والتعديل — نشطين فقط، والاسم غير حساس للحالة', () => {
    const src = read(PRODUCT_REPO);
    expect(src).toContain('async function assertNameBarcodeAvailable(');
    expect(src).toContain('WHERE LOWER(TRIM(name)) = LOWER(?)');
    expect(src).toContain('يوجد منتج بنفس الاسم');
    expect(src).toContain('لا يمكن تكرار الباركود');
    // الإنشاء والتعديل كلاهما يحرسان (التعديل يستثني المنتج نفسه).
    expect(src).toContain(
      'await assertNameBarcodeAvailable(name, input.barcode, undefined, {',
    );
    expect(src).toContain(
      'await assertNameBarcodeAvailable(name, input.barcode, id, {',
    );
    // المؤرشف لا يمنع إعادة الإضافة (الحي يفوز عند المسح — قاعدة v23).
    expect(src).toContain('AND is_archived = 0 AND id != ?');
    // ثغرة النظام (سطر التوصيل) تتجاوز فحص الاسم صراحة.
    expect(src).toContain('allowDuplicateName?: boolean;');
  });

  test('باركودات الوحدات لا تتكرر عبر المنتجات', () => {
    const src = read(UNIT_REPO);
    expect(src).toContain('لا باركود وحدة مكرراً');
    expect(src).toContain('باركود الوحدة ${code} مستخدم');
  });

  test('منتج التوصيل النظامي يتجاوز فحص الاسم', () => {
    expect(read(ONLINE_STORE)).toContain('allowDuplicateName: true,');
  });
});

describe('v77 — ٥أ فلاتر تنبيهات المخزون', () => {
  test('شرائح نفذ/منخفض/بلا تتبع بعدّ كل مجموعة', () => {
    const src = read(INVENTORY);
    // الحالة وقيمها.
    expect(src).toContain(
      "'none' | 'out' | 'low' | 'untracked'",
    );
    expect(src).toContain('stockFilter,');
    // العدادات الحقيقية على كل شريحة.
    expect(src).toContain('const outCount = useMemo(');
    expect(src).toContain('const lowOnlyCount = useMemo(');
    expect(src).toContain('const untrackedCount = useMemo(');
    // الفلترة عبر stockStateOf نفسها (نفذ/منخفض) وفصل المفتوحة.
    expect(src).toContain('stockStateOf(');
    expect(src).toContain("if (state !== stockFilter) {");
    // الشريحة تتعطل عند عدم وجود عناصرها لا تختفي.
    expect(src).toContain('disabled={outCount === 0 && stockFilter !== \'out\'}');
    expect(src).toContain('disabled={lowOnlyCount === 0 && stockFilter !== \'low\'}');
  });

  test('تسمية الفلتر في ترويسة تقرير PDF', () => {
    const src = read(INVENTORY);
    expect(src).toContain("activeFilters.push('نفد')");
    expect(src).toContain("activeFilters.push('منخفض')");
    expect(src).toContain("activeFilters.push('بلا تتبع')");
  });
});

describe('v77 — ٥ب ملف المنتج صفحة مستقلة', () => {
  test('غلاف الصفحة الكاملة بدل النافذة المنبثقة', () => {
    const src = read(FORM);
    expect(src).toContain('<div className="pf-page">');
    expect(src).toContain('pf-page-bar');
    expect(src).toContain('pf-page-body');
    expect(src).toContain('pf-page-foot');
    // زر الرجوع في الشريط العلوي + عنوان الصفحة.
    expect(src).toContain('رجوع ←');
    expect(src).toContain('إضافة منتج جديد');
    expect(src).toContain('تعديل المنتج');
    // لا غشاء منبثق بعد الآن.
    expect(src).not.toContain('pf-overlay');
    expect(src).not.toContain('modal pf-modal');
  });

  test('أنماط الصفحة: رأس ثابت وجهاز حفظ دائم ومحتوى يتمرر', () => {
    const css = read(INVENTORY_CSS);
    expect(css).toContain('.pf-page {');
    expect(css).toContain('.pf-page-bar {');
    expect(css).toContain('.pf-page-body {');
    expect(css).toContain('.pf-page-foot {');
    // الصفحة تملأ نافذة التطبيق فوق كل شيء.
    expect(css).toContain('position: fixed;');
    expect(css).toContain('inset: 0;');
  });
});

describe('v77 — ٥ج حذف المنتج من الكيبورد', () => {
  test('مفتاح Delete يحذف الصف المعيّن بلا فتح المنتج', () => {
    const src = read(INVENTORY);
    expect(src).toContain("e.key === 'Delete'");
    expect(src).toContain('void removeProduct(product).then(() => {');
    // التحديد ينتقل للصف التالي (أو السابق) كي يُحذف آخر بضغطة.
    expect(src).toContain('const nextProduct = visible[idx + 1] ?? visible[idx - 1] ?? null;');
    expect(src).toContain('setSelRowId(nextProduct?.id ?? null);');
    // المستمع يعلن بعد removeProduct كي يصله.
    expect(src).toContain('}, [editing, moveRowSelection, visible, selRowId, removeProduct]);');
  });
});

describe('v77 — ٥د تقرير PDF: نص قيمة التصنيف حُذف', () => {
  test('لا نص يُرسم خارج حد الصفحة', () => {
    const src = read(PDF_SERVICE);
    // النص كان يُرسم عند MARGIN+12 بمحاذاة يمين فيتجاوز الحد.
    expect(src).not.toContain('قيمة التصنيف');
    expect(src).not.toContain('MARGIN + 12,');
    // عناصر صف التصنيف الباقية سليمة: الاسم وعدد المنتجات.
    expect(src).toContain('group.name');
    expect(src).toContain('كمية مفتوحة');
    // الإجمالي الكبير أسفل الجدول ما زال يحمل القيمة الكاملة.
    expect(src).toContain('إجمالي قيمة البضاعة في المخزون');
  });
});

describe('v77 — ٥هـ تبويبات التقارير ثابتة بالبنية', () => {
  test('الرأس كله خارج صندوق التمرير — لا sticky أصلاً', () => {
    const src = read(REPORTS);
    expect(src).toContain('className="screen rep-screen"');
    expect(src).toContain('className="rep-fixed-head"');
    expect(src).toContain('className="rep-scroll"');
    // التبويبات داخل الرأس الثابت.
    expect(src).toContain('rep-fixed-head');
    const css = read(REPORTS_CSS);
    expect(css).toContain('.screen.rep-screen {');
    expect(css).toContain('overflow: hidden; /* الشاشة نفسها لا تتمرر');
    expect(css).toContain('.rep-scroll {');
  });
});

describe('v77 — الإصدار', () => {
  test('77.0.0 (21)', () => {
    const src = read('src/core/config.ts');
    expect(src).toContain("APP_VERSION = '77.0.0'");
    expect(src).toContain('APP_BUILD_CODE = 21');
    const pkg = read('package.json');
    expect(pkg).toContain('"version": "77.0.0"');
    const conf = read('src-tauri/tauri.conf.json');
    expect(conf).toContain('"version": "77.0.0"');
  });
});
