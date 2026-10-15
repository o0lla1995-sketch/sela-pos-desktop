/**
 * NotificationsScreen.tsx — مركز الإشعارات داخل التطبيق (§ شجرة 9).
 */
import React from 'react';
import {useNotificationsStore} from '../state/appStores';
import {formatDateTime} from '../core/format';

const KIND_META: Record<string, {label: string; chip: string; icon: string}> = {
  out_of_stock: {label: 'نفاد مخزون', chip: 'danger', icon: '📦'},
  low_stock: {label: 'مخزون منخفض', chip: 'warn', icon: '📉'},
  info: {label: 'معلومة', chip: 'muted', icon: 'ℹ️'},
  printer: {label: 'الطابعة', chip: 'danger', icon: '🖨️'},
  sale: {label: 'بيع', chip: 'brand', icon: '🧾'},
  stocktake: {label: 'جرد', chip: 'ok', icon: '📋'},
};

export function NotificationsScreen() {
  const items = useNotificationsStore(s => s.items);
  const markAllRead = useNotificationsStore(s => s.markAllRead);

  return (
    <div className="screen">
      <h1>مركز الإشعارات</h1>
      <div className="subtitle">
        تنبيهات النقص والطابعة والعمليات — {items.filter(n => !n.read).length} غير مقروء
      </div>
      <div className="toolbar">
        <button className="btn" onClick={markAllRead}>تعليم الكل كمقروء</button>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
        {[...items].reverse().map(n => {
          const meta = KIND_META[n.kind] ?? KIND_META.info!;
          return (
            <div key={n.id} className="card" style={{display: 'flex', gap: 12, alignItems: 'center'}}>
              <span style={{fontSize: 22}}>{meta.icon}</span>
              <div style={{flex: 1}}>
                <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                  <b style={{fontSize: 13.5}}>{n.title}</b>
                  <span className={`chip ${meta.chip}`}>{meta.label}</span>
                  {!n.read && <span className="chip brand">جديد</span>}
                </div>
                <div style={{color: 'var(--ink-soft)', fontSize: 12.5, marginTop: 4}}>
                  {n.body}
                </div>
                <div style={{color: 'var(--muted)', fontSize: 11, marginTop: 4}} dir="ltr">
                  {formatDateTime(n.createdAt)}
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="empty">
            <div className="icon">🔔</div>
            لا إشعارات بعد
          </div>
        )}
      </div>
    </div>
  );
}
