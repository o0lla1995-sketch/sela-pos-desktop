/**
 * v84-round90.test.ts — الجولة 90 لسطح المكتب: ملاحظات التاجر الثلاث
 * على v83.0.0 بعد نقل الجولتين 88+89.
 * ─────────────────────────────────────────────────────────────────
 *   ① نافذة إتمام تعديل الفاتورة: زر التأكيد كان `btn brand block`
 *      ولا فئة منهما معرفة في CSS أصلاً فيُعرض رمادياً صغيراً
 *      («زر التأكيد فيها صغير» — طلب التاجر نصاً). الآن primary lg
 *      block بعرض النافذة واسم القناة المختارة في نصه، والتنقل بين
 *      المحافظ والبنوك بالأسهم + Enter يؤكد («لا يتم التنقل بسهولة
 *      بين المحافظ والبنوك التي سوف يتم تحصيل الفرق فيها»).
 *   ② شريط تعديل الفاتورة في السلة كان ثلاث كتل (رأس + أرقام + زر
 *      إتمام) تأكل ~120px («اشعار تعديل الفاتورة كبير جدا ويأخذ
 *      حيز كبير في السلة»). الآن سطر واحد مضغوط؛ زر الإتمام انتقل
 *      لزر الشحن الكبير أسفل السلة (يسمح بسلة فارغة = إرجاع كامل).
 *   ③ شعارات المحافظ والبنوك في «أرصدة المحافظ والبنوك الآن»
 *      بالتقارير كانت تختفي: حشوة .pmi-real كانت نسبة مئوية تُحسب
 *      من عرض الحاوية الخارجية (الصف العريض) لا من عرض الرقاقة
 *      نفسها، فالتهمت العرض كله وصندوق الصورة صار 0×0. الآن بكسل
 *      ثابت — الشعار يظهر أينما وُضع.
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const POS = 'src/screens/PosScreen.tsx';
const STYLES = 'src/styles.css';
const POS_CSS = 'src/screens/pos.css';
const CONFIG = 'src/core/config.ts';
const DEV_MOCK = 'src/lib/devMock.ts';

describe('v84 — ① نافذة إتمام تعديل الفاتورة: زر كبير وتنقل كيبورد', () => {
  test('زر التأكيد primary lg block — لم يعد `btn brand block` اليتيم', () => {
    const src = read(POS);
    // الفئة القديمة لم تكن معرفة في أي CSS — زر رمادي صغير.
    // (نتحقق من نمط JSX لا النص الخام — التعليق التوثيقي يذكرها
    // كتاريخ.)
    expect(src).not.toContain('"btn brand block"');
    expect(src).toContain('btn primary lg block pos-edit-confirm-btn');
    // أداة .btn.block صارت معرفة فعلاً في CSS.
    const css = read(STYLES);
    expect(css).toContain('.btn.block {');
  });

  test('اسم القناة المختارة داخل نص زر التأكيد', () => {
    const src = read(POS);
    expect(src).toContain(
      'تأكيد التعديل واستبدال الفاتورة — عبر ${paymentMethodById(',
    );
    // نص الأساس موجود أيضاً لدفاتر بلا قنوات (دين/أونلاين).
    expect(src).toContain("'تأكيد التعديل واستبدال الفاتورة'");
  });

  test('الأسهم تنقل بين قنوات التسوية وEnter يؤكد وEsc يغلق', () => {
    const src = read(POS);
    // نفس خطاف لوحة المبالغ المستخدم في نافذة الدفع العادية.
    expect(src).toContain('active: editSettleOpen && editSession != null,');
    expect(src).toContain(
      'if (!busy) void settleEdit(editSettleMethod);',
    );
    expect(src).toContain('onCancel: () => setEditSettleOpen(false),');
    // التنقل الدائري بين القنوات المفعّلة.
    expect(src).toMatch(
      /\(idx \+ delta \+ payMethods\.length\) % payMethods\.length;/,
    );
    // تلميحة الاختصارات تحت شبكة القنوات — نفس أسلوب نافذة الدفع.
    expect(src).toContain(
      'الأسهم للتنقل بين القنوات · Enter للتأكيد · Esc للإلغاء',
    );
  });

  test('الأسهم/Enter أثناء النافذة لا تحرّك شبكة المنتجات خلفها', () => {
    const src = read(POS);
    // بوابة معالج شبكة المنتجات تشمل نافذة الإتمام المفتوحة.
    expect(src).toMatch(/variantPick != null \|\|\n\s+editSettleOpen/);
  });
});

describe('v84 — ② شريط تعديل الفاتورة مضغوط لسطر واحد', () => {
  test('البنية: رقم + الأصل ← الجديد + الفرق + ✕ — بلا زر إتمام داخل الشريط', () => {
    const src = read(POS);
    expect(src).toContain('pos-edit-nums');
    expect(src).toContain("الأصل{' '}");
    expect(src).toContain('className="pos-edit-x"');
    // كتل الرأس والصف القديمة حُذفت.
    expect(src).not.toContain('pos-edit-banner-head');
    expect(src).not.toContain('pos-edit-banner-row');
    // زر الإتمام لم يعد داخل الشريط — مكان الإتمام واحد أسفل السلة.
    const banner = src.slice(
      src.indexOf('pos-edit-banner'),
      src.indexOf('pos-cart-head'),
    );
    expect(banner).not.toContain('openPaySheet');
  });

  test('زر الشحن أسفل السلة يتبدل لزر إتمام التعديل ويسمح بإرجاع كامل', () => {
    const src = read(POS);
    // التعطيل: سلة فارغة مسموحة أثناء التعديل (إرجاع كامل).
    expect(src).toContain(
      'disabled={(editSession == null && lines.length === 0) || busy}',
    );
    // التسميات الثلاث.
    expect(src).toContain("'إتمام التعديل (إرجاع كامل)'");
    expect(src).toContain("'إتمام التعديل — F9'");
    expect(src).toContain("'إتمام البيع — F9'");
  });

  test('F9 يفتح نافذة الإتمام ولو كانت السلة فارغة أثناء التعديل', () => {
    const src = read(POS);
    expect(src).toContain(
      'if ((lines.length > 0 || editSession != null) && !busy) openPaySheet();',
    );
  });

  test('حوار الإلغاء موحّد في cancelEditWithConfirm (كان مكرراً 3 مرات)', () => {
    const src = read(POS);
    expect(src).toContain('const cancelEditWithConfirm = useCallback(() => {');
    // مستخدَم من ✕ الشريط (مرجع مباشر) وF1 وزر التفريغ (نداءان).
    expect(src.match(/cancelEditWithConfirm\(\);/g)?.length).toBe(2);
    expect(src).toContain('onClick={cancelEditWithConfirm}');
    // نص التأكيد لم يتغير.
    expect(src).toContain('سيُلغى تعديل الفاتورة');
  });

  test('CSS الشريط المضغوط: سطر واحد flex-wrap بلا عمود', () => {
    const css = read(POS_CSS);
    expect(css).toContain('.pos-edit-nums {');
    expect(css).toContain('.pos-edit-x {');
    // لا يعود عموداً مكدساً.
    const block = css.slice(
      css.indexOf('.pos-edit-banner {'),
      css.indexOf('.pos-edit-banner b {'),
    );
    expect(block).not.toContain('flex-direction: column');
    expect(block).toContain('flex-wrap: wrap');
  });
});

describe('v84 — ③ شعارات المحافظ والبنوك تظهر في التقارير', () => {
  test('حشوة .pmi-real بكسل ثابت — لا نسبة من الحاوية الخارجية', () => {
    const css = read(STYLES);
    expect(css).toContain('padding: 2px;');
    expect(css).not.toContain('padding: 2.5%;');
    expect(css).not.toContain('padding: 6%;');
    // شارة الفاتورة كذلك.
    expect(css).toContain('padding: 1px;');
    expect(css).not.toContain('padding: 2%;');
  });
});

describe('v84 — معاينة التطوير تغطي مسار التعديل والتقارير', () => {
  test('devMock يعيد دفاتر القنوات وفاتورة قابلة للتعديل', () => {
    const mock = read(DEV_MOCK);
    expect(mock).toContain('MOCK_METHOD_LEDGERS');
    expect(mock).toContain('MOCK_SALE');
    expect(mock).toContain("clean.startsWith('select method')");
  });
});

describe('v84 — الإصدار: 84.0.0 (29) في كل ملفات الإصدار', () => {
  test('config وpackage وtauri وCargo عند 84.0.0 / 28', () => {
    expect(read(CONFIG)).toContain("APP_VERSION = '87.0.0'");
    expect(read(CONFIG)).toContain('APP_BUILD_CODE = 31');
    expect(read('package.json')).toContain('"version": "87.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain(
      '"version": "87.0.0"',
    );
    expect(read('src-tauri/Cargo.toml')).toContain('version = "87.0.0"');
    // درس v71/v74: القفل يجب أن يطابق Cargo.toml وإلا رفض --locked.
    expect(read('Cargo.lock')).toContain(
      'name = "sela-pos-desktop"\nversion = "87.0.0"',
    );
  });
});
