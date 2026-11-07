/**
 * screens/MerchantsScreen.tsx — حسابات التجار والموردين (UI — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * v85 (الجولة 91 #٢) — طلب التاجر: «إضافة وتطوير ميزة جديدة في التطبيق
 * خاصة بتسجيل الفواتير والمستحقات الخاصة بالتجار وصفحة لكل تاجر
 * خاصة به وبالتقارير وكل المميزات والخصائص المتوفرة في الانظمة
 * الاحترافية العالمية بما يتناسب مع تطبيق نقطة البيع».
 *
 * مطابقة الأندرويد v78 بنطاق سطح المكتب:
 *  • سجل التجار (اسم + جوال + هوية اختيارية + ملاحظات) وبحث فوري.
 *  • صفحة التاجر: بطاقة الرصيد + كشف حساب بالرصيد الجاري بعد كل
 *    حركة (توريد + ، سداد/مرتجع/تحصيل −).
 *  • فاتورة التوريد ببنود حرة (صنف × كمية × سعر) بإجمالي حي.
 *  • السداد والتحصيل عبر قنوات الدفع الفعلية (درج/بنوك/محافظ) مع
 *    سند خزينة مصاحب (فئة «سداد لتاجر» / «تحصيل من تاجر»)؛
 *    المرتجع/الخصم بلا حركة خزينة.
 *
 * v86 (الجولة 92 #٣+٤) — مطابقة أندرويد v79:
 *  • دين مستحق مباشر بلا فاتورة توريد — يرفع المستحق له بلا بنود
 *    وبلا حركة خزينة (نوع خامس debt + شفاء نواة Rust v86).
 *  • تنزيل كشف حساب التاجر ودفتر التجار ككل — PDF احترافي أو CSV.
 *  • شارات أنواع ملونة في كشف الحساب وتفكيك الدين في بطاقة الرصيد.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useToastStore} from '../state/appStores';
import {
  MerchantRepo,
  type MerchantBalance,
  type MerchantInvoiceItem,
  type MerchantStatementRow,
} from '../database/repositories/MerchantRepo';
import {formatMoney, formatDateTime} from '../core/format';
import {activePaymentMethods, paymentMethodById} from '../core/paymentMethods';
import {useSettingsStore} from '../stores/settingsStore';
import {CashService} from '../services/CashService';
import {MerchantExports} from '../services/MerchantExports';
import {Icon} from '../components/Icon';
import {PaymentMethodIcon} from '../components/PaymentMethodIcon';
import './merchants.css';

type FinanceKind = 'payment' | 'return' | 'collection' | 'debt';

const FINANCE_OPTIONS: {key: FinanceKind; label: string; hint: string}[] = [
  {
    key: 'debt',
    label: 'دين مستحق',
    hint: 'التزام مالي مباشر على حساب التاجر بلا فاتورة توريد (رسوم، نقد، توريد ضاعت فاتورته) — يرفع المستحق له ولا يمس الخزينة',
  },
  {
    key: 'payment',
    label: 'سداد له',
    hint: 'يدفع من القناة المختارة (سند صرف في الخزينة) ويخفض ما علينا للتاجر',
  },
  {
    key: 'return',
    label: 'مرتجع / خصم',
    hint: 'أرجعنا له بضاعة أو حصلنا خصماً — يخفض الرصيد بلا حركة خزينة',
  },
  {
    key: 'collection',
    label: 'تحصيل منه',
    hint: 'أعطانا نقوداً (تسبيق/تسوية) — يُودع في القناة المختارة ويخفض الرصيد',
  },
];

const KIND_LABELS: Record<string, string> = {
  invoice: 'فاتورة توريد',
  payment: 'سداد له',
  return: 'مرتجع / خصم',
  collection: 'تحصيل منه',
  debt: 'دين مستحق مباشر',
};

/** v86 (#٤): لون شارة النوع في كشف الحساب — قراءة فورية لاتجاه
 *  الحركة بمعيار الأنظمة الاحترافية (نفس خريطة أندرويد v79). */
const KIND_TONES: Record<string, string> = {
  invoice: 'danger',
  debt: 'warn',
  payment: 'ok',
  return: 'info',
  collection: 'ok',
};

interface DraftItem {
  key: string;
  name: string;
  qty: string;
  price: string;
}

let draftSeq = 0;
const newDraftItem = (): DraftItem => {
  draftSeq += 1;
  return {key: `i${draftSeq}`, name: '', qty: '1', price: ''};
};

export function MerchantsScreen() {
  const toast = useToastStore(s => s.show);
  const paymentMethodsEnabled = useSettingsStore(
    s => s.settings.paymentMethodsEnabled,
  );
  const methods = useMemo(
    () => activePaymentMethods(paymentMethodsEnabled),
    [paymentMethodsEnabled],
  );

  const [list, setList] = useState<MerchantBalance[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // ── إضافة تاجر ──
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addIdNumber, setAddIdNumber] = useState('');
  const [addNotes, setAddNotes] = useState('');

  // ── صفحة التاجر ──
  const [detail, setDetail] = useState<MerchantBalance | null>(null);
  const [statement, setStatement] = useState<MerchantStatementRow[] | null>(
    null,
  );

  // ── تعديل ──
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editIdNumber, setEditIdNumber] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // ── فاتورة توريد ──
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceItems, setInvoiceItems] = useState<DraftItem[]>([
    newDraftItem(),
  ]);
  const [invoiceNote, setInvoiceNote] = useState('');
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  // ── حركة مالية ──
  const [financeOpen, setFinanceOpen] = useState(false);
  const [financeKind, setFinanceKind] = useState<FinanceKind>('payment');
  const [financeAmount, setFinanceAmount] = useState('');
  const [financeMethod, setFinanceMethod] = useState('cash');
  const [financeNote, setFinanceNote] = useState('');
  const [financeBusy, setFinanceBusy] = useState(false);

  // ── v86 (الجولة 92 #٣): تصدير الكشوف — PDF وCSV ──
  const [exportBusy, setExportBusy] = useState<
    'statementPdf' | 'statementCsv' | 'bookPdf' | 'bookCsv' | null
  >(null);

  const runExport = useCallback(
    async (
      which: 'statementPdf' | 'statementCsv' | 'bookPdf' | 'bookCsv',
      run: () => Promise<string>,
    ) => {
      if (exportBusy != null) {
        return;
      }
      setExportBusy(which);
      try {
        const path = await run();
        toast(`تم حفظ الملف: ${path}`, 'success', 6000);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes('أُلغيت')) {
          toast(message, 'error', 6000);
        }
      } finally {
        setExportBusy(null);
      }
    },
    [exportBusy, toast],
  );

  const reload = useCallback(async () => {
    try {
      setList(await MerchantRepo.listWithBalances());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshDetail = useCallback(async (merchantId: number) => {
    const rows = await MerchantRepo.listWithBalances();
    setList(rows);
    const entry = rows.find(row => row.merchant.id === merchantId);
    if (entry != null) {
      setDetail(entry);
      setStatement(await MerchantRepo.statement(merchantId));
    } else {
      setDetail(null);
      setStatement(null);
    }
  }, []);

  const openDetail = useCallback(async (entry: MerchantBalance) => {
    setDetail(entry);
    setStatement(null);
    setStatement(await MerchantRepo.statement(entry.merchant.id));
  }, []);

  const summary = useMemo(() => {
    let owed = 0;
    let credit = 0;
    for (const row of list) {
      if (row.balance > 0.005) {
        owed += row.balance;
      } else if (row.balance < -0.005) {
        credit += Math.abs(row.balance);
      }
    }
    return {owed, credit, count: list.length};
  }, [list]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) {
      return list;
    }
    return list.filter(row =>
      [
        row.merchant.name,
        row.merchant.phone ?? '',
        row.merchant.id_number ?? '',
        row.merchant.notes ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [list, query]);

  // ── إنشاء ──
  const createMerchant = useCallback(async () => {
    if (addName.trim().length === 0) {
      toast('اسم التاجر مطلوب', 'error');
      return;
    }
    try {
      const created = await MerchantRepo.createMerchant({
        name: addName,
        phone: addPhone,
        idNumber: addIdNumber,
        notes: addNotes,
      });
      setAddOpen(false);
      setAddName('');
      setAddPhone('');
      setAddIdNumber('');
      setAddNotes('');
      await reload();
      toast(`أُنشئ حساب التاجر «${created.name}»`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر إنشاء الحساب', 'error');
    }
  }, [addName, addPhone, addIdNumber, addNotes, reload, toast]);

  // ── تعديل ──
  const openEdit = useCallback(() => {
    if (detail == null) {
      return;
    }
    setEditName(detail.merchant.name);
    setEditPhone(detail.merchant.phone ?? '');
    setEditIdNumber(detail.merchant.id_number ?? '');
    setEditNotes(detail.merchant.notes ?? '');
    setEditOpen(true);
  }, [detail]);

  const saveEdit = useCallback(async () => {
    if (detail == null) {
      return;
    }
    if (editName.trim().length === 0) {
      toast('اسم التاجر مطلوب', 'error');
      return;
    }
    try {
      await MerchantRepo.updateMerchant(detail.merchant.id, {
        name: editName,
        phone: editPhone,
        idNumber: editIdNumber,
        notes: editNotes,
      });
      setEditOpen(false);
      await refreshDetail(detail.merchant.id);
      toast('حُدّثت بيانات التاجر', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر حفظ التعديل', 'error');
    }
  }, [
    detail,
    editName,
    editPhone,
    editIdNumber,
    editNotes,
    refreshDetail,
    toast,
  ]);

  // ── حذف (بلا حركات فقط) ──
  const removeMerchant = useCallback(async () => {
    if (detail == null) {
      return;
    }
    if (
      !window.confirm(
        `حذف «${detail.merchant.name}»؟ الحذف ممكن فقط لتاجر بلا أي حركات في كشف حسابه.`,
      )
    ) {
      return;
    }
    try {
      await MerchantRepo.deleteMerchant(detail.merchant.id);
      setDetail(null);
      await reload();
      toast('حُذف حساب التاجر', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'لا يمكن الحذف', 'error');
    }
  }, [detail, reload, toast]);

  // ── فاتورة توريد ──
  const invoiceTotal = useMemo(() => {
    let sum = 0;
    for (const item of invoiceItems) {
      const qty = Number(item.qty.replace(',', '.')) || 0;
      const price = Number(item.price.replace(',', '.')) || 0;
      sum += qty * price;
    }
    return Math.round(sum * 100) / 100;
  }, [invoiceItems]);

  const openInvoice = useCallback(() => {
    setInvoiceItems([newDraftItem()]);
    setInvoiceNote('');
    setInvoiceOpen(true);
  }, []);

  const saveInvoice = useCallback(async () => {
    if (detail == null) {
      return;
    }
    const items: MerchantInvoiceItem[] = [];
    for (const draft of invoiceItems) {
      const name = draft.name.trim();
      const qty = Number(draft.qty.replace(',', '.')) || 0;
      const price = Number(draft.price.replace(',', '.')) || 0;
      if (name.length === 0 && qty <= 1 && price === 0) {
        continue;
      }
      if (name.length === 0 || qty <= 0) {
        toast('أكمل اسم الصنف وكميته في كل بند (أو احذف البند الفارغ)', 'error');
        return;
      }
      items.push({
        name,
        qty,
        price,
        total: Math.round(qty * price * 100) / 100,
      });
    }
    if (items.length === 0) {
      toast('أضف بنداً واحداً على الأقل', 'error');
      return;
    }
    setInvoiceBusy(true);
    try {
      const movement = await MerchantRepo.addInvoice({
        merchantId: detail.merchant.id,
        items,
        note: invoiceNote,
      });
      setInvoiceOpen(false);
      await refreshDetail(detail.merchant.id);
      toast(
        `سُجلت فاتورة التوريد ${movement.ref} — ${formatMoney(movement.amount)}`,
        'success',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر حفظ الفاتورة', 'error');
    } finally {
      setInvoiceBusy(false);
    }
  }, [detail, invoiceItems, invoiceNote, refreshDetail, toast]);

  // ── حركة مالية ──
  const openFinance = useCallback((kind: FinanceKind) => {
    setFinanceKind(kind);
    setFinanceAmount('');
    setFinanceMethod('cash');
    setFinanceNote('');
    setFinanceOpen(true);
  }, []);

  const saveFinance = useCallback(async () => {
    if (detail == null) {
      return;
    }
    const amount = Number(financeAmount.replace(',', '.')) || 0;
    if (amount <= 0) {
      toast('أدخل مبلغاً أكبر من صفر', 'error');
      return;
    }
    setFinanceBusy(true);
    try {
      const merchantId = detail.merchant.id;
      const merchantName = detail.merchant.name;
      // v86 (الجولة 92 #٣): الدين المستحق المباشر — بلا فاتورة وبلا
      // حركة خزينة؛ يرفع المستحق له ويُسدّد لاحقاً كأي سداد.
      if (financeKind === 'debt') {
        const movement = await MerchantRepo.addDirectDebt({
          merchantId,
          amount,
          note: financeNote,
        });
        setFinanceOpen(false);
        await refreshDetail(merchantId);
        toast(
          `سُجّل دين مستحق ${movement.ref} — ${formatMoney(amount)} على حساب ${merchantName}`,
          'success',
        );
        return;
      }
      if (financeKind === 'return') {
        await MerchantRepo.addReturn({merchantId, amount, note: financeNote});
        setFinanceOpen(false);
        await refreshDetail(merchantId);
        toast(
          `سُجّل مرتجع/خصم ${formatMoney(amount)} من حساب ${merchantName}`,
          'success',
        );
        return;
      }
      const isPayment = financeKind === 'payment';
      const movement = isPayment
        ? await CashService.recordExpense({
            category: 'سداد لتاجر',
            note: `سداد للتاجر ${merchantName}${
              financeNote.trim() ? ` — ${financeNote.trim()}` : ''
            }`,
            amountMinor: Math.round(amount * 100),
            paymentMethod: financeMethod,
          })
        : await CashService.recordDeposit({
            note: `تحصيل من التاجر ${merchantName}${
              financeNote.trim() ? ` — ${financeNote.trim()}` : ''
            }`,
            amountMinor: Math.round(amount * 100),
            paymentMethod: financeMethod,
            category: 'تحصيل من تاجر',
          });
      if (isPayment) {
        await MerchantRepo.addPayment({
          merchantId,
          amount,
          method: financeMethod,
          note: financeNote,
          cashRef: movement.ref,
        });
      } else {
        await MerchantRepo.addCollection({
          merchantId,
          amount,
          method: financeMethod,
          note: financeNote,
          cashRef: movement.ref,
        });
      }
      setFinanceOpen(false);
      await refreshDetail(merchantId);
      toast(
        isPayment
          ? `سُجّل سداد ${formatMoney(amount)} لـ${merchantName} — سند ${movement.ref}`
          : `سُجّل تحصيل ${formatMoney(amount)} من ${merchantName} — سند ${movement.ref}`,
        'success',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر تسجيل الحركة', 'error');
    } finally {
      setFinanceBusy(false);
    }
  }, [
    detail,
    financeAmount,
    financeKind,
    financeMethod,
    financeNote,
    refreshDetail,
    toast,
  ]);

  const financeNeedsMethod =
    financeKind === 'payment' || financeKind === 'collection';

  return (
    <div className="mer-wrap">
      {/* رأس الشاشة + KPIs */}
      <div className="mer-head">
        <div className="mer-title">
          <b>التجار والموردون</b>
          <span>فواتير التوريد والمستحقات — دفتر ذمم دائن</span>
        </div>
        <div className="mer-kpis">
          <div className={`mer-kpi ${summary.owed > 0 ? 'danger' : 'ok'}`}>
            <span className="v">{formatMoney(summary.owed)}</span>
            <span className="l">مستحق للتجار الآن · {summary.count} تاجر</span>
          </div>
          <div className="mer-kpi ok">
            <span className="v">{formatMoney(summary.credit)}</span>
            <span className="l">لك عند التجار (دفعات مقدمة)</span>
          </div>
        </div>
      </div>

      {/* البحث + زر الإضافة */}
      <div className="mer-toolbar">
        <div className="mer-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الجوال أو الهوية…"
          />
        </div>
        <button className="btn primary" onClick={() => setAddOpen(true)}>
          <Icon name="plus" size={13} /> تاجر جديد
        </button>
        <button
          className="btn"
          disabled={exportBusy != null}
          onClick={() =>
            void runExport('bookPdf', () => MerchantExports.exportBookPdf())
          }>
          <Icon name="download" size={13} />
          {exportBusy === 'bookPdf' ? 'جارٍ الإنشاء…' : 'تنزيل دفتر التجار PDF'}
        </button>
      </div>

      {/* القائمة */}
      <div className="mer-list">
        {loading ? (
          <div className="mer-empty">جارٍ التحميل…</div>
        ) : filtered.length === 0 ? (
          <div className="mer-empty">
            <b>{query.length > 0 ? 'لا نتائج للبحث' : 'لا تجار بعد'}</b>
            <span>
              {query.length > 0
                ? 'جرّب اسماً أو جزءاً من رقم الجوال'
                : 'أضف تاجرك الأول وسجّل فواتير التوريد ومستحقاته — صفحة كشف حساب خاصة بكل تاجر'}
            </span>
          </div>
        ) : (
          filtered.map(entry => (
            <button
              key={entry.merchant.id}
              className={`mer-row ${
                detail?.merchant.id === entry.merchant.id ? 'active' : ''
              }`}
              onClick={() => void openDetail(entry)}>
              <span className="avatar">
                {entry.merchant.name.trim().charAt(0) || 'ت'}
              </span>
              <span className="who">
                <b>{entry.merchant.name}</b>
                <span className="sub">
                  {entry.merchant.phone ?? 'بلا جوال'}
                  {entry.merchant.id_number
                    ? ` · هوية ${entry.merchant.id_number}`
                    : ''}
                  {entry.lastAt != null
                    ? ` · آخر حركة ${formatDateTime(entry.lastAt)}`
                    : ' · لا حركات بعد'}
                </span>
              </span>
              <span className="side">
                <b
                  className={
                    entry.balance > 0.005
                      ? 'danger'
                      : entry.balance < -0.005
                      ? 'ok'
                      : 'dim'
                  }>
                  {formatMoney(Math.abs(entry.balance))}
                </b>
                <span className="l">
                  {entry.balance > 0.005
                    ? 'مستحق له'
                    : entry.balance < -0.005
                    ? 'لك عنده'
                    : 'مسدد'}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {/* ═══ نافذة: تاجر جديد ═══ */}
      {addOpen && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(560px, 94vw)'}}>
            <div className="modal-head">
              <b>تاجر جديد</b>
              <button className="btn sm ghost" onClick={() => setAddOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="dc-form-grid">
                <div className="field span2">
                  <label>اسم التاجر *</label>
                  <input
                    value={addName}
                    onChange={e => setAddName(e.target.value)}
                    placeholder="مثال: شركة الفردوس للتوريد"
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>رقم الجوال</label>
                  <input
                    dir="ltr"
                    value={addPhone}
                    onChange={e => setAddPhone(e.target.value)}
                    placeholder="059xxxxxxx"
                  />
                </div>
                <div className="field">
                  <label>رقم الهوية (اختياري — 9 أرقام)</label>
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={9}
                    value={addIdNumber}
                    onChange={e =>
                      setAddIdNumber(e.target.value.replace(/\D/g, '').slice(0, 9))
                    }
                  />
                </div>
                <div className="field span2">
                  <label>ملاحظات</label>
                  <input
                    value={addNotes}
                    onChange={e => setAddNotes(e.target.value)}
                    placeholder="نطاق التوريد، شروط السداد…"
                  />
                </div>
              </div>
              <button
                className="btn primary block lg"
                style={{marginTop: 14}}
                onClick={() => void createMerchant()}>
                <Icon name="plus" size={14} /> إنشاء الحساب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ نافذة: صفحة التاجر (كشف الحساب) ═══ */}
      {detail != null && (
        <div className="overlay">
          <div className="modal mer-detail" style={{width: 'min(860px, 96vw)'}}>
            <div className="modal-head">
              <b>
                كشف حساب — {detail.merchant.name}
                {detail.merchant.phone ? ` · ${detail.merchant.phone}` : ''}
              </b>
              <button
                className="btn sm ghost"
                onClick={() => {
                  setDetail(null);
                  setStatement(null);
                }}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              {/* بطاقة الرصيد */}
              <div
                className={`mer-balance ${
                  detail.balance > 0.005
                    ? 'danger'
                    : detail.balance < -0.005
                    ? 'ok'
                    : 'zero'
                }`}>
                <span className="l">
                  {detail.balance > 0.005
                    ? 'المستحق له الآن (علينا)'
                    : detail.balance < -0.005
                    ? 'لك عنده (دفعات مقدمة)'
                    : 'الحساب مسدد'}
                </span>
                <span className="v">
                  {formatMoney(Math.abs(detail.balance))}
                </span>
                <span className="b">
                  توريد {formatMoney(detail.invoiceTotal)}
                  {detail.debtTotal > 0.005
                    ? ` · دين مباشر ${formatMoney(detail.debtTotal)}`
                    : ''}{' '}
                  · سداد {formatMoney(detail.paymentTotal)} · مرتجع/خصم{' '}
                  {formatMoney(detail.returnTotal)} · تحصيل{' '}
                  {formatMoney(detail.collectionTotal)}
                </span>
              </div>

              {/* v87 (الجولة 93 #٤): أزرار العمليات أُعيد تنظيمها —
                  كانت ثمانية متساوية متراكبة في صف واحد (شكوى التاجر:
                  «الأزرار المتراكمة بشكل كبير جانبا الي جنب»).
                  الهرمية: الفاتورة اليومية بحجم كامل، ثم عمليات المال
                  الأربع في شبكة مضغوطة، ثم الكشف PDF، والإدارة في
                  الأسفل هامشة لا تنافس المال. CSV أُلغي بطلب التاجر
                  («لغيهما») — PDF قابل للطباعة فقط. */}
              <div className="mer-actions">
                <button className="btn primary wide" onClick={openInvoice}>
                  <Icon name="plus" size={13} /> فاتورة توريد جديدة
                </button>
              </div>
              <div className="mer-actions grid">
                <button className="btn" onClick={() => openFinance('payment')}>
                  <Icon name="wallet" size={13} /> سداد له
                </button>
                <button className="btn" onClick={() => openFinance('debt')}>
                  <Icon name="book" size={13} /> دين مستحق
                </button>
                <button className="btn" onClick={() => openFinance('return')}>
                  <Icon name="undo" size={13} /> مرتجع/خصم
                </button>
                <button className="btn" onClick={() => openFinance('collection')}>
                  <Icon name="download" size={13} /> تحصيل منه
                </button>
              </div>
              <div className="mer-actions">
                <button
                  className="btn ghost wide"
                  disabled={exportBusy != null}
                  onClick={() =>
                    void runExport('statementPdf', () =>
                      MerchantExports.exportStatementPdf(detail.merchant.id),
                    )
                  }>
                  <Icon name="save" size={13} />
                  {exportBusy === 'statementPdf'
                    ? 'جارٍ الإنشاء…'
                    : 'كشف حساب PDF قابل للطباعة'}
                </button>
              </div>
              <div className="mer-actions admin">
                <button className="btn link" onClick={openEdit}>
                  <Icon name="edit" size={13} /> تعديل البيانات
                </button>
                <span className="mer-admin-divider" />
                <button className="btn link danger" onClick={() => void removeMerchant()}>
                  <Icon name="trash" size={13} /> حذف التاجر
                </button>
              </div>

              {/* كشف الحساب */}
              <div className="mer-statement">
                {statement == null ? (
                  <div className="mer-empty">جارٍ تحميل الكشف…</div>
                ) : statement.length === 0 ? (
                  <div className="mer-empty">
                    لا حركات بعد — ابدأ بفاتورة توريد أو سداد
                  </div>
                ) : (
                  statement.map(row => {
                    const tone = KIND_TONES[row.movement.kind] ?? '';
                    const positive =
                      row.movement.kind === 'invoice' ||
                      row.movement.kind === 'debt';
                    return (
                    <div key={row.movement.id} className="mer-move">
                      <div className="t">
                        <b>
                          {tone ? (
                            <span className={`mer-kind-chip ${tone}`}>
                              {KIND_LABELS[row.movement.kind]}
                            </span>
                          ) : null}
                          {row.movement.ref}
                        </b>
                        <span>
                          {formatDateTime(row.movement.createdAt)}
                          {row.movement.method != null &&
                          row.movement.method !== 'cash'
                            ? ` · ${paymentMethodById(row.movement.method).label}`
                            : ''}
                          {row.movement.note ? ` · ${row.movement.note}` : ''}
                          {row.movement.cashRef
                            ? ` · سند ${row.movement.cashRef}`
                            : ''}
                        </span>
                        {row.movement.items != null &&
                        row.movement.items.length > 0 ? (
                          <span className="items">
                            {row.movement.items
                              .map(item => `${item.name} ×${item.qty}`)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </div>
                      <div className="n">
                        <b className={positive ? 'danger' : 'ok'}>
                          {positive ? '+' : '−'}
                          {formatMoney(row.movement.amount)}
                        </b>
                        <span>الرصيد {formatMoney(row.runningBalance)}</span>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ نافذة: تعديل تاجر ═══ */}
      {editOpen && detail != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(560px, 94vw)'}}>
            <div className="modal-head">
              <b>تعديل بيانات «{detail.merchant.name}»</b>
              <button className="btn sm ghost" onClick={() => setEditOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <p className="mer-hint">
                كشف الحساب والرصيد لا يتأثران بالتعديل — البيانات التعريفية فقط.
              </p>
              <div className="dc-form-grid">
                <div className="field span2">
                  <label>اسم التاجر *</label>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>رقم الجوال</label>
                  <input
                    dir="ltr"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>رقم الهوية (اختياري — 9 أرقام)</label>
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={9}
                    value={editIdNumber}
                    onChange={e =>
                      setEditIdNumber(
                        e.target.value.replace(/\D/g, '').slice(0, 9),
                      )
                    }
                  />
                </div>
                <div className="field span2">
                  <label>ملاحظات</label>
                  <input
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                  />
                </div>
              </div>
              <button
                className="btn primary block lg"
                style={{marginTop: 14}}
                onClick={() => void saveEdit()}>
                <Icon name="check" size={14} /> حفظ التعديل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ نافذة: فاتورة التوريد ═══ */}
      {invoiceOpen && detail != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(760px, 96vw)'}}>
            <div className="modal-head">
              <b>فاتورة توريد — {detail.merchant.name}</b>
              <button
                className="btn sm ghost"
                onClick={() => setInvoiceOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="mer-items">
                {invoiceItems.map((item, index) => (
                  <div className="mer-item-row" key={item.key}>
                    <span className="idx">{index + 1}</span>
                    <input
                      className="name"
                      value={item.name}
                      onChange={e =>
                        setInvoiceItems(rows =>
                          rows.map(row =>
                            row.key === item.key
                              ? {...row, name: e.target.value}
                              : row,
                          ),
                        )
                      }
                      placeholder="اسم الصنف من التوريد"
                    />
                    <input
                      className="qty"
                      dir="ltr"
                      inputMode="decimal"
                      value={item.qty}
                      onChange={e =>
                        setInvoiceItems(rows =>
                          rows.map(row =>
                            row.key === item.key
                              ? {
                                  ...row,
                                  qty: e.target.value.replace(/[^\d.,]/g, ''),
                                }
                              : row,
                          ),
                        )
                      }
                      placeholder="كمية"
                    />
                    <input
                      className="price"
                      dir="ltr"
                      inputMode="decimal"
                      value={item.price}
                      onChange={e =>
                        setInvoiceItems(rows =>
                          rows.map(row =>
                            row.key === item.key
                              ? {
                                  ...row,
                                  price: e.target.value.replace(/[^\d.,]/g, ''),
                                }
                              : row,
                          ),
                        )
                      }
                      placeholder="سعر الوحدة"
                    />
                    <span className="line-total">
                      {formatMoney(
                        (Number(item.qty.replace(',', '.')) || 0) *
                          (Number(item.price.replace(',', '.')) || 0),
                      )}
                    </span>
                    <button
                      className="btn sm ghost danger-text"
                      title="حذف البند"
                      disabled={invoiceItems.length === 1}
                      onClick={() =>
                        setInvoiceItems(rows =>
                          rows.filter(row => row.key !== item.key),
                        )
                      }>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mer-item-tools">
                <button
                  className="btn sm"
                  onClick={() =>
                    setInvoiceItems(rows => [...rows, newDraftItem()])
                  }>
                  <Icon name="plus" size={12} /> إضافة بند
                </button>
              </div>
              <div className="dc-form-grid" style={{marginTop: 10}}>
                <div className="field span2">
                  <label>ملاحظة (اختياري)</label>
                  <input
                    value={invoiceNote}
                    onChange={e => setInvoiceNote(e.target.value)}
                    placeholder="رقم فاتورة التاجر، شروط…"
                  />
                </div>
              </div>
              <div className="mer-total-row">
                <span>إجمالي الفاتورة</span>
                <b>{formatMoney(invoiceTotal)}</b>
              </div>
              <button
                className="btn primary block lg"
                disabled={invoiceBusy}
                onClick={() => void saveInvoice()}>
                <Icon name="check" size={14} /> حفظ الفاتورة —{' '}
                {formatMoney(invoiceTotal)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ نافذة: حركة مالية ═══ */}
      {financeOpen && detail != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(600px, 94vw)'}}>
            <div className="modal-head">
              <b>حركة مع «{detail.merchant.name}»</b>
              <button
                className="btn sm ghost"
                onClick={() => setFinanceOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="mer-kind-row">
                {FINANCE_OPTIONS.map(option => (
                  <button
                    key={option.key}
                    className={`mer-kind ${financeKind === option.key ? 'on' : ''}`}
                    onClick={() => setFinanceKind(option.key)}>
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mer-hint">
                {FINANCE_OPTIONS.find(o => o.key === financeKind)?.hint}
              </p>
              <div className="dc-form-grid">
                <div className="field">
                  <label>المبلغ (₪) *</label>
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    value={financeAmount}
                    onChange={e =>
                      setFinanceAmount(e.target.value.replace(/[^\d.,]/g, ''))
                    }
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>ملاحظة (اختياري)</label>
                  <input
                    value={financeNote}
                    onChange={e => setFinanceNote(e.target.value)}
                    placeholder="مرجع التحويل، رقم الشيك…"
                  />
                </div>
              </div>
              {financeNeedsMethod ? (
                <div className="mer-methods">
                  <label>
                    {financeKind === 'payment'
                      ? 'الدفع من قناة'
                      : 'الإيداع في قناة'}
                  </label>
                  <div className="mer-method-row">
                    {methods.map(method => (
                      <button
                        key={method.id}
                        className={`mer-method ${
                          financeMethod === method.id ? 'on' : ''
                        }`}
                        onClick={() => setFinanceMethod(method.id)}>
                        <PaymentMethodIcon method={method} size={26} />
                        <span>{method.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <button
                className="btn primary block lg"
                style={{marginTop: 14}}
                disabled={financeBusy}
                onClick={() => void saveFinance()}>
                <Icon name="check" size={14} />
                {financeKind === 'debt'
                  ? 'تسجيل الدين المستحق'
                  : financeKind === 'payment'
                  ? 'تسجيل السداد'
                  : financeKind === 'return'
                  ? 'تسجيل المرتجع/الخصم'
                  : 'تسجيل التحصيل'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
