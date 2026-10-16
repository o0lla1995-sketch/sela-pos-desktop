/**
 * screens/CashMovementsScreen.tsx — حركات الخزينة (UI-2 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * منطق CashMovementsScreen الأندرويد (v25→v39) منقولاً إلى React DOM:
 *
 *  • «النقد المتوقع بالخزينة الآن» — بعد خصم كل المصروفات والمسحوبات
 *    وإضافة الإيداعات (CashService.drawerNowMinor، لحظة بلحظة).
 *  • ثلاث حركات موثقة بسندات مرقمة لا تُعدّل ولا تُحذف: مصروف (EXP-)
 *    بفئة من سلة الفئات، سحب رصيد (WD-)، وإيداع (DEP-).
 *  • السحب مؤمَّن: رمز PIN عبر PinPad إن كان مضبوطاً؛ إن كانت البصمة
 *    مفعّلة تُجرَّب أولاً وتعود false على سطح المكتب فيُسقط على PIN
 *    إن وجد، وإلا خطأ واضح («فعّل رمز PIN من الإعدادات أولاً»).
 *  • لا حركة تتجاوز ما في الدرج فعلياً — سقف صارم يمنع أي فقدان.
 *  • كشف PDF عربي A4 للفترة + طباعة حرارية + إعادة طباعة سند كل حركة.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useToastStore} from '../state/appStores';
import {
  CashService,
  EXPENSE_CATEGORIES,
  movementSecurityMode,
  verifyWithdrawalPin,
  authorizeWithBiometric,
} from '../services/CashService';
import {useAppLockStore} from '../stores/appLockStore';
import {PinPad} from '../components/PinPad';
import {Icon} from '../components/Icon';
import {
  formatDateTime,
  localToday,
  localDateShift,
  localMonthStart,
} from '../core/format';
import {amountTextToMinor} from '../core/amountKeypad';
import {useAmountKeyboard} from '../lib/useAmountKeyboard';
import type {
  CashAuthMethod,
  CashMovementKind,
  CashMovementRecord,
  CashMovementTotals,
} from '../core/types';
import {Select} from '../components/Select';
import './debtscash.css';

type KindFilter = 'all' | 'expense' | 'withdrawal' | 'deposit';
type FormMode = 'expense' | 'withdrawal' | 'deposit';

/** أغورات → «12.50 ₪» (نفس نمط CashService الداخلي). */
const shekels = (minor: number): string => `${(minor / 100).toFixed(2)} ₪`;

const KIND_LABELS: Record<CashMovementKind, string> = {
  expense: 'مصروف',
  withdrawal: 'سحب',
  deposit: 'إيداع',
  online_collection: 'تحصيل طلب',
  online_refund: 'استرداد',
};

const KIND_CHIP: Record<CashMovementKind, string> = {
  expense: 'warn',
  withdrawal: 'danger',
  deposit: 'ok',
  online_collection: 'brand',
  online_refund: 'muted',
};

/** الحركات الداخلة للخزينة (تظهر بموجب أخضر). */
const INFLOW_KINDS: ReadonlySet<CashMovementKind> = new Set([
  'deposit',
  'online_collection',
]);

const AUTH_LABELS: Record<CashAuthMethod, string> = {
  fingerprint: 'بصمة',
  pin: 'رمز PIN',
  none: 'بدون تأمين',
};

const FILTER_LABELS: Record<KindFilter, string> = {
  all: 'الكل',
  expense: 'مصروف',
  withdrawal: 'سحب',
  deposit: 'إيداع',
};

const FORM_TITLES: Record<FormMode, string> = {
  expense: 'تسجيل مصروف من الخزينة',
  withdrawal: 'سحب نقدي من الخزينة',
  deposit: 'إيداع نقدي في الخزينة',
};

export function CashMovementsScreen() {
  const toast = useToastStore(s => s.show);

  // ── الفترة والفلترة ──────────────────────────────────────────
  const [from, setFrom] = useState(localToday());
  const [to, setTo] = useState(localToday());
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  // ── البيانات ─────────────────────────────────────────────────
  const [rows, setRows] = useState<CashMovementRecord[]>([]);
  const [totals, setTotals] = useState<CashMovementTotals | null>(null);
  const [todayTotals, setTodayTotals] = useState<CashMovementTotals | null>(
    null,
  );
  const [drawerMinor, setDrawerMinor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // ── أزرار التصدير/الطباعة ────────────────────────────────────
  const [exportBusy, setExportBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [reprintId, setReprintId] = useState<number | null>(null);

  // ── نموذج الحركة ─────────────────────────────────────────────
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [formBusy, setFormBusy] = useState(false);

  // ── بوابة رمز PIN للسحب ──────────────────────────────────────
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bundle, drawer, today] = await Promise.all([
        CashService.statement(from, to, {full: true}),
        CashService.drawerNowMinor(),
        CashService.statement(localToday(), localToday()),
      ]);
      setRows(bundle.rows);
      setTotals(bundle.totals);
      setDrawerMinor(drawer);
      setTodayTotals(today.totals);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'تعذر تحميل حركات الخزينة',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      kindFilter === 'all' ? rows : rows.filter(r => r.kind === kindFilter),
    [rows, kindFilter],
  );

  const [quick, setQuick] = useState<'today' | 'last7' | 'month' | null>(null);
  const applyQuick = useCallback((key: 'today' | 'last7' | 'month') => {
    setQuick(key);
    const today = localToday();
    if (key === 'today') {
      setFrom(today);
      setTo(today);
    } else if (key === 'last7') {
      setFrom(localDateShift(-6));
      setTo(today);
    } else {
      setFrom(localMonthStart());
      setTo(today);
    }
  }, []);

  // ── نموذج الحركة ─────────────────────────────────────────────
  const openForm = useCallback((mode: FormMode) => {
    setFormMode(mode);
    setAmountText('');
    setNote('');
    setCategory(EXPENSE_CATEGORIES[0]);
  }, []);

  const closeForm = useCallback(() => {
    setFormMode(null);
    setPinOpen(false);
  }, []);

  const amountMinor = amountTextToMinor(amountText);
  const overDrawer =
    formMode != null &&
    formMode !== 'deposit' &&
    drawerMinor != null &&
    amountMinor > drawerMinor;

  /** التنفيذ الفعلي — بعد اجتياز بوابة التأمين (أو بدون تأمين). */
  const executeMovement = useCallback(
    async (auth: CashAuthMethod) => {
      if (formBusy || formMode == null) {
        return;
      }
      const minor = amountTextToMinor(amountText);
      if (minor <= 0) {
        return;
      }
      setPinOpen(false);
      setFormBusy(true);
      try {
        let movement: CashMovementRecord;
        if (formMode === 'expense') {
          movement = await CashService.recordExpense({
            category,
            note: note.trim() || null,
            amountMinor: minor,
            authMethod: auth,
          });
          toast(
            `سُجّل المصروف ${movement.ref} — ${movement.category}: ` +
              `${shekels(movement.amount_minor)} خُصم من الخزينة`,
            'success',
            4500,
          );
        } else if (formMode === 'withdrawal') {
          movement = await CashService.recordWithdrawal({
            note: note.trim() || null,
            amountMinor: minor,
            authMethod: auth,
          });
          toast(
            `سُجّل السحب ${movement.ref} بمبلغ ` +
              `${shekels(movement.amount_minor)} — خُصم من الخزينة ` +
              `(${AUTH_LABELS[auth]})`,
            'success',
            4500,
          );
        } else {
          movement = await CashService.recordDeposit({
            note: note.trim() || null,
            amountMinor: minor,
            authMethod: auth,
          });
          toast(
            `سُجّل الإيداع ${movement.ref} بمبلغ ` +
              `${shekels(movement.amount_minor)} — أُضيف إلى الخزينة`,
            'success',
            4500,
          );
        }
        closeForm();
        await load();
      } catch (e) {
        toast(
          e instanceof Error ? e.message : 'فشل تسجيل الحركة',
          'error',
          6000,
        );
      } finally {
        setFormBusy(false);
      }
    },
    [
      formBusy,
      formMode,
      amountText,
      category,
      note,
      closeForm,
      load,
      toast,
    ],
  );

  /** زر التأكيد: يتحقق من المبلغ ثم يمرّ ببوابة تأمين السحب. */
  const confirmForm = useCallback(() => {
    if (formBusy || formMode == null) {
      return;
    }
    if (amountMinor <= 0) {
      toast('أدخل مبلغاً صحيحاً أكبر من صفر', 'error');
      return;
    }
    if (overDrawer) {
      toast(
        `المبلغ أكبر من النقد الموجود بالخزينة (${shekels(drawerMinor ?? 0)})` +
          ' — لا يمكن تجاوز رصيد الدرج',
        'error',
      );
      return;
    }
    if (formMode !== 'withdrawal') {
      // المصروف والإيداع يسجّلان مباشرة (بلا بوابة — حسب مواصفة سطح المكتب).
      void executeMovement('none');
      return;
    }
    // ── بوابة تأمين السحب (نمط الأندرويد v27 مكيفاً لسطح المكتب) ──
    const mode = movementSecurityMode();
    if (mode === 'none') {
      void executeMovement('none');
      return;
    }
    if (mode === 'pin') {
      setPinOpen(true);
      return;
    }
    // 'biometric' — البصمة غير متاحة على سطح المكتب وتعود false:
    // نسقط على رمز PIN إن كان مضبوطاً، وإلا خطأ واضح للتاجر.
    void (async () => {
      try {
        const ok = await authorizeWithBiometric();
        if (ok) {
          await executeMovement('fingerprint');
          return;
        }
        if (useAppLockStore.getState().pinHash != null) {
          toast('البصمة غير متاحة على سطح المكتب — أدخل رمز PIN', 'info');
          setPinOpen(true);
        } else {
          toast('فعّل رمز PIN من الإعدادات أولاً', 'error');
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    })();
  }, [
    formBusy,
    formMode,
    amountMinor,
    overDrawer,
    drawerMinor,
    executeMovement,
    toast,
  ]);

  // ── v59: Enter من الكيبورد يؤكد الحركة وEscape يغلقها ──
  useAmountKeyboard({
    active: formMode != null && !pinOpen,
    text: amountText,
    onKey: () => undefined,
    onConfirm: confirmForm,
    onCancel: closeForm,
    hasTextInput: true,
  });

  // ── كشف الفترة: PDF + طباعة حرارية ──────────────────────────
  const exportPdf = useCallback(async () => {
    if (exportBusy) {
      return;
    }
    setExportBusy(true);
    try {
      const location = await CashService.exportStatementPdf(from, to);
      toast(`أُنشئ كشف PDF: ${location}`, 'success', 6000);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'فشل إنشاء كشف PDF',
        'error',
        6000,
      );
    } finally {
      setExportBusy(false);
    }
  }, [exportBusy, from, to, toast]);

  const printThermal = useCallback(async () => {
    if (printBusy) {
      return;
    }
    setPrintBusy(true);
    try {
      await CashService.printStatementThermal(from, to);
      toast('طُبع كشف الخزينة على الطابعة الحرارية', 'success');
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'فشلت الطباعة الحرارية',
        'error',
      );
    } finally {
      setPrintBusy(false);
    }
  }, [printBusy, from, to, toast]);

  const reprint = useCallback(
    async (movement: CashMovementRecord) => {
      if (reprintId != null) {
        return;
      }
      setReprintId(movement.local_id);
      try {
        await CashService.reprintSlip(movement);
        toast(`طُبع سند ${movement.ref}`, 'success');
      } catch (e) {
        toast(
          e instanceof Error ? e.message : 'فشلت إعادة الطباعة',
          'error',
        );
      } finally {
        setReprintId(null);
      }
    },
    [reprintId, toast],
  );

  // ──────────────────────────────────────────────────────────────
  return (
    <div className="screen">
      <h1>الخزينة — المصروفات والسحوبات</h1>
      <div className="subtitle">
        كل شيكل يخرج من الدرج خارج البيع = سند مرقّم بفئة وسبب ووقت — لا
        تعديل ولا حذف (مسار تدقيق كامل)
      </div>

      {/* رأس الخزينة */}
      <div className="card dc-treasury">
        <div>
          <div className="label">النقد المتوقع بالخزينة الآن</div>
          <div className="amount">
            {drawerMinor == null ? '…' : shekels(drawerMinor)}
          </div>
          <div className="dc-hint">
            بعد خصم كل المصروفات والمسحوبات وإضافة الإيداعات — لحظة بلحظة
          </div>
        </div>
        <div className="dc-today">
          <span className="chip warn">
            مصروفات اليوم {shekels(todayTotals?.expensesMinor ?? 0)} (
            {todayTotals?.expensesCount ?? 0})
          </span>
          <span className="chip danger">
            مسحوبات اليوم {shekels(todayTotals?.withdrawalsMinor ?? 0)} (
            {todayTotals?.withdrawalsCount ?? 0})
          </span>
          <span className="chip ok">
            إيداعات اليوم {shekels(todayTotals?.depositsMinor ?? 0)} (
            {todayTotals?.depositsCount ?? 0})
          </span>
        </div>
      </div>

      {/* ملخص الفترة */}
      <div className="grid-4" style={{marginTop: 14}}>
        <div className="card kpi">
          <span className="label">مصروفات الفترة</span>
          <span className="value danger">
            {shekels(totals?.expensesMinor ?? 0)}
          </span>
          <span className="label">{totals?.expensesCount ?? 0} سند</span>
        </div>
        <div className="card kpi">
          <span className="label">مسحوبات الفترة</span>
          <span className="value danger">
            {shekels(totals?.withdrawalsMinor ?? 0)}
          </span>
          <span className="label">{totals?.withdrawalsCount ?? 0} سند</span>
        </div>
        <div className="card kpi">
          <span className="label">إيداعات الفترة</span>
          <span className="value ok">
            {shekels(totals?.depositsMinor ?? 0)}
          </span>
          <span className="label">{totals?.depositsCount ?? 0} سند</span>
        </div>
        <div className="card kpi">
          <span className="label">صافي حركة الفترة</span>
          <span className="value brand">{shekels(totals?.netMinor ?? 0)}</span>
          <span className="label">إيداعات − مصروفات − مسحوبات</span>
        </div>
      </div>

      {/* الفلاتر والفترة */}
      <div className="toolbar" style={{marginTop: 14}}>
        {(Object.keys(FILTER_LABELS) as KindFilter[]).map(key => (
          <button
            key={key}
            className={`chip-toggle ${kindFilter === key ? 'on' : ''}`}
            onClick={() => setKindFilter(key)}>
            {FILTER_LABELS[key]}
          </button>
        ))}
        <span className="grow" />
        <div className="dc-dates">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            aria-label="من تاريخ"
          />
          <span className="dc-hint">إلى</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            aria-label="إلى تاريخ"
          />
        </div>
        <button
          className={`chip-toggle ${quick === 'today' ? 'on' : ''}`}
          onClick={() => applyQuick('today')}>
          اليوم
        </button>
        <button
          className={`chip-toggle ${quick === 'last7' ? 'on' : ''}`}
          onClick={() => applyQuick('last7')}>
          آخر 7 أيام
        </button>
        <button
          className={`chip-toggle ${quick === 'month' ? 'on' : ''}`}
          onClick={() => applyQuick('month')}>
          هذا الشهر
        </button>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      </div>

      {/* أزرار الحركات والتصدير */}
      <div className="dc-actions" style={{marginBottom: 14}}>
        <button className="btn primary" onClick={() => openForm('expense')}>
          + تسجيل مصروف
        </button>
        <button className="btn" onClick={() => openForm('deposit')}>
          إيداع نقد
        </button>
        <button className="btn danger" onClick={() => openForm('withdrawal')}>
          سحب من الخزينة
        </button>
        <span style={{flex: 1}} />
        <button
          className="btn ghost"
          disabled={exportBusy}
          onClick={() => void exportPdf()}>
          {exportBusy ? 'جارٍ إنشاء الكشف…' : 'كشف PDF للفترة'}
        </button>
        <button
          className="btn ghost"
          disabled={printBusy}
          onClick={() => void printThermal()}>
          {printBusy ? 'جارٍ الطباعة…' : 'طباعة الكشف حرارياً'}
        </button>
      </div>

      {/* سجل الحركات */}
      <div className="card" style={{padding: 0, overflow: 'hidden'}}>
        <table className="dc-table">
          <thead>
            <tr>
              <th>السند</th>
              <th>النوع</th>
              <th>الفئة</th>
              <th>الملاحظة</th>
              <th>المبلغ</th>
              <th>التاريخ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="dc-empty-sm">
                    {loading
                      ? 'جارٍ تحميل الحركات…'
                      : 'لا حركات خزينة في هذه الفترة — كل مصروف أو سحب أو إيداع يُسجّل هنا بسند مرقّم'}
                  </div>
                </td>
              </tr>
            )}
            {visible.map(m => (
              <tr key={m.local_id}>
                <td>
                  <span className="dc-ref">{m.ref}</span>
                  <div className="mut">{AUTH_LABELS[m.auth_method]}</div>
                </td>
                <td>
                  <span className={`chip ${KIND_CHIP[m.kind]}`}>
                    {KIND_LABELS[m.kind]}
                  </span>
                </td>
                <td>{m.category}</td>
                <td className="mut">{m.note ?? '—'}</td>
                <td
                  className={
                    INFLOW_KINDS.has(m.kind) ? 'dc-mov-pos' : 'dc-mov-neg'
                  }>
                  {INFLOW_KINDS.has(m.kind) ? '+' : '−'}
                  {shekels(m.amount_minor)}
                </td>
                <td className="mut">{formatDateTime(m.created_at)}</td>
                <td>
                  <button
                    className="btn sm ghost"
                    disabled={reprintId === m.local_id}
                    title={`إعادة طباعة سند ${m.ref}`}
                    onClick={() => void reprint(m)}>
                    {reprintId === m.local_id ? (
                      '…'
                    ) : (
                      <Icon name="printer" size={15} />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dc-hint" style={{marginTop: 8}}>
        {visible.length} سند معروض من أصل {rows.length} في الفترة {from} ←{' '}
        {to} — السجل غير قابل للتعديل: التصحيح بحركة معاكسة فقط.
      </div>

      {/* نموذج الحركة */}
      {formMode != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(520px, 94vw)'}}>
            <div className="modal-head">
              <b>{FORM_TITLES[formMode]}</b>
              <button className="btn sm ghost" onClick={closeForm}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>
                  المبلغ (₪)
                  {formMode !== 'deposit' &&
                    drawerMinor != null &&
                    ` — المتاح بالخزينة: ${shekels(drawerMinor)}`}
                </label>
                <input
                  className="dc-input-ltr"
                  dir="ltr"
                  inputMode="decimal"
                  value={amountText}
                  onChange={e => setAmountText(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
                {overDrawer && (
                  <span className="dc-err">
                    المبلغ يتجاوز النقد الموجود بالخزينة (
                    {shekels(drawerMinor ?? 0)})
                  </span>
                )}
              </div>
              {formMode === 'expense' && (
                <div className="field">
                  <label>فئة المصروف</label>
                  <Select
                    value={category}
                    onChange={setCategory}
                    options={EXPENSE_CATEGORIES.map(c => ({
                      value: c,
                      label: c,
                    }))}
                    ariaLabel="فئة المصروف"
                  />
                </div>
              )}
              <div className="field">
                <label>
                  {formMode === 'expense'
                    ? 'ملاحظة (اختياري)'
                    : 'السبب / الملاحظة (اختياري)'}
                </label>
                <input
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="مثال: فاتورة كهرباء شباط"
                />
              </div>
              {formMode === 'withdrawal' &&
                (movementSecurityMode() === 'none' ? (
                  <div className="dc-warnbox">
                    <Icon name="alert" size={15} /> لم تُفعّل أي حماية للحركات
                    — يُنصح بتفعيل رمز PIN من الإعدادات (تُسجَّل الحركة «بدون
                    تأمين»)
                  </div>
                ) : (
                  <div className="dc-hint">
                    <Icon name="lock" size={15} /> السحب مؤمَّن{' '}
                    {movementSecurityMode() === 'pin'
                      ? 'برمز PIN'
                      : 'بالبصمة مع سقوط على رمز PIN'}{' '}
                    — ستُطلب الموافقة قبل التنفيذ، وتُكتب طريقة التأمين في
                    السند نفسه.
                  </div>
                ))}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={closeForm}>
                إلغاء
              </button>
              <button
                className="btn primary"
                disabled={formBusy || amountMinor <= 0 || overDrawer}
                onClick={confirmForm}>
                {formBusy ? 'جارٍ التسجيل…' : 'تأكيد'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* بوابة رمز PIN — تعلو نموذج الحركة (z-index أعلى) */}
      {pinOpen && (
        <PinPad
          title="تأكيد السحب من الخزينة"
          subtitle="أدخل رمز PIN لإتمام عملية السحب"
          verify={verifyWithdrawalPin}
          onDone={ok => {
            if (ok) {
              void executeMovement('pin');
            }
          }}
          onCancel={() => setPinOpen(false)}
        />
      )}
    </div>
  );
}
