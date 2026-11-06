/**
 * v86-round92.test.ts — الجولة 92 لسطح المكتب: مطابقة أندرويد v79
 * (ملاحظات النقطة الثالثة كلها).
 * ─────────────────────────────────────────────────────────────────
 *   ١ جذر خطأ «تعذر حفظ الفاتورة — NOT NULL constraint failed:
 *     merchant_movements.created_at»: الإدراج كان يمرر NULL صريحاً
 *     لعمود NOT NULL DEFAULT — طابع محلي localNow() دائماً.
 *   ٢ دين مستحق مباشر للتجار بلا فاتورة: نوع خامس debt + زر في
 *     نافذة الحركة + شفاء نواة Rust يعيد بناء الجدول بقيد موسّع.
 *   ٣ تنزيل كشف حساب التاجر ودفتر التجار ككل — PDF احترافي
 *     (Canvas A4 150DPI) وCSV.
 *   ٤ نوافذ احترافية: شارات أنواع ملونة، تفكيك الدين في بطاقة
 *     الرصيد والتقارير.
 *   ٥ مسامير الإصدار 86.0.0 (30).
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) =>
  readFileSync(p, 'utf8').replace(/\r\n/g, '\n') as string;

const MERCHANT_REPO = 'src/database/repositories/MerchantRepo.ts';
const MERCHANT_SCREEN = 'src/screens/MerchantsScreen.tsx';
const MERCHANT_EXPORTS = 'src/services/MerchantExports.ts';
const STATEMENT_PDF = 'src/services/StatementPdf.ts';
const CONNECTION_RUST = 'crates/sela-core/src/db.rs';
const REPORTS = 'src/screens/ReportsScreen.tsx';
const BACKUP = 'src/services/BackupService.ts';
const CONFIG = 'src/core/config.ts';

describe('v86 — ١ جذر خطأ created_at في حركات التجار', () => {
  test('لا يبقى NULL صريح لعمود created_at في أي إدراج', () => {
    const repo = read(MERCHANT_REPO);
    expect(repo).not.toContain('input.createdAt ?? null');
    const matches = repo.match(/\?\? localNow\(\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  test('الطابع المحلي مستورد من format', () => {
    expect(read(MERCHANT_REPO)).toContain(
      "import {localNow, localToday} from '../../core/format'",
    );
  });
});

describe('v86 — ٢ الدين المستحق المباشر بلا فاتورة', () => {
  test('نوع خامس debt مع دالة إضافة مخصصة', () => {
    const repo = read(MERCHANT_REPO);
    expect(repo).toContain("| 'debt'");
    expect(repo).toContain('async addDirectDebt(');
    expect(repo).toContain("?, 'debt', ?, ?, ?");
    expect(repo).toContain("debt: 'دين'");
  });

  test('الدين يرفع الرصيد في القائمة والكشف والرصيد اللحظي', () => {
    const repo = read(MERCHANT_REPO);
    expect(repo).toContain(
      "SUM(CASE WHEN kind = 'debt' THEN amount ELSE 0 END)",
    );
    expect(repo).toContain("kind IN ('invoice', 'debt')");
    expect(repo).toContain(
      "SUM(CASE WHEN kind IN ('invoice', 'debt') THEN amount ELSE -amount END)",
    );
    expect(repo).toContain('debtsInRange');
  });

  test('شفاء نواة Rust v86: قيد CHECK موسّع + إعادة بناء الجدول', () => {
    const rust = read(CONNECTION_RUST);
    expect(rust).toContain('fn heal_v86(conn: &Connection) -> Result<()> {');
    expect(rust).toContain('heal_v86(conn)?;');
    expect(rust).toContain('merchant_movements_v86');
    expect(rust).toContain(
      "kind IN ('invoice','payment','return','collection','debt')",
    );
  });

  test('زر الدين المستحق في نافذة حركة التاجر', () => {
    const screen = read(MERCHANT_SCREEN);
    expect(screen).toContain("key: 'debt'");
    expect(screen).toContain('MerchantRepo.addDirectDebt');
    expect(screen).toContain("'تسجيل الدين المستحق'");
    expect(screen).toContain("KIND_TONES[row.movement.kind]");
  });

  test('النسخ الاحتياطي يتقبل نوع الدين', () => {
    const backup = read(BACKUP);
    expect(backup).toContain(
      "kind: 'invoice' | 'payment' | 'return' | 'collection' | 'debt'",
    );
    expect(backup).toContain("['invoice', 'payment', 'return', 'collection', 'debt']");
  });
});

describe('v86 — ٣ تنزيل الكشف والدفتر', () => {
  test('خدمة التصدير: كشف التاجر ودفتر التجار PDF وCSV', () => {
    const service = read(MERCHANT_EXPORTS);
    expect(service).toContain('async exportStatementPdf(');
    expect(service).toContain('async exportStatementCsv(');
    expect(service).toContain('async exportBookPdf(');
    expect(service).toContain('async exportBookCsv(');
    expect(service).toContain('دين مستحق مباشر');
  });

  test('محرك PDF: كشف التاجر ودفتر التجار بنفس هوية الكشوف', () => {
    const pdf = read(STATEMENT_PDF);
    expect(pdf).toContain('export async function exportMerchantStatementPdf(');
    expect(pdf).toContain('export async function exportMerchantsBookPdf(');
    expect(pdf).toContain('MERCHANT_COLS');
    expect(pdf).toContain('BOOK_COLS');
  });

  test('أزرار التنزيل في صفحة التاجر وفي شريط القائمة', () => {
    const screen = read(MERCHANT_SCREEN);
    expect(screen).toContain('تنزيل الكشف PDF');
    expect(screen).toContain('كشف CSV');
    expect(screen).toContain('تنزيل دفتر التجار PDF');
    expect(screen).toContain('دفتر CSV');
    expect(screen).toContain("runExport('bookPdf'");
  });
});

describe('v86 — ٤ النوافذ الاحترافية', () => {
  test('شارات أنواع ملونة في كشف الحساب (CSS)', () => {
    const css = read('src/screens/merchants.css');
    expect(css).toContain('.mer-kind-chip');
    expect(css).toContain('.mer-kind-chip.danger');
    expect(css).toContain('.mer-kind-chip.warn');
    expect(css).toContain('.mer-kind-chip.ok');
  });

  test('تفكيك الدين في بطاقة الرصيد والتقارير', () => {
    expect(read(MERCHANT_SCREEN)).toContain('دين مباشر');
    expect(read(REPORTS)).toContain('ديون مباشرة بالفترة');
    expect(read(REPORTS)).toContain('merchantTotals.debtsInRange');
  });
});

describe('v86 — مسامير الإصدار', () => {
  test('config.ts عند 86.0.0 (30)', () => {
    const config = read(CONFIG);
    expect(config).toContain("APP_VERSION = '86.0.0'");
    expect(config).toContain('APP_BUILD_CODE = 30');
  });

  test('package.json وtauri وCargo متطابقة (درس --locked)', () => {
    expect(read('package.json')).toContain('"version": "86.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain(
      '"version": "86.0.0"',
    );
    expect(read('src-tauri/Cargo.toml')).toContain('version = "86.0.0"');
    expect(read('Cargo.lock')).toContain(
      'name = "sela-pos-desktop"\nversion = "86.0.0"',
    );
  });
});
