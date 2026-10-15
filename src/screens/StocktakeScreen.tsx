/**
 * StocktakeScreen.tsx — الجرد (منقول من StocktakeScreen الأندرويد):
 * جلسة تلتقط صورة المخزون، عدّ بالبحث والتصفية، إقفال مع/بدون تطبيق
 * الفروقات — نفس دلالات StocktakeRepo.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {api} from '../lib/tauri';
import {useToastStore, useNotificationsStore, useCatalogStore} from '../state/appStores';
import {formatDateTime} from '../core/format';
import type {Stocktake, StocktakeItem} from '../core/types';

interface SummaryShape {
  total_items: number;
  counted_items: number;
  matched_items: number;
  shortage_items: number;
  surplus_items: number;
  total_system: number;
  total_counted: number;
}

export function StocktakeScreen() {
  const toast = useToastStore(s => s.show);
  const notify = useNotificationsStore(s => s.push);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const products = useCatalogStore(s => s.products);

  const [sessions, setSessions] = useState<Stocktake[]>([]);
  const [active, setActive] = useState<Stocktake | null>(null);
  const [items, setItems] = useState<StocktakeItem[]>([]);
  const [search, setSearch] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [summary, setSummary] = useState<SummaryShape | null>(null);

  const reloadSessions = useCallback(async () => {
    try {
      const list = await api.listStocktakes(30);
      setSessions(list);
      setActive(prev => (prev ? list.find(s => s.id === prev.id) ?? null : null));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [toast]);

  useEffect(() => {
    void reloadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadItems = useCallback(async () => {
    if (active == null) return;
    try {
      const [list, sum] = await Promise.all([
        api.listStocktakeItems(active.id, search, 'all', onlyPending),
        api.stocktakeSummary(active.id),
      ]);
      setItems(list);
      setSummary(sum as SummaryShape);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [active, search, onlyPending, toast]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const start = async () => {
    try {
      const session = await api.startStocktake();
      toast(`جلسة جرد #${session.id}`, 'success');
      setActive(session);
      setSearch('');
      setOnlyPending(false);
      void reloadSessions();
      void loadItems();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const setCounted = (item: StocktakeItem, value: string) => {
    if (active == null) return;
    const counted = value.trim() === '' ? null : Number(value);
    if (counted != null && !Number.isFinite(counted)) return;
    void api
      .setCounted(active.id, item.product_id, counted)
      .then(() => loadItems())
      .catch(e => toast(String(e), 'error'));
  };

  const complete = (applyAdjustments: boolean) => {
    if (active == null) return;
    const counted = summary?.counted_items ?? 0;
    if (counted === 0) {
      toast('لم يُعدّ أي صنف بعد — عدّ أولاً ثم أقفل', 'error');
      return;
    }
    const label = applyAdjustments
      ? 'إقفال الجرد وتطبيق الفروقات على المخزون؟'
      : 'إقفال الجرد بلا تعديل المخزون؟';
    if (!window.confirm(label)) return;
    void api
      .completeStocktake(active.id, applyAdjustments)
      .then(adjusted => {
        toast(
          applyAdjustments
            ? `أُقفلت الجلسة وعدّل مخزون ${adjusted} منتجاً`
            : 'أُقفلت الجلسة بلا تعديل',
          'success',
        );
        notify(
          'stocktake',
          'إقفال جلسة جرد',
          applyAdjustments ? `طُبّقت فروقات ${adjusted} منتجاً` : 'إقفال بلا تطبيق فروقات',
        );
        setActive(null);
        void refreshCatalog();
        void reloadSessions();
      })
      .catch(e => toast(String(e), 'error'));
  };

  return (
    <div className="screen">
      <h1>الجرد</h1>
      <div className="subtitle">
        عدّ المخزون فعلياً وقيّد الفروقات — الجلسة تلتقط صورة الرصيد لحظة بدئها
      </div>

      <div className="toolbar">
        {active == null ? (
          <button className="btn primary" onClick={() => void start()}>
            بدء جلسة جرد جديدة
          </button>
        ) : (
          <>
            <span className="chip brand">جلسة #{active.id} مفتوحة</span>
            <span className="chip muted">بدأت {formatDateTime(active.started_at)}</span>
            <span className="grow" />
            <button className="btn" onClick={() => complete(false)}>
              إقفال بلا تعديل
            </button>
            <button className="btn primary" onClick={() => complete(true)}>
              إقفال وتطبيق الفروقات
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (window.confirm('إلغاء الجلسة وحذفها؟')) {
                  void api
                    .cancelStocktake(active.id)
                    .then(() => {
                      setActive(null);
                      void reloadSessions();
                    })
                    .catch(e => toast(String(e), 'error'));
                }
              }}>
              إلغاء الجلسة
            </button>
          </>
        )}
      </div>

      {active != null && (
        <>
          {summary != null && (
            <div className="grid-4" style={{marginBottom: 14}}>
              <div className="card kpi">
                <span className="label">تم عدّه</span>
                <span className="value">
                  {summary.counted_items}/{summary.total_items}
                </span>
              </div>
              <div className="card kpi">
                <span className="label">مطابق</span>
                <span className="value ok">{summary.matched_items}</span>
              </div>
              <div className="card kpi">
                <span className="label">عجز</span>
                <span className="value" style={{color: 'var(--danger)'}}>
                  {summary.shortage_items}
                </span>
              </div>
              <div className="card kpi">
                <span className="label">زيادة</span>
                <span className="value" style={{color: 'var(--warn)'}}>
                  {summary.surplus_items}
                </span>
              </div>
            </div>
          )}

          <div className="toolbar">
            <input
              placeholder="ابحث في بنود الجرد…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)', minWidth: 260}}
            />
            <label style={{display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-soft)', fontSize: 12.5}}>
              <input
                type="checkbox"
                checked={onlyPending}
                onChange={e => setOnlyPending(e.target.checked)}
              />
              عرض غير المعدود فقط
            </label>
          </div>

          <table className="data">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>رصيد النظام</th>
                <th>العدّ الفعلي</th>
                <th>الفرق</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const diff =
                  item.counted_qty != null ? item.counted_qty - item.system_qty : null;
                return (
                  <tr key={item.id}>
                    <td>{item.product_name}</td>
                    <td>{item.system_qty}</td>
                    <td>
                      <input
                        dir="ltr"
                        defaultValue={item.counted_qty?.toString() ?? ''}
                        placeholder="—"
                        onBlur={e => setCounted(item, e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        style={{
                          width: 110, padding: '6px 10px', textAlign: 'center',
                          background: 'var(--bg)', border: '1px solid var(--line)',
                          borderRadius: 8, color: 'var(--ink)',
                        }}
                      />
                    </td>
                    <td>
                      {diff == null ? (
                        <span className="chip muted">لم يُعدّ</span>
                      ) : diff === 0 ? (
                        <span className="chip ok">مطابق</span>
                      ) : diff < 0 ? (
                        <span className="chip danger">{diff}</span>
                      ) : (
                        <span className="chip warn">+{diff}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {active == null && (
        <>
          <b style={{display: 'block', margin: '10px 0 8px'}}>الجلسات السابقة</b>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>بدأت</th>
                <th>أُقفلت</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{formatDateTime(s.started_at)}</td>
                  <td>{s.completed_at ? formatDateTime(s.completed_at) : '—'}</td>
                  <td>
                    <span className={`chip ${s.status === 'open' ? 'brand' : 'ok'}`}>
                      {s.status === 'open' ? 'مفتوحة' : 'مكتملة'}
                    </span>
                  </td>
                </tr>
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">
                      <div className="icon">📋</div>
                      لا جلسات جرد بعد — ابدأ أولى الجلسات أعلاه
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
