/**
 * catalogStore + toastStore + notificationsStore + StockAlertsService
 * — منقولة من الأندرويد (نفس البنية والسلوك).
 */
import {create} from 'zustand';
import {api} from '../lib/tauri';
import {getJson, setJson, KEYS, logDiag} from './storage';
import {getSettings} from './settingsStore';
import {stockStateOf} from '../core/types';
import type {AppNotification, NotificationKind, Product} from '../core/types';
import {localNow} from '../core/format';

// ─────────────────────────────────────────── الكتالوج
interface CatalogState {
  products: Product[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  products: [],
  loading: false,
  error: null,
  refresh: async () => {
    if (get().loading) return;
    set({loading: true, error: null});
    try {
      const products = await api.listProducts();
      set({products, loading: false});
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({loading: false, error: message});
      logDiag('catalog', `فشل تحميل الكتالوج: ${message}`, 'error');
    }
  },
}));

// ─────────────────────────────────────────── التوست
type ToastKind = 'success' | 'error' | 'info';
interface ToastState {
  message: string | null;
  kind: ToastKind;
  show: (message: string, kind?: ToastKind) => void;
  dismiss: () => void;
}

export const useToastStore = create<ToastState>(set => ({
  message: null,
  kind: 'info',
  show: (message, kind = 'info') => set({message, kind}),
  dismiss: () => set({message: null}),
}));

// ─────────────────────────────────────────── مركز الإشعارات
interface NotificationsState {
  items: AppNotification[];
  unread: number;
  push: (kind: NotificationKind, title: string, body: string, productId?: number) => void;
  markAllRead: () => void;
}

function loadNotifications(): AppNotification[] {
  return getJson<AppNotification[]>(KEYS.notifications, []);
}

function persistNotifications(items: AppNotification[]): void {
  setJson(KEYS.notifications, items.slice(-200));
}

export const useNotificationsStore = create<NotificationsState>(set => ({
  items: loadNotifications(),
  unread: loadNotifications().filter(n => !n.read).length,
  push: (kind, title, body, productId) =>
    set(state => {
      const item: AppNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        title,
        body,
        createdAt: localNow(),
        read: false,
        productId,
      };
      const items = [...state.items, item];
      persistNotifications(items);
      return {items, unread: items.filter(n => !n.read).length};
    }),
  markAllRead: () =>
    set(state => {
      const items = state.items.map(n => ({...n, read: true}));
      persistNotifications(items);
      return {items, unread: 0};
    }),
}));

// ─────────────────────────────────────────── تنبيهات النقص (مع الدفتر)
/**
 * نفس StockAlertsService: نقيّم حالة كل منتج، نضيف إشعاراً لكل مفتاح
 * جديد (low:{id} / out:{id})، والدفتر يمنع التكرار — بلا أي إشعارات OS
 * على المكتب (مركز داخل التطبيق فقط — انظر مصفوفة الاستبدال).
 */
export const StockAlertsService = {
  evaluate(): {low: number; out: number} {
    const settings = getSettings();
    const products = useCatalogStore.getState().products;
    if (!settings.stockAlertsEnabled || products.length === 0) {
      return {low: 0, out: 0};
    }
    const ledger = getJson<{keys: string[]}>(KEYS.stockAlertLedger, {keys: []});
    const ledgerKeys = new Set(ledger.keys);
    const known = new Set(ledgerKeys);
    const newKeys: string[] = [];
    let low = 0;
    let out = 0;
    const notifications = useNotificationsStore.getState();

    for (const product of products) {
      const state = stockStateOf(product, settings.lowStockDefaultThreshold);
      if (state === 'ok') continue;
      const key = `${state}:${product.id}`;
      if (state === 'out') out += 1;
      else low += 1;
      if (known.has(key)) continue;
      known.add(key);
      newKeys.push(key);
      if (state === 'out') {
        notifications.push(
          'out_of_stock',
          `نفد المخزون: ${product.name}`,
          'هذا المنتج غير متوفر — أعد تعبئته أو حدّث كميته من المخزون',
          product.id,
        );
      } else {
        notifications.push(
          'low_stock',
          `مخزون منخفض: ${product.name}`,
          `المتبقي ${product.stock_quantity} — فكّر بإعادة التعبئة قريباً`,
          product.id,
        );
      }
    }
    if (newKeys.length > 0) {
      ledger.keys = [...ledger.keys, ...newKeys].slice(-400);
      setJson(KEYS.stockAlertLedger, ledger);
    }
    return {low, out};
  },

  activeAlerts(limit: number): {kind: 'out' | 'low'; product: Product}[] {
    const settings = getSettings();
    const products = useCatalogStore.getState().products;
    const alerts: {kind: 'out' | 'low'; product: Product}[] = [];
    for (const product of products) {
      const state = stockStateOf(product, settings.lowStockDefaultThreshold);
      if (state !== 'ok') {
        alerts.push({kind: state, product});
      }
    }
    return alerts.slice(0, limit);
  },
};
