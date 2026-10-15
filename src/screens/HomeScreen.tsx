/**
 * HomeScreen.tsx — لوحة اليوم (منقولة من HomeScreen الأندرويد):
 * مؤشرات اليوم، تنبيهات النقص، أحدث الفواتير، إجراءات سريعة.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {api} from '../lib/tauri';
import {
  useCatalogStore,
  useToastStore,
  StockAlertsService,
} from '../state/appStores';
import {useSettingsStore} from '../state/settingsStore';
import {formatMoney, localToday, localDateShift, localMonthStart, relativeTime} from '../core/format';
import type {ReportSummary, SaleRecord} from '../core/types';

export function HomeScreen({goTo}: {goTo: (screen: string) => void}) {
  const settings = useSettingsStore(s => s.settings);
  const products = useCatalogStore(s => s.products);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const toast = useToastStore(s => s.show);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [recent, setRecent] = useState<SaleRecord[]>([]);

  const load = useCallback(async () => {
    try {
      const today = localToday();
      const [s, latest] = await Promise.all([
        api.reportsSummary(today, today),
        api.listRecentSales(8),
      ]);
      setSummary(s);
      setRecent(latest);
      StockAlertsService.evaluate();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (products.length === 0) void refreshCatalog();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alerts = StockAlertsService.activeAlerts(8);
  const outCount = products.filter(p => p.stock_quantity <= 0).length;
  const lowCount = alerts.filter(a => a.kind === 'low').length;

  return (
    <div className="screen">
      <h1>لوحة اليوم</h1>
      <div className="subtitle">
        {settings.storeName} · ملخص أداء اليوم وتنبيهات المخزون
      </div>

      <div className="grid-4">
        <div className="card kpi">
          <span className="label">إيراد اليوم</span>
          <span className="value brand">{formatMoney(summary?.revenue ?? 0)}</span>
        </div>
        <div className="card kpi">
          <span className="label">ربح اليوم الصافي</span>
          <span className="value ok">{formatMoney(summary?.netProfit ?? 0)}</span>
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
          </span>
        </div>
      </div>

      <div style={{display: 'flex', gap: 10, margin: '16px 0'}}>
        <button className="btn primary" onClick={() => goTo('pos')}>
          ابدأ البيع (F9 من شاشة الكاشير)
        </button>
        <button className="btn" onClick={() => goTo('stocktake')}>
          جلسة جرد جديدة
        </button>
        <button className="btn" onClick={() => goTo('reports')}>
          تقارير مفصلة
        </button>
      </div>

      <div className="grid-2" style={{marginTop: 6}}>
        <div className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
            <b>تنبيهات المخزون</b>
            <span style={{display: 'flex', gap: 6}}>
              <span className="chip danger">نفد {outCount}</span>
              <span className="chip warn">منخفض {lowCount}</span>
            </span>
          </div>
          {alerts.length === 0 && (
            <div style={{color: 'var(--muted)', fontSize: 12.5}}>
              كل المنتجات فوق حدود التنبيه — لا إجراء مطلوب.
            </div>
          )}
          {alerts.slice(0, 6).map(a => (
            <div
              key={a.product.id}
              style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: '1px solid var(--line)',
                fontSize: 13,
              }}>
              <span>{a.product.name}</span>
              <span className={`chip ${a.kind === 'out' ? 'danger' : 'warn'}`}>
                {a.kind === 'out' ? 'نفد' : `بقي ${a.product.stock_quantity}`}
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
            <b>أحدث الفواتير</b>
            <button className="btn sm ghost" onClick={() => goTo('invoices')}>
              كل الفواتير
            </button>
          </div>
          {recent.length === 0 && (
            <div style={{color: 'var(--muted)', fontSize: 12.5}}>
              لا فواتير بعد — أول بيع سيظهر هنا.
            </div>
          )}
          {recent.map(sale => (
            <div
              key={sale.id}
              style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: '1px solid var(--line)',
                fontSize: 13, cursor: 'pointer',
              }}
              onClick={() => goTo('invoices')}>
              <span dir="ltr">{sale.invoice_number}</span>
              <span style={{color: 'var(--ink-soft)'}}>{relativeTime(sale.created_at)}</span>
              <b style={{color: 'var(--brand-ink)'}}>{formatMoney(sale.total_amount)}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
