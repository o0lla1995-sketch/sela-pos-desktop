/**
 * v80 — الجولة 85: تعديل الفاتورة عبر نقطة البيع (سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * نفس طلب التاجر في الأندرويد v73 حرفياً: «عند الرجوع للفاتورة
 * السابقة وتعديلها وإتمام البيع تُستبدل الفاتورة الأصلية بالنسخة
 * المعدلة (كأنها لم تسجل بعد — تعديل الأصناف أو طريقة الدفع أو
 * الخصم) بدل إنشاء فاتورة جديدة تداخلها»، و«الإرجاع والاستبدال
 * من نقطة البيع مباشرة (مسح باركود الفاتورة أو زر الإرجاع من
 * صفحة الفواتير) مع الحفاظ على منطق الخصم والرجوع للمخزون».
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8') as string;

const CORE = 'crates/sela-core/src/db.rs';
const SALE_REPO = 'src/database/repositories/SaleRepo.ts';
const INVOICE_SERVICE = 'src/services/InvoiceService.ts';
const CART_STORE = 'src/stores/cartStore.ts';
const TYPES = 'src/core/types.ts';
const POS = 'src/screens/PosScreen.tsx';
const INVOICES = 'src/screens/InvoicesScreen.tsx';
const APP = 'src/app.tsx';
const RECEIPT = 'src/services/printer/receipt.ts';
const DEBT_RECEIPT = 'src/services/printer/debtReceipt.ts';
const CONFIG = 'src/core/config.ts';

describe('v80 — ١ نواة Rust: أعمدة التعديل + سجل التدقيق', () => {
  test('DDL: edit_count/edited_at + جدول sale_edits', () => {
    const src = read(CORE);
    expect(src).toContain('edit_count INTEGER NOT NULL DEFAULT 0');
    expect(src).toContain('edited_at TEXT');
    expect(src).toContain('CREATE TABLE IF NOT EXISTS sale_edits');
    expect(src).toContain('before_json TEXT NOT NULL');
    expect(src).toContain('after_json TEXT NOT NULL');
  });

  test('شفاء القواعد القديمة: العمودان في قائمة heal المحروسة', () => {
    const src = read(CORE);
    expect(src).toContain(
      '("sales", "edit_count", "INTEGER NOT NULL DEFAULT 0")',
    );
    expect(src).toContain('("sales", "edited_at", "TEXT")');
  });
});

describe('v80 — ٢ rewriteSale + خدمة التعديل (نفس الأندرويد)', () => {
  test('rewriteSale: الطيّ والفرق والتسوية واللقطة', () => {
    const src = read(SALE_REPO);
    expect(src).toContain('async rewriteSale');
    expect(src).toContain(
      'DELETE FROM sales WHERE invoice_number = ? AND return_kind IS NOT NULL',
    );
    expect(src).toContain('أعد فتح تعديل الفاتورة من جديد');
    expect(src).toContain('edit_count = ?, edited_at = ?, returned_minor = 0');
    expect(src).toContain(
      'totalMinor -\n            origMinor +\n            priorSilaReversalMinor +\n            priorEditsReversalMinor',
    );
    expect(src).toContain('INSERT INTO sale_edits');
  });

  test('المرجع البنيوي لعكوس التعديل (تعديلات متتالية على دين متزامن)', () => {
    const repo = read(SALE_REPO);
    expect(repo).toContain('-RVS${editCountAfter}');
    expect(repo).toContain('priorEditsReversalMinor');
  });

  test('prepareInvoiceEdit + settleInvoiceEdit + الفرق الأونلاين', () => {
    const src = read(INVOICE_SERVICE);
    expect(src).toContain('prepareInvoiceEdit');
    expect(src).toContain('settleInvoiceEdit');
    expect(src).toContain('إرجاع كامل عبر تعديل الفاتورة');
    expect(src).toContain('diffCartVsInvoice');
    expect(src).toContain('دين هذه الفاتورة مسدَّد/محذوف من الدفتر');
  });
});

describe('v80 — ٣ السلة: الجلسة تنجو مع المسودة', () => {
  test('editSession + beginEdit/cancelEdit', () => {
    const src = read(CART_STORE);
    expect(src).toContain('editSession: InvoiceEditSession | null;');
    expect(src).toContain('beginEdit: (');
    expect(src).toContain('cancelEdit: (');
    expect(src).toContain('editSession: session,');
    // التفريغ والنسخ يسقطان الجلسة.
    expect(src).toContain('set({lines: [], discount: 0, editSession: null});');
  });
});

describe('v80 — ٤ نقطة البيع: الشريط والماسح وF8', () => {
  test('شريط التعديل + نافذتا الخيار والإتمام', () => {
    const src = read(POS);
    expect(src).toContain('pos-edit-banner');
    expect(src).toContain('تعديل الفاتورة {editSession.invoiceNumber}');
    expect(src).toContain('إتمام التعديل');
    expect(src).toContain('نسخها كسلة جديدة');
    expect(src).toContain('تعديل الفاتورة الأصلية');
    expect(src).toContain('تأكيد التعديل واستبدال الفاتورة');
    expect(src).toContain('الفرق يُعدَّل تلقائياً على دين الزبون');
  });

  test('مسح باركود الفاتورة يفتحها للتعديل', () => {
    const src = read(POS);
    expect(src).toContain(
      '/^(INV(-[A-Z])?|RET)-\\d{8}-\\d{4}$/.test(code.trim())',
    );
    expect(src).toContain('openInvoiceEdit(sale.id, {confirmClearCart: true})');
  });

  test('F1 أثناء التعديل = إلغاء بصراحة، وF2/F3 ممنوعان', () => {
    const src = read(POS);
    expect(src).toContain('سيُلغى تعديل الفاتورة');
    expect(src).toContain(
      'أثناء تعديل الفاتورة لا يُسجَّل دين جديد',
    );
  });

  test('زر الإتمام (F9) يفتح نافذة التعديل أثناء الجلسة', () => {
    const src = read(POS);
    expect(src).toContain('setEditSettleOpen(true)');
  });
});

describe('v80 — ٥ صفحة الفواتير → نقطة البيع', () => {
  test('زر الإرجاع/الاستبدال يفتح الفاتورة في نقطة البيع', () => {
    const src = read(INVOICES);
    expect(src).toContain('openInvoiceEditFromInvoices');
    expect(src).toContain("goTo?.('pos')");
    // لا يفتح نافذة الإرجاع القديمة من زر التفصيل.
    expect(src).not.toContain('onReturn={() => setReturnId(detailId)}');
  });

  test('goTo يُمرَّر من app.tsx + وسم «معدلة ×N»', () => {
    expect(read(APP)).toContain('<InvoicesScreen goTo={key => setScreen(key)} />');
    expect(read(INVOICES)).toContain('معدلة ×');
  });
});

describe('v80 — ٦ الإيصال والإصدار', () => {
  test('سطر «نسخة معدلة» على إيصالي البيع والدين', () => {
    expect(read(RECEIPT)).toContain('نسخة معدلة');
    expect(read(DEBT_RECEIPT)).toContain('نسخة معدلة');
  });

  test('النوع يحمل الجلسة', () => {
    expect(read(TYPES)).toContain('export interface InvoiceEditSession');
  });

  test('84.0.0 (28) في كل ملفات الإصدار', () => {
    expect(read(CONFIG)).toContain("APP_VERSION = '84.0.0'");
    expect(read(CONFIG)).toContain('APP_BUILD_CODE = 28');
    expect(read('package.json')).toContain('"version": "84.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain('"version": "84.0.0"');
    expect(read('src-tauri/Cargo.toml')).toContain('version = "84.0.0"');
  });
});
