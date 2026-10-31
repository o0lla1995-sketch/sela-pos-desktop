/**
 * v78 — الجولة 83 (سطح المكتب): ملاحظات التاجر على نقطة البيع.
 * ─────────────────────────────────────────────────────────────────
 * نفس جولة الأندرويد v71 بالنقاط الست — التطبيقان يتطابقان:
 * ١. الفاتورة: طريقة الدفع بنوعها وجهتها (نقدي/بنك/محفظة) دائماً في
 *    الترويسة + سطر قطع تحت كل صنف متعدد القطع (وحدة/باكج).
 * ٢. خيارات بيع بالعدد (باكجات) في المنتج السريع — «3 حبات بـ2 شيكل»
 *    تظهر في نافذة المتغيرات قبل السلة وتميز في الفاتورة + معاينة
 *    شكل الفاتورة في إعدادات الطابعة بالشكل الجديد.
 * ٣. حذفات: زر «+ سريع» من صفحة البيع + الباركود من نافذة المنتج
 *    السريع (مع معالج الماسح اللاسلكي الخاص به).
 * ٤. الاختيار الافتراضي: نافذة المتغيرات تعيّن الخيار الأول دائماً
 *    (سلوك قائم — يُحرَس الآن صراحة).
 * ٥. الرجوع للفاتورة السابقة من السلة الفارغة (زر + F8).
 * ٦. الإجراءات السريعة: زرا ديون المتجر والفواتير (طلب صريح).
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8') as string;

const POS = 'src/screens/PosScreen.tsx';
const HOME = 'src/screens/HomeScreen.tsx';
const RECEIPT = 'src/services/printer/receipt.ts';
const PREVIEW = 'src/services/printer/receiptPreview.ts';
const QUICK_SERVICE = 'src/services/QuickProductService.ts';
const QUICK_SHEET = 'src/components/QuickProductSheet.tsx';
const CART = 'src/stores/cartStore.ts';
const PAYMENTS = 'src/core/paymentMethods.ts';

describe('v78 — ١ الفاتورة: طريقة الدفع دائماً + تفاصيل القطع', () => {
  test('تسمية طريقة الدفع للفاتورة: النوع + الجهة', () => {
    const src = read(PAYMENTS);
    expect(src).toContain('paymentMethodReceiptLabel');
    expect(src).toContain("method.kind === 'wallet'");
  });

  test('الإيصال يطبع طريقة الدفع في الترويسة دائماً (نقدي أيضاً)', () => {
    const src = read(RECEIPT);
    expect(src).toContain('paymentMethodReceiptLabel');
    expect(src).toContain('طريقة الدفع: ${paymentMethodReceiptLabel(');
    // سطر القدم القديم (غير النقدي فقط) حُذف.
    expect(src).not.toContain("methodId !== 'cash'");
  });

  test('سطر القطع تحت كل صنف متعدد القطع', () => {
    const src = read(RECEIPT);
    expect(src).toContain('baseQty > item.quantity');
    expect(src).toContain('قطعة');
  });
});

describe('v78 — ٢ خيارات بيع بالعدد (باكجات) في المنتج السريع', () => {
  test('الخدمة تبني الباكجات متغيرات أحجام (مشتركة حرفياً مع الأندرويد)', () => {
    const svc = read(QUICK_SERVICE);
    expect(svc).toContain('QuickPackage');
    expect(svc).toContain("kind: 'size'");
    expect(svc).toContain("size: 'حبة'");
    expect(svc).toContain('parsePackageCount');
  });

  test('سطر الباكج في السلة يخصم المخزون بالقطع', () => {
    const cart = read(CART);
    expect(cart).toContain('toPackageLine');
    expect(cart).toContain('addPackageLine');
    expect(cart).toContain('conversion: count');
  });

  test('نافذة المتغيرات توجّه «N حبات» إلى سطر الباكج', () => {
    const pos = read(POS);
    expect(pos).toContain('parsePackageCount(variant.size)');
    expect(pos).toContain('addPackageLine(variantPick.product, variant, packageCount, qty)');
  });

  test('الواجهة: قسم خيارات بيع بالعدد بصفوف (عدد + سعر)', () => {
    const sheet = read(QUICK_SHEET);
    expect(sheet).toContain('خيارات بيع بالعدد');
    expect(sheet).toContain('عدد الحبات');
    expect(sheet).toContain('سعر الباكج');
    expect(sheet).toContain('parsePackageRows');
  });

  test('معاينة شكل الفاتورة بالشكل الجديد (طريقة الدفع + باكج + قطع)', () => {
    const preview = read(PREVIEW);
    expect(preview).toContain('paymentMethodReceiptLabel');
    expect(preview).toContain("variantLabel: '3 حبات'");
    expect(preview).toContain('قطعة');
  });
});

describe('v78 — ٣ الحذفات الصريحة', () => {
  test('زر «+ سريع» ونافذته حُذفا من صفحة البيع', () => {
    const pos = read(POS);
    expect(pos).not.toContain('QuickProductSheet');
    expect(pos).not.toContain('quickAddOpen');
  });

  test('خيار الباركود ومعالج الماسح حُذفا من نافذة المنتج السريع', () => {
    const sheet = read(QUICK_SHEET);
    expect(sheet).not.toContain('باركود (اختياري)');
    expect(sheet).not.toContain('setBarcode');
    expect(sheet).not.toContain('pushBarcodeHandler');
  });
});

describe('v78 — ٤ الاختيار الافتراضي في نافذة المتغيرات', () => {
  test('الخيار الأول معيّن دائماً — سلوك قائم يُحرَس الآن', () => {
    const pos = read(POS);
    expect(pos).toContain('const [sizeIdx, setSizeIdx] = useState(0)');
    expect(pos).toContain('activeList[activeIdx] ?? null');
  });
});

describe('v78 — ٥ الرجوع للفاتورة السابقة من السلة الفارغة', () => {
  test('restoreLines في مخزن السلة', () => {
    const cart = read(CART);
    expect(cart).toContain('restoreLines');
    expect(cart).toContain('normalizeLine');
  });

  test('زر الاسترجاع + اختصار F8 + بناء الأسطر بأسعار الفاتورة', () => {
    const pos = read(POS);
    expect(pos).toContain('buildRecallLines');
    expect(pos).toContain('recallLastInvoice');
    expect(pos).toContain('الرجوع للفاتورة السابقة');
    expect(pos).toContain("e.key === 'F8'");
    expect(pos).toContain('SaleRepo.listRecent(1)');
    expect(pos).toContain('baseQty / qty');
  });
});

describe('v78 — ٦ الإجراءات السريعة: ديون المتجر والفواتير', () => {
  test('زران جديدان يفتحان الدفتر ومركز الفواتير', () => {
    const home = read(HOME);
    expect(home).toContain('ديون المتجر');
    expect(home).toContain("goTo('debts')");
    expect(home).toContain('الفواتير');
    expect(home).toContain("goTo('invoices')");
  });
});

describe('v78 — الإصدار', () => {
  test('78.0.0 (22) في config والبناء', () => {
    expect(read('src/core/config.ts')).toContain("APP_VERSION = '78.0.0'");
    expect(read('src/core/config.ts')).toContain('APP_BUILD_CODE = 22');
    expect(read('package.json')).toContain('"version": "78.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain('"version": "78.0.0"');
    expect(read('src-tauri/Cargo.toml')).toContain('version = "78.0.0"');
  });
});
