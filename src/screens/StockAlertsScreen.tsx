/**
 * screens/StockAlertsScreen.tsx — تنبيهات المخزون (UI-7 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * منقولة من StockAlertsScreen الأندرويد (v33→v57): كل المنتجات في
 * حالة تنبيه (مخزون أو صلاحية) مع فلاتر النوع وعدّاد لكل حالة،
 * بترتيب الخطورة نفسه (منتهي ← نفد ← قرب انتهاء ← منخفض) — القائمة
 * تُعاد تقييمها عند الدخول ومع كل تحديث للكتالوج.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  StockAlertsService,
  useCatalogStore,
} from '../state/appStores';
import type {AlertState, StockAlert} from '../services/StockAlertsService';
import {useSettingsStore} from '../stores/settingsStore';
import {formatDate, formatMoney, formatQty} from '../core/format';
import {BASE_UNIT_NAME} from '../core/config';
import {baseUnitLabelOf} from '../core/types';
import './settingsv57.css';

/** الفلاتر — نفس ترتيب الخطورة (منتهي ← نفد ← قرب انتهاء ← منخفض). */
type AlertFilter = 'all' | AlertState;

const FILTERS: {key: AlertFilter; label: string}[] = [
  {key: 'all', label: 'الكل'},
  {key: 'expired', label: 'منتهي الصلاحية'},
  {key: 'out', label: 'نفد المخزون'},
  {key: 'expiring', label: 'قرب انتهاء الصلاحية'},
  {key: 'low', label: 'مخزون منخفض'},
];

const STATE_LABELS: Record<AlertState, string> = {
  expired: 'منتهي الصلاحية',
  out: 'نفد المخزون',
  expiring: 'قرب الانتهاء',
  low: 'مخزون منخفض',
};

/** نص حالة التنبيه لكل صف — نفس صياغة الأندرويد. */
function stateTextOf(alert: StockAlert): string {
  const days = alert.days ?? 0;
  switch (alert.state) {
    case 'expired':
      return days === 0
        ? 'تنتهي صلاحيته اليوم'
        : `منتهي الصلاحية منذ ${Math.abs(days)} يوم`;
    case 'out':
      return 'نفد المخزون — الكمية وصلت الصفر';
    case 'expiring':
      return days === 0
        ? 'تنتهي صلاحيته اليوم'
        : `قرب انتهاء الصلاحية — باقي ${days} يوم`;
    case 'low':
      return `${formatQty(alert.product.stock_quantity)} ${baseUnitLabelOf(
        alert.product,
        BASE_UNIT_NAME,
      )} متبقية`;
    default:
      return '';
  }
}

export function StockAlertsScreen({goTo}: {goTo?: (key: string) => void}) {
  const settings = useSettingsStore(s => s.settings);
  const products = useCatalogStore(s => s.products);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const [filter, setFilter] = useState<AlertFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  /** إعادة التقييم عند الدخول (لمزامنة القائمة مع الكتالوج). */
  useEffect(() => {
    void StockAlertsService.evaluate();
  }, [products.length]);

  const allAlerts = useMemo(
    () => StockAlertsService.activeAlerts(200),
    [products, settings],
  );

  const counts = useMemo(() => {
    const map: Record<AlertFilter, number> = {
      all: allAlerts.length,
      expired: 0,
      out: 0,
      expiring: 0,
      low: 0,
    };
    for (const alert of allAlerts) {
      map[alert.state] += 1;
    }
    return map;
  }, [allAlerts]);

  const filtered = useMemo(
    () =>
      filter === 'all'
        ? allAlerts
        : allAlerts.filter(a => a.state === filter),
    [allAlerts, filter],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCatalog();
      await StockAlertsService.evaluate();
    } finally {
      setRefreshing(false);
    }
  }, [refreshCatalog]);

  return (
    <div className="screen">
      <h1>تنبيهات المخزون</h1>
      <div className="subtitle">
        {counts.all} منتج يحتاج انتباهك — مخزون منخفض أو نفد أو صلاحية
      </div>

      {/* رأس العدادات المجمّعة + التحديث */}
      <div className="toolbar">
        <span className="chip danger">نفد {counts.out}</span>
        <span className="chip warn">منخفض {counts.low}</span>
        <span className="chip danger">منتهي {counts.expired}</span>
        <span className="chip warn">قرب الانتهاء {counts.expiring}</span>
        <span className="grow" />
        {goTo != null ? (
          <button className="btn sm ghost" onClick={() => goTo('inventory')}>
            إدارة المخزون ←
          </button>
        ) : (
          <span className="sv57-sec-hint">
            عالج التنبيهات من شاشة المخزون
          </span>
        )}
        <button
          className="btn"
          disabled={refreshing}
          onClick={() => void refresh()}>
          {refreshing ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      </div>

      {/* فلاتر النوع */}
      <div className="toolbar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`chip-toggle ${filter === f.key ? 'on' : ''}`}
            onClick={() => setFilter(f.key)}>
            {f.label}
            {f.key !== 'all' ? ` (${counts[f.key]})` : ''}
          </button>
        ))}
      </div>

      {/* القائمة */}
      {filtered.length === 0 ? (
        <div className="card">
          <div className="sv57-empty">
            <div className="icon">✅</div>
            {filter === 'all' ? (
              <>
                لا توجد تنبيهات — كل المنتجات بمخزون كافٍ وضمن مدة الصلاحية
              </>
            ) : (
              <>لا تنبيهات من هذا النوع — جرّب فلتراً آخر</>
            )}
          </div>
        </div>
      ) : (
        <div className="sv57-alert-list">
          {filtered.map(alert => {
            const danger = alert.state === 'out' || alert.state === 'expired';
            const threshold =
              alert.product.low_stock_threshold ??
              settings.lowStockDefaultThreshold;
            return (
              <div
                key={`${alert.product.id}:${alert.state}`}
                className={`sv57-alert-row ${danger ? 'danger' : ''}`}>
                <div className="texts">
                  <div className="name">{alert.product.name}</div>
                  <div className="sub">{stateTextOf(alert)}</div>
                  <div className="sub">
                    المخزون: {formatQty(alert.product.stock_quantity)} · حد
                    التنبيه: {threshold}
                    {alert.product.expiry_date != null
                      ? ` · الصلاحية: ${formatDate(alert.product.expiry_date)}`
                      : ''}
                    {` · السعر: ${formatMoney(alert.product.retail_price)}`}
                  </div>
                </div>
                <span className={`chip ${danger ? 'danger' : 'warn'}`}>
                  {STATE_LABELS[alert.state]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="sv57-chart-hint" style={{marginTop: 10}}>
        الترتيب بالخطورة: منتهي الصلاحية ← نفد المخزون ← قرب الانتهاء ←
        منخفض — وداخل كل حالة الأقل كمية/الأقرب انتهاءً أولاً. التنبيهات
        تُرسل مرة واحدة يومياً لكل منتج، وهذه الصفحة تعرض الحالة الحية
        دائماً.
      </div>
    </div>
  );
}
