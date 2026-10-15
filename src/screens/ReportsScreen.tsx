/**
 * ReportsScreen.tsx — التقارير (§3.5): الملخص + الأعلى مبيعاً + يومي/ساعاتي
 * — نفس استعلامات ReportRepo (نطاقات محلية '00:00:00'..‪'23:59:59'‬).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {api} from '../lib/tauri';
import {useToastStore} from '../state/appStores';
import {
  formatDate,
  formatMoney,
  localToday,
  localDateShift,
  localMonthStart,
  weekdayLabel,
} from '../core/format';
import type {DailyPoint, HourlyPoint, ReportSummary, TopProduct} from '../core/types';

type RangeKey = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'custom';

const LABELS: Record<RangeKey, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  last7: 'آخر 7 أيام',
  thisMonth: 'هذا الشهر',
  custom: 'مخصص…',
};

function rangeOf(key: RangeKey, custom: {from: string; to: string}) {
  const today = localToday();
  switch (key) {
    case 'today':
      return {from: today, to: today};
    case 'yesterday': {
      const y = localDateShift(-1);
      return {from: y, to: y};
    }
    case 'last7':
      return {from: localDateShift(-6), to: today};
    case 'thisMonth':
      return {from: localMonthStart(), to: today};
    case 'custom':
      return custom;
  }
}

export function ReportsScreen() {
  const toast = useToastStore(s => s.show);
  const [range, setRange] = useState<RangeKey>('last7');
  const [custom, setCustom] = useState({from: localDateShift(-13), to: localToday()});
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [daily, setDaily] = useState<DailyPoint[]>([]);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);

  const load = useCallback(async () => {
    try {
      const {from, to} = rangeOf(range, custom);
      const [s, t, d, h] = await Promise.all([
        api.reportsSummary(from, to),
        api.reportsTop(from, to, 12),
        api.reportsDaily(from, to),
        api.reportsHourly(from, to),
      ]);
      setSummary(s);
      setTop(t);
      setDaily(d);
      setHourly(h);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [range, custom, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxRevenue = Math.max(1, ...daily.map(d => d.revenue));
  const maxHour = Math.max(1, ...hourly.map(h => h.revenue));

  return (
    <div className="screen">
      <h1>التقارير والإحصائيات</h1>
      <div className="subtitle">ملخصات الأداء والأرباح والأعلى مبيعاً</div>

      <div className="toolbar">
        {(Object.keys(LABELS) as RangeKey[]).map(key => (
          <button
            key={key}
            className={`chip-toggle ${range === key ? 'on' : ''}`}
            onClick={() => setRange(key)}>
            {LABELS[key]}
          </button>
        ))}
        {range === 'custom' && (
          <>
            <input
              type="date"
              value={custom.from}
              onChange={e => setCustom(c => ({...c, from: e.target.value}))}
              style={{padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)'}}
            />
            <input
              type="date"
              value={custom.to}
              onChange={e => setCustom(c => ({...c, to: e.target.value}))}
              style={{padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)'}}
            />
          </>
        )}
      </div>

      {summary != null && (
        <div className="grid-4">
          <div className="card kpi">
            <span className="label">الإيراد</span>
            <span className="value brand">{formatMoney(summary.revenue)}</span>
          </div>
          <div className="card kpi">
            <span className="label">تكلفة المبيعات</span>
            <span className="value">{formatMoney(summary.cogs)}</span>
          </div>
          <div className="card kpi">
            <span className="label">الربح الصافي</span>
            <span className="value ok">{formatMoney(summary.netProfit)}</span>
          </div>
          <div className="card kpi">
            <span className="label">الفواتير / متوسطها</span>
            <span className="value">
              {summary.invoicesCount} · {formatMoney(summary.avgInvoice)}
            </span>
          </div>
        </div>
      )}

      <div className="grid-2" style={{marginTop: 16}}>
        <div className="card">
          <b style={{display: 'block', marginBottom: 12}}>الإيراد اليومي</b>
          {daily.length === 0 && (
            <div style={{color: 'var(--muted)', fontSize: 12.5}}>لا بيانات في هذا النطاق.</div>
          )}
          {daily.map(point => (
            <div key={point.day} style={{marginBottom: 10}}>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4}}>
                <span>
                  {formatDate(point.day)} · {weekdayLabel(point.day)}
                </span>
                <b style={{color: 'var(--brand-ink)'}}>{formatMoney(point.revenue)}</b>
              </div>
              <div style={{height: 8, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden'}}>
                <div
                  style={{
                    height: '100%', width: `${(point.revenue / maxRevenue) * 100}%`,
                    background: 'linear-gradient(90deg, var(--brand), var(--brand-strong))',
                    borderRadius: 99,
                  }}
                />
              </div>
              <div style={{fontSize: 11, color: 'var(--muted)', marginTop: 3}}>
                ربح {formatMoney(point.profit)}
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <b style={{display: 'block', marginBottom: 12}}>ساعات الذروة</b>
          {hourly.length === 0 && (
            <div style={{color: 'var(--muted)', fontSize: 12.5}}>لا بيانات.</div>
          )}
          <div style={{display: 'flex', alignItems: 'flex-end', gap: 4, height: 150}}>
            {hourly.map(h => (
              <div
                key={h.hour}
                title={`${h.hour}:00 — ${formatMoney(h.revenue)} (${h.orders} فاتورة)`}
                style={{
                  flex: 1,
                  height: `${Math.max(4, (h.revenue / maxHour) * 100)}%`,
                  background: 'linear-gradient(180deg, var(--brand), var(--brand-strong))',
                  borderRadius: '6px 6px 0 0',
                  position: 'relative',
                }}>
                <span
                  style={{
                    position: 'absolute', bottom: -20, insetInline: 0,
                    textAlign: 'center', fontSize: 10, color: 'var(--muted)',
                  }}>
                  {h.hour}
                </span>
              </div>
            ))}
          </div>
          <div style={{height: 26}} />
        </div>
      </div>

      <div className="card" style={{marginTop: 16}}>
        <b style={{display: 'block', marginBottom: 12}}>الأعلى مبيعاً</b>
        <table className="data" style={{border: 0}}>
          <thead>
            <tr>
              <th>المنتج</th>
              <th>الكمية</th>
              <th>الإيراد</th>
              <th>الربح</th>
            </tr>
          </thead>
          <tbody>
            {top.map(p => (
              <tr key={p.productId}>
                <td>{p.name}</td>
                <td>{p.quantity}</td>
                <td>{formatMoney(p.revenue)}</td>
                <td style={{color: 'var(--ok)'}}>{formatMoney(p.profit)}</td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td colSpan={4} style={{color: 'var(--muted)'}}>لا مبيعات في النطاق.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
