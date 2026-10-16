/**
 * components/NotificationPopups.tsx — الإشعار الفوري على الشاشة
 * (v59 — جولة المستخدم #4): كل إشعار يصل للمركز يظهر فوراً كبطاقة
 * عائمة أعلى يسار الشاشة فوق كل المحتوى، مع نغمة مسموعة، ويختفي
 * ذاتياً بعد 6 ثوانٍ (أو بالنقر عليه). الأنواع الحرجة تبقى 10
 * ثوانٍ. هذا بجانب مركز الإشعارات نفسه — لا يحل محله.
 */
import React, {useEffect} from 'react';
import {create} from 'zustand';
import {Icon, type IconName} from './Icon';
import {alertChime, notifyChime} from '../lib/sound';
import type {AppNotification, NotificationKind} from '../core/types';

/** الأنواع الحرجة — نغمة تحذير وبقاء أطول. */
const CRITICAL_KINDS: ReadonlySet<NotificationKind> = new Set([
  'backup',
  'sila_debt',
  'sila_payment',
  'license',
]);

const ICONS: Partial<Record<NotificationKind, IconName>> = {
  out_of_stock: 'alert',
  low_stock: 'alert',
  expiry: 'clock',
  info: 'info',
  printer: 'printer',
  sale: 'cart',
  stocktake: 'clipboard',
  online_order: 'basket',
  license: 'shield',
  sila_debt: 'link',
  sila_payment: 'wallet',
  sila_collection: 'wallet',
  sila_voucher: 'ticket',
  sila_campaign: 'ticket',
  backup: 'database',
};

interface PopupItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  critical: boolean;
}

interface PopupState {
  items: PopupItem[];
  push: (item: PopupItem) => void;
  dismiss: (id: string) => void;
}

const popupStore = create<PopupState>(set => ({
  items: [],
  push: item => set(state => ({items: [...state.items, item].slice(-4)})),
  dismiss: id =>
    set(state => ({items: state.items.filter(item => item.id !== id)})),
}));

/**
 * يُستدعى من notificationsStore.push — يعرض البطاقة العائمة ويشغل
 * النغمة. أفضل جهد: لا يرمي أبداً.
 */
export function showNotificationPopup(
  notification: AppNotification,
): void {
  try {
    const critical = CRITICAL_KINDS.has(notification.kind);
    popupStore.getState().push({
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      createdAt: notification.createdAt,
      critical,
    });
    if (critical) {
      alertChime();
    } else {
      notifyChime();
    }
  } catch {
    /* العرض والصوت أفضل جهد */
  }
}

/** البطاقة الواحدة — مؤقت اختفاء ذاتي. */
function PopupCard({item}: {item: PopupItem}) {
  const dismiss = popupStore(s => s.dismiss);
  useEffect(() => {
    const timer = window.setTimeout(
      () => dismiss(item.id),
      item.critical ? 10_000 : 6_000,
    );
    return () => window.clearTimeout(timer);
  }, [item.id, item.critical, dismiss]);

  return (
    <div
      className={`ntf-pop ${item.critical ? 'critical' : ''}`}
      role="alert"
      onClick={() => dismiss(item.id)}>
      <span className="ntf-pop-icon">
        <Icon name={ICONS[item.kind] ?? 'bell'} size={19} />
      </span>
      <span className="ntf-pop-text">
        <b>{item.title}</b>
        <span>{item.body}</span>
      </span>
      <span className="ntf-pop-x">
        <Icon name="x" size={13} />
      </span>
    </div>
  );
}

/** يُركَّب مرة واحدة في app.tsx فوق كل شيء. */
export function NotificationPopups() {
  const items = popupStore(s => s.items);
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="ntf-pop-stack" dir="rtl">
      {items.map(item => (
        <PopupCard key={item.id} item={item} />
      ))}
    </div>
  );
}
