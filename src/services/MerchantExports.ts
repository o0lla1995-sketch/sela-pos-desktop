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

  /** كشف حساب تاجر واحد — CSV يفتح في Excel. */
  async exportStatementCsv(merchantId: number): Promise<string> {
    const merchant = await MerchantRepo.byId(merchantId);
    if (merchant == null) {
      throw new Error('حساب التاجر غير موجود');
    }
    const rows = await statementAsc(merchantId);
    if (rows.length === 0) {
      throw new Error('لا حركات في كشف حساب هذا التاجر بعد');
    }
    const totalPositive = rows
      .filter(
        row =>
          row.movement.kind === 'invoice' || row.movement.kind === 'debt',
      )
      .reduce((sum, row) => sum + row.movement.amount, 0);
    const totalNegative = rows
      .filter(
        row =>
          row.movement.kind !== 'invoice' && row.movement.kind !== 'debt',
      )
      .reduce((sum, row) => sum + row.movement.amount, 0);
    const table: (string | number)[][] = [
      [`كشف حساب التاجر — ${merchant.name}`],
      [
        merchant.phone ? `جوال: ${merchant.phone}` : '',
        merchant.id_number ? `هوية: ${merchant.id_number}` : '',
      ],
      [],
      [
        'التاريخ والوقت',
        'نوع الحركة',
        'المرجع',
        'عليه (₪)',
        'له (₪)',
        'قناة السداد',
        'سند الخزينة',
        'البيان / البنود',
        'الرصيد الجاري (₪)',
      ],
      ...rows.map(row => {
        const positive =
          row.movement.kind === 'invoice' || row.movement.kind === 'debt';
        return [
          row.movement.createdAt,
          MERCHANT_KIND_LABELS[row.movement.kind] ?? row.movement.kind,
          row.movement.ref,
          positive ? row.movement.amount.toFixed(2) : '',
          positive ? '' : row.movement.amount.toFixed(2),
          methodLabel(row),
          row.movement.cashRef ?? '',
          rowDetail(row),
          row.runningBalance.toFixed(2),
        ];
      }),
      [],
      [
        'الإجماليات',
        '',
        '',
        totalPositive.toFixed(2),
        totalNegative.toFixed(2),
        '',
        '',
        '',
        `الرصيد الحالي: ${(
          rows[rows.length - 1].runningBalance ?? 0
        ).toFixed(2)} ₪`,
      ],
    ];
    return saveCsv(
      `sela-merchant-${merchant.name.replace(/\s+/g, '_')}-statement.csv`,
      table,
    );
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

  /** دفتر التجار ككل — CSV. */
  async exportBookCsv(): Promise<string> {
    const list = await MerchantRepo.listWithBalances();
    if (list.length === 0) {
      throw new Error('لا تجار مسجلون بعد');
    }
    const sum = (pick: (entry: (typeof list)[number]) => number) =>
      list.reduce((acc, entry) => acc + pick(entry), 0);
    const table: (string | number)[][] = [
      ['دفتر حسابات التجار — سيلا'],
      [],
      [
        'التاجر',
        'الجوال',
        'الهوية',
        'فواتير التوريد (₪)',
        'ديون مباشرة (₪)',
        'سداد (₪)',
        'مرتجع/خصم (₪)',
        'تحصيل (₪)',
        'الرصيد الحالي (₪)',
        'حالة الرصيد',
        'آخر حركة',
      ],
      ...list.map(entry => [
        entry.merchant.name,
        entry.merchant.phone ?? '',
        entry.merchant.id_number ?? '',
        entry.invoiceTotal.toFixed(2),
        entry.debtTotal.toFixed(2),
        entry.paymentTotal.toFixed(2),
        entry.returnTotal.toFixed(2),
        entry.collectionTotal.toFixed(2),
        entry.balance.toFixed(2),
        entry.balance > 0.005
          ? 'مستحق له'
          : entry.balance < -0.005
          ? 'لك عنده'
          : 'مسدد',
        entry.lastAt ?? 'لا حركات',
      ]),
      [],
      [
        'الإجماليات',
        '',
        '',
        sum(e => e.invoiceTotal).toFixed(2),
        sum(e => e.debtTotal).toFixed(2),
        sum(e => e.paymentTotal).toFixed(2),
        sum(e => e.returnTotal).toFixed(2),
        sum(e => e.collectionTotal).toFixed(2),
        sum(e => e.balance).toFixed(2),
        `مستحق للتجار: ${sum(e => Math.max(0, e.balance)).toFixed(2)} ₪ · لك عند التجار: ${sum(
          e => Math.max(0, -e.balance),
        ).toFixed(2)} ₪`,
        '',
      ],
    ];
    return saveCsv('sela-merchants-book.csv', table);
  },
};
