/**
 * Notifications store — in-app notification center.
 * ─────────────────────────────────────────────────────────────────
 * Persists the latest 100 notifications in MMKV. Critical stock
 * alerts are additionally posted as Android system notifications via
 * the native SelaNotifications module.
 */
import {create} from 'zustand';
import {getJson, setJson, KEYS} from '../storage/storage';
import {localNow} from '../core/format';
import {logDiag} from '../core/diagnostics';
import {SelaNotificationsNative} from '../native/nativeBridge';
import {showNotificationPopup} from '../components/NotificationPopups';
import type {AppNotification, NotificationKind} from '../core/types';

const MAX_ITEMS = 100;

interface NotificationsState {
  items: AppNotification[];
  unreadCount: number;
  /** Fires a push into the center (+ optional system notification). */
  push: (
    kind: NotificationKind,
    title: string,
    body: string,
    options?: {productId?: number; system?: boolean},
  ) => AppNotification;
  markAllRead: () => void;
  markRead: (id: string) => void;
  /** v60: حذف إشعار واحد من المركز (زر × في الصف). */
  remove: (id: string) => void;
  clearAll: () => void;
  /** v85 (الجولة 91 #٤): إسقاط إشعارات نفاد/انخفاض المخزون لمنتجات
   *  صارت بلا تتبع — طلب التاجر: «يجب الا يتم ارسال إشعارات نفاد
   *  المخزون للمنتجات التي بدون تتبع». الإنذار الجديد ممنوع منذ
   *  v35؛ هذا ينظّف الإشعارات التاريخية العالقة أيضاً. */
  dropStockAlertsFor: (productIds: Set<number>) => number;
}

function loadInitial(): AppNotification[] {
  const stored = getJson<AppNotification[]>(KEYS.notifications, []);
  return Array.isArray(stored) ? stored.slice(0, MAX_ITEMS) : [];
}

function persist(items: AppNotification[]): void {
  setJson(KEYS.notifications, items.slice(0, MAX_ITEMS));
}

function recount(items: AppNotification[]): number {
  let count = 0;
  for (const item of items) {
    if (!item.read) {
      count += 1;
    }
  }
  return count;
}

/** Posts a local Android notification (best-effort, never throws).
 *  v68 (الجولة 72): سطح المكتب — SelaNotificationsNative معدوم (وحدة
 *  أندرويد لا تُبنى هنا) فكنا نسقط بصمت: لا إشعار نظام إطلاقاً،
 *  وبخاصة أثناء عمل البرنامج بالخلفية (خادم الكاشير بعد إخفاء
 *  النافذة) حيث لا يرى التاجر إشعارات الواجهة الداخلية. السقوط
 *  الآن إلى Web Notification API في WebView2 — إشعار ويندوز حقيقي
 *  بالعربية (dir rtl) إذا مُنح الإذن (يُطلب عند تشغيل خادم الكاشير). */
async function postSystemNotification(
  notification: AppNotification,
): Promise<void> {
  try {
    if (SelaNotificationsNative != null) {
      await SelaNotificationsNative.show(
        (Math.abs(hashCode(notification.id)) % 100000) + 1,
        notification.title,
        notification.body,
        notification.kind === 'out_of_stock' || notification.kind === 'low_stock'
          ? 'stock'
          : notification.kind,
      );
      return;
    }
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      new Notification(notification.title, {
        body: notification.body,
        dir: 'rtl',
        lang: 'ar',
      });
    }
  } catch (error) {
    logDiag(
      'notifications',
      `فشل إرسال إشعار النظام: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'warn',
    );
  }
}

function hashCode(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  }
  return h;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: loadInitial(),
  unreadCount: recount(loadInitial()),

  push: (kind, title, body, options) => {
    const notification: AppNotification = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      kind,
      title,
      body,
      createdAt: localNow(),
      read: false,
      productId: options?.productId,
    };
    const items = [notification, ...get().items].slice(0, MAX_ITEMS);
    persist(items);
    set({items, unreadCount: recount(items)});
    if (options?.system) {
      void postSystemNotification(notification);
    }
    // v59: إشعار فوري على الشاشة + نغمة مسموعة لحظة الوصول — لم يعد
    // يلزم فتح مركز الإشعارات لتعرف أن شيئاً وصل.
    showNotificationPopup(notification);
    return notification;
  },

  markAllRead: () => {
    const items = get().items.map(item =>
      item.read ? item : {...item, read: true},
    );
    persist(items);
    set({items, unreadCount: 0});
  },

  markRead: id => {
    const items = get().items.map(item =>
      item.id === id ? {...item, read: true} : item,
    );
    persist(items);
    set({items, unreadCount: recount(items)});
  },

  remove: id => {
    const items = get().items.filter(item => item.id !== id);
    persist(items);
    set({items, unreadCount: recount(items)});
  },

  clearAll: () => {
    persist([]);
    set({items: [], unreadCount: 0});
  },

  /** v85 (الجولة 91 #٤): إسقاط إشعارات النفاد/الانخفاض لمنتجات بلا
   *  تتبع — تنظيف الإشعارات التاريخية العالقة. يعيد عدد ما أُسقط. */
  dropStockAlertsFor: (productIds: Set<number>) => {
    if (productIds.size === 0) {
      return 0;
    }
    const current = get().items;
    let dropped = 0;
    const kept = current.filter(item => {
      if (
        (item.kind === 'out_of_stock' || item.kind === 'low_stock') &&
        item.productId != null &&
        productIds.has(item.productId)
      ) {
        dropped += 1;
        return false;
      }
      return true;
    });
    if (dropped > 0) {
      persist(kept);
      set({items: kept, unreadCount: recount(kept)});
    }
    return dropped;
  },
}));

/** Imperative accessor for services. */
export const notificationsStore = {
  push: (
    kind: NotificationKind,
    title: string,
    body: string,
    options?: {productId?: number; system?: boolean},
  ) => useNotificationsStore.getState().push(kind, title, body, options),

  /** v85 (الجولة 91 #٤): من خدمات الأعمال — إسقاط إشعارات النفاد
   *  القديمة لمنتجات بلا تتبع. */
  dropStockAlertsFor: (productIds: Set<number>) =>
    useNotificationsStore.getState().dropStockAlertsFor(productIds),
};
