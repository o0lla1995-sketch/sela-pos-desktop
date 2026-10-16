/**
 * screens/NotificationsScreen.tsx — مركز الإشعارات v60 (تطوير كامل
 * بعد شكوى الجولة 25 #4: كانت قائمة خاماً بلا فلاتر ولا حذف فردي
 * ولا أي تنقل إلى مصدر الإشعار):
 *  • فلاتر تبويب بنظام chip-toggle الجديد: الكل / غير المقروء /
 *    مجموعات نوعية (المخزون والصلاحية، صِلة والقسائم، البيع
 *    والطلبات، النظام: نسخ/طابعة/اشتراك/جرد) مع عدّادات حيّة.
 *  • حذف إشعار واحد بزر × في الصف + مسح الكل كما كان.
 *  • الضغط على الإشعار يعلّمه مقروءاً **وينتقل إلى الشاشة المعنية**
 *    (نفاد المخزون ← تنبيهات المخزون، دين صِلة ← صِلة والقسائم،
 *    طلب أونلاين ← الطلبات، نسخ احتياطي ← الإعدادات…) — لم يعد
 *    التاجر يبحث بنفسه عن مصدر المشكلة.
 *  • صفوف بنظام v60: حافة نوع جانبية ملونة، خلفية مميزة لغير
 *    المقروء، رفع عند المرور، وزمن نسبي واضح.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {useNotificationsStore} from '../state/appStores';
import {relativeTime} from '../core/format';
import {Icon, type IconName} from '../components/Icon';
import type {NotificationKind} from '../core/types';
import './settingsv57.css';

/** رقائق النوع — تغطي كل أنواع NotificationKind في v58 (أيقونات SVG). */
const KIND_META: Record<
  NotificationKind,
  {label: string; chip: string; icon: IconName; tone: string}
> = {
  out_of_stock: {label: 'نفاد مخزون', chip: 'danger', icon: 'packageMinus', tone: 'danger'},
  low_stock: {label: 'مخزون منخفض', chip: 'warn', icon: 'packageMinus', tone: 'warn'},
  expiry: {label: 'صلاحية', chip: 'warn', icon: 'clock', tone: 'warn'},
  info: {label: 'معلومة', chip: 'muted', icon: 'info', tone: ''},
  printer: {label: 'الطابعة', chip: 'danger', icon: 'printer', tone: 'danger'},
  sale: {label: 'بيع', chip: 'brand', icon: 'cart', tone: 'brand'},
  stocktake: {label: 'جرد', chip: 'ok', icon: 'clipboard', tone: 'ok'},
  online_order: {label: 'طلب أونلاين', chip: 'brand', icon: 'basket', tone: 'brand'},
  license: {label: 'الاشتراك', chip: 'warn', icon: 'key', tone: 'warn'},
  sila_debt: {label: 'دين صِلة', chip: 'danger', icon: 'link', tone: 'danger'},
  sila_payment: {label: 'سداد صِلة', chip: 'ok', icon: 'link', tone: 'ok'},
  sila_collection: {label: 'تحصيل صِلة', chip: 'ok', icon: 'link', tone: 'ok'},
  sila_voucher: {label: 'قسائم', chip: 'brand', icon: 'ticket', tone: 'brand'},
  sila_campaign: {label: 'تسوية حملة', chip: 'ok', icon: 'store', tone: 'ok'},
  backup: {label: 'نسخ احتياطي', chip: 'danger', icon: 'database', tone: 'danger'},
};

/** الشاشة التي يقود إليها كل نوع — الضغط على الإشعار يفتحها. */
const KIND_SCREEN: Partial<Record<NotificationKind, string>> = {
  out_of_stock: 'stock-alerts',
  low_stock: 'stock-alerts',
  expiry: 'stock-alerts',
  sale: 'invoices',
  stocktake: 'stocktake',
  online_order: 'online-orders',
  license: 'settings',
  sila_debt: 'sila',
  sila_payment: 'sila',
  sila_collection: 'sila',
  sila_voucher: 'sila',
  sila_campaign: 'sila',
  backup: 'settings',
  printer: 'settings',
};

type FilterKey = 'all' | 'unread' | 'stock' | 'sila' | 'sales' | 'system';

const FILTER_GROUPS: Record<
  Exclude<FilterKey, 'all' | 'unread'>,
  NotificationKind[]
> = {
  stock: ['out_of_stock', 'low_stock', 'expiry'],
  sila: [
    'sila_debt',
    'sila_payment',
    'sila_collection',
    'sila_voucher',
    'sila_campaign',
  ],
  sales: ['sale', 'online_order'],
  system: ['backup', 'printer', 'license', 'stocktake', 'info'],
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'الكل',
  unread: 'غير المقروء',
  stock: 'المخزون والصلاحية',
  sila: 'صِلة والقسائم',
  sales: 'البيع والطلبات',
  system: 'النظام',
};

export function NotificationsScreen({
  goTo,
}: {
  goTo?: (key: string) => void;
}) {
  const items = useNotificationsStore(s => s.items);
  const unreadCount = useNotificationsStore(s => s.unreadCount);
  const markAllRead = useNotificationsStore(s => s.markAllRead);
  const markRead = useNotificationsStore(s => s.markRead);
  const removeOne = useNotificationsStore(s => s.remove);
  const clearAll = useNotificationsStore(s => s.clearAll);
  const [filter, setFilter] = useState<FilterKey>('all');

  /** عدّاد لكل فلتر — يظهر داخل الزر كي يعرف التاجر أين الكتلة. */
  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      all: items.length,
      unread: 0,
      stock: 0,
      sila: 0,
      sales: 0,
      system: 0,
    };
    for (const n of items) {
      if (!n.read) {
        counts.unread += 1;
      }
      for (const key of Object.keys(FILTER_GROUPS) as Exclude<
        FilterKey,
        'all' | 'unread'
      >[]) {
        if (FILTER_GROUPS[key].includes(n.kind)) {
          counts[key] += 1;
        }
      }
    }
    return counts;
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'all') {
      return items;
    }
    if (filter === 'unread') {
      return items.filter(n => !n.read);
    }
    return items.filter(n => FILTER_GROUPS[filter].includes(n.kind));
  }, [items, filter]);

  const onRowClick = useCallback(
    (id: string, kind: NotificationKind, read: boolean) => {
      if (!read) {
        markRead(id);
      }
      const target = KIND_SCREEN[kind];
      if (target != null && goTo != null) {
        goTo(target);
      }
    },
    [markRead, goTo],
  );

  return (
    <div className="screen">
      <h1>مركز الإشعارات</h1>
      <div className="subtitle">
        تنبيهات المخزون والصلاحية والصِلة والبيع أونلاين — {unreadCount} غير
        مقروء من أصل {items.length}. اضغط أي إشعار للانتقال إلى مصدره مباشرة.
      </div>

      {/* فلاتر المجموعات v60 */}
      <div className="toolbar" style={{flexWrap: 'wrap'}}>
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map(key => (
          <button
            key={key}
            className={`chip-toggle ${filter === key ? 'on' : ''}`}
            onClick={() => setFilter(key)}>
            {FILTER_LABELS[key]}
            {filterCounts[key] > 0 && (
              <span className="chip sm">{filterCounts[key]}</span>
            )}
          </button>
        ))}
        <span className="grow" />
        <button
          className="btn sm"
          onClick={markAllRead}
          disabled={unreadCount === 0}>
          <Icon name="check" size={14} />
          تعليم الكل كمقروء
        </button>
        <button
          className="btn sm danger"
          onClick={() => {
            if (items.length > 0 && window.confirm('مسح كل الإشعارات؟')) {
              clearAll();
            }
          }}
          disabled={items.length === 0}>
          <Icon name="trash" size={14} />
          مسح الكل
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <div className="sv57-empty">
            <span className="icon" style={{display: 'inline-flex'}}>
              <Icon name="bell" size={30} />
            </span>
            {items.length === 0
              ? 'لا إشعارات بعد — ستظهر هنا تنبيهات النفاد والصلاحية والصِلة والطلبات أونلاين'
              : `لا إشعارات في «${FILTER_LABELS[filter]}»`}
          </div>
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {visible.map(n => {
            const meta = KIND_META[n.kind] ?? KIND_META.info;
            return (
              <div
                key={n.id}
                className={`notif-row tone-${meta.tone || 'info'} ${
                  n.read ? '' : 'unread'
                }`}
                onClick={() => onRowClick(n.id, n.kind, n.read)}>
                <span
                  style={{
                    display: 'inline-flex',
                    marginTop: 2,
                    color: `var(--${meta.tone || 'muted'}, var(--muted))`,
                  }}>
                  <Icon name={meta.icon} size={20} />
                </span>
                <div className="texts" style={{flex: 1, minWidth: 0}}>
                  <div className="title-line" style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}}>
                    <b>{n.title}</b>
                    <span className={`chip ${meta.chip}`}>{meta.label}</span>
                    {!n.read && <span className="chip brand">جديد</span>}
                  </div>
                  <div className="body" style={{color: 'var(--ink-soft)', lineHeight: 1.7}}>
                    {n.body}
                  </div>
                  <div
                    className="when"
                    style={{color: 'var(--muted)', fontSize: 11.5}}>
                    {relativeTime(n.createdAt)}
                    {KIND_SCREEN[n.kind] != null && (
                      <span style={{marginInlineStart: 10, color: 'var(--brand-ink)'}}>
                        اضغط للانتقال ↦
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="notif-del"
                  title="حذف هذا الإشعار"
                  aria-label="حذف هذا الإشعار"
                  onClick={e => {
                    e.stopPropagation();
                    removeOne(n.id);
                  }}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="sv57-chart-hint" style={{marginTop: 10}}>
        يُحتفظ بآخر 100 إشعار — الإشعارات الحرجة (نسخ احتياطي/دين صِلة)
        تظهر فوراً كبطاقة عائمة مع نغمة مسموعة أينما كنت في التطبيق.
      </div>
    </div>
  );
}
