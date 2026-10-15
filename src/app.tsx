/**
 * app.tsx — الهيكل العام v57: بوابة الترخيص → بوابة قفل PIN →
 * القشرة (شريط جانبي أيمن + الشاشات) + شريط حالة الاشتراك (grace)
 * + التوست + موجّه الباركود العام + إقلاع محرّكي صِلة والبيع أونلاين.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {evaluate, heartbeat, type LicenseStatus} from './license/LicenseService';
import {initStorage} from './state/storage';
import {useSettingsStore} from './stores/settingsStore';
import {
  useToastStore,
  useNotificationsStore,
  useCatalogStore,
} from './state/appStores';
import {useSilaStore} from './stores/silaStore';
import {installGlobalScanner} from './lib/scanner';
import {api} from './lib/tauri';
import {APP_VERSION_LABEL} from './core/config';
import {AppLockGate} from './components/AppLockGate';
import {ActivationScreen} from './screens/ActivationScreen';
import {HomeScreen} from './screens/HomeScreen';
import {PosScreen} from './screens/PosScreen';
import {InvoicesScreen} from './screens/InvoicesScreen';
import {InventoryScreen} from './screens/InventoryScreen';
import {StocktakeScreen} from './screens/StocktakeScreen';
import {ReportsScreen} from './screens/ReportsScreen';
import {NotificationsScreen} from './screens/NotificationsScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {LocalDebtsScreen} from './screens/LocalDebtsScreen';
import {CashMovementsScreen} from './screens/CashMovementsScreen';
import {SilaScreen} from './screens/SilaScreen';
import {StockAlertsScreen} from './screens/StockAlertsScreen';
import {OnlineOrdersScreen} from './screens/online/OnlineOrdersScreen';
import {OnlineProductsScreen} from './screens/online/OnlineProductsScreen';
import {OnlineSellingScreen} from './screens/online/OnlineSellingScreen';

type ScreenKey =
  | 'home'
  | 'pos'
  | 'invoices'
  | 'online-orders'
  | 'online-products'
  | 'online-selling'
  | 'inventory'
  | 'stocktake'
  | 'debts'
  | 'cash'
  | 'sila'
  | 'stock-alerts'
  | 'reports'
  | 'notifications'
  | 'settings';

const NAV: {key: ScreenKey; label: string; icon: string}[] = [
  {key: 'home', label: 'الرئيسية', icon: '🏠'},
  {key: 'pos', label: 'نقطة البيع', icon: '🛒'},
  {key: 'invoices', label: 'الفواتير', icon: '🧾'},
  {key: 'online-orders', label: 'الطلبات أونلاين', icon: '🛍️'},
  {key: 'inventory', label: 'المخزون', icon: '📦'},
  {key: 'stocktake', label: 'الجرد', icon: '📋'},
  {key: 'debts', label: 'ديون المتجر', icon: '📒'},
  {key: 'cash', label: 'الخزينة', icon: '💰'},
  {key: 'sila', label: 'صِلة والقسائم', icon: '🔗'},
  {key: 'reports', label: 'التقارير', icon: '📊'},
  {key: 'notifications', label: 'الإشعارات', icon: '🔔'},
  {key: 'settings', label: 'الإعدادات', icon: '⚙️'},
];

export function App() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [screen, setScreen] = useState<ScreenKey>('home');
  const toast = useToastStore(s => s.show);
  const toasts = useToastStore(s => s.toasts);
  const unread = useNotificationsStore(s => s.unreadCount);
  const settings = useSettingsStore(s => s.settings);
  const themeMode = useSettingsStore(s => s.themeMode);
  const silaPaired = useSilaStore(s => s.pairing != null);

  const refreshStatus = useCallback(() => {
    void evaluate().then(setStatus);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await initStorage();
        await installGlobalScanner(
          useSettingsStore.getState().settings.scannerMinLength,
        );
        await api.bootstrap().catch(() => null);
        refreshStatus();
        // ── محركا المزامنة: صِلة (عند الاقتران) والطلبات أونلاين ──
        try {
          const {SilaSync} = await import('./services/sila/SilaSync');
          if (useSilaStore.getState().pairing != null) {
            SilaSync.start();
          }
        } catch {
          /* صِلة غير مهيأة بعد */
        }
        try {
          const {ensureEngineStarted} = await import(
            './services/online/OnlineStoreService'
          );
          ensureEngineStarted();
        } catch {
          /* البيع أونلاين غير مفعّل */
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // نبضة كل 15 دقيقة (نفس إيقاع الأندرويد تقريباً — بلا إزعاج للمستخدم).
  useEffect(() => {
    if (status == null || status.state === 'needs_activation') return;
    const timer = setInterval(() => {
      void heartbeat().then(setStatus);
    }, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [status == null]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  if (!ready) {
    return (
      <div className="activation">
        <div className="activation-card" style={{alignItems: 'center'}}>
          <div className="brand-dot" style={{width: 54, height: 54, fontSize: 24}}>س</div>
          <div style={{color: 'var(--muted)'}}>جارٍ تجهيز سيلا…</div>
        </div>
      </div>
    );
  }

  if (status == null || status.state === 'needs_activation' || status.state === 'locked') {
    return (
      <>
        <ActivationScreen status={status} onRefresh={refreshStatus} />
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </>
    );
  }

  return (
    <AppLockGate>
      {status.state === 'grace' && (
        <div className="state-banner">
          ⚠️ العمل دون إنترنت منذ {Math.round(status.offlineHours)} ساعة — يظل
          النظام يعمل حتى 72 ساعة، بعدها يلزم الاتصال بالسيرفر مرة واحدة.
        </div>
      )}
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-dot">س</div>
            <div className="brand-text">
              <b>{settings.storeName}</b>
              <span>سيلا · سطح المكتب · {APP_VERSION_LABEL}</span>
            </div>
          </div>
          {NAV.map(item => (
            <button
              key={item.key}
              className={`nav-item ${screen === item.key ? 'active' : ''}`}
              onClick={() => setScreen(item.key)}>
              <span className="icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.key === 'notifications' && unread > 0 && (
                <span className="chip brand" style={{marginInlineStart: 'auto'}}>
                  {unread}
                </span>
              )}
              {item.key === 'sila' && silaPaired && (
                <span
                  className="dot-ok"
                  title="مقترن بخدمة صِلة"
                  style={{marginInlineStart: 'auto'}}
                />
              )}
            </button>
          ))}
          <div className="nav-spacer" />
          <div className="nav-meta">
            الترخيص:{' '}
            {status.state === 'active'
              ? `نشط حتى ${new Date(status.license?.expiresAt ?? 0).toLocaleDateString('ar')}`
              : 'بمهلة'}
            <br />
            المسح العام نشط — وجّه القارئ نحو أي شاشة.
          </div>
        </aside>

        <main className="main">
          {screen === 'pos' ? (
            <PosScreen />
          ) : (
            <div style={{flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0}}>
              {screen === 'home' && <HomeScreen goTo={key => setScreen(key as ScreenKey)} />}
              {screen === 'invoices' && <InvoicesScreen />}
              {screen === 'online-orders' && <OnlineOrdersScreen />}
              {screen === 'online-products' && <OnlineProductsScreen />}
              {screen === 'online-selling' && (
                <OnlineSellingScreen goTo={key => setScreen(key as ScreenKey)} />
              )}
              {screen === 'inventory' && <InventoryScreen />}
              {screen === 'stocktake' && <StocktakeScreen />}
              {screen === 'debts' && <LocalDebtsScreen />}
              {screen === 'cash' && <CashMovementsScreen />}
              {screen === 'sila' && <SilaScreen />}
              {screen === 'stock-alerts' && <StockAlertsScreen goTo={key => setScreen(key as ScreenKey)} />}
              {screen === 'reports' && <ReportsScreen />}
              {screen === 'notifications' && <NotificationsScreen />}
              {screen === 'settings' && <SettingsScreen goTo={key => setScreen(key as ScreenKey)} />}
            </div>
          )}
        </main>
      </div>
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
      ))}
    </AppLockGate>
  );
}
