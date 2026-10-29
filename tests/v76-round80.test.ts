/**
 * v76-round80.test.ts — الجولة 80 لسطح المكتب: ملاحظات التاجر.
 * ─────────────────────────────────────────────────────────────────
 *  ① قيمة البضاعة في المخزون: بطاقة في ملخص المخزون تحسب
 *     التكلفة×الكمية لكل منتج متتبع + قيمتها البيعية وهامشها،
 *     مع عدّ منفصل للكمية المفتوحة (بلا تتبع) كي يعرف التاجر
 *     بدقة ما الذي يشمله الرقم.
 *  ② تقرير PDF للمخزون بالتفصيل: زر في صفحة المخزون يبني ملفاً
 *     A4 مرتباً بالتصنيفات مع مجاميع كل تصنيف وحالة ملونة
 *     للمخزون — بنفس محرك pdfWriter المجرب (v72).
 *  ④أ شعارات الجهات أكبر: الحواف المدمجة داخل ملفات الشعارات
 *     قُصّت (سكربت trim_pm_logos) والحشوة 6%→2.5% — الشعار يملأ
 *     إطاره بالكامل بدل أن «يبدو صغيراً في اطار الصورة».
 *  ④ب تنظيم صفحة التقارير بتبويبات: طلب التاجر نصاً «تحسين
 *     وتنظيم صفحة التقارير بشكل احترافي… حتى مع كمية كبيرة من
 *     البيانات» — الأقسام التسعة كانت مكدسة في تمرير واحد طويل؛
 *     الآن أربع تبويبات مستقلة والشريط ثابت أعلى الشاشة أثناء
 *     التمرير.
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const INVENTORY = 'src/screens/InventoryScreen.tsx';
const INVENTORY_CSS = 'src/screens/inventoryv57.css';
const PDF_SERVICE = 'src/services/InventoryReportPdf.ts';
const REPORTS = 'src/screens/ReportsScreen.tsx';
const REPORTS_CSS = 'src/screens/settingsv57.css';
const STYLES = 'src/styles.css';
const TRIM_SCRIPT = 'scripts/trim_pm_logos.py';

describe('v76 — ① قيمة البضاعة في المخزون', () => {
  test('حساب القيمة بالتكلفة والبيع مع فصل الكمية المفتوحة', () => {
    const src = read(INVENTORY);
    // المعادلة: تكلفة×كمية لكل متتبع — والمفتوحة تُعد ولا تُحتسب.
    expect(src).toContain('const stockValue = useMemo(');
    expect(src).toContain('product.stock_untracked === 1');
    expect(src).toContain('totalCostValue += product.cost_price * qty;');
    expect(src).toContain('totalRetailValue += finalPriceOf(product) * qty;');
    expect(src).toContain('stockValue.untrackedCount');
  });

  test('بطاقة القيمة وشريط التفصيل في الواجهة', () => {
    const src = read(INVENTORY);
    expect(src).toContain('قيمة البضاعة في المخزون (تكلفة)');
    expect(src).toContain('قيمة بالبيع');
    expect(src).toContain('هامش متوقع');
    expect(src).toContain('كمية مفتوحة (بلا تتبع)');
    const css = read(INVENTORY_CSS);
    expect(css).toContain('.inv-value-card .value {');
    expect(css).toContain('.inv-value-strip {');
    expect(css).toContain('.inv-value-cell .v.warn {');
  });
});

describe('v76 — ② تقرير PDF للمخزون بالتفصيل', () => {
  test('الخدمة موجودة وتبني على محرك pdfWriter المجرب', () => {
    const svc = read(PDF_SERVICE);
    expect(svc).toContain('export async function exportInventoryReportPdf(');
    expect(svc).toContain('buildImagePagesPdf');
    expect(svc).toContain(
      "stockState: 'out' | 'low' | 'ok' | 'untracked';",
    );
    // مجمّعة بالتصنيف + صف الإجمالي الكبير
    expect(svc).toContain('groups.push({name: row.category, rows: [row]});');
    expect(svc).toContain('const totalCells: Record<string, string> = {');
  });

  test('الزر في شريط أدوات المخزون مع تسمية الفلاتر في الترويسة', () => {
    const src = read(INVENTORY);
    expect(src).toContain('exportInventoryPdf');
    expect(src).toContain('تقرير PDF');
    expect(src).toContain('filtersLabel');
    expect(src).toContain("activeFilters.push(`تصنيف: ${cat.name}`)");
  });
});

describe('v76 — ④أ شعارات الجهات تملأ إطارها', () => {
  test('الحشوة انخفضت من 6% إلى 2.5%', () => {
    const css = read(STYLES);
    expect(css).toContain('padding: 2.5%;');
    expect(css).not.toContain('padding: 6%;');
    // شارة الصف داخل الفواتير
    expect(css).toContain('padding: 2%;');
  });

  test('سكربت قص الحواف المدمجة قابل لإعادة التشغيل', () => {
    const script = read(TRIM_SCRIPT);
    expect(script).toContain('non-uniform-border bounding box');
    expect(script).toContain('SAFETY = 0.02');
  });
});

describe('v76 — ④ب صفحة التقارير بتبويبات', () => {
  test('أربع تبويبات مستقلة بدل التمرير الطويل الواحد', () => {
    const src = read(REPORTS);
    expect(src).toContain(
      "type ReportTab = 'overview' | 'cash' | 'debts' | 'products';",
    );
    expect(src).toContain("const [activeTab, setActiveTab]");
    expect(src).toContain('className="rep-tabs" role="tablist"');
    expect(src).toContain("key: 'overview'");
    expect(src).toContain("key: 'cash'");
    expect(src).toContain("key: 'debts'");
    expect(src).toContain("key: 'products'");
  });

  test('كل قسم خلف تبويبه — لا يظهر إلا عند اختياره', () => {
    const src = read(REPORTS);
    // الملخص: KPIs + رسما الأداء والذروة
    expect(src).toContain("{activeTab === 'overview' && (<>");
    // النقد والخزينة: النقد المحصّل + أرصدة القنوات + الخزينة
    expect(src).toContain('{activeTab === \'cash\' && cash != null && (');
    expect(src).toContain(
      '{activeTab === \'cash\' && payMethods.length > 0 && (',
    );
    expect(src).toContain('{activeTab === \'cash\' && treasury != null && (');
    // الديون والقسائم
    expect(src).toContain('{activeTab === \'debts\' && debt != null && (');
    expect(src).toContain('{activeTab === \'debts\' && cash != null && (');
    // المنتجات والفواتير
    expect(src).toContain("{activeTab === 'products' && (<>");
    // إغلاق المجموعتين المجمّعتين
    expect(src).toContain('</>)}');
  });

  test('الشريط ثابت أعلى الشاشة أثناء التمرير (v77: رأس ثابت كامل)', () => {
    /* v77 (الجولة 81 #٥هـ): الشريط كان sticky داخل حاوية التمرير
       فيطفو منزاحاً عن الحافة وتنزلق البطاقات خلفه؛ الآن الرأس
       (العنوان + الفترة + التبويبات) ثابت بالبنية نفسها خارج
       صندوق التمرير (.rep-fixed-head) والمحتوى وحده يتمرر
       (.rep-scroll) — ثبات حتمي في كل WebView بلا sticky.
       (sticky في الملف يبقى لرؤوس الجداول فقط .sv57-table-scroll). */
    const css = read(REPORTS_CSS);
    expect(css).toContain('.screen.rep-screen {');
    expect(css).toContain('.rep-fixed-head {');
    expect(css).toContain('.rep-scroll {');
    // بلوك .rep-tabs الرئيسي (بداية سطر) بلا sticky.
    const tabsBlock = css.match(/^\.rep-tabs \{[^}]*\}/m)?.[0] ?? '';
    expect(tabsBlock).not.toContain('sticky');
    expect(tabsBlock).toContain('position: static;');
    expect(css).toContain('.rep-tab.on {');
    expect(css).toContain('.rep-tab .lbl-hint {');
    const src = read(REPORTS);
    expect(src).toContain('className="screen rep-screen"');
    expect(src).toContain('className="rep-fixed-head"');
    expect(src).toContain('className="rep-scroll"');
  });
});

describe('v76 — الإصدار', () => {
  test('77.0.0 (21) — محدّث للجولة 81', () => {
    const src = read('src/core/config.ts');
    expect(src).toContain("APP_VERSION = '77.0.0'");
    expect(src).toContain('APP_BUILD_CODE = 21');
    const pkg = read('package.json');
    expect(pkg).toContain('"version": "77.0.0"');
  });
});
