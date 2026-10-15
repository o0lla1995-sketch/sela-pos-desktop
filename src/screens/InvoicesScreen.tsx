/**
 * InvoicesScreen.tsx — سجل الفواتير (§3.2): جدول متقدم قابل للتصفية
 * حسب النطاق/الدفع + إعادة طباعة حرارية + معاينة PDF عبر حوار الطباعة.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {api} from '../lib/tauri';
import {useCatalogStore, useToastStore, useNotificationsStore} from '../state/appStores';
import {useSettingsStore} from '../state/settingsStore';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  localToday,
  localDateShift,
  localMonthStart,
} from '../core/format';
import {buildReceiptJob} from '../printing/receipt';
import {printJob} from '../printing/dispatch';
import type {PricingMode, SaleRecord, SaleWithItems} from '../core/types';

type RangeKey = 'today' | 'yesterday' | 'last7' | 'thisMonth';

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  last7: 'آخر 7 أيام',
  thisMonth: 'هذا الشهر',
};

function rangeOf(key: RangeKey): {from: string; to: string} {
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
  }
}

export function InvoicesScreen() {
  const toast = useToastStore(s => s.show);
  const notify = useNotificationsStore(s => s.push);
  const products = useCatalogStore(s => s.products);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const settings = useSettingsStore(s => s.settings);

  const [range, setRange] = useState<RangeKey>('today');
  const [payFilter, setPayFilter] = useState<'all' | PricingMode>('all');
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [detail, setDetail] = useState<SaleWithItems | null>(null);
  const [showPrint, setShowPrint] = useState(false);

  const load = useCallback(async () => {
    try {
      const {from, to} = rangeOf(range);
      setSales(await api.listSalesRange(from, to));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [range, toast]);

  useEffect(() => {
    void load();
    if (products.length === 0) void refreshCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const visible = useMemo(() => {
    let list = sales;
    if (payFilter !== 'all') list = list.filter(s => s.payment_type === payFilter);
    const q = search.trim();
    if (q) {
      list = list.filter(
        s =>
          s.invoice_number.includes(q) ||
          (q.length >= 2 && String(s.total_amount).includes(q)),
      );
    }
    return list;
  }, [sales, payFilter, search]);

  const totals = useMemo(
    () => ({
      count: visible.length,
      sum: visible.reduce((a, s) => a + s.total_amount, 0),
      profit: visible.reduce((a, s) => a + s.total_profit, 0),
    }),
    [visible],
  );

  const openDetail = async (id: number) => {
    try {
      setDetail(await api.getSale(id));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const reprint = async (sale: SaleWithItems) => {
    try {
      const job = buildReceiptJob(
        {sale: sale.sale, items: sale.items, products},
        {
          storeName: settings.storeName,
          storePhone: settings.storePhone,
          footerMessage: settings.footerMessage,
          paperWidth: settings.paperWidth,
          codepage: settings.codepage,
          showProfit: settings.showProfitOnReceipt,
          storeLogoPath: settings.storeLogoPath,
          printQr: settings.printQrOnReceipt,
        },
      );
      await printJob(job);
      toast(`أُعيدت طباعة ${sale.sale.invoice_number}`, 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast(message, 'error');
      notify('printer', 'تعذرت إعادة الطباعة', message);
    }
  };

  return (
    <div className="screen">
      <h1>الفواتير والمعاملات</h1>
      <div className="subtitle">
        تصفية بالنطاق ونوع التسعير، إعادة الطباعة الحرارية، وتنزيل PDF
      </div>

      <div className="toolbar">
        {(Object.keys(RANGE_LABELS) as RangeKey[]).map(key => (
          <button
            key={key}
            className={`chip-toggle ${range === key ? 'on' : ''}`}
            onClick={() => setRange(key)}>
            {RANGE_LABELS[key]}
          </button>
        ))}
        <select
          value={payFilter}
          onChange={e => setPayFilter(e.target.value as 'all' | PricingMode)}
          className="btn"
          style={{padding: '8px 12px'}}>
          <option value="all">مفرق + جملة</option>
          <option value="RETAIL">مفرق فقط</option>
          <option value="WHOLESALE">جملة فقط</option>
        </select>
        <input
          placeholder="بحث برقم الفاتورة…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '8px 12px', background: 'var(--bg)',
            border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)',
          }}
        />
        <span className="grow" />
        <span className="chip brand">{formatMoney(totals.sum)}</span>
        <span className="chip ok">ربح {formatMoney(totals.profit)}</span>
        <span className="chip muted">{totals.count} فاتورة</span>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>التاريخ</th>
            <th>التسعير</th>
            <th>الخصم</th>
            <th>الإجمالي</th>
            <th>الربح</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visible.map(sale => (
            <tr key={sale.id} style={{cursor: 'pointer'}} onClick={() => void openDetail(sale.id)}>
              <td dir="ltr">{sale.invoice_number}</td>
              <td>{formatDateTime(sale.created_at)}</td>
              <td>
                <span className={`chip ${sale.payment_type === 'WHOLESALE' ? 'brand' : 'muted'}`}>
                  {sale.payment_type === 'WHOLESALE' ? 'جملة' : 'مفرق'}
                </span>
              </td>
              <td>{formatMoney(sale.discount)}</td>
              <td>
                <b style={{color: 'var(--brand-ink)'}}>{formatMoney(sale.total_amount)}</b>
              </td>
              <td>{formatMoney(sale.total_profit)}</td>
              <td className="row-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="btn sm"
                  onClick={() => {
                    void openDetail(sale.id);
                    setShowPrint(true);
                  }}>
                  تفاصيل
                </button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={7}>
                <div className="empty">
                  <div className="icon">🧾</div>
                  لا فواتير في هذا النطاق
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {detail != null && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" style={{width: 'min(860px, 94vw)'}}>
            <div className="modal-head">
              <b dir="ltr">{detail.sale.invoice_number}</b>
              <span style={{display: 'flex', gap: 8}}>
                <button className="btn sm" onClick={() => void reprint(detail)}>
                  إعادة طباعة حرارية
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    setShowPrint(true);
                    setTimeout(() => window.print(), 60);
                  }}>
                  معاينة / PDF
                </button>
                <button className="btn sm ghost" onClick={() => setDetail(null)}>✕</button>
              </span>
            </div>
            <div className="modal-body">
              {showPrint && (
                <div className="print-area">
                  <div className="invoice-sheet">
                    <div style={{textAlign: 'center'}}>
                      <b style={{fontSize: 18}}>{settings.storeName || 'sela'}</b>
                      <div style={{fontSize: 11, color: '#666'}}>
                        {settings.storePhone && `Tel: ${settings.storePhone} · `}
                        {formatDate(detail.sale.created_at.split(' ')[0])}
                      </div>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>الصنف</th>
                          <th>الكمية</th>
                          <th>سعر الوحدة</th>
                          <th>الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map(item => {
                          const name =
                            products.find(p => p.id === item.product_id)?.name ?? `#${item.product_id}`;
                          return (
                            <tr key={item.id}>
                              <td>{name}{item.unit_name && item.unit_name !== 'قطعة' ? ` (${item.unit_name})` : ''}</td>
                              <td>{item.quantity}</td>
                              <td>{item.unit_price.toFixed(2)}</td>
                              <td>{item.total_line_price.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="totals">
                      <div>الخصم: {detail.sale.discount.toFixed(2)}</div>
                      <div style={{fontWeight: 800, fontSize: 17}}>
                        الإجمالي: {detail.sale.total_amount.toFixed(2)} ₪
                      </div>
                    </div>
                    <div style={{textAlign: 'center', marginTop: 12, fontSize: 11, color: '#666'}}>
                      {settings.footerMessage}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => void reprint(detail)}>
                إعادة طباعة حرارية
              </button>
              <button className="btn primary" onClick={() => window.print()}>
                طباعة / حفظ PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
