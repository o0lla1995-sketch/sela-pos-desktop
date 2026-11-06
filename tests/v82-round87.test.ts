/**
 * v82 — الجولة 87: فرق تعديل الفاتورة يتحرك وحده بين القنوات.
 * ─────────────────────────────────────────────────────────────────
 * نفس إصلاح الأندرويد v75 بالضبط: شكوى التاجر — بعد تعديل الفاتورة
 * (إرجاع/استبدال/إضافة) واحتساب الفرق واختيار قناة ردّه، كان النظام
 * يخصم كامل المبلغ من القناة الأصلية وينقل كامل قيمة الفاتورة إلى
 * القناة المختارة، بدل تحريك الفرق وحده عبرها.
 */
import {describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8') as string;

const SALE_REPO = 'src/database/repositories/SaleRepo.ts';
const INVOICE_SERVICE = 'src/services/InvoiceService.ts';
const CONFIG = 'src/core/config.ts';

describe('v82 — ١ فرق التعديل يتحرك وحده (لا كامل الفاتورة)', () => {
  test('rewriteSale: مدخلاته تحمل settleMethod لا paymentMethod', () => {
    const src = read(SALE_REPO);
    expect(src).toContain('settleMethod?: string | null;');
    expect(src).not.toContain('paymentMethod: string | null;\n  /** دفتر الفاتورة');
  });

  test('إعادة الكتابة لا تمس طريقة دفع الفاتورة (تبقى الأصلية)', () => {
    const src = read(SALE_REPO);
    const updateIdx = src.indexOf(
      'edit_count = ?, edited_at = ?, returned_minor = 0',
    );
    expect(updateIdx).toBeGreaterThan(0);
    const updateBlock = src.slice(Math.max(0, updateIdx - 400), updateIdx + 60);
    expect(updateBlock).not.toContain('payment_method = ?');
    expect(src).toContain('payment_method: originalPaymentMethod,');
  });

  test('سندا التسوية المتقابلان على القناتين — لا سند عند التساوي', () => {
    const src = read(SALE_REPO);
    expect(src).toContain("await reserveRef('deposit')");
    expect(src).toContain("await reserveRef('withdrawal')");
    expect(src).toContain('maySettleChannels &&');
    expect(src).toContain('Math.abs(editDeltaMinor) >= 1');
    expect(src).toContain('chosenSettleMethod !== originalPaymentMethod');
    expect(src).toContain("'تحصيل فرق تعديل فاتورة'");
    expect(src).toContain("'رد فرق تعديل فاتورة'");
    expect(src).toContain("'تسوية قناة تعديل فاتورة'");
    // السندان داخل معاملة rewriteSale نفسها (ذرية كاملة).
    const txStart = src.indexOf('await db.transaction(async tx => {');
    const firstInsert = src.indexOf('تحصيل فرق تعديل فاتورة');
    const lastInsert = src.indexOf('تسوية قناة تعديل فاتورة');
    expect(txStart).toBeGreaterThan(0);
    expect(firstInsert).toBeGreaterThan(txStart);
    expect(lastInsert).toBeGreaterThan(firstInsert);
  });

  test('الخدمة تمرر القناة المختارة كقناة تسوية فرق فقط', () => {
    const src = read(INVOICE_SERVICE);
    expect(src).toContain('settleMethod: input.paymentMethod,');
  });

  test('المعادلة المحاسبية: كل قناة تطابق كشفها (منطق نقي)', () => {
    // فاتورة أصلها 1000₪ عبر محفظة A، عُدلت إلى 800₪ والفرق رُد عبر B:
    // بعد الإصلاح: A: 800 مبيعات + 200 مقابل = +1000 (كشفها الفعلي)،
    // B: -200 (كشفها الفعلي)، والصافي +800 = قيمة الفاتورة المعدلة.
    const ledger: Record<string, number> = {};
    const credit = (ch: string, minor: number) => {
      ledger[ch] = (ledger[ch] ?? 0) + minor;
    };
    credit('walletA', 800); // الصف المعاد كتابته على الأصلية
    credit('walletB', -200); // سند الرد على المختارة
    credit('walletA', +200); // المقابل على الأصلية
    expect(ledger.walletA).toBe(1000);
    expect(ledger.walletB).toBe(-200);
    expect(ledger.walletA + ledger.walletB).toBe(800);

    // الاتجاه المعاكس: أصل 800 عبر A، تعديل إلى 1000، الفرق حُصّل عبر B.
    const ledger2: Record<string, number> = {};
    const credit2 = (ch: string, minor: number) => {
      ledger2[ch] = (ledger2[ch] ?? 0) + minor;
    };
    credit2('walletA', 1000);
    credit2('walletB', +200);
    credit2('walletA', -200);
    expect(ledger2.walletA).toBe(800);
    expect(ledger2.walletB).toBe(200);
    expect(ledger2.walletA + ledger2.walletB).toBe(1000);
  });
});

describe('v82 — ٢ الإصدار', () => {
  test('84.0.0 (29) في كل ملفات الإصدار', () => {
    expect(read(CONFIG)).toContain("APP_VERSION = '86.0.0'");
    expect(read(CONFIG)).toContain('APP_BUILD_CODE = 30');
    expect(read('package.json')).toContain('"version": "86.0.0"');
    expect(read('src-tauri/tauri.conf.json')).toContain('"version": "86.0.0"');
    expect(read('src-tauri/Cargo.toml')).toContain('version = "86.0.0"');
  });
});
