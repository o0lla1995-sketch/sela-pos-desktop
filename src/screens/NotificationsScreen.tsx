/**
 * screens/NotificationsScreen.tsx — مركز الإشعارات (UI-7 — مطابق لمخزن
 * الإشعارات v57): items/unreadCount/markAllRead/markRead/clearAll —
 * صفوف برقائق النوع، تعليم الكل كمقروء، تعليم صف بالفتح، وحالة فراغ.
 */
import React, {useCallback} from 'react';
import {useNotificationsStore} from '../state/appStores';
import {relativeTime} from '../core/format';
import {Icon, type IconName} from '../components/Icon';
import type {NotificationKind} from '../core/types';
import './settingsv57.css';

/** رقائق النوع — تغطي كل أنواع NotificationKind في v58 (أيقونات SVG). */
const KIND_META: Record<
  NotificationKind,
  {label: string; chip: string; icon: IconName}
> = {
  out_of_stock: {label: 'نفاد مخزون', chip: 'danger', icon: 'packageMinus'},
  low_stock: {label: 'مخزون منخفض', chip: 'warn', icon: 'packageMinus'},
  expiry: {label: 'صلاحية', chip: 'warn', icon: 'clock'},
  info: {label: 'معلومة', chip: 'muted', icon: 'info'},
  printer: {label: 'الطابعة', chip: 'danger', icon: 'printer'},
  sale: {label: 'بيع', chip: 'brand', icon: 'cart'},
  stocktake: {label: 'جرد', chip: 'ok', icon: 'clipboard'},
  online_order: {label: 'طلب أونلاين', chip: 'brand', icon: 'basket'},
  license: {label: 'الاشتراك', chip: 'warn', icon: 'key'},
  sila_debt: {label: 'دين صِلة', chip: 'danger', icon: 'link'},
  sila_payment: {label: 'سداد صِلة', chip: 'ok', icon: 'link'},
  sila_collection: {label: 'تحصيل صِلة', chip: 'ok', icon: 'link'},
  sila_voucher: {label: 'قسائم', chip: 'brand', icon: 'ticket'},
  sila_campaign: {label: 'تسوية حملة', chip: 'ok', icon: 'store'},
  backup: {label: 'نسخ احتياطي', chip: 'danger', icon: 'database'},
};

export function NotificationsScreen() {
  const items = useNotificationsStore(s => s.items);
  const unreadCount = useNotificationsStore(s => s.unreadCount);
  const markAllRead = useNotificationsStore(s => s.markAllRead);
  const markRead = useNotificationsStore(s => s.markRead);
  const clearAll = useNotificationsStore(s => s.clearAll);

  const onRowClick = useCallback(
    (id: string, read: boolean) => {
      if (!read) {
        markRead(id);
      }
    },
    [markRead],
  );

  return (
    <div className="screen">
      <h1>مركز الإشعارات</h1>
      <div className="subtitle">
        تنبيهات المخزون والصلاحية والصِلة والبيع أونلاين — {unreadCount} غير
        مقروء من أصل {items.length}
      </div>

      <div className="toolbar">
        <button className="btn" onClick={markAllRead} disabled={unreadCount === 0}>
          تعليم الكل كمقروء
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (items.length > 0 && window.confirm('مسح كل الإشعارات؟')) {
              clearAll();
            }
          }}
          disabled={items.length === 0}>
          مسح الكل
        </button>
      </div>

      {items.length === 0 ? (
        <div className="card">
          <div className="sv57-empty">
            <span className="icon" style={{display: 'inline-flex'}}>
              <Icon name="bell" size={30} />
            </span>
            لا إشعارات بعد — ستظهر هنا تنبيهات النفاد والصلاحية والصِلة
            والطلبات أونلاين
          </div>
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {items.map(n => {
            const meta = KIND_META[n.kind] ?? KIND_META.info;
            return (
              <div
                key={n.id}
                className={`sv57-notif-row ${n.read ? '' : 'unread'}`}
                onClick={() => onRowClick(n.id, n.read)}>
                <span className="icon" style={{display: 'inline-flex'}}>
                  <Icon name={meta.icon} size={20} />
                </span>
                <div className="texts">
                  <div className="title-line">
                    <b>{n.title}</b>
                    <span className={`chip ${meta.chip}`}>{meta.label}</span>
                    {!n.read && <span className="chip brand">جديد</span>}
                  </div>
                  <div className="body">{n.body}</div>
                  <div className="when">{relativeTime(n.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="sv57-chart-hint" style={{marginTop: 10}}>
        يُحتفظ بآخر 100 إشعار — الضغط على إشعار جديد يعلّمه مقروءاً.
      </div>
    </div>
  );
}
