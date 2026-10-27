/**
 * screens/InvoicesScreen.tsx — مركز الفواتير والمرتجعات (UI-5 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * منطق InvoicesScreen الأندرويد v57 منقولاً إلى React DOM:
 *
 *  • قائمة مفاتّحة (الأحدث أولاً) لكل سلسلة — INV-/INV-D-/INV-L-/INV-O-/
 *    INV-V-/RET- — ببحث حقيقي متعدد الأبعاد (رقم الفاتورة/الزبون/
 *    الصنف/المبلغ/التاريخ) + فلاتر نوع + نطاق تاريخ + ترقيم صفحات.
 *  • صفوف RET- (المرتجعات) بمظهر مميز: قيمة سالبة وشارة «مرتجع» —
 *    المرتجع لا يُقرأ كبيع أبداً.
 *  • «منها مرتجع» على الفاتورة التي أُرجع جزء منها مع قيمة المُرجَع.
 *  • التفاصيل: الأصناف (اسم + متغير + وحدة + كمية × سعر = إجمالي)،
 *    المجاميع (قبل الخصم/الخصم/المرتجعات/الصافي)، دفتر الفاتورة
 *    (دين صِلة/دفتر المتجر)، وقائمة إشعارات RET- الصادرة عنها.
 *  • محرك الإرجاع/الاستبدال v57: prepareReturn → كميات لكل صنف
 *    (بحدّ المتبقي)، طريقة الاسترداد للفواتير النقدية، استبدال ببضاعة
 *    بديلة (وحدات + متغيرات + خصم المنتج) بتسوية الفرق نقداً/ديناً —
 *    ثم createReturn بمعاملة واحدة وطباعة إشعار RET حرارياً
 *    (فشل الطباعة لا يُلغي المرتجع — توست فقط).
 *  • إعادة الطباعة لكل سلسلة بالقالب الصحيح: RET- → قالب المرتجع،
 *    INV-D → إيصال دين صِلة، INV-L → إيصال دين الدفتر، INV-V →
 *    قسيمة، وإلا فاتورة عادية — عبر InvoiceService.reprintInvoice.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useToastStore} from '../state/appStores';
import {useSettingsStore} from '../stores/settingsStore';
import {usePrinterStore} from '../stores/printerStore';
import {InvoiceService} from '../services/InvoiceService';
import {SaleRepo} from '../database/repositories/SaleRepo';
import {ProductRepo} from '../database/repositories/ProductRepo';
import {UnitRepo} from '../database/repositories/UnitRepo';
import {VariantRepo} from '../database/repositories/VariantRepo';
import {LocalDebtsRepo} from '../database/repositories/LocalDebtsRepo';
import {SilaRepo} from '../services/sila/SilaRepo';
import {applyProductDiscount} from '../stores/cartStore';
import {buildReturnReceiptJob} from '../services/printer/returnReceipt';
import {ThermalPrinterService} from '../services/printer/ThermalPrinterService';
import {useEnterConfirm} from '../lib/useEnterConfirm';
import {Icon} from '../components/Icon';
import type {ReceiptSettings} from '../services/printer/receipt';
import {
  formatDateTime,
  formatMoney,
  formatQty,
  localDateShift,
  localMonthStart,
  localToday,
  parseNumber,
} from '../core/format';
import type {
  ExchangeLineInput,
  Product,
  ProductUnit,
  ProductVariant,
  ReturnBook,
  ReturnLineInput,
  SaleItemRecord,
  SaleRecord,
  SaleReturnExchange,
  SaleReturnItem,
  SaleReturnRecord,
  SilaDebtRow,
} from '../core/types';
import './invoiceshome.css';
import {PAYMENT_METHODS, paymentMethodById} from '../core/paymentMethods';

const PAGE_SIZE = 40;

type InvoiceRow = SaleRecord & {itemsCount: number};
type KindFilter = 'all' | 'cash' | 'sila' | 'local' | 'voucher' | 'returns';

/** v23 (round-29 #3): رقائق فلتر النوع — نفس مجموعات الأندرويد. */
const KIND_CHIPS: {key: KindFilter; label: string}[] = [
  {key: 'all', label: 'الكل'},
  {key: 'cash', label: 'نقدية'},
  {key: 'sila', label: 'دين صِلة'},
  {key: 'local', label: 'دين المتجر'},
  {key: 'voucher', label: 'قسائم'},
  {key: 'returns', label: 'مرتجعات'},
];

/** ملصق السلسلة من رقم الفاتورة (INV-D-… = دين صِلة …). */
function seriesLabel(ref: string): string {
  if (ref.startsWith('RET-')) {
    return 'مرتجع';
  }
  if (ref.startsWith('INV-D-')) {
    return 'دين صِلة';
  }
  if (ref.startsWith('INV-L-')) {
    return 'دين متجر';
  }
  if (ref.startsWith('INV-O-')) {
    return 'طلب أونلاين';
  }
  if (ref.startsWith('INV-V-')) {
    return 'قسيمة';
  }
  return 'نقدية';
}

const SERIES_CHIP: Record<string, string> = {
  'مرتجع': 'warn',
  'دين صِلة': 'warn',
  'دين متجر': 'warn',
  'طلب أونلاين': 'brand',
  'قسيمة': 'brand',
  'نقدية': 'muted',
};

/** خطوة العدّاد: 1 للأعداد الصحيحة، 0.5 للأوزان/الكسور. */
function stepFor(remaining: number): number {
  return Number.isInteger(remaining) ? 1 : 0.5;
}

// ══════════════════════════════════════════════════════════════════
// الشاشة — القائمة + الفلاتر + الترقيم
// ══════════════════════════════════════════════════════════════════
export function InvoicesScreen() {
  const toast = useToastStore(s => s.show);
  const settings = useSettingsStore(s => s.settings);
  const printerConnected = usePrinterStore(s => s.status === 'connected');

  // لقطة إعدادات الإيصال (نفس مسار SilaScreen الأندرويد v57).
  const receiptSettings: ReceiptSettings = useMemo(
    () => ({
      storeName: settings.storeName,
      storePhone: settings.storePhone,
      footerMessage: settings.footerMessage,
      storeLogoPath: settings.storeLogoPath,
      paperWidth: settings.paperWidth,
      codepage: settings.codepage,
      showProfit: settings.showProfitOnReceipt,
    }),
    [settings],
  );

  // ── النطاق والفلاتر ────────────────────────────────────────────
  const [from, setFrom] = useState(localDateShift(-6));
  const [to, setTo] = useState(localToday());
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  /** v70 (الجولة 74 #2): تصفية بطريقة الدفع (بنك/محفظة/نقدي). */
  const [methodFilter, setMethodFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ── البيانات ─────────────────────────────────────────────────
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const loadedCountRef = useRef(0);
  // v11 (SILA): أرقام الفواتير التي عليها دين (شارة «دين») — تُحدَّث
  // مع كل تحميل كي تظهر الديون الجديدة فوراً (تغطي صيغ INV-D
  // القديمة قبل الترقية أيضاً).
  const [debtRefs, setDebtRefs] = useState<Set<string>>(new Set());

  // ── النوافذ ───────────────────────────────────────────────────
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const [returnId, setReturnId] = useState<number | null>(null);
  const [reprintId, setReprintId] = useState<number | null>(null);

  // بحث 300ms — استعلامات EXISTS لكل صف: الكتابة تبقى سلسة.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const queryPage = useCallback(
    (offset: number) =>
      SaleRepo.listPagePaged({
        limit: PAGE_SIZE,
        offset,
        search: debouncedSearch.trim(),
        kind: kindFilter,
        fromDate: from || undefined,
        toDate: to || undefined,
        paymentMethod: methodFilter,
      }),
    [debouncedSearch, kindFilter, from, to, methodFilter],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const page = await queryPage(0);
      setRows(page);
      loadedCountRef.current = page.length;
      setReachedEnd(page.length < PAGE_SIZE);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'تعذر تحميل الفواتير',
        'error',
      );
    } finally {
      setLoading(false);
    }
    // شارات الدين مع كل تحميل (best effort).
    void SilaRepo.allDebtInvoiceRefs()
      .then(setDebtRefs)
      .catch(() => undefined);
  }, [queryPage, toast]);

  const loadMore = useCallback(async () => {
    if (loadingMore || reachedEnd || loading) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await queryPage(loadedCountRef.current);
      setRows(prev => [...prev, ...page]);
      loadedCountRef.current += page.length;
      setReachedEnd(page.length < PAGE_SIZE);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر تحميل المزيد', 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, reachedEnd, loading, queryPage, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [quick, setQuick] = useState<'today' | 'week' | 'month' | 'all' | null>(null);
  const applyQuick = useCallback((key: 'today' | 'week' | 'month' | 'all') => {
    setQuick(key);
    const today = localToday();
    if (key === 'today') {
      setFrom(today);
      setTo(today);
    } else if (key === 'week') {
      setFrom(localDateShift(-6));
      setTo(today);
    } else if (key === 'month') {
      setFrom(localMonthStart());
      setTo(today);
    } else {
      setFrom('');
      setTo('');
    }
  }, []);

  const visibleSum = useMemo(
    () => rows.reduce((sum, row) => sum + row.total_amount, 0),
    [rows],
  );

  // ── إعادة طباعة صف (تُحدد القالب من السلسلة داخل الخدمة) ────
  const reprintRow = useCallback(
    async (row: InvoiceRow) => {
      if (reprintId != null) {
        return;
      }
      setReprintId(row.id);
      try {
        await InvoiceService.reprintInvoice(row.id, receiptSettings);
        toast(`أُعيدت طباعة ${row.invoice_number}`, 'success');
      } catch (e) {
        toast(
          e instanceof Error ? e.message : 'فشلت إعادة الطباعة',
          'error',
        );
      } finally {
        setReprintId(null);
      }
    },
    [reprintId, receiptSettings, toast],
  );

  return (
    <div className="screen">
      <h1>الفواتير والمرتجعات</h1>
      <div className="subtitle">
        كل فاتورة صدرت عن المتجر — نقدية، ديون صِلة، دفتر المتجر، طلبات
        أونلاين وقسائم — مع محرك الإرجاع/الاستبدال وإشعارات RET- وإعادة
        الطباعة بالقالب الصحيح لكل سلسلة
      </div>

      {/* الفلاتر: النوع + النطاق + البحث */}
      <div className="toolbar">
        {KIND_CHIPS.map(chip => (
          <button
            key={chip.key}
            className={`chip-toggle ${kindFilter === chip.key ? 'on' : ''}`}
            onClick={() => setKindFilter(chip.key)}>
            {chip.label}
          </button>
        ))}
        <span className="grow" />
        <input
          className="ih-search"
          placeholder="ابحث برقم الفاتورة أو الزبون أو الصنف أو المبلغ…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="toolbar">
        <div className="ih-dates">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            aria-label="من تاريخ"
          />
          <span className="ih-hint">إلى</span>
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
          className={`chip-toggle ${quick === 'week' ? 'on' : ''}`}
          onClick={() => applyQuick('week')}>
          آخر 7 أيام
        </button>
        <button
          className={`chip-toggle ${quick === 'month' ? 'on' : ''}`}
          onClick={() => applyQuick('month')}>
          هذا الشهر
        </button>
        <button
          className={`chip-toggle ${quick === 'all' ? 'on' : ''}`}
          onClick={() => applyQuick('all')}>
          كل الفترات
        </button>
        <span className="grow" />
        <span className="chip brand">{formatMoney(visibleSum)}</span>
        <span className="chip muted">{rows.length} فاتورة</span>
        <button className="btn" onClick={() => void reload()} disabled={loading}>
          {loading ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      </div>

      {/* v70 (الجولة 74 #2): تصفية بطريقة الدفع — الأرصدة الواردة */}
      <div className="ih-toolbar" style={{flexWrap: 'wrap'}}>
        <span className="ih-label">طريقة الدفع:</span>
        <button
          className={`chip-toggle ${methodFilter === 'all' ? 'on' : ''}`}
          onClick={() => setMethodFilter('all')}>
          الكل
        </button>
        {PAYMENT_METHODS.map(method => (
          <button
            key={method.id}
            className={`chip-toggle ${methodFilter === method.id ? 'on' : ''}`}
            style={
              methodFilter === method.id
                ? {background: method.color, borderColor: method.color}
                : undefined
            }
            onClick={() => setMethodFilter(method.id)}>
            {method.label}
          </button>
        ))}
      </div>

      {/* جدول الفواتير */}
      <div className="card ih-card-flat">
        <table className="ih-table">
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>النوع</th>
              <th>التسعير</th>
              <th>الأصناف</th>
              <th>الإجمالي</th>
              <th>المرتجع منها</th>
              <th>التاريخ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr style={{cursor: 'default'}}>
                <td colSpan={8}>
                  <div className="ih-empty-sm">
                    {loading
                      ? 'جارٍ تحميل الفواتير…'
                      : debouncedSearch.trim().length > 0
                      ? `لا فاتورة تطابق «${debouncedSearch}» — جرّب اسم الزبون أو الصنف أو رقمًا أقصر`
                      : 'لا فواتير في هذا النطاق — أول بيع من نقطة البيع سيظهر هنا فوراً'}
                  </div>
                </td>
              </tr>
            )}
            {rows.map(row => {
              const isReturn = row.return_kind != null;
              const isDebt =
                !isReturn &&
                (debtRefs.has(row.invoice_number) ||
                  row.invoice_number.startsWith('INV-D-') ||
                  row.invoice_number.startsWith('INV-L-'));
              const series = isReturn ? 'مرتجع' : seriesLabel(row.invoice_number);
              const returnedMinor = row.returned_minor ?? 0;
              return (
                <tr
                  key={row.id}
                  className={isReturn ? 'ih-row-ret' : ''}
                  onClick={() => setDetailId(row.id)}>
                  <td>
                    <span className="ih-ref">{row.invoice_number}</span>
                  </td>
                  <td>
                    <span className={`chip ${SERIES_CHIP[series]}`}>
                      {series}
                    </span>
                    {isDebt && <span className="chip warn">دين</span>}
                    {/* v58 (الجولة 62): نسبة الفاتورة للكاشير (سيلّا
                        كاشير عبر الشبكة المحلية). */}
                    {row.cashier_name && (
                      <span className="chip" title={`كاشير: ${row.cashier_name}`}>
                        {row.cashier_name}
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`chip ${
                        row.payment_type === 'WHOLESALE' ? 'brand' : 'muted'
                      }`}>
                      {row.payment_type === 'WHOLESALE' ? 'جملة' : 'مفرق'}
                    </span>
                    {/* v70 (الجولة 74 #2): طريقة الدفع غير النقدية — */}
                    {/* شارة ملوّنة للبنك/المحفظة (النقدي هو المعتاد). */}
                    {row.payment_method != null &&
                      row.payment_method !== '' &&
                      row.payment_method !== 'cash' && (
                        <span
                          className="chip"
                          style={{
                            background: `${paymentMethodById(row.payment_method).color}22`,
                            color: paymentMethodById(row.payment_method).color,
                            fontWeight: 700,
                          }}>
                          {paymentMethodById(row.payment_method).label}
                        </span>
                      )}
                  </td>
                  <td className="ih-mut">{row.itemsCount} صنف</td>
                  <td>
                    <span
                      className={`ih-amount ${isReturn ? 'warn' : 'brand'}`}>
                      {formatMoney(row.total_amount)}
                    </span>
                  </td>
                  <td>
                    {returnedMinor > 0 ? (
                      <span className="chip warn">
                        مرتجع {formatMoney(returnedMinor / 100)}
                      </span>
                    ) : (
                      <span className="ih-mut">—</span>
                    )}
                  </td>
                  <td className="ih-mut">{formatDateTime(row.created_at)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      className="btn sm ghost"
                      title={`إعادة طباعة ${row.invoice_number}`}
                      disabled={reprintId === row.id}
                      onClick={() => void reprintRow(row)}>
                      {reprintId === row.id ? (
                        '…'
                      ) : (
                        <Icon name="printer" size={15} />
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ih-hint ih-foot-note">
        {rows.length} فاتورة معروضة في {from || 'البداية'} ← {to || 'الآن'} —
        البحث يطابق رقم الفاتورة وأسماء الدائنين وأسماء الأصناف والمبلغ.
        {!reachedEnd && rows.length > 0 && (
          <>
            {' '}
            <button
              className="ih-link-btn"
              onClick={() => void loadMore()}
              disabled={loadingMore}>
              {loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
            </button>
          </>
        )}
        {reachedEnd && rows.length > PAGE_SIZE && ' — لا مزيد من الفواتير'}
      </div>

      {/* تفاصيل الفاتورة */}
      {detailId != null && (
        <DetailModal
          saleId={detailId}
          receiptSettings={receiptSettings}
          reloadSignal={detailReload}
          enterEnabled={returnId == null}
          onClose={() => setDetailId(null)}
          onReturn={() => setReturnId(detailId)}
        />
      )}

      {/* محرك الإرجاع/الاستبدال */}
      {returnId != null && (
        <ReturnModal
          saleId={returnId}
          receiptSettings={receiptSettings}
          printerConnected={printerConnected}
          onClose={() => setReturnId(null)}
          onDone={() => {
            setReturnId(null);
            setDetailReload(v => v + 1);
            void reload();
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// تفاصيل الفاتورة — الأصناف + المجاميع + المرتجعات + الدائن
// ══════════════════════════════════════════════════════════════════
function DetailModal({
  saleId,
  receiptSettings,
  reloadSignal,
  enterEnabled,
  onClose,
  onReturn,
}: {
  saleId: number;
  receiptSettings: ReceiptSettings;
  reloadSignal: number;
  /** v61: Enter يغلق النافذة (زر «تم») — إلا والنافذة الإرجاع فوقها. */
  enterEnabled: boolean;
  onClose: () => void;
  onReturn: () => void;
}) {
  const toast = useToastStore(s => s.show);
  const [loading, setLoading] = useState(true);
  const [sale, setSale] = useState<SaleRecord | null>(null);
  const [items, setItems] = useState<SaleItemRecord[]>([]);
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [returns, setReturns] = useState<SaleReturnRecord[]>([]);
  // صف RET- نفسه: أسطره من sale_return_items (موجبة ومسماة)
  // بدل المرآة السالبة — نفس قاعدة الأندرويد v23.
  const [retContext, setRetContext] = useState<{
    ret: SaleReturnRecord;
    lines: SaleReturnItem[];
    exchanges: SaleReturnExchange[];
  } | null>(null);
  const [debt, setDebt] = useState<SilaDebtRow | null>(null);
  const [localCreditor, setLocalCreditor] = useState<{
    name: string;
    phone: string | null;
  } | null>(null);
  const [reprinting, setReprinting] = useState(false);
  const [retPrintId, setRetPrintId] = useState<number | null>(null);

  // v61 (الجولة 26 #6): Enter يغلق تفاصيل الفاتورة — نفس زر «تم»
  // (معطّل ونافذة الإرجاع مفتوحة فوقها).
  useEnterConfirm({
    active: enterEnabled,
    onConfirm: onClose,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const record = await SaleRepo.getById(saleId);
      if (record == null) {
        setSale(null);
        return;
      }
      const lines = await SaleRepo.getItemsForSale(saleId);
      const nameMap = new Map<number, string>();
      for (const item of lines) {
        if (!nameMap.has(item.product_id)) {
          const product = await ProductRepo.getById(item.product_id);
          nameMap.set(item.product_id, product?.name ?? `#${item.product_id}`);
        }
      }
      // دفتر الدين: صِلة (INV-D) أو الدفتر المحلي (INV-L).
      const silaRow = record.invoice_number.startsWith('INV-D-')
        ? await SilaRepo.byInvoiceRef(record.invoice_number)
        : null;
      const localRow =
        record.invoice_number.startsWith('INV-L-')
          ? await LocalDebtsRepo.creditorByInvoiceRef(record.invoice_number)
          : null;
      const returnsForInvoice = await SaleRepo.returnsForSale(saleId);
      let ret: {ret: SaleReturnRecord; lines: SaleReturnItem[]; exchanges: SaleReturnExchange[]} | null =
        null;
      if (record.return_kind != null) {
        const rec = await SaleRepo.returnByNumber(record.invoice_number);
        if (rec != null) {
          ret = {
            ret: rec,
            lines: await SaleRepo.returnItems(rec.id),
            exchanges: await SaleRepo.returnExchanges(rec.id),
          };
        }
      }
      setSale(record);
      setItems(lines);
      setNames(nameMap);
      setDebt(silaRow);
      setLocalCreditor(
        localRow ? {name: localRow.name, phone: localRow.phone} : null,
      );
      setReturns(returnsForInvoice);
      setRetContext(ret);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'فشل تحميل الفاتورة', 'error');
    } finally {
      setLoading(false);
    }
  }, [saleId, toast]);

  useEffect(() => {
    void load();
  }, [load, reloadSignal]);

  const reprint = useCallback(async () => {
    if (sale == null || reprinting) {
      return;
    }
    setReprinting(true);
    try {
      await InvoiceService.reprintInvoice(saleId, receiptSettings);
      toast('أُعيدت طباعة الفاتورة', 'success');
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'فشلت إعادة الطباعة',
        'error',
      );
    } finally {
      setReprinting(false);
    }
  }, [sale, reprinting, saleId, receiptSettings, toast]);

  /** إعادة طباعة إشعار مرتجع محدد صادر عن هذه الفاتورة (قالب RET). */
  const reprintReturn = useCallback(
    async (ret: SaleReturnRecord) => {
      if (retPrintId != null) {
        return;
      }
      setRetPrintId(ret.id);
      try {
        const full = await SaleRepo.returnByNumber(ret.return_number);
        if (full == null) {
          throw new Error('سجل المرتجع غير موجود');
        }
        const retItems = await SaleRepo.returnItems(full.id);
        const exchanges = await SaleRepo.returnExchanges(full.id);
        const job = buildReturnReceiptJob(
          {ret: full, items: retItems, exchanges},
          receiptSettings,
        );
        await ThermalPrinterService.printJob(job, 'receipt');
        toast(`طُبع إشعار ${ret.return_number}`, 'success');
      } catch (e) {
        toast(
          e instanceof Error ? e.message : 'فشلت إعادة الطباعة',
          'error',
        );
      } finally {
        setRetPrintId(null);
      }
    },
    [retPrintId, receiptSettings, toast],
  );

  if (loading) {
    return (
      <div className="overlay">
        <div className="modal ih-modal-lg">
          <div className="modal-head">
            <b>تفاصيل الفاتورة</b>
            <button className="btn sm ghost" onClick={onClose}>
              إغلاق
            </button>
          </div>
          <div className="modal-body">
            <div className="ih-empty-sm">جارٍ تحميل الفاتورة…</div>
          </div>
        </div>
      </div>
    );
  }

  if (sale == null) {
    return (
      <div className="overlay">
        <div className="modal ih-modal-lg">
          <div className="modal-head">
            <b>تفاصيل الفاتورة</b>
            <button className="btn sm ghost" onClick={onClose}>
              إغلاق
            </button>
          </div>
          <div className="modal-body">
            <div className="ih-empty-sm">
              الفاتورة غير موجودة — ربما حُذفت من قاعدة البيانات
            </div>
          </div>
        </div>
      </div>
    );
  }

  const subtotal = sale.total_amount + sale.discount;
  const totalMinor = Math.round(sale.total_amount * 100);
  const returnedSoFar =
    returns.reduce((sum, r) => sum + r.refund_minor, 0) ?? 0;
  // v26 (round-34 #2): سماح أغورا واحد — تقريب pro-rata قد يترك
  // الفارق ±1 فلا يختفي الزر من فاتورة مُرجعة كلياً.
  const canReturn =
    sale.return_kind == null &&
    !sale.invoice_number.startsWith('INV-V-') &&
    !sale.invoice_number.startsWith('RET-') &&
    totalMinor - returnedSoFar > 1;

  const shownLines: {
    name: string;
    unit: string | null;
    variant: string | null;
    qty: number;
    price: number;
    total: number;
  }[] = retContext
    ? [
        ...retContext.lines.map(line => ({
          name: line.product_name,
          unit: line.unit_name,
          variant: null,
          qty: line.quantity,
          price: line.unit_price,
          total: line.line_total,
        })),
        ...retContext.exchanges.map(ex => ({
          name: `${ex.product_name} (بديل استبدال)`,
          unit: ex.unit_name,
          variant: ex.variant_label,
          qty: ex.quantity,
          price: ex.unit_price,
          total: ex.line_total,
        })),
      ]
    : items.map(item => ({
        name: names.get(item.product_id) ?? `#${item.product_id}`,
        unit: item.unit_name,
        variant: item.variant_label ?? null,
        qty: item.quantity,
        price: item.unit_price,
        total: item.total_line_price,
      }));

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal ih-modal-lg">
        <div className="modal-head">
          <span className="ih-meta-row">
            <b className="ih-ref">{sale.invoice_number}</b>
            <span className={`chip ${sale.payment_type === 'WHOLESALE' ? 'brand' : 'muted'}`}>
              {sale.payment_type === 'WHOLESALE' ? 'جملة' : 'مفرق'}
            </span>
            {retContext != null && <span className="chip warn">مرتجع</span>}
            {returnedSoFar > 0 && (
              <span className="chip warn">
                منها مرتجع {formatMoney(returnedSoFar / 100)}
              </span>
            )}
          </span>
          <span style={{display: 'flex', gap: 8}}>
            {canReturn && (
              <button className="btn sm" onClick={onReturn}>
                <Icon name="undo" size={14} />
                إرجاع/استبدال
              </button>
            )}
            <button
              className="btn sm"
              onClick={() => void reprint()}
              disabled={reprinting}>
              <Icon name="printer" size={14} />
              {reprinting ? 'جارٍ الطباعة…' : 'إعادة الطباعة'}
            </button>
            <button className="btn sm ghost" onClick={onClose}>
              إغلاق
            </button>
          </span>
        </div>
        <div className="modal-body">
          <div className="ih-hint">
            {formatDateTime(sale.created_at)} · {shownLines.length} سطر
            {sale.discount > 0 && ` · خصم ${formatMoney(sale.discount)}`}
          </div>

          {/* دفتر الفاتورة — هوية الدائن (صِلة أو الدفتر المحلي) */}
          {debt != null && (
            <div className="ih-creditor">
              🔗 دين صِلة على «{debt.customer_name ?? 'زبون صِلة'}» —
              {formatMoney(debt.amount_minor / 100)}
              {debt.reference_code != null && ` · مرجع ${debt.reference_code}`}
              {' · '}
              {debt.state === 'synced'
                ? 'مُتزامن مع الخادم'
                : debt.state === 'syncing'
                ? 'قيد الرفع الآن'
                : 'بانتظار المزامنة'}
            </div>
          )}
          {debt == null && localCreditor != null && (
            <div className="ih-creditor">
              📒 دين دفتر المتجر على «{localCreditor.name}»
              {localCreditor.phone
                ? ` · ${localCreditor.phone.replace(/\D/g, '').slice(-4)}`
                : ''}
            </div>
          )}

          {/* أسطر الفاتورة / المرتجع */}
          <table className="ih-items-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th className="num">الكمية</th>
                <th className="num">سعر الوحدة</th>
                <th className="num">إجمالي السطر</th>
              </tr>
            </thead>
            <tbody>
              {shownLines.map((line, i) => (
                <tr key={i}>
                  <td>
                    <span className="ih-item-name">{line.name}</span>
                    {line.variant && (
                      <span className="ih-item-variant"> ({line.variant})</span>
                    )}
                    {line.unit && line.unit !== 'قطعة' && (
                      <span className="ih-item-unit"> · {line.unit}</span>
                    )}
                  </td>
                  <td className="num">{formatQty(line.qty)}</td>
                  <td className="num">{formatMoney(line.price)}</td>
                  <td className="num">
                    <b>{formatMoney(line.total)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* المجاميع */}
          <div className="ih-totals">
            <div className="ih-total-row">
              <span>المجموع قبل الخصم</span>
              <b>{formatMoney(subtotal)}</b>
            </div>
            {sale.discount > 0 && (
              <div className="ih-total-row danger">
                <span>الخصم</span>
                <b>− {formatMoney(sale.discount)}</b>
              </div>
            )}
            {returnedSoFar > 0 && (
              <div className="ih-total-row warn">
                <span>مرتجعات منها</span>
                <b>− {formatMoney(returnedSoFar / 100)}</b>
              </div>
            )}
            <div className="ih-total-final">
              <span>
                {returnedSoFar > 0 ? 'الصافي بعد المرتجعات' : 'الإجمالي'}
              </span>
              <b>{formatMoney(sale.total_amount - returnedSoFar / 100)}</b>
            </div>
          </div>

          {/* إشعارات RET- الصادرة عن هذه الفاتورة */}
          {returns.length > 0 && (
            <>
              <div className="ih-section-head" style={{margin: '4px 0 0'}}>
                <b>مرتجعات هذه الفاتورة ({returns.length})</b>
              </div>
              {returns.map(ret => (
                <div key={ret.id} className="ih-ret-row">
                  <span className="chip warn">
                    {ret.book === 'sila'
                      ? 'دين صِلة'
                      : ret.book === 'local'
                      ? 'دين متجر'
                      : ret.book === 'online'
                      ? 'طلب أونلاين'
                      : 'نقدي'}
                  </span>
                  <div className="ih-ret-main">
                    <b className="ih-ref num" style={{fontSize: 12}}>
                      {ret.return_number}
                    </b>
                    <div className="ih-mut">
                      {formatDateTime(ret.created_at)} · قيمة مرتجعة{' '}
                      {formatMoney(ret.refund_minor / 100)}
                      {ret.debt_adjusted_minor > 0 &&
                        ` · خُصم من الدين ${formatMoney(
                          ret.debt_adjusted_minor / 100,
                        )}`}
                      {ret.is_exchange === 1 && ' · استبدال ببضاعة'}
                    </div>
                  </div>
                  <button
                    className="btn sm ghost"
                    title={`إعادة طباعة ${ret.return_number}`}
                    disabled={retPrintId === ret.id}
                    onClick={() => void reprintReturn(ret)}>
                    {retPrintId === ret.id ? (
                      '…'
                    ) : (
                      <Icon name="printer" size={15} />
                    )}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="modal-foot">
          {canReturn && (
            <button className="btn" onClick={onReturn}>
              <Icon name="undo" size={15} />
              إرجاع/استبدال
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => void reprint()}
            disabled={reprinting}>
            {reprinting ? 'جارٍ الطباعة…' : 'إعادة الطباعة'}
          </button>
          <button className="btn primary" onClick={onClose}>
            تم
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// محرك الإرجاع/الاستبدال — prepareReturn → كميات → createReturn
// ══════════════════════════════════════════════════════════════════
function ReturnModal({
  saleId,
  receiptSettings,
  printerConnected,
  onClose,
  onDone,
}: {
  saleId: number;
  receiptSettings: ReceiptSettings;
  printerConnected: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToastStore(s => s.show);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // سياق prepareReturn.
  const [lines, setLines] = useState<
    {item: SaleItemRecord; productName: string; remaining: number}[]
  >([]);
  const [book, setBook] = useState<ReturnBook>('cash');
  const [ratio, setRatio] = useState(1);
  const [debtLabel, setDebtLabel] = useState<string | null>(null);
  const [debtState, setDebtState] = useState<{
    kind: string;
    amountMinor?: number;
    status?: string;
    reason?: string;
  }>({kind: 'none'});

  // الكميات المختارة (مفتاحها معرّف سطر الفاتورة الأصلي) — ونصها
  // الخام كي لا يُقطع إدخال الكسور أثناء الكتابة (0.5 …).
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [qtyTexts, setQtyTexts] = useState<Record<number, string>>({});
  // الفواتير النقدية تختار طريقة الاسترداد؛ فواتير الدين تخصم الدين
  // دائماً (البضاعة تعود والزبون عليه أقل).
  const [refundMethod, setRefundMethod] = useState<'cash' | 'none'>('cash');
  // الاستبدال: بضاعة بديلة تخرج من المخزون بدل الإرجاع المالي،
  // والفرق يُسوّى نقداً أو ديناً (v40).
  const [picks, setPicks] = useState<ExchangePick[]>([]);
  const [exchangeOpen, setExchangeOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setQuantities({});
    setQtyTexts({});
    setRefundMethod('cash');
    setPicks([]);
    setExchangeOpen(false);
    InvoiceService.prepareReturn(saleId)
      .then(prep => {
        if (!mounted) {
          return;
        }
        setLines(prep.lines);
        setBook(prep.book);
        setRatio(prep.discountRatio);
        setDebtLabel(prep.debtLabel);
        setDebtState(prep.debtState);
      })
      .catch(e => {
        if (mounted) {
          setError(
            e instanceof Error ? e.message : 'تعذر تحضير الإرجاع',
          );
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [saleId]);

  const setQty = useCallback(
    (saleItemId: number, qty: number, remaining: number) => {
      const clamped = Math.min(Math.max(qty, 0), remaining);
      setQuantities(prev => ({...prev, [saleItemId]: clamped}));
      setQtyTexts(prev => ({...prev, [saleItemId]: formatQty(clamped)}));
    },
    [],
  );

  // المجموع الحي (pro-rata لخصم الفاتورة) + قيم الاستبدال والفرق.
  const refundTotal = lines.reduce((sum, line) => {
    const qty = quantities[line.item.id] ?? 0;
    return sum + line.item.unit_price * qty * ratio;
  }, 0);
  const pickedCount = lines.filter(
    line => (quantities[line.item.id] ?? 0) > 0,
  ).length;
  const exchangeTotal = picks.reduce(
    (sum, pick) => sum + pick.unitPrice * pick.quantity,
    0,
  );
  const exchangeModeOn = picks.length > 0;
  const exchangeDiff = refundTotal - exchangeTotal;

  const confirm = useCallback(async () => {
    if (busy || refundTotal <= 0 || pickedCount === 0) {
      return;
    }
    // حارسا الاستبدال: قيمة صالحة، ودين محلي مفقود لا يمكن زيادته
    // تلقائياً (الزيادة على دين مسدَّد محذوف تحتاج معرفة الزبون).
    if (exchangeModeOn) {
      if (exchangeTotal <= 0) {
        toast('قيمة الاستبدال غير صالحة — راجع الأصناف البديلة', 'error');
        return;
      }
      if (
        exchangeDiff < -0.0001 &&
        book === 'local' &&
        debtState.kind === 'missing'
      ) {
        toast(
          'دين هذه الفاتورة مسدَّد ومحذوف من الدفتر — لا يمكن زيادة دين غير موجود تلقائياً؛ سجّل الفرق يدوياً من دفتر الزبائن أو أرجع مالياً وبِع البدائل',
          'error',
          7000,
        );
        return;
      }
    }
    // تحذيرا الحواف الحرجة (سجل دين مفقود/مُرحّل) — توست لحظة
    // التأكيد كي لا يفاجأ التاجر بدين لم يُخصم تلقائياً.
    if (book !== 'cash' && !exchangeModeOn) {
      if (debtState.kind === 'missing') {
        toast(
          'تنبيه: سجل الدين غير موجود — لن يُخصم شيء تلقائياً، راجع الدفتر يدوياً',
          'info',
          6000,
        );
      } else if (debtState.kind === 'migrated') {
        toast(
          'تنبيه: هذا الدين مُرحّل إلى صِلة — عالج خصم المرتجع في دفتر صِلة يدوياً',
          'info',
          6000,
        );
      }
    }
    setBusy(true);
    try {
      const payload: ReturnLineInput[] = lines
        .filter(line => (quantities[line.item.id] ?? 0) > 0)
        .map(line => ({
          saleItemId: line.item.id,
          productId: line.item.product_id,
          productName: line.productName,
          quantity: quantities[line.item.id] ?? 0,
          unitName: line.item.unit_name,
          basePerUnit:
            line.item.quantity > 0
              ? (line.item.base_quantity ?? line.item.quantity) /
                line.item.quantity
              : 1,
          unitPrice: line.item.unit_price,
          costPrice: line.item.cost_price,
          variantId: line.item.variant_id ?? null,
          variantColor: line.item.variant_color ?? null,
          variantLabel: line.item.variant_label ?? null,
        }));
      const exchangePayload: ExchangeLineInput[] | undefined =
        picks.length > 0
          ? picks.map(pick => ({
              productId: pick.productId,
              productName: pick.name,
              quantity: pick.quantity,
              unitName: pick.unitName,
              basePerUnit: pick.basePerUnit,
              unitPrice: pick.unitPrice,
              costPrice: pick.costPrice,
              variantId: pick.variantId ?? null,
              variantColor: pick.variantColor ?? null,
              variantLabel: pick.variantLabel ?? null,
            }))
          : undefined;
      await InvoiceService.createReturn({
        saleId,
        lines: payload,
        refundMethod: book === 'cash' ? refundMethod : 'none',
        note: null,
        print: printerConnected,
        receiptSettings,
        onPrintError: message => {
          toast(`سُجّل المرتجع لكن الطباعة فشلت: ${message}`, 'error', 6000);
        },
        exchange: exchangePayload,
      });
      // رسالة النجاح تشرح تسوية الفرق بالضبط — ماذا حدث للفرق
      // (نقد خارج/داخل، خصم/زيادة دين، أو استبدال متكافئ).
      toast(
        exchangePayload != null
          ? exchangeDiff > 0.0001
            ? book === 'cash'
              ? `سُجّل الاستبدال — سلّم الزبون الفرق ${formatMoney(exchangeDiff)} نقداً من الخزينة`
              : `سُجّل الاستبدال — خُصم الفرق ${formatMoney(exchangeDiff)} من دين الزبون`
            : exchangeDiff < -0.0001
            ? book === 'cash'
              ? `سُجّل الاستبدال — اقبض الفرق ${formatMoney(-exchangeDiff)} نقداً من الزبون إلى الخزينة`
              : `سُجّل الاستبدال — زاد دين الزبون بالفرق ${formatMoney(-exchangeDiff)}`
            : 'سُجّل الاستبدال المتكافئ — المرتجع عاد والبديل خرج ولا فرق'
          : 'سُجّل المرتجع وأُعيدت الكميات للمخزون',
        'success',
        6000,
      );
      onDone();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'فشل تسجيل المرتجع',
        'error',
        6000,
      );
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    refundTotal,
    pickedCount,
    exchangeModeOn,
    exchangeTotal,
    exchangeDiff,
    lines,
    quantities,
    book,
    refundMethod,
    debtState,
    picks,
    saleId,
    printerConnected,
    receiptSettings,
    toast,
    onDone,
  ]);

  const blocked = debtState.kind === 'blocked';

  // v61 (الجولة 26 #6): Enter يؤكد الإرجاع/الاستبدال مباشرة بنفس
  // حراس زر التأكيد — معطّل أثناء نافذة اختيار البدائل المفتوحة.
  useEnterConfirm({
    active: !loading && error == null && !exchangeOpen,
    onConfirm: () => void confirm(),
    enabled: () => !busy && !blocked && refundTotal > 0 && pickedCount > 0,
  });

  return (
    <>
      <div
        className="overlay"
        style={{zIndex: 70}}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{width: 'min(720px, 94vw)'}}>
          <div className="modal-head">
            <span className="ih-meta-row">
              <b>إرجاع / استبدال</b>
              <span className="chip warn">
                {book === 'cash'
                  ? 'نقدية'
                  : book === 'sila'
                  ? 'دين صِلة'
                  : book === 'local'
                  ? 'دين متجر'
                  : 'طلب أونلاين'}
              </span>
            </span>
            <button className="btn sm ghost" onClick={onClose} disabled={busy}>
              إغلاق
            </button>
          </div>
          <div className="modal-body">
            {loading ? (
              <div className="ih-empty-sm">جارٍ تحضير الإرجاع…</div>
            ) : error != null ? (
              <div className="ih-warnbox">
                <Icon name="alert" size={16} /> {error}
              </div>
            ) : (
              <>
                {/* سياق الدفتر — ماذا سيحدث للقيمة عند التنفيذ */}
                <div className="ih-infobox">
                  {book === 'cash' &&
                    'فاتورة نقدية — قيمة المرتجع تُسترد للزبون (أو تُسلَّم فرقاً عند الاستبدال) حسب طريقة الاسترداد بالأسفل.'}
                  {book === 'sila' &&
                    debtState.kind === 'sila-synced' &&
                    `دين صِلة مُتزامن على «${debtLabel ?? 'زبون صِلة'}» — قيمة المرتجع تُخصم من دينه ويُرفع العكس للخادم فوراً.`}
                  {book === 'sila' &&
                    debtState.kind === 'sila-pending' &&
                    `دين صِلة بانتظار المزامنة على «${debtLabel ?? 'زبون صِلة'}» — يُخصم من صف الدين محلياً الآن.`}
                  {book === 'local' &&
                    `دين دفتر المتجر على «${debtLabel ?? 'زبون الدفتر'}» — قيمة المرتجع تُخصم من صف الدفتر.`}
                  {book === 'online' &&
                    debtState.status === 'sent' &&
                    'طلب أونلاين مُرسل لم يُسلَّم بعد — المرتجع ينقص الدين المؤقت فقط.'}
                  {book === 'online' &&
                    debtState.status !== 'sent' &&
                    'طلب أونلاين مسلَّم — المبلغ دخل الخزينة بسند تحصيل، فالمرتجع استرداد نقدي منها.'}
                </div>
                {blocked && (
                  <div className="ih-warnbox">
                    <Icon name="alert" size={16} />{' '}
                    {debtState.reason ?? 'الحالة لا تسمح بالإرجاع الآن'}
                  </div>
                )}

                {/* أسطر الفاتورة — عدّاد لكل صنف بحدّ المتبقي */}
                <div className="ih-ret-lines">
                  {lines.map(line => {
                    const qty = quantities[line.item.id] ?? 0;
                    const step = stepFor(line.remaining);
                    const lineValue = line.item.unit_price * qty * ratio;
                    return (
                      <div key={line.item.id} className="ih-ret-line">
                        <div className="ih-ret-line-main">
                          <div className="ih-ret-line-name">
                            {line.productName}
                            {line.item.unit_name &&
                            line.item.unit_name !== 'قطعة'
                              ? ` (${line.item.unit_name})`
                              : ''}
                          </div>
                          <div className="ih-ret-line-meta">
                            المتبقي قابل للإرجاع: {formatQty(line.remaining)} ·{' '}
                            {formatMoney(line.item.unit_price)} للوحدة
                          </div>
                          {qty > 0 && (
                            <div className="ih-ret-line-value">
                              قيمة الإرجاع: {formatMoney(lineValue)}
                            </div>
                          )}
                        </div>
                        <div className="ih-step">
                          <button
                            onClick={() =>
                              setQty(line.item.id, qty - step, line.remaining)
                            }
                            disabled={busy || qty <= 0}>
                            −
                          </button>
                          <input
                            className="qty-input"
                            dir="ltr"
                            inputMode="decimal"
                            value={qtyTexts[line.item.id] ?? '0'}
                            onChange={e => {
                              const raw = e.target.value;
                              setQtyTexts(prev => ({
                                ...prev,
                                [line.item.id]: raw,
                              }));
                              const parsed = parseNumber(raw);
                              if (!Number.isNaN(parsed)) {
                                setQty(line.item.id, parsed, line.remaining);
                              }
                            }}
                          />
                          <button
                            onClick={() =>
                              setQty(line.item.id, qty + step, line.remaining)
                            }
                            disabled={busy || qty >= line.remaining}>
                            +
                          </button>
                          <button
                            className="all-btn"
                            onClick={() =>
                              setQty(line.item.id, line.remaining, line.remaining)
                            }
                            disabled={busy || qty >= line.remaining}>
                            الكل
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* أصناف الاستبدال البديلة */}
                {exchangeModeOn && (
                  <div className="ih-exchange-list">
                    <div className="ih-exchange-title">
                      أصناف الاستبدال البديلة ({picks.length}) — بقيمة{' '}
                      {formatMoney(exchangeTotal)}
                    </div>
                    {picks.map(pick => (
                      <div key={pick.key} className="ih-exchange-row">
                        <div className="main">
                          <div className="name">
                            {pick.name}
                            {pick.variantLabel ? ` (${pick.variantLabel})` : ''}
                            {pick.unitName && pick.unitName !== 'قطعة'
                              ? ` · ${pick.unitName}`
                              : ''}
                          </div>
                          <div className="meta">
                            {formatQty(pick.quantity)} ×{' '}
                            {formatMoney(pick.unitPrice)} ={' '}
                            {formatMoney(pick.unitPrice * pick.quantity)}
                          </div>
                        </div>
                        <button
                          className="ih-x-btn"
                          disabled={busy}
                          onClick={() =>
                            setPicks(prev => prev.filter(x => x.key !== pick.key))
                          }>
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="ih-link-btn"
                      disabled={busy}
                      onClick={() => setPicks([])}>
                      إلغاء الاستبدال — العودة للإرجاع المالي
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* التذييل: الاسترداد + القيم الحية + الفرق */}
          {!loading && error == null && (
            <div className="modal-foot" style={{flexWrap: 'wrap'}}>
              <div style={{display: 'flex', flexDirection: 'column', gap: 10, flex: 1}}>
                {book === 'cash' && !exchangeModeOn && (
                  <div className="ih-method-row">
                    <button
                      className={`ih-method-chip ${refundMethod === 'cash' ? 'on' : ''}`}
                      onClick={() => setRefundMethod('cash')}
                      disabled={busy}>
                      استرداد نقدي للزبون
                    </button>
                    <button
                      className={`ih-method-chip ${refundMethod === 'none' ? 'on' : ''}`}
                      onClick={() => setRefundMethod('none')}
                      disabled={busy}>
                      إرجاع بلا استرداد نقدي
                    </button>
                  </div>
                )}
                <div className="ih-values-pair">
                  {exchangeModeOn ? (
                    <>
                      <div className="ih-value-half">
                        <span className="lbl">
                          المرتجع ({pickedCount} صنف)
                        </span>
                        <span className="amt">{formatMoney(refundTotal)}</span>
                      </div>
                      <div className="ih-value-half accent">
                        <span className="lbl accent">
                          المستبدل ({picks.length} صنف)
                        </span>
                        <span className="amt accent">
                          {formatMoney(exchangeTotal)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="ih-value-half">
                      <span className="lbl">
                        إجمالي قيمة المرتجع ({pickedCount} صنف)
                      </span>
                      <span className="amt">{formatMoney(refundTotal)}</span>
                    </div>
                  )}
                </div>
                {exchangeModeOn && (
                  <div
                    className={`ih-diff-strip ${
                      exchangeDiff > 0.0001
                        ? 'pos'
                        : exchangeDiff < -0.0001
                        ? 'neg'
                        : ''
                    }`}>
                    {Math.abs(exchangeDiff) < 0.0001
                      ? 'استبدال متكافئ — لا فرق'
                      : exchangeDiff > 0
                      ? `الفرق ${formatMoney(exchangeDiff)} — ${
                          book === 'cash'
                            ? 'سلّمه نقداً من الخزينة'
                            : debtState.kind === 'migrated'
                            ? 'دين مُرحّل لصِلة — عالجه يدوياً'
                            : 'يُخصم من دين الزبون'
                        }`
                      : `الفرق ${formatMoney(-exchangeDiff)} — ${
                          book === 'cash'
                            ? 'اقبضه نقداً من الزبون'
                            : debtState.kind === 'migrated' ||
                              debtState.kind === 'missing'
                            ? 'دين غير قابل للزيادة هنا — عالجه يدوياً'
                            : 'يُضاف إلى دين الزبون'
                        }`}
                  </div>
                )}
              </div>
              <span style={{display: 'flex', gap: 8, alignItems: 'flex-end'}}>
                <button
                  className="btn"
                  disabled={busy || lines.length === 0}
                  onClick={() => {
                    if (pickedCount === 0) {
                      toast(
                        'اختر كميات المرتجع أولاً — الاستبدال يقابل قيمة ما تُرجعه',
                        'info',
                        5000,
                      );
                    }
                    setExchangeOpen(true);
                  }}>
                  {exchangeModeOn
                    ? `⇄ الاستبدال (${picks.length})`
                    : '⇄ استبدال'}
                </button>
                <button
                  className="btn primary"
                  disabled={
                    busy ||
                    blocked ||
                    refundTotal <= 0 ||
                    pickedCount === 0
                  }
                  onClick={() => void confirm()}>
                  {busy
                    ? 'جارٍ التسجيل…'
                    : exchangeModeOn
                    ? 'تأكيد الاستبدال'
                    : 'تأكيد الإرجاع'}
                </button>
              </span>
            </div>
          )}
          {!loading && error == null && !printerConnected && (
            <div className="ih-hint" style={{padding: '0 20px 14px'}}>
              لا طابعة متصلة — سيُسجّل المرتجع دون طباعة إشعار (يمكن طباعته
              لاحقاً من تفاصيل الفاتورة)
            </div>
          )}
        </div>
      </div>

      {/* نافذة اختيار البدائل — طبقة فوق نافذة الإرجاع */}
      {exchangeOpen && (
        <ExchangeModal
          refundTotal={refundTotal}
          picks={picks}
          onAdd={pick => {
            setPicks(prev => {
              const existing = prev.find(x => x.key === pick.key);
              if (existing != null) {
                return prev.map(x => (x.key === pick.key ? {...x, ...pick} : x));
              }
              return [...prev, pick];
            });
          }}
          onRemove={key => setPicks(prev => prev.filter(x => x.key !== key))}
          onClear={() => setPicks([])}
          onClose={() => setExchangeOpen(false)}
        />
      )}
    </>
  );
}

/** صنف استبدال مختار (قبل التنفيذ) — نفس شكل الأندرويد v36. */
interface ExchangePick {
  /** مفتاح فريد: منتج:وحدة:متغير. */
  key: string;
  productId: number;
  name: string;
  quantity: number;
  unitName: string | null;
  basePerUnit: number;
  unitPrice: number;
  costPrice: number;
  variantId?: number | null;
  variantColor?: string | null;
  variantLabel?: string | null;
}

// ══════════════════════════════════════════════════════════════════
// نافذة الاستبدال — بحث + وحدات + متغيرات + خصم المنتج
// ══════════════════════════════════════════════════════════════════
function ExchangeModal({
  refundTotal,
  picks,
  onAdd,
  onRemove,
  onClear,
  onClose,
}: {
  refundTotal: number;
  picks: ExchangePick[];
  onAdd: (pick: ExchangePick) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const toast = useToastStore(s => s.show);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  // الخيارات الحية للمنتج المفتوح.
  const [openId, setOpenId] = useState<number | null>(null);
  const [openUnits, setOpenUnits] = useState<ProductUnit[]>([]);
  const [openVariants, setOpenVariants] = useState<ProductVariant[]>([]);
  const [chosenUnitId, setChosenUnitId] = useState<number | null>(null);
  const [chosenVariantId, setChosenVariantId] = useState<number | null>(null);
  const [qtyText, setQtyText] = useState('1');

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const rows = await ProductRepo.list({
        search: q.trim().length > 0 ? q.trim() : undefined,
        archival: 'active',
      });
      setResults(rows.slice(0, 80));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => void load(search), 250);
    return () => clearTimeout(timer);
  }, [search, load]);

  /** فتح منتج بخياراته — الوحدات والمتغيرات ثم الاختيار الافتراضي. */
  const openProduct = useCallback(
    async (productId: number) => {
      const product =
        results.find(x => x.id === productId) ??
        (await ProductRepo.getById(productId));
      if (product == null) {
        toast('المنتج غير موجود', 'error');
        return;
      }
      const units = await UnitRepo.listForProduct(productId);
      const variants = await VariantRepo.listByProduct(productId);
      setOpenId(productId);
      setOpenUnits(units);
      setOpenVariants(variants);
      // الوحدة الافتراضية = وحدة البيع الأساس (قطعة/شريط/حصة).
      setChosenUnitId(null);
      // المتغير الافتراضي = أول متغير متوفر منه مخزون.
      const inStock = variants.find(v => v.stock_quantity > 0);
      setChosenVariantId((inStock ?? variants[0] ?? null)?.id ?? null);
      setQtyText('1');
    },
    [results, toast],
  );

  const closeProduct = useCallback(() => {
    setOpenId(null);
    setChosenUnitId(null);
    setChosenVariantId(null);
    setQtyText('1');
  }, []);

  const openProductRow =
    results.find(x => x.id === openId) ?? null;
  const openUnit = openUnits.find(u => u.id === chosenUnitId) ?? null;
  const openVariant =
    openVariants.find(v => v.id === chosenVariantId) ?? null;

  // السعر الحي: متغير الحجم له سعره؛ وإلا سعر الوحدة (بما يعادلها
  // من سعر الأساس) أو سعر الأساس — كله بعد خصم المنتج (v53).
  const liveUnitPrice: number = (() => {
    if (openProductRow == null) {
      return 0;
    }
    if (openVariant != null && openVariant.retail_price != null) {
      return applyProductDiscount(openVariant.retail_price, openProductRow);
    }
    if (openUnit != null) {
      const override = openUnit.retail_price;
      if (override != null && override > 0) {
        return applyProductDiscount(override, openProductRow);
      }
      return applyProductDiscount(
        openProductRow.retail_price * openUnit.conversion,
        openProductRow,
      );
    }
    return applyProductDiscount(openProductRow.retail_price, openProductRow);
  })();
  const liveBeforeDiscount: number = (() => {
    if (openProductRow == null) {
      return 0;
    }
    if (openVariant != null && openVariant.retail_price != null) {
      return openVariant.retail_price;
    }
    if (openUnit != null) {
      const override = openUnit.retail_price;
      if (override != null && override > 0) {
        return override;
      }
      return openProductRow.retail_price * openUnit.conversion;
    }
    return openProductRow.retail_price;
  })();
  const liveDiscounted =
    openProductRow != null &&
    openProductRow.discount_pct > 0 &&
    liveUnitPrice < liveBeforeDiscount - 0.0001;
  const liveBasePerUnit = openUnit != null ? openUnit.conversion : 1;
  const liveCost: number = (() => {
    if (openProductRow == null) {
      return 0;
    }
    if (openVariant != null && openVariant.cost_price != null) {
      return openVariant.cost_price;
    }
    if (openUnit != null) {
      return openProductRow.cost_price * openUnit.conversion;
    }
    return openProductRow.cost_price;
  })();

  const qtyNum = parseNumber(qtyText);
  const qtyValid = !Number.isNaN(qtyNum) && qtyNum > 0;

  const addCurrent = useCallback(() => {
    if (openProductRow == null || !qtyValid) {
      return;
    }
    // حارس المخزون الصريح — متغير نافد أو كمية فوق المتوفر تُرفض
    // برسالة عربية واضحة (بلا تتبع يُتجاوز الحارس كعادته).
    const untracked = openProductRow.stock_untracked === 1;
    if (!untracked) {
      if (openVariant != null && openVariant.stock_quantity < qtyNum) {
        toast(
          `المتغير ${openVariant.color ? openVariant.color + ' ' : ''}${
            openVariant.size
          } المتوفر منه ${formatQty(openVariant.stock_quantity)} فقط — راجع الكمية`,
          'error',
        );
        return;
      }
      if (openVariant == null && openProductRow.stock_quantity < qtyNum) {
        toast(
          `المتوفر من ${openProductRow.name} ${formatQty(
            openProductRow.stock_quantity,
          )} فقط — راجع الكمية`,
          'error',
        );
        return;
      }
    }
    const label =
      openVariant != null
        ? `${openVariant.color ? openVariant.color + ' · ' : ''}${openVariant.size}`
        : null;
    const pick: ExchangePick = {
      key: `${openProductRow.id}:${chosenUnitId ?? 0}:${chosenVariantId ?? 0}`,
      productId: openProductRow.id,
      name: openProductRow.name,
      quantity: qtyNum,
      unitName: openUnit != null ? openUnit.unitName : null,
      basePerUnit: liveBasePerUnit,
      unitPrice: liveUnitPrice,
      costPrice: liveCost,
      variantId: chosenVariantId,
      variantColor: openVariant?.color ?? null,
      variantLabel: label,
    };
    onAdd(pick);
    toast(
      `أُضيف للاستبدال: ${pick.name}${label ? ` (${label})` : ''} — ${formatQty(
        qtyNum,
      )} × ${formatMoney(liveUnitPrice)}`,
      'success',
    );
    closeProduct();
  }, [
    openProductRow,
    openVariant,
    openUnit,
    chosenUnitId,
    chosenVariantId,
    qtyValid,
    qtyNum,
    liveUnitPrice,
    liveBasePerUnit,
    liveCost,
    onAdd,
    toast,
    closeProduct,
  ]);

  const picksTotal = picks.reduce(
    (sum, pick) => sum + pick.unitPrice * pick.quantity,
    0,
  );

  return (
    <div
      className="overlay"
      style={{zIndex: 80}}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{width: 'min(680px, 94vw)'}}>
        <div className="modal-head">
          <span className="ih-meta-row">
            <b>الاستبدال بقيمة المرجع</b>
            <span className="chip brand">
              المرجع {formatMoney(refundTotal)} · البدائل {formatMoney(picksTotal)}
            </span>
          </span>
          <button className="btn sm ghost" onClick={onClose}>
            تم
          </button>
        </div>
        <div className="modal-body">
          <input
            className="ih-search"
            placeholder="ابحث بالاسم عن البضاعة البديلة…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />

          {/* صندوق خيارات المنتج المفتوح */}
          {openProductRow != null && (
            <div className="ih-option-box">
              <div className="ih-ret-line-name">
                {openProductRow.name}
                {openProductRow.stock_untracked !== 1 &&
                  ` — متوفر ${formatQty(openProductRow.stock_quantity)}`}
              </div>
              {openUnits.length > 0 && (
                <div className="ih-chips-row">
                  <span className="ih-hint">الوحدة:</span>
                  <button
                    className={`ih-chiplet ${chosenUnitId == null ? 'on' : ''}`}
                    onClick={() => setChosenUnitId(null)}>
                    قطعة
                  </button>
                  {openUnits.map(u => (
                    <button
                      key={u.id}
                      className={`ih-chiplet ${chosenUnitId === u.id ? 'on' : ''}`}
                      onClick={() => setChosenUnitId(u.id)}>
                      {u.unitName} (×{formatQty(u.conversion)})
                    </button>
                  ))}
                </div>
              )}
              {openVariants.length > 0 && (
                <div className="ih-chips-row">
                  <span className="ih-hint">المتغير:</span>
                  {openVariants.map(v => (
                    <button
                      key={v.id}
                      className={`ih-chiplet ${chosenVariantId === v.id ? 'on' : ''}`}
                      disabled={v.stock_quantity <= 0}
                      onClick={() => setChosenVariantId(v.id)}>
                      {v.color ? `${v.color} · ` : ''}
                      {v.size}
                      {v.stock_quantity <= 0 ? ' (نفد)' : ''}
                    </button>
                  ))}
                </div>
              )}
              <div className="ih-chips-row">
                <span className="ih-hint">الكمية:</span>
                <input
                  className="ih-qty-input"
                  dir="ltr"
                  inputMode="decimal"
                  value={qtyText}
                  onChange={e => setQtyText(e.target.value)}
                  onKeyDown={e => {
                    // v61 (الجولة 26 #6): Enter يضيف البديل الحالي
                    // مباشرة من حقل الكمية.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (qtyValid) addCurrent();
                    }
                  }}
                />
              </div>
              <div className="ih-price-line">
                <span>
                  سعر الوحدة
                  {liveDiscounted && (
                    <span className="before">
                      {formatMoney(liveBeforeDiscount)}
                    </span>
                  )}
                  {liveDiscounted && (
                    <span className="chip danger" style={{marginInlineStart: 6}}>
                      −{Math.round(openProductRow.discount_pct)}%
                    </span>
                  )}
                </span>
                <b>{formatMoney(liveUnitPrice)}</b>
              </div>
              <div className="ih-price-line">
                <span>إجمالي السطر</span>
                <b>{formatMoney(liveUnitPrice * (qtyValid ? qtyNum : 0))}</b>
              </div>
              <div style={{display: 'flex', gap: 8}}>
                <button
                  className="btn primary"
                  disabled={!qtyValid}
                  onClick={addCurrent}>
                  أضف إلى الاستبدال
                </button>
                <button className="btn ghost" onClick={closeProduct}>
                  تراجع
                </button>
              </div>
            </div>
          )}

          {/* نتائج البحث */}
          {loading ? (
            <div className="ih-empty-sm">جارٍ البحث…</div>
          ) : (
            <div className="ih-picker-results">
              {results.length === 0 && (
                <div className="ih-empty-sm">
                  لا نتائج — جرّب اسمًا آخر أو جزءًا من الاسم
                </div>
              )}
              {results.map(product => (
                <div
                  key={product.id}
                  className="ih-picker-row"
                  onClick={() => void openProduct(product.id)}>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div className="name">{product.name}</div>
                    <div className="meta">
                      {product.discount_pct > 0 ? (
                        <>
                          <s style={{opacity: 0.6}}>
                            {formatMoney(product.retail_price)}
                          </s>{' '}
                          <b style={{color: 'var(--brand-ink)'}}>
                            {formatMoney(
                              applyProductDiscount(
                                product.retail_price,
                                product,
                              ),
                            )}
                          </b>{' '}
                          <span className="chip danger">
                            −{Math.round(product.discount_pct)}%
                          </span>
                        </>
                      ) : (
                        formatMoney(product.retail_price)
                      )}
                      {product.stock_untracked === 1
                        ? ' · بلا تتبع مخزون'
                        : ` · متوفر ${formatQty(product.stock_quantity)}`}
                    </div>
                  </div>
                  <span className="ih-mut">›</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {picks.length > 0 && (
          <div className="modal-foot">
            <span className="ih-hint" style={{flex: 1}}>
              {picks.length} بديل بقيمة {formatMoney(picksTotal)} — الفرق
              يُسوّى عند تأكيد الإرجاع (نقد أو دين)
            </span>
            <button className="btn danger" onClick={onClear}>
              إلغاء الاستبدال
            </button>
            <button className="btn primary" onClick={onClose}>
              تم — عودة للإرجاع
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
