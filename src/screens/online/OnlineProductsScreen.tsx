/**
 * OnlineProductsScreen.tsx — منتجات النقطة في الطلبات أونلاين (v55/v56).
 * ─────────────────────────────────────────────────────────────────
 * منقولة من شاشتَي الأندرويد إلى سطح المكتب في شاشة واحدة:
 *  • OnlineProductsScreen (v55): المنتجات المدرجة حصراً (online_listed=1)
 *    + إدراج سريع (منتقي بحث متعدد الانتقاء) + إلغاء إدراج بلمسة +
 *    تعديل سريع (ملف المنتج) + حالة المزامنة.
 *  • قسم «منتجات النقطة» (v56، الجولة 59): كل المنتجات النشطة بمفتاح
 *    تشغيل/إيقاف بجانب كل منتج — التفعيل يدرجه فوراً (مزامنة لحظية)
 *    والإيقاف يسحبه من المتجر خلال ثوانٍ.
 * كل تغيير يطلق مزامنة فورية (notifyCatalogChanged) — المتجر يتحدث
 * خلال ثوانٍ لا عند الدورة الـ ١٥ دقيقة.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ProductRepo} from '../../database/repositories/ProductRepo';
import {ProductFormModal} from '../ProductFormModal';
import {useCatalogStore, useToastStore} from '../../state/appStores';
import {
  loadOnlineSettings,
  notifyCatalogChanged,
  syncProducts,
} from '../../services/online/OnlineStoreService';
import {formatMoney, relativeTime} from '../../core/format';
import type {OnlineSellingSettings, Product} from '../../core/types';
import './online.css';

/** السعر النهائي بعد خصم المنتج (0–95). */
function finalPrice(product: Product): number {
  const pct = Math.max(0, Math.min(95, product.discount_pct ?? 0));
  if (pct <= 0) {
    return product.retail_price;
  }
  return Math.round(product.retail_price * (1 - pct / 100) * 100) / 100;
}

export function OnlineProductsScreen() {
  const toast = useToastStore(s => s.show);
  const refreshCatalog = useCatalogStore(s => s.refresh);

  const [settings, setSettings] = useState<OnlineSellingSettings>(() =>
    loadOnlineSettings(),
  );
  const [listed, setListed] = useState<Product[]>([]);
  const [all, setAll] = useState<Product[]>([]);
  const [view, setView] = useState<'listed' | 'all'>('listed');
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  /** استعلامان الأندرويد حرفياً: المدرجة للعرض + كل النشطة للانتقاء/التبويب. */
  const reload = useCallback(
    async (withSpinner = true) => {
      if (withSpinner) {
        setLoading(true);
      }
      try {
        const [listedRows, allRows] = await Promise.all([
          ProductRepo.list({archival: 'active', onlineListed: true}),
          ProductRepo.list({archival: 'active'}),
        ]);
        setListed(listedRows);
        setAll(allRows);
        setSettings(loadOnlineSettings());
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر تحميل المنتجات',
          'error',
        );
      } finally {
        if (withSpinner) {
          setLoading(false);
        }
      }
    },
    [toast],
  );

  useEffect(() => {
    void reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** المنتجات النشطة غير المدرجة — مرشّحو منتقي الإدراج. */
  const candidates = useMemo(() => {
    const listedIds = new Set(listed.map(p => p.id));
    return all.filter(p => !listedIds.has(p.id));
  }, [all, listed]);

  const filtered = useMemo(() => {
    const source = view === 'listed' ? listed : all;
    const q = query.trim();
    if (q.length === 0) {
      return source;
    }
    return source.filter(p => p.name.includes(q));
  }, [view, listed, all, query]);

  const pickerFiltered = useMemo(() => {
    const q = pickerQuery.trim();
    if (q.length === 0) {
      return candidates;
    }
    return candidates.filter(p => p.name.includes(q));
  }, [candidates, pickerQuery]);

  const togglePick = (id: number) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** إدراج مجموعة المنتجات المنتقاة دفعة واحدة. */
  const applyPicked = useCallback(async () => {
    if (picked.size === 0) {
      return;
    }
    let ok = 0;
    for (const id of picked) {
      try {
        const done = await ProductRepo.setOnlineListed(id, true);
        if (done) {
          ok += 1;
        }
      } catch {
        // نكمل الباقي — الفرد الفاشل يبقى غير مدرج.
      }
    }
    setPicked(new Set());
    setPickerOpen(false);
    setPickerQuery('');
    await reload(false);
    await refreshCatalog();
    notifyCatalogChanged();
    toast(`أُدرج ${ok} منتجاً في متجرك — يجري تحديث المتجر`, 'success');
  }, [picked, refreshCatalog, reload, toast]);

  /** إلغاء إدراج لمسة واحدة — يختفي من المتجر عند المزامنة التالية. */
  const unlist = useCallback(
    (product: Product) => {
      const confirmed = window.confirm(
        `إلغاء الإدراج: سيلغى عرض «${product.name}» على سيلا ماركت عند المزامنة التالية (خلال ثوانٍ). بيانات المنتج محفوظة لديك.`,
      );
      if (!confirmed) {
        return;
      }
      void (async () => {
        try {
          await ProductRepo.setOnlineListed(product.id, false);
          await reload(false);
          await refreshCatalog();
          notifyCatalogChanged();
          toast('أُلغي إدراج المنتج — يختفي من المتجر خلال ثوانٍ', 'info');
        } catch (error) {
          toast(
            error instanceof Error ? error.message : 'تعذر إلغاء الإدراج',
            'error',
          );
        }
      })();
    },
    [refreshCatalog, reload, toast],
  );

  /** v56: تفعيل/إيقاف عرض منتج في متجر سيلا من تبويب «كل منتجات النقطة» —
   *  مزامنة لحظية، بلا فتح ملف المنتج. */
  const toggleOnlineListing = useCallback(
    async (product: Product) => {
      if (togglingId != null) {
        return;
      }
      setTogglingId(product.id);
      const target = product.online_listed !== 1;
      try {
        const done = await ProductRepo.setOnlineListed(product.id, target);
        if (!done) {
          toast('لا يمكن إدراج منتج مؤرشف', 'error');
          return;
        }
        await reload(false);
        await refreshCatalog();
        notifyCatalogChanged();
        toast(
          target
            ? `«${product.name}» معروض الآن في متجر سيلا`
            : `أُوقف عرض «${product.name}» — يختفي من المتجر خلال ثوانٍ`,
          'success',
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر تغيير الإدراج',
          'error',
        );
      } finally {
        setTogglingId(null);
      }
    },
    [refreshCatalog, reload, togglingId, toast],
  );

  const syncNow = useCallback(async () => {
    if (!settings.enabled) {
      toast('فعّل البيع أونلاين أولاً من شاشة إعدادات البيع أونلاين', 'error');
      return;
    }
    setSyncing(true);
    try {
      const saved = await syncProducts();
      await reload(false);
      toast(`تمت مزامنة ${saved} منتجاً مع المتجر`, 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذرت المزامنة',
        'error',
      );
    } finally {
      setSyncing(false);
    }
  }, [reload, settings.enabled, toast]);

  const outOfStockCount = listed.filter(p => p.stock_quantity <= 0).length;

  return (
    <div className="screen">
      <h1>منتجات النقطة</h1>
      <div className="subtitle">
        ما يراه مشترو سيلا ماركت من منتجاتك — دون باقي منتجاتك
      </div>

      {!settings.enabled && (
        <div className="card olo-warn-card" style={{marginBottom: 14}}>
          <span>⚠️</span>
          <span>
            البيع أونلاين معطّل — المنتجات المدرجة لن تُنشر حتى تفعّله من شاشة
            إعدادات البيع أونلاين
          </span>
        </div>
      )}

      {/* حالة العرض + المزامنة */}
      <div className="grid-4">
        <div className="card kpi">
          <span className="label">معروض في المتجر</span>
          <span className="value brand">{listed.length}</span>
          <span className="label">من {all.length} منتجاً نشطاً</span>
        </div>
        <div className="card kpi">
          <span className="label">نفد مخزونها</span>
          <span className={`value ${outOfStockCount > 0 ? '' : 'ok'}`}>
            {outOfStockCount}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">آخر مزامنة منتجات</span>
          <span className="value" style={{fontSize: 15}}>
            {settings.lastProductsSyncAt != null
              ? relativeTime(
                  new Date(settings.lastProductsSyncAt).toISOString(),
                )
              : 'لم تتم بعد'}
          </span>
        </div>
        <div className="card kpi">
          <button
            className="btn primary"
            style={{width: '100%'}}
            onClick={() => void syncNow()}
            disabled={syncing}>
            {syncing ? 'جارٍ المزامنة…' : '⟳ مزامنة الآن'}
          </button>
          <span className="label" style={{marginTop: 8}}>
            كل تعديل هنا أو كل عملية بيع يُحدّث المتجر فوراً تلقائياً — الزر
            للطوارئ فقط.
          </span>
        </div>
      </div>

      {/* تبويبا العرض: المدرجة (v55) / كل منتجات النقطة (v56) */}
      <div className="toolbar" style={{marginTop: 14}}>
        <button
          className={`chip-toggle ${view === 'listed' ? 'on' : ''}`}
          onClick={() => setView('listed')}>
          المعروض أونلاين ({listed.length})
        </button>
        <button
          className={`chip-toggle ${view === 'all' ? 'on' : ''}`}
          onClick={() => setView('all')}>
          كل منتجات النقطة ({all.length})
        </button>
        <span className="grow" />
        <input
          className="olo-search"
          style={{maxWidth: 320}}
          placeholder="ابحث في منتجات النقطة…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {view === 'all' && (
        <div className="toolbar" style={{marginTop: 0}}>
          <span className="olo-hint" style={{flexBasis: 'auto'}}>
            فعّل المفتاح بجانب أي منتج ليُدرج فوراً في متجر سيلا — والإيقاف
            يسحبه من المتجر خلال ثوانٍ بلا وسائط بينية.
          </span>
          <span className="grow" />
          <button className="btn sm" onClick={() => void reload(true)}>
            ⟳ تحديث قائمة المنتجات
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty">
          <div className="icon">📦</div>
          جارٍ تحميل المنتجات…
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="icon">📦</div>
          <b>
            {query.length > 0
              ? 'لا نتائج لهذا البحث'
              : view === 'listed'
                ? 'لا منتجات مدرجة بعد'
                : 'لا منتجات نشطة'}
          </b>
          <span>
            {query.length > 0
              ? 'جرّب كلمة أخرى'
              : view === 'listed'
                ? 'اضغط «إدراج منتجات في المتجر» بالأسفل واختر ما يظهر في متجرك'
                : 'أضف منتجات من المخزون أولاً ثم فعّل عرضها هنا'}
          </span>
        </div>
      ) : (
        <div className="olo-prod-list">
          {filtered.map(product => {
            const discounted = product.discount_pct > 0;
            const untracked = product.stock_untracked === 1;
            const out = product.stock_quantity <= 0 && !untracked;
            if (view === 'all') {
              const isListed = product.online_listed === 1;
              const busy = togglingId === product.id;
              return (
                <div className="olo-prod-row" key={product.id}>
                  <div className="olo-prod-thumb">📦</div>
                  <div className="olo-prod-main">
                    <span className="olo-prod-name" title={product.name}>
                      {product.name}
                    </span>
                    <span className="olo-prod-meta">
                      <span className="olo-price-new">
                        {formatMoney(product.retail_price)}
                      </span>
                      <span style={out ? {color: 'var(--danger)'} : undefined}>
                        {untracked
                          ? 'بلا تتبع مخزون'
                          : out
                            ? 'نفد المخزون'
                            : `المخزون ${product.stock_quantity}`}
                      </span>
                    </span>
                  </div>
                  <label
                    className="olo-switch"
                    title={
                      isListed
                        ? 'معروض في متجر سيلا — أوقفه ليسحب'
                        : 'غير معروض — فعّله ليظهر في متجر سيلا'
                    }>
                    <input
                      type="checkbox"
                      checked={isListed}
                      disabled={busy}
                      onChange={() => void toggleOnlineListing(product)}
                    />
                    <span className="track" />
                  </label>
                </div>
              );
            }
            return (
              <div className="olo-prod-row" key={product.id}>
                <div className="olo-prod-thumb">📦</div>
                <div className="olo-prod-main">
                  <span className="olo-prod-name" title={product.name}>
                    {product.name}
                  </span>
                  <span className="olo-prod-meta">
                    {discounted ? (
                      <>
                        <span className="olo-price-old">
                          {formatMoney(product.retail_price)}
                        </span>
                        <span className="olo-price-new">
                          {formatMoney(finalPrice(product))}
                        </span>
                        <span className="chip danger">
                          خصم {Math.round(product.discount_pct)}%
                        </span>
                      </>
                    ) : (
                      <span className="olo-price-new">
                        {formatMoney(product.retail_price)}
                      </span>
                    )}
                    <span
                      className={`chip ${untracked ? 'muted' : out ? 'danger' : 'ok'}`}>
                      {untracked
                        ? 'بلا تتبع مخزون'
                        : out
                          ? 'نفد — غير قابل للطلب'
                          : `مخزون ${product.stock_quantity}`}
                    </span>
                  </span>
                </div>
                <div className="olo-prod-side">
                  <button className="btn sm" onClick={() => setEditing(product.id)}>
                    تعديل
                  </button>
                  <button
                    className="btn sm danger"
                    onClick={() => unlist(product)}>
                    إلغاء الإدراج
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'listed' && (
        <>
          <button
            className="olo-dashed-btn"
            style={{marginTop: 12}}
            onClick={() => {
              setPicked(new Set());
              setPickerQuery('');
              setPickerOpen(true);
            }}>
            ＋ إدراج منتجات في المتجر
          </button>
          {candidates.length === 0 && !loading && (
            <div className="olo-hint" style={{marginTop: 10, textAlign: 'center'}}>
              كل منتجاتك النشطة مدرجة بالفعل — أضف منتجات جديدة من المخزون
              لتدرجها.
            </div>
          )}
        </>
      )}

      {/* منتقي الإدراج: بحث + انتقاء متعدد */}
      {pickerOpen && (
        <div
          className="overlay"
          onClick={e => e.target === e.currentTarget && setPickerOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <b>إدراج في المتجر</b>
              <button className="btn sm ghost" onClick={() => setPickerOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <input
                className="olo-search"
                placeholder="ابحث في منتجاتك غير المدرجة…"
                value={pickerQuery}
                onChange={e => setPickerQuery(e.target.value)}
              />
              <div className="olo-picker-list">
                {pickerFiltered.map(item => {
                  const on = picked.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`olo-pick-row ${on ? 'on' : ''}`}
                      onClick={() => togglePick(item.id)}>
                      <span className="olo-checkbox">{on ? '✓' : ''}</span>
                      <div className="olo-prod-main">
                        <span className="olo-prod-name">{item.name}</span>
                        <span className="olo-prod-meta">
                          {formatMoney(item.retail_price)}
                          {item.stock_untracked !== 1
                            ? ` · مخزون ${item.stock_quantity}`
                            : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {pickerFiltered.length === 0 && (
                  <div className="olo-hint">
                    {candidates.length === 0
                      ? 'لا توجد منتجات نشطة غير مدرجة'
                      : 'لا نتائج لهذا البحث'}
                  </div>
                )}
              </div>
              <button
                className="btn primary"
                disabled={picked.size === 0}
                onClick={() => void applyPicked()}>
                {picked.size > 0
                  ? `إدراج ${picked.size} منتجاً في المتجر`
                  : 'انتقِ منتجات أولاً'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* تعديل سريع: يفتح ملف المنتج (السعر/الخصم/المخزون/الصور) */}
      {editing != null && (
        <ProductFormModal
          productId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload(false);
            void refreshCatalog();
            notifyCatalogChanged();
          }}
        />
      )}
    </div>
  );
}
