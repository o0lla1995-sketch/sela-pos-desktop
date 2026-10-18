/**
 * app.tsx — الهيكل العام v58: بوابة الترخيص → بوابة قفل PIN →
 * القشرة (شريط جانبي أيمن بأيقونات SVG + الشاشات) + شريط حالة
 * الاشتراك (grace) + التوست + موجّه الباركود العام + إقلاع محرّكي
 * صِلة والبيع أونلاين.
 *
 * v58: كل شاشة داخل ErrorBoundary — أي استثناء عرض يظهر بطاقة
 * عربية واضحة بدل الشاشة البيضاء، وبقية النظام يواصل العمل.
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
import {api, toggleFullscreen} from './lib/tauri';
import {APP_VERSION_LABEL} from './core/config';
import {AppLockGate} from './components/AppLockGate';
import {ErrorBoundary} from './components/ErrorBoundary';
import {NotificationPopups} from './components/NotificationPopups';
import {Icon, type IconName} from './components/Icon';
import {ActivationScreen} from './screens/ActivationScreen';
import {HomeScreen} from './screens/HomeScreen';
import {PosScreen} from './screens/PosScreen';
import {InvoicesScreen} from './screens/InvoicesScreen';
import {InventoryScreen} from './screens/InventoryScreen';
import {StocktakeScreen} from './screens/StocktakeScreen';
import {ReportsScreen} from './screens/ReportsScreen';
import {NotificationsScreen} from './screens/NotificationsScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {CashiersScreen} from './screens/CashiersScreen';
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
  | 'cashiers'
  | 'settings';

const NAV: {key: ScreenKey; label: string; icon: IconName}[] = [
  {key: 'home', label: 'الرئيسية', icon: 'home'},
  {key: 'pos', label: 'نقطة البيع', icon: 'cart'},
  {key: 'invoices', label: 'الفواتير', icon: 'tag'},
  {key: 'online-orders', label: 'الطلبات أونلاين', icon: 'basket'},
  {key: 'inventory', label: 'المخزون', icon: 'box'},
  {key: 'stocktake', label: 'الجرد', icon: 'clipboard'},
  {key: 'debts', label: 'ديون المتجر', icon: 'book'},
  {key: 'cash', label: 'الخزينة', icon: 'wallet'},
  {key: 'sila', label: 'صِلة والقسائم', icon: 'link'},
  {key: 'reports', label: 'التقارير', icon: 'chart'},
  {key: 'notifications', label: 'الإشعارات', icon: 'bell'},
  {key: 'cashiers', label: 'الكاشير', icon: 'user'},
  {key: 'settings', label: 'الإعدادات', icon: 'settings'},
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
  const setThemeMode = useSettingsStore(s => s.setThemeMode);
  const silaPaired = useSilaStore(s => s.pairing != null);

  const refreshStatus = useCallback((): Promise<void> => {
    // معاينة المتصفح في وضع التطوير فقط: حالة نشطة افتراضية كي
    // تُعاين الشاشات — يُحذف الفرع كلياً من بناء الإنتاج.
    if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
      setStatus({
        state: 'active',
        license: {
          v: 1,
          keyId: 0,
          plan: 'monthly',
          deviceId: 'dev-preview',
          activatedAt: Date.now(),
          expiresAt: Date.now() + 30 * 86400_000,
        },
        remainingMs: 30 * 86400_000,
        offlineHours: 0,
        lockReason: null,
        revoked: false,
      });
      return Promise.resolve();
    }
    // v59: تُنتظر النتيجة أثناء الإقلاع — لا وميض لشاشة التفعيل عند
    // من لديه ترخيص نشط (كانت تظهر لحظة ثم تختفي).
    return evaluate().then(setStatus);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await initStorage();
        await installGlobalScanner(
          useSettingsStore.getState().settings.scannerMinLength,
        );
        await api.bootstrap().catch(() => null);
        // v59: ننتظر حالة الترخيص قبل إظهار الواجهة — لا وميض.
        await refreshStatus();
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
        // v58 (الجولة 62): خادم الكاشير على الشبكة المحلية — يعمل
        // تلقائياً فقط إن فعّله المدير من شاشة الكاشير.
        try {
          const {LanServerService} = await import(
            './services/lan/LanServerService'
          );
          void LanServerService.ensureStarted();
        } catch {
          /* خادم الكاشير غير مفعّل */
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

  // v61 (الجولة 26 #1): مفتاح «+» يفتح نقطة البيع مباشرة من أي شاشة —
  // بدل زر الزائد العائم الذي حُذف. لا يعمل أثناء الكتابة في حقل،
  // ولا فوق نافذة حوار مفتوحة، ولا داخل نقطة البيع نفسها.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screen === 'pos') return;
      // + من الصف العلوي (Shift+=) أو من لوحة الأرقام الجانبية.
      if (e.key !== '+' && e.code !== 'NumpadAdd' && e.code !== 'Equal') {
        return;
      }
      if (e.key !== '+') return; // Equal بلا Shift لا يُحتسب
      const target = e.target as HTMLElement | null;
      if (
        target != null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      // نافذة حوار مفتوحة؟ لا نبدّل الشاشة خلفها.
      if (document.querySelector('.overlay, .pinpad-overlay') != null) {
        return;
      }
      e.preventDefault();
      setScreen('pos');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  // v65: F11 يبدّل ملء الشاشة الحقيقي — النافذة تفتح مكبَّرة تملأ
  // الشاشة (طلب التاجر)، وF11 للمزيد: إخفاء شريط العنوان كلياً.
  useEffect(() => {
    const onFullscreenKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onFullscreenKey);
    return () => window.removeEventListener('keydown', onFullscreenKey);
  }, []);

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
      <ErrorBoundary label="شاشة التفعيل">
        <ActivationScreen status={status} onRefresh={refreshStatus} />
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
        <NotificationPopups />
      </ErrorBoundary>
    );
  }

  return (
    <AppLockGate>
      {status.state === 'grace' && (
        <div className="state-banner">
          <Icon name="alert" size={17} />
          <span>
            العمل دون إنترنت منذ {Math.round(status.offlineHours)} ساعة — يظل
            النظام يعمل حتى 72 ساعة، بعدها يلزم الاتصال بالسيرفر مرة واحدة.
          </span>
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
              <span className="icon">
                <Icon name={item.icon} />
              </span>
              <span className="label">{item.label}</span>
              {item.key === 'notifications' && unread > 0 && (
                <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>
              )}
              {item.key === 'sila' && silaPaired && (
                <span className="dot-ok" title="مقترن بخدمة صِلة" />
              )}
            </button>
          ))}
          <div className="nav-spacer" />
          <button
            className="nav-item"
            onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
            title={themeMode === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}>
            <span className="icon">
              <Icon name={themeMode === 'dark' ? 'sun' : 'moon'} />
            </span>
            <span className="label">
              {themeMode === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
            </span>
          </button>
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
            <ErrorBoundary label="نقطة البيع">
              <PosScreen />
            </ErrorBoundary>
          ) : (
            <div style={{flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0}}>
              {screen === 'home' && (
                <ErrorBoundary label="الرئيسية">
                  <HomeScreen goTo={key => setScreen(key as ScreenKey)} />
                </ErrorBoundary>
              )}
              {screen === 'invoices' && (
                <ErrorBoundary label="الفواتير">
                  <InvoicesScreen />
                </ErrorBoundary>
              )}
              {screen === 'online-orders' && (
                <ErrorBoundary label="الطلبات أونلاين">
                  <OnlineOrdersScreen />
                </ErrorBoundary>
              )}
              {screen === 'online-products' && (
                <ErrorBoundary label="منتجات أونلاين">
                  <OnlineProductsScreen />
                </ErrorBoundary>
              )}
              {screen === 'online-selling' && (
                <ErrorBoundary label="البيع أونلاين">
                  <OnlineSellingScreen goTo={key => setScreen(key as ScreenKey)} />
                </ErrorBoundary>
              )}
              {screen === 'inventory' && (
                <ErrorBoundary label="المخزون">
                  <InventoryScreen />
                </ErrorBoundary>
              )}
              {screen === 'stocktake' && (
                <ErrorBoundary label="الجرد">
                  <StocktakeScreen />
                </ErrorBoundary>
              )}
              {screen === 'debts' && (
                <ErrorBoundary label="ديون المتجر">
                  <LocalDebtsScreen />
                </ErrorBoundary>
              )}
              {screen === 'cash' && (
                <ErrorBoundary label="الخزينة">
                  <CashMovementsScreen />
                </ErrorBoundary>
              )}
              {screen === 'sila' && (
                <ErrorBoundary label="صِلة والقسائم">
                  <SilaScreen />
                </ErrorBoundary>
              )}
              {screen === 'stock-alerts' && (
                <ErrorBoundary label="تنبيهات المخزون">
                  <StockAlertsScreen goTo={key => setScreen(key as ScreenKey)} />
                </ErrorBoundary>
              )}
              {screen === 'reports' && (
                <ErrorBoundary label="التقارير">
                  <ReportsScreen />
                </ErrorBoundary>
              )}
              {screen === 'notifications' && (
                <ErrorBoundary label="الإشعارات">
                  <NotificationsScreen goTo={key => setScreen(key as ScreenKey)} />
                </ErrorBoundary>
              )}
              {screen === 'cashiers' && (
                <ErrorBoundary label="الكاشير">
                  <CashiersScreen />
                </ErrorBoundary>
              )}
              {screen === 'settings' && (
                <ErrorBoundary label="الإعدادات">
                  <SettingsScreen goTo={key => setScreen(key as ScreenKey)} />
                </ErrorBoundary>
              )}
            </div>
          )}
        </main>
      </div>
      {/* v61 (الجولة 26 #1): زر الزائد العائم حُذف بطلب التاجر —
          مفتاح «+» في الكيبورد يفتح نقطة البيع من أي شاشة (المعالج
          أدناه في useEffect). */}
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
      ))}
      <NotificationPopups />
    </AppLockGate>
  );
}
