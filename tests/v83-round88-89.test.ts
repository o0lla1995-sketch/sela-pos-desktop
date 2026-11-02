/**
 * v83-round88-89.test.ts — الجولتان 88+89 لسطح المكتب (مطابقة
 * أندرويد v76/v77 في إصدار واحد): كل ملاحظات التاجر محمولة.
 * ─────────────────────────────────────────────────────────────────
 *  الجولة 88 (أندرويد v76):
 *   ① صورة المنتج الأساسية تستبدل فعلاً عند اختيار صورة جديدة — على
 *      سطح المكتب الاختيار الأصلي (حوار الملف) يستبدل image_uri
 *      مباشرة بلا أي شرط «صورة حية» (لا مسار بصمات في سطح المكتب).
 *   ② مدخل «المؤرشفة» دائم الظهور (حتى وهي فارغة) + زر «استرداد»
 *      بنص صريح في كل صف مؤرشف.
 *   ③+④ الخزينة كل مال المتجر: أرصدة القنوات الحية (دفترها عبر
 *      التاريخ) في التقارير ببطاقة «أرصدة المحافظ والبنوك الآن»،
 *      خلية «إجمالي الخزينة الآن» في شبكة الدين القائم، تسمية
 *      «مبيعات (نقد + بنوك ومحافظ)» بدل «مبيعات نقدية» الملبِسة،
 *      و«صافي حركة الخزينة بالفترة (كل القنوات)» مع تمييز صريح
 *      أن سالبيتها بعد سحب رصيد طبيعية.
 *  الجولة 89 (أندرويد v77):
 *   ① الرئيسية: الخلية الكبرى «إجمالي في الخزينة» بدل النقد وحده.
 *   ② الخزينة: الرقم الكبير «الإجمالي في الخزينة الآن».
 *   ③ سجل الحركات: سندات rewriteSale الداخلية (تحصيل/رد/تسوية
 *      قناة تعديل فاتورة) تخفى من السجل والعدّاد وإجماليات الفترة،
 *      وتبقى في دفتر أرصدة القنوات (هي ما يوازن كشف كل قناة).
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const HOME = 'src/screens/HomeScreen.tsx';
const CASH_SCREEN = 'src/screens/CashMovementsScreen.tsx';
const CASH_REPO = 'src/database/repositories/CashRepo.ts';
const SALE_REPO = 'src/database/repositories/SaleRepo.ts';
const REPORTS = 'src/screens/ReportsScreen.tsx';
const REPORT_SERVICE = 'src/services/ReportService.ts';
const INVENTORY = 'src/screens/InventoryScreen.tsx';
const FORM = 'src/screens/ProductFormModal.tsx';
const CONFIG = 'src/core/config.ts';

const SETTLEMENT_CATEGORIES = [
  'تحصيل فرق تعديل فاتورة',
  'رد فرق تعديل فاتورة',
  'تسوية قناة تعديل فاتورة',
] as const;

/* ── الجولة 88 ─────────────────────────────────────────────────── */

describe('v83 — ٨٨① صورة المنتج الأساسية تستبدل مباشرة', () => {
  test('pickImage يعيّن imageUri بلا أي شرط (وجه المنتج الجديد)', () => {
    const src = read(FORM);
    const pickIdx = src.indexOf('const pickImage = useCallback(');
    expect(pickIdx).toBeGreaterThan(0);
    const pickBlock = src.slice(pickIdx, pickIdx + 700);
    expect(pickBlock).toContain('await api.pickProductImage()');
    // الاستبدال غير المشروط — لا بوابة «صورة حية» تمنع الجديدة.
    expect(pickBlock).toContain('setImageUri(path);');
    expect(pickBlock).not.toContain('currentIsDead');
    expect(pickBlock).not.toContain('imageUri != null');
  });

  test('الحفظ يكتب image_uri من حالة النموذج (ينتشر للمتجر أونلاين)', () => {
    const src = read(FORM);
    expect(src).toContain('image_uri: imageUri,');
  });
});

describe('v83 — ٨٨② المؤرشفة: مدخل دائم + استرداد بنص صريح', () => {
  test('رقاقة «المؤرشفة» تظهر دائماً — تتعطل عند الفراغ لا تختفي', () => {
    const src = read(INVENTORY);
    // v83: بلا حراسة length > 0 حول الرقاقة (كانت تخفي الميزة).
    expect(src).not.toContain(
      '{archivedProducts.length > 0 && (\n          <button\n            className={`iv57-chip ${showArchived',
    );
    expect(src).toContain(
      'disabled={archivedProducts.length === 0 && !showArchived}',
    );
    expect(src).toContain('استردادها متاح دائماً');
  });

  test('زر «استرداد» بلمسة واحدة في الصف المؤرشف — بنص لا أيقونة وحدها', () => {
    const src = read(INVENTORY);
    const unarchBtnIdx = src.indexOf('void unarchiveProduct(product)');
    expect(unarchBtnIdx).toBeGreaterThan(0);
    const btnBlock = src.slice(Math.max(0, unarchBtnIdx - 400), unarchBtnIdx + 120);
    expect(btnBlock).toContain('<Icon name="undo" size={15} />');
    expect(btnBlock).toContain('استرداد');
    // الاسترداد يوقظ المنتج فعلاً ويحدّث الرف والقائمة معاً.
    expect(src).toContain('await ProductRepo.unarchive(product.id);');
    expect(src).toContain('await loadArchived();');
  });
});

describe('v83 — ٨٨③+④ التقارير: أرصدة حية + إجمالي الخزينة + تسميات صادقة', () => {
  test('الأرصدة الحية تُحمَّل عبر التاريخ (دفتر كل قناة «الآن»)', () => {
    const src = read(REPORTS);
    expect(src).toContain('const [liveMethods, setLiveMethods] = useState<');
    expect(src).toContain("from: '2000-01-01',");
    expect(src).toContain("to: '2999-12-31',");
    // الاتحاد: من له حركة بالفترة أو رصيد قائم عبر التاريخ.
    expect(src).toContain('const channelNowRows = useMemo(() => {');
    expect(src).toContain('const channelsNowTotal = useMemo(');
    expect(src).toContain('const treasuryNowTotal = useMemo(');
    // الإجمالي = النقد بالدرج (لقطة الخزينة) + مجموع القنوات.
    const treasuryIdx = src.indexOf('const treasuryNowTotal = useMemo(');
    const eqBlock = src.slice(treasuryIdx, treasuryIdx + 260);
    expect(eqBlock).toContain('(treasury?.cashTotal ?? 0) + channelsNowTotal');
  });

  test('بطاقة «أرصدة المحافظ والبنوك الآن» — الرصيد الحي هو الرقم الكبير', () => {
    const src = read(REPORTS);
    expect(src).toContain('أرصدة المحافظ والبنوك الآن');
    expect(src).toContain('رصيد كل قناة الآن (دفترها عبر التاريخ)');
    // حركة الفترة سطر تفصيلي تحت الرصيد الحي.
    const rowIdx = src.indexOf('channelNowRows.map(row => {');
    const rowBlock = src.slice(rowIdx, rowIdx + 1400);
    expect(rowBlock).toContain('const liveNet = row.live?.net ?? 0;');
    expect(rowBlock).toContain('الفترة: دخل');
    expect(rowBlock).toContain('لا حركة بالفترة — رصيد قائم من قبلها');
    // المجاميع.
    expect(src).toContain('البنوك والمحافظ معاً الآن');
    expect(src).toContain('إجمالي الخزينة الآن — نقد + بنوك ومحافظ');
    // ملاحظة الأرصدة: صافي الفترة قد يكون سالباً بعد السحب (النص في
    // JSX مقسوم على سطرين — نطابق السطرين كلٌّ على حدة).
    expect(src).toContain('السقف الذي تسقّفه سندات السحب والمصروف');
    expect(src).toContain('بعد سحب رصيد؛ لا يعني ذلك رصيداً سالباً');
  });

  test('خلية «إجمالي الخزينة الآن» الثالثة في شبكة الدين القائم', () => {
    const src = read(REPORTS);
    const trioIdx = src.indexOf('sv57-trio');
    expect(trioIdx).toBeGreaterThan(0);
    const trioBlock = src.slice(trioIdx, trioIdx + 2200);
    expect(trioBlock).toContain('الدين القائم الآن');
    expect(trioBlock).toContain('النقد بالخزينة الآن');
    expect(trioBlock).toContain('إجمالي الخزينة الآن');
    expect(trioBlock).toContain('نقد بالدرج + بنوك ومحافظ');
  });

  test('بطل النقد: «مبيعات (نقد + بنوك ومحافظ)» بدل «مبيعات نقدية»', () => {
    const src = read(REPORTS);
    expect(src).toContain('مبيعات (نقد + بنوك ومحافظ)');
    // التسمية الملبِسة القديمة زالت من بطاقة النقد (يبقى قسيم الدين
    // «والباقي مبيعات نقدية» — هناك المقصود فعلاً نقدي الديون).
    const heroIdx = src.indexOf('النقد المحصّل بالفترة');
    const heroBlock = src.slice(heroIdx, heroIdx + 500);
    expect(heroBlock).not.toContain('مبيعات نقدية');
  });

  test('«صافي حركة الخزينة بالفترة (كل القنوات)» + تمييز السالبية', () => {
    const src = read(REPORTS);
    expect(src).toContain('صافي حركة الخزينة بالفترة (كل القنوات)');
    expect(src).toContain('صافي حركة الفترة (بعد المصروفات والمسحوبات)');
    // النص في JSX مقسوم على سطرين — نطابق كلا السطرين.
    expect(src).toContain('قد يكون سالباً بعد سحب رصيد، وهذا');
    expect(src).toContain('طبيعي ولا يعني رصيداً سالباً');
  });

  test('بطاقة الحركات في التقارير بكل القنوات (scope all)', () => {
    const src = read(REPORT_SERVICE);
    expect(src).toContain("CashRepo.totalsFor(range.from, range.to, 'all')");
  });
});

/* ── الجولة 89 ─────────────────────────────────────────────────── */

describe('v83 — ٨٩① الرئيسية: الإجمالي في الخلية الكبرى', () => {
  test('الخلية الأولى «إجمالي في الخزينة» بقيمة treasuryTotalNow', () => {
    const src = read(HOME);
    expect(src).toContain('إجمالي في الخزينة</span>');
    const heroIdx = src.indexOf('إجمالي في الخزينة</span>');
    const heroBlock = src.slice(heroIdx, heroIdx + 500);
    expect(heroBlock).toContain('treasuryTotalNow');
    // المعادلة: الإجمالي = النقد + مجموع أرصدة القنوات.
    expect(src).toContain(
      'const methodsTotal = methodBalances.reduce(',
    );
    expect(src).toContain(
      'const treasuryTotalNow = (drawerMinor ?? 0) / 100 + methodsTotal;',
    );
    // النص الفرعي يشرح التركيب.
    expect(heroBlock).toContain('النقد بالدرج + البنوك والمحافظ');
  });

  test('تسمية الخلية النقدية القديمة زالت من الرئيسية', () => {
    const src = read(HOME);
    expect(src).not.toContain('النقد المتوقع بالخزينة الآن');
  });

  test('شريط أرصدة القنوات التفصيلي باقٍ (الرصيد لكل قناة)', () => {
    const src = read(HOME);
    expect(src).toContain('ih-channel-chip');
    expect(src).toContain('methodBalances.map(channel =>');
  });
});

describe('v83 — ٨٩② الخزينة: الرقم الكبير هو الإجمالي', () => {
  test('البطاقة تحمل «الإجمالي في الخزينة الآن» وتجمع النقد والقنوات', () => {
    const src = read(CASH_SCREEN);
    expect(src).toContain('الإجمالي في الخزينة الآن</div>');
    const heroIdx = src.indexOf('الإجمالي في الخزينة الآن</div>');
    const heroBlock = src.slice(heroIdx, heroIdx + 400);
    expect(heroBlock).toContain('treasuryNowMinor');
    // الإجمالي = الدرج + مجموع أرصدة القنوات (بالأغورات).
    expect(src).toContain(
      'drawerMinor +',
    );
    expect(src).toContain(
      'channelBalances.reduce((sum, ch) => sum + Math.round(ch.balance * 100), 0)',
    );
    // النص الفرعي يشرح التركيب.
    expect(heroBlock).toContain('النقد بالدرج + البنوك والمحافظ');
  });

  test('تسمية «النقد المتوقع بالخزينة الآن» زالت — الرقم صار الإجمالي', () => {
    const src = read(CASH_SCREEN);
    expect(src).not.toContain('النقد المتوقع بالخزينة الآن');
  });

  test('أرصدة القنوات ما زالت تُحمَّل (تغذي الرقم الكبير وسقوف السندات)', () => {
    const src = read(CASH_SCREEN);
    expect(src).toContain('setChannelBalances(balances);');
    expect(src).toContain('ReportService.methodBalanceNow(m.id)');
  });
});

describe('v83 — ٨٩③ السجل: تسويات تعديل الفاتورة خارج إطار الخزينة', () => {
  test('الثابت في CashRepo يطابق حرفياً فئات INSERT في SaleRepo', () => {
    const repo = read(CASH_REPO);
    const sale = read(SALE_REPO);
    // الثابت معرَّف ومصدَّر.
    expect(repo).toContain(
      'export const INVOICE_EDIT_SETTLEMENT_CATEGORIES: readonly string[] = [',
    );
    // كل فئة من الثلاث موجودة في كلا الملفين — التطابق هو ما يجعل
    // الاستبعاد آمناً بلا معرف تقني إضافي.
    for (const category of SETTLEMENT_CATEGORIES) {
      expect(repo).toContain(`'${category}'`);
      expect(sale).toContain(`'${category}'`);
    }
  });

  test('list وcountFor يستبعدانها — العداد يطابق الصفوف المعروضة', () => {
    const repo = read(CASH_REPO);
    // الدالة المشتركة معرفة.
    expect(repo).toContain('function excludedSettlementClause(');
    expect(repo).toContain(
      'category NOT IN (${INVOICE_EDIT_SETTLEMENT_CATEGORIES.map(',
    );
    // list: الاستبعاد بعد فلتر النوع.
    const listIdx = repo.indexOf('async list(input: {');
    const listBlock = repo.slice(listIdx, listIdx + 1000);
    expect(listBlock).toContain('excludedSettlementClause(clauses, params);');
    // countFor: نفس الاستبعاد.
    const countIdx = repo.indexOf('async countFor(');
    const countBlock = repo.slice(countIdx, countIdx + 900);
    expect(countBlock).toContain('excludedSettlementClause(clauses, params);');
  });

  test('totalsFor يستبعدها في النطاقين — إجماليات بلا سندات داخلية', () => {
    const repo = read(CASH_REPO);
    const totalsIdx = repo.indexOf('async totalsFor(');
    const totalsBlock = repo.slice(totalsIdx, totalsIdx + 900);
    expect(totalsBlock).toContain('excludedSettlementClause(clauses, params);');
    // الاستعلام يبني WHERE من clauses (لا تاريخاً ثابتاً).
    expect(totalsBlock).toContain("WHERE ${clauses.join(' AND ')}");
  });

  test('دفتر أرصدة القنوات يبقى يشملها — المعادلة لا تنكسر', () => {
    const repo = read(CASH_REPO);
    const sale = read(SALE_REPO);
    // listForMethod (كشف القناة التفصيلي) بلا استبعاد — تسويات
    // القناة جزء من توازن دفترها.
    const lfmIdx = repo.indexOf('async listForMethod(');
    const lfmBlock = repo.slice(lfmIdx, lfmIdx + 900);
    expect(lfmBlock).not.toContain('excludedSettlementClause');
    // السندان المتقابلان يكتبان كما هما في rewriteSale.
    expect(sale).toContain('maySettleChannels &&');
    expect(sale).toContain('تسوية قناة تعديل فاتورة');
    // categoryTotals لم يُمس (فئات المصروف كالمعتاد).
    const catIdx = repo.indexOf('async categoryTotals(');
    const catBlock = repo.slice(catIdx, catIdx + 500);
    expect(catBlock).not.toContain('excludedSettlementClause');
  });
});

/* ── الإصدار ───────────────────────────────────────────────────── */

describe('v83 — الإصدار: 83.0.0 (27) في كل ملفات الإصدار', () => {
  test('config وpackage وtauri وCargo عند 83.0.0 / 27', () => {
    expect(read(CONFIG)).toContain("APP_VERSION = '83.0.0'");
    expect(read(CONFIG)).toContain('APP_BUILD_CODE = 27');
    expect(read('package.json')).toContain('"version": "83.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain('"version": "83.0.0"');
    expect(read('src-tauri/Cargo.toml')).toContain('version = "83.0.0"');
    // درس v71/v74: القفل يجب أن يطابق Cargo.toml وإلا رفض --locked.
    expect(read('Cargo.lock')).toContain(
      'name = "sela-pos-desktop"\nversion = "83.0.0"',
    );
  });
});
