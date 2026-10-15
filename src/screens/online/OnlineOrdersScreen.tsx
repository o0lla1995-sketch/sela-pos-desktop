/**
 * OnlineOrdersScreen.tsx — طلبات المتجر أونلاين (متجر سيلا ماركت) —
 * منقولة من OnlineOrdersScreen الأندرويد (الجولة 61) إلى سطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 * مركز متابعة طلبات متجر سيلا ماركت: قائمة بفلاتر الحالات كلها مع
 * شارات العدد، رأس «القائم غير المحصّل» (ordersSummary)، وكل طلب
 * يفتح نافذة تفاصيل فيها بيانات المستخدم (الاتصال بلمسة على رقمه)،
 * الأصناف، التوصيل، المجموع، والأفعال:
 * قبول / رفض بسبب / إرسال (فاتورة INV-O + خصم مخزون + مبيعات اليوم
 * + طباعة إيصال) / تأكيد التسليم (الدين → الخزينة بسند COLL) /
 * إلغاء (طلب قُبل ولم يُرسل) / تحديث فوري (pollOrders).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {OnlineRepo} from '../../database/repositories/OnlineRepo';
import {ProductRepo} from '../../database/repositories/ProductRepo';
import {useCatalogStore, useToastStore} from '../../state/appStores';
import {useSettingsStore} from '../../state/settingsStore';
import {
  acceptOrder,
  cancelOrder,
  deliverOrder,
  ensureEngineStarted,
  onlineErrorText,
  ordersSummary,
  pollOrders,
  rejectOrder,
  sendOrder,
} from '../../services/online/OnlineStoreService';
import {api} from '../../lib/tauri';
import {formatDateTime, formatMoney} from '../../core/format';
import {buildReceiptJob} from '../../services/printer/receipt';
import {printJob} from '../../printing/dispatch';
import type {
  OnlineOrder,
  OnlineOrderItem,
  OnlineOrderStatus,
} from '../../core/types';
import './online.css';

type FilterKey = OnlineOrderStatus | 'all';

/** الحالات التي تنتظر عملاً من التاجر — تُبرز شارة عددها بلون العلامة. */
const ACTIONABLE: FilterKey[] = ['new', 'accepted', 'sent'];

const FILTERS: {key: FilterKey; label: string}[] = [
  {key: 'all', label: 'الكل'},
  {key: 'new', label: 'جديد'},
  {key: 'accepted', label: 'مقبول'},
  {key: 'rejected', label: 'مرفوض'},
  {key: 'sent', label: 'مُرسل'},
  {key: 'delivered', label: 'مُسلَّم'},
  {key: 'cancelled', label: 'ملغي'},
  {key: 'returned', label: 'مرتجع'},
];

const STATUS_META: Record<OnlineOrderStatus, {label: string; cls: string}> = {
  new: {label: 'جديد', cls: 'olo-st-new'},
  accepted: {label: 'مقبول — بانتظار التجهيز', cls: 'olo-st-accepted'},
  rejected: {label: 'مرفوض', cls: 'olo-st-rejected'},
  sent: {label: 'مُرسل — دين حتى التسليم', cls: 'olo-st-sent'},
  delivered: {label: 'مُسلَّم — حُصّل', cls: 'olo-st-delivered'},
  cancelled: {label: 'ملغي', cls: 'olo-st-cancelled'},
  returned: {label: 'مُرجع', cls: 'olo-st-returned'},
};

interface Summary {
  newCount: number;
  outstandingMinor: number;
  outstandingCount: number;
}

export function OnlineOrdersScreen() {
  const toast = useToastStore(s => s.show);
  const products = useCatalogStore(s => s.products);
  const settings = useSettingsStore(s => s.settings);

  const [filter, setFilter] = useState<FilterKey>('new');
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [detail, setDetail] = useState<OnlineOrder | null>(null);
  const [detailItems, setDetailItems] = useState<OnlineOrderItem[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionPrompt, setActionPrompt] = useState<'reject' | 'cancel' | null>(
    null,
  );
  const [reason, setReason] = useState('');

  /* v57 (الجولة 61): نحمّل كل الطلبات دفعة واحدة — شارات العدد على كل
   * فلتر تحتاج عدّ الحالات كلها، والتصفية تجري محلياً فوراً. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await OnlineRepo.list('all'));
      setSummary(await ordersSummary());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    ensureEngineStarted();
    // تحديث تلقائي عند فتح الشاشة — بلا انتظار الدورة (60 ثانية).
    void pollOrders()
      .then(fresh => {
        if (fresh > 0) {
          toast(`وصل ${fresh} طلب جديد`, 'success');
        }
        return reload();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncNow = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await pollOrders();
      await reload();
      toast(
        fresh > 0
          ? `وصل ${fresh} طلب جديد`
          : 'لا طلبات جديدة — الطلبات محدّثة',
        'success',
      );
    } catch (error) {
      toast(onlineErrorText(error), 'error');
    } finally {
      setRefreshing(false);
    }
  }, [reload, toast]);

  const openDetail = useCallback(async (order: OnlineOrder) => {
    setDetail(order);
    setActionPrompt(null);
    setReason('');
    setDetailItems(await OnlineRepo.itemsFor(order.server_id));
  }, []);

  const runAction = useCallback(
    async (action: () => Promise<string | void>, tag: string) => {
      if (busyAction != null) {
        return;
      }
      setBusyAction(tag);
      try {
        const message = await action();
        if (typeof message === 'string' && message.length > 0) {
          toast(message, 'success');
        }
        setDetail(null);
        await reload();
      } catch (error) {
        toast(onlineErrorText(error), 'error');
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, reload, toast],
  );

  /** طباعة إيصال فاتورة INV-O بعد الإرسال — فشل الطباعة لا يمس
   *  الإرسال نفسه أبداً (الفاتورة محفوظة)، يعيد ملحق الرسالة فقط. */
  const printOrderInvoice = useCallback(
    async (orderNumber: string): Promise<string> => {
      try {
        const fresh = await OnlineRepo.byNumber(orderNumber);
        if (fresh?.sale_id == null) {
          return ' — تعذرت طباعة الإيصال (أعد طباعتها من مركز الفواتير)';
        }
        const sale = await api.getSale(fresh.sale_id);
        const names = new Map<number, string>();
        for (const item of sale.items) {
          if (names.has(item.product_id)) {
            continue;
          }
          const known = products.find(p => p.id === item.product_id);
          if (known != null) {
            names.set(item.product_id, known.name);
            continue;
          }
          // منتج نظامي (سطر التوصيل مؤرشف) — نجلب اسمه من المستودع.
          const fetched = await ProductRepo.getById(item.product_id);
          names.set(item.product_id, fetched?.name ?? `#${item.product_id}`);
        }
        await printJob(
          buildReceiptJob(
            {sale: sale.sale, items: sale.items, productNameById: names},
            {
              storeName: settings.storeName,
              storePhone: settings.storePhone,
              footerMessage: settings.footerMessage,
              paperWidth: settings.paperWidth,
              codepage: settings.codepage,
              showProfit: settings.showProfitOnReceipt,
              storeLogoPath: settings.storeLogoPath,
            },
          ),
        );
        return '';
      } catch (error) {
        return ` — تعذرت طباعة الإيصال (${onlineErrorText(error)})`;
      }
    },
    [products, settings],
  );

  const counts = useMemo(() => {
    const map = new Map<FilterKey, number>();
    for (const o of orders) {
      map.set(o.status, (map.get(o.status) ?? 0) + 1);
    }
    map.set('all', orders.length);
    return map;
  }, [orders]);

  const visible = useMemo(
    () => (filter === 'all' ? orders : orders.filter(o => o.status === filter)),
    [orders, filter],
  );

  return (
    <div className="screen">
      <h1>طلبات المتجر أونلاين</h1>
      <div className="subtitle">
        متجر سيلا ماركت — قبول، تجهيز بفاتورة INV-O، وتسليم بتحصيل نقدي
      </div>

      {/* رأس الملخص: القائم غير المحصّل + الطلبات الجديدة */}
      <div className="grid-4">
        <div className="card kpi">
          <span className="label">طلبات جديدة بانتظار قرارك</span>
          <span className="value brand">{summary?.newCount ?? 0}</span>
        </div>
        <div className="card kpi">
          <span className="label">مبلغ الطلبات غير المُحصَّل (دين)</span>
          <span className="value">
            {formatMoney((summary?.outstandingMinor ?? 0) / 100)}
          </span>
          <span className="label">طلبات مُرسلة — يُحصَّل عند التسليم</span>
        </div>
        <div className="card kpi">
          <span className="label">طلبات بانتظار التحصيل</span>
          <span className="value">{summary?.outstandingCount ?? 0}</span>
        </div>
        <div className="card kpi">
          <span className="label">إجمالي الطلبات المسجّلة</span>
          <span className="value">{orders.length}</span>
        </div>
      </div>

      {/* فلاتر الحالات + تحديث فوري */}
      <div className="toolbar" style={{margin: '16px 0 14px'}}>
        {FILTERS.map(f => {
          const n = counts.get(f.key) ?? 0;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              className={`chip-toggle olo-filter ${active ? 'on' : ''}`}
              onClick={() => setFilter(f.key)}>
              {f.label}
              {n > 0 && (
                <span className={`count ${ACTIONABLE.includes(f.key) ? 'alert' : ''}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
        <span className="grow" />
        <button
          className="btn primary"
          onClick={() => void syncNow()}
          disabled={refreshing}>
          {refreshing ? 'جارٍ التحديث…' : '⟳ تحديث الطلبات'}
        </button>
      </div>

      {loading ? (
        <div className="empty">
          <div className="icon">🛍️</div>
          جارٍ تحميل الطلبات…
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="icon">🛍️</div>
          <b>لا طلبات في هذه الحالة</b>
          <span>
            {orders.length > 0
              ? `لديك ${orders.length} طلباً في حالات أخرى — بدّل الفلتر أعلاه`
              : 'الطلبات الجديدة من تطبيق المتجر تصل هنا فوراً مع إشعار'}
          </span>
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>رقم الطلب</th>
              <th>الزبون</th>
              <th>الهاتف</th>
              <th>المنطقة</th>
              <th>الإجمالي</th>
              <th>التوصيل</th>
              <th>الحالة</th>
              <th>آخر تحديث</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map(order => {
              const meta = STATUS_META[order.status];
              return (
                <tr
                  key={order.order_number}
                  style={{cursor: 'pointer'}}
                  onClick={() => void openDetail(order)}>
                  <td dir="ltr">
                    <b>{order.order_number}</b>
                  </td>
                  <td>{order.customer_name || '—'}</td>
                  <td dir="ltr" style={{color: 'var(--ink-soft)'}}>
                    {order.customer_phone || '—'}
                  </td>
                  <td>{order.region_name ?? '—'}</td>
                  <td>
                    <b style={{color: 'var(--brand-ink)'}}>
                      {formatMoney(order.total_minor / 100)}
                    </b>
                  </td>
                  <td>
                    {order.delivery_fee_minor > 0
                      ? formatMoney(order.delivery_fee_minor / 100)
                      : '—'}
                  </td>
                  <td>
                    <span className={`olo-st ${meta.cls}`}>{meta.label}</span>
                    {order.status === 'new' && (
                      <div style={{marginTop: 4}}>
                        <span className="chip brand">بانتظار قرارك</span>
                      </div>
                    )}
                  </td>
                  <td title={formatDateTime(order.updated_at)}>
                    {formatDateTime(order.updated_at)}
                  </td>
                  <td className="row-actions" onClick={e => e.stopPropagation()}>
                    <button className="btn sm" onClick={() => void openDetail(order)}>
                      تفاصيل
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* تفاصيل الطلب — نافذة (نفس بطاقة الأندرويد INLINE) */}
      {detail != null && (
        <div
          className="overlay"
          onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <b dir="ltr">{detail.order_number}</b>
                <div className="olo-head-sub">
                  <span className={`olo-st ${STATUS_META[detail.status].cls}`}>
                    {STATUS_META[detail.status].label}
                  </span>
                  {detail.invoice_ref != null && (
                    <span>
                      فاتورة <b dir="ltr">{detail.invoice_ref}</b>
                    </span>
                  )}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {/* بيانات المستخدم */}
              <div className="olo-info-grid">
                <div>👤 {detail.customer_name}</div>
                <div>
                  <a href={`tel:${detail.customer_phone}`} dir="ltr">
                    📞 {detail.customer_phone}
                  </a>
                  <span style={{color: 'var(--muted)', fontSize: 11}}>
                    (اضغط للاتصال)
                  </span>
                </div>
                <div>🪪 هوية {detail.customer_id_number || '—'}</div>
                {detail.address != null && (
                  <div>
                    📍 {detail.address}
                    {detail.region_name ? ` — ${detail.region_name}` : ''}
                  </div>
                )}
              </div>
              {detail.note != null && detail.note.length > 0 && (
                <div className="olo-note">ملاحظة: {detail.note}</div>
              )}

              {/* الأصناف */}
              <table className="data">
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th>الكمية</th>
                    <th>سعر الوحدة</th>
                    <th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {detailItems.map(item => (
                    <tr key={`${item.product_ref}:${item.variant ?? ''}`}>
                      <td>
                        <b>{item.product_name}</b>
                        {item.variant != null && item.variant.length > 0 && (
                          <div className="olo-variant">{item.variant}</div>
                        )}
                      </td>
                      <td>{item.quantity}</td>
                      <td>{formatMoney(item.unit_price_minor / 100)}</td>
                      <td>
                        <b>{formatMoney(item.line_total_minor / 100)}</b>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>التوصيل ({detail.region_name ?? '—'})</td>
                    <td>1</td>
                    <td>—</td>
                    <td>{formatMoney(detail.delivery_fee_minor / 100)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="olo-totals">
                <div className="row">
                  <span>مجموع الأصناف</span>
                  <span>{formatMoney(detail.items_total_minor / 100)}</span>
                </div>
                <div className="row">
                  <span>التوصيل ({detail.region_name ?? '—'})</span>
                  <span>{formatMoney(detail.delivery_fee_minor / 100)}</span>
                </div>
                <div className="row grand">
                  <span>الإجمالي</span>
                  <b>{formatMoney(detail.total_minor / 100)}</b>
                </div>
                {detail.returned_minor > 0 && (
                  <div className="row returned">
                    <span>مرتجع منه</span>
                    <span>{formatMoney(detail.returned_minor / 100)}</span>
                  </div>
                )}
              </div>

              {/* الإجراءات حسب الحالة — نفس انتقالات الأندرويد */}
              <div className="olo-actions">
                {actionPrompt != null ? (
                  <div className="olo-reason-box">
                    <label style={{fontSize: 12.5, fontWeight: 700}}>
                      {actionPrompt === 'reject'
                        ? 'سبب الرفض (يظهر للمستخدم)'
                        : 'سبب الإلغاء (يظهر للمستخدم)'}
                    </label>
                    <textarea
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="اكتب السبب… (اختياري)"
                    />
                    <div style={{display: 'flex', gap: 8}}>
                      <button
                        className="btn danger"
                        disabled={busyAction != null}
                        onClick={() =>
                          void runAction(async () => {
                            if (actionPrompt === 'reject') {
                              await rejectOrder(
                                detail.order_number,
                                reason.trim() || 'غير متوفر حالياً',
                              );
                              return 'تم رفض الطلب وإبلاغ المستخدم';
                            }
                            await cancelOrder(
                              detail.order_number,
                              reason.trim() || 'غير متوفر حالياً',
                            );
                            return 'تم إلغاء الطلب وإبلاغ المستخدم';
                          }, actionPrompt)
                        }>
                        {actionPrompt === 'reject'
                          ? 'تأكيد الرفض'
                          : 'تأكيد الإلغاء'}
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => {
                          setActionPrompt(null);
                          setReason('');
                        }}>
                        رجوع
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {detail.status === 'new' && (
                      <button
                        className="btn primary"
                        disabled={busyAction != null}
                        onClick={() =>
                          void runAction(async () => {
                            await acceptOrder(detail.order_number);
                            return 'تم قبول الطلب — جهّزه ثم أرسله';
                          }, 'accept')
                        }>
                        قبول الطلب
                      </button>
                    )}
                    {(detail.status === 'new' ||
                      detail.status === 'accepted') && (
                      <>
                        <button
                          className="btn primary"
                          disabled={busyAction != null}
                          onClick={() =>
                            void runAction(async () => {
                              const invoice = await sendOrder(detail);
                              const printNote = await printOrderInvoice(
                                detail.order_number,
                              );
                              return `أُرسل الطلب بفاتورة ${invoice} — سُجّل في مبيعات اليوم والدين حتى التسليم${printNote}`;
                            }, 'send')
                          }>
                          {busyAction === 'send'
                            ? 'جارٍ التجهيز…'
                            : 'تجهيز وإرسال (فاتورة)'}
                        </button>
                        <button
                          className="btn danger"
                          disabled={busyAction != null}
                          onClick={() => setActionPrompt('reject')}>
                          رفض
                        </button>
                        {/* الإلغاء حيث يسمح الأندرويد: طلب قُبل ولم يُرسل */}
                        {detail.status === 'accepted' && (
                          <button
                            className="btn danger ghost"
                            disabled={busyAction != null}
                            onClick={() => setActionPrompt('cancel')}>
                            إلغاء
                          </button>
                        )}
                      </>
                    )}
                    {detail.status === 'sent' && (
                      <>
                        <button
                          className="btn primary"
                          disabled={busyAction != null}
                          onClick={() =>
                            void runAction(async () => {
                              await deliverOrder(detail);
                              return 'تم تأكيد التسليم — حُوّل المبلغ من الدين إلى الخزينة بسند تحصيل';
                            }, 'deliver')
                          }>
                          تأكيد التسليم (الدين → الخزينة)
                        </button>
                        <div className="olo-hint">
                          يُسجّل سند تحصيل بالمبلغ القائم ويُطبع من سجل
                          الخزينة — الإرجاع بعد التسليم يتم من مركز الفواتير
                          على فاتورة {detail.invoice_ref ?? 'INV-O'} كأي بيع
                          عادي.
                        </div>
                      </>
                    )}
                    {detail.status === 'delivered' ||
                    detail.status === 'returned' ? (
                      <div className="olo-hint">
                        {detail.invoice_ref != null
                          ? `الإرجاع/الاستبدال يتم من مركز الفواتير على فاتورة ${detail.invoice_ref} — مسار الإرجاع القياسي بكل مزاياه (كلي/جزئي/استبدال).`
                          : 'اكتملت دورة هذا الطلب.'}
                      </div>
                    ) : null}
                    {detail.status === 'rejected' ||
                    detail.status === 'cancelled' ? (
                      <div className="olo-hint">
                        {detail.status === 'rejected'
                          ? 'رُفض هذا الطلب.'
                          : 'أُلغي هذا الطلب.'}
                        {detail.status === 'rejected' &&
                        detail.reject_reason != null
                          ? ` السبب: ${detail.reject_reason}`
                          : ''}
                        {detail.status === 'cancelled' &&
                        detail.cancel_reason != null
                          ? ` السبب: ${detail.cancel_reason}`
                          : ''}
                      </div>
                    ) : null}
                    {busyAction != null && (
                      <span className="olo-busy">جارٍ التنفيذ…</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
