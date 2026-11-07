/**
 * MerchantExports — v86 (الجولة 92 #٣): تنزيل كشوف حسابات التجار.
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر: «إمكانية تنزيل كشف حساب للتاجر او التجار ككل».
 *  • كشف تاجر واحد: PDF احترافي (Canvas A4 150DPI — نفس هوية كشوف
 *    الخزينة والقنوات) أو CSV (Excel) بكل الحركات والرصيد الجاري.
 *  • دفتر التجار ككل: PDF بسطر لكل تاجر أو CSV بتفكيك كل رصيد.
 */
import {MerchantRepo, type MerchantStatementRow} from '../database/repositories/MerchantRepo';
import {useSettingsStore} from '../stores/settingsStore';
import {paymentMethodById} from '../core/paymentMethods';
import {logDiag} from '../core/diagnostics';

/** v87 (الجولة 93 #٢): تصدير كشوف التجار CSV أُلغي بطلب التاجر
 * («اريده تقرير pdf قابل للطباعة وليس تقرير اكسل او csv لغيهما»). */

export const MERCHANT_KIND_LABELS: Record<string, string> = {
  invoice: 'فاتورة توريد',
  payment: 'سداد له',
  return: 'مرتجع/خصم',
  collection: 'تحصيل منه',
  debt: 'دين مستحق مباشر',
};

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function saveCsv(
  defaultName: string,
  rows: (string | number)[][],
): Promise<string> {
  const {invoke} = await import('../lib/tauri');
  const contents =
    '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  return invoke<string>('save_text_file', {defaultName, contents});
}

/** الكشف الأقدم أولاً — كدفتر محاسبي (statement يعيد الأحدث أولاً). */
async function statementAsc(
  merchantId: number,
): Promise<MerchantStatementRow[]> {
  return (await MerchantRepo.statement(merchantId, 2000)).slice().reverse();
}

function rowDetail(row: MerchantStatementRow): string {
  const items = row.movement.items
    ?.map(item => `${item.name} ×${item.qty}`)
    .join(' · ');
  return [row.movement.note ?? '', items ?? '']
    .filter(Boolean)
    .join(' — ');
}

function methodLabel(row: MerchantStatementRow): string {
  if (row.movement.method == null) {
    return '—';
  }
  if (row.movement.method === 'cash') {
    return 'نقدي';
  }
  return paymentMethodById(row.movement.method).label;
}

export const MerchantExports = {
  /** كشف حساب تاجر واحد — PDF احترافي بحوار حفظ أصلي. */
  async exportStatementPdf(merchantId: number): Promise<string> {
    const merchant = await MerchantRepo.byId(merchantId);
    if (merchant == null) {
      throw new Error('حساب التاجر غير موجود');
    }
    const rows = await statementAsc(merchantId);
    if (rows.length === 0) {
      throw new Error('لا حركات في كشف حساب هذا التاجر بعد');
    }
    const settings = useSettingsStore.getState().settings;
    const {exportMerchantStatementPdf} = await import('./StatementPdf');
    const balanceNow = rows[rows.length - 1].runningBalance;
    const {path} = await exportMerchantStatementPdf({
      storeName: settings.storeName || 'sela',
      merchantName: merchant.name,
      merchantPhone: merchant.phone,
      merchantIdNumber: merchant.id_number,
      rows: rows.map(row => ({
        at: row.movement.createdAt,
        kindLabel: MERCHANT_KIND_LABELS[row.movement.kind] ?? row.movement.kind,
        ref: row.movement.ref,
        detail: rowDetail(row),
        methodLabel: methodLabel(row),
        positive:
          row.movement.kind === 'invoice' || row.movement.kind === 'debt',
        amount: row.movement.amount,
        runningBalance: row.runningBalance,
      })),
      balanceNow,
    });
    logDiag('merchants', `أُنشئ كشف PDF للتاجر ${merchant.name}`);
    return path;
  },

  /** دفتر التجار ككل — PDF. */
  async exportBookPdf(): Promise<string> {
    const list = await MerchantRepo.listWithBalances();
    if (list.length === 0) {
      throw new Error('لا تجار مسجلون بعد');
    }
    let owedNow = 0;
    let creditNow = 0;
    for (const entry of list) {
      if (entry.balance > 0.005) {
        owedNow += entry.balance;
      } else if (entry.balance < -0.005) {
        creditNow += Math.abs(entry.balance);
      }
    }
    const settings = useSettingsStore.getState().settings;
    const {exportMerchantsBookPdf} = await import('./StatementPdf');
    const {path} = await exportMerchantsBookPdf({
      storeName: settings.storeName || 'sela',
      owedNow,
      creditNow,
      rows: list.map(entry => ({
        name: entry.merchant.name,
        phone: entry.merchant.phone ?? '',
        invoiceTotal: entry.invoiceTotal,
        debtTotal: entry.debtTotal,
        paymentTotal: entry.paymentTotal,
        returnTotal: entry.returnTotal,
        collectionTotal: entry.collectionTotal,
        balance: entry.balance,
        lastAt: entry.lastAt ?? '',
      })),
    });
    logDiag('merchants', `أُنشئ دفتر التجار PDF (${list.length} تاجر)`);
    return path;
  },
};
