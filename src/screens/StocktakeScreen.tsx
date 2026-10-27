/**
 * screens/StocktakeScreen.tsx — نظام الجرد الكامل v38 (UI-6).
 * ─────────────────────────────────────────────────────────────────
 * منقول من StocktakeScreen الأندرويد (v57) إلى سطح المكتب:
 *
 *  • جلسة واحدة مفتوحة في كل وقت: «بدء الجرد» يلتقط صورة كاملة
 *    لمخزون كل منتج غير مؤرشف (v37: الشمولية — بلا تتبع يدخل
 *    الجرد كمرجع أيضاً).
 *  • v38: جرد حسب نوع المنتج — موديلات الملابس (المتغيرات) تُجرد
 *    ربطة ربطة: صف مستقل لكل (لون × مقاس) بمخزونه النظامي، وعدّ كل
 *    صف يُكتب على صف المتغير نفسه (setCounted بمعرّف المتغير)،
 *    وإتمام التسوية يعيد توليد إجمالي الموديل من مجموع متغيراته.
 *  • عدّ سريع: بحث بالاسم أو الباركود أو المتغير + فلترة تصنيف +
 *    «غير المعدودة فقط» + زر «مطابق» بلمسة + Enter يقفز للصف التالي.
 *  • ملخص حي: المعدود/الإجمالي، مطابق/نقص/زيادة، الفرق بالكمية
 *    وقيمته التقديرية بالتكلفة (من كتالوج نقطة البيع).
 *  • الإتمام: مع تطبيق التعديلات (معاملة ذرّية تكتب العدّ وتربط
 *    إجماليات المتغيرات) أو بدونه — مع تأكيد واضح وإشعار مركز
 *    الإشعارات، والإلغاء يحذف الجلسة بلا أي تعديل مخزون.
 *  • سجل الجلسات المنتهية + تقرير أي جلسة بفروقاتها.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {StocktakeRepo} from '../database/repositories/StocktakeRepo';
import {CategoryRepo} from '../database/repositories/CategoryRepo';
import {
  useCatalogStore,
  useToastStore,
  useNotificationsStore,
} from '../state/appStores';
import {useSettingsStore} from '../stores/settingsStore';
import {formatDateTime, formatMoney, formatQty, parseNumber} from '../core/format';
import {Icon} from '../components/Icon';
import {buildStocktakeReportJob} from '../services/printer/stocktakeReceipt';
import {printJob} from '../printing/dispatch';
import {useEnterConfirm} from '../lib/useEnterConfirm';
import type {ReceiptSettings} from '../services/printer/receipt';
import type {
  Category,
  Stocktake,
  StocktakeItem,
  StocktakeSummary,
} from '../core/types';
import './inventoryv57.css';

/** هل هذان الصفان نفس سطر الجرد (منتج، متغير)؟ — مفتاح v38. */
function sameLine(a: StocktakeItem, b: StocktakeItem): boolean {
  return (
    a.product_id === b.product_id && (a.variantId ?? null) === (b.variantId ?? null)
  );
}

/** شارة الفرق الحيّة لصف عدّ. */
function varianceOf(item: StocktakeItem): {
  tone: 'neutral' | 'match' | 'short' | 'over';
  label: string;
} {
  const counted = item.counted_qty;
  if (counted == null) {
    return {tone: 'neutral', label: 'لم يُعد'};
  }
  const variance = counted - item.system_qty;
  if (Math.abs(variance) < 0.0005) {
    return {tone: 'match', label: 'مطابق'};
  }
  return {
    tone: variance > 0 ? 'over' : 'short',
    label: `${variance > 0 ? '+' : ''}${formatQty(variance)}`,
  };
}

export function StocktakeScreen() {
  const toast = useToastStore(s => s.show);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const catalogProducts = useCatalogStore(s => s.products);
  const pushNotification = useNotificationsStore(s => s.push);

  // ── البيانات ─────────────────────────────────────────────────
  const [session, setSession] = useState<Stocktake | null>(null);
  const [history, setHistory] = useState<Stocktake[]>([]);
  const [items, setItems] = useState<StocktakeItem[]>([]);
  const [summary, setSummary] = useState<StocktakeSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // ── الفلاتر ──────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');
  const [onlyPending, setOnlyPending] = useState(false);

  // ── الحالة التشغيلية ─────────────────────────────────────────
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reportSession, setReportSession] = useState<Stocktake | null>(null);
  const [reportItems, setReportItems] = useState<StocktakeItem[] | null>(null);
  /** v60: ملخص الجلسة المفتوح تقريرها — يُعرض كبطاقات أعلى الجدول. */
  const [reportSummary, setReportSummary] = useState<StocktakeSummary | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

  /** سلسلة تركيز حقول العدّ — Enter يقفز للصف التالي (عدّ متواصل). */
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [open, past, cats] = await Promise.all([
        StocktakeRepo.getOpen(),
        StocktakeRepo.list(20),
        // v34: تصنيفات نمط المتجر الحالي فقط.
        CategoryRepo.list(useSettingsStore.getState().settings.storeMode),
      ]);
      setSession(open);
      setHistory(past.filter(entry => entry.id !== open?.id));
      setCategories(cats);
      if (open != null) {
        const [sessionItems, sessionSummary] = await Promise.all([
          StocktakeRepo.listItems(open.id),
          StocktakeRepo.summary(open.id),
        ]);
        setItems(sessionItems);
        setSummary(sessionSummary);
      } else {
        setItems([]);
        setSummary(null);
      }
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشل تحميل الجرد',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* ── بدء جلسة ──────────────────────────────────────────────── */
  const startSession = useCallback(async () => {
    if (starting) {
      return;
    }
    setStarting(true);
    try {
      await StocktakeRepo.start();
      await loadAll();
      toast('بدأت جلسة الجرد — ابدأ عدّ المنتجات', 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر بدء الجرد',
        'error',
      );
    } finally {
      setStarting(false);
    }
  }, [starting, loadAll, toast]);

  /* ── العدّ (v38: بالمفتاح المركب منتج + متغير) ─────────────── */
  const setCounted = useCallback(
    async (item: StocktakeItem, raw: string) => {
      if (session == null) {
        return;
      }
      const trimmed = raw.trim();
      const value = trimmed === '' ? null : parseNumber(trimmed);
      if (value != null && (Number.isNaN(value) || value < 0)) {
        return;
      }
      // تحديث متفائل فوري ثم كتابة القاعدة وتحديث الملخص.
      setItems(prev =>
        prev.map(row =>
          sameLine(row, item)
            ? {...row, counted_qty: value == null ? null : value}
            : row,
        ),
      );
      try {
        await StocktakeRepo.setCounted(
          session.id,
          item.product_id,
          value == null ? null : value,
          item.variantId ?? null,
        );
        setSummary(await StocktakeRepo.summary(session.id));
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر حفظ العدد',
          'error',
        );
        await loadAll();
      }
    },
    [session, loadAll, toast],
  );

  const markMatched = useCallback(
    async (item: StocktakeItem) => {
      await setCounted(item, String(item.system_qty));
    },
    [setCounted],
  );

  /* ── الإتمام / الإلغاء ─────────────────────────────────────── */
  const completeSession = useCallback(
    async (applyAdjustments: boolean) => {
      if (session == null || completing) {
        return;
      }
      setCompleting(true);
      try {
        const result = await StocktakeRepo.complete(session.id, applyAdjustments);
        pushNotification(
          'stocktake',
          applyAdjustments ? 'اكتمل الجرد وتحديث المخزون' : 'اكتمل الجرد',
          applyAdjustments
            ? `تم تعديل كميات ${result.adjusted} منتج لتطابق العدّ الفعلي.`
            : 'تم إنهاء جلسة الجرد دون تعديل كميات المخزون.',
          {},
        );
        setCompleteOpen(false);
        await loadAll();
        await refreshCatalog();
        toast(
          applyAdjustments
            ? `تم إنهاء الجرد وتعديل ${result.adjusted} منتج`
            : 'تم إنهاء الجرد بدون تعديل المخزون',
          applyAdjustments ? 'success' : 'info',
          4000,
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشل إنهاء الجرد',
          'error',
        );
      } finally {
        setCompleting(false);
      }
    },
    [session, completing, pushNotification, loadAll, refreshCatalog, toast],
  );

  // v61 (الجولة 26 #6): Enter في نافذة إنهاء الجرد = «إنهاء وتعديل
  // المخزون» (الزر الأساسي) — Escape يبقى للتراجع.
  useEnterConfirm({
    active: completeOpen,
    onConfirm: () => void completeSession(true),
    enabled: () => !completing,
  });

  const cancelSession = useCallback(async () => {
    if (session == null || cancelBusy) {
      return;
    }
    const confirmed = window.confirm(
      'إلغاء الجرد\n\nسيتم حذف جلسة الجرد الحالية بالكامل دون أي تعديل على المخزون. متابعة؟',
    );
    if (!confirmed) {
      return;
    }
    setCancelBusy(true);
    try {
      await StocktakeRepo.cancel(session.id);
      await loadAll();
      toast('تم إلغاء جلسة الجرد', 'info');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر الإلغاء',
        'error',
      );
    } finally {
      setCancelBusy(false);
    }
  }, [session, cancelBusy, loadAll, toast]);

  /* ── تقارير الجلسات المنتهية ───────────────────────────────── */
  const openReport = useCallback(
    async (entry: Stocktake) => {
      try {
        const [report, reportSum] = await Promise.all([
          StocktakeRepo.listItems(entry.id),
          StocktakeRepo.summary(entry.id),
        ]);
        setReportSession(entry);
        setReportItems(report);
        setReportSummary(reportSum);
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر فتح التقرير',
          'error',
        );
      }
    },
    [toast],
  );

  /** v60 (الجولة 25 #5): طباعة تقرير الجلسة حرارياً — يعمل للتقرير
   *  النهائي وللمرحلي للجلسة النشطة على حد سواء. */
  const printReport = useCallback(
    async (target: Stocktake, targetItems: StocktakeItem[], targetSummary: StocktakeSummary | null, interim: boolean) => {
      if (printBusy) return;
      if (targetSummary == null) {
        toast('ملخص الجلسة غير متاح — أعد فتح التقرير', 'error');
        return;
      }
      setPrintBusy(true);
      try {
        const s = useSettingsStore.getState().settings;
        const receiptSettings: ReceiptSettings = {
          storeName: s.storeName,
          storePhone: s.storePhone,
          footerMessage: s.footerMessage,
          storeLogoPath: s.storeLogoPath,
          paperWidth: s.paperWidth,
          codepage: s.codepage,
          showProfit: false,
        };
        await printJob(
          buildStocktakeReportJob(
            {session: target, items: targetItems, summary: targetSummary, interim},
            receiptSettings,
          ),
          'report',
        );
        toast(
          interim
            ? `طُبع التقرير المرحلي للجلسة #${target.id}`
            : `طُبع تقرير الجلسة #${target.id}`,
          'success',
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشلت الطباعة',
          'error',
        );
      } finally {
        setPrintBusy(false);
      }
    },
    [printBusy, toast],
  );

  /* ── القوائم المشتقة ───────────────────────────────────────── */
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(item => {
      if (onlyPending && item.counted_qty != null) {
        return false;
      }
      if (categoryFilter !== 'all' && item.categoryId !== categoryFilter) {
        return false;
      }
      // البحث يطابق الاسم أو الباركود بالضبط أو وصف المتغير — مسح
      // باركود ملابس يقع على ربطة اللون والمقاس مباشرة.
      if (
        query &&
        !item.productName.toLowerCase().includes(query) &&
        (item.barcode ?? '') !== query &&
        !(item.variantLabel ?? '').toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [items, search, categoryFilter, onlyPending]);

  /** خريطة التكلفة من الكتالوج — لقيمة الفرق التقديرية. */
  const costByProductId = useMemo(() => {
    const map = new Map<number, number>();
    catalogProducts.forEach(p => map.set(p.id, p.cost_price));
    return map;
  }, [catalogProducts]);

  /** قيمة الفرق بالمال (تكلفة × فرق الكمية) لكل الصفوف المعدودة. */
  const valueDiff = useMemo(
    () =>
      items.reduce((sum, item) => {
        if (item.counted_qty == null) {
          return sum;
        }
        const cost = costByProductId.get(item.product_id) ?? 0;
        return sum + (item.counted_qty - item.system_qty) * cost;
      }, 0),
    [items, costByProductId],
  );

  const progressPct =
    summary != null && summary.totalItems > 0
      ? Math.round((summary.countedItems / summary.totalItems) * 100)
      : 0;

  const uncounted =
    summary != null ? summary.totalItems - summary.countedItems : 0;
  const varianceItems =
    summary != null ? summary.shortageItems + summary.surplusItems : 0;

  /* ── العرض ─────────────────────────────────────────────────── */
  return (
    <div className="screen">
      <h1>الجرد</h1>
      <div className="subtitle">
        جلسة واحدة تلتقط صورة المخزون كاملاً — عُدّ فعلياً ثم أنهِ بتطبيق
        الفروقات أو بدونها — الملابس تُجرد ربطة ربطة (لون × مقاس)
      </div>

      {loading ? (
        <div className="empty">
          <div className="icon">⏳</div>
          جارٍ تحميل الجرد…
        </div>
      ) : session == null ? (
        /* ── لا جلسة مفتوحة ── */
        <>
          <div className="card" style={{textAlign: 'center', padding: 30}}>
            <div style={{fontSize: 34, marginBottom: 8}}>📋</div>
            <b style={{fontSize: 16}}>لا جلسة جرد مفتوحة</b>
            <div className="iv57-hint" style={{margin: '8px 0 16px'}}>
              «بدء الجرد» يلتقط صورة كمية كل منتج نشط (ومتغيرات الملابس ربطة
              ربطة) ثم تعدّ ما تشاء — البضاعة «بلا تتبع» تدخل الجرد كمرجع
              أيضاً (v37) فلا يغيب أي صنف عن العدّ.
            </div>
            <button
              className="btn primary"
              disabled={starting}
              onClick={() => void startSession()}>
              {starting ? 'جارٍ بدء الجلسة…' : (<><Icon name="plus" size={16} /> بدء جلسة جرد جديدة</>)}
            </button>
          </div>

          {/* سجل الجلسات */}
          <div className="card" style={{marginTop: 14}}>
            <div className="pf-sec-h" style={{marginBottom: 10}}>
              <b>جلسات سابقة</b>
              <span className="pf-sec-sub">آخر 20 جلسة</span>
            </div>
            {history.length === 0 ? (
              <div className="catman-empty">لا جلسات منتهية بعد.</div>
            ) : (
              <div className="catman-rows">
                {history.map(entry => (
                  <div key={entry.id} className="st-history-row">
                    <span className="when">
                      جلسة #{entry.id}
                      <div className="meta">
                        بدأت {formatDateTime(entry.started_at)} · انتهت{' '}
                        {entry.completed_at
                          ? formatDateTime(entry.completed_at)
                          : '—'}
                      </div>
                    </span>
                    <span className="chip muted">{entry.status === 'completed' ? 'مكتملة' : entry.status}</span>
                    <button
                      className="btn sm ghost"
                      onClick={() => void openReport(entry)}>
                      التقرير
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        /* ── جلسة نشطة ── */
        <>
          <div className="card" style={{marginBottom: 14}}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}>
              <div>
                <b style={{fontSize: 15}}>
                  جلسة الجرد #{session.id} — بدأت{' '}
                  {formatDateTime(session.started_at)}
                </b>
                <div className="iv57-hint">
                  العدّ يُحفظ لحظياً صفّاً صفّاً؛ الصفوف غير المعدودة تبقى
                  كميتها كما هي عند الإتمام.
                </div>
              </div>
              <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                <button
                  className="btn"
                  disabled={printBusy || summary == null || items.length === 0}
                  title="طباعة نسخة حرارية من تقدّم الجلسة وفروقاتها حتى الآن"
                  onClick={() =>
                    session != null &&
                    void printReport(session, items, summary, true)
                  }>
                  <Icon name="printer" size={15} />
                  {printBusy ? 'جارٍ الطباعة…' : 'طباعة تقرير مرحلي'}
                </button>
                <button
                  className="btn danger"
                  disabled={cancelBusy}
                  onClick={() => void cancelSession()}>
                  {cancelBusy ? '…' : 'إلغاء الجلسة'}
                </button>
                <button
                  className="btn primary"
                  onClick={() => setCompleteOpen(true)}>
                  إنهاء الجرد
                </button>
              </div>
            </div>

            {/* شريط التقدّم + الإحصاءات الحيّة */}
            <div className="st-stats" style={{marginTop: 12}}>
              <div className="st-stat brand">
                <span className="v">
                  {summary?.countedItems ?? 0}/{summary?.totalItems ?? 0}
                </span>
                <span className="l">معدود / إجمالي</span>
              </div>
              <div className="st-stat ok">
                <span className="v">{summary?.matchedItems ?? 0}</span>
                <span className="l">مطابق</span>
              </div>
              <div className="st-stat danger">
                <span className="v">{summary?.shortageItems ?? 0}</span>
                <span className="l">نقص</span>
              </div>
              <div className="st-stat">
                <span className="v">{summary?.surplusItems ?? 0}</span>
                <span className="l">زيادة</span>
              </div>
              <div className="st-stat">
                <span className="v">
                  {formatQty((summary?.totalSystem ?? 0))} →{' '}
                  {formatQty(summary?.totalCounted ?? 0)}
                </span>
                <span className="l">النظام → العدّ</span>
              </div>
              <div
                className={`st-stat ${
                  Math.abs(valueDiff) < 0.005 ? '' : valueDiff < 0 ? 'danger' : 'ok'
                }`}>
                <span className="v">{formatMoney(valueDiff)}</span>
                <span className="l">قيمة الفرق (بالتكلفة)</span>
              </div>
            </div>
            <div className="st-progress" style={{marginTop: 10}}>
              <div style={{width: `${progressPct}%`}} />
            </div>
            <div className="iv57-hint" style={{marginTop: 6}}>
              {progressPct}% معدود · {uncounted} صفّاً بلا عدّ
              {varianceItems > 0 ? ` · ${varianceItems} صفّاً بفروقات` : ''}
            </div>
          </div>

          {/* البحث والفلاتر */}
          <div className="toolbar">
            <div className="inv-search">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو الباركود أو المتغير (أسود · 30)…"
                aria-label="بحث في صفوف الجرد"
              />
            </div>
            <button
              className={`chip-toggle ${onlyPending ? 'on' : ''}`}
              onClick={() => setOnlyPending(prev => !prev)}>
              {onlyPending ? 'إظهار الكل' : 'غير المعدودة فقط'}
            </button>
          </div>
          <div className="iv57-chips" style={{marginBottom: 14}}>
            <button
              className={`iv57-chip ${categoryFilter === 'all' ? 'on' : ''}`}
              onClick={() => setCategoryFilter('all')}>
              الكل
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                className={`iv57-chip ${
                  categoryFilter === cat.id ? 'on' : ''
                }`}
                onClick={() => setCategoryFilter(cat.id)}>
                {cat.name}
              </button>
            ))}
          </div>

          {/* صفوف العدّ */}
          <table className="st-table">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>كمية النظام</th>
                <th>العدّ الفعلي</th>
                <th>الفرق</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty" style={{padding: '24px 16px'}}>
                      <div className="icon"><Icon name="search" size={26} /></div>
                      {items.length === 0
                        ? 'لا صفوف في هذه الجلسة — كل منتجاتك مؤرشفة؟'
                        : 'لا نتائج بهذه الفلاتر — جرّب بحثاً آخر أو أطفئ «غير المعدودة فقط»'}
                    </div>
                  </td>
                </tr>
              )}
              {filteredItems.map((item, index) => {
                const variance = varianceOf(item);
                return (
                  <tr key={`${item.product_id}-${item.variantId ?? 0}`}>
                    <td>
                      <div className="st-name">
                        <b>
                          {item.productName}
                          {item.variantLabel != null && (
                            <span
                              className="iv57-mini-chip brand"
                              style={{marginInlineStart: 6}}>
                              {item.variantLabel}
                            </span>
                          )}
                        </b>
                        <span className="meta">
                          {item.barcode ?? '—'}
                          {item.unitHint != null ? ` · (${item.unitHint})` : ''}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="iv57-num">
                        {formatQty(item.system_qty)}
                        {item.soldByWeight === 1
                          ? ' كغ'
                          : ` ${item.baseUnitName ?? 'قطعة'}`}
                      </span>
                    </td>
                    <td>
                      <CountInput
                        ref={el => {
                          inputRefs.current[index] = el;
                        }}
                        item={item}
                        onCommit={value => void setCounted(item, value)}
                        onEnter={() => {
                          inputRefs.current[index + 1]?.focus();
                          inputRefs.current[index + 1]?.select();
                        }}
                      />
                    </td>
                    <td>
                      <span className={`st-badge ${variance.tone}`}>
                        {variance.label}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn sm ghost"
                        title={`مطابق — يساوي العدّ بكمية النظام (${formatQty(
                          item.system_qty,
                        )})`}
                        onClick={() => void markMatched(item)}>
                        <Icon name="check" size={13} /> مطابق
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="inv-count-row">
            {filteredItems.length} صفّاً معروضاً من أصل {items.length}
            {' — '}صفوف المتغيرات (لون × مقاس) تُعدّ كل ربطة على حدة وإجمالي
            الموديل يُعاد توليده من متغيراته عند الإتمام.
          </div>

          {/* سجل مختصر أسفل الجلسة النشطة */}
          {history.length > 0 && (
            <div className="card" style={{marginTop: 14}}>
              <div className="pf-sec-h" style={{marginBottom: 10}}>
                <b>جلسات سابقة</b>
              </div>
              <div className="catman-rows">
                {history.slice(0, 5).map(entry => (
                  <div key={entry.id} className="st-history-row">
                    <span className="when">
                      جلسة #{entry.id}
                      <div className="meta">
                        انتهت{' '}
                        {entry.completed_at
                          ? formatDateTime(entry.completed_at)
                          : '—'}
                      </div>
                    </span>
                    <button
                      className="btn sm ghost"
                      onClick={() => void openReport(entry)}>
                      التقرير
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* نافذة إنهاء الجرد */}
      {completeOpen && session != null && summary != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(560px, 94vw)'}}>
            <div className="modal-head">
              <b>إنهاء جلسة الجرد #{session.id}</b>
              <button
                className="btn sm ghost"
                onClick={() => setCompleteOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body st-complete-card">
              <div className="st-complete-nums">
                <div className="cell">
                  <span className="v">
                    {summary.countedItems}/{summary.totalItems}
                  </span>
                  <span className="l">معدود / إجمالي</span>
                </div>
                <div className="cell">
                  <span className="v" style={{color: 'var(--ok)'}}>
                    {summary.matchedItems}
                  </span>
                  <span className="l">مطابق</span>
                </div>
                <div className="cell">
                  <span className="v" style={{color: 'var(--danger)'}}>
                    {summary.shortageItems}
                  </span>
                  <span className="l">نقص</span>
                </div>
                <div className="cell">
                  <span className="v" style={{color: 'var(--brand-ink)'}}>
                    {summary.surplusItems}
                  </span>
                  <span className="l">زيادة</span>
                </div>
              </div>
              <div className="iv57-hint">
                الفرق الإجمالي:{' '}
                {formatQty(summary.totalCounted - summary.totalSystem)} (النظام{' '}
                {formatQty(summary.totalSystem)} → العدّ{' '}
                {formatQty(summary.totalCounted)}) · قيمة الفرق بالتكلفة{' '}
                {formatMoney(valueDiff)}
              </div>
              {uncounted > 0 && (
                <div className="iv57-hint">
                  <Icon name="alert" size={14} /> {uncounted} صفّاً لم يُعدّ —
                  ستبقى كميتها كما هي.
                </div>
              )}
              <div className="iv57-hint">
                هل تريد تعديل كميات المخزون لتطابق العدّ الفعلي؟ التسوية تكتب
                العدّ في معاملة ذرّية واحدة — صفوف متغيرات الملابس تُكتب في
                صفوفها ثم يُعاد توليد إجمالي كل موديل من مجموع متغيراته.
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                disabled={completing}
                onClick={() => setCompleteOpen(false)}>
                تراجع
              </button>
              <button
                className="btn danger"
                disabled={completing}
                onClick={() => void completeSession(false)}>
                إنهاء بدون تعديل
              </button>
              <button
                className="btn primary"
                disabled={completing}
                onClick={() => void completeSession(true)}>
                {completing ? 'جارٍ الإتمام…' : 'إنهاء وتعديل المخزون'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* تقرير جلسة منتهية — v60: ملخص بطاقات + فرق رقمي + طباعة */}
      {reportSession != null && reportItems != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(860px, 94vw)'}}>
            <div className="modal-head">
              <b>
                تقرير جلسة الجرد #{reportSession.id} —{' '}
                {reportSession.completed_at
                  ? formatDateTime(reportSession.completed_at)
                  : 'جلسة مفتوحة'}
              </b>
              <span style={{display: 'flex', gap: 8}}>
                <button
                  className="btn sm primary"
                  disabled={printBusy || reportSummary == null}
                  onClick={() =>
                    void printReport(
                      reportSession,
                      reportItems,
                      reportSummary,
                      reportSession.status === 'open',
                    )
                  }>
                  <Icon name="printer" size={15} />
                  {printBusy ? 'جارٍ الطباعة…' : 'طباعة التقرير'}
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    setReportSession(null);
                    setReportItems(null);
                    setReportSummary(null);
                  }}>
                  إغلاق
                </button>
              </span>
            </div>
            <div className="modal-body" style={{padding: 16, overflowY: 'auto'}}>
              {/* ملخص الجلسة v60 */}
              {reportSummary != null && (
                <div className="st-report-grid">
                  <div className="cell">
                    <span className="v">{reportSummary.totalItems}</span>
                    <span className="l">صف الجرد</span>
                  </div>
                  <div className="cell brand">
                    <span className="v">{reportSummary.countedItems}</span>
                    <span className="l">معدود</span>
                  </div>
                  <div className="cell ok">
                    <span className="v">{reportSummary.matchedItems}</span>
                    <span className="l">مطابق</span>
                  </div>
                  <div className="cell danger">
                    <span className="v">{reportSummary.shortageItems}</span>
                    <span className="l">نقص</span>
                  </div>
                  <div className="cell">
                    <span className="v">{reportSummary.surplusItems}</span>
                    <span className="l">زيادة</span>
                  </div>
                  <div className="cell">
                    <span className="v">
                      {formatQty(reportSummary.totalSystem)} →{' '}
                      {formatQty(reportSummary.totalCounted)}
                    </span>
                    <span className="l">النظام → العدّ</span>
                  </div>
                </div>
              )}
              <table className="st-table" style={{border: 0, borderRadius: 0}}>
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>النظام</th>
                    <th>العدّ</th>
                    <th>الفرق</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {reportItems.map(item => {
                    const variance = varianceOf(item);
                    const numeric =
                      item.counted_qty != null
                        ? item.counted_qty - item.system_qty
                        : null;
                    return (
                      <tr
                        key={`${item.product_id}-${item.variantId ?? 0}`}>
                        <td>
                          <b>{item.productName}</b>
                          {item.variantLabel != null && (
                            <span
                              className="iv57-mini-chip brand"
                              style={{marginInlineStart: 6}}>
                              {item.variantLabel}
                            </span>
                          )}
                        </td>
                        <td className="iv57-num">{formatQty(item.system_qty)}</td>
                        <td className="iv57-num">
                          {item.counted_qty == null
                            ? '—'
                            : formatQty(item.counted_qty)}
                        </td>
                        <td
                          className="iv57-num"
                          style={{
                            color:
                              numeric == null
                                ? 'var(--muted)'
                                : Math.abs(numeric) < 0.0005
                                ? 'var(--ok)'
                                : numeric > 0
                                ? 'var(--ok)'
                                : 'var(--danger)',
                            fontWeight: 800,
                          }}>
                          {numeric == null
                            ? '—'
                            : Math.abs(numeric) < 0.0005
                            ? '0'
                            : `${numeric > 0 ? '+' : ''}${formatQty(numeric)}`}
                        </td>
                        <td>
                          <span className={`st-badge ${variance.tone}`}>
                            {variance.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── حقل العدّ — نص محلي يُزامن مع الحالة ويُرسل عند الخروج ──── */
const CountInput = React.forwardRef<
  HTMLInputElement,
  {
    item: StocktakeItem;
    onCommit: (value: string) => void;
    onEnter: () => void;
  }
>(function CountInput({item, onCommit, onEnter}, ref) {
  const [text, setText] = useState(
    item.counted_qty == null ? '' : String(item.counted_qty),
  );

  // مزامنة خارجية (زر «مطابق» أو إعادة تحميل).
  useEffect(() => {
    setText(item.counted_qty == null ? '' : String(item.counted_qty));
  }, [item.counted_qty]);

  return (
    <input
      ref={ref}
      className={`st-count-input iv57-num ${item.counted_qty != null ? 'counted' : ''}`}
      inputMode={item.soldByWeight === 1 ? 'decimal' : 'numeric'}
      value={text}
      placeholder={item.soldByWeight === 1 ? '0.0' : '0'}
      onChange={e => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(text);
          onEnter();
        }
      }}
    />
  );
});
