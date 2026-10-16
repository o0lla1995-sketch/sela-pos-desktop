/**
 * screens/HomeScreen.tsx — لوحة المتجر (UI-5 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * منطق HomeScreen الأندرويد v57 منقولاً إلى React DOM:
 *
 *  • مؤشرات اليوم (ReportService.loadBundle('today')): الإيراد، صافي
 *    الربح، عدد الفواتير (+ المتوسط)، عدد الأصناف (+ الخصومات) —
 *    الإرجاعات تُخصم من يوم الفاتورة الأصلية تلقائياً.
 *  • بطاقات v57: النقد المتوقع بالخزينة الآن (CashService
 *    .drawerNowMinor)، ديون المتجر المحلية القائمة (LocalDebtsRepo
 *    .totals)، ديون صِلة من دفاتر هذا المتجر (SilaRepo
 *    .storeOwnOutstandingTotal — لا أرصدة الخادم المختلطة) + بانتظار
 *    المزامنة، وطلبات البيع أونلاين الجديدة (OnlineRepo
 *    .newOrdersCount + outstandingTotals).
 *  • تنبيهات المخزون والصلاحية (StockAlertsService): نفد/منخفض/
 *    منتهي/قرب الانتهاء مع زر «كل التنبيهات» → المخزون.
 *  • آخر الفواتير + إجراءات سريعة (بيع جديد / جرد / تقارير /
 *    طلبات أونلاين) + تحديث دوري كل 30 ثانية.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  useCatalogStore,
  StockAlertsService,
} from '../state/appStores';
import {useSettingsStore} from '../stores/settingsStore';
import {useSilaStore} from '../stores/silaStore';
import {ReportService} from '../services/ReportService';
import {CashService} from '../services/CashService';
import {SaleRepo} from '../database/repositories/SaleRepo';
import {LocalDebtsRepo} from '../database/repositories/LocalDebtsRepo';
import {SilaRepo} from '../services/sila/SilaRepo';
import {OnlineRepo} from '../database/repositories/OnlineRepo';
import {Icon, type IconName} from '../components/Icon';
import {
  APP_NAME_AR,
  APP_VERSION_LABEL,
  BASE_UNIT_NAME,
} from '../core/config';
import {formatMoney, formatQty, relativeTime} from '../core/format';
import type {ReportSummary, SaleRecord} from '../core/types';
import './invoiceshome.css';

/** تسمية حالة التنبيه (مخزون وصلاحية) — نفس نصوص الأندرويد v32. */
function alertText(alert: {
  state: string;
  days?: number;
  stock: number;
  byWeight: boolean;
}): {label: string; tone: 'danger' | 'warn'} {
  switch (alert.state) {
    case 'out':
      return {label: 'نفد المخزون', tone: 'danger'};
    case 'expired':
      return {
        label:
          alert.days === 0
            ? 'تنتهي صلاحيته اليوم'
            : `منتهي الصلاحية منذ ${Math.abs(alert.days ?? 0)} يوم`,
        tone: 'danger',
      };
    case 'expiring':
      return {
        label: `قرب انتهاء الصلاحية — باقي ${alert.days ?? 0} يوم`,
        tone: 'warn',
      };
    default:
      return {
        label: `مخزون منخفض — بقي ${formatQty(alert.stock)} ${
          alert.byWeight ? 'كغ' : BASE_UNIT_NAME
        }`,
        tone: 'warn',
      };
  }
}

export function HomeScreen({goTo}: {goTo: (screen: string) => void}) {
  const settings = useSettingsStore(s => s.settings);
  const products = useCatalogStore(s => s.products);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const silaPairing = useSilaStore(s => s.pairing);
  const paired = silaPairing != null;

  // ── البيانات ─────────────────────────────────────────────────
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [recent, setRecent] = useState<SaleRecord[]>([]);
  const [drawerMinor, setDrawerMinor] = useState<number | null>(null);
  const [localBook, setLocalBook] = useState<{
    outstandingMinor: number;
    debtorsCount: number;
  } | null>(null);
  // صِلة — أرقام هذا المتجر من الدفاتر المحلية (لا أرصدة الخادم).
  const [silaDebt, setSilaDebt] = useState<{
    outstandingMinor: number;
    debtorsCount: number;
    lastSyncedAt: string | null;
  } | null>(null);
  const [silaPendingTotals, setSilaPendingTotals] = useState<{
    count: number;
    minor: number;
  } | null>(null);
  // البيع أونلاين — التفعيل + الطلبات الجديدة + الدين المؤقت.
  const [online, setOnline] = useState<{
    enabled: boolean;
    newCount: number;
    outstandingMinor: number;
    outstandingCount: number;
  } | null>(null);
  // يُرفع بعد كل evaluate كي تُقرأ التنبيهات من نسخة الكتالوج الجديدة.
  const [alertsTick, setAlertsTick] = useState(0);

  const load = useCallback(async () => {
    // البيع أونلاين — أفضل جهد كامل: لا يعطّل تحميل الرئيسية أبداً.
    try {
      const {loadOnlineSettings} = await import(
        '../services/online/OnlineStoreService'
      );
      const [newCount, outstanding] = await Promise.all([
        OnlineRepo.newOrdersCount(),
        OnlineRepo.outstandingTotals(),
      ]);
      setOnline({
        enabled: loadOnlineSettings().enabled,
        newCount,
        outstandingMinor: outstanding.minor,
        outstandingCount: outstanding.count,
      });
    } catch {
      // Online best-effort only.
    }
    try {
      const [todayBundle, latest, drawer, localTotals] = await Promise.all([
        ReportService.loadBundle('today'),
        SaleRepo.listRecent(8),
        CashService.drawerNowMinor(),
        LocalDebtsRepo.totals(),
      ]);
      setSummary(todayBundle.summary);
      setRecent(latest);
      setDrawerMinor(drawer);
      setLocalBook({
        outstandingMinor: localTotals.outstandingMinor,
        debtorsCount: localTotals.debtorsCount,
      });
      // صِلة: الدين القائم من دفاتر هذا المتجر تحديداً — فواتير
      // المتجر مطروحاً منها سدادّاته وتحصيلات التطبيق وعكس
      // المرتجعات (v32) — تُقرأ عند الاقتران فقط.
      const [silaTotals, ownTotals, queueTotals] = await Promise.all([
        SilaRepo.customersOutstandingTotal(),
        SilaRepo.storeOwnOutstandingTotal(),
        SilaRepo.totals(),
      ]);
      setSilaDebt({
        outstandingMinor: Math.max(0, ownTotals.ownMinor),
        debtorsCount: ownTotals.debtorsCount,
        lastSyncedAt: silaTotals.lastSyncedAt,
      });
      setSilaPendingTotals({
        count: queueTotals.pendingCount,
        minor: queueTotals.pendingMinor,
      });
    } catch {
      // اللوحة معلوماتية — تبقى البيانات المعروضة سابقاً.
    }
    // تقييم التنبيهات بعد كل تحميل (يوم جديد/مخزون تغيّر).
    try {
      await StockAlertsService.evaluate();
      setAlertsTick(v => v + 1);
    } catch {
      // لا يعطّل شيئاً.
    }
  }, []);

  useEffect(() => {
    if (products.length === 0) {
      void refreshCatalog();
    }
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alerts = useMemo(
    () => StockAlertsService.activeAlerts(20),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, alertsTick],
  );
  const outCount = alerts.filter(a => a.state === 'out').length;
  const lowCount = alerts.filter(a => a.state === 'low').length;
  const expiredCount = alerts.filter(a => a.state === 'expired').length;
  const expiringCount = alerts.filter(a => a.state === 'expiring').length;

  const onlineEnabled = online?.enabled ?? false;
  const onlineNewCount = online?.newCount ?? 0;

  const netProfit = summary?.netProfit ?? 0;

  return (
    <div className="screen">
      <h1>لوحة المتجر</h1>
      <div className="subtitle">
        {settings.storeName} · ملخص اليوم والخزينة والديون وتنبيهات المخزون —
        يتحدث تلقائياً كل 30 ثانية
      </div>

      {/* ── مؤشرات اليوم ──────────────────────────────────────── */}
      <div className="grid-4">
        <div className="card kpi">
          <span className="label">إيراد اليوم</span>
          <span className="value brand">
            {formatMoney(summary?.revenue ?? 0)}
          </span>
          <span className="label">
            فواتير اليوم شاملة الديون — المرتجعات تُخصم من يوم فاتورتها
          </span>
        </div>
        <div className="card kpi">
          <span className="label">صافي ربح اليوم</span>
          <span className={`value ${netProfit >= 0 ? 'ok' : ''}`} style={netProfit < 0 ? {color: 'var(--danger)'} : undefined}>
            {formatMoney(netProfit)}
          </span>
          <span className="label">بعد تكلفة البضاعة والخصومات</span>
        </div>
        <div className="card kpi">
          <span className="label">فواتير اليوم</span>
          <span className="value">{summary?.invoicesCount ?? 0}</span>
          <span className="label">
            متوسط الفاتورة {formatMoney(summary?.avgInvoice ?? 0)}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">أصناف مبيعة</span>
          <span className="value">{summary?.itemsCount ?? 0}</span>
          <span className="label">
            خصومات اليوم {formatMoney(summary?.discountTotal ?? 0)}
            {(summary?.returnsCount ?? 0) > 0 &&
              ` · مرتجعات ${summary?.returnsCount} (${formatMoney(
                summary?.returnsTotal ?? 0,
              )})`}
          </span>
        </div>
      </div>

      {/* ── بطاقات v57: الخزينة والديون والطلبات ──────────────── */}
      <div className="grid-4" style={{marginTop: 14}}>
        <div className="card kpi">
          <span className="label">النقد المتوقع بالخزينة الآن</span>
          <span className={`value ${(drawerMinor ?? 0) >= 0 ? 'ok' : ''}`} style={(drawerMinor ?? 0) < 0 ? {color: 'var(--danger)'} : undefined}>
            {drawerMinor == null ? '…' : formatMoney(drawerMinor / 100)}
          </span>
          <span className="label">
            مبيعات نقدية + تحصيلات − مصروفات ومسحوبات — لحظة بلحظة
          </span>
        </div>
        <div className="card kpi">
          <span className="label">ديون المتجر المحلية القائمة</span>
          <span className="value" style={{color: 'var(--warn)'}}>
            {formatMoney((localBook?.outstandingMinor ?? 0) / 100)}
          </span>
          <span className="label">
            {localBook?.debtorsCount ?? 0} زبون مدين — دفتر المتجر (INV-L)
          </span>
        </div>
        <div className="card kpi">
          <span className="label">ديون صِلة القائمة</span>
          {paired ? (
            <>
              <span className="value" style={{color: 'var(--warn)'}}>
                {formatMoney((silaDebt?.outstandingMinor ?? 0) / 100)}
              </span>
              <span className="label">
                {silaDebt?.debtorsCount ?? 0} زبون مدين — فواتير هذا المتجر
                فقط
                {silaDebt?.lastSyncedAt != null &&
                  ` · محدّثة ${relativeTime(silaDebt.lastSyncedAt)}`}
              </span>
              {(silaPendingTotals?.count ?? 0) > 0 && (
                <span className="chip warn" style={{alignSelf: 'flex-start'}}>
                  {silaPendingTotals?.count} عملية بانتظار مزامنة صِلة (
                  {formatMoney((silaPendingTotals?.minor ?? 0) / 100)})
                </span>
              )}
            </>
          ) : (
            <>
              <span className="value" style={{color: 'var(--muted)'}}>
                —
              </span>
              <span className="label">
                اربط تطبيق صِلة من صفحة «صِلة والقسائم» لمزامنة الديون
                والتحصيلات سحابياً
              </span>
            </>
          )}
        </div>
        <div className="card kpi">
          <span className="label">طلبات أونلاين جديدة</span>
          <span className={`value ${onlineNewCount > 0 ? 'brand' : ''}`}>
            {onlineEnabled ? onlineNewCount : '—'}
          </span>
          <span className="label">
            {onlineEnabled
              ? (online?.outstandingCount ?? 0) > 0
                ? `+ ${(online?.outstandingCount ?? 0)} طلب مُرسل بانتظار التسليم — دين مؤقت ${formatMoney(
                    (online?.outstandingMinor ?? 0) / 100,
                  )}`
                : 'لا طلبات مُرسلة بانتظار التسليم'
              : 'البيع أونلاين غير مفعّل — فعّله من شاشة البيع أونلاين'}
          </span>
        </div>
      </div>

      {/* ── إجراءات سريعة ─────────────────────────────────────── */}
      <div className="ih-section-head">
        <b>إجراءات سريعة</b>
      </div>
      <div className="ih-quick-grid">
        <button
          className="ih-quick-card accent"
          title="فتح نقطة البيع مباشرة"
          onClick={() => goTo('pos')}>
          <span className="ih-quick-icon"><Icon name="plus" size={26} /></span>
          <span className="ih-quick-label">بيع جديد</span>
        </button>
        <button className="ih-quick-card" onClick={() => goTo('stocktake')}>
          <span className="ih-quick-icon"><Icon name="clipboard" size={26} /></span>
          <span className="ih-quick-label">جرد</span>
        </button>
        <button className="ih-quick-card" onClick={() => goTo('reports')}>
          <span className="ih-quick-icon"><Icon name="chart" size={26} /></span>
          <span className="ih-quick-label">تقارير</span>
        </button>
        {onlineEnabled && (
          <button
            className="ih-quick-card"
            onClick={() => goTo('online-orders')}>
            <span className="ih-quick-icon"><Icon name="basket" size={26} /></span>
            <span className="ih-quick-label">طلبات أونلاين</span>
            {onlineNewCount > 0 && (
              <span className="ih-online-badge">
                {onlineNewCount > 99 ? '99+' : onlineNewCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── تنبيهات المخزون والصلاحية ─────────────────────────── */}
      <div className="ih-section-head">
        <b>تنبيهات المخزون</b>
        <span className="hint">
          {alerts.length > 0
            ? expiredCount + expiringCount > 0
              ? `${alerts.length} منتج يحتاج انتباهاً — مخزون أو صلاحية`
              : `${alerts.length} منتج يحتاج إعادة تزويد`
            : 'كل المنتجات فوق حدود التنبيه — لا إجراء مطلوب'}
        </span>
        {outCount > 0 && <span className="chip danger">نفد {outCount}</span>}
        {lowCount > 0 && <span className="chip warn">منخفض {lowCount}</span>}
        {expiredCount > 0 && (
          <span className="chip danger">منتهي {expiredCount}</span>
        )}
        {expiringCount > 0 && (
          <span className="chip warn">قرب الانتهاء {expiringCount}</span>
        )}
        <button className="btn sm ghost" onClick={() => goTo('inventory')}>
          كل التنبيهات
        </button>
      </div>
      {alerts.length > 0 ? (
        <div className="ih-alerts-col">
          {alerts.slice(0, 6).map(({product, state, days}) => {
            const {label, tone} = alertText({
              state,
              days,
              stock: product.stock_quantity,
              byWeight: product.sold_by_weight === 1,
            });
            return (
              <div
                key={`${product.id}:${state}`}
                className={`ih-alert-row ${tone}`}>
                <span className={`ih-alert-icon ${tone}`}>
                  <Icon
                    name={
                      state === 'out'
                        ? 'packageMinus'
                        : state === 'expired' || state === 'expiring'
                        ? 'clock'
                        : 'alert'
                    }
                    size={20}
                  />
                </span>
                <div className="ih-alert-texts">
                  <div className="ih-alert-name">{product.name}</div>
                  <div className="ih-alert-meta">
                    {label}
                    {state === 'low' &&
                      ` · الحد ${formatQty(
                        product.low_stock_threshold ??
                          settings.lowStockDefaultThreshold,
                      )}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <div className="ih-hint">
            لا تنبيهات — كل المنتجات فوق حدود المخزون والصلاحية.
          </div>
        </div>
      )}

      {/* ── آخر الفواتير ──────────────────────────────────────── */}
      <div className="ih-section-head">
        <b>آخر الفواتير</b>
        <span className="hint">اضغط أي فاتورة لمراجعتها بالتفصيل</span>
        <button className="btn sm ghost" onClick={() => goTo('invoices')}>
          كل الفواتير
        </button>
      </div>
      <div className="card" style={{padding: '6px 16px'}}>
        {recent.length === 0 && (
          <div className="ih-empty-sm">
            لا فواتير بعد — أول بيع من نقطة البيع سيظهر هنا فوراً
          </div>
        )}
        {recent.map(sale => (
          <div
            key={sale.id}
            className="ih-recent-row"
            onClick={() => goTo('invoices')}>
            <div className="ih-recent-main">
              <span className="ih-ref">{sale.invoice_number}</span>
              <div className="ih-mut">{relativeTime(sale.created_at)}</div>
            </div>
            {(sale.returned_minor ?? 0) > 0 && (
              <span className="chip warn">
                مرتجع {formatMoney((sale.returned_minor ?? 0) / 100)}
              </span>
            )}
            <span className="ih-recent-amount">
              {formatMoney(sale.total_amount)}
            </span>
          </div>
        ))}
      </div>

      <div className="ih-version">
        {APP_NAME_AR} · الإصدار {APP_VERSION_LABEL} · يعمل دون إنترنت
      </div>
    </div>
  );
}
