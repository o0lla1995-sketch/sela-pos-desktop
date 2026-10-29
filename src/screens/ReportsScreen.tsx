/**
 * screens/ReportsScreen.tsx — النظام المحاسبي (UI-7 — سطح المكتب،
 * بتكافؤ الأندرويد v57).
 * ─────────────────────────────────────────────────────────────────
 * بنمط التقارير العالمي (ملخص Square → تدفق النقد → المستحقات) ومنطق
 * ReportsScreen الأندرويد (v18→v57) منقولاً إلى React DOM:
 *
 *  1. ملخص المبيعات — KPIs نظيفة (إيراد، صافي الربح، التكلفة،
 *     الفواتير، متوسط الفاتورة، القطع، المرتجعات، الخصومات).
 *  2. رسوم SVG (بلا مكتبات): أداء المبيعات يومياً، وشهرياً للفترات
 *     الأطول من ٦٢ يوماً، وسلسلة ساعات الذروة ٠–٢٣ مع خط المتوسط —
 *     اليوم/أمس يصيران بالساعة (v47) وعمود الذروة مضاء بقيمته.
 *  3. النقد والديون — النقد المحصّل بالفترة، مقبوضاته، صافيه بعد
 *     المصروفات والمسحوبات، ولقطة الدين القائم الآن (قاعدة الأصول
 *     المحاسبية: السداد تحويل أصل من دين إلى نقد — ليس إيراداً أبداً).
 *  4. مبيعات الدين بالفترة (DebtSalesSummary) — النقدية / صِلة
 *     (INV-D) / دفتر المتجر (INV-L) / البيع أونلاين (INV-O).
 *  5. قسائم الحملات — المصروف منها، البضاعة المسجّلة، الفرق النقدي،
 *     التسويات المستلمة والمستحق القائم على المؤسسات.
 *  6. الخزينة (treasurySnapshot) — النقد المتوقع بالدرج الآن بمعادلته
 *     الكاملة عبر التاريخ.
 *  7. الأكثر إيراداً وربحاً + تفصيل الفواتير (salesDetail) مع تصدير
 *     CSV (بديل ExportService الأندرويد — حوار حفظ أصلي).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {invoke} from '../lib/tauri';
import {useToastStore} from '../state/appStores';
import {
  ReportService,
  rangeFor,
  type ReportBundle,
  type TreasurySnapshot,
} from '../services/ReportService';
import {
  ReportRepo,
  type DebtSalesSummary,
} from '../database/repositories/ReportRepo';
import {CashService} from '../services/CashService';
import {
  dayMonthLabel,
  formatDateTime,
  formatMoney,
  localDateShift,
  localToday,
  weekdayLabel,
} from '../core/format';
import type {ReportRangeKey} from '../core/types';
import {Icon} from '../components/Icon';
import './settingsv57.css';
import {
  PAYMENT_KIND_LABELS,
  displayMethod,
} from '../core/paymentMethods';
import {PaymentMethodIcon} from '../components/PaymentMethodIcon';

/* ──────────────────────────────────────────────────────────────
 * الرسوم البيانية — مكونات SVG صغيرة مضمّنة (بلا أي مكتبات).
 * ────────────────────────────────────────────────────────────── */

interface BarDatum {
  value: number;
  label: string;
  sublabel?: string;
}

/** فهرس أعلى عمود موجب — يُضاء عمود الذروة (فوري/أمس/فترة). */
function peakIndexOf(values: number[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > 0 && (best == null || values[i] > values[best])) {
      best = i;
    }
  }
  return best;
}

/** اختصار مضغوط فوق المحور: 1.2k / 850. */
function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const k = value / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`;
  }
  return abs >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

function SvgBarChart({
  data,
  height = 210,
  highlightIndex,
  avgLine,
  emptyText,
}: {
  data: BarDatum[];
  height?: number;
  highlightIndex?: number | null;
  avgLine?: number | null;
  emptyText: string;
}) {
  const W = 940;
  const padTop = 22;
  const padBottom = 34;
  const plotH = Math.max(40, height - padTop - padBottom);
  const positiveCount = data.reduce(
    (sum, d) => (d.value > 0 ? sum + 1 : sum),
    0,
  );
  if (data.length === 0 || positiveCount === 0) {
    return <div className="sv57-chart-empty">{emptyText}</div>;
  }
  const rawMax = Math.max(...data.map(d => d.value));
  const max = Math.max(rawMax, avgLine ?? 0, 1);
  const slot = W / data.length;
  const barW = Math.max(2, Math.min(42, slot * 0.62));
  const xOf = (i: number) => i * slot + (slot - barW) / 2;
  const yOf = (v: number) => padTop + plotH * (1 - Math.max(0, v) / max);
  const baseline = padTop + plotH;
  const ticks = [max, max / 2];
  const avgY = avgLine != null && avgLine > 0 ? yOf(avgLine) : null;
  const avgText =
    avgLine != null && avgLine > 0 ? compactNumber(avgLine) : null;

  return (
    <div className="sv57-chart-wrap">
      <svg viewBox={`0 0 ${W} ${height}`} role="img">
        {ticks.map((tick, i) => (
          <g key={`tick-${i}`}>
            <line
              className="sv57-grid-line"
              x1={0}
              x2={W}
              y1={yOf(tick)}
              y2={yOf(tick)}
            />
            <text
              className="sv57-axis-label"
              x={W - 2}
              y={yOf(tick) - 4}
              textAnchor="end">
              {compactNumber(tick)}
            </text>
          </g>
        ))}
        {avgY != null && avgText != null && (
          <g>
            <line className="sv57-avg-line" x1={0} x2={W} y1={avgY} y2={avgY} />
            <text
              className="sv57-axis-label sv57-avg-label"
              x={2}
              y={avgY - 5}
              textAnchor="start">
              متوسط {avgText}
            </text>
          </g>
        )}
        {data.map((d, i) => {
          const value = Math.max(0, d.value);
          const barH = Math.max(value > 0 ? 1.5 : 0, baseline - yOf(value));
          const cx = xOf(i) + barW / 2;
          const isPeak = highlightIndex === i;
          return (
            <g key={`bar-${i}`}>
              <rect
                className={`sv57-bar ${isPeak ? 'peak' : ''}`}
                x={xOf(i)}
                y={yOf(value)}
                width={barW}
                height={barH}
                rx={Math.min(3, barW / 3)}>
                <title>
                  {d.label
                    ? `${d.label} — ${formatMoney(d.value)}`
                    : formatMoney(d.value)}
                </title>
              </rect>
              {isPeak && value > 0 && (
                <text
                  className="sv57-peak-value"
                  x={cx}
                  y={yOf(value) - 6}
                  textAnchor="middle">
                  {compactNumber(value)}
                </text>
              )}
              {d.label.length > 0 && (
                <text
                  className="sv57-tick-label"
                  x={cx}
                  y={baseline + 14}
                  textAnchor="middle">
                  {d.label}
                </text>
              )}
              {d.sublabel != null && d.sublabel.length > 0 && (
                <text
                  className="sv57-sub-tick-label"
                  x={cx}
                  y={baseline + 26}
                  textAnchor="middle">
                  {d.sublabel}
                </text>
              )}
            </g>
          );
        })}
        <line className="sv57-baseline" x1={0} x2={W} y1={baseline} y2={baseline} />
      </svg>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * أدوات مساعدة للصفحة.
 * ────────────────────────────────────────────────────────────── */

/** v47: ساعة بالعربية — «٨ صباحاً» / «٨ مساءً» لسطر الذروة. */
function arabicHour(hour: number): string {
  const safe = Math.min(23, Math.max(0, Math.round(hour)));
  const h12 = safe % 12 === 0 ? 12 : safe % 12;
  return `${h12} ${safe < 12 ? 'صباحاً' : 'مساءً'}`;
}

const QUICK_RANGES: {key: ReportRangeKey; label: string}[] = [
  {key: 'today', label: 'اليوم'},
  {key: 'yesterday', label: 'أمس'},
  {key: 'last7', label: 'آخر 7 أيام'},
  {key: 'thisMonth', label: 'هذا الشهر'},
  {key: 'all', label: 'الكل'},
];

/** صف تفصيل الفواتير (salesDetail) — النوع من المستودع مباشرة. */
type SalesDetailRow = Awaited<ReturnType<typeof ReportRepo.salesDetail>>;

const TOP_MODES: {key: 'revenue' | 'profit'; label: string}[] = [
  {key: 'revenue', label: 'إيراداً'},
  {key: 'profit', label: 'ربحاً'},
];

/** خلية CSV مغلّفة بعلامات اقتباس (Excel يقرأ العربية بسلام). */
function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** قسم قابل للطي: ترويسة دائمة بالرقم المهم + التفاصيل عند الضغط. */
function CollapseSection({
  title,
  valueText,
  tone,
  open,
  onToggle,
  children,
}: {
  title: string;
  valueText: string;
  tone: 'ok' | 'danger' | 'warn' | 'brand' | 'plain';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const toneColor: Record<typeof tone, string> = {
    ok: 'var(--ok)',
    danger: 'var(--danger)',
    warn: 'var(--warn)',
    brand: 'var(--brand-ink)',
    plain: 'var(--ink)',
  };
  return (
    <div className={`sv57-collapse ${open ? 'open' : ''}`}>
      <button className="sv57-collapse-head" onClick={onToggle}>
        <span>{title}</span>
        <span style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <b style={{color: toneColor[tone], direction: 'ltr', unicodeBidi: 'embed'}}>
            {valueText}
          </b>
          <span className="caret">◀</span>
        </span>
      </button>
      {open && <div className="sv57-collapse-body">{children}</div>}
    </div>
  );
}

export function ReportsScreen() {
  const toast = useToastStore(s => s.show);

  // ── الفترة: مفتاح سريع أو نطاق مخصص ─────────────────────────
  const [rangeKey, setRangeKey] = useState<ReportRangeKey>('last7');
  const [from, setFrom] = useState(localDateShift(-6));
  const [to, setTo] = useState(localToday());

  // ── البيانات ─────────────────────────────────────────────────
  const [bundle, setBundle] = useState<ReportBundle | null>(null);
  const [treasury, setTreasury] = useState<TreasurySnapshot | null>(null);
  const [debt, setDebt] = useState<DebtSalesSummary | null>(null);
  const [detail, setDetail] = useState<SalesDetailRow>([]);
  /** v70 (الجولة 74 #2): أرصدة المحافظ والبنوك بالفترة — كم دخل كل بنك/
   *  محفظة/الخزينة النقدية وكم رُدّ منه. */
  /** v72 (الجولة 76 #6): الرصيد الصافي الكامل لكل قناة — مبيعات
   *  وسدادات وإيداعات مقابل مرتجعات ومسحوبات ومصروفات. */
  const [payMethods, setPayMethods] = useState<
    Awaited<ReturnType<typeof ReportRepo.methodLedgerTotals>>
  >([]);
  /** نافذة تفاصيل قناة واحدة (سجل الحركات + كشف PDF). */
  const [methodDetail, setMethodDetail] = useState<string | null>(null);
  const [methodRows, setMethodRows] = useState<
    Awaited<ReturnType<typeof ReportRepo.methodLedgerRows>>
  >([]);
  const [methodBusy, setMethodBusy] = useState(false);
  const [methodPdfBusy, setMethodPdfBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);

  // ── خيارات العرض ─────────────────────────────────────────────
  const [topMode, setTopMode] = useState<'revenue' | 'profit'>('revenue');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    {},
  );
  const toggleSection = useCallback((key: string) => {
    setOpenSections(prev => ({...prev, [key]: !prev[key]}));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const custom =
        rangeKey === 'custom' ? {from, to} : undefined;
      const key: ReportRangeKey =
        rangeKey === 'custom' ? 'custom' : rangeKey;
      const [nextBundle, nextTreasury, nextDebt, nextDetail, nextPayMethods] =
        await Promise.all([
          ReportService.loadBundle(key, custom),
          ReportService.treasurySnapshot(),
          ReportRepo.debtSalesSummary(rangeFor(key, custom)),
          ReportService.salesDetail(key, custom),
          ReportRepo.methodLedgerTotals(rangeFor(key, custom)),
        ]);
      setBundle(nextBundle);
      setTreasury(nextTreasury);
      setDebt(nextDebt);
      setDetail(nextDetail);
      setPayMethods(nextPayMethods);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'تعذر تحميل التقارير',
        'error',
        6000,
      );
    } finally {
      setLoading(false);
    }
  }, [rangeKey, from, to, toast]);

  // v72 (الجولة 76 #6): نطاق الفترة الحالي (تغذية نافذة القناة).
  const currentRange = useMemo(
    () => rangeFor(rangeKey, rangeKey === 'custom' ? {from, to} : undefined),
    [rangeKey, from, to],
  );

  // v72 (الجولة 76 #6): تحميل سجل القناة التفصيلي عند فتح نافذتها.
  useEffect(() => {
    if (methodDetail == null) {
      setMethodRows([]);
      return;
    }
    let mounted = true;
    setMethodBusy(true);
    ReportRepo.methodLedgerRows(currentRange, methodDetail)
      .then(rows => {
        if (mounted) {
          setMethodRows(rows);
        }
      })
      .catch(() => {
        if (mounted) {
          setMethodRows([]);
          toast('تعذر تحميل حركات القناة', 'error', 5000);
        }
      })
      .finally(() => {
        if (mounted) {
          setMethodBusy(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [methodDetail, currentRange, toast]);

  /** كشف PDF لقناة الفترة الحالية — نفس الفلاتر المعروضة. */
  const exportMethodPdf = useCallback(async () => {
    if (methodDetail == null || methodPdfBusy) {
      return;
    }
    setMethodPdfBusy(true);
    try {
      const path = await CashService.exportMethodStatementPdf(
        methodDetail,
        currentRange.from,
        currentRange.to,
      );
      toast(`أُنشئ كشف القناة: ${path}`, 'success', 6000);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'تعذر إنشاء كشف القناة',
        'error',
        6000,
      );
    } finally {
      setMethodPdfBusy(false);
    }
  }, [methodDetail, methodPdfBusy, currentRange, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** اختيار نطاق سريع — ينعكس على حقلي التاريخ أيضاً. */
  const applyQuick = useCallback((key: ReportRangeKey) => {
    setRangeKey(key);
    const range = rangeFor(key);
    setFrom(range.from);
    setTo(range.to);
  }, []);

  const onFromChange = useCallback((value: string) => {
    if (value) {
      setRangeKey('custom');
      setFrom(value);
    }
  }, []);

  const onToChange = useCallback((value: string) => {
    if (value) {
      setRangeKey('custom');
      setTo(value);
    }
  }, []);

  /* ── السلاسل: حبيبية الرسم تتبع الفترة (v42/v47) ───────────── */
  const dailyPoints = bundle?.daily ?? [];
  const isMonthlySeries = dailyPoints.some(p => p.day.length === 7);
  const dailyData: BarDatum[] = dailyPoints.map((point, index) => {
    const value = Math.round(point.revenue * 100) / 100;
    if (isMonthlySeries) {
      // سلسلة شهرية: تخفيف التسميات عند الازدحام + السنة تحت كانون
      // الثاني (نفس منطق الأندرويد v42).
      const total = dailyPoints.length;
      const step = Math.max(1, Math.ceil(total / 8));
      const [year, monthNum] = point.day.split('-');
      const showLabel = index % step === 0 || index === total - 1;
      return {
        value,
        label: showLabel ? point.label : '',
        sublabel:
          showLabel && (monthNum === '01' || index === 0) ? year : '',
      };
    }
    // الشهر الحالي (أو أي سلسلة مزدحمة > ١٤ يوماً): رقم اليوم فقط.
    if (rangeKey === 'thisMonth' || dailyPoints.length > 14) {
      return {
        value,
        label: String(Number(point.day.slice(8, 10))),
        sublabel: '',
      };
    }
    // اليوم/أمس/٧ أيام: التاريخ فوق اسم اليوم.
    return {
      value,
      label: dayMonthLabel(point.day),
      sublabel: weekdayLabel(point.day),
    };
  });

  // v47: اليوم/أمس بالساعة — «المدي الزمني» الحقيقي (٢٤ عموداً).
  const isHourlySales = rangeKey === 'today' || rangeKey === 'yesterday';
  const hourlyPoints = bundle?.hourly ?? [];
  const hourlyData: BarDatum[] = hourlyPoints.map(point => ({
    value: Math.round(point.revenue * 100) / 100,
    label: point.hour % 3 === 0 ? String(point.hour) : '',
    sublabel: '',
  }));
  const salesData = isHourlySales ? hourlyData : dailyData;

  // إحصاءات مصغّرة تحت الرسم + سطر الذروة (v47 «مؤشر صحيح»).
  const salesPeakIdx = peakIndexOf(salesData.map(d => d.value));
  const salesValues = salesData.map(d => d.value);
  const salesTotal = salesValues.reduce((a, v) => a + v, 0);
  const salesCount = salesValues.filter(v => v > 0).length;
  const salesBest =
    salesPeakIdx != null ? (salesValues[salesPeakIdx] ?? 0) : 0;
  const salesStats: {label: string; value: string}[] = isHourlySales
    ? [
        {label: 'إجمالي المبيعات', value: formatMoney(salesTotal)},
        {label: 'أفضل ساعة', value: formatMoney(salesBest)},
        {
          label: 'فواتير الفترة',
          value: String(
            hourlyPoints.reduce((a, p) => a + (p.orders ?? 0), 0),
          ),
        },
      ]
    : [
        {label: 'إجمالي الفترة', value: formatMoney(salesTotal)},
        {
          label: 'المتوسط لكل يوم',
          value: formatMoney(salesCount > 0 ? salesTotal / salesCount : 0),
        },
        {label: 'أعلى يوم', value: formatMoney(salesBest)},
      ];

  const salesPeakLabel = useMemo(() => {
    if (salesPeakIdx == null) {
      return null;
    }
    if (isHourlySales) {
      return `ذروة ${rangeKey === 'today' ? 'اليوم' : 'أمس'} الساعة ${arabicHour(
        hourlyPoints[salesPeakIdx]?.hour ?? salesPeakIdx,
      )} — ${formatMoney(salesBest)}`;
    }
    const point = dailyPoints[salesPeakIdx];
    if (point == null) {
      return null;
    }
    const when = isMonthlySeries
      ? `${point.label}${point.day.length === 7 ? ` ${point.day.slice(0, 4)}` : ''}`
      : `${weekdayLabel(point.day)} ${dayMonthLabel(point.day)}`;
    return `أعلى إيراد: ${when} — ${formatMoney(salesBest)}`;
  }, [
    salesPeakIdx,
    isHourlySales,
    isMonthlySeries,
    dailyPoints,
    hourlyPoints,
    salesBest,
    rangeKey,
  ]);

  // ساعات الذروة: عمود ذروة الفترة مضاء + متوسط الساعة النشطة.
  const hourValues = hourlyPoints.map(p => p.revenue);
  const peakHourIdx = peakIndexOf(hourValues);
  const activeHours = hourlyPoints.filter(p => p.revenue > 0);
  const activeAvg =
    activeHours.length > 0
      ? activeHours.reduce((a, p) => a + p.revenue, 0) / activeHours.length
      : 0;
  const peakHourCaption =
    peakHourIdx != null
      ? `ذروة الإيراد: ${arabicHour(
          hourlyPoints[peakHourIdx]?.hour ?? peakHourIdx,
        )} — ${formatMoney(
          hourValues[peakHourIdx] ?? 0,
        )} · متوسط الساعة النشطة: ${formatMoney(activeAvg)}`
      : null;

  /* ── الأكثر إيراداً وربحاً ─────────────────────────────────── */
  const topProducts =
    topMode === 'revenue'
      ? (bundle?.topByRevenue ?? [])
      : (bundle?.topByProfit ?? []);
  /* v69 (الجولة 73): الخمسة الأوائل فقط — طلب التاجر نصاً «يظهر
   * فقط أكثر خمسة منتجات فقط لا أكثر حتى لا تطول القائمة»، ونفس
   * سلوك الأندرويد حرفياً (الجولة 34 #6) — البقية في تصدير CSV. */
  const topShown = topProducts.slice(0, 5);
  const topMax = Math.max(
    ...topShown.map(p => Math.max(topMode === 'revenue' ? p.revenue : p.profit, 0)),
    0.0001,
  );

  /* ── النقد والديون (bundle.cash) ──────────────────────────── */
  const cash = bundle?.cash ?? null;
  const paired = cash?.paired ?? false;

  /* ── مبيعات الدين بالفترة: الدلاء الأربعة ─────────────────── */
  const debtCashBucket = Math.max(
    0,
    (bundle?.summary.revenue ?? 0) - (debt?.amount ?? 0),
  );

  /* ── تصدير CSV (بديل ExportService الأندرويد — RN) ─────────── */
  const exportCsv = useCallback(async () => {
    if (exportBusy || detail.length === 0) {
      return;
    }
    setExportBusy(true);
    try {
      /* v71 (الجولة 75 #9): جدول حقيقي كامل — عمود طريقة الدفع +
         صف الإجماليات أسفل الجدول (طلب التاجر: استخراج منسق بشكل
         صحيح على حسب التقرير المستخرج). */
      const header = [
        'الفاتورة',
        'التاريخ',
        'أصناف',
        'كمية',
        'الإجمالي',
        'التكلفة',
        'الربح',
        'الخصم',
        'الدفع',
        'طريقة الدفع',
      ];
      const lines = [header.map(csvCell).join(',')];
      for (const row of detail) {
        lines.push(
          [
            row.invoice,
            row.createdAt,
            row.itemsCount,
            row.quantity,
            row.total.toFixed(2),
            row.cost.toFixed(2),
            row.profit.toFixed(2),
            row.discount.toFixed(2),
            row.paymentType,
            row.invoice.startsWith('RET-')
              ? '—'
              : displayMethod(row.paymentMethod).label,
          ]
            .map(csvCell)
            .join(','),
        );
      }
      lines.push(
        [
          'الإجماليات',
          '',
          '',
          detail.reduce((sum, row) => sum + row.quantity, 0),
          detail.reduce((sum, row) => sum + row.total, 0).toFixed(2),
          detail.reduce((sum, row) => sum + row.cost, 0).toFixed(2),
          detail.reduce((sum, row) => sum + row.profit, 0).toFixed(2),
          detail.reduce((sum, row) => sum + row.discount, 0).toFixed(2),
          '',
          '',
        ]
          .map(csvCell)
          .join(','),
      );
      const contents = `\uFEFF${lines.join('\r\n')}`;
      const path = await invoke<string>('save_text_file', {
        defaultName: `sela_sales_${from}_${to}.csv`,
        contents,
      });
      toast(`تم حفظ التقرير: ${path}`, 'success', 5000);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('أُلغيت')) {
        toast(message, 'error', 6000);
      }
    } finally {
      setExportBusy(false);
    }
  }, [exportBusy, detail, from, to, toast]);

  const summary = bundle?.summary ?? null;

  /* ── v76 (الجولة 80 #٤ب): تنظيم صفحة التقارير بتبويبات — طلب
     التاجر نصاً «تحسين وتنظيم صفحة التقارير بشكل احترافي… حتى مع
     كمية كبيرة من البيانات». الأقسام التسعة كانت مكدسة في تمرير
     واحد طويل؛ الآن أربع تبويبات مستقلة: الملخص (KPIs + الرسمان)،
     النقد والخزينة (النقد + القنوات + الخزينة)، الديون والقسائم،
     المنتجات والفواتير — كل تبويب يحمّل من نفس الـ bundle (لا
     استعلامات إضافية) والشريط ثابت أعلى الشاشة أثناء التمرير. ── */
  type ReportTab = 'overview' | 'cash' | 'debts' | 'products';
  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const TABS: {
    key: ReportTab;
    label: string;
    icon: Parameters<typeof Icon>[0]['name'];
    hint: string;
  }[] = [
    {
      key: 'overview',
      label: 'الملخص',
      icon: 'chart',
      hint: 'مؤشرات المبيعات وأداؤها وساعات الذروة',
    },
    {
      key: 'cash',
      label: 'النقد والخزينة',
      icon: 'wallet',
      hint: 'النقد المحصّل وأرصدة القنوات والخزينة',
    },
    {
      key: 'debts',
      label: 'الديون والقسائم',
      icon: 'book',
      hint: 'مبيعات الدين بالفترة وقسائم الحملات',
    },
    {
      key: 'products',
      label: 'المنتجات والفواتير',
      icon: 'list',
      hint: 'الأكثر إيراداً وربحاً وتفصيل الفواتير',
    },
  ];

  // ──────────────────────────────────────────────────────────────
  return (
    <div className="screen">
      <h1>التقارير</h1>
      <div className="subtitle">
        المبيعات والنقد والديون والخزينة — القيم بالشيكل ₪
      </div>

      {/* الفترة: نطاقات سريعة + حقلا تاريخ مخصّصان */}
      <div className="toolbar">
        {QUICK_RANGES.map(r => (
          <button
            key={r.key}
            className={`chip-toggle ${rangeKey === r.key ? 'on' : ''}`}
            onClick={() => applyQuick(r.key)}>
            {r.label}
          </button>
        ))}
        <span className="grow" />
        <div className="sv57-dates">
          <input
            type="date"
            value={from}
            max={to}
            onChange={e => onFromChange(e.target.value)}
            aria-label="من تاريخ"
          />
          <span className="sv57-sec-hint">إلى</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={e => onToChange(e.target.value)}
            aria-label="إلى تاريخ"
          />
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      </div>

      {loading && bundle == null ? (
        <div className="card">
          <div className="sv57-empty">
            <div className="icon"><Icon name="chart" size={30} /></div>
            جارٍ تحميل التقارير…
          </div>
        </div>
      ) : bundle != null && summary != null ? (
        <>
          {/* ── v76 (الجولة 80 #٤ب): شريط التبويبات الثابت — أربع
              مناطق محاسبية واضحة بدل التمرير الطويل الواحد. ── */}
          <div className="rep-tabs" role="tablist" dir="rtl">
            {TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`rep-tab ${activeTab === tab.key ? 'on' : ''}`}
                onClick={() => setActiveTab(tab.key)}
                title={tab.hint}>
                <Icon name={tab.icon} size={17} />
                <span className="lbl">{tab.label}</span>
                {activeTab === tab.key && <span className="lbl-hint">{tab.hint}</span>}
              </button>
            ))}
          </div>
        <div className="sv57-stack">
          {/* ── v76 (الجولة 80 #٤ب): تبويب «الملخص» — KPIs
              الإجمالية + رسما الأداء وساعات الذروة. ── */}
          {activeTab === 'overview' && (<>
          {/* ── 1) ملخص المبيعات ─────────────────────────────── */}
          <div className="card sv57-sec">
            <div className="sv57-sec-head">
              <div className="sv57-sec-title">ملخص المبيعات</div>
              <div className="sv57-sec-hint">
                من {from} إلى {to} — صافية من المرتجعات
              </div>
            </div>
            <div className="sv57-kpis">
              <div className="sv57-kpi">
                <span className="label">إجمالي المبيعات</span>
                <span className="value brand">
                  {formatMoney(summary.revenue)}
                </span>
              </div>
              <div className="sv57-kpi">
                <span className="label">صافي الربح</span>
                <span className={`value ${summary.netProfit >= 0 ? 'ok' : 'danger'}`}>
                  {formatMoney(summary.netProfit)}
                </span>
              </div>
              <div className="sv57-kpi">
                <span className="label">عدد الفواتير</span>
                <span className="value">{summary.invoicesCount}</span>
                <span className="sub">متوسط الفاتورة {formatMoney(summary.avgInvoice)}</span>
              </div>
              <div className="sv57-kpi">
                <span className="label">القطع المبيعة</span>
                <span className="value">{summary.itemsCount}</span>
                <span className="sub">التكلفة (COGS) {formatMoney(summary.cogs)}</span>
              </div>
              <div className="sv57-kpi">
                <span className="label">الخصومات</span>
                <span className="value warn">
                  {formatMoney(summary.discountTotal)}
                </span>
              </div>
              <div className="sv57-kpi">
                <span className="label">المرتجعات</span>
                <span className="value danger">
                  {formatMoney(summary.returnsTotal)}
                </span>
                <span className="sub">{summary.returnsCount} إيصال</span>
              </div>
            </div>
          </div>

          {/* ── 2) رسم أداء المبيعات (يومي/شهري/بالساعة) ─────── */}
          <div className="card sv57-sec">
            <div className="sv57-sec-head">
              <div>
                <div className="sv57-sec-title">
                  {isHourlySales
                    ? rangeKey === 'today'
                      ? 'أداء مبيعات اليوم (بالساعة)'
                      : 'أداء مبيعات أمس (بالساعة)'
                    : isMonthlySeries
                    ? 'أداء المبيعات الشهري'
                    : 'أداء المبيعات اليومي'}
                </div>
                <div className="sv57-sec-hint">
                  {isHourlySales
                    ? 'الإيراد لكل ساعة — الساعة ٠ يساراً حتى ٢٣ يميناً'
                    : isMonthlySeries
                    ? 'إجمالي كل شهر بالشيكل (الفترة أطول من شهرين)'
                    : 'كل عمود يحمل تاريخه فوق اسم يومه'}
                </div>
              </div>
            </div>
            <SvgBarChart
              data={salesData}
              highlightIndex={salesPeakIdx}
              emptyText="لا توجد مبيعات في هذه الفترة"
            />
            <div className="sv57-mini-stats">
              {salesStats.map(stat => (
                <div key={stat.label} className="sv57-mini-stat">
                  <span className="v">{stat.value}</span>
                  <span className="l">{stat.label}</span>
                </div>
              ))}
            </div>
            {salesPeakLabel != null && (
              <div className="sv57-peak-caption">{salesPeakLabel}</div>
            )}
          </div>

          {/* ── 3) ساعات الذروة (٠–٢٣) ────────────────────────── */}
          <div className="card sv57-sec">
            <div className="sv57-sec-head">
              <div>
                <div className="sv57-sec-title">ساعات الذروة</div>
                <div className="sv57-sec-hint">
                  الإيراد لكل ساعة خلال الفترة — العمود المضيء هو الذروة
                  والخط المتقطع متوسط الساعة النشطة
                </div>
              </div>
            </div>
            <SvgBarChart
              data={hourlyData}
              height={170}
              highlightIndex={peakHourIdx}
              avgLine={activeAvg}
              emptyText="لا توجد مبيعات في هذه الفترة"
            />
            {peakHourCaption != null && (
              <div className="sv57-peak-caption">{peakHourCaption}</div>
            )}
            <div className="sv57-chart-hint">
              جهّز المخزون والطاقم لأيام وساعات الذروة — إيقاع يومك الفعلي
              يظهر هنا.
            </div>
          </div>
          </>)}

          {/* ── 4) النقد والديون ─────────────────────────────── */}
          {/* v76 (الجولة 80 #٤ب): تبويب «النقد والخزينة». ── */}
          {activeTab === 'cash' && cash != null && (
            <div className="card sv57-sec">
              <div className="sv57-sec-head">
                <div className="sv57-sec-title">النقد والديون</div>
                <div className="sv57-sec-hint">
                  {paired
                    ? 'النقد الفعلي بالفترة + ديونك — صِلة مُفعّلة'
                    : 'النقد الفعلي بالفترة + ديونك — بدون أي ربط'}
                </div>
              </div>

              {/* البطل: النقد المحصّل */}
              <div className="sv57-hero">
                <span className="label">النقد المحصّل بالفترة</span>
                <span className="amount">
                  {formatMoney(cash.collected)}
                </span>
                <span className="meta">
                  مبيعات نقدية {formatMoney(cash.salesCash)} + مقبوضات
                  (ديون وحملات) {formatMoney(cash.collections)}
                </span>
              </div>

              {/* المقبوضات المستلمة بالفترة */}
              {(cash.collections ?? 0) > 0 && (
                <CollapseSection
                  title="المقبوضات المستلمة بالفترة (سداد الديون)"
                  valueText={formatMoney(cash.collections)}
                  tone="ok"
                  open={openSections.collections === true}
                  onToggle={() => toggleSection('collections')}>
                  <div className="sv57-row-line">
                    <span className="k">منها: دفتر المتجر</span>
                    <span className="v">{formatMoney(cash.localBookAmount)}</span>
                  </div>
                  {paired && (
                    <>
                      <div className="sv57-row-line">
                        <span className="k">منها: سدادّات استلمها الكاشير (فواتير صِلة)</span>
                        <span className="v">{formatMoney(cash.cashierSilaAmount)}</span>
                      </div>
                      <div className="sv57-row-line">
                        <span className="k">منها: تحصيلات عبر تطبيق صِلة</span>
                        <span className="v">{formatMoney(cash.viaSilaAppAmount)}</span>
                      </div>
                      <div className="sv57-row-line">
                        <span className="k">منها: سدّدها رصيد مسبق للزبون</span>
                        <span className="v">{formatMoney(cash.prepaidAmount)}</span>
                      </div>
                    </>
                  )}
                  {(cash.campaignSettlementsAmount ?? 0) > 0 && (
                    <div className="sv57-row-line">
                      <span className="k">
                        منها: مستلم من حملات القسائم (المؤسسات)
                      </span>
                      <span className="v ok">
                        {formatMoney(cash.campaignSettlementsAmount)}
                      </span>
                    </div>
                  )}
                </CollapseSection>
              )}

              {/* صافي النقد بعد الحركات */}
              {(cash.expensesCount ?? 0) > 0 ||
                (cash.withdrawalsCount ?? 0) > 0 ||
                (cash.depositsCount ?? 0) > 0 ? (
                <CollapseSection
                  title="صافي النقد بالفترة (بعد المصروفات والمسحوبات)"
                  valueText={formatMoney(cash.netCashAfterMovements)}
                  tone={(cash.netCashAfterMovements ?? 0) >= 0 ? 'ok' : 'danger'}
                  open={openSections.movements === true}
                  onToggle={() => toggleSection('movements')}>
                  {(cash.expensesCount ?? 0) > 0 && (
                    <div className="sv57-row-line">
                      <span className="k">
                        مصروفات · {cash.expensesCount} سند
                      </span>
                      <span className="v danger">
                        − {formatMoney(cash.expensesAmount)}
                      </span>
                    </div>
                  )}
                  {(cash.withdrawalsCount ?? 0) > 0 && (
                    <div className="sv57-row-line">
                      <span className="k">
                        مسحوبات رصيد · {cash.withdrawalsCount} سند
                      </span>
                      <span className="v danger">
                        − {formatMoney(cash.withdrawalsAmount)}
                      </span>
                    </div>
                  )}
                  {(cash.depositsCount ?? 0) > 0 && (
                    <div className="sv57-row-line">
                      <span className="k">
                        إيداعات نقدية · {cash.depositsCount} سند
                      </span>
                      <span className="v ok">
                        + {formatMoney(cash.depositsAmount)}
                      </span>
                    </div>
                  )}
                  <div className="sv57-row-line total">
                    <span className="k">صافي النقد بالفترة</span>
                    <span className={`v ${(cash.netCashAfterMovements ?? 0) >= 0 ? 'ok' : 'danger'}`}>
                      {formatMoney(cash.netCashAfterMovements)}
                    </span>
                  </div>
                </CollapseSection>
              ) : null}

              {/* الدين القائم الآن + النقد بالخزينة الآن */}
              <div className="sv57-duo">
                <div className="sv57-kpi">
                  <span className="label">الدين القائم الآن</span>
                  <span className="value warn">
                    {formatMoney(
                      (cash.localOutstandingMinor +
                        (paired ? cash.silaOutstandingMinor : 0) +
                        (cash.campaignDueMinor ?? 0)) /
                        100,
                    )}
                  </span>
                  <span className="sub">
                    {(cash.campaignDueMinor ?? 0) > 0
                      ? `${
                          cash.localDebtorsCount +
                          (paired ? cash.silaDebtorsCount : 0)
                        } زبون + مستحقات الحملات`
                      : `${
                          cash.localDebtorsCount +
                          (paired ? cash.silaDebtorsCount : 0)
                        } زبون مدين`}
                  </span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">النقد بالخزينة الآن</span>
                  <span className="value ok">
                    {formatMoney((cash.cashNowMinor ?? 0) / 100)}
                  </span>
                  <span className="sub">
                    بعد خصم كل المصروفات والمسحوبات — لحظة بلحظة
                  </span>
                </div>
              </div>

              <div className="sv57-note">
                المبيعات أعلاه تشمل فواتير الدين لأنها بضاعة خرجت من
                مخزونك؛ «النقد المحصّل» يطرحها ويعيد إضافة ما استلمته فعلاً
                من المقبوضات. السداد ليس إيراداً — إنه تحويل الدين إلى نقد.
              </div>
            </div>
          )}

          {/* ── 5) مبيعات الدين بالفترة (الدلاء الأربعة) ─────── */}
          {/* v76 (الجولة 80 #٤ب): تبويب «الديون والقسائم». ── */}
          {activeTab === 'debts' && debt != null && (
            <div className="card sv57-sec">
              <div className="sv57-sec-head">
                <div>
                  <div className="sv57-sec-title">مبيعات الدين بالفترة</div>
                  <div className="sv57-sec-hint">
                    تقسيم مبيعات الفترة حسب دفتر الدين — صِلة (INV-D)، دفتر
                    المتجر (INV-L)، البيع أونلاين (INV-O)، والنقدية الباقية
                  </div>
                </div>
              </div>
              <div className="sv57-kpis">
                <div className="sv57-kpi">
                  <span className="label">إجمالي مبيعات الدين</span>
                  <span className="value warn">
                    {formatMoney(debt.amount)}
                  </span>
                  <span className="sub">{debt.count} فاتورة</span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">منها: صِلة (INV-D)</span>
                  <span className="value">
                    {formatMoney(debt.silaAmount)}
                  </span>
                  <span className="sub">{debt.silaCount} فاتورة</span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">منها: دفتر المتجر (INV-L)</span>
                  <span className="value">
                    {formatMoney(debt.localAmount)}
                  </span>
                  <span className="sub">{debt.localCount} فاتورة</span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">منها: أونلاين (INV-O)</span>
                  <span className="value">
                    {formatMoney(debt.onlineAmount)}
                  </span>
                  <span className="sub">{debt.onlineCount} فاتورة</span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">والباقي مبيعات نقدية</span>
                  <span className="value ok">
                    {formatMoney(debtCashBucket)}
                  </span>
                  <span className="sub">دخلت الدرج عند البيع مباشرة</span>
                </div>
              </div>
              <div className="sv57-note">
                فواتير الدين بضاعة خرجت من مخزونك (داخل الإيراد) لكنها لم
                تدخل الدرج نقداً — تدخل مع سدادّاتها ضمن «النقد المحصّل».
              </div>
            </div>
          )}

          {/* ── 5.5) أرصدة المحافظ والبنوك (v70 → v72 الجولة 76 #6) ── */}
          {/* v76 (الجولة 80 #٤ب): تبويب «النقد والخزينة». ── */}
          {activeTab === 'cash' && payMethods.length > 0 && (
            <div className="card sv57-sec">
              <div className="sv57-sec-head">
                <div>
                  <div className="sv57-sec-title">أرصدة المحافظ والبنوك — الرصيد الصافي</div>
                  <div className="sv57-sec-hint">
                    لكل قناة خلال الفترة: الوارد (مبيعات + سدادات ديون +
                    إيداعات) مطروحاً منه الصادر (مرتجعات وفروق استبدال +
                    مسحوبات + مصروفات) — اضغط القناة لسجلها التفصيلي وكشفها
                  </div>
                </div>
              </div>
              <div className="sv57-kpis">
                {payMethods.map(row => {
                  const method = displayMethod(row.method);
                  return (
                    <button
                      type="button"
                      className="sv57-kpi sv57-kpi-btn"
                      key={row.method}
                      onClick={() => setMethodDetail(row.method)}
                      title={`سجل ${method.label} التفصيلي وكشف PDF`}>
                      <span
                        className="label"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}>
                        {/* v74 (الجولة 78 — سطح المكتب #١): شعار أكبر
                            مرئي بوضوح (كان ٢٢px). */}
                        <PaymentMethodIcon method={method} size={36} />
                        {method.label}
                      </span>
                      <span
                        className="value"
                        style={{color: method.color}}
                        title={PAYMENT_KIND_LABELS[method.kind]}>
                        {formatMoney(row.net)}
                      </span>
                      <span className="sub">
                        {row.salesCount > 0 || row.repaymentsCount > 0
                          ? `دخل ${formatMoney(
                              row.salesIn + row.repaymentsIn,
                            )}${row.depositsIn > 0 ? ` + إيداعات ${formatMoney(row.depositsIn)}` : ''}`
                          : 'لا عمليات بيع'}
                        {row.refundsOut > 0
                          ? ` · رُدّ ${formatMoney(row.refundsOut)}`
                          : ''}
                        {row.withdrawalsOut + row.expensesOut > 0
                          ? ` · خرج ${formatMoney(
                              row.withdrawalsOut + row.expensesOut,
                            )}`
                          : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="sv57-note">
                منظور حركة المال: كل مبلغ يدخل القناة أو يخرج منها بتاريخه
                الفعلي — فواتير الدين لا تُحتسب عند البيع (لم يُدفع منها شيء
                بعد) لكن سداداتها تدخل بقناتها يوم السداد، ومرتجعات/فروق
                الاستبدال تُخصم من قناة التسوية التي اخترتها. المبيعات
                المسجلة قبل إصدار طرق الدفع محسوبة نقدياً.
              </div>
            </div>
          )}

          {/* ── 6) قسائم الحملات ─────────────────────────────── */}
          {/* v76 (الجولة 80 #٤ب): تبويب «الديون والقسائم». ── */}
          {activeTab === 'debts' && cash != null && (
            <div className="card sv57-sec">
              <div className="sv57-sec-head">
                <div>
                  <div className="sv57-sec-title">قسائم الحملات</div>
                  <div className="sv57-sec-hint">
                    القسائم الشرائية بالفترة (INV-V) — بضاعة خرجت والمال
                    يصل من المؤسسات مع التسويات
                  </div>
                </div>
              </div>
              <div className="sv57-kpis">
                <div className="sv57-kpi">
                  <span className="label">قسائم مصروفة</span>
                  <span className="value brand">
                    {formatMoney(cash.voucherSalesAmount)}
                  </span>
                  <span className="sub">{cash.voucherSalesCount} عملية صرف</span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">منها: بضاعة مسجّلة (INV-V)</span>
                  <span className="value">
                    {formatMoney(cash.voucherGoodsAmount)}
                  </span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">منها: فرق نقدي بالكاشير</span>
                  <span className="value">
                    {formatMoney(cash.voucherCounterExtraAmount)}
                  </span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">مستلم تسويات الحملات بالفترة</span>
                  <span className="value ok">
                    {formatMoney(cash.campaignSettlementsAmount)}
                  </span>
                </div>
                <div className="sv57-kpi">
                  <span className="label">المستحق الآن من الحملات الفعّالة</span>
                  <span className="value warn">
                    {formatMoney((cash.campaignDueMinor ?? 0) / 100)}
                  </span>
                  <span className="sub">دين على المؤسسات حتى التسوية</span>
                </div>
              </div>
              {(cash.voucherCreditSalesAmount ?? 0) > 0 && (
                <div className="sv57-note">
                  عبر قسائم صِلة: {cash.voucherCreditSalesCount} عملية صرف
                  بقيمة {formatMoney(cash.voucherCreditSalesAmount)} —
                  مطالبة على المؤسسات حتى وصول التسوية.
                </div>
              )}
            </div>
          )}

          {/* ── 7) الخزينة (لقطة الآن عبر التاريخ) ───────────── */}
          {/* v76 (الجولة 80 #٤ب): تبويب «النقد والخزينة». ── */}
          {activeTab === 'cash' && treasury != null && (
            <div className="card sv57-sec">
              <div className="sv57-sec-head">
                <div>
                  <div className="sv57-sec-title">الخزينة</div>
                  <div className="sv57-sec-hint">
                    النقد المتوقع بالدرج الآن — معادلة Loyverse الكاملة عبر
                    التاريخ (الرئيسية تقرأ نفس الرقم)
                  </div>
                </div>
              </div>
              <div className="sv57-hero">
                <span className="label">النقد المتوقع بالخزينة الآن</span>
                <span className="amount">
                  {formatMoney(treasury.cashTotal)}
                </span>
                <span className="meta">
                  كل المبيعات − فواتير الدين − بضاعة القسائم + كل مصادر
                  التحصيل − المصروفات والمسحوبات + الإيداعات
                </span>
              </div>
              <div className="sv57-rows">
                <div className="sv57-info-row">
                  <span className="k">كل المبيعات عبر التاريخ</span>
                  <span className="v">
                    {formatMoney(treasury.revenueAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">فواتير الدين عبر التاريخ (لم تدخل الدرج)</span>
                  <span className="v" style={{color: 'var(--warn)'}}>
                    − {formatMoney(treasury.creditSalesAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">تحصيلات دفتر المتجر</span>
                  <span className="v" style={{color: 'var(--ok)'}}>
                    + {formatMoney(treasury.localCollectionsAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">سدادّات الكاشير لفواتير صِلة</span>
                  <span className="v" style={{color: 'var(--ok)'}}>
                    + {formatMoney(treasury.cashierCollectionsAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">تحصيلات عبر تطبيق صِلة</span>
                  <span className="v" style={{color: 'var(--ok)'}}>
                    + {formatMoney(treasury.appCollectionsAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">تسويات الرصيد المسبق (صِلة)</span>
                  <span className="v" style={{color: 'var(--ok)'}}>
                    + {formatMoney(treasury.prepaidCoveredAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">تسويات الحملات المستلمة</span>
                  <span className="v" style={{color: 'var(--ok)'}}>
                    + {formatMoney(treasury.campaignSettlementsAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">تحصيلات الطلبات أونلاين (COLL)</span>
                  <span className="v" style={{color: 'var(--ok)'}}>
                    + {formatMoney(treasury.onlineCollectionsAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">استردادات الطلبات أونلاين (RFD)</span>
                  <span className="v" style={{color: 'var(--danger)'}}>
                    − {formatMoney(treasury.onlineRefundsAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">إيداعات نقدية</span>
                  <span className="v" style={{color: 'var(--ok)'}}>
                    + {formatMoney(treasury.depositsAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">مصروفات</span>
                  <span className="v" style={{color: 'var(--danger)'}}>
                    − {formatMoney(treasury.expensesAllTime)}
                  </span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">مسحوبات رصيد</span>
                  <span className="v" style={{color: 'var(--danger)'}}>
                    − {formatMoney(treasury.withdrawalsAllTime)}
                  </span>
                </div>
              </div>
              {(treasury.campaignDueAllTime ?? 0) > 0 && (
                <div className="sv57-note warn">
                  مستحقات الحملات الفعّالة الآن:{' '}
                  {formatMoney(treasury.campaignDueAllTime)} دين على
                  المؤسسات حتى تصل التسوية — داخل «الدين القائم» تماماً
                  كديون الزبائن.
                </div>
              )}
            </div>
          )}

          {/* ── v76 (الجولة 80 #٤ب): تبويب «المنتجات والفواتير» —
              الأكثر إيراداً وربحاً + التفصيل القابل للتصدير. ── */}
          {activeTab === 'products' && (<>
          {/* ── 8) الأكثر إيراداً وربحاً ──────────────────────── */}
          <div className="card sv57-sec">
            <div className="sv57-sec-head">
              <div>
                <div className="sv57-sec-title">الأكثر إيراداً وربحاً</div>
                <div className="sv57-sec-hint">
                  أفضل خمسة منتجات في الفترة — والبقية في تصدير CSV
                </div>
              </div>
              <div className="sv57-seg">
                {TOP_MODES.map(mode => (
                  <button
                    key={mode.key}
                    className={topMode === mode.key ? 'on' : ''}
                    onClick={() => setTopMode(mode.key)}>
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            {topShown.length === 0 ? (
              <div className="sv57-chart-empty">
                لا توجد مبيعات بعد — أفضل منتجاتك ستظهر هنا بعد أول فاتورة
              </div>
            ) : (
              <div style={{display: 'flex', flexDirection: 'column'}}>
                {topShown.map((product, index) => {
                  const shown = Math.max(
                    topMode === 'revenue' ? product.revenue : product.profit,
                    0,
                  );
                  const pct = Math.max(6, Math.round((shown / topMax) * 100));
                  return (
                    <div className="sv57-top-line" key={product.productId}>
                      <span
                        className={`sv57-rank ${
                          index === 0
                            ? 'gold'
                            : index === 1
                            ? 'silver'
                            : index === 2
                            ? 'bronze'
                            : ''
                        }`}>
                        {index + 1}
                      </span>
                      <div style={{flex: 1, minWidth: 0}}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 10,
                            fontSize: 13,
                          }}>
                          <span className="sv57-top-name">{product.name}</span>
                          <b style={{color: 'var(--brand-ink)'}}>
                            {formatMoney(shown)}
                          </b>
                        </div>
                        <div
                          className="sv57-top-bar-track"
                          style={{
                            height: 6,
                            background: 'var(--bg)',
                            borderRadius: 99,
                            overflow: 'hidden',
                            marginTop: 5,
                            direction: 'ltr',
                          }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: product.profit < 0
                                ? 'var(--danger)'
                                : 'linear-gradient(90deg, var(--brand), var(--brand-strong))',
                              borderRadius: 99,
                            }}
                          />
                        </div>
                        <div className="sv57-sec-hint" style={{marginTop: 4}}>
                          {product.quantity} قطعة مبيعة · ربح{' '}
                          <b
                            style={{
                              color: product.profit >= 0 ? 'var(--ok)' : 'var(--danger)',
                            }}>
                            {formatMoney(product.profit)}
                          </b>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 9) تفصيل الفواتير + التصدير ──────────────────── */}
          <div className="card sv57-sec">
            <div className="sv57-sec-head">
              <div>
                <div className="sv57-sec-title">تفصيل الفواتير بالفترة</div>
                <div className="sv57-sec-hint">
                  {detail.length} صف (شاملة المرتجعات كسالبة) — تُصدَّر إلى
                  Excel
                </div>
              </div>
              <button
                className="btn"
                disabled={exportBusy || detail.length === 0}
                onClick={() => void exportCsv()}>
                {exportBusy ? 'جارٍ التصدير…' : '⬇ تصدير CSV'}
              </button>
            </div>
            {detail.length === 0 ? (
              <div className="sv57-chart-empty">
                لا فواتير في هذه الفترة
              </div>
            ) : (
              <div className="sv57-table-scroll">
                <table className="sv57-table">
                  <thead>
                    <tr>
                      <th>الفاتورة</th>
                      <th>التاريخ</th>
                      <th>أصناف</th>
                      <th>كمية</th>
                      <th>الإجمالي</th>
                      <th>الربح</th>
                      <th>الخصم</th>
                      <th>الدفع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.map(row => (
                      <tr key={row.invoice}>
                        <td className="num mut">{row.invoice}</td>
                        <td className="mut">{formatDateTime(row.createdAt)}</td>
                        <td className="num">{row.itemsCount}</td>
                        <td className="num">{row.quantity}</td>
                        <td className="num">{formatMoney(row.total)}</td>
                        <td
                          className="num"
                          style={{
                            color: row.profit >= 0 ? 'var(--ok)' : 'var(--danger)',
                          }}>
                          {formatMoney(row.profit)}
                        </td>
                        <td className="num mut">{formatMoney(row.discount)}</td>
                        <td className="mut">{row.paymentType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>)}
        </div>
        </>
      ) : (
        <div className="card">
          <div className="sv57-empty">
            <div className="icon"><Icon name="chart" size={30} /></div>
            لا بيانات — جرّب نطاقاً آخر أو أعد التحديث
          </div>
        </div>
      )}

      {/* v72 (الجولة 76 #6): نافذة سجل القناة التفصيلي — كل حركة
          داخل/خارج مع رصيد متسلسل + كشف PDF احترافي بنفس الفلاتر. */}
      {methodDetail != null && (
        <div
          className="overlay"
          onClick={e => e.target === e.currentTarget && setMethodDetail(null)}>
          <div className="modal lg" style={{width: 'min(860px, 94vw)'}}>
            <div className="modal-head">
              <span className="sv57-sec-title" style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <PaymentMethodIcon
                  method={displayMethod(methodDetail)}
                  size={34}
                />
                سجل {displayMethod(methodDetail).label} —{' '}
                {currentRange.from} ← {currentRange.to}
              </span>
              <button
                className="btn sm ghost"
                onClick={() => setMethodDetail(null)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              {methodBusy ? (
                <div className="sv57-empty">جارٍ تحميل حركات القناة…</div>
              ) : methodRows.length === 0 ? (
                <div className="sv57-empty">لا حركات على هذه القناة بالفترة</div>
              ) : (
                <div className="sv57-table-wrap">
                  <table className="sv57-table">
                    <thead>
                      <tr>
                        <th>النوع</th>
                        <th>المرجع</th>
                        <th>التاريخ</th>
                        <th>وارد</th>
                        <th>صادر</th>
                        <th>الرصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {methodRows.map((row, i) => (
                        <tr key={`${row.ref}-${i}`}>
                          <td className="mut">{row.label}</td>
                          <td className="num mut">{row.ref}</td>
                          <td className="mut">
                            {formatDateTime(row.at)}
                          </td>
                          <td
                            className="num"
                            style={{
                              color:
                                row.amountIn > 0 ? 'var(--ok)' : undefined,
                            }}>
                            {row.amountIn > 0
                              ? formatMoney(row.amountIn)
                              : '—'}
                          </td>
                          <td
                            className="num"
                            style={{
                              color:
                                row.amountOut > 0 ? 'var(--danger)' : undefined,
                            }}>
                            {row.amountOut > 0
                              ? formatMoney(row.amountOut)
                              : '—'}
                          </td>
                          <td className="num">
                            {formatMoney(
                              methodRows
                                .slice(0, i + 1)
                                .reduce(
                                  (sum, r) => sum + r.amountIn - r.amountOut,
                                  0,
                                ),
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => setMethodDetail(null)}>
                إغلاق
              </button>
              <span className="spacer" />
              <button
                className="btn"
                disabled={methodPdfBusy || methodRows.length === 0}
                onClick={() => void exportMethodPdf()}>
                {methodPdfBusy ? 'جارٍ البناء…' : 'كشف PDF'}
                <Icon name="printer" size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
