/**
 * screens/ProductFormModal.tsx — ملف المنتج v57 (نافذة سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * منقول من ProductFormScreen الأندرويد (v57، 5164 سطراً) إلى نافذة
 * DOM واحدة بكل قدرات النموذج:
 *
 *  • نسخة كل نمط متجر (v33/v35 storeModes): تسميات بلغة المجال،
 *    جملة/بلا جملة، صلاحية بارزة/اختيارية/مخفية، استلام بضاعة، ربطة
 *    ملابس، أحجام مطعم/كافيتريا، وحدة الأساس، مخزون بلا تتبع.
 *  • الخصم v51 (0–95%) بمعاينة حية، والإدراج أونلاين v55 (المزامنة
 *    ترسل المدرج فقط — notifyCatalogChanged بعد الحفظ).
 *  • الباركود: توليد EAN-13 داخلي فريد (بادئة 20…، تحقق ضد المنتجات
 *    ووحداتها) + طباعة ملصقات حرارية (buildLabelJob) بعدد نسخ.
 *  • المخزون: إدخال بأي وحدة بيع مع إعادة تعبير حية بلا فقدان (v38)،
 *    حارس «الانهيار إلى الصفر»، و«بلا تتبع» يحفظ القائم كما هو عند
 *    أي تعديل (v37 — جذر شكوى تصفير المخزون).
 *  • المتغيرات v35: الربطة (مقاسات × ألوان × عدد الربط) للملابس
 *    الجديدة، محرّر المتغيرات (لون × مقاس × مخزون) للتعديل، وأحجام
 *    المطعم/الكافيتريا بسعر وتكلفة لكل حجم — مع قواعد المزامنة v39
 *    (الملابس فقط تزامن مخزون الموديل مع مجموع متغيراته).
 *  • صفوف وحدات البيع: معامل تحويل كسري (وقية = 0.25)، باركود لكل
 *    وحدة، تجاوزات مفرق/جملة، اشتقاق حي للأسعار (v17) مع حماية
 *    الحقول المكتوبة يدوياً، وحزم وزن جاهزة بلمسة (v9.1).
 *  • استلام البضاعة v16/v38: كراتين/أكياس بحساب حي (كمية + متوسط
 *    تكلفة مرجّح + اقتراح أسعار + صف وحدة الكرتونة/الكيس تلقائياً).
 *  • الحفظ: نفس رسائل التحقق العربية حرفياً + تحقق قارئ بعد كل
 *    الكتابات (v39) + «حفظ وإضافة آخر» (v39) + حذف/أرشفة/استرجاع
 *    (v23: منتج له سجل يُؤرشف لا يُحذف).
 *
 * البصمة البصرية والتقاط الصور (كاميرا الأندرويد) خارج نطاق سطح
 * المكتب — image_uri يُمرَّر كما هو فلا يفقد المنتج صورته أبداً.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {api, assetSrc} from '../lib/tauri';
import {ProductRepo, type ProductInput} from '../database/repositories/ProductRepo';
import {CategoryRepo} from '../database/repositories/CategoryRepo';
import {UnitRepo} from '../database/repositories/UnitRepo';
import {VariantRepo} from '../database/repositories/VariantRepo';
import {useCatalogStore, useToastStore} from '../state/appStores';
import {useSettingsStore, getPrinter} from '../stores/settingsStore';
import {storeModeConfig} from '../core/storeModes';
import {generateInternalEan13, isValidEan13} from '../services/BarcodeService';
import {buildLabelJob} from '../services/printer/label';
import {ThermalPrinterService} from '../services/printer/ThermalPrinterService';
import {notifyCatalogChanged} from '../services/online/OnlineStoreService';
import {BASE_UNIT_NAME, WEIGHT_UNIT_NAME} from '../core/config';
import {formatMoney, parseNumber} from '../core/format';
import {daysUntilExpiry, expiryStateOf} from '../core/types';
import type {Category, Product, ProductUnit, Unit} from '../core/types';
import {Icon} from '../components/Icon';
import {Select} from '../components/Select';
import {useEnterConfirm} from '../lib/useEnterConfirm';
import './inventoryv57.css';

/* ── أنواع المسودات ──────────────────────────────────────────── */

/** صف وحدة بيع في المحرّر — كل الأسعار نصوص (تقبل الأرقام العربية). */
interface UnitRowDraft {
  unit_id: number;
  conversion: string;
  retail: string;
  wholesale: string;
  barcode: string;
  /** v17: حقل كتبه التاجر بنفسه لا يُطغى بالاشتقاق التلقائي أبداً. */
  retailManual?: boolean;
  wholesaleManual?: boolean;
}

/** متغير ملابس (لون × مقاس) بمخزونه — محرّر التعديل. */
interface VariantDraft {
  color: string;
  size: string;
  stock: number;
}

/** حجم مطعم/كافيتريا بسعره وتكلفته الاختيارية. */
interface SizeDraft {
  size: string;
  price: string;
  cost: string;
}

/** v9.1: حزم الوزن الجاهزة — لمسة واحدة تنشئ الوحدة والصف المسعَّر. */
const WEIGHT_PACKAGE_PRESETS: {name: string; kg: number}[] = [
  {name: 'وقية', kg: 0.25},
  {name: 'نصف كغ', kg: 0.5},
  {name: 'كغ', kg: 1},
  {name: '٢ كغ', kg: 2},
  {name: '٥ كغ', kg: 5},
];

function unitRowToDraft(row: ProductUnit): UnitRowDraft {
  return {
    unit_id: row.unit_id,
    conversion: String(row.conversion),
    retail: row.retail_price != null ? String(row.retail_price) : '',
    wholesale: row.wholesale_price != null ? String(row.wholesale_price) : '',
    barcode: row.barcode ?? '',
    // الأسعار المحفوظة تبدأ «تلقائية» — تعديل السعر الأساسي يحدّثها.
    retailManual: false,
    wholesaleManual: false,
  };
}

/** v17: سعر الوحدة المشتق = الأساس × المعامل، مقرّباً لسعر رفّ سليم. */
function derivedUnitPrice(base: number, conversion: number): string {
  const value = Math.round(base * conversion * 100) / 100;
  return value > 0 ? String(value) : '';
}

/* ── عناصر واجهة صغيرة ───────────────────────────────────────── */

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="iv57-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="track" />
      {label != null && <span className="sw-label">{label}</span>}
    </label>
  );
}

function MiniStepper({
  value,
  onDecrement,
  onIncrement,
  min,
  max,
  suffix,
}: {
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <span className="stepper" style={{margin: 0}}>
      <button type="button" className="btn sm" onClick={onDecrement} disabled={value <= min}>
        −
      </button>
      <span className="qty" style={{fontSize: 13}}>
        {value}
        {suffix}
      </span>
      <button type="button" className="btn sm" onClick={onIncrement} disabled={value >= max}>
        +
      </button>
    </span>
  );
}

/* ── النافذة ─────────────────────────────────────────────────── */

export interface ProductFormModalProps {
  /** المنتج المراد تحريره (كائناً كاملاً — تمرره شاشة المخزون). */
  product?: Product | null;
  /** معرّف منتج للتحرير (بديل product — شاشة المنتجات الأونلاين). */
  productId?: number;
  /** باركود مبدئي لمنتج جديد (نقطة البيع — مسح سريع لبضاعة جديدة). */
  barcodeSeed?: string | null;
  /** تصنيف مبدئي لمنتج جديد (يُحفظ عبر «حفظ وإضافة آخر»). */
  categoryId?: number;
  /** تُستدعى بعد الحفظ الناجح (قبل onClose). */
  onSaved?: () => void;
  /** إغلاق النافذة — saved=true فقط بعد حفظ ناجح. */
  onClose: (saved?: boolean) => void;
}

export function ProductFormModal({
  product: productProp,
  productId,
  barcodeSeed,
  categoryId: presetCategoryId,
  onSaved,
  onClose,
}: ProductFormModalProps) {
  const toast = useToastStore(s => s.show);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const settings = useSettingsStore(s => s.settings);
  /** v33: تكوين نمط المتجر — يقود ظهور/إخفاء الأقسام والتسميات. */
  const modeConfig = storeModeConfig(settings.storeMode);
  const editingId = productProp?.id ?? productId ?? null;

  // ── الحالة العامة ────────────────────────────────────────────
  const [loading, setLoading] = useState(editingId != null);
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState(false);

  // ── البيانات المرجعية ────────────────────────────────────────
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [newCategory, setNewCategory] = useState('');

  // ── الأساسيات ────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState(barcodeSeed ?? '');
  const [costPrice, setCostPrice] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  /** v51: خصم المنتج 0–95. */
  const [discountPct, setDiscountPct] = useState('');
  /** v55: الإدراج في سيلا ماركت — المزامنة ترسل المدرج فقط. */
  const [onlineListed, setOnlineListed] = useState(false);
  const [categoryId, setCategoryId] = useState<number | 'none'>(
    presetCategoryId ?? 'none',
  );
  const [imageUri, setImageUri] = useState<string | null>(null);
  /** v8.3: قطعة أو وزن (أسعار ومخزون بالكيلو). */
  const [saleMode, setSaleMode] = useState<'piece' | 'weight'>(
    modeConfig.defaultSaleMode,
  );

  // ── المخزون ──────────────────────────────────────────────────
  const [stock, setStock] = useState('');
  const [threshold, setThreshold] = useState('');
  /** وحدة الإدخال التي يكتب بها التاجر الكمية (null = وحدة الأساس). */
  const [stockUnitId, setStockUnitId] = useState<number | null>(null);
  /** v35: وحدة الأساس بلغة المجال (شريط/علبة/حصة/صحن/كوب). */
  const [baseUnitName, setBaseUnitName] = useState<string | null>(null);
  /** v35: مخزون بلا تتبع (مطعم/كافيتريا افتراضياً). */
  const [untrackedStock, setUntrackedStock] = useState(
    modeConfig.productCopy.untrackedStockDefault === true,
  );

  // ── الصلاحية (v32) ───────────────────────────────────────────
  const [expiryMode, setExpiryMode] = useState<'none' | 'date' | 'duration'>(
    'none',
  );
  const [expiryDateText, setExpiryDateText] = useState('');
  const [durationValue, setDurationValue] = useState('');
  const [durationUnit, setDurationUnit] = useState<'days' | 'months'>('days');

  // ── صفوف وحدات البيع ─────────────────────────────────────────
  const [unitRows, setUnitRows] = useState<UnitRowDraft[]>([]);

  // ── الملصق (v9.1) ────────────────────────────────────────────
  const [labelCopies, setLabelCopies] = useState(1);
  const [labelBusy, setLabelBusy] = useState(false);

  // ── الربطة / المتغيرات (v35) ─────────────────────────────────
  const [lotSizes, setLotSizes] = useState<string[]>([]);
  const [lotColors, setLotColors] = useState<string[]>([]);
  const [lotBundles, setLotBundles] = useState('1');
  const [lotCustomColor, setLotCustomColor] = useState('');
  const [lotCustomSize, setLotCustomSize] = useState('');
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);

  // ── الأحجام (مطعم/كافيتريا — v35) ────────────────────────────
  const [sizesEnabled, setSizesEnabled] = useState(false);
  const [sizeDrafts, setSizeDrafts] = useState<SizeDraft[]>([]);
  const [customSizeName, setCustomSizeName] = useState('');

  // ── استلام البضاعة (v16/v38) ─────────────────────────────────
  /** v61 (الجولة 26 #4): منتج جديد بنمط استلام يفتح على وضع الاستلام
   *  المناسب للمجال (كرتونة/علبة — أو كيساً للفواكه) — القسم الأول
   *  جاهز للإدخال فور فتح النافذة. التعديل يظل «بلا استلام». */
  const defaultReceiveMode = useCallback((): 'none' | 'carton' | 'bag' => {
    if (!modeConfig.receiving) {
      return 'none';
    }
    return modeConfig.receivingByContainer ? 'carton' : 'bag';
  }, [modeConfig]);
  const [receiveMode, setReceiveMode] = useState<'none' | 'carton' | 'bag'>(
    productProp == null ? defaultReceiveMode() : 'none',
  );
  const [intakeAdd, setIntakeAdd] = useState(true);
  const [cartonsCount, setCartonsCount] = useState('');
  const [piecesPerCarton, setPiecesPerCarton] = useState('');
  const [cartonCost, setCartonCost] = useState('');
  const [bagsCount, setBagsCount] = useState('');
  const [kgPerBag, setKgPerBag] = useState('');
  const [bagCost, setBagCost] = useState('');

  // ── مراجع الحفظ الأمين (v37/v38) ─────────────────────────────
  /** المخزون المحمّل من القاعدة — يُحفظ كما هو لأي تعديل «بلا تتبع». */
  const loadedStockRef = useRef(0);
  /** التكلفة المحفوظة — أساس المتوسط المرجّح عند استلام فوق الموجود. */
  const loadedCostRef = useRef(0);
  /** v38: آخر معامل تحويل صالح لوحدة الإدخال — عمود إعادة التعبير. */
  const lastStockConvRef = useRef(1);

  /* ── تحميل المنتج للتعديل ───────────────────────────────────── */
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        // v34: نطاق النمط الحالي — تصنيفات ووحدات هذا المجال فقط.
        const [cats, unitList] = await Promise.all([
          CategoryRepo.list(settings.storeMode),
          UnitRepo.list(settings.storeMode),
        ]);
        if (!mounted) {
          return;
        }
        setCategories(cats);
        setUnits(unitList);
        if (editingId == null) {
          return;
        }
        const [loaded, productUnits, savedVariants] = await Promise.all([
          ProductRepo.getById(editingId),
          UnitRepo.listForProduct(editingId),
          VariantRepo.listByProduct(editingId),
        ]);
        if (!mounted || loaded == null) {
          return;
        }
        setName(loaded.name);
        setArchived(loaded.is_archived === 1);
        setBarcode(loaded.barcode ?? '');
        setCostPrice(String(loaded.cost_price));
        setRetailPrice(String(loaded.retail_price));
        setWholesalePrice(String(loaded.wholesale_price));
        setDiscountPct(
          (loaded.discount_pct ?? 0) > 0 ? String(loaded.discount_pct) : '',
        );
        setOnlineListed(loaded.online_listed === 1);
        setStock(String(loaded.stock_quantity));
        loadedStockRef.current = Number(loaded.stock_quantity ?? 0);
        loadedCostRef.current = Number(loaded.cost_price ?? 0);
        setThreshold(
          loaded.low_stock_threshold != null
            ? String(loaded.low_stock_threshold)
            : '',
        );
        setCategoryId(loaded.category_id ?? 'none');
        setImageUri(loaded.image_uri);
        setSaleMode(loaded.sold_by_weight === 1 ? 'weight' : 'piece');
        setUnitRows(productUnits.map(unitRowToDraft));
        setBaseUnitName(loaded.base_unit_name ?? null);
        setUntrackedStock(loaded.stock_untracked === 1);
        // v35: متغيرات الموديل — ملابس (لون × مقاس) وأحجام المطعم.
        if (savedVariants.length > 0) {
          const clothingVariants = savedVariants.filter(
            v => v.kind === 'variant',
          );
          const sizeVariants = savedVariants.filter(v => v.kind === 'size');
          if (clothingVariants.length > 0) {
            setVariantDrafts(
              clothingVariants.map(v => ({
                color: v.color,
                size: v.size,
                stock: Math.round(v.stock_quantity),
              })),
            );
          }
          if (sizeVariants.length > 0) {
            setSizesEnabled(true);
            setSizeDrafts(
              sizeVariants.map(v => ({
                size: v.size,
                price: v.retail_price != null ? String(v.retail_price) : '',
                cost: v.cost_price != null ? String(v.cost_price) : '',
              })),
            );
          }
        }
        // v32: صلاحية محفوظة → وضع «تاريخ محدد».
        if (loaded.expiry_date != null && loaded.expiry_date.length >= 10) {
          setExpiryMode('date');
          setExpiryDateText(loaded.expiry_date.slice(0, 10));
        }
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر تحميل المنتج',
          'error',
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      mounted = false;
    };
    // تُحمّل مرة عند فتح النافذة فقط (المعاملات ثابتة لكل فتح).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── الصلاحية: الحساب والحالة الحيّة (v32) ─────────────────── */
  const expiryDate = useMemo<string | null | undefined>(() => {
    if (expiryMode === 'none') {
      return null;
    }
    if (expiryMode === 'date') {
      const value = expiryDateText.trim();
      if (value === '') {
        return null;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
      }
      const [y, m, d] = value.split('-').map(Number);
      if (y < 2000 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) {
        return undefined;
      }
      return value;
    }
    const raw = durationValue.trim();
    if (raw === '') {
      return null;
    }
    const amount = parseNumber(raw);
    if (Number.isNaN(amount) || amount <= 0 || amount > 3650) {
      return undefined;
    }
    const now = new Date();
    const target =
      durationUnit === 'months'
        ? new Date(
            now.getFullYear(),
            now.getMonth() + Math.round(amount),
            now.getDate(),
          )
        : new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + Math.round(amount),
          );
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(
      target.getDate(),
    )}`;
  }, [expiryMode, expiryDateText, durationValue, durationUnit]);

  /** v32: تسمية الحالة الحيّة أسفل الحقول. */
  const expiryStatus = useMemo(() => {
    if (expiryDate == null) {
      return null;
    }
    const days = daysUntilExpiry(expiryDate);
    const state = expiryStateOf(expiryDate, settings.expiryAlertDays);
    const label =
      state === 'expired'
        ? days === 0
          ? 'ينتهي اليوم'
          : `منتهي منذ ${Math.abs(days)} يوم`
        : days === 0
        ? 'ينتهي اليوم'
        : state === 'expiring'
        ? `قرب الانتهاء — باقي ${days} يوم`
        : `صالح — باقي ${days} يوم`;
    return {state, label};
  }, [expiryDate, settings.expiryAlertDays]);

  /* ── الباركود: توليد داخلي + ملصق ──────────────────────────── */

  /** v9.1: توليد EAN-13 داخلي فريد (بادئة 20…) بعد فحص المنتجات
   *  ووحداتها — نمط Loyverse/Square للبضاعة بلا باركود مصنّع. */
  const generateBarcode = useCallback(async () => {
    try {
      setLabelBusy(true);
      const code = await generateInternalEan13(async candidate => {
        const productHit = await ProductRepo.findByBarcode(candidate);
        if (productHit != null) {
          return true;
        }
        const unitHit = await UnitRepo.findByBarcode(candidate);
        return unitHit != null;
      });
      setBarcode(code);
      toast(`تم توليد باركود داخلي: ${code}`, 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشل توليد الباركود',
        'error',
      );
    } finally {
      setLabelBusy(false);
    }
  }, [toast]);

  /** v9.1: طباعة ملصقات من النموذج نفسه — ما على الشاشة هو ما يُطبع. */
  const printLabel = useCallback(async () => {
    const trimmed = barcode.trim();
    if (trimmed.length === 0) {
      toast('لا يوجد باركود للطباعة', 'error');
      return;
    }
    if (getPrinter().channel === 'none') {
      toast('لا توجد طابعة مضبوطة — اضبط قناة الطابعة من الإعدادات', 'error');
      return;
    }
    const labelName = name.trim() || 'منتج';
    const retail = parseNumber(retailPrice);
    const price = Number.isNaN(retail) ? 0 : retail;
    setLabelBusy(true);
    try {
      const job = buildLabelJob(
        {
          productName: labelName,
          price,
          priceNote:
            saleMode === 'weight' ? `سعر الكيلو ${formatMoney(price)}` : null,
          barcode: trimmed,
          copies: labelCopies,
        },
        {paperWidth: settings.paperWidth, codepage: settings.codepage},
      );
      await ThermalPrinterService.printJob(job);
      toast(`تم إرسال ${labelCopies} ملصق للطابعة`, 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشل طباعة الملصق',
        'error',
      );
    } finally {
      setLabelBusy(false);
    }
  }, [
    barcode,
    name,
    retailPrice,
    saleMode,
    labelCopies,
    settings.paperWidth,
    settings.codepage,
    toast,
  ]);

  /* ── صفوف وحدات البيع ──────────────────────────────────────── */

  const unitNameById = useMemo(() => {
    const map = new Map<number, string>();
    units.forEach(unit => map.set(unit.id, unit.name));
    return map;
  }, [units]);

  /** v17/v38: إضافة صف — أول وحدة حرة من النوع الصحيح فقط. */
  const addUnitRow = useCallback(() => {
    const used = new Set(unitRows.map(row => row.unit_id));
    const kindMatch = (unit: Unit) =>
      saleMode === 'weight' ? unit.kind === 'weight' : unit.kind === 'piece';
    const free = units.find(unit => !used.has(unit.id) && kindMatch(unit));
    if (free == null) {
      toast(
        saleMode === 'weight'
          ? 'كل وحدات الوزن مستخدمة — أضف وحدات جديدة من الإعدادات'
          : 'كل وحدات القطع مستخدمة — أضف وحدات جديدة من الإعدادات',
        'info',
      );
      return;
    }
    setUnitRows(prev => [
      ...prev,
      {unit_id: free.id, conversion: '', retail: '', wholesale: '', barcode: ''},
    ]);
  }, [unitRows, units, toast, saleMode]);

  const updateUnitRow = useCallback(
    (index: number, patch: Partial<UnitRowDraft>) => {
      setUnitRows(prev =>
        prev.map((row, i) => (i === index ? {...row, ...patch} : row)),
      );
    },
    [],
  );

  const removeUnitRow = useCallback((index: number) => {
    setUnitRows(prev => prev.filter((_, i) => i !== index));
  }, []);

  /** v17: اشتقاق حي — تغيّر الأسعار الأساسية أو المعامل يحدّث كل
   *  حقل لم يكتبه التاجر بنفسه (سعر الوحدة = الأساس × المعامل). */
  useEffect(() => {
    const baseRetail = parseNumber(retailPrice);
    const baseWholesale = wholesalePrice.trim()
      ? parseNumber(wholesalePrice)
      : baseRetail;
    const retailOk = !Number.isNaN(baseRetail) && baseRetail > 0;
    const wholesaleOk = !Number.isNaN(baseWholesale) && baseWholesale > 0;
    if (!retailOk && !wholesaleOk) {
      return;
    }
    setUnitRows(prev => {
      let changed = false;
      const next = prev.map(row => {
        const conv = parseNumber(row.conversion);
        const convOk = !Number.isNaN(conv) && conv > 0;
        const patch: UnitRowDraft = {...row};
        if (convOk && retailOk && !row.retailManual) {
          const derived = derivedUnitPrice(baseRetail, conv);
          if (derived !== row.retail) {
            patch.retail = derived;
            changed = true;
          }
        }
        if (convOk && wholesaleOk && !row.wholesaleManual) {
          const derived = derivedUnitPrice(baseWholesale, conv);
          if (derived !== row.wholesale) {
            patch.wholesale = derived;
            changed = true;
          }
        }
        return patch;
      });
      return changed ? next : prev;
    });
    // مفتاح تبعية مستقر: المعاملات + أعلام اليدوية (لا الأسعار
    // نفسها — وإلا حلّقنا).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    retailPrice,
    wholesalePrice,
    unitRows.map(r => `${r.unit_id}:${r.conversion}`).join('|'),
  ]);

  const unitRowsById = useMemo(
    () => new Map(unitRows.map(row => [row.unit_id, row])),
    [unitRows],
  );

  /** معامل تحويل صالح (> 0) لصف وحدة — أو null عند عدم صلاحيته. */
  const validConversion = useCallback(
    (unitId: number | null): number | null => {
      if (unitId == null) {
        return 1;
      }
      const row = unitRowsById.get(unitId);
      if (row == null) {
        return null;
      }
      const value = parseNumber(row.conversion);
      return Number.isNaN(value) || value <= 0 ? null : value;
    },
    [unitRowsById],
  );

  /** الصفوف القابلة للاستعمال كوحدة إدخال للكمية. */
  const stockUnitChoices = useMemo(
    () => unitRows.filter(row => validConversion(row.unit_id) != null),
    [unitRows, validConversion],
  );

  /** v38: إعادة التعبير الموحّدة — الكمية بمعناها الأساس محفوظة
   *  دائماً؛ تغيير الوحدة أو معاملها يعيد التعبير فوراً بلا فقدان
   *  (جذر «المخزون الوهمي» عند حواف التقريب). */
  useEffect(() => {
    const conv = stockUnitId != null ? validConversion(stockUnitId) : null;
    const effective = stockUnitId == null ? 1 : conv;
    if (effective == null) {
      // الوحدة المختارة فقدت معاملها — عودة لوحدة الأساس ثم تصفير.
      const previous = lastStockConvRef.current;
      if (previous > 0 && stock.trim()) {
        const current = parseNumber(stock);
        if (!Number.isNaN(current)) {
          setStock(String(Math.round(current * previous * 1000) / 1000));
        }
      }
      lastStockConvRef.current = 1;
      setStockUnitId(null);
      return;
    }
    if (effective !== lastStockConvRef.current) {
      const previous = lastStockConvRef.current;
      if (stock.trim()) {
        const current = parseNumber(stock);
        if (!Number.isNaN(current)) {
          const basePieces = current * previous;
          setStock(
            String(Math.round((basePieces / effective) * 1000) / 1000),
          );
        }
      }
      lastStockConvRef.current = effective;
    }
  }, [stockUnitId, validConversion, stock]);

  /** تلميح حي تحت حقل الكمية: «5 كرتونة = 120 قطعة محفوظة». */
  const stockHint = useMemo(() => {
    const conv = validConversion(stockUnitId);
    if (stockUnitId == null || conv == null || !stock.trim()) {
      return null;
    }
    const value = parseNumber(stock);
    if (Number.isNaN(value)) {
      return null;
    }
    const basePieces = Math.round(value * conv * 1000) / 1000;
    return `${value} ${unitNameById.get(stockUnitId) ?? ''} = ${basePieces} ${
      saleMode === 'weight' ? WEIGHT_UNIT_NAME : baseUnitName ?? BASE_UNIT_NAME
    } محفوظة في المخزون`;
  }, [stock, stockUnitId, unitNameById, validConversion, saleMode, baseUnitName]);

  /* ── حزم الوزن الجاهزة (v9.1) ───────────────────────────────── */
  const presetBusyRef = useRef(false);
  const addWeightPackage = useCallback(
    async (preset: {name: string; kg: number}) => {
      if (presetBusyRef.current) {
        return;
      }
      presetBusyRef.current = true;
      try {
        let presetUnitId = -1;
        const duplicateOf = (rows: UnitRowDraft[]) =>
          rows.find(
            row =>
              row.unit_id === presetUnitId ||
              unitNameById.get(row.unit_id) === preset.name,
          );
        if (duplicateOf(unitRows) != null) {
          toast(`وحدة ${preset.name} مضافة بالفعل`, 'info');
          return;
        }
        // v9.2/v34: وحدة وزن داخل نطاق النمط الحالي.
        const unitId = await UnitRepo.getOrCreate(
          preset.name,
          preset.name,
          'weight',
          settings.storeMode,
        );
        presetUnitId = unitId;
        const unitList = await UnitRepo.list(settings.storeMode);
        setUnits(unitList);
        setUnitRows(prev => {
          if (duplicateOf(prev) != null) {
            toast(`وحدة ${preset.name} مضافة بالفعل`, 'info');
            return prev;
          }
          const baseRetail = parseNumber(retailPrice);
          const baseWholesale = wholesalePrice.trim()
            ? parseNumber(wholesalePrice)
            : baseRetail;
          const retail =
            !Number.isNaN(baseRetail) && baseRetail > 0
              ? derivedUnitPrice(baseRetail, preset.kg)
              : '';
          const wholesale =
            !Number.isNaN(baseWholesale) && baseWholesale > 0
              ? derivedUnitPrice(baseWholesale, preset.kg)
              : '';
          return [
            ...prev,
            {
              unit_id: unitId,
              conversion: String(preset.kg),
              retail,
              wholesale,
              barcode: '',
            },
          ];
        });
        toast(
          `أُضيفت وحدة ${preset.name} = ${preset.kg} ${WEIGHT_UNIT_NAME}${
            retailPrice.trim().length > 0
              ? ' — والأسعار من سعر الكيلو تلقائياً'
              : ''
          }`,
          'success',
        );
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشل إضافة الوحدة',
          'error',
        );
      } finally {
        presetBusyRef.current = false;
      }
    },
    [unitRows, unitNameById, toast, retailPrice, wholesalePrice, settings.storeMode],
  );

  /* ── استلام البضاعة (v16/v38) ───────────────────────────────── */

  /** تقريب لأعلى لخطوة سعر لطيفة (0.25 مفرق / 0.1 جملة). */
  const suggestPrice = useCallback(
    (cost: number, margin: number, step: number): number =>
      Math.max(step, Math.ceil((cost * (1 + margin)) / step) * step),
    [],
  );

  const cartonMath = useMemo(() => {
    const n = parseNumber(cartonsCount);
    const p = parseNumber(piecesPerCarton);
    const cost = parseNumber(cartonCost);
    if (
      receiveMode !== 'carton' ||
      Number.isNaN(n) ||
      n <= 0 ||
      Number.isNaN(p) ||
      p <= 0
    ) {
      return null;
    }
    const totalPieces = Math.round(n * p);
    const perPiece = Number.isNaN(cost) || cost <= 0 ? null : cost / p;
    return {
      totalPieces,
      perPiece,
      retail: perPiece != null ? suggestPrice(perPiece, 0.25, 0.25) : null,
      wholesale: perPiece != null ? suggestPrice(perPiece, 0.12, 0.1) : null,
    };
  }, [receiveMode, cartonsCount, piecesPerCarton, cartonCost, suggestPrice]);

  const bagMath = useMemo(() => {
    const n = parseNumber(bagsCount);
    const k = parseNumber(kgPerBag);
    const cost = parseNumber(bagCost);
    if (
      receiveMode !== 'bag' ||
      Number.isNaN(n) ||
      n <= 0 ||
      Number.isNaN(k) ||
      k <= 0
    ) {
      return null;
    }
    const totalKg = Math.round(n * k * 1000) / 1000;
    const perKg = Number.isNaN(cost) || cost <= 0 ? null : cost / k;
    return {
      totalKg,
      perKg,
      retail: perKg != null ? suggestPrice(perKg, 0.25, 0.25) : null,
      wholesale: perKg != null ? suggestPrice(perKg, 0.12, 0.1) : null,
    };
  }, [receiveMode, bagsCount, kgPerBag, bagCost, suggestPrice]);

  /** v16: تعبئة حية للكمية والتكلفة — المتوسط المرجّح مع الموجود
   *  عند وضع «إضافة» (v38: لا استبدال صامت للمخزون القائم). */
  useEffect(() => {
    if (cartonMath != null) {
      const base = editingId != null && intakeAdd ? loadedStockRef.current : 0;
      setStock(String(base + cartonMath.totalPieces));
      if (cartonMath.perPiece != null) {
        const oldQty = base;
        const oldCost =
          editingId != null && intakeAdd ? loadedCostRef.current : 0;
        const blended =
          oldQty + cartonMath.totalPieces > 0
            ? (oldCost * oldQty +
                (cartonMath.perPiece ?? 0) * cartonMath.totalPieces) /
              (oldQty + cartonMath.totalPieces)
            : cartonMath.perPiece ?? 0;
        setCostPrice(String(Math.round(blended * 1000) / 1000));
      }
    }
  }, [cartonMath, intakeAdd, editingId]);

  useEffect(() => {
    if (bagMath != null) {
      const base = editingId != null && intakeAdd ? loadedStockRef.current : 0;
      setStock(String(Math.round((base + bagMath.totalKg) * 1000) / 1000));
      if (bagMath.perKg != null) {
        const oldQty = base;
        const oldCost =
          editingId != null && intakeAdd ? loadedCostRef.current : 0;
        const blended =
          oldQty + bagMath.totalKg > 0
            ? (oldCost * oldQty + (bagMath.perKg ?? 0) * bagMath.totalKg) /
              (oldQty + bagMath.totalKg)
            : bagMath.perKg ?? 0;
        setCostPrice(String(Math.round(blended * 1000) / 1000));
      }
    }
  }, [bagMath, intakeAdd, editingId]);

  /** v16: تبديل نمط الاستلام يبدّل طريقة البيع ويصفّر مدخلات الآخر. */
  const switchReceiveMode = useCallback((mode: 'none' | 'carton' | 'bag') => {
    setReceiveMode(mode);
    if (mode === 'carton') {
      setSaleMode('piece');
      setStockUnitId(null);
      setBagsCount('');
      setKgPerBag('');
      setBagCost('');
    } else if (mode === 'bag') {
      setSaleMode('weight');
      setStockUnitId(null);
      setCartonsCount('');
      setPiecesPerCarton('');
      setCartonCost('');
    }
  }, []);

  /** v16: ضمان صف وحدة العبوة (كرتونة/علبة/كيس) بمعاملها — ينشئ
   *  الوحدة نفسها إن لم توجد (داخل نطاق النمط الحالي). */
  const ensureReceivingUnit = useCallback(
    async (kind: 'carton' | 'bag') => {
      try {
        const name =
          kind === 'carton'
            ? modeConfig.receivingLabels?.container ?? 'كرتونة'
            : 'كيس';
        const unitKind = kind === 'carton' ? 'piece' : 'weight';
        const conversion =
          kind === 'carton'
            ? parseNumber(piecesPerCarton)
            : parseNumber(kgPerBag);
        if (Number.isNaN(conversion) || conversion <= 0) {
          return;
        }
        const existing = unitRows.find(
          row => unitNameById.get(row.unit_id) === name,
        );
        if (existing != null) {
          setUnitRows(prev =>
            prev.map(row =>
              unitNameById.get(row.unit_id) === name
                ? {...row, conversion: String(conversion)}
                : row,
            ),
          );
          return;
        }
        const unitId = await UnitRepo.getOrCreate(
          name,
          name,
          unitKind,
          settings.storeMode,
        );
        const unitList = await UnitRepo.list(settings.storeMode);
        setUnits(unitList);
        setUnitRows(prev => [
          ...prev,
          {
            unit_id: unitId,
            conversion: String(conversion),
            retail: '',
            wholesale: '',
            barcode: '',
          },
        ]);
      } catch {
        // صف الوحدة ترفيهي — لا يعطّل الاستلام أبداً.
      }
    },
    [
      unitRows,
      unitNameById,
      piecesPerCarton,
      kgPerBag,
      modeConfig.receivingLabels,
      settings.storeMode,
    ],
  );

  /** v16: عند اكتمال الحساب يُنشأ/يُحدَّث صف العبوة مرة لكل معامل. */
  const ensuredConversionRef = useRef('');
  useEffect(() => {
    if (receiveMode === 'carton' && cartonMath != null) {
      const key = `carton:${piecesPerCarton}`;
      if (ensuredConversionRef.current !== key) {
        ensuredConversionRef.current = key;
        void ensureReceivingUnit('carton');
      }
    } else if (receiveMode === 'bag' && bagMath != null) {
      const key = `bag:${kgPerBag}`;
      if (ensuredConversionRef.current !== key) {
        ensuredConversionRef.current = key;
        void ensureReceivingUnit('bag');
      }
    }
  }, [receiveMode, cartonMath, bagMath, piecesPerCarton, kgPerBag, ensureReceivingUnit]);

  /** v16: اعتماد الأسعار المقترحة — الأساس + صف العبوة معاً. */
  const applyReceivingPrices = useCallback(
    (retail: number | null, wholesale: number | null) => {
      if (retail != null) {
        setRetailPrice(String(Math.round(retail * 100) / 100));
      }
      if (wholesale != null) {
        setWholesalePrice(String(Math.round(wholesale * 100) / 100));
      }
      const kind = receiveMode === 'bag' ? 'bag' : 'carton';
      const name =
        kind === 'carton'
          ? modeConfig.receivingLabels?.container ?? 'كرتونة'
          : 'كيس';
      const conversion =
        kind === 'carton'
          ? parseNumber(piecesPerCarton)
          : parseNumber(kgPerBag);
      if (
        !Number.isNaN(conversion) &&
        conversion > 0 &&
        retail != null &&
        wholesale != null
      ) {
        setUnitRows(prev =>
          prev.map(row =>
            unitNameById.get(row.unit_id) === name
              ? {
                  ...row,
                  conversion: String(conversion),
                  retail: String(Math.round(retail * conversion * 100) / 100),
                  wholesale: String(
                    Math.round(wholesale * conversion * 100) / 100,
                  ),
                }
              : row,
          ),
        );
      }
    },
    [receiveMode, unitNameById, piecesPerCarton, kgPerBag, modeConfig.receivingLabels],
  );

  /* ── التصنيفات: إضافة سريعة من داخل النافذة ────────────────── */
  const addCategoryInline = useCallback(async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) {
      return;
    }
    try {
      const id = await CategoryRepo.create(trimmed, settings.storeMode);
      const list = await CategoryRepo.list(settings.storeMode);
      setCategories(list);
      setCategoryId(id);
      setNewCategory('');
      toast(`أُضيف تصنيف «${trimmed}»`, 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر إضافة التصنيف',
        'error',
      );
    }
  }, [newCategory, settings.storeMode, toast]);

  /* ── صورة المنتج (v59 — جولة المستخدم #5) ──────────────────── */
  const [imageBusy, setImageBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  /** حوار أصلي → ضغط 512px → حفظ في بيانات التطبيق → image_uri. */
  const pickImage = useCallback(async () => {
    if (imageBusy) {
      return;
    }
    setImageBusy(true);
    try {
      const path = await api.pickProductImage();
      if (path != null) {
        setImageUri(path);
        toast('حُفظت صورة المنتج — ستظهر في شاشة البيع', 'success');
      }
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر اختيار الصورة',
        'error',
      );
    } finally {
      setImageBusy(false);
    }
  }, [imageBusy, toast]);

  /* ── الربطة (ملابس جديدة — v35) ────────────────────────────── */
  const toggleLotSize = (size: string) =>
    setLotSizes(prev =>
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size],
    );
  const toggleLotColor = (color: string) =>
    setLotColors(prev =>
      prev.includes(color) ? prev.filter(c => c !== color) : [...prev, color],
    );
  const addLotCustomSize = () => {
    const custom = lotCustomSize.trim();
    if (custom.length > 0 && !lotSizes.includes(custom)) {
      setLotSizes(prev => [...prev, custom]);
    }
    setLotCustomSize('');
  };
  const addLotCustomColor = () => {
    const custom = lotCustomColor.trim();
    if (custom.length > 0 && !lotColors.includes(custom)) {
      setLotColors(prev => [...prev, custom]);
    }
    setLotCustomColor('');
  };
  const bundlesCount = Math.max(1, Math.round(parseNumber(lotBundles) || 1));

  /* ── محرّر المتغيرات (تعديل موديل — v35) ───────────────────── */
  const setVariantStock = (color: string, size: string, value: number) =>
    setVariantDrafts(prev =>
      prev.map(v =>
        v.color === color && v.size === size
          ? {...v, stock: Math.min(99999, Math.max(0, value))}
          : v,
      ),
    );
  const removeVariant = (color: string, size: string) =>
    setVariantDrafts(prev =>
      prev.filter(v => !(v.color === color && v.size === size)),
    );
  const addVariantRow = (color: string, size: string) => {
    const c = color.trim();
    const s = size.trim();
    if (!c || !s) {
      toast('أدخل اللون والمقاس للصف الجديد', 'error');
      return;
    }
    if (variantDrafts.some(v => v.color === c && v.size === s)) {
      toast('هذا المتغير (اللون × المقاس) موجود بالفعل', 'info');
      return;
    }
    setVariantDrafts(prev => [...prev, {color: c, size: s, stock: 0}]);
  };
  /** «إضافة ربطة» — كل مقاسات لونٍ += عدد الربط دفعة واحدة. */
  const addBundleToColor = (color: string) =>
    setVariantDrafts(prev =>
      prev.map(v => (v.color === color ? {...v, stock: v.stock + bundlesCount} : v)),
    );

  const variantColors = useMemo(
    () => [...new Set(variantDrafts.map(v => v.color))],
    [variantDrafts],
  );
  const variantTotals = useMemo(
    () => ({
      pieces: variantDrafts.reduce((sum, v) => sum + Math.max(0, v.stock), 0),
      colors: variantColors.length,
      sizes: new Set(variantDrafts.map(v => v.size)).size,
    }),
    [variantDrafts, variantColors],
  );

  /* ── الأحجام (مطعم/كافيتريا — v35) ─────────────────────────── */
  const toggleSizeDraft = (seed: string) =>
    setSizeDrafts(prev =>
      prev.some(d => d.size === seed)
        ? prev.filter(d => d.size !== seed)
        : [...prev, {size: seed, price: '', cost: ''}],
    );
  const addCustomSizeDraft = () => {
    const custom = customSizeName.trim();
    if (custom.length > 0 && !sizeDrafts.some(d => d.size === custom)) {
      setSizeDrafts(prev => [...prev, {size: custom, price: '', cost: ''}]);
    }
    setCustomSizeName('');
  };

  /* ── معاينة الخصم (v51) ────────────────────────────────────── */
  const discountPreview = useMemo(() => {
    const pct = Math.max(0, Math.min(95, parseNumber(discountPct) || 0));
    const base = parseNumber(retailPrice);
    if (!(pct > 0) || Number.isNaN(base) || base <= 0) {
      return null;
    }
    const final = Math.round(base * (1 - pct / 100) * 100) / 100;
    return {
      pct: Math.round(pct),
      base,
      final,
      saved: Math.round((base - final) * 100) / 100,
    };
  }, [discountPct, retailPrice]);

  /* ── الحفظ ─────────────────────────────────────────────────── */

  /** v35: حفظ موديل الملابس الجديد — الربطة تصنع متغيراً لكل
   *  (لون × مقاس) مخزونه = عدد الربط، والموديل منتج واحد. */
  const saveLot = useCallback(async () => {
    const modelName = name.trim();
    const colors = [...lotColors];
    const customColor = lotCustomColor.trim();
    if (customColor.length > 0 && !colors.includes(customColor)) {
      colors.push(customColor);
    }
    const cost = parseNumber(costPrice);
    const retail = parseNumber(retailPrice);
    const wholesale = wholesalePrice.trim()
      ? parseNumber(wholesalePrice)
      : retail;
    const thresholdValue = threshold.trim() ? parseNumber(threshold) : null;

    if (!modelName) {
      toast('اسم الموديل مطلوب (مثال: تيشيرت قطن)', 'error');
      return;
    }
    if (colors.length === 0) {
      toast('اختر لوناً واحداً على الأقل للربطة', 'error');
      return;
    }
    if (lotSizes.length === 0) {
      toast('اختر مقاساً واحداً على الأقل داخل الربطة', 'error');
      return;
    }
    if (bundlesCount < 1 || bundlesCount > 999) {
      toast('عدد الربط يجب أن يكون بين 1 و 999', 'error');
      return;
    }
    if (Number.isNaN(cost) || cost < 0) {
      toast('أدخل تكلفة القطعة', 'error');
      return;
    }
    if (Number.isNaN(retail) || retail <= 0) {
      toast('أدخل سعر القطعة (مفرق)', 'error');
      return;
    }
    if (Number.isNaN(wholesale) || wholesale < 0) {
      toast('سعر القطعة بالجملة غير صالح', 'error');
      return;
    }
    const discountValue = (() => {
      const parsed = parseNumber(discountPct);
      if (Number.isNaN(parsed) || parsed <= 0) {
        return 0;
      }
      return Math.round(Math.min(95, parsed) * 10) / 10;
    })();

    setBusy(true);
    try {
      const totalPieces = colors.length * lotSizes.length * bundlesCount;
      const newId = await ProductRepo.create({
        name: modelName,
        cost_price: cost,
        retail_price: retail,
        wholesale_price: wholesale,
        discount_pct: discountValue,
        online_listed: onlineListed ? 1 : 0,
        stock_quantity: totalPieces,
        category_id: categoryId === 'none' ? null : categoryId,
        image_uri: imageUri,
        low_stock_threshold:
          thresholdValue != null && !Number.isNaN(thresholdValue)
            ? Math.trunc(thresholdValue)
            : null,
        barcode: barcode.trim() || null,
        sold_by_weight: 0,
        expiry_date: null,
        has_variants: 1,
        base_unit_name: 'قطعة',
        stock_untracked: 0,
        sizes_count: lotSizes.length,
      });
      if (newId < 0) {
        throw new Error('فشل حفظ الموديل');
      }
      await VariantRepo.replaceForProduct(
        newId,
        colors.flatMap(color =>
          lotSizes.map(size => ({
            kind: 'variant' as const,
            color,
            size,
            stock_quantity: bundlesCount,
          })),
        ),
      );
      await refreshCatalog();
      toast(
        `تمت إضافة موديل ${modelName}: ${colors.length} لون × ` +
          `${lotSizes.length} مقاس × ${bundlesCount} ربط = ${totalPieces} قطعة` +
          ' — ربطة الجملة تُباع من نافذة الموديل',
        'success',
        6000,
      );
      if (onlineListed) {
        try {
          notifyCatalogChanged();
        } catch {
          // أفضل جهد — دورة الـ ١٥ دقيقة شبكة الأمان.
        }
      }
      onSaved?.();
      onClose(true);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشل حفظ الموديل',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }, [
    name,
    lotColors,
    lotCustomColor,
    lotSizes,
    bundlesCount,
    costPrice,
    retailPrice,
    wholesalePrice,
    discountPct,
    onlineListed,
    threshold,
    categoryId,
    imageUri,
    barcode,
    refreshCatalog,
    toast,
    onSaved,
    onClose,
  ]);

  /** الحفظ الرئيسي — نفس حراس ورسائل الأندرويد v57 حرفياً. */
  const save = useCallback(
    async (next: boolean = false) => {
      if (busy) {
        return;
      }
      // v35: الملابس عند الإنشاء = مسار الربطة الخاص.
      if (modeConfig.lotEntry === true && editingId == null) {
        await saveLot();
        return;
      }
      const trimmedName = name.trim();
      const cost = parseNumber(costPrice);
      const retail = parseNumber(retailPrice);
      // v35: مجالات بلا جملة (فواكه/مطعم/كافيتريا) — سعر واحد.
      const noWholesale = modeConfig.productCopy.wholesaleLabel == null;
      const wholesale = noWholesale
        ? retail
        : wholesalePrice.trim()
        ? parseNumber(wholesalePrice)
        : retail;
      const weighted = saleMode === 'weight';
      const stockConversion = weighted ? 1 : validConversion(stockUnitId) ?? 1;
      // v37: قراءة الكمية عبر parseNumber المطوّر (أرقام عربية ٠٥
      // وفواصلها ٫) + حارس صريح يمنع أي NaN يتحول صفراً بصمت.
      const stockTyped = stock.trim().length > 0;
      const stockParsed = stockTyped ? parseNumber(stock) : 0;
      if (stockTyped && Number.isNaN(stockParsed)) {
        toast(
          'قيمة الكمية غير مقروءة — اكتبها بأرقام (0-9 أو ٠-٩) مع فاصل عشري، ثم أعد الحفظ',
          'error',
          6000,
        );
        return;
      }
      const stockRaw = stockTyped ? stockParsed * stockConversion : 0;
      // v35: موديل ملابس — الكمية من المتغيرات لا من حقل يدوي.
      const isClothingModel =
        modeConfig.lotEntry === true && variantDrafts.length > 0;
      // v37: «بلا تتبع» عند التعديل يحفظ المخزون القائم كما هو.
      const stockValue = untrackedStock
        ? editingId != null
          ? loadedStockRef.current
          : 0
        : isClothingModel
        ? variantDrafts.reduce((sum, v) => sum + Math.max(0, Math.round(v.stock)), 0)
        : weighted
        ? Math.round(stockRaw * 1000) / 1000
        : Math.round(stockRaw);
      // v38: حارس الانهيار إلى الصفر — كمية موجودة لا تُحفظ صفراً.
      if (
        !untrackedStock &&
        !isClothingModel &&
        stockTyped &&
        stockParsed > 0 &&
        (!Number.isFinite(stockValue) || stockValue <= 0)
      ) {
        toast(
          'الكمية المدخلة أصغر من وحدة الأساس فتُقرب إلى صفر — اكتب كمية أكبر أو أعد وحدة الإدخال إلى وحدة الأساس، ثم أعد الحفظ',
          'error',
          6000,
        );
        return;
      }
      const thresholdValue = threshold.trim() ? parseNumber(threshold) : null;

      if (!trimmedName) {
        toast(`${modeConfig.productCopy.nameLabel} مطلوب`, 'error');
        return;
      }
      if (Number.isNaN(cost) || cost < 0) {
        toast(
          weighted ? 'أدخل سعر تكلفة صالحاً للكيلو' : 'أدخل سعر تكلفة صالحاً',
          'error',
        );
        return;
      }
      if (Number.isNaN(retail) || retail <= 0) {
        toast(
          weighted ? 'أدخل سعر مبيع صالحاً للكيلو' : 'أدخل سعر مبيع صالحاً',
          'error',
        );
        return;
      }
      if (Number.isNaN(wholesale) || wholesale < 0) {
        toast('سعر الجملة غير صالح', 'error');
        return;
      }
      // v35: أحجام مفعّلة — سعر كل حجم مطلوب وصالح.
      if (sizesEnabled) {
        if (sizeDrafts.length === 0) {
          toast('أضف حجماً واحداً على الأقل أو أطفئ الأحجام', 'error');
          return;
        }
        for (const draft of sizeDrafts) {
          const price = parseNumber(draft.price);
          if (draft.price.trim() === '' || Number.isNaN(price) || price <= 0) {
            toast(`أدخل سعراً صالحاً للحجم ${draft.size}`, 'error');
            return;
          }
          const draftCost = parseNumber(draft.cost);
          if (
            draft.cost.trim() !== '' &&
            (Number.isNaN(draftCost) || draftCost < 0)
          ) {
            toast(`تكلفة الحجم ${draft.size} غير صالحة`, 'error');
            return;
          }
        }
      }
      // v32: صلاحية ناقصة/فاسدة تمنع الحفظ برسالة واضحة.
      if (expiryDate === undefined) {
        toast(
          expiryMode === 'date'
            ? 'أكمل تاريخ الانتهاء (تاريخ صحيح) أو اختر «بلا صلاحية»'
            : 'أدخل مدة صالحة (أيام أو أشهر، حتى 10 سنوات) أو اختر «بلا صلاحية»',
          'error',
        );
        return;
      }
      // صفوف الوحدات — معامل صالح وأسعار غير سالبة.
      const cleanedUnits: {
        unit_id: number;
        conversion: number;
        barcode?: string | null;
        retail_price?: number | null;
        wholesale_price?: number | null;
      }[] = [];
      for (const [index, row] of unitRows.entries()) {
        const conversion = parseNumber(row.conversion);
        if (Number.isNaN(conversion) || conversion <= 0) {
          toast(
            `معامل تحويل الوحدة ${index + 1} يجب أن يكون رقماً أكبر من صفر`,
            'error',
          );
          return;
        }
        const unitRetail = row.retail.trim() ? parseNumber(row.retail) : null;
        const unitWholesale = row.wholesale.trim()
          ? parseNumber(row.wholesale)
          : null;
        if (
          (unitRetail != null &&
            (Number.isNaN(unitRetail) || unitRetail < 0)) ||
          (unitWholesale != null &&
            (Number.isNaN(unitWholesale) || unitWholesale < 0))
        ) {
          toast(`أسعار الوحدة ${index + 1} غير صالحة`, 'error');
          return;
        }
        cleanedUnits.push({
          unit_id: row.unit_id,
          conversion,
          barcode: row.barcode.trim() || null,
          retail_price: unitRetail,
          wholesale_price: unitWholesale,
        });
      }
      // v51: خصم المنتج 0–95 (فارغ/غير صالح = بلا خصم).
      const discountValue = (() => {
        const parsed = parseNumber(discountPct);
        if (Number.isNaN(parsed) || parsed <= 0) {
          return 0;
        }
        return Math.round(Math.min(95, parsed) * 10) / 10;
      })();

      setBusy(true);
      try {
        const input: ProductInput = {
          name: trimmedName,
          cost_price: cost,
          retail_price: retail,
          wholesale_price: wholesale,
          discount_pct: discountValue,
          online_listed: onlineListed ? 1 : 0,
          stock_quantity: stockValue,
          category_id: categoryId === 'none' ? null : categoryId,
          image_uri: imageUri,
          low_stock_threshold:
            thresholdValue != null && !Number.isNaN(thresholdValue)
              ? weighted
                ? Math.round(thresholdValue * 1000) / 1000
                : Math.trunc(thresholdValue)
              : null,
          barcode: barcode.trim() || null,
          sold_by_weight: weighted ? 1 : 0,
          expiry_date: expiryDate ?? null,
          base_unit_name: baseUnitName,
          stock_untracked: untrackedStock ? 1 : 0,
          has_variants:
            isClothingModel || (sizesEnabled && sizeDrafts.length > 0) ? 1 : 0,
          sizes_count: isClothingModel
            ? new Set(variantDrafts.map(v => v.size)).size
            : null,
        };

        let targetId = editingId;
        if (editingId != null) {
          await ProductRepo.update(editingId, input);
        } else {
          targetId = await ProductRepo.create(input);
        }
        if (targetId == null || targetId < 0) {
          throw new Error('فشل حفظ المنتج');
        }

        await UnitRepo.replaceForProduct(targetId, cleanedUnits);

        // v39: قواعد مزامنة المتغيرات — الملابس فقط تزامن مخزون
        // الموديل مع مجموع متغيراته؛ الأحجام أسعار فقط؛ التنظيف
        // الفارغ يحذف الصفوف ولا يلمس المخزون (جذر تصفير v39).
        if (isClothingModel) {
          await VariantRepo.replaceForProduct(
            targetId,
            variantDrafts.map(v => ({
              kind: 'variant' as const,
              color: v.color,
              size: v.size,
              stock_quantity: Math.max(0, Math.round(v.stock)),
            })),
            true,
          );
        } else if (sizesEnabled && sizeDrafts.length > 0) {
          await VariantRepo.replaceForProduct(
            targetId,
            sizeDrafts.map(d => ({
              kind: 'size' as const,
              color: '',
              size: d.size,
              stock_quantity: 0,
              retail_price: parseNumber(d.price),
              cost_price: d.cost.trim() !== '' ? parseNumber(d.cost) : null,
            })),
          );
        } else if (editingId != null) {
          await VariantRepo.replaceForProduct(targetId, []);
        }

        // v39: التحقق القارئ بعد كل الكتابات — لا نجاح فوق قاعدة
        // لم تستلم قيمتها فعلاً.
        const verify = await ProductRepo.getById(targetId);
        if (verify == null) {
          throw new Error('فشل التحقق: المنتج غير موجود بعد الحفظ');
        }
        if (Math.abs((verify.stock_quantity ?? 0) - stockValue) > 0.0001) {
          throw new Error(
            `تعذر تحديث المخزون بدقة — القصد ${stockValue} والمحفوظ فعلاً ${
              verify.stock_quantity ?? 0
            }. أعد المحاولة`,
          );
        }
        if ((verify.stock_untracked ?? 0) !== (untrackedStock ? 1 : 0)) {
          throw new Error('تعذر تحديث حالة تتبع المخزون — أعد المحاولة');
        }

        await refreshCatalog();
        // v55: منتج مدرج حُفظ/عُدّل — مزامنة فورية للمتجر.
        if (onlineListed) {
          try {
            notifyCatalogChanged();
          } catch {
            // أفضل جهد — دورة الـ ١٥ دقيقة شبكة الأمان.
          }
        }
        // v39: «حفظ وإضافة آخر» — نسخة فارغة جديدة بنفس التصنيف.
        if (next && editingId == null) {
          toast('تمت الإضافة — أدخل المنتج التالي', 'success');
          resetForNext();
          return;
        }
        toast(
          editingId != null ? 'تم تحديث المنتج' : 'تمت إضافة المنتج',
          'success',
        );
        onSaved?.();
        onClose(true);
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'فشل حفظ المنتج',
          'error',
          6000,
        );
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      busy,
      modeConfig,
      editingId,
      saveLot,
      name,
      costPrice,
      retailPrice,
      wholesalePrice,
      saleMode,
      stock,
      stockUnitId,
      validConversion,
      untrackedStock,
      variantDrafts,
      threshold,
      categoryId,
      imageUri,
      sizesEnabled,
      sizeDrafts,
      expiryDate,
      expiryMode,
      unitRows,
      discountPct,
      onlineListed,
      baseUnitName,
      barcode,
      refreshCatalog,
      toast,
      onSaved,
      onClose,
    ],
  );

  /** v39: تصفير النموذج لمنتج تالٍ — يبقى التصنيف المختار فقط. */
  const resetForNext = useCallback(() => {
    setName('');
    setBarcode('');
    setCostPrice('');
    setRetailPrice('');
    setWholesalePrice('');
    setDiscountPct('');
    setOnlineListed(false);
    setStock('');
    setThreshold('');
    setStockUnitId(null);
    setImageUri(null);
    setSaleMode(modeConfig.defaultSaleMode);
    setUnitRows([]);
    setLotSizes([]);
    setLotColors([]);
    setLotBundles('1');
    setLotCustomColor('');
    setLotCustomSize('');
    setVariantDrafts([]);
    setSizesEnabled(false);
    setSizeDrafts([]);
    setCustomSizeName('');
    setBaseUnitName(null);
    setUntrackedStock(modeConfig.productCopy.untrackedStockDefault === true);
    setExpiryMode('none');
    setExpiryDateText('');
    setDurationValue('');
    setDurationUnit('days');
    setReceiveMode(defaultReceiveMode());
    setIntakeAdd(true);
    setCartonsCount('');
    setPiecesPerCarton('');
    setCartonCost('');
    setBagsCount('');
    setKgPerBag('');
    setBagCost('');
    setArchived(false);
    loadedStockRef.current = 0;
    loadedCostRef.current = 0;
    lastStockConvRef.current = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeConfig]);

  /* ── الحذف / الأرشفة / الاسترجاع (v23) ─────────────────────── */
  const doRemoveProduct = useCallback(async () => {
    if (editingId == null) {
      return;
    }
    setBusy(true);
    try {
      const outcome = await ProductRepo.remove(editingId);
      await refreshCatalog();
      if (outcome === 'archived') {
        toast(
          'أُرشف المنتج — اختفى من البيع والمخزن وبقي سجله للتقارير والمرتجعات (يمكن استرجاعه)',
          'success',
          6000,
        );
        setArchived(true);
      } else {
        toast('تم حذف المنتج نهائياً', 'success');
        onClose(false);
      }
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشل حذف المنتج',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }, [editingId, refreshCatalog, toast, onClose]);

  const removeProduct = useCallback(async () => {
    if (editingId == null) {
      return;
    }
    // v23: تأكيد يخبر التاجر بما سيحدث فعلاً (أرشفة أم حذف).
    const hasHistory = await ProductRepo.hasHistory(editingId);
    const message = hasHistory
      ? 'هذا المنتج له سجل مبيعات أو جرد يمنع حذفه نهائياً (سلامة الفواتير والتقارير والمرتجعات). سيُؤرشف: يختفي من البيع والمخزن والتنبيهات ويبقى سجله كاملاً، ويمكن استرجاعه في أي وقت.'
      : 'لا سجل لهذا المنتج — سيُحذف نهائياً مع وحداته. لا يمكن التراجع.';
    const confirmed = window.confirm(
      `${hasHistory ? 'أرشفة المنتج؟' : 'حذف المنتج نهائياً؟'}\n\n${message}`,
    );
    if (confirmed) {
      await doRemoveProduct();
    }
  }, [editingId, doRemoveProduct]);

  const restoreProduct = useCallback(async () => {
    if (editingId == null) {
      return;
    }
    setBusy(true);
    try {
      await ProductRepo.unarchive(editingId);
      await refreshCatalog();
      setArchived(false);
      toast('استُرجع المنتج — عاد للعرض والبيع', 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشل استرجاع المنتج',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }, [editingId, refreshCatalog, toast]);

  /* ── عناصر العرض المشتقة ───────────────────────────────────── */
  const isClothingMode = modeConfig.lotEntry === true;
  const showSizesSection = true;
  const baseUnitChoices = modeConfig.productCopy.baseUnitChoices;
  const sizeSeeds = modeConfig.productCopy.sizeSeeds ?? [];
  const copy = modeConfig.productCopy;
  const barcodeValid = barcode.trim().length === 0 || isValidEan13(barcode.trim());
  const editingLabel =
    editingId != null ? (archived ? 'منتج مؤرشف' : 'تعديل منتج') : 'منتج جديد';

  /* ── اختصارات النافذة (v59 — جولة المستخدم #3) ───────────────
   * Ctrl+S يحفظ دون لمس الفأرة، وEscape يغلق النافذة.
   * مرجع حيّ لآخر نسخة من save/onClose — بلا إعادة تركيب المستمع
   * مع كل ضغطة (ومن دونه كان المستمع يحمل نسخة قديمة من الحقول
   * فيحفظ باسم فارغ: انكشاف إغلاق قديم عند الاختبار الفعلي).
   */
  const saveRef = useRef(save);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    saveRef.current = save;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        if (!busy && !loading) {
          void saveRef.current(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, loading]);

  // v61 (الجولة 26 #6): Enter يحفظ المنتج مباشرة — إلا داخل حقول
  // الإدخال (مسح الباركود يرسل Enter وسيحفظ منتجاً نصف مكتمل)؛
  // داخل الحقول يبقى Ctrl+S كما كان.
  useEnterConfirm({
    active: !loading,
    onConfirm: () => {
      if (!busy) {
        void saveRef.current(false);
      }
    },
    enabled: () => !busy,
    skipOnInputs: true,
  });

  /* ── العرض ─────────────────────────────────────────────────── */

  /* ── v61 (الجولة 26 #4): ترقيم الأقسام ديناميكياً ──────────────
   * استلام البضاعة أول الأقسام (بطلب التاجر) والأقسام المخفية بنمط
   * آخر لا تترك فراغاً في التسلسل. */
  const secNums = useMemo(() => {
    let n = 0;
    const next = () => ++n;
    const receiving = modeConfig.receiving ? next() : null;
    const essentials = next();
    const inventory = next();
    const expiry = modeConfig.expiry !== 'hidden' ? next() : null;
    const barcode = next();
    const lot = isClothingMode && editingId == null ? next() : null;
    const model = isClothingMode && variantDrafts.length > 0 ? next() : null;
    const sizes = showSizesSection ? next() : null;
    const units = next();
    return {
      receiving,
      essentials,
      inventory,
      expiry,
      barcode,
      lot,
      model,
      sizes,
      units,
    };
  }, [modeConfig, isClothingMode, editingId, variantDrafts.length, showSizesSection]);

  /** v61: خيارات وحدة الأساس — «قطعة» الافتراضية + وحدات النمط
   *  (أو خيارات المجال للصيدلية/المطعم)، والقيمة المحفوظة المخصّصة
   *  تبقى ضمن الخيارات كي لا تضيع عند التعديل. */
  const baseUnitOptions = useMemo(() => {
    const names: string[] = [];
    const push = (name: string | null | undefined): void => {
      if (name == null || name.trim() === '' || names.includes(name)) {
        return;
      }
      names.push(name);
    };
    if (baseUnitChoices != null) {
      baseUnitChoices.forEach(push);
      push(BASE_UNIT_NAME);
    } else {
      push(BASE_UNIT_NAME);
      units.forEach(unit => push(unit.name));
    }
    push(baseUnitName);
    return names.map(name => ({
      value: name,
      label:
        name === BASE_UNIT_NAME ? `${BASE_UNIT_NAME} — الافتراضي` : name,
    }));
  }, [baseUnitChoices, units, baseUnitName]);

  return (
    <div className="overlay pf-overlay">
      <div className="modal pf-modal">
        <div className="modal-head">
          <div>
            <b>
              {editingId != null ? 'ملف المنتج — تعديل' : 'ملف المنتج — إضافة'}{' '}
              <span className="pf-sub">· {modeConfig.label}</span>
            </b>
            <div className="pf-sub">
              {editingLabel} — {copy.nameLabel} والأسعار والمخزون والوحدات
              والمتغيرات
            </div>
          </div>
          <button className="btn sm ghost" onClick={() => onClose(false)}>
            إغلاق
          </button>
        </div>

        {loading ? (
          <div className="modal-body">
            <div className="empty">
              <div className="icon">⏳</div>
              جارٍ تحميل المنتج…
            </div>
          </div>
        ) : (
          <>
            <div className="modal-body pf-body">
              {archived && (
                <div className="pf-archived-banner">
                  <span>
                    <Icon name="alert" size={15} /> منتج مؤرشف — مخفي من البيع
                    والمخزن، وسجله محفوظ للتقارير والمرتجعات
                  </span>
                  <button
                    className="btn sm"
                    disabled={busy}
                    onClick={() => void restoreProduct()}>
                    استرجاع للرف
                  </button>
                </div>
              )}

              <div className="pf-cols">
                {/* ── العمود الأول: الاستلام ثم الأساسيات والمخزون ──
                    v61 (الجولة 26 #4): استلام البضاعة أول الأقسام —
                    أول ما يُدخل عند إضافة منتج بنمط المتجر. ── */}
                <div className="pf-col">
                  {/* استلام البضاعة */}
                  {modeConfig.receiving && (
                    <section className="pf-sec">
                      <div className="pf-sec-h">
                        <b><span className="pf-sec-num">{secNums.receiving}</span>استلام البضاعة</b>
                        <span className="pf-sec-sub">
                          تعبئة تلقائية: الكمية والتكلفة واقتراح الأسعار
                        </span>
                      </div>
                      <div className="pf-receive">
                        <div className="iv57-chips">
                          <button
                            type="button"
                            className={`iv57-chip ${receiveMode === 'none' ? 'on' : ''}`}
                            onClick={() => switchReceiveMode('none')}>
                            بلا استلام
                          </button>
                          {modeConfig.receivingByContainer && (
                            <button
                              type="button"
                              className={`iv57-chip ${receiveMode === 'carton' ? 'on' : ''}`}
                              onClick={() => switchReceiveMode('carton')}>
                              بال{
                                modeConfig.receivingLabels?.container ?? 'كرتونة'
                              }
                            </button>
                          )}
                          {modeConfig.receivingByBag && (
                            <button
                              type="button"
                              className={`iv57-chip ${receiveMode === 'bag' ? 'on' : ''}`}
                              onClick={() => switchReceiveMode('bag')}>
                              بالكيس وزناً
                            </button>
                          )}
                          {editingId != null && receiveMode !== 'none' && (
                            <Switch
                              checked={intakeAdd}
                              onChange={setIntakeAdd}
                              label={intakeAdd ? 'إضافة للموجود' : 'تعيين الكمية'}
                            />
                          )}
                        </div>
                        {receiveMode === 'carton' && (
                          <>
                            <div className="pf-grid3">
                              <div className="pf-field">
                                <label>
                                  عدد{' '}
                                  {modeConfig.receivingLabels?.container ?? 'كرتونة'}
                                </label>
                                <input
                                  className="iv57-num"
                                  inputMode="decimal"
                                  value={cartonsCount}
                                  onChange={e => setCartonsCount(e.target.value)}
                                  placeholder="0"
                                />
                              </div>
                              <div className="pf-field">
                                <label>
                                  {modeConfig.receivingLabels?.perContainer ??
                                    'قطع بالكرتونة'}
                                </label>
                                <input
                                  className="iv57-num"
                                  inputMode="decimal"
                                  value={piecesPerCarton}
                                  onChange={e => setPiecesPerCarton(e.target.value)}
                                  placeholder="0"
                                />
                              </div>
                              <div className="pf-field">
                                <label>سعر ال{
                                  modeConfig.receivingLabels?.container ?? 'الكرتونة'
                                } (₪)</label>
                                <input
                                  className="iv57-num"
                                  inputMode="decimal"
                                  value={cartonCost}
                                  onChange={e => setCartonCost(e.target.value)}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            {cartonMath != null && (
                              <div className="pf-receive-math">
                                {cartonMath.totalPieces} قطعة إجمالاً
                                {cartonMath.perPiece != null && (
                                  <>
                                    {' '}
                                    · تكلفة القطعة{' '}
                                    <b>
                                      {(
                                        Math.round(cartonMath.perPiece * 1000) /
                                        1000
                                      ).toFixed(3)}
                                    </b>{' '}
                                    ₪
                                  </>
                                )}
                                <div className="iv57-chips" style={{marginTop: 6}}>
                                  <button
                                    type="button"
                                    className="btn sm"
                                    onClick={() =>
                                      applyReceivingPrices(
                                        cartonMath.retail,
                                        cartonMath.wholesale,
                                      )
                                    }>
                                    اعتماد المقترح: مفرق{' '}
                                    {cartonMath.retail?.toFixed(2)} ₪ · جملة{' '}
                                    {cartonMath.wholesale?.toFixed(2)} ₪
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {receiveMode === 'bag' && (
                          <>
                            <div className="pf-grid3">
                              <div className="pf-field">
                                <label>عدد الأكياس</label>
                                <input
                                  className="iv57-num"
                                  inputMode="decimal"
                                  value={bagsCount}
                                  onChange={e => setBagsCount(e.target.value)}
                                  placeholder="0"
                                />
                              </div>
                              <div className="pf-field">
                                <label>كغ بالكيس</label>
                                <input
                                  className="iv57-num"
                                  inputMode="decimal"
                                  value={kgPerBag}
                                  onChange={e => setKgPerBag(e.target.value)}
                                  placeholder="0.0"
                                />
                              </div>
                              <div className="pf-field">
                                <label>سعر الكيس (₪)</label>
                                <input
                                  className="iv57-num"
                                  inputMode="decimal"
                                  value={bagCost}
                                  onChange={e => setBagCost(e.target.value)}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            {bagMath != null && (
                              <div className="pf-receive-math">
                                {bagMath.totalKg} كغ إجمالاً
                                {bagMath.perKg != null && (
                                  <>
                                    {' '}
                                    · تكلفة الكيلو{' '}
                                    <b>
                                      {(Math.round(bagMath.perKg * 1000) / 1000).toFixed(3)}
                                    </b>{' '}
                                    ₪
                                  </>
                                )}
                                <div className="iv57-chips" style={{marginTop: 6}}>
                                  <button
                                    type="button"
                                    className="btn sm"
                                    onClick={() =>
                                      applyReceivingPrices(
                                        bagMath.retail,
                                        bagMath.wholesale,
                                      )
                                    }>
                                    اعتماد المقترح: كيلو مفرق{' '}
                                    {bagMath.retail?.toFixed(2)} ₪ · جملة{' '}
                                    {bagMath.wholesale?.toFixed(2)} ₪
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                        {receiveMode === 'none' && (
                          <span className="iv57-hint">
                            اختر كيف وصلت البضاعة — الكمية والتكلفة
                            والأسعار المقترحة وصف وحدة العبوة تُملأ تلقائياً.
                          </span>
                        )}
                      </div>
                    </section>
                  )}

                  <section className="pf-sec pf-sec-essentials">
                    <div className="pf-sec-h">
                      <b>
                        <span className="pf-sec-num">{secNums.essentials}</span>
                        الأساسيات والأسعار
                      </b>
                      <span className="pf-sec-sub">{copy.priceHint}</span>
                    </div>

                    {/* ── صورة المنتج (v59) ── */}
                    <div className="pf-image-row">
                      <div className="pf-image-box">
                        {imageUri != null && imageUri.length > 0 && !imageFailed ? (
                          <img
                            src={assetSrc(imageUri)}
                            alt=""
                            draggable={false}
                            onError={() => setImageFailed(true)}
                          />
                        ) : (
                          <span className="pf-image-empty">
                            {name.trim().charAt(0) || '؟'}
                          </span>
                        )}
                        {imageBusy && <span className="pf-image-busy">…</span>}
                      </div>
                      <div className="pf-image-actions">
                        <div className="pf-image-label">صورة المنتج</div>
                        <div className="pf-image-hint">
                          تظهر في شاشة البيع — تُضغط تلقائياً إلى 512 بكسل
                        </div>
                        <div className="pf-image-buttons">
                          <button
                            type="button"
                            className="btn sm"
                            disabled={imageBusy}
                            onClick={() => void pickImage()}>
                            {imageUri != null && imageUri.length > 0
                              ? 'تغيير الصورة'
                              : 'اختيار صورة'}
                          </button>
                          {imageUri != null && imageUri.length > 0 && (
                            <button
                              type="button"
                              className="btn sm danger"
                              disabled={imageBusy}
                              onClick={() => setImageUri(null)}>
                              إزالة
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pf-field">
                      <label>{`${copy.nameLabel} *`}</label>
                      <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder={copy.nameHint}
                        autoFocus={editingId == null}
                      />
                    </div>

                    <div>
                      <label style={{fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 700}}>
                        التصنيف
                      </label>
                      <div className="iv57-chips" style={{marginTop: 6}}>
                        <button
                          type="button"
                          className={`iv57-chip ${categoryId === 'none' ? 'on' : ''}`}
                          onClick={() => setCategoryId('none')}>
                          بلا تصنيف
                        </button>
                        {categories.map(cat => (
                          <button
                            type="button"
                            key={cat.id}
                            className={`iv57-chip ${categoryId === cat.id ? 'on' : ''}`}
                            onClick={() => setCategoryId(cat.id)}>
                            {cat.name}
                          </button>
                        ))}
                      </div>
                      <div className="pf-inline-add" style={{marginTop: 8}}>
                        <input
                          value={newCategory}
                          onChange={e => setNewCategory(e.target.value)}
                          placeholder="تصنيف جديد…"
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void addCategoryInline();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => void addCategoryInline()}>
                          + إضافة
                        </button>
                      </div>
                    </div>

                    <div className={copy.wholesaleLabel == null ? 'pf-grid2' : 'pf-grid3'}>
                      <div className="pf-field">
                        <label>{`${
                          saleMode === 'weight'
                            ? `سعر التكلفة للكيلو`
                            : copy.costLabel.replace(' (₪)', '')
                        } (₪) *`}</label>
                        <input
                          className="iv57-num"
                          inputMode="decimal"
                          value={costPrice}
                          onChange={e => setCostPrice(e.target.value)}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="pf-field">
                        <label>{`${
                          saleMode === 'weight'
                            ? 'سعر المفرق للكيلو'
                            : copy.retailLabel.replace(' (₪)', '')
                        } (₪) *`}</label>
                        <input
                          className="iv57-num"
                          inputMode="decimal"
                          value={retailPrice}
                          onChange={e => setRetailPrice(e.target.value)}
                          placeholder="0.00"
                        />
                      </div>
                      {copy.wholesaleLabel != null && (
                        <div className="pf-field">
                          <label>{`${
                            saleMode === 'weight'
                              ? 'سعر الجملة للكيلو'
                              : copy.wholesaleLabel.replace(' (₪)', '')
                          } (₪)`}</label>
                          <input
                            className="iv57-num"
                            inputMode="decimal"
                            value={wholesalePrice}
                            onChange={e => setWholesalePrice(e.target.value)}
                            placeholder="= المفرق"
                          />
                        </div>
                      )}
                    </div>

                    {/* v51: خصم المنتج 0–95 بمعاينة حية */}
                    <div className="pf-grid2">
                      <div className="pf-field">
                        <label>خصم المنتج (%) — 0 إلى 95</label>
                        <input
                          className="iv57-num"
                          inputMode="decimal"
                          value={discountPct}
                          onChange={e => setDiscountPct(e.target.value)}
                          placeholder="0 — بلا خصم"
                        />
                        <input
                          type="range"
                          className="pf-slider"
                          min={0}
                          max={95}
                          step={1}
                          value={Math.max(
                            0,
                            Math.min(95, parseNumber(discountPct) || 0),
                          )}
                          onChange={e =>
                            setDiscountPct(
                              e.target.value === '0' ? '' : e.target.value,
                            )
                          }
                        />
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          justifyContent: 'center',
                        }}>
                        {discountPreview ? (
                          <div className="pf-preview">
                            <span className="old">
                              {formatMoney(discountPreview.base)}
                            </span>
                            <span className="new">
                              {formatMoney(discountPreview.final)}
                            </span>
                            <span className="iv57-mini-chip danger">
                              −{discountPreview.pct}%
                            </span>
                            <span className="iv57-hint">
                              توفير {formatMoney(discountPreview.saved)} للمشتري —
                              يظهر في نقطة البيع وفي سيلا ماركت
                            </span>
                          </div>
                        ) : (
                          <span className="iv57-hint">
                            خصم على سعر المفرق — يظهر للمشترين في المتجر
                            الأونلاين كعرض مخفّض
                          </span>
                        )}
                        {/* v55: الإدراج الانتقائي في سيلا ماركت */}
                        <Switch
                          checked={onlineListed}
                          onChange={setOnlineListed}
                          label="عرض في متجر سيلا أونلاين (المزامنة ترسل المدرج فقط)"
                        />
                      </div>
                    </div>
                  </section>

                  {/* ── المخزون ── */}
                  <section className="pf-sec">
                    <div className="pf-sec-h">
                      <b><span className="pf-sec-num">{secNums.inventory}</span>المخزون والتتبع</b>
                      <span className="pf-sec-sub">
                        {saleMode === 'weight'
                          ? 'منتج وزن — الأسعار والمخزون بالكيلوغرام'
                          : `الوحدة: ${baseUnitName ?? BASE_UNIT_NAME}`}
                      </span>
                    </div>

                    <div className="iv57-chips">
                      <Switch
                        checked={saleMode === 'weight'}
                        disabled={modeConfig.key === 'fruits'}
                        onChange={value => {
                          setSaleMode(value ? 'weight' : 'piece');
                          setStockUnitId(null);
                        }}
                        label={
                          modeConfig.key === 'fruits'
                            ? 'بيع بالوزن دائماً (فواكه)'
                            : saleMode === 'weight'
                            ? 'يُباع بالوزن (كغ)'
                            : 'يُباع بالقطعة'
                        }
                      />
                      {(copy.untrackedStockDefault === true || untrackedStock) && (
                        <Switch
                          checked={untrackedStock}
                          onChange={setUntrackedStock}
                          label={
                            untrackedStock
                              ? 'مخزون بلا تتبع — البيع لا يُحجب ولا يُخصم'
                              : 'تتبع المخزون — عدّ الكميات'
                          }
                        />
                      )}
                    </div>
                    {untrackedStock && (
                      <span className="iv57-hint">
                        «بلا تتبع»: البيع لا يُحجب أبداً بنفاد ولا تُخصم كميات
                        — عند تعديل المنتج تبقى الكمية القائمة كما هي
                        (مصدرها الجرد)، والكمية المرجعية تظل صادقة بعد كل جرد.
                      </span>
                    )}

                    {!untrackedStock && !isClothingMode && (
                      <>
                        <div className="pf-grid2">
                          <div className="pf-field">
                            <label>
                              {saleMode === 'weight'
                                ? `الكمية الحالية (${WEIGHT_UNIT_NAME})`
                                : `الكمية ${
                                    stockUnitId != null
                                      ? `بـ${unitNameById.get(stockUnitId) ?? ''}`
                                      : `(${baseUnitName ?? BASE_UNIT_NAME})`
                                  }`}
                            </label>
                            <input
                              className="iv57-num"
                              inputMode="decimal"
                              value={stock}
                              onChange={e => setStock(e.target.value)}
                              placeholder={saleMode === 'weight' ? '0.0' : '0'}
                            />
                          </div>
                          <div className="pf-field">
                            <label>
                              {saleMode === 'weight'
                                ? 'حد التنبيه (كغ)'
                                : 'حد التنبيه'}
                            </label>
                            <input
                              className="iv57-num"
                              inputMode="decimal"
                              value={threshold}
                              onChange={e => setThreshold(e.target.value)}
                              placeholder="5"
                            />
                          </div>
                        </div>
                        {stockHint && (
                          <span className="iv57-hint">{stockHint}</span>
                        )}
                        {stockUnitChoices.length > 0 && (
                          <div className="iv57-chips">
                            <span className="iv57-hint">وحدة الإدخال:</span>
                            <button
                              type="button"
                              className={`iv57-chip ${stockUnitId == null ? 'on' : ''}`}
                              onClick={() => setStockUnitId(null)}>
                              {saleMode === 'weight'
                                ? WEIGHT_UNIT_NAME
                                : baseUnitName ?? BASE_UNIT_NAME}
                            </button>
                            {stockUnitChoices.map(row => (
                              <button
                                type="button"
                                key={row.unit_id}
                                className={`iv57-chip ${stockUnitId === row.unit_id ? 'on' : ''}`}
                                onClick={() => setStockUnitId(row.unit_id)}>
                                {unitNameById.get(row.unit_id) ?? ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* v61 (الجولة 26 #4): وحدة الأساس — حقل مُسيَّج
                        حقيقي بقائمة منسدلة أنيقة (كان حقلاً عارياً
                        بلا إطار ولا سياق) بخيارات وحدات النمط. */}
                    {!isClothingMode && (
                      <div className="pf-field">
                        <label>وحدة الأساس (تظهر في البيع والفواتير)</label>
                        <Select
                          value={
                            baseUnitName ??
                            baseUnitOptions[0]?.value ??
                            BASE_UNIT_NAME
                          }
                          onChange={setBaseUnitName}
                          options={baseUnitOptions}
                          ariaLabel="وحدة الأساس"
                        />
                        <span className="iv57-hint">
                          هي ما يُخصم منه المخزون عند البيع — ووحدات أكبر
                          (كرتونة…) تُبنى في قسم وحدات البيع.
                        </span>
                      </div>
                    )}
                  </section>

                  {/* ── الصلاحية (v32) ── */}
                  {modeConfig.expiry !== 'hidden' && (
                    <section className="pf-sec">
                      <div className="pf-sec-h">
                        <b><span className="pf-sec-num">{secNums.expiry}</span>الصلاحية</b>
                        {expiryStatus != null && (
                          <span
                            className={`iv57-mini-chip ${
                              expiryStatus.state === 'expired'
                                ? 'danger'
                                : expiryStatus.state === 'expiring'
                                ? 'warn'
                                : 'ok'
                            }`}>
                            {expiryStatus.label}
                          </span>
                        )}
                      </div>
                      <div className="iv57-chips">
                        <button
                          type="button"
                          className={`iv57-chip ${expiryMode === 'none' ? 'on' : ''}`}
                          onClick={() => setExpiryMode('none')}>
                          بلا صلاحية
                        </button>
                        <button
                          type="button"
                          className={`iv57-chip ${expiryMode === 'date' ? 'on' : ''}`}
                          onClick={() => setExpiryMode('date')}>
                          تاريخ محدد
                        </button>
                        <button
                          type="button"
                          className={`iv57-chip ${expiryMode === 'duration' ? 'on' : ''}`}
                          onClick={() => setExpiryMode('duration')}>
                          مدة من اليوم
                        </button>
                      </div>
                      {expiryMode === 'date' && (
                        <div className="pf-field">
                          <label>تاريخ انتهاء الصلاحية</label>
                          <input
                            type="date"
                            value={expiryDateText}
                            onChange={e => setExpiryDateText(e.target.value)}
                          />
                        </div>
                      )}
                      {expiryMode === 'duration' && (
                        <div className="pf-grid2">
                          <div className="pf-field">
                            <label>المدة</label>
                            <input
                              className="iv57-num"
                              inputMode="decimal"
                              value={durationValue}
                              onChange={e => setDurationValue(e.target.value)}
                              placeholder="مثال: 30"
                            />
                          </div>
                          <div className="pf-field">
                            <label>الوحدة</label>
                            <Select
                              value={durationUnit}
                              onChange={value =>
                                setDurationUnit(
                                  value === 'months' ? 'months' : 'days',
                                )
                              }
                              options={[
                                {value: 'days', label: 'أيام'},
                                {value: 'months', label: 'أشهر'},
                              ]}
                              ariaLabel="وحدة مدة الصلاحية"
                            />
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </div>

                {/* ── العمود الثاني: الباركود والمتغيرات والوحدات ── */}
                <div className="pf-col">
                  {/* الباركود والملصق */}
                  <section className="pf-sec">
                    <div className="pf-sec-h">
                      <b><span className="pf-sec-num">{secNums.barcode}</span>الباركود والملصق</b>
                      {barcode.trim().length > 0 && (
                        <span
                          className={`iv57-mini-chip ${barcodeValid ? 'ok' : 'warn'}`}>
                          {barcodeValid ? 'EAN-13 صالح' : 'ليس EAN-13 قياسياً'}
                        </span>
                      )}
                    </div>
                    <div className="pf-barcode-row">
                      <div className="pf-field">
                        <label>باركود المنتج (وحدة الأساس)</label>
                        <input
                          className="iv57-num"
                          value={barcode}
                          onChange={e => setBarcode(e.target.value)}
                          placeholder="امسح أو أدخل الباركود…"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn sm pf-barcode-gen"
                        disabled={labelBusy}
                        onClick={() => void generateBarcode()}
                        title="توليد EAN-13 داخلي فريد (بادئة 20…)">
                        {labelBusy ? (
                          '…'
                        ) : (
                          <>
                            <Icon name="flash" size={15} /> توليد داخلي
                          </>
                        )}
                      </button>
                    </div>
                    <div className="iv57-chips">
                      <span className="iv57-hint">عدد الملصقات:</span>
                      <MiniStepper
                        value={labelCopies}
                        min={1}
                        max={20}
                        onDecrement={() =>
                          setLabelCopies(v => Math.max(1, v - 1))
                        }
                        onIncrement={() =>
                          setLabelCopies(v => Math.min(20, v + 1))
                        }
                      />
                      <button
                        type="button"
                        className="btn sm"
                        disabled={labelBusy || barcode.trim().length === 0}
                        onClick={() => void printLabel()}>
                        {labelBusy ? 'جارٍ الطباعة…' : (<><Icon name="printer" size={15} /> طباعة {labelCopies} ملصق</>)}
                      </button>
                    </div>
                  </section>

                  {/* المتغيرات — الربطة (ملابس جديدة) أو محرّر المتغيرات */}
                  {isClothingMode && editingId == null && (
                    <section className="pf-sec">
                      <div className="pf-sec-h">
                        <b><span className="pf-sec-num">{secNums.lot}</span>الربطة (المقاسات والألوان وعدد الربط)</b>
                        <span className="pf-sec-sub">
                          {lotSizes.length > 0 && lotColors.length > 0
                            ? `${lotColors.length} لون × ${lotSizes.length} مقاس × ${bundlesCount} ربط = ${
                                lotColors.length *
                                lotSizes.length *
                                bundlesCount
                              } قطعة`
                            : 'حدد المقاسات والألوان وعدد الربط — الكمية تُحسب تلقائياً'}
                        </span>
                      </div>
                      <div className="pf-lot-box">
                        <span className="iv57-hint">
                          المقاسات داخل الربطة (قطعة من كل مقاس):
                        </span>
                        <div className="iv57-chips">
                          {[...new Set([...(modeConfig.variantSizes ?? []), ...lotSizes])].map(
                            size => (
                              <button
                                type="button"
                                key={size}
                                className={`iv57-chip ${lotSizes.includes(size) ? 'on' : ''}`}
                                onClick={() => toggleLotSize(size)}>
                                {size}
                              </button>
                            ),
                          )}
                        </div>
                        <div className="pf-inline-add">
                          <input
                            value={lotCustomSize}
                            onChange={e => setLotCustomSize(e.target.value)}
                            placeholder="مقاس آخر واضغط إضافة…"
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addLotCustomSize();
                              }
                            }}
                          />
                          <button type="button" className="btn sm" onClick={addLotCustomSize}>
                            + مقاس
                          </button>
                        </div>
                        <span className="iv57-hint">الألوان:</span>
                        <div className="iv57-chips">
                          {[...new Set([...(modeConfig.variantColors ?? []), ...lotColors])].map(
                            color => (
                              <button
                                type="button"
                                key={color}
                                className={`iv57-chip ${lotColors.includes(color) ? 'on' : ''}`}
                                onClick={() => toggleLotColor(color)}>
                                {color}
                              </button>
                            ),
                          )}
                        </div>
                        <div className="pf-inline-add">
                          <input
                            value={lotCustomColor}
                            onChange={e => setLotCustomColor(e.target.value)}
                            placeholder="لون آخر واضغط إضافة…"
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addLotCustomColor();
                              }
                            }}
                          />
                          <button type="button" className="btn sm" onClick={addLotCustomColor}>
                            + لون
                          </button>
                        </div>
                        <div className="pf-grid2">
                          <div className="pf-field">
                            <label>عدد الربط (من كل مقاس لكل لون)</label>
                            <input
                              className="iv57-num"
                              inputMode="numeric"
                              value={lotBundles}
                              onChange={e =>
                                setLotBundles(e.target.value.replace(/[^0-9]/g, ''))
                              }
                              placeholder="1"
                            />
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-end',
                              paddingBottom: 4,
                            }}>
                            <span className="pf-totals">
                              إجمالي القطع ={' '}
                              {lotColors.length *
                                lotSizes.length *
                                bundlesCount}
                            </span>
                          </div>
                        </div>
                        {lotSizes.length > 0 && wholesalePrice.trim() !== '' && (
                          <span className="iv57-hint">
                            ربطة الجملة ={' '}
                            {(
                              Math.round(
                                (parseNumber(wholesalePrice) || 0) *
                                  lotSizes.length *
                                  100,
                              ) / 100
                            ).toFixed(2)}₪ للربطة — تُباع من نافذة الموديل بوضع
                            الجملة.
                          </span>
                        )}
                      </div>
                    </section>
                  )}

                  {isClothingMode && variantDrafts.length > 0 && (
                    <section className="pf-sec">
                      <div className="pf-sec-h">
                        <b><span className="pf-sec-num">{secNums.model}</span>مخزون الموديل (لون × مقاس)</b>
                        <span className="pf-sec-sub">
                          {variantTotals.pieces} قطعة إجمالاً ·{' '}
                          {variantTotals.colors} لون · {variantTotals.sizes} مقاس
                        </span>
                      </div>
                      {variantColors.map(color => {
                        const rows = variantDrafts.filter(v => v.color === color);
                        const minStock = Math.min(...rows.map(v => v.stock));
                        return (
                          <div key={`edit-color-${color}`} className="pf-variant-group">
                            <div className="pf-variant-group-head">
                              <b>{color}</b>
                              <span className="iv57-hint">
                                أقل مقاس: {minStock} — ربطة الجملة المتاحة{' '}
                                {minStock}
                              </span>
                              <button
                                type="button"
                                className="btn sm"
                                onClick={() => addBundleToColor(color)}>
                                + إضافة ربطة ({rows.length} مقاسات ×{' '}
                                {bundlesCount})
                              </button>
                            </div>
                            {rows.map(row => (
                              <div
                                key={`edit-${row.color}-${row.size}`}
                                className="pf-variant-row">
                                <span className="pf-size-label">{row.size}</span>
                                <input
                                  className="iv57-num"
                                  inputMode="numeric"
                                  value={String(row.stock)}
                                  onChange={e =>
                                    setVariantStock(
                                      row.color,
                                      row.size,
                                      Math.round(parseNumber(e.target.value) || 0),
                                    )
                                  }
                                />
                                <button
                                  type="button"
                                  className="pf-del-btn"
                                  title={`حذف متغير ${row.color} · ${row.size}`}
                                  onClick={() => removeVariant(row.color, row.size)}>
                                  <Icon name="x" size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                      <VariantAddRow onAdd={addVariantRow} />
                      <span className="iv57-hint">
                        الموديل يُحفظ منتجاً واحداً — عند البيع تختار اللون
                        والمقاس من نافذة الموديل، ومخزونه = مجموع متغيراته
                        دائماً.
                      </span>
                    </section>
                  )}

                  {/* الأحجام (مطعم/كافيتريا — متاح لكل الأنماط) */}
                  {showSizesSection && (
                    <section className="pf-sec">
                      <div className="pf-sec-h">
                        <b><span className="pf-sec-num">{secNums.sizes}</span>الأحجام بأسعار مستقلة</b>
                        <Switch
                          checked={sizesEnabled}
                          onChange={setSizesEnabled}
                          label={sizesEnabled ? 'مفعّل' : 'هذا الصنف بأحجام'}
                        />
                      </div>
                      <span className="iv57-hint">
                        {sizesEnabled
                          ? 'أدخل سعر كل حجم أدناه — البيع من نافذة الحجم'
                          : 'بدون أحجام — سعر واحد تدخله في الأسعار أعلاه'}
                      </span>
                      {sizesEnabled && (
                        <>
                          {sizeSeeds.length > 0 && (
                            <div className="iv57-chips">
                              {sizeSeeds.map(seed => (
                                <button
                                  type="button"
                                  key={`sizesize-${seed}`}
                                  className={`iv57-chip ${
                                    sizeDrafts.some(d => d.size === seed) ? 'on' : ''
                                  }`}
                                  onClick={() => toggleSizeDraft(seed)}>
                                  {seed}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="pf-inline-add">
                            <input
                              value={customSizeName}
                              onChange={e => setCustomSizeName(e.target.value)}
                              placeholder="حجم آخر واضغط إضافة…"
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addCustomSizeDraft();
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="btn sm"
                              onClick={addCustomSizeDraft}>
                              + حجم
                            </button>
                          </div>
                          {sizeDrafts.length > 0 && (
                            <>
                              {sizeDrafts.map((draft, index) => (
                                <div key={`sizedraft-${draft.size}`} className="pf-size-row">
                                  <span className="pf-size-label">{draft.size}</span>
                                  <input
                                    className="iv57-num"
                                    inputMode="decimal"
                                    value={draft.price}
                                    onChange={e =>
                                      setSizeDrafts(prev =>
                                        prev.map((d, i) =>
                                          i === index
                                            ? {
                                                ...d,
                                                price: e.target.value.replace(/[^0-9.]/g, ''),
                                              }
                                            : d,
                                        ),
                                      )
                                    }
                                    placeholder="السعر ₪"
                                  />
                                  <input
                                    className="iv57-num"
                                    inputMode="decimal"
                                    value={draft.cost}
                                    onChange={e =>
                                      setSizeDrafts(prev =>
                                        prev.map((d, i) =>
                                          i === index
                                            ? {
                                                ...d,
                                                cost: e.target.value.replace(/[^0-9.]/g, ''),
                                              }
                                            : d,
                                        ),
                                      )
                                    }
                                    placeholder="تكلفة (اختياري)"
                                  />
                                  <button
                                    type="button"
                                    className="pf-del-btn"
                                    title={`حذف الحجم ${draft.size}`}
                                    onClick={() =>
                                      setSizeDrafts(prev =>
                                        prev.filter((_, i) => i !== index),
                                      )
                                    }>
                                    <Icon name="x" size={14} />
                                  </button>
                                </div>
                              ))}
                              <span className="iv57-hint">
                                سعر كل حجم يظهر في نافذة البيع وفي الفاتورة —
                                تكلفته اختيارية وتبقى تكلفة الحصة إن تُركت
                                فارغة.
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </section>
                  )}

                  {/* وحدات البيع */}
                  <section className="pf-sec">
                    <div className="pf-sec-h">
                      <b><span className="pf-sec-num">{secNums.units}</span>وحدات البيع</b>
                      <span className="pf-sec-sub">
                        {unitRows.length === 0
                          ? 'لا وحدات — يُباع بوحدة الأساس'
                          : unitRows
                              .map(
                                row =>
                                  `${unitNameById.get(row.unit_id) ?? 'وحدة'} = ${
                                    row.conversion || '?'
                                  }`,
                              )
                              .join(' · ')}
                      </span>
                    </div>
                    {unitRows.length > 0 && (
                      <table className="pf-units-table">
                        <thead>
                          <tr>
                            <th>الوحدة</th>
                            <th>
                              المعامل (
                              {saleMode === 'weight' ? 'كغ' : BASE_UNIT_NAME})
                            </th>
                            <th>باركود الوحدة</th>
                            <th>مفرق ₪</th>
                            <th>جملة ₪</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {unitRows.map((row, index) => {
                            const unitKnown = units.some(
                              unit => unit.id === row.unit_id,
                            );
                            // v61 (الجولة 26 #4): قائمة منسدلة مخصّصة —
                            // القائمة الأصلية كانت مضغوطة داخل الخلية.
                            const unitSelectOptions: {
                              value: string;
                              label: string;
                            }[] = [];
                            if (!unitKnown) {
                              unitSelectOptions.push({
                                value: String(row.unit_id),
                                label:
                                  unitNameById.get(row.unit_id) ?? 'وحدة',
                              });
                            }
                            units
                              .filter(
                                unit =>
                                  unit.id === row.unit_id ||
                                  !unitRows.some(
                                    other => other.unit_id === unit.id,
                                  ),
                              )
                              .forEach(unit =>
                                unitSelectOptions.push({
                                  value: String(unit.id),
                                  label: unit.name,
                                }),
                              );
                            return (
                              <tr key={`unitrow-${index}`}>
                                <td>
                                  <Select
                                    value={String(row.unit_id)}
                                    onChange={value =>
                                      updateUnitRow(index, {
                                        unit_id: Number(value),
                                      })
                                    }
                                    options={unitSelectOptions}
                                    ariaLabel="وحدة البيع"
                                  />
                                </td>
                                <td>
                                  <input
                                    className="iv57-num"
                                    inputMode="decimal"
                                    value={row.conversion}
                                    onChange={e =>
                                      updateUnitRow(index, {
                                        conversion: e.target.value,
                                      })
                                    }
                                    placeholder="24"
                                  />
                                </td>
                                <td>
                                  <input
                                    className="iv57-num"
                                    value={row.barcode}
                                    onChange={e =>
                                      updateUnitRow(index, {
                                        barcode: e.target.value,
                                      })
                                    }
                                    placeholder="—"
                                  />
                                </td>
                                <td>
                                  <input
                                    className="iv57-num"
                                    inputMode="decimal"
                                    value={row.retail}
                                    onChange={e =>
                                      updateUnitRow(index, {
                                        retail: e.target.value,
                                        retailManual: e.target.value.trim().length > 0,
                                      })
                                    }
                                    placeholder="تلقائي"
                                  />
                                  {!row.retailManual && row.retail.trim() !== '' && (
                                    <span className="auto">تلقائي</span>
                                  )}
                                </td>
                                <td>
                                  <input
                                    className="iv57-num"
                                    inputMode="decimal"
                                    value={row.wholesale}
                                    onChange={e =>
                                      updateUnitRow(index, {
                                        wholesale: e.target.value,
                                        wholesaleManual:
                                          e.target.value.trim().length > 0,
                                      })
                                    }
                                    placeholder="تلقائي"
                                  />
                                  {!row.wholesaleManual &&
                                    row.wholesale.trim() !== '' && (
                                      <span className="auto">تلقائي</span>
                                    )}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="pf-del-btn"
                                    title="حذف صف الوحدة"
                                    onClick={() => removeUnitRow(index)}>
                                    <Icon name="x" size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <div className="iv57-chips">
                      <button type="button" className="btn sm" onClick={addUnitRow}>
                        + صف وحدة
                      </button>
                      {saleMode === 'weight' &&
                        WEIGHT_PACKAGE_PRESETS.map(preset => (
                          <button
                            type="button"
                            key={`preset-${preset.name}`}
                            className="iv57-chip"
                            onClick={() => void addWeightPackage(preset)}>
                            {preset.name} ({preset.kg} كغ)
                          </button>
                        ))}
                    </div>
                    {saleMode === 'weight' && (
                      <span className="iv57-hint">
                        حزم الوزن الجاهزة تنشئ الوحدة (إن لم توجد) بمعاملها
                        الكسري وتسعّرها من سعر الكيلو تلقائياً.
                      </span>
                    )}
                    {usedUnitWarning(unitRows) && (
                      <span className="iv57-hint">
                        <Icon name="alert" size={14} /> لا تكرّر الوحدة نفسها في
                        صفّين — الثانية تلغي الأولى عند الحفظ.
                      </span>
                    )}
                  </section>

                </div>
              </div>
            </div>

            <div className="modal-foot">
              {editingId != null && !archived && (
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() => void removeProduct()}>
                  حذف المنتج
                </button>
              )}
              <span style={{flex: 1}} />
              {editingId == null && (
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void save(true)}>
                  حفظ وإضافة آخر
                </button>
              )}
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => onClose(false)}>
                إلغاء
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void save(false)}>
                {busy
                  ? 'جارٍ الحفظ…'
                  : editingId != null
                  ? 'حفظ التعديلات'
                  : 'حفظ المنتج'}
                <span className="pf-kbd">Ctrl+S</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── عناصر مساعدة ───────────────────────────────────────────── */

/** سطر إضافة متغير جديد (لون × مقاس) في محرّر المتغيرات. */
function VariantAddRow({
  onAdd,
}: {
  onAdd: (color: string, size: string) => void;
}) {
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  return (
    <div className="pf-add-row">
      <input
        value={color}
        onChange={e => setColor(e.target.value)}
        placeholder="اللون (أسود…)"
      />
      <input
        value={size}
        onChange={e => setSize(e.target.value)}
        placeholder="المقاس (L / 40…)"
      />
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          onAdd(color, size);
          setColor('');
          setSize('');
        }}>
        + متغير
      </button>
    </div>
  );
}

/** هل كُرّرت وحدة في أكثر من صف؟ (تحذير عرضي فقط). */
function usedUnitWarning(rows: UnitRowDraft[]): boolean {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.unit_id)) {
      return true;
    }
    seen.add(row.unit_id);
  }
  return false;
}
