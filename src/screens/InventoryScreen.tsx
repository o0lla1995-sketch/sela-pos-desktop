/**
 * screens/InventoryScreen.tsx — المخزون والكتالوج v57 (UI-6).
 * ─────────────────────────────────────────────────────────────────
 * منقول من InventoryScreen الأندرويد (v57) إلى جدول مكتبكي كامل:
 *
 *  • جدول المنتجات: الاسم والباركود، التصنيف، التكلفة/المفرق/الجملة،
 *    المخزون بحالته (نفد/منخفض/بلا تتبع) مع وحدته، الصلاحية
 *    (منتهي/قرب الانتهاء بألوان v32)، الخصم v51 (السعر القديم مشطوباً
 *    والجديد ملوّناً)، متغيرات v35 («متغيرات N»)، والمؤرشفون (v23).
 *  • فلاتر: الكل + تصنيفات نمط المتجر الحالي (بعدّادات) + «المؤرشفة»
 *    + «الصلاحية» + بحث بالاسم أو الباركود.
 *  • الإدراج الانتقائي أونلاين v55: مفتاح بجانب كل منتج —
 *    ProductRepo.setOnlineListed + مزامنة فورية notifyCatalogChanged،
 *    وزر «مزامنة الكتالوج» اليدوي عند تغيّر الإدراج.
 *  • ملصق باركود لكل منتج (v9.1): باركود المصنّع أو توليد EAN-13
 *    داخلي فريد (بادئة 20…) يُحفظ على المنتج ثم يُطبع حرارياً
 *    (buildLabelJob) — السعر على الملصق بعد الخصم.
 *  • حذف v23: منتج له سجل مبيعات/جرد يُؤرشف (يبقى للتقارير
 *    والمرتجعات) ومنتج بلا سجل يُحذف نهائياً — نفس رسائل الأندرويد.
 *  • إدارة التصنيفات: إضافة/تسمية/حذف داخل نطاق نمط المتجر.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ProductRepo, type ProductInput} from '../database/repositories/ProductRepo';
import {CategoryRepo} from '../database/repositories/CategoryRepo';
import {UnitRepo} from '../database/repositories/UnitRepo';
import {useCatalogStore, useToastStore} from '../state/appStores';
import {useSettingsStore, getPrinter} from '../stores/settingsStore';
import {formatMoney, formatQty} from '../core/format';
import {BASE_UNIT_NAME} from '../core/config';
import {
  baseUnitLabelOf,
  daysUntilExpiry,
  expiryStateOf,
  stockStateOf,
} from '../core/types';
import type {Category, Product} from '../core/types';
import {generateInternalEan13} from '../services/BarcodeService';
import {buildLabelJob} from '../services/printer/label';
import {ThermalPrinterService} from '../services/printer/ThermalPrinterService';
import {Icon} from '../components/Icon';
import {
  notifyCatalogChanged,
  syncProducts,
} from '../services/online/OnlineStoreService';
import {ProductFormModal} from './ProductFormModal';
import {QuickProductSheet} from '../components/QuickProductSheet';
import './inventoryv57.css';

type CategoryFilter = number | 'all';

/** v51: السعر النهائي بعد خصم المنتج (0–95). */
function finalPriceOf(product: Product): number {
  const pct = Math.max(0, Math.min(95, product.discount_pct ?? 0));
  if (pct <= 0) {
    return product.retail_price;
  }
  return Math.round(product.retail_price * (1 - pct / 100) * 100) / 100;
}

/** تحويل منتج محمّل إلى ProductInput كامل (لحفظ باركود مولّد). */
function productToInput(product: Product): ProductInput {
  return {
    name: product.name,
    cost_price: product.cost_price,
    retail_price: product.retail_price,
    wholesale_price: product.wholesale_price,
    discount_pct: product.discount_pct,
    online_listed: product.online_listed,
    stock_quantity: product.stock_quantity,
    category_id: product.category_id,
    image_uri: product.image_uri,
    low_stock_threshold: product.low_stock_threshold,
    barcode: product.barcode,
    sold_by_weight: product.sold_by_weight,
    expiry_date: product.expiry_date,
    style_group: product.style_group,
    variant_size: product.variant_size,
    variant_color: product.variant_color,
    has_variants: product.has_variants,
    base_unit_name: product.base_unit_name,
    stock_untracked: product.stock_untracked,
    sizes_count: product.sizes_count,
  };
}

export function InventoryScreen() {
  const toast = useToastStore(s => s.show);
  const products = useCatalogStore(s => s.products);
  const categories = useCatalogStore(s => s.categories);
  const refresh = useCatalogStore(s => s.refresh);
  const settings = useSettingsStore(s => s.settings);

  // ── الفلاتر ──────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CategoryFilter>('all');
  /** v23: عرض «المؤرشفة» — المحذوفون ذوو السجل. */
  const [showArchived, setShowArchived] = useState(false);
  /** v32: شريحة «الصلاحية» — قرب الانتهاء/منتهي. */
  const [showExpiring, setShowExpiring] = useState(false);
  /** v77 (الجولة 81 #٥أ): فلاتر حالة المخزون — نفد/منخفض/بلا تتبع.
   *  طلب التاجر نصاً: «ان تضيف فلاتر التنبيه للمخزون مثل نفذ
   *  والصلاحية وغيرها». قيمة واحدة في كل مرة (مثل شريحة الصلاحية)،
   *  وتتركب مع فلاتر التصنيف والبحث. */
  const [stockFilter, setStockFilter] = useState<
    'none' | 'out' | 'low' | 'untracked'
  >('none');

  // ── البيانات ─────────────────────────────────────────────────
  const [archivedProducts, setArchivedProducts] = useState<Product[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(true);

  // ── النموذج ──────────────────────────────────────────────────
  /** undefined = مغلق · null = منتج جديد · Product = تعديل. */
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  // v58 (الجولة 62): الإضافة السريعة لمود «نقطة البيع».
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // ── إدارة التصنيفات ──────────────────────────────────────────
  const [catsOpen, setCatsOpen] = useState(false);
  const [catRows, setCatRows] = useState<Category[]>([]);
  const [newCatName, setNewCatName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameText, setRenameText] = useState('');

  // ── الحالة التشغيلية ─────────────────────────────────────────
  const [printBusyId, setPrintBusyId] = useState<number | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<number | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);
  /** v55: تغيّر الإدراج أونلاين — يُظهر زر «مزامنة الكتالوج». */
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadArchived = useCallback(async () => {
    setLoadingArchived(true);
    try {
      setArchivedProducts(await ProductRepo.list({archival: 'archived'}));
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر تحميل المؤرشفة',
        'error',
      );
    } finally {
      setLoadingArchived(false);
    }
  }, [toast]);

  const reloadCats = useCallback(async () => {
    try {
      setCatRows(await CategoryRepo.listWithCounts(settings.storeMode));
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر تحميل التصنيفات',
        'error',
      );
    }
  }, [settings.storeMode, toast]);

  useEffect(() => {
    void refresh();
    void loadArchived();
    void reloadCats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── القوائم المشتقة ───────────────────────────────────────── */

  /** المنتجات قرب الانتهاء أو المنتهية — الأقرب انتهاءً أولاً (v32). */
  const expiringProducts = useMemo(
    () =>
      products
        .filter(
          product =>
            expiryStateOf(product.expiry_date, settings.expiryAlertDays) !==
            'ok',
        )
        .sort(
          (a, b) =>
            daysUntilExpiry(a.expiry_date!) - daysUntilExpiry(b.expiry_date!),
        ),
    [products, settings.expiryAlertDays],
  );

  /** نتائج الفلترة للعرض النشط (بلا المؤرشفين) — في وضع «الصلاحية»
   *  يرتّب الأقرب انتهاءً أولاً (نفس سلوك v32). */
  const expiringIds = useMemo(
    () => new Set(expiringProducts.map(product => product.id)),
    [expiringProducts],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = products.filter(product => {
      if (filter !== 'all' && product.category_id !== filter) {
        return false;
      }
      if (showExpiring && !expiringIds.has(product.id)) {
        return false;
      }
      // v77 (الجولة 81 #٥أ): فلتر حالة المخزون — نفد/منخفض/بلا تتبع
      // (يتكون مع التصنيف والبحث؛ «بلا تتبع» ليست حالة تنبيه لكنها
      // مجموعة عمل يريد التاجر عزلها بنفس الأداة).
      if (stockFilter !== 'none') {
        if (stockFilter === 'untracked') {
          if (product.stock_untracked !== 1) {
            return false;
          }
        } else {
          if (product.stock_untracked === 1) {
            return false;
          }
          const state = stockStateOf(
            product,
            settings.lowStockDefaultThreshold,
          );
          if (state !== stockFilter) {
            return false;
          }
        }
      }
      if (
        query &&
        !product.name.toLowerCase().includes(query) &&
        !(product.barcode ?? '').toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
    if (showExpiring) {
      rows.sort(
        (a, b) =>
          daysUntilExpiry(a.expiry_date!) - daysUntilExpiry(b.expiry_date!),
      );
    }
    return rows;
  }, [
    products,
    search,
    filter,
    showExpiring,
    stockFilter,
    expiringIds,
    settings.lowStockDefaultThreshold,
  ]);

  /** عرض «المؤرشفة»: نفس البحث، بلا فلاتر التصنيف/الصلاحية. */
  const archivedFiltered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return archivedProducts;
    }
    return archivedProducts.filter(
      product =>
        product.name.toLowerCase().includes(query) ||
        (product.barcode ?? '').toLowerCase().includes(query),
    );
  }, [archivedProducts, search]);

  const visible = showArchived ? archivedFiltered : filtered;

  /* ── v61 (الجولة 26 #2): التنقل بأسهم الكيبورد في جدول المنتجات ──
     ↑/↓ يحرّكان صفّاً معيّناً، Enter يفتح ملف المنتج للتعديل،
     والصف المعيّن يُبرز ويُبقى داخل مجال الرؤية. */
  const [selRowId, setSelRowId] = useState<number | null>(null);
  const tableWrapRef = useRef<HTMLTableElement | null>(null);

  const moveRowSelection = useCallback(
    (delta: number): void => {
      if (visible.length === 0) return;
      const current =
        selRowId == null ? -1 : visible.findIndex(p => p.id === selRowId);
      const next =
        current === -1
          ? delta > 0
            ? 0
            : visible.length - 1
          : Math.max(0, Math.min(visible.length - 1, current + delta));
      setSelRowId(visible[next].id);
    },
    [visible, selRowId],
  );

  useEffect(() => {
    if (selRowId != null && !visible.some(p => p.id === selRowId)) {
      setSelRowId(null);
    }
  }, [visible, selRowId]);

  useEffect(() => {
    if (selRowId == null) return;
    tableWrapRef.current
      ?.querySelector<HTMLElement>('[data-rowsel="true"]')
      ?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }, [selRowId]);

  // v77 (الجولة 81 #٥ج): مستمع المفاتيح نُقل بعد تعريف removeProduct
  // (تعريفه أدناه) كي يصل إليه معالج مفتاح الحذف مباشرة — انظر
  // التعليق الكامل فوق useEffect المُقابل تحت removeProduct.

  const countFor = useCallback(
    (categoryId: CategoryFilter) =>
      categoryId === 'all'
        ? products.length
        : products.filter(product => product.category_id === categoryId).length,
    [products],
  );

  const lowCount = useMemo(
    () =>
      products.filter(product => {
        // v38: بلا تتبع ليس حالة تنبيه — الكمية مرجعية.
        const state = stockStateOf(product, settings.lowStockDefaultThreshold);
        return state === 'low' || state === 'out';
      }).length,
    [products, settings.lowStockDefaultThreshold],
  );

  /* ── v77 (الجولة 81 #٥أ): عدادات فلاتر حالة المخزون — كل شريحة
     تحمل رقمها الحقيقي كي يرى التاجر حجم كل مجموعة قبل الضغط. */
  const outCount = useMemo(
    () =>
      products.filter(
        product =>
          product.stock_untracked !== 1 &&
          stockStateOf(product, settings.lowStockDefaultThreshold) === 'out',
      ).length,
    [products, settings.lowStockDefaultThreshold],
  );
  const lowOnlyCount = useMemo(
    () =>
      products.filter(
        product =>
          product.stock_untracked !== 1 &&
          stockStateOf(product, settings.lowStockDefaultThreshold) === 'low',
      ).length,
    [products, settings.lowStockDefaultThreshold],
  );
  const untrackedCount = useMemo(
    () => products.filter(product => product.stock_untracked === 1).length,
    [products],
  );

  /* ── v76 (الجولة 80 #١): قيمة البضاعة في المخزون — جمع تكلفتها
     وكميتها لكل منتج متتبع الكمية. منتجات «الكمية المفتوحة»
     (stock_untracked=1) لا كمية معروفة لها فلا تُحتسب قيمتها —
     تُعد وتُعرض منفصلة كي يعرف التاجر بدقة ما الذي يشمله الرقم.
     المتغيرات محسوبة تلقائياً: products.stock_quantity يساوي دائماً
     مجموع مخزون متغيراتها (VariantRepo v35). ── */
  const stockValue = useMemo(() => {
    let totalCostValue = 0;
    let totalRetailValue = 0;
    let trackedCount = 0;
    let untrackedCount = 0;
    let outCount = 0;
    for (const product of products) {
      if (product.stock_untracked === 1) {
        untrackedCount += 1;
        continue;
      }
      trackedCount += 1;
      const qty = Math.max(0, product.stock_quantity ?? 0);
      if (qty <= 0) {
        outCount += 1;
      }
      totalCostValue += product.cost_price * qty;
      totalRetailValue += finalPriceOf(product) * qty;
    }
    return {
      totalCostValue: Math.round(totalCostValue * 100) / 100,
      totalRetailValue: Math.round(totalRetailValue * 100) / 100,
      trackedCount,
      untrackedCount,
      outCount,
    };
  }, [products]);

  const categoryNameById = useMemo(
    () => new Map(categories.map(c => [c.id, c.name] as const)),
    [categories],
  );

  /* ── الملصق (v9.1): باركود أو توليد داخلي ثم طباعة ─────────── */
  const printLabel = useCallback(
    async (product: Product) => {
      if (printBusyId != null) {
        return;
      }
      if (getPrinter().channel === 'none') {
        toast('لا توجد طابعة مضبوطة — اضبط قناة الطابعة من الإعدادات', 'error');
        return;
      }
      setPrintBusyId(product.id);
      try {
        let code = product.barcode?.trim() ?? '';
        if (code.length === 0) {
          // منتج بلا باركود → EAN-13 داخلي فريد يُحفظ عليه فوراً.
          code = await generateInternalEan13(async candidate => {
            const productHit = await ProductRepo.findByBarcode(candidate);
            if (productHit != null) {
              return true;
            }
            const unitHit = await UnitRepo.findByBarcode(candidate);
            return unitHit != null;
          });
          await ProductRepo.update(product.id, {
            ...productToInput(product),
            barcode: code,
          });
          await refresh();
          toast(`وُلّد باركود داخلي لـ${product.name}: ${code}`, 'success');
        }
        const pct = Math.max(0, Math.min(95, product.discount_pct ?? 0));
        const price = finalPriceOf(product);
        const job = buildLabelJob(
          {
            productName: product.name,
            price,
            priceNote:
              pct > 0
                ? `خصم ${Math.round(pct)}% — بدلاً من ${formatMoney(
                    product.retail_price,
                  )}`
                : product.sold_by_weight === 1
                ? `سعر الكيلو ${formatMoney(price)}`
                : null,
            barcode: code,
            copies: 1,
          },
          {paperWidth: settings.paperWidth, codepage: settings.codepage},
        );
        await ThermalPrinterService.printJob(job, 'label');
        toast(`طُبع ملصق ${product.name}`, 'success');
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشل طباعة الملصق',
          'error',
        );
      } finally {
        setPrintBusyId(null);
      }
    },
    [printBusyId, refresh, settings.paperWidth, settings.codepage, toast],
  );

  /* ── v55: تبديل الإدراج أونلاين ────────────────────────────── */
  const toggleOnlineListed = useCallback(
    async (product: Product) => {
      if (toggleBusyId != null) {
        return;
      }
      const target = product.online_listed !== 1;
      setToggleBusyId(product.id);
      try {
        const done = await ProductRepo.setOnlineListed(product.id, target);
        if (!done) {
          toast('لا يمكن إدراج منتج مؤرشف', 'error');
          return;
        }
        await refresh();
        notifyCatalogChanged();
        setCatalogDirty(true);
        toast(
          target
            ? `«${product.name}» معروض الآن في متجر سيلا — يتحدث خلال ثوانٍ`
            : `أُوقف عرض «${product.name}» — يختفي من المتجر خلال ثوانٍ`,
          'success',
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر تغيير الإدراج',
          'error',
        );
      } finally {
        setToggleBusyId(null);
      }
    },
    [toggleBusyId, refresh, toast],
  );

  /** «مزامنة الكتالوج» اليدوية بعد تغييرات الإدراج. */
  const syncCatalogNow = useCallback(async () => {
    if (syncing) {
      return;
    }
    setSyncing(true);
    try {
      const saved = await syncProducts();
      setCatalogDirty(false);
      toast(
        saved > 0
          ? `زُامن ${saved} منتجاً مع المتجر الأونلاين`
          : 'المتجر الأونلاين معطّل أو لا تغييرات جديدة للمزامنة',
        saved > 0 ? 'success' : 'info',
      );
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذرت مزامنة الكتالوج',
        'error',
      );
    } finally {
      setSyncing(false);
    }
  }, [syncing, toast]);

  /* ── v76 (الجولة 80 #٢): تقرير PDF بالمخزون كاملاً — يصدّر
     المنتجات النشطة (بالفلاتر النشطة إن وجدت) مجمّعة بالتصنيف
     مع قيمة كل سطر وكل تصنيف والإجمالي الكبير. ── */
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportInventoryPdf = useCallback(async () => {
    if (pdfBusy || filtered.length === 0) {
      return;
    }
    setPdfBusy(true);
    try {
      const {exportInventoryReportPdf} = await import(
        '../services/InventoryReportPdf'
      );
      const activeFilters: string[] = [];
      if (filter !== 'all') {
        const cat = categories.find(c => c.id === filter);
        if (cat != null) {
          activeFilters.push(`تصنيف: ${cat.name}`);
        }
      }
      if (showExpiring) {
        activeFilters.push('الصلاحية القريبة/المنتهية');
      }
      // v77 (الجولة 81 #٥أ): تسمية فلتر حالة المخزون في ترويسة PDF.
      if (stockFilter === 'out') {
        activeFilters.push('نفد');
      } else if (stockFilter === 'low') {
        activeFilters.push('منخفض');
      } else if (stockFilter === 'untracked') {
        activeFilters.push('بلا تتبع');
      }
      if (search.trim()) {
        activeFilters.push(`بحث: «${search.trim()}»`);
      }
      const filtersLabel =
        activeFilters.length > 0
          ? `فلاتر: ${activeFilters.join(' · ')}`
          : 'كل المنتجات النشطة';
      const result = await exportInventoryReportPdf({
        storeName: settings.storeName || 'متجر سيلا',
        filtersLabel,
        rows: filtered.map(product => ({
          name: product.name,
          barcode: (product.barcode ?? '').trim(),
          category:
            categoryNameById.get(product.category_id ?? -1) ?? 'بلا تصنيف',
          costPrice: product.cost_price,
          quantity: product.stock_quantity,
          unitLabel: baseUnitLabelOf(product, BASE_UNIT_NAME),
          untracked: product.stock_untracked === 1,
          stockState:
            product.stock_untracked === 1
              ? 'untracked'
              : stockStateOf(product, settings.lowStockDefaultThreshold),
        })),
      });
      toast(
        `تم حفظ تقرير المخزون (${result.count} منتجاً · ${result.pages} صفحة): ${result.path}`,
        'success',
        6000,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('أُلغيت')) {
        toast(message, 'error', 6000);
      }
    } finally {
      setPdfBusy(false);
    }
  }, [
    pdfBusy,
    filtered,
    filter,
    showExpiring,
    stockFilter,
    search,
    categories,
    categoryNameById,
    settings.storeName,
    settings.lowStockDefaultThreshold,
    toast,
  ]);

  /* ── الحذف/الأرشفة/الاسترجاع (v23) ─────────────────────────── */
  const removeProduct = useCallback(
    async (product: Product) => {
      if (deleteBusyId != null) {
        return;
      }
      let hasHistory = false;
      try {
        hasHistory = await ProductRepo.hasHistory(product.id);
      } catch {
        hasHistory = true; // عند الشك نأرشف لا نحذف — سلامة السجل.
      }
      const message = hasHistory
        ? 'هذا المنتج له سجل مبيعات أو جرد يمنع حذفه نهائياً. سيُؤرشف: يختفي من البيع والمخزن والتنبيهات ويبقى سجله كاملاً للفواتير والتقارير والمرتجعات، ويمكن استرجاعه في أي وقت.'
        : 'لا سجل لهذا المنتج — سيُحذف نهائياً مع وحداته. لا يمكن التراجع.';
      const confirmed = window.confirm(
        `${hasHistory ? 'أرشفة المنتج؟' : 'حذف المنتج نهائياً؟'}\n\n${message}`,
      );
      if (!confirmed) {
        return;
      }
      setDeleteBusyId(product.id);
      try {
        const outcome = await ProductRepo.remove(product.id);
        await refresh();
        await loadArchived();
        if (outcome === 'archived') {
          toast(
            'أُرشف المنتج — اختفى من البيع والمخزن وبقي سجله للتقارير والمرتجعات (يمكن استرجاعه)',
            'success',
            6000,
          );
        } else {
          toast('تم حذف المنتج نهائياً', 'success');
        }
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشل حذف المنتج',
          'error',
        );
      } finally {
        setDeleteBusyId(null);
      }
    },
    [deleteBusyId, refresh, loadArchived, toast],
  );

  const unarchiveProduct = useCallback(
    async (product: Product) => {
      if (deleteBusyId != null) {
        return;
      }
      setDeleteBusyId(product.id);
      try {
        await ProductRepo.unarchive(product.id);
        await refresh();
        await loadArchived();
        setShowArchived(true);
        toast('استُرجع المنتج — عاد للعرض والبيع', 'success');
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشل استرجاع المنتج',
          'error',
        );
      } finally {
        setDeleteBusyId(null);
      }
    },
    [deleteBusyId, refresh, loadArchived, toast],
  );

  /* ── v61 (الجولة 26 #2) ← v77 (الجولة 81 #٥ج): التنقل بأسهم
     الكيبورد في جدول المنتجات — ↑/↓ يحرّكان صفّاً معيّناً، Enter
     يفتح ملف المنتج للتعديل، والآن Delete يحذف المنتج المعيّن
     مباشرة من الجدول دون فتحه (طلب التاجر نصاً: «ان يستطيع أيضا
     يحذف المنتج من الكيبورد بدون فتح المنتج») — مع مربع التأكيد
     نفسه وزر الحذف (أرشفة إن كان له سجل) وبقاء التحديد على الصف
     التالي بعد الحذف كي يُحذف صفٌّ آخر بضغطة واحدة. المستمع يُعلَّن
     هنا بعد تعريف removeProduct كي يصل إليه. ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // نافذة/صفحة ملف المنتج مفتوحة؟ الكيبورد ملكها (Ctrl+S للحفظ…).
      if (editing !== undefined) return;
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
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveRowSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveRowSelection(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (visible.length > 0) setSelRowId(visible[0].id);
      } else if (e.key === 'End') {
        e.preventDefault();
        if (visible.length > 0) setSelRowId(visible[visible.length - 1].id);
      } else if (e.key === 'Enter') {
        if (selRowId == null) return;
        const product = visible.find(p => p.id === selRowId);
        if (product != null) {
          e.preventDefault();
          setEditing(product);
        }
      } else if (e.key === 'Delete') {
        // v77 (الجولة 81 #٥ج): حذف الصف المعيّن من الكيبورد بلا فتح.
        if (selRowId == null) return;
        const idx = visible.findIndex(p => p.id === selRowId);
        const product = idx >= 0 ? visible[idx] : null;
        if (product == null) return;
        e.preventDefault();
        // الصف الذي يحل محل المحذوف: التالي، وإلا السابق.
        const nextProduct = visible[idx + 1] ?? visible[idx - 1] ?? null;
        void removeProduct(product).then(() => {
          setSelRowId(nextProduct?.id ?? null);
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, moveRowSelection, visible, selRowId, removeProduct]);

  /* ── إدارة التصنيفات ───────────────────────────────────────── */
  const addCategory = useCallback(async () => {
    const trimmed = newCatName.trim();
    if (!trimmed) {
      return;
    }
    try {
      await CategoryRepo.create(trimmed, settings.storeMode);
      setNewCatName('');
      await reloadCats();
      await refresh();
      toast(`أُضيف تصنيف «${trimmed}»`, 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر إضافة التصنيف',
        'error',
      );
    }
  }, [newCatName, settings.storeMode, reloadCats, refresh, toast]);

  const commitRename = useCallback(
    async (category: Category) => {
      const trimmed = renameText.trim();
      setRenamingId(null);
      if (!trimmed || trimmed === category.name) {
        return;
      }
      try {
        await CategoryRepo.rename(category.id, trimmed);
        await reloadCats();
        await refresh();
        toast(`أُعيد تسمية التصنيف إلى «${trimmed}»`, 'success');
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذرت إعادة التسمية',
          'error',
        );
      }
    },
    [renameText, reloadCats, refresh, toast],
  );

  const deleteCategory = useCallback(
    async (category: Category) => {
      const confirmed = window.confirm(
        `حذف تصنيف «${category.name}»؟\n\nالمنتجات (${
          category.productCount ?? 0
        }) تبقى موجودة لكن بلا تصنيف — نفس سلوك أنظمة POS العالمية.`,
      );
      if (!confirmed) {
        return;
      }
      try {
        await CategoryRepo.remove(category.id);
        if (filter === category.id) {
          setFilter('all');
        }
        await reloadCats();
        await refresh();
        toast(`حُذف تصنيف «${category.name}»`, 'info');
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر حذف التصنيف',
          'error',
        );
      }
    },
    [filter, reloadCats, refresh, toast],
  );

  /* ── العرض ─────────────────────────────────────────────────── */
  return (
    <div className="screen">
      <h1>المخزون والكتالوج</h1>
      <div className="subtitle">
        {products.length} منتجاً نشطاً
        {lowCount > 0 ? ` · ${lowCount} يحتاج انتباهاً` : ''}
        {expiringProducts.length > 0
          ? ` · ${expiringProducts.length} صلاحيته قريبة أو منتهية`
          : ''}
        {archivedProducts.length > 0 ? ` · ${archivedProducts.length} مؤرشفاً` : ''}
        {' — '}الأسعار والمخزون والوحدات والملصقات والإدراج أونلاين
      </div>

      {/* ملخص سريع */}
      <div className="grid-4">
        {/* ── v76 (الجولة 80 #١): قيمة البضاعة الحالية في المخزون
            بالكامل — تكلفة × كمية لكل منتج متتبع، بدقة، مع بيان
            منتجات الكمية المفتوحة التي لا تُحتسب. ── */}
        <div className="card kpi inv-value-card">
          <span className="label">قيمة البضاعة في المخزون (تكلفة)</span>
          <span className="value brand" dir="ltr">
            {formatMoney(stockValue.totalCostValue)}
          </span>
          <span className="label">
            قيمة بيعها {formatMoney(stockValue.totalRetailValue)} · متتبع{' '}
            {stockValue.trackedCount}
            {stockValue.untrackedCount > 0
              ? ` · ${stockValue.untrackedCount} كمية مفتوحة بلا قيمة محسوبة`
              : ''}
          </span>
        </div>
        <div className="card kpi">
          <span className="label">منتجات نشطة</span>
          <span className="value brand">{products.length}</span>
          <span className="label">{categories.length} تصنيفاً بنمط المتجر</span>
        </div>
        <div className="card kpi">
          <span className="label">يحتاج انتباهاً</span>
          <span className="value" style={{color: 'var(--warn)'}}>
            {lowCount}
          </span>
          <span className="label">نفد أو تحت حد التنبيه</span>
        </div>
        <div className="card kpi">
          <span className="label">مدرج أونلاين (سيلا)</span>
          <span className="value ok">
            {products.filter(p => p.online_listed === 1).length}
          </span>
          <span className="label">
            {catalogDirty ? 'تغييرات بانتظار المزامنة…' : 'المزامنة ترسل المدرج فقط'}
          </span>
        </div>
      </div>

      {/* ── v76 (الجولة 80 #١): شريط تفصيل قيمة المخزون — يجمع
          المعادلة كاملة أمام عين التاجر: المتتبع، النافد، الكمية
          المفتوحة، وهامش القيمة البيعية. ── */}
      <div className="inv-value-strip">
        <div className="inv-value-cell">
          <span className="k">قيمة بالتكلفة</span>
          <span className="v brand" dir="ltr">
            {formatMoney(stockValue.totalCostValue)}
          </span>
        </div>
        <div className="inv-value-cell">
          <span className="k">قيمة بالبيع</span>
          <span className="v ok" dir="ltr">
            {formatMoney(stockValue.totalRetailValue)}
          </span>
        </div>
        <div className="inv-value-cell">
          <span className="k">هامش متوقع</span>
          <span className="v" dir="ltr">
            {formatMoney(
              stockValue.totalRetailValue - stockValue.totalCostValue,
            )}
          </span>
        </div>
        <div className="inv-value-cell">
          <span className="k">منتجات متتبعة الكمية</span>
          <span className="v">{stockValue.trackedCount}</span>
        </div>
        <div className="inv-value-cell">
          <span className="k">كمية مفتوحة (بلا تتبع)</span>
          <span className="v warn">{stockValue.untrackedCount}</span>
        </div>
      </div>

      {/* شريط الأدوات والفلاتر */}
      <div className="toolbar" style={{marginTop: 14}}>
        <div className="inv-search">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الباركود…"
            aria-label="بحث في المنتجات"
          />
        </div>
        {settings.storeMode === 'pos' ? (
          <button
            className="btn success"
            onClick={() => setQuickAddOpen(true)}>
            + سريع
          </button>
        ) : null}
        <button
          className="btn primary"
          onClick={() => setEditing(null)}>
          + منتج جديد
        </button>
        <button
          className={`btn ${catsOpen ? '' : 'ghost'}`}
          onClick={() => {
            setCatsOpen(prev => !prev);
            if (!catsOpen) {
              void reloadCats();
            }
          }}>
          التصنيفات
        </button>
        {catalogDirty && (
          <button
            className="btn"
            disabled={syncing}
            onClick={() => void syncCatalogNow()}>
            {syncing ? 'جارٍ الآن…' : '🔄 مزامنة الكتالوج'}
          </button>
        )}
        {/* ── v76 (الجولة 80 #٢): تقرير PDF للمخزون بالتفصيل — كل
            المنتجات مجمّعة بالتصنيف مع القيمة الإجمالية. ── */}
        <button
          className="btn ghost inv-pdf-btn"
          disabled={pdfBusy || products.length === 0}
          onClick={() => void exportInventoryPdf()}>
          {pdfBusy ? (
            'جارٍ البناء…'
          ) : (
            <>
              <Icon name="printer" size={15} />
              تقرير PDF
            </>
          )}
        </button>
      </div>

      {/* رقائق الفلترة — الكل + التصنيفات + المؤرشفة + الصلاحية */}
      <div className="iv57-chips" style={{marginBottom: 14}}>
        <button
          className={`iv57-chip ${
            filter === 'all' &&
            !showArchived &&
            !showExpiring &&
            stockFilter === 'none'
              ? 'on'
              : ''
          }`}
          onClick={() => {
            setShowArchived(false);
            setShowExpiring(false);
            setStockFilter('none');
            setFilter('all');
          }}>
          الكل <span className="cnt">{products.length}</span>
        </button>
        {categories.map(category => (
          <button
            key={category.id}
            className={`iv57-chip ${
              filter === category.id &&
              !showArchived &&
              !showExpiring &&
              stockFilter === 'none'
                ? 'on'
                : ''
            }`}
            onClick={() => {
              setShowArchived(false);
              setShowExpiring(false);
              setStockFilter('none');
              setFilter(category.id);
            }}>
            {category.name} <span className="cnt">{countFor(category.id)}</span>
          </button>
        ))}
        {archivedProducts.length > 0 && (
          <button
            className={`iv57-chip ${showArchived ? 'on' : ''}`}
            onClick={() => {
              setShowExpiring(false);
              setShowArchived(!showArchived);
            }}>
            المؤرشفة <span className="cnt">{archivedProducts.length}</span>
          </button>
        )}
        {expiringProducts.length > 0 && (
          <button
            className={`iv57-chip ${showExpiring ? 'on' : ''}`}
            onClick={() => {
              setShowArchived(false);
              setShowExpiring(!showExpiring);
            }}>
            الصلاحية <span className="cnt">{expiringProducts.length}</span>
          </button>
        )}
        {/* ── v77 (الجولة 81 #٥أ): فلاتر حالة المخزون — نفذ/منخفض/
            بلا تتبع. تظهر دائماً (وليس عند وجودها فقط) كي يجد التاجر
            الأداة في مكانها الثابت، وتتعطل عند عدم وجود عناصرها. */}
        <button
          className={`iv57-chip danger ${stockFilter === 'out' ? 'on' : ''}`}
          disabled={outCount === 0 && stockFilter !== 'out'}
          onClick={() => setStockFilter(stockFilter === 'out' ? 'none' : 'out')}
          title="منتجات نفدت كميتها بالكامل">
          نفذ <span className="cnt">{outCount}</span>
        </button>
        <button
          className={`iv57-chip warn ${stockFilter === 'low' ? 'on' : ''}`}
          disabled={lowOnlyCount === 0 && stockFilter !== 'low'}
          onClick={() => setStockFilter(stockFilter === 'low' ? 'none' : 'low')}
          title="تحت حد التنبيه لكن لم ينفد">
          منخفض <span className="cnt">{lowOnlyCount}</span>
        </button>
        <button
          className={`iv57-chip ${stockFilter === 'untracked' ? 'on' : ''}`}
          disabled={untrackedCount === 0 && stockFilter !== 'untracked'}
          onClick={() =>
            setStockFilter(stockFilter === 'untracked' ? 'none' : 'untracked')
          }
          title="كمية مفتوحة — البيع لا يخصم ولا يُحجب">
          بلا تتبع <span className="cnt">{untrackedCount}</span>
        </button>
      </div>

      {/* إدارة التصنيفات */}
      {catsOpen && (
        <div className="card" style={{marginBottom: 14}}>
          <div className="pf-sec-h" style={{marginBottom: 10}}>
            <b>إدارة التصنيفات</b>
            <span className="pf-sec-sub">
              داخل نطاق «{settings.storeMode}» — التبديل بين الأنماط لا يحذف
              تصنيفات غيره
            </span>
          </div>
          <div className="catman-form">
            <input
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="اسم تصنيف جديد… (مثال: مشروبات غازية)"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addCategory();
                }
              }}
            />
            <button className="btn" onClick={() => void addCategory()}>
              + إضافة تصنيف
            </button>
          </div>
          <div className="catman-rows">
            {catRows.length === 0 && (
              <div className="catman-empty">لا تصنيفات بعد — أضف أول تصنيف أعلاه.</div>
            )}
            {catRows.map(category =>
              renamingId === category.id ? (
                <div key={category.id} className="catman-row">
                  <input
                    value={renameText}
                    autoFocus
                    onChange={e => setRenameText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitRename(category);
                      } else if (e.key === 'Escape') {
                        setRenamingId(null);
                      }
                    }}
                  />
                  <button
                    className="btn sm"
                    onClick={() => void commitRename(category)}>
                    حفظ
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => setRenamingId(null)}>
                    إلغاء
                  </button>
                </div>
              ) : (
                <div key={category.id} className="catman-row">
                  <span className="nm">{category.name}</span>
                  <span className="cnt">{category.productCount ?? 0} منتجاً</span>
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      setRenamingId(category.id);
                      setRenameText(category.name);
                    }}>
                    تسمية
                  </button>
                  <button
                    className="btn sm danger"
                    onClick={() => void deleteCategory(category)}>
                    حذف
                  </button>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* جدول المنتجات */}
      <table className="inv-table" ref={tableWrapRef}>
        <thead>
          <tr>
            <th>المنتج</th>
            <th>التصنيف</th>
            <th>التكلفة</th>
            <th>البيع</th>
            <th>الجملة</th>
            <th>المخزون</th>
            <th>الوحدة</th>
            <th>الصلاحية</th>
            <th>أونلاين</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={10}>
                <div className="empty" style={{padding: '28px 16px'}}>
                  <div className="icon">
                    <Icon
                      name={showArchived ? 'archive' : showExpiring ? 'clock' : 'box'}
                      size={30}
                    />
                  </div>
                  {loadingArchived && showArchived
                    ? 'جارٍ تحميل المؤرشفة…'
                    : showArchived
                    ? 'لا منتجات مؤرشفة — المنتجات المحذوفة ذات سجل تُؤرشف هنا بدل حذفها نهائياً'
                    : showExpiring
                    ? 'لا منتجات قرب انتهاء الصلاحية — حدّد تاريخ انتهاء للمنتجات ذات الصلاحية لتظهر هنا'
                    : products.length === 0
                    ? 'المخزون فارغ — أضف أول منتج بزر «+ منتج جديد»'
                    : 'لا نتائج — جرّب كلمة بحث أو تصنيفاً آخر'}
                </div>
              </td>
            </tr>
          )}
          {visible.map(product => {
            const state = stockStateOf(
              product,
              settings.lowStockDefaultThreshold,
            );
            const expiry = expiryStateOf(
              product.expiry_date,
              settings.expiryAlertDays,
            );
            const variantCount = product.variants?.length ?? 0;
            const pct = Math.max(0, Math.min(95, product.discount_pct ?? 0));
            return (
              <tr
                key={product.id}
                className={`${product.is_archived === 1 ? 'archived' : ''} ${selRowId === product.id ? 'rowsel' : ''}`}
                data-rowsel={selRowId === product.id ? 'true' : undefined}>
                <td>
                  <div className="inv-name">
                    <b>{product.name}</b>
                    <span className="barcode">{product.barcode ?? '—'}</span>
                    <span className="inv-tags">
                      {(product.has_variants === 1 || variantCount > 0) && (
                        <span className="iv57-mini-chip brand">
                          متغيرات{variantCount > 0 ? ` ${variantCount}` : ''}
                        </span>
                      )}
                      {product.sold_by_weight === 1 && (
                        <span className="iv57-mini-chip">وزن · كغ</span>
                      )}
                      {product.stock_untracked === 1 && (
                        <span className="iv57-mini-chip">بلا تتبع</span>
                      )}
                      {product.is_archived === 1 && (
                        <span className="iv57-mini-chip warn">مؤرشف</span>
                      )}
                    </span>
                  </div>
                </td>
                <td>{categoryNameById.get(product.category_id ?? -1) ?? '—'}</td>
                <td className="iv57-num">{formatMoney(product.cost_price)}</td>
                <td>
                  <div className="inv-price-cell">
                    {pct > 0 ? (
                      <>
                        <span className="old">
                          {formatMoney(product.retail_price)}
                        </span>
                        <span className="new">{formatMoney(finalPriceOf(product))}</span>
                        <span className="iv57-mini-chip danger">
                          −{Math.round(pct)}%
                        </span>
                      </>
                    ) : (
                      <b>{formatMoney(product.retail_price)}</b>
                    )}
                  </div>
                </td>
                <td className="iv57-num">
                  {formatMoney(product.wholesale_price)}
                </td>
                <td>
                  <span
                    className={`inv-stock-badge ${
                      state === 'out'
                        ? 'out'
                        : state === 'low'
                        ? 'low'
                        : state === 'untracked'
                        ? 'untracked'
                        : 'ok'
                    }`}>
                    {state === 'out'
                      ? 'نفد'
                      : state === 'untracked'
                      ? 'بلا تتبع'
                      : `${formatQty(product.stock_quantity)} ${baseUnitLabelOf(
                          product,
                          BASE_UNIT_NAME,
                        )}`}
                  </span>
                </td>
                <td>{baseUnitLabelOf(product, BASE_UNIT_NAME)}</td>
                <td>
                  {product.expiry_date != null && expiry !== 'ok' ? (
                    <span
                      className={`iv57-mini-chip ${
                        expiry === 'expired' ? 'danger' : 'warn'
                      }`}>
                      {expiry === 'expired' ? 'منتهي' : 'قرب الانتهاء'}
                      {' · '}
                      {product.expiry_date.replace(/-/g, '/')}
                    </span>
                  ) : product.expiry_date != null ? (
                    <span className="iv57-hint">
                      {product.expiry_date.replace(/-/g, '/')}
                    </span>
                  ) : (
                    <span className="iv57-hint">—</span>
                  )}
                </td>
                <td>
                  <label className="iv57-switch">
                    <input
                      type="checkbox"
                      checked={product.online_listed === 1}
                      disabled={
                        product.is_archived === 1 || toggleBusyId === product.id
                      }
                      onChange={() => void toggleOnlineListed(product)}
                      title={
                        product.is_archived === 1
                          ? 'المؤرشف لا يُدرج — استرجعه أولاً'
                          : 'الإدراج الانتقائي في متجر سيلا ماركت'
                      }
                    />
                    <span className="track" />
                  </label>
                </td>
                <td>
                  <div className="inv-actions">
                    <button
                      className="btn sm ghost"
                      title={`تعديل ${product.name}`}
                      onClick={() => setEditing(product)}>
                      تعديل
                    </button>
                    <button
                      className="btn sm ghost"
                      title="طباعة ملصق باركود (يولّد باركوداً داخلياً إن لم يوجد)"
                      disabled={printBusyId === product.id}
                      onClick={() => void printLabel(product)}>
                      {printBusyId === product.id ? (
                        '…'
                      ) : (
                        <Icon name="printer" size={15} />
                      )}
                    </button>
                    {product.is_archived === 1 ? (
                      <button
                        className="btn sm ghost"
                        title="استرجاع للرف"
                        disabled={deleteBusyId === product.id}
                        onClick={() => void unarchiveProduct(product)}>
                        <Icon name="undo" size={15} />
                      </button>
                    ) : (
                      <button
                        className="btn sm ghost"
                        title="حذف — يؤرشف إن كان له سجل"
                        disabled={deleteBusyId === product.id}
                        onClick={() => void removeProduct(product)}>
                        {deleteBusyId === product.id ? '…' : '🗑'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="inv-count-row">
        {visible.length} منتجاً معروضاً
        {showArchived ? ' (المؤرشفة)' : ''}
        {showExpiring ? ' (الصلاحية — الأقرب انتهاءً أولاً)' : ''}
        {stockFilter === 'out'
          ? ' (نفد)'
          : stockFilter === 'low'
          ? ' (منخفض)'
          : stockFilter === 'untracked'
          ? ' (بلا تتبع)'
          : ''}
        {' — '}عند التعديل تفتح صفحة ملف المنتج بكامل قدراتها (خصم،
        متغيرات، وحدات، استلام بضاعة).
      </div>

      {/* v58 (الجولة 62): نافذة الإضافة السريعة لمود نقطة البيع. */}
      <QuickProductSheet
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      />

      {/* نافذة ملف المنتج */}
      {editing !== undefined && (
        <ProductFormModal
          product={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            void refresh();
            void loadArchived();
            void reloadCats();
          }}
        />
      )}
    </div>
  );
}
