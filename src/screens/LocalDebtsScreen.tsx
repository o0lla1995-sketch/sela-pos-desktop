/**
 * screens/LocalDebtsScreen.tsx — دفتر ديون المتجر (UI-2 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * منطق LocalDebtsScreen الأندرويد (v16→v35) منقولاً إلى React DOM
 * بنطاق سطح المكتب (بلا ماسح QR ولا ترحيل صِلة): حسابات زبائن محلية
 * برقم هوية 9 أرقام وجوال 056/059، ديونهم (INV-L-…) وسداداتهم
 * (RCP-L-…) — كلها في دفاتر هذا الجهاز فقط، منفصلة تماماً عن صِلة.
 *
 * قواعد محاسبية منقولة كما هي:
 *  • السداد لا يتجاوز الدين القائم أبداً (v33) — رسالة بالمبلغ الأقصى.
 *  • حذف حساب عليه رصيد (مدين أو دائن) ممنوع — يفسد الدفاتر (v19).
 *  • تعديل الهوية يفحص تفرد الرقم داخل الجدول قبل الحفظ (v35).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useToastStore} from '../state/appStores';
import {
  LocalDebtsRepo,
  isValidIdNumber,
  isValidLocalPhone,
} from '../database/repositories/LocalDebtsRepo';
import {formatMoney, formatDateTime, relativeTime} from '../core/format';
import {amountTextToMinor} from '../core/amountKeypad';
import {useAmountKeyboard} from '../lib/useAmountKeyboard';
import type {
  LocalCustomerBalance,
  LocalDebt,
  LocalPayment,
} from '../core/types';
import './debtscash.css';

type FieldErrors = {id?: string; name?: string; phone?: string};
type PayMethod = LocalPayment['method'];

const METHOD_LABELS: Record<PayMethod, string> = {
  cash: 'نقد',
  card: 'بطاقة',
  other: 'أخرى',
};

/** أغورات → «1,234.50 ₪» (formatMoney يعمل بالشيكل الكامل). */
const money = (minor: number): string => formatMoney(minor / 100);

/** رسائل معايير التسجيل الفلسطينية (نفس نصوص الأندرويد v19). */
function idError(value: string): string {
  return value.length === 0
    ? 'رقم الهوية مطلوب'
    : `رقم الهوية 9 أرقام بالضبط (${value.length} حالياً)`;
}

function phoneError(value: string): string {
  if (value.length === 0) {
    return 'رقم الجوال مطلوب';
  }
  if (value.length !== 10) {
    return `رقم الجوال 10 أرقام بالضبط (${value.length} حالياً)`;
  }
  return 'يبدأ بـ 056 أو 059 فقط';
}

export function LocalDebtsScreen() {
  const toast = useToastStore(s => s.show);

  // ── القائمة الرئيسية ──────────────────────────────────────────
  const [balances, setBalances] = useState<LocalCustomerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // ── الملف المحدد ──────────────────────────────────────────────
  const [detail, setDetail] = useState<LocalCustomerBalance | null>(null);
  const [detailDebts, setDetailDebts] = useState<LocalDebt[]>([]);
  const [detailPays, setDetailPays] = useState<LocalPayment[]>([]);

  // ── نافذة إضافة زبون ─────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addErrors, setAddErrors] = useState<FieldErrors>({});
  const [addBusy, setAddBusy] = useState(false);

  // ── نافذة تعديل الزبون ───────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [editBusy, setEditBusy] = useState(false);

  // ── نافذة دين جديد ───────────────────────────────────────────
  const [debtOpen, setDebtOpen] = useState(false);
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDesc, setDebtDesc] = useState('');
  const [debtBusy, setDebtBusy] = useState(false);

  // ── نافذة تسجيل سداد ─────────────────────────────────────────
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [payNote, setPayNote] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  // ── تأكيد الحذف ──────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<LocalCustomerBalance | null>(
    null,
  );
  const [deleteBusy, setDeleteBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setBalances(await LocalDebtsRepo.listWithBalances());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** يعيد تحميل القائمة والملف المفتوح معاً (بعد أي كتابة). */
  const refreshDetail = useCallback(async (customerId: number) => {
    const list = await LocalDebtsRepo.listWithBalances();
    setBalances(list);
    const entry = list.find(row => row.customer.id === customerId) ?? null;
    setDetail(entry);
    if (entry != null) {
      const [debts, pays] = await Promise.all([
        LocalDebtsRepo.listDebts(customerId),
        LocalDebtsRepo.listPayments(customerId),
      ]);
      setDetailDebts(debts);
      setDetailPays(pays);
    }
  }, []);

  const openDetail = useCallback(
    async (entry: LocalCustomerBalance) => {
      setDetail(entry);
      setDetailDebts([]);
      setDetailPays([]);
      try {
        const [debts, pays] = await Promise.all([
          LocalDebtsRepo.listDebts(entry.customer.id),
          LocalDebtsRepo.listPayments(entry.customer.id),
        ]);
        setDetailDebts(debts);
        setDetailPays(pays);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [toast],
  );

  // ── بحث وتجميعات ─────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim();
    if (!q) {
      return balances;
    }
    return balances.filter(
      b =>
        b.customer.name.includes(q) ||
        b.customer.id_number.includes(q) ||
        (b.customer.phone ?? '').includes(q),
    );
  }, [balances, search]);

  const bookTotals = useMemo(() => {
    let outstanding = 0;
    let credit = 0;
    let debtors = 0;
    let debtsCount = 0;
    for (const b of balances) {
      debtsCount += b.debtsCount;
      if (b.outstandingMinor > 0) {
        outstanding += b.outstandingMinor;
        debtors += 1;
      } else if (b.outstandingMinor < 0) {
        credit += -b.outstandingMinor;
      }
    }
    return {outstanding, credit, debtors, debtsCount};
  }, [balances]);

  // ── إنشاء زبون ───────────────────────────────────────────────
  const createCustomer = useCallback(async () => {
    if (addBusy) {
      return;
    }
    const id = addId.replace(/\s+/g, '');
    const phone = addPhone.replace(/[\s-]/g, '');
    const errors: FieldErrors = {};
    if (!isValidIdNumber(id)) {
      errors.id = idError(id);
    }
    if (addName.trim().length === 0) {
      errors.name = 'اسم الزبون مطلوب';
    }
    if (!isValidLocalPhone(phone)) {
      errors.phone = phoneError(phone);
    }
    setAddErrors(errors);
    if (errors.id != null || errors.name != null || errors.phone != null) {
      return;
    }
    setAddBusy(true);
    try {
      const created = await LocalDebtsRepo.createCustomer({
        idNumber: id,
        name: addName,
        phone,
        notes: addNotes.trim() || null,
      });
      setAddOpen(false);
      setAddId('');
      setAddName('');
      setAddPhone('');
      setAddNotes('');
      await reload();
      toast(`أُنشئ حساب «${created.name}» في دفتر المتجر`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر إنشاء الحساب', 'error');
    } finally {
      setAddBusy(false);
    }
  }, [addBusy, addId, addName, addPhone, addNotes, reload, toast]);

  // ── تعديل زبون ───────────────────────────────────────────────
  const openEdit = useCallback(() => {
    if (detail == null) {
      return;
    }
    setEditId(detail.customer.id_number);
    setEditName(detail.customer.name);
    setEditPhone(detail.customer.phone ?? '');
    setEditNotes(detail.customer.notes ?? '');
    setEditErrors({});
    setEditOpen(true);
  }, [detail]);

  const saveEdit = useCallback(async () => {
    if (editBusy || detail == null) {
      return;
    }
    const id = editId.replace(/\s+/g, '');
    const phone = editPhone.replace(/[\s-]/g, '');
    const errors: FieldErrors = {};
    if (!isValidIdNumber(id)) {
      errors.id = idError(id);
    }
    if (editName.trim().length === 0) {
      errors.name = 'اسم الزبون مطلوب';
    }
    if (!isValidLocalPhone(phone)) {
      errors.phone = phoneError(phone);
    }
    // الهوية وحدها إن تغيّرت: لا يجوز أن يملكها زبون آخر (v35).
    if (errors.id == null && id !== detail.customer.id_number) {
      const holder = await LocalDebtsRepo.byIdNumber(id);
      if (holder != null && holder.id !== detail.customer.id) {
        errors.id = `رقم الهوية مسجّل لزبون آخر (${holder.name})`;
      }
    }
    setEditErrors(errors);
    if (errors.id != null || errors.name != null || errors.phone != null) {
      return;
    }
    setEditBusy(true);
    try {
      await LocalDebtsRepo.updateCustomer(detail.customer.id, {
        idNumber: id,
        name: editName,
        phone,
        notes: editNotes.trim() || null,
      });
      setEditOpen(false);
      await refreshDetail(detail.customer.id);
      toast('حُدّثت بيانات الزبون', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر حفظ التعديل', 'error');
    } finally {
      setEditBusy(false);
    }
  }, [
    editBusy,
    detail,
    editId,
    editName,
    editPhone,
    editNotes,
    refreshDetail,
    toast,
  ]);

  // ── حذف زبون (مسدَّد فقط — v19) ──────────────────────────────
  const requestDelete = useCallback(
    (entry: LocalCustomerBalance) => {
      if (entry.outstandingMinor > 0) {
        toast(
          `لا يمكن الحذف — على «${entry.customer.name}» دين قائم ` +
            `${money(entry.outstandingMinor)}. حذف الحساب يُفقد الدين نهائياً ` +
            'ويضخّم النقد المتوقع في الخزينة بنفس المبلغ — سجّل السداد أولاً',
          'error',
          6000,
        );
        return;
      }
      if (entry.outstandingMinor < 0) {
        toast(
          `لا يمكن الحذف — لدى «${entry.customer.name}» رصيد دائن ` +
            `${money(-entry.outstandingMinor)} (سدّد أكثر من دينه) وحذف الحساب ` +
            'يمحو حقه من الدفاتر — ردّ له قيمة رصيده ثم احذفه',
          'error',
          6000,
        );
        return;
      }
      setDeleteTarget(entry);
    },
    [toast],
  );

  const confirmDelete = useCallback(async () => {
    if (deleteBusy || deleteTarget == null) {
      return;
    }
    setDeleteBusy(true);
    try {
      await LocalDebtsRepo.deleteCustomer(deleteTarget.customer.id);
      setDeleteTarget(null);
      setDetail(null);
      setDetailDebts([]);
      setDetailPays([]);
      await reload();
      toast('حُذف الحساب من الدفتر', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, deleteTarget, reload, toast]);

  // ── تسجيل دين ────────────────────────────────────────────────
  const openDebt = useCallback(() => {
    setDebtAmount('');
    setDebtDesc('');
    setDebtOpen(true);
  }, []);

  const recordDebt = useCallback(async () => {
    if (debtBusy || detail == null) {
      return;
    }
    const amountMinor = amountTextToMinor(debtAmount);
    if (amountMinor <= 0) {
      toast('أدخل مبلغ دين صحيحاً أكبر من صفر', 'error');
      return;
    }
    setDebtBusy(true);
    try {
      const debt = await LocalDebtsRepo.addDebt({
        localCustomerId: detail.customer.id,
        amountMinor,
        description: debtDesc.trim() || null,
      });
      const customerId = detail.customer.id;
      setDebtOpen(false);
      setDebtAmount('');
      setDebtDesc('');
      await refreshDetail(customerId);
      toast(
        `دُوّن الدين ${debt.invoice_ref} بمبلغ ${money(debt.amount_minor)}`,
        'success',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'فشل تسجيل الدين', 'error');
    } finally {
      setDebtBusy(false);
    }
  }, [debtBusy, detail, debtAmount, debtDesc, refreshDetail, toast]);

  // ── تسجيل سداد (لا يتجاوز الدين القائم — v33) ────────────────
  const openPayment = useCallback(() => {
    if (detail == null) {
      return;
    }
    if (detail.outstandingMinor <= 0) {
      toast('لا دين قائم على هذا الزبون — لا يمكن تسجيل سداد', 'error');
      return;
    }
    setPayAmount('');
    setPayMethod('cash');
    setPayNote('');
    setPayOpen(true);
  }, [detail, toast]);

  const recordPayment = useCallback(async () => {
    if (payBusy || detail == null) {
      return;
    }
    const amountMinor = amountTextToMinor(payAmount);
    if (amountMinor <= 0) {
      toast('أدخل مبلغ سداد صحيحاً أكبر من صفر', 'error');
      return;
    }
    if (amountMinor > detail.outstandingMinor) {
      toast(
        `المبلغ أكبر من الدين القائم (${money(detail.outstandingMinor)}) — ` +
          'أدخل مبلغاً أقل أو مساوياً (أو استخدم زر «السداد الكامل»)',
        'error',
      );
      return;
    }
    setPayBusy(true);
    try {
      const pay = await LocalDebtsRepo.addPayment({
        localCustomerId: detail.customer.id,
        amountMinor,
        method: payMethod,
        note: payNote.trim() || null,
      });
      const customerId = detail.customer.id;
      setPayOpen(false);
      await refreshDetail(customerId);
      toast(
        `سُجّل السداد ${pay.receipt_ref} بمبلغ ${money(pay.amount_minor)} ` +
          `(${METHOD_LABELS[pay.method]})`,
        'success',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'فشل تسجيل السداد', 'error');
    } finally {
      setPayBusy(false);
    }
  }, [payBusy, detail, payAmount, payMethod, payNote, refreshDetail, toast]);

  // ── v59: Enter من الكيبورد يسجّل السداد/الحساب وEscape يغلق ──
  useAmountKeyboard({
    active: payOpen && detail != null && detail.outstandingMinor > 0,
    text: payAmount,
    onKey: () => undefined,
    onConfirm: () => {
      if (!payBusy) void recordPayment();
    },
    onCancel: () => setPayOpen(false),
    hasTextInput: true,
  });
  useAmountKeyboard({
    active: addOpen,
    text: addId,
    onKey: () => undefined,
    onConfirm: () => void createCustomer(),
    onCancel: () => setAddOpen(false),
    hasTextInput: true,
  });

  // ──────────────────────────────────────────────────────────────
  return (
    <div className="screen">
      <h1>ديون المتجر المحلية</h1>
      <div className="subtitle">
        دفتر الديون المحلي — حسابات بالهوية والجوال، ديونها وسداداتها تسكن
        هذا الجهاز فقط (منفصلة عن صِلة)
      </div>

      <div className="grid-4">
        <div className="card kpi">
          <span className="label">حسابات الدفتر</span>
          <span className="value">{balances.length}</span>
          <span className="label">
            {loading ? 'جارٍ التحميل…' : `${bookTotals.debtors} حساب مدين`}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">ديون قائمة إجمالاً</span>
          <span className="value danger">{money(bookTotals.outstanding)}</span>
          <span className="label">مجموع الأرصدة المدينة</span>
        </div>
        <div className="card kpi">
          <span className="label">رصيد دائن لدى الزبائن</span>
          <span className="value">{money(bookTotals.credit)}</span>
          <span className="label">سدادات زائدة تُخصم من ديون قادمة</span>
        </div>
        <div className="card kpi">
          <span className="label">سندات الديون المسجلة</span>
          <span className="value">{bookTotals.debtsCount}</span>
          <span className="label">سلسلة INV-L غير المُرحّلة</span>
        </div>
      </div>

      <div className="toolbar" style={{marginTop: 14}}>
        <div className="field" style={{flex: 1, minWidth: 220}}>
          <label>بحث بالاسم أو رقم الهوية أو الجوال</label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="مثال: أحمد، أو 400123456، أو 059…"
          />
        </div>
        <button
          className="btn primary"
          style={{alignSelf: 'flex-end'}}
          onClick={() => {
            setAddErrors({});
            setAddOpen(true);
          }}>
          + زبون جديد
        </button>
      </div>

      <div className="dc-split">
        {/* قائمة الزبائن */}
        <div className="card">
          <div className="dc-sec">
            <span>الزبائن</span>
            <span>
              {visible.length} من {balances.length}
            </span>
          </div>
          <div className="dc-list">
            {visible.length === 0 && (
              <div className="dc-empty-sm">
                {balances.length === 0
                  ? 'لا حسابات في دفتر المتجر بعد — أنشئ أول حساب بزر «زبون جديد».'
                  : 'لا نتائج مطابقة للبحث.'}
              </div>
            )}
            {visible.map(b => (
              <button
                key={b.customer.id}
                className={`dc-cust ${
                  detail?.customer.id === b.customer.id ? 'active' : ''
                }`}
                onClick={() => void openDetail(b)}>
                <span className="who">
                  <b>{b.customer.name}</b>
                  <span className="sub" dir="ltr">
                    {b.customer.id_number}
                    {b.customer.phone != null ? ` · ${b.customer.phone}` : ''}
                  </span>
                </span>
                <span className="side">
                  {b.outstandingMinor > 0 ? (
                    <span className="chip danger">
                      {money(b.outstandingMinor)}
                    </span>
                  ) : b.outstandingMinor < 0 ? (
                    <span className="chip warn">
                      رصيد دائن {money(-b.outstandingMinor)}
                    </span>
                  ) : (
                    <span className="chip ok">مسدّد</span>
                  )}
                  <span className="cnt">{b.debtsCount} دين</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ملف الزبون */}
        <div className="card">
          {detail == null ? (
            <div className="dc-empty-sm">
              اختر زبوناً من القائمة لعرض ديونه وسجل سداداته
            </div>
          ) : (
            <>
              <div className="dc-detail-head">
                <div>
                  <b style={{fontSize: 16}}>{detail.customer.name}</b>
                  <div className="dc-idline">
                    <span className="chip muted">
                      هوية <span className="dc-ref">{detail.customer.id_number}</span>
                    </span>
                    <span className="chip muted">
                      جوال{' '}
                      <span className="dc-ref">
                        {detail.customer.phone ?? '—'}
                      </span>
                    </span>
                    {detail.lastActivityAt != null && (
                      <span className="chip muted">
                        آخر حركة {relativeTime(detail.lastActivityAt)}
                      </span>
                    )}
                  </div>
                  {detail.customer.notes != null &&
                    detail.customer.notes.length > 0 && (
                      <div className="dc-hint" style={{marginTop: 8}}>
                        📝 {detail.customer.notes}
                      </div>
                    )}
                </div>
                <div className="dc-actions">
                  <button className="btn sm ghost" onClick={openEdit}>
                    تعديل البيانات
                  </button>
                  <button
                    className="btn sm danger ghost"
                    onClick={() => requestDelete(detail)}>
                    حذف الحساب
                  </button>
                </div>
              </div>

              <div className="dc-minis" style={{marginTop: 14}}>
                <div className="dc-mini">
                  <span className="label">إجمالي الديون</span>
                  <span className="value">{money(detail.debtTotalMinor)}</span>
                </div>
                <div className="dc-mini">
                  <span className="label">إجمالي السداد</span>
                  <span className="value ok">
                    {money(detail.paidTotalMinor)}
                  </span>
                </div>
                <div className="dc-mini">
                  <span className="label">الدين القائم</span>
                  {detail.outstandingMinor > 0 ? (
                    <span className="value danger">
                      {money(detail.outstandingMinor)}
                    </span>
                  ) : detail.outstandingMinor < 0 ? (
                    <span className="value credit">
                      رصيد دائن {money(-detail.outstandingMinor)}
                    </span>
                  ) : (
                    <span className="value ok">مسدّد بالكامل</span>
                  )}
                </div>
              </div>

              <div className="dc-actions" style={{marginTop: 14}}>
                <button className="btn primary" onClick={openDebt}>
                  + تسجيل دين
                </button>
                <button
                  className="btn"
                  onClick={openPayment}
                  disabled={detail.outstandingMinor <= 0}
                  title={
                    detail.outstandingMinor <= 0
                      ? 'لا دين قائم على هذا الزبون'
                      : 'تسجيل سداد من الزبون'
                  }>
                  تسجيل سداد
                </button>
              </div>

              <div className="dc-sec" style={{marginTop: 16}}>
                <span>الديون</span>
                <span>{detailDebts.length} سند</span>
              </div>
              {detailDebts.length === 0 ? (
                <div className="dc-empty-sm">لا ديون مسجلة على هذا الزبون</div>
              ) : (
                <table className="dc-table">
                  <thead>
                    <tr>
                      <th>السند</th>
                      <th>المبلغ</th>
                      <th>البيان</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailDebts.map(d => (
                      <tr key={d.id}>
                        <td>
                          <span className="dc-ref">{d.invoice_ref}</span>
                          {d.migrated === 1 && (
                            <span
                              className="chip muted"
                              style={{marginInlineStart: 6}}>
                              مُرحّل
                            </span>
                          )}
                        </td>
                        <td className="num" style={{color: 'var(--danger)'}}>
                          {money(d.amount_minor)}
                        </td>
                        <td className="mut">{d.description ?? '—'}</td>
                        <td className="mut">{formatDateTime(d.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="dc-sec" style={{marginTop: 16}}>
                <span>السدادات</span>
                <span>{detailPays.length} سند</span>
              </div>
              {detailPays.length === 0 ? (
                <div className="dc-empty-sm">
                  لا سدادات مسجلة لهذا الزبون
                </div>
              ) : (
                <table className="dc-table">
                  <thead>
                    <tr>
                      <th>السند</th>
                      <th>المبلغ</th>
                      <th>الطريقة</th>
                      <th>الملاحظة</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailPays.map(p => (
                      <tr key={p.id}>
                        <td>
                          <span className="dc-ref">{p.receipt_ref}</span>
                        </td>
                        <td className="num" style={{color: 'var(--ok)'}}>
                          {money(p.amount_minor)}
                        </td>
                        <td>
                          <span className="chip muted">
                            {METHOD_LABELS[p.method]}
                          </span>
                        </td>
                        <td className="mut">{p.note ?? '—'}</td>
                        <td className="mut">{formatDateTime(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>

      {/* نافذة: زبون جديد */}
      {addOpen && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(560px, 94vw)'}}>
            <div className="modal-head">
              <b>زبون جديد في دفتر المتجر</b>
              <button
                className="btn sm ghost"
                onClick={() => setAddOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="dc-form-grid">
                <div className="field">
                  <label>رقم الهوية (9 أرقام بالضبط)</label>
                  <input
                    className="dc-input-ltr"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={9}
                    value={addId}
                    onChange={e => setAddId(e.target.value)}
                    placeholder="400123456"
                    autoFocus
                  />
                  {addErrors.id != null && (
                    <span className="dc-err">{addErrors.id}</span>
                  )}
                </div>
                <div className="field">
                  <label>رقم الجوال (056 أو 059)</label>
                  <input
                    className="dc-input-ltr"
                    dir="ltr"
                    inputMode="tel"
                    maxLength={10}
                    value={addPhone}
                    onChange={e => setAddPhone(e.target.value)}
                    placeholder="0591234567"
                  />
                  {addErrors.phone != null && (
                    <span className="dc-err">{addErrors.phone}</span>
                  )}
                </div>
                <div className="field span2">
                  <label>اسم الزبون</label>
                  <input
                    value={addName}
                    onChange={e => setAddName(e.target.value)}
                    placeholder="الاسم الكامل"
                  />
                  {addErrors.name != null && (
                    <span className="dc-err">{addErrors.name}</span>
                  )}
                </div>
                <div className="field span2">
                  <label>ملاحظات (اختياري)</label>
                  <textarea
                    rows={2}
                    value={addNotes}
                    onChange={e => setAddNotes(e.target.value)}
                    placeholder="مثال: يسكن حي الزهور — يسدّد كل خميس"
                  />
                </div>
              </div>
              <div className="dc-hint">
                الحساب يسكن دفاتر هذا المتجر فقط ولا يُرفع إلى صِلة — رقم
                الهوية مفتاح التمييز بين النظامين.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setAddOpen(false)}>
                إلغاء
              </button>
              <button
                className="btn primary"
                disabled={addBusy}
                onClick={() => void createCustomer()}>
                {addBusy ? 'جارٍ الحفظ…' : 'حفظ الحساب'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة: تعديل بيانات الزبون */}
      {editOpen && detail != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(560px, 94vw)'}}>
            <div className="modal-head">
              <b>تعديل بيانات «{detail.customer.name}»</b>
              <button
                className="btn sm ghost"
                onClick={() => setEditOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="dc-form-grid">
                <div className="field">
                  <label>رقم الهوية (9 أرقام بالضبط)</label>
                  <input
                    className="dc-input-ltr"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={9}
                    value={editId}
                    onChange={e => setEditId(e.target.value)}
                  />
                  {editErrors.id != null && (
                    <span className="dc-err">{editErrors.id}</span>
                  )}
                </div>
                <div className="field">
                  <label>رقم الجوال (056 أو 059)</label>
                  <input
                    className="dc-input-ltr"
                    dir="ltr"
                    inputMode="tel"
                    maxLength={10}
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                  />
                  {editErrors.phone != null && (
                    <span className="dc-err">{editErrors.phone}</span>
                  )}
                </div>
                <div className="field span2">
                  <label>اسم الزبون</label>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                  />
                  {editErrors.name != null && (
                    <span className="dc-err">{editErrors.name}</span>
                  )}
                </div>
                <div className="field span2">
                  <label>ملاحظات</label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                  />
                </div>
              </div>
              <div className="dc-hint">
                تعديل الهوية يفحص تفرد الرقم داخل الدفتر قبل الحفظ.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setEditOpen(false)}>
                تراجع
              </button>
              <button
                className="btn primary"
                disabled={editBusy}
                onClick={() => void saveEdit()}>
                {editBusy ? 'جارٍ الحفظ…' : 'حفظ التعديل'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة: تسجيل دين */}
      {debtOpen && detail != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(480px, 94vw)'}}>
            <div className="modal-head">
              <b>تسجيل دين على «{detail.customer.name}»</b>
              <button
                className="btn sm ghost"
                onClick={() => setDebtOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>المبلغ (₪)</label>
                <input
                  className="dc-input-ltr"
                  dir="ltr"
                  inputMode="decimal"
                  value={debtAmount}
                  onChange={e => setDebtAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <div className="field">
                <label>البيان (اختياري)</label>
                <input
                  value={debtDesc}
                  onChange={e => setDebtDesc(e.target.value)}
                  placeholder="مثال: مشتريات بقالة"
                />
              </div>
              <div className="dc-hint">
                يُرقَّم الدين بسند INV-L خاصاً بدفتر المتجر ويضاف إلى الدين
                القائم فوراً.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDebtOpen(false)}>
                إلغاء
              </button>
              <button
                className="btn primary"
                disabled={debtBusy}
                onClick={() => void recordDebt()}>
                {debtBusy ? 'جارٍ التسجيل…' : 'تسجيل الدين'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة: تسجيل سداد */}
      {payOpen && detail != null && detail.outstandingMinor > 0 && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(500px, 94vw)'}}>
            <div className="modal-head">
              <b>تسجيل سداد من «{detail.customer.name}»</b>
              <button
                className="btn sm ghost"
                onClick={() => setPayOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>
                  المبلغ (₪) — الدين القائم:{' '}
                  <b style={{color: 'var(--danger)'}}>
                    {money(detail.outstandingMinor)}
                  </b>
                </label>
                <div style={{display: 'flex', gap: 8}}>
                  <input
                    className="dc-input-ltr"
                    dir="ltr"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="0.00"
                    style={{flex: 1}}
                    autoFocus
                  />
                  <button
                    className="btn"
                    onClick={() =>
                      setPayAmount((detail!.outstandingMinor / 100).toFixed(2))
                    }>
                    السداد الكامل
                  </button>
                </div>
              </div>
              <div className="dc-form-grid">
                <div className="field">
                  <label>طريقة السداد</label>
                  <select
                    value={payMethod}
                    onChange={e => setPayMethod(e.target.value as PayMethod)}>
                    <option value="cash">نقد</option>
                    <option value="card">بطاقة</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>
                <div className="field">
                  <label>ملاحظة (اختياري)</label>
                  <input
                    value={payNote}
                    onChange={e => setPayNote(e.target.value)}
                    placeholder="مثال: دفعة أولى"
                  />
                </div>
              </div>
              <div className="dc-hint">
                السداد لا يتجاوز الدين القائم — يُرقَّم بسند RCP-L.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setPayOpen(false)}>
                إلغاء
              </button>
              <button
                className="btn primary"
                disabled={payBusy}
                onClick={() => void recordPayment()}>
                {payBusy ? 'جارٍ التسجيل…' : 'تسجيل السداد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة: تأكيد حذف الحساب */}
      {deleteTarget != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(520px, 94vw)'}}>
            <div className="modal-head">
              <b>حذف حساب «{deleteTarget.customer.name}»</b>
              <button
                className="btn sm ghost"
                onClick={() => setDeleteTarget(null)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="dc-warnbox">⚠️ حذف نهائي لا يمكن التراجع عنه</div>
              <div className="dc-hint">
                الحساب مسدّد بالكامل (لا دين قائم ولا رصيد دائن). سيُحذف
                الحساب وسجل عملياته (الديون المسددة والسدادات) من دفتر المتجر
                نهائياً — أرصدة الخزينة لن تتأثر.
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setDeleteTarget(null)}>
                تراجع
              </button>
              <button
                className="btn danger"
                disabled={deleteBusy}
                onClick={() => void confirmDelete()}>
                {deleteBusy ? 'جارٍ الحذف…' : 'حذف نهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
