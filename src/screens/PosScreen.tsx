/**
 * PosScreen.tsx — نقطة البيع v58 (إعادة تصميم كاملة بمقاييس أنظمة
 * POS العالمية — Square/Lightspeed/Loyverse):
 *  • بلاطات منتجات بصور حقيقية (asset protocol) + حرف أول أنيق عند
 *    غياب الصورة + شارات المخزون والخصم والمتغيرات فوق الصورة.
 *  • ثلاثة أنماط عرض (شبكة/قائمة/بطاقات) — نفس إعداد الأندرويد
 *    posProductView، منفذة فعلياً الآن مع زر تبديل سريع.
 *  • شريط تصنيفات رقائق أفقي + بحث فوري + مفرق/جملة (F3).
 *  • سلة كاشير محترفة: عدّاد كمية لكل صف، إجمالي السطر، حذف، خصم
 *    الفاتورة، وزر إتمام ضخم (F9) + صف الدين/القسيمة.
 *  • لوحة دفع كاشير: مبلغ ضخم، لوحة أرقام، أزرار نقد سريع
 *    (20/50/100/200/كامل)، حساب الباقي لحظياً.
 *  • إنشاء زبون دين متجر سريع بحقل الجوال (v58 — كان مفقوداً).
 * كل منطق البيع الأصلي (باركود/متغيرات/وزن/ديون/قسائم) محفوظ حرفياً.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {assetSrc} from '../lib/tauri';
import {
  useCartStore,
  cartTotals,
  unitPriceFor,
} from '../stores/cartStore';
import {useCatalogStore, useToastStore} from '../state/appStores';
import {useSettingsStore, type PosProductView} from '../stores/settingsStore';
import {InvoiceService} from '../services/InvoiceService';
import {ProductRepo} from '../database/repositories/ProductRepo';
import {
  LocalDebtsRepo,
  isValidIdNumber,
  isValidLocalPhone,
} from '../database/repositories/LocalDebtsRepo';
import {SilaRepo} from '../services/sila/SilaRepo';
import {parseSilaQr} from '../services/sila/qr';
import {useSilaStore} from '../stores/silaStore';
import {
  VoucherService,
  VoucherRedeemError,
} from '../services/VoucherService';
import {ThermalPrinterService} from '../services/printer/ThermalPrinterService';
import {usePrinterStore} from '../stores/printerStore';
import {setActiveBarcodeHandler, beep} from '../lib/scanner';
import {useAmountKeyboard} from '../lib/useAmountKeyboard';
import {useEnterConfirm} from '../lib/useEnterConfirm';
import {
  formatMoney,
  localToday,
} from '../core/format';
import {
  WEIGHT_QTY_DECIMALS,
} from '../core/config';
import {applyAmountKey, AMOUNT_KEYPAD_KEYS} from '../core/amountKeypad';
import {Icon} from '../components/Icon';
import {QuickProductSheet} from '../components/QuickProductSheet';
import type {
  CartLine,
  Product,
  ProductVariant,
  SilaCustomer,
  LocalCustomerBalance,
} from '../core/types';
import {
  activePaymentMethods,
  paymentMethodById,
  type PaymentMethodId,
} from '../core/paymentMethods';
import {PaymentMethodIcon} from '../components/PaymentMethodIcon';
import './pos.css';

/** يحفظ نمط العرض المختار في الإعدادات (يستمر بين الجلسات). */
function persistView(view: PosProductView): void {
  useSettingsStore.getState().update({posProductView: view});
}

/** إعدادات الإيصال من إعدادات المتجر (نفس لقطة الأندرويد). */
function receiptSettings() {
  const s = useSettingsStore.getState().settings;
  return {
    storeName: s.storeName,
    storePhone: s.storePhone,
    footerMessage: s.footerMessage,
    storeLogoPath: s.storeLogoPath,
    paperWidth: s.paperWidth,
    codepage: s.codepage,
    showProfit: s.showProfitOnReceipt,
  };
}

type PayKind = 'cash' | 'sila' | 'local';

interface VariantPickState {
  product: Product;
}

interface WeightPickState {
  product: Product;
}

interface DebtConfirmState {
  kind: 'sila' | 'local';
  customerId: string | null;
  localCustomerId?: number | null;
  customerName: string;
  customerPhoneLast4: string | null;
  customerCard: string | null;
  offlineQr: string | null;
  amountMinor: number;
  creditMinor?: number;
}

/** v61 (الجولة 26 #3): أزرار النقد السريع والمبالغ المقترحة حُذفت بطلب
 * التاجر — بقيت أزرار «كامل المبلغ» و«تصفير» فقط، وملاحظة الكيبورد
 * أزيلت من لوحتي الدفع والوزن. */

export function PosScreen() {
  const toast = useToastStore(s => s.show);
  const settings = useSettingsStore(s => s.settings);
  const products = useCatalogStore(s => s.products);
  const categories = useCatalogStore(s => s.categories);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const silaPaired = useSilaStore(s => s.pairing != null);
  const printerStatus = usePrinterStore(s => s.status);
  const checkPrinter = usePrinterStore(s => s.checkConnection);

  // ── السلة ──
  const lines = useCartStore(s => s.lines);
  const pricingMode = useCartStore(s => s.pricingMode);
  const discountInput = useCartStore(s => s.discount);
  const addProductToCart = useCartStore(s => s.addProduct);
  const addWeighted = useCartStore(s => s.addWeighted);
  const addVariantLine = useCartStore(s => s.addVariantLine);
  const addBundleLine = useCartStore(s => s.addBundleLine);
  const addSizedLine = useCartStore(s => s.addSizedLine);
  const increment = useCartStore(s => s.increment);
  const decrement = useCartStore(s => s.decrement);
  const removeLine = useCartStore(s => s.removeLine);
  const setDiscount = useCartStore(s => s.setDiscount);
  const setPricingMode = useCartStore(s => s.setPricingMode);
  const clearCart = useCartStore(s => s.clear);

  const totals = useMemo(() => cartTotals(lines, discountInput), [lines, discountInput]);

  // ── واجهة ──
  const [search, setSearch] = useState('');
  // v58 (الجولة 62): الإضافة السريعة لمود «نقطة البيع».
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [view, setView] = useState<PosProductView>(settings.posProductView);
  const [busy, setBusy] = useState(false);
  const [variantPick, setVariantPick] = useState<VariantPickState | null>(null);
  const [weightPick, setWeightPick] = useState<WeightPickState | null>(null);
  const [weightValue, setWeightValue] = useState('');
  const [paySheet, setPaySheet] = useState<PayKind | null>(null);
  const [amountText, setAmountText] = useState('');
  /** v70 (الجولة 74 #2/#3): طريقة الدفع المختارة داخل نافذة الدفع —
   *  نقدي افتراضياً؛ الأسهم تنقل بين الطرق المفعّلة وEnter يؤكد. */
  const [payMethodId, setPayMethodId] = useState<PaymentMethodId>('cash');
  const [debtConfirm, setDebtConfirm] = useState<DebtConfirmState | null>(null);
  const [debtSheet, setDebtSheet] = useState<'sila' | 'local' | null>(null);
  const [silaCustomers, setSilaCustomers] = useState<SilaCustomer[]>([]);
  const [silaQuery, setSilaQuery] = useState('');
  const [localCustomers, setLocalCustomers] = useState<LocalCustomerBalance[]>([]);
  const [localQuery, setLocalQuery] = useState('');
  const [localCreateName, setLocalCreateName] = useState('');
  const [localCreateId, setLocalCreateId] = useState('');
  // v58: حقل الجوال كان مفقوداً من إنشاء الزبون السريع — الآن موجود
  // ومُتحقق بنفس معيار جوال التسجيل (056/059) لكنه اختياري هنا.
  const [localCreatePhone, setLocalCreatePhone] = useState('');
  const [localCreateError, setLocalCreateError] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherSheet, setVoucherSheet] = useState(false);
  /** v70 (الجولة 74 #7): وضع إدخال خصم الفاتورة — نسبة ٪ أو مبلغ ₪.
   *  الافتراضي مبلغ (كما كان دائماً)؛ النسبة تحسب من مجموع السلة
   *  وتُطبّق كمبلغ فوري — نفس محرك الفاتورة بلا تغيير. */
  const [discountMode, setDiscountMode] = useState<'amount' | 'pct'>('amount');
  const [discountPctText, setDiscountPctText] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const debtCommitting = useRef(false);

  useEffect(() => {
    if (products.length === 0) void refreshCatalog();
    void checkPrinter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── سعر منتج بعد خصم النسبة (v51) ──
  const priceOf = useCallback(
    (product: Product): number => {
      return unitPriceFor(product, null, pricingMode);
    },
    [pricingMode],
  );

  // ── إضافة منتج للسلة: متغيرات → وزن → عادي ──
  const tryAdd = useCallback(
    (product: Product) => {
      if (product.has_variants === 1) {
        setVariantPick({product});
        return;
      }
      if (product.sold_by_weight === 1) {
        setWeightValue('');
        setWeightPick({product});
        return;
      }
      const result = addProductToCart(product, pricingMode);
      if (result.added) {
        beep('ok');
      } else if (result.reason) {
        toast(result.reason, 'error');
        beep('error');
      }
    },
    [addProductToCart, pricingMode, toast],
  );

  // ── توجيه الماسح العام: منتج / رمز صِلة / قسيمة ──
  useEffect(() => {
    setActiveBarcodeHandler((code: string) => {
      // 1) قسيمة صِلة (نص SILAV1 أو رمز QR)
      if (/^SILAV1/i.test(code) || code.includes('|')) {
        setVoucherCode(code);
        setVoucherSheet(true);
        return;
      }
      // 2) رمز صِلة (بطاقة/دفع آجل/اقتران)
      const qr = parseSilaQr(code);
      if (qr.payload.kind === 'card' || qr.payload.kind === 'offline') {
        if (lines.length === 0) {
          toast('أضف منتجات للسلة أولاً ثم امسح رمز الزبون', 'info');
          return;
        }
        if (qr.expired) {
          toast('رمز صِلة منتهي الصلاحية — اطلب رمزاً جديداً', 'error');
          return;
        }
        if (qr.payload.kind === 'card') {
          setDebtConfirm({
            kind: 'sila',
            customerId: qr.payload.cid ?? null,
            customerName: qr.payload.name ?? 'زبون صِلة',
            customerPhoneLast4: (qr.payload.phone ?? '').slice(-4) || null,
            customerCard: code,
            offlineQr: null,
            amountMinor: Math.round(totals.total * 100),
          });
        } else {
          setDebtConfirm({
            kind: 'sila',
            customerId: qr.payload.cid ?? null,
            customerName: 'زبون صِلة (دفع آجل)',
            customerPhoneLast4: null,
            customerCard: null,
            offlineQr: code,
            amountMinor:
              qr.payload.amountMinor > 0
                ? qr.payload.amountMinor
                : Math.round(totals.total * 100),
          });
        }
        setPaySheet(null);
        return;
      }
      // 3) باركود منتج (محلي فوري)
      const hit = products.find(p => p.barcode === code);
      if (hit != null) {
        tryAdd(hit);
        return;
      }
      // 4) باركود وحدة (منتج بوحدة بيع خاصة) — استعلام القاعدة
      void (async () => {
        try {
          const {getDb} = await import('../database/connection');
          const unitRow = (
            await getDb().execute(
              `SELECT pu.*, p.id AS pid, u.name AS unit_name, u.short_name AS unit_short
                 FROM product_units pu
                 JOIN products p ON p.id = pu.product_id
                 JOIN units u ON u.id = pu.unit_id
                WHERE pu.barcode = ? AND p.is_archived = 0 LIMIT 1`,
              [code],
            )
          ).rows?.[0] as
            | {
                pid: number;
                id: number;
                product_id: number;
                unit_id: number;
                unit_name: string;
                unit_short: string;
                conversion: number;
                barcode: string | null;
                retail_price: number | null;
                wholesale_price: number | null;
              }
            | undefined;
          if (unitRow == null) {
            toast(`باركود غير معروف: ${code}`, 'error');
            beep('error');
            return;
          }
          const product = await ProductRepo.getById(unitRow.pid);
          if (product == null) {
            toast(`باركود غير معروف: ${code}`, 'error');
            return;
          }
          const unit = {
            id: unitRow.id,
            product_id: unitRow.product_id,
            unit_id: unitRow.unit_id,
            unitName: unitRow.unit_name,
            unitShort: unitRow.unit_short,
            conversion: unitRow.conversion,
            barcode: unitRow.barcode,
            retail_price: unitRow.retail_price,
            wholesale_price: unitRow.wholesale_price,
          };
          const result = addProductToCart(product, pricingMode, unit);
          if (result.added) beep('ok');
          else if (result.reason) toast(result.reason, 'error');
        } catch {
          toast(`باركود غير معروف: ${code}`, 'error');
        }
      })();
      return;
    });
    return () => setActiveBarcodeHandler(null);
  }, [products, tryAdd, addProductToCart, pricingMode, toast, totals.total, lines.length]);

  // ── اختصارات لوحة المفاتيح v60 ──
  // (الكاملة أدناه بعد تعريف لوحات اختيار الزبون — تعتمد عليها.)

  // ── طرق الدفع المتاحة (v70 — تفعيل التاجر من الإعدادات) ──
  const payMethods = useMemo(
    () => activePaymentMethods(settings.paymentMethodsEnabled),
    [settings.paymentMethodsEnabled],
  );
  const selectedPayMethod = useMemo(
    () => paymentMethodById(payMethodId),
    [payMethodId],
  );

  /** فتح نافذة الدفع — النقدي هو الافتراضي دائماً. */
  const openPaySheet = useCallback(() => {
    setPayMethodId('cash');
    setAmountText('');
    setPaySheet('cash');
  }, []);

  // ── بيع نقدي ──
  const completeCashSale = useCallback(
    async (paidText: string, methodId: PaymentMethodId = 'cash') => {
      if (lines.length === 0) return;
      const method = paymentMethodById(methodId);
      const paid = paidText === '' ? totals.total : Number(paidText);
      if (!Number.isFinite(paid)) {
        toast('المبلغ المدفوع غير صالح', 'error');
        return;
      }
      if (method.id === 'cash' && paid + 0.001 < totals.total) {
        toast(
          `المدفوع ${formatMoney(paid)} أقل من الإجمالي ${formatMoney(totals.total)}`,
          'error',
        );
        return;
      }
      setBusy(true);
      try {
        await InvoiceService.completeSale({
          lines,
          discount: discountInput,
          paymentType: pricingMode,
          paymentMethod: method.id,
          print: printerStatus === 'connected',
          receiptSettings: receiptSettings(),
          onPrintError: m => toast(`تم حفظ البيع لكن الطباعة فشلت: ${m}`, 'error'),
          productNames: new Map(lines.map(l => [l.productId, l.name])),
        });
        if (method.id === 'cash' && paid > totals.total) {
          toast(`الباقي للزبون: ${formatMoney(paid - totals.total)}`, 'success', 5000);
        } else if (method.id !== 'cash') {
          toast(
            `تم البيع عبر ${method.label} — سُجّل في أرصدته من شاشة التقارير`,
            'success',
            4000,
          );
        }
        clearCart();
        setPaySheet(null);
        setAmountText('');
        void refreshCatalog();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        setBusy(false);
      }
    },
    [lines, totals.total, discountInput, pricingMode, printerStatus, clearCart, toast, refreshCatalog],
  );

  // ── بيع بالدين (صِلة أو دفتر المتجر) ──
  const completeDebtSale = useCallback(
    async (confirm: DebtConfirmState) => {
      if (lines.length === 0) return;
      if (debtCommitting.current) return;
      debtCommitting.current = true;
      setBusy(true);
      try {
        await InvoiceService.completeSale({
          lines,
          discount: discountInput,
          paymentType: pricingMode,
          print: printerStatus === 'connected',
          receiptSettings: receiptSettings(),
          onPrintError: m => toast(`تم تسجيل الدين لكن الطباعة فشلت: ${m}`, 'error'),
          productNames: new Map(lines.map(l => [l.productId, l.name])),
          ...(confirm.kind === 'local'
            ? {
                localDebt: {
                  localCustomerId: confirm.localCustomerId ?? -1,
                  customerName: confirm.customerName,
                  customerPhoneLast4: confirm.customerPhoneLast4,
                },
              }
            : {
                debt: {
                  customerId: confirm.customerId,
                  customerName: confirm.customerName,
                  customerPhoneLast4: confirm.customerPhoneLast4,
                  customerCard: confirm.customerCard,
                  offlineQr: confirm.offlineQr,
                  amountMinor: confirm.amountMinor,
                  creditCoveredMinor: confirm.creditMinor ?? 0,
                },
              }),
        });
        toast(
          confirm.kind === 'local'
            ? `سُجّل الدين على ${confirm.customerName} (دفتر المتجر)`
            : `سُجّل دين صِلة على ${confirm.customerName}`,
          'success',
        );
        clearCart();
        setDebtConfirm(null);
        setDebtSheet(null);
        void refreshCatalog();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        debtCommitting.current = false;
        setBusy(false);
      }
    },
    [lines, discountInput, pricingMode, printerStatus, clearCart, toast, refreshCatalog],
  );

  // ── لوحات اختيار الزبون ──
  const openSilaPicker = useCallback(async () => {
    try {
      const list = await SilaRepo.listCustomers();
      if (list.length === 0) {
        toast('لا يوجد زبائن صِلة محفوظون — امسح رمز الزبون أو زامن صِلة أولاً', 'info', 4500);
        return;
      }
      setSilaQuery('');
      setSilaCustomers(list);
      setDebtSheet('sila');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'تعذر تحميل زبائن صِلة', 'error');
    }
  }, [toast]);

  const openLocalPicker = useCallback(async () => {
    try {
      const list = await LocalDebtsRepo.listWithBalances();
      setLocalQuery('');
      setLocalCreateName('');
      setLocalCreateId('');
      setLocalCreatePhone('');
      setLocalCreateError(null);
      setLocalCustomers(list);
      setDebtSheet('local');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }, [toast]);

  const createLocalAndDebt = useCallback(async () => {
    const name = localCreateName.trim();
    const idNumber = localCreateId.trim();
    const phone = localCreatePhone.replace(/[\s-]/g, '');
    if (name.length < 2) {
      setLocalCreateError('اكتب اسم الزبون');
      return;
    }
    if (!idNumber) {
      setLocalCreateError('اكتب رقم هوية الزبون');
      return;
    }
    if (!isValidIdNumber(idNumber)) {
      setLocalCreateError('رقم الهوية غير صالح (9 خانات مع خانة تحقق)');
      return;
    }
    // v58: الجوال اختياري هنا — لكن إن كُتب فليكن بمعيار التسجيل.
    if (phone.length > 0 && !isValidLocalPhone(phone)) {
      setLocalCreateError('رقم الجوال 10 خانات يبدأ بـ 056 أو 059');
      return;
    }
    try {
      const customer = await LocalDebtsRepo.createCustomer({
        name,
        idNumber,
        phone: phone.length > 0 ? phone : null,
        notes: 'أُنشئ أثناء البيع بالدين',
      });
      setDebtConfirm({
        kind: 'local',
        customerId: null,
        localCustomerId: customer.id,
        customerName: customer.name,
        customerPhoneLast4: phone.length >= 4 ? phone.slice(-4) : null,
        customerCard: null,
        offlineQr: null,
        amountMinor: Math.round(totals.total * 100),
      });
      setDebtSheet(null);
    } catch (error) {
      setLocalCreateError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [localCreateName, localCreateId, localCreatePhone, toast, totals.total]);

  // ── اختصارات لوحة المفاتيح v60 (طلب الجولة 25 #3) ─────────────
  // F1 تفريغ السلة · F2 دين المتجر · F3 دين العميل (صِلة) · F4
  // القسيمة — أزرار السلة تحمل شاراتها كي يكتشفها الكاشير بلا
  // دليل. البحث انتقل لـ F6 ومفرق/جملة لـ F7 كي لا تتصادم مع
  // التعيين الجديد، وF9 إتمام البيع كما كان منذ v58.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        if (lines.length > 0) {
          clearCart();
          beep('ok');
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (lines.length > 0 && !busy && paySheet == null && debtConfirm == null) {
          void openLocalPicker();
        } else if (lines.length === 0) {
          toast('أضف منتجات للسلة أولاً ثم سجّل دين المتجر', 'info');
        }
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (!silaPaired) {
          toast('اربط صِلة أولاً من شاشة صِلة والقسائم', 'info');
        } else if (lines.length > 0 && !busy && paySheet == null && debtConfirm == null) {
          void openSilaPicker();
        } else if (lines.length === 0) {
          toast('أضف منتجات للسلة أولاً ثم سجّل دين العميل', 'info');
        }
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (paySheet == null && debtConfirm == null && weightPick == null && variantPick == null) {
          setVoucherCode('');
          setVoucherSheet(true);
        }
      } else if (e.key === 'F6') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F7') {
        e.preventDefault();
        setPricingMode(pricingMode === 'RETAIL' ? 'WHOLESALE' : 'RETAIL');
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (lines.length > 0 && !busy) openPaySheet();
      } else if (e.key === 'Escape') {
        // v58: Escape يغلق كل النوافذ المفتوحة — دفع/دين/متغير/وزن/
        // اختيار زبون/قسيمة (كانت لوحتا الاختيار لا تُغلقان به).
        setPaySheet(null);
        setDebtConfirm(null);
        setVariantPick(null);
        setWeightPick(null);
        setDebtSheet(null);
        setVoucherSheet(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pricingMode, setPricingMode, lines.length, busy, paySheet, debtConfirm, weightPick, variantPick, silaPaired, clearCart, openLocalPicker, openSilaPicker, toast, openPaySheet]);

  // ── صرف قسيمة على السلة (v20) ──
  const redeemVoucherOnCart = useCallback(async () => {
    const payload = voucherCode.trim();
    if (payload === '') {
      toast('امسح رمز القسيمة أو اكتبه أولاً', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await VoucherService.redeemVoucher({
        payload,
        mode: 'cart',
        cart: {lines, discount: discountInput, pricingMode},
        print: printerStatus === 'connected',
        receiptSettings: receiptSettings(),
        onPrintError: m => toast(`تم الصرف لكن الطباعة فشلت: ${m}`, 'error'),
      });
      if (result.needsTopUp) {
        toast(
          'القسيمة أكبر من قيمة السلة — أضف بضاعة بما يغطي القسيمة ثم أكمل التسليم من شاشة صِلة',
          'info',
          6000,
        );
        setVoucherSheet(false);
        return;
      }
      const goods = (result.cartMinor ?? 0) / 100;
      toast(
        `صُرفت القسيمة — قيمة البضاعة ${formatMoney(goods)}` +
          (result.counterExtraMinor > 0
            ? ` + فرق نقدي ${formatMoney(result.counterExtraMinor / 100)}`
            : '') +
          ' — سلّم البضاعة',
        'success',
        6000,
      );
      clearCart();
      setVoucherSheet(false);
      setVoucherCode('');
    } catch (error) {
      if (error instanceof VoucherRedeemError) {
        toast(error.message, 'error', 6000);
      } else {
        toast(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      setBusy(false);
    }
  }, [voucherCode, lines, discountInput, pricingMode, printerStatus, clearCart, toast]);

  // ── v59: معالجات ثابتة للسلة — مع memo لصفوفها لا تُعاد رسم كل
  // الصفوف مع كل زيادة/إنقاص (كانت أكبر مصدر تلعثم في الشاشة).
  const handleInc = useCallback(
    (key: string) => {
      const r = increment(key);
      if (!r.ok && r.reason) toast(r.reason, 'error');
    },
    [increment, toast],
  );
  const handleDec = useCallback(
    (key: string) => decrement(key),
    [decrement],
  );
  const handleRemoveLine = useCallback(
    (key: string) => removeLine(key),
    [removeLine],
  );

  // ── شبكة المنتجات بعد الفلترة ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (categoryId !== 'all' && p.category_id !== categoryId) return false;
      if (q === '') return true;
      return (
        p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q)
      );
    });
  }, [products, search, categoryId]);

  const change = useMemo(() => {
    if (amountText === '') return 0;
    const paid = Number(amountText);
    return Number.isFinite(paid) ? Math.max(0, paid - totals.total) : 0;
  }, [amountText, totals.total]);

  // ── v61 (الجولة 26 #2): التنقل بأسهم الكيبورد في شبكة المنتجات ──
  // المعيّن يتتبع معرّف المنتج (لا الفهرس) كي يبقى صادقاً مع البحث
  // والفلاتر. الأسهم تحرّك حلقة التحديد، Enter يضيف المعيّن للسلة،
  // وEnter داخل حقل البحث يضيف أول نتيجة ويصفّي البحث للمسح التالي.
  const [selId, setSelId] = useState<number | null>(null);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);

  /** عدد أعمدة الشبكة الحالي — يقاس من العرض الفعلي (auto-fill). */
  const gridColumns = useCallback((): number => {
    if (view === 'list') return 1;
    const grid = gridWrapRef.current?.querySelector<HTMLElement>(
      view === 'cards' ? '.pos-grid.cards' : '.pos-grid',
    );
    const items = grid?.children;
    if (items == null || items.length === 0) return 1;
    const firstTop = (items[0] as HTMLElement).offsetTop;
    let cols = 0;
    for (let i = 0; i < items.length; i++) {
      if ((items[i] as HTMLElement).offsetTop === firstTop) cols++;
      else break;
    }
    return Math.max(1, cols);
  }, [view]);

  /** فهرس المعيّن الحالي داخل filtered (‎-1 إن لم يعد موجوداً). */
  const selIndexInFiltered = useCallback((): number => {
    if (selId == null) return -1;
    return filtered.findIndex(p => p.id === selId);
  }, [filtered, selId]);

  const moveSelection = useCallback(
    (delta: number): void => {
      if (filtered.length === 0) return;
      const current = selIndexInFiltered();
      const next =
        current === -1
          ? delta > 0
            ? 0
            : filtered.length - 1
          : Math.max(0, Math.min(filtered.length - 1, current + delta));
      setSelId(filtered[next].id);
    },
    [filtered, selIndexInFiltered],
  );

  // سقوط المعيّن عند تغيّر الفلتر/البحث → يُصفّر بدل التعلق بمنتج مخفي.
  useEffect(() => {
    if (selId != null && !filtered.some(p => p.id === selId)) {
      setSelId(null);
    }
  }, [filtered, selId]);

  // إبقاء المعيّن داخل مجال الرؤية أثناء التنقل.
  useEffect(() => {
    if (selId == null) return;
    gridWrapRef.current
      ?.querySelector<HTMLElement>('[data-kbsel="true"]')
      ?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }, [selId]);

  // مستمع الأسهم وEnter — يعمل فقط حين لا نافذة مفتوحة فوق الشبكة.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        paySheet != null ||
        debtConfirm != null ||
        debtSheet != null ||
        voucherSheet ||
        weightPick != null ||
        variantPick != null
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField =
        target != null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Enter') {
        // Enter داخل حقل البحث: أضف النتيجة المعيّنة أو الأولى.
        if (target === searchRef.current) {
          if (filtered.length === 0) return;
          e.preventDefault();
          const product =
            selId != null
              ? filtered.find(p => p.id === selId) ?? filtered[0]
              : filtered[0];
          tryAdd(product);
          setSearch('');
          return;
        }
        if (inField) return;
        if (selId == null) return;
        const product = filtered.find(p => p.id === selId);
        if (product != null) {
          e.preventDefault();
          tryAdd(product);
        }
        return;
      }

      if (inField) return; // الأسهم داخل الحقول لتحريك المؤشر
      const cols = gridColumns();
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveSelection(cols);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveSelection(-cols);
          break;
        // الشبكة RTL: العناصر تجري من اليمين لليسار — اليسار = التالي.
        case 'ArrowLeft':
          e.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveSelection(-1);
          break;
        case 'Home':
          e.preventDefault();
          if (filtered.length > 0) setSelId(filtered[0].id);
          break;
        case 'End':
          e.preventDefault();
          if (filtered.length > 0) setSelId(filtered[filtered.length - 1].id);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paySheet, debtConfirm, debtSheet, voucherSheet, weightPick, variantPick, filtered, selId, tryAdd, setSearch, moveSelection, gridColumns]);

  // ── تأكيد الوزن (زر الإضافة + Enter من الكيبورد) ──
  const confirmWeight = useCallback(() => {
    if (weightPick == null) return;
    const qty = Number(weightValue);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast('أدخل وزناً صحيحاً', 'error');
      return;
    }
    const r = addWeighted(weightPick.product, pricingMode, qty);
    if (r.added) beep('ok');
    else if (r.reason) toast(r.reason, 'error');
    setWeightPick(null);
  }, [weightPick, weightValue, addWeighted, pricingMode, toast]);

  // ── v59: الكيبورد الفعلي في كل لوحات الأرقام ──
  // الدفع النقدي: أرقام مباشرة + Enter يؤكد البيع فوراً + الأسهم
  // تنقل بين طرق الدفع المفعّلة (v70) وEsc يغلق.
  useAmountKeyboard({
    active: paySheet === 'cash',
    text: amountText,
    onKey: setAmountText,
    onConfirm: () => {
      if (!busy && lines.length > 0) {
        // بنك/محفظة: المبلغ كامل على الحساب — لا حساب باقي نقدي.
        void completeCashSale(
          payMethodId === 'cash' ? amountText : '',
          payMethodId,
        );
      }
    },
    onCancel: () => setPaySheet(null),
    onArrow: delta => {
      if (payMethods.length === 0) return;
      const idx = payMethods.findIndex(m => m.id === payMethodId);
      const next =
        idx === -1
          ? 0
          : (idx + delta + payMethods.length) % payMethods.length;
      setPayMethodId(payMethods[next].id);
    },
  });
  // لوحة الوزن: نفس الشيء — Enter يضيف للسلة.
  useAmountKeyboard({
    active: weightPick != null,
    text: weightValue,
    onKey: next => setWeightValue(next.slice(0, WEIGHT_QTY_DECIMALS + 2)),
    onConfirm: confirmWeight,
    onCancel: () => setWeightPick(null),
  });
  // القسيمة: حقل نصي طبيعي + Enter يصرفها.
  useAmountKeyboard({
    active: voucherSheet,
    text: voucherCode,
    onKey: () => undefined,
    onConfirm: () => {
      if (!busy) void redeemVoucherOnCart();
    },
    onCancel: () => setVoucherSheet(false),
    hasTextInput: true,
  });

  // ── v61 (الجولة 26 #6): Enter يؤكد مباشرة في نوافذ البيع ──
  // تأكيد الدين: Enter = زر «تأكيد الدين وطباعة الإيصال».
  useEnterConfirm({
    active: debtConfirm != null,
    onConfirm: () => {
      if (debtConfirm != null && !busy) {
        void completeDebtSale(debtConfirm);
      }
    },
    enabled: () => !busy,
  });
  // اختيار زبون صِلة: Enter يختار أول نتيجة مطابقة للبحث.
  useEnterConfirm({
    active: debtSheet === 'sila',
    onConfirm: () => {
      const q = silaQuery.trim();
      const hit = silaCustomers.find(c => c.name.includes(q));
      if (hit == null) return;
      setDebtConfirm({
        kind: 'sila',
        customerId: hit.customer_id,
        customerName: hit.name,
        customerPhoneLast4: hit.phone_last4,
        customerCard: null,
        offlineQr: null,
        amountMinor: Math.round(totals.total * 100),
        creditMinor: hit.credit_minor,
      });
      setDebtSheet(null);
    },
  });
  // اختيار زبون الدفتر: Enter يختار أول نتيجة — وإن كُتب في حقول
  // «زبون جديد» فيُنشئ الحساب ويسجّل الدين عليه مباشرة.
  useEnterConfirm({
    active: debtSheet === 'local',
    onConfirm: () => {
      const hasCreateText =
        localCreateName.trim() !== '' ||
        localCreateId.trim() !== '' ||
        localCreatePhone.trim() !== '';
      if (hasCreateText) {
        void createLocalAndDebt();
        return;
      }
      const q = localQuery.trim();
      const hit = localCustomers.find(
        c =>
          c.customer.name.includes(q) ||
          c.customer.id_number.includes(q) ||
          (c.customer.phone ?? '').includes(q),
      );
      if (hit == null) return;
      setDebtConfirm({
        kind: 'local',
        customerId: null,
        localCustomerId: hit.customer.id,
        customerName: hit.customer.name,
        customerPhoneLast4:
          hit.customer.phone != null && hit.customer.phone.length >= 4
            ? hit.customer.phone.slice(-4)
            : null,
        customerCard: null,
        offlineQr: null,
        amountMinor: Math.round(totals.total * 100),
      });
      setDebtSheet(null);
    },
  });

  return (
    <div className="pos-root">
      {/* ── الشريط العلوي ── */}
      <div className="pos-topbar">
        <div className="pos-search">
          <span className="pos-search-icon">
            <Icon name="search" size={17} />
          </span>
          <input
            ref={searchRef}
            placeholder="بحث بالاسم أو الباركود… (F6)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search !== '' && (
            <button className="pos-search-clear" onClick={() => setSearch('')}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <div className="seg" role="group" aria-label="نمط التسعير">
          <button
            className={pricingMode === 'RETAIL' ? 'on' : ''}
            onClick={() => setPricingMode('RETAIL')}
            title="تبديل مفرق/جملة (F7)">
            مفرق
          </button>
          <button
            className={pricingMode === 'WHOLESALE' ? 'on' : ''}
            onClick={() => setPricingMode('WHOLESALE')}>
            جملة
          </button>
        </div>
        <div className="seg" role="group" aria-label="شكل العرض" title="شكل عرض المنتجات">
          <button
            className={view === 'grid' ? 'on' : ''}
            onClick={() => {
              setView('grid');
              persistView('grid');
            }}
            aria-label="شبكة">
            <Icon name="layoutGrid" size={16} />
          </button>
          <button
            className={view === 'list' ? 'on' : ''}
            onClick={() => {
              setView('list');
              persistView('list');
            }}
            aria-label="قائمة">
            <Icon name="layoutList" size={16} />
          </button>
          <button
            className={view === 'cards' ? 'on' : ''}
            onClick={() => {
              setView('cards');
              persistView('cards');
            }}
            aria-label="بطاقات">
            <Icon name="layoutCards" size={16} />
          </button>
        </div>
        {settings.storeMode === 'pos' ? (
          <button
            className="btn sm success"
            onClick={() => setQuickAddOpen(true)}
            title="إضافة منتج سريع (حبة/علبة/غرام)">
            + سريع
          </button>
        ) : null}
        <span className="pos-scanhint">
          <Icon name="scan" size={15} />
          المسح العام نشط — وجّه القارئ نحو أي مكان
        </span>
      </div>

      {/* ── شريط التصنيفات ── */}
      <div className="pos-cats">
        <button
          className={`pos-cat-chip ${categoryId === 'all' ? 'on' : ''}`}
          onClick={() => setCategoryId('all')}>
          كل التصنيفات
        </button>
        {categories.map(c => (
          <button
            key={c.id}
            className={`pos-cat-chip ${categoryId === c.id ? 'on' : ''}`}
            onClick={() => setCategoryId(categoryId === c.id ? 'all' : c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="pos-body">
        {/* ── شبكة المنتجات ── */}
        <div className="pos-grid-wrap" ref={gridWrapRef}>
          {filtered.length === 0 && (
            <div className="empty">
              <span className="icon">
                <Icon name="box" size={26} />
              </span>
              <div>
                لا منتجات مطابقة — أضف منتجات من المخزون أو غيّر البحث
                والتصنيف.
              </div>
            </div>
          )}
          {view === 'list' ? (
            <div className="pos-list">
              {filtered.map(product => (
                <ProductListRow
                  key={product.id}
                  product={product}
                  price={priceOf(product)}
                  pricingMode={pricingMode}
                  onAdd={tryAdd}
                  selected={selId === product.id}
                />
              ))}
            </div>
          ) : (
            <div className={`pos-grid ${view === 'cards' ? 'cards' : ''}`}>
              {filtered.map(product => (
                <ProductTile
                  key={product.id}
                  product={product}
                  price={priceOf(product)}
                  pricingMode={pricingMode}
                  large={view === 'cards'}
                  onAdd={tryAdd}
                  selected={selId === product.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── السلة ── */}
        <aside className="pos-cart">
          <div className="pos-cart-head">
            <div className="pos-cart-title">
              <Icon name="cart" size={18} />
              <b>السلة</b>
              {totals.itemsCount > 0 && (
                <span className="chip brand sm">{totals.itemsCount} قطعة</span>
              )}
            </div>
            {lines.length > 0 && (
              <button className="btn ghost sm" onClick={() => clearCart()} title="تفريغ السلة — F1">
                <Icon name="trash" size={14} />
                تفريغ
                <span className="pos-fkey">F1</span>
              </button>
            )}
          </div>
          <div className="pos-cart-lines">
            {lines.length === 0 && (
              <div className="pos-cart-empty">
                <Icon name="cart" size={30} />
                <div>اضغط منتجاً لإضافته أو امسح باركوده…</div>
              </div>
            )}
            {lines.map(line => (
              <CartRow
                key={line.key}
                line={line}
                onInc={handleInc}
                onDec={handleDec}
                onRemove={handleRemoveLine}
              />
            ))}
          </div>
          <div className="pos-cart-math">
            <label className="pos-discount-row">
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flex: 1,
                }}>
                <Icon name="percent" size={14} /> خصم الفاتورة
                <span
                  className="sv57-seg"
                  style={{margin: 0, direction: 'ltr'}}>
                  <button
                    type="button"
                    className={discountMode === 'amount' ? 'on' : ''}
                    onClick={() => {
                      setDiscountMode('amount');
                      setDiscountPctText('');
                    }}
                    title="إدخال الخصم كمبلغ ثابت بالشيكل">
                    ₪ مبلغ
                  </button>
                  <button
                    type="button"
                    className={discountMode === 'pct' ? 'on' : ''}
                    onClick={() => {
                      setDiscountMode('pct');
                      // ابدأ النسبة من الخصم الحالي إن وُجد.
                      const pct =
                        totals.subtotal > 0
                          ? Math.round(
                              (discountInput / totals.subtotal) * 1000,
                            ) / 10
                          : 0;
                      setDiscountPctText(pct > 0 ? String(pct) : '');
                    }}
                    title="إدخال الخصم كنسبة مئوية من مجموع السلة">
                    ٪ نسبة
                  </button>
                </span>
              </span>
              {discountMode === 'amount' ? (
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discountInput === 0 ? '' : discountInput}
                  placeholder="0"
                  onChange={e =>
                    setDiscount(Math.max(0, Number(e.target.value) || 0))
                  }
                />
              ) : (
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={discountPctText}
                  placeholder="0"
                  onChange={e => {
                    const raw = e.target.value;
                    setDiscountPctText(raw);
                    const pct = Math.max(
                      0,
                      Math.min(100, Number(raw) || 0),
                    );
                    const amount =
                      Math.round(totals.subtotal * (pct / 100) * 100) / 100;
                    setDiscount(amount);
                  }
                }
                />
              )}
            </label>
            {discountMode === 'pct' &&
              discountInput > 0 &&
              totals.subtotal > 0 && (
                <div className="pos-math-row">
                  <span>
                    خصم {discountPctText || '0'}٪ ={' '}
                    {formatMoney(discountInput)}
                  </span>
                  <span>من {formatMoney(totals.subtotal)}</span>
                </div>
              )}
            <div className="pos-math-row">
              <span>المجموع قبل الخصم</span>
              <span>{formatMoney(totals.subtotal)}</span>
            </div>
            <div className="pos-math-row">
              <span>الخصم</span>
              <span>−{formatMoney(totals.safeDiscount)}</span>
            </div>
            <div className="pos-math-row total">
              <span>الإجمالي</span>
              <b>{formatMoney(totals.total)}</b>
            </div>
          </div>
          <div className="pos-cart-actions">
            <button
              className="pos-charge-btn"
              disabled={lines.length === 0 || busy}
              onClick={openPaySheet}>
              <Icon name="check" size={20} />
              إتمام البيع — F9
            </button>
            <div className="pos-pay-row">
              <button
                className="btn"
                disabled={lines.length === 0 || busy || !silaPaired}
                title={
                  silaPaired
                    ? 'بيع بالدين على حساب العميل في صِلة — F3'
                    : 'اربط صِلة أولاً من شاشة صِلة'
                }
                onClick={() => void openSilaPicker()}>
                <Icon name="link" size={15} />
                دين العميل
                <span className="pos-fkey">F3</span>
              </button>
              <button
                className="btn"
                disabled={lines.length === 0 || busy}
                title="بيع بالدين في دفتر المتجر — F2"
                onClick={() => void openLocalPicker()}>
                <Icon name="book" size={15} />
                دين المتجر
                <span className="pos-fkey">F2</span>
              </button>
              <button
                className="btn ghost"
                title="صرف قسيمة صِلة — F4"
                onClick={() => {
                  setVoucherCode('');
                  setVoucherSheet(true);
                }}>
                <Icon name="ticket" size={15} />
                قسيمة
                <span className="pos-fkey">F4</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── لوحة الدفع (نقدي + بنوك ومحافظ — v70) ── */}
      {paySheet === 'cash' && (
        <div className="overlay" onClick={() => setPaySheet(null)}>
          <div className="modal pos-pay" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>الدفع — {selectedPayMethod.label}</b>
              <button className="modal-x" onClick={() => setPaySheet(null)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="pos-pay-total">
                <span>المطلوب</span>
                <b>{formatMoney(totals.total)}</b>
              </div>

              {/* طرق الدفع المفعّلة — أسهم الكيبورد تنقل، Enter يؤكد */}
              {payMethods.length > 1 && (
                <div
                  className="pos-pay-methods"
                  role="radiogroup"
                  aria-label="طريقة الدفع">
                  {payMethods.map((method, i) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={payMethodId === method.id}
                      key={method.id}
                      className={`pos-pay-method ${
                        payMethodId === method.id ? 'sel' : ''
                      }`}
                      onClick={() => setPayMethodId(method.id)}>
                      <PaymentMethodIcon method={method} size={34} />
                      <span className="pm-name">{method.label}</span>
                      <span className="pm-kbd-hint">
                        {payMethodId === method.id
                          ? 'Enter يؤكد'
                          : i === 0
                          ? 'الأسهم للتنقل'
                          : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {payMethodId === 'cash' ? (
                <>
                  <div className="pos-amount-display" dir="ltr">
                    {amountText === '' ? '0' : amountText} ₪
                  </div>
                  <div className="pos-quickcash">
                    <button
                      className="btn sm"
                      onClick={() => setAmountText(String(totals.total))}>
                      كامل المبلغ
                    </button>
                    <button className="btn sm ghost" onClick={() => setAmountText('')}>
                      تصفير
                    </button>
                  </div>
                  <div className="pos-amount-keys">
                    {AMOUNT_KEYPAD_KEYS.map((row, i) => (
                      <React.Fragment key={i}>
                        {row.map(k => (
                          <button
                            key={k}
                            className="pos-key"
                            onClick={() => setAmountText(t => applyAmountKey(t, k))}>
                            {k}
                          </button>
                        ))}
                      </React.Fragment>
                    ))}
                  </div>
                  {amountText !== '' && (
                    <div className={`pos-change ${change < 0 ? 'neg' : ''}`}>
                      {change < 0 ? (
                        <>الباقي على الزبون: <b>{formatMoney(-change)}</b></>
                      ) : (
                        <>الباقي للزبون: <b>{formatMoney(change)}</b></>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="pos-pay-confirm">
                  <PaymentMethodIcon method={selectedPayMethod} size={46} />
                  <div className="txts">
                    <b>الدفع عبر {selectedPayMethod.label}</b>
                    <span>
                      يُسجَّل المبلغ كاملاً ({formatMoney(totals.total)}) على{' '}
                      {selectedPayMethod.kind === 'bank'
                        ? 'حسابك البنكي'
                        : 'محفظتك الإلكترونية'}{' '}
                      — تتبّعه من التقارير ← أرصدة طرق الدفع، ويُطبع على
                      الإيصال.
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setPaySheet(null)}>
                إلغاء — Esc
              </button>
              <span className="spacer" />
              {payMethodId === 'cash' && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void completeCashSale('')}>
                  بدون مبلغ (كامل)
                </button>
              )}
              <button
                className="btn primary lg"
                disabled={busy}
                onClick={() =>
                  void completeCashSale(
                    payMethodId === 'cash' ? amountText : '',
                    payMethodId,
                  )
                }>
                <Icon name="check" size={17} />
                {payMethodId === 'cash'
                  ? 'تأكيد البيع وطباعة الإيصال'
                  : `تأكيد الدفع عبر ${selectedPayMethod.label}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── اختيار متغير (ملابس/أحجام) ── */}
      {variantPick != null && (
        <VariantPicker
          product={variantPick.product}
          pricingMode={pricingMode}
          onAdd={(variant, qty, asBundle, color) => {
            if (asBundle) {
              const r = addBundleLine(variantPick.product, color, qty);
              if (!r.added && r.reason) toast(r.reason, 'error');
            } else if (variant.kind === 'size') {
              const r = addSizedLine(variantPick.product, variant, qty);
              if (!r.added && r.reason) toast(r.reason, 'error');
            } else {
              const r = addVariantLine(variantPick.product, pricingMode, variant, qty);
              if (!r.added && r.reason) toast(r.reason, 'error');
            }
            setVariantPick(null);
          }}
          onClose={() => setVariantPick(null)}
        />
      )}

      {/* ── لوحة الوزن ── */}
      {weightPick != null && (
        <div className="overlay" onClick={() => setWeightPick(null)}>
          <div className="modal pos-pay" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>{weightPick.product.name} — وزن بالكيلو</b>
              <button className="modal-x" onClick={() => setWeightPick(null)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="pos-amount-display" dir="ltr">
                {weightValue === '' ? '0' : weightValue} كغ
              </div>
              <div className="pos-quickcash">
                <button className="btn sm ghost" onClick={() => setWeightValue('')}>
                  تصفير
                </button>
              </div>
              <div className="pos-amount-keys">
                {AMOUNT_KEYPAD_KEYS.map((row, i) => (
                  <React.Fragment key={i}>
                    {row.map(k => (
                      <button
                        key={k}
                        className="pos-key"
                        onClick={() =>
                          setWeightValue(t =>
                            applyAmountKey(t, k).slice(0, WEIGHT_QTY_DECIMALS + 2),
                          )
                        }>
                        {k}
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
              {weightValue !== '' && (
                <div className="pos-change">
                  القيمة:{' '}
                  <b>
                    {formatMoney(
                      (Number(weightValue) || 0) * priceOf(weightPick.product),
                    )}
                  </b>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setWeightPick(null)}>
                إلغاء
              </button>
              <span className="spacer" />
              <button className="btn primary lg" onClick={confirmWeight}>
                <Icon name="plus" size={17} />
                إضافة للسلة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── تأكيد الدين ── */}
      {debtConfirm != null && (
        <div className="overlay" onClick={() => setDebtConfirm(null)}>
          <div className="modal pos-pay" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>
                {debtConfirm.kind === 'sila'
                  ? 'بيع بالدين — صِلة'
                  : 'بيع بالدين — دفتر المتجر'}
              </b>
              <button className="modal-x" onClick={() => setDebtConfirm(null)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="pos-debt-customer">
                <span className="pos-debt-avatar">
                  {debtConfirm.customerName.trim().charAt(0) || 'ز'}
                </span>
                <div>
                  <b>{debtConfirm.customerName}</b>
                  {debtConfirm.customerPhoneLast4 != null && (
                    <span className="pos-debt-sub">
                      هاتف ***{debtConfirm.customerPhoneLast4}
                    </span>
                  )}
                </div>
              </div>
              <div className="pos-math-row total">
                <span>قيمة الدين</span>
                <b>{formatMoney(debtConfirm.amountMinor / 100)}</b>
              </div>
              {debtConfirm.kind === 'sila' &&
                (debtConfirm.creditMinor ?? 0) > 0 && (
                  <div className="pos-note">
                    <Icon name="info" size={15} />
                    رصيد مسبق في صِلة يغطي{' '}
                    {formatMoney(
                      Math.min(debtConfirm.creditMinor ?? 0, debtConfirm.amountMinor) / 100,
                    )}{' '}
                    — سيُخصم تلقائياً عند الرفع.
                  </div>
                )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDebtConfirm(null)}>
                إلغاء
              </button>
              <span className="spacer" />
              <button
                className="btn primary lg"
                disabled={busy}
                onClick={() => void completeDebtSale(debtConfirm)}>
                <Icon name="check" size={17} />
                تأكيد الدين وطباعة الإيصال
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── اختيار زبون صِلة ── */}
      {debtSheet === 'sila' && (
        <div className="overlay" onClick={() => setDebtSheet(null)}>
          <div className="modal pos-picker" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>اختر زبون صِلة</b>
              <button className="modal-x" onClick={() => setDebtSheet(null)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="pos-search">
                <span className="pos-search-icon">
                  <Icon name="search" size={16} />
                </span>
                <input
                  placeholder="بحث بالاسم…"
                  value={silaQuery}
                  onChange={e => setSilaQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="pos-picker-list">
                {silaCustomers
                  .filter(c => c.name.includes(silaQuery.trim()))
                  .map(customer => (
                    <button
                      key={customer.customer_id}
                      className="pos-picker-row"
                      onClick={() => {
                        setDebtConfirm({
                          kind: 'sila',
                          customerId: customer.customer_id,
                          customerName: customer.name,
                          customerPhoneLast4: customer.phone_last4,
                          customerCard: null,
                          offlineQr: null,
                          amountMinor: Math.round(totals.total * 100),
                          creditMinor: customer.credit_minor,
                        });
                        setDebtSheet(null);
                      }}>
                      <span className="pos-picker-name">
                        <b>{customer.name}</b>
                        {customer.phone_last4 != null && (
                          <span className="pos-picker-sub">
                            هاتف ***{customer.phone_last4}
                          </span>
                        )}
                      </span>
                      <span className="pos-picker-side">
                        {customer.credit_minor > 0 && (
                          <span className="chip ok">
                            رصيد {formatMoney(customer.credit_minor / 100)}
                          </span>
                        )}
                        <span className="chip">
                          دين {formatMoney(customer.outstanding_minor / 100)}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDebtSheet(null)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── اختيار زبون دفتر المتجر (+ إنشاء سريع بجوال) ── */}
      {debtSheet === 'local' && (
        <div className="overlay" onClick={() => setDebtSheet(null)}>
          <div className="modal pos-picker" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <b>اختر زبون دفتر المتجر</b>
                <div className="sub">أو أنشئ زبوناً جديداً بالأسفل</div>
              </div>
              <button className="modal-x" onClick={() => setDebtSheet(null)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="pos-search">
                <span className="pos-search-icon">
                  <Icon name="search" size={16} />
                </span>
                <input
                  placeholder="بحث بالاسم أو رقم الهوية…"
                  value={localQuery}
                  onChange={e => setLocalQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="pos-picker-list">
                {localCustomers
                  .filter(
                    c =>
                      c.customer.name.includes(localQuery.trim()) ||
                      c.customer.id_number.includes(localQuery.trim()) ||
                      (c.customer.phone ?? '').includes(localQuery.trim()),
                  )
                  .map(customer => (
                    <button
                      key={customer.customer.id}
                      className="pos-picker-row"
                      onClick={() => {
                        setDebtConfirm({
                          kind: 'local',
                          customerId: null,
                          localCustomerId: customer.customer.id,
                          customerName: customer.customer.name,
                          customerPhoneLast4:
                            customer.customer.phone != null &&
                            customer.customer.phone.length >= 4
                              ? customer.customer.phone.slice(-4)
                              : null,
                          customerCard: null,
                          offlineQr: null,
                          amountMinor: Math.round(totals.total * 100),
                        });
                        setDebtSheet(null);
                      }}>
                      <span className="pos-picker-name">
                        <b>{customer.customer.name}</b>
                        <span className="pos-picker-sub" dir="ltr">
                          {customer.customer.id_number}
                          {customer.customer.phone != null &&
                            ` · ${customer.customer.phone}`}
                        </span>
                      </span>
                      <span className="pos-picker-side">
                        <span className="chip danger">
                          قائم {formatMoney(customer.outstandingMinor / 100)}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
              <div className="pos-local-create">
                <div className="pos-local-create-title">
                  <Icon name="user" size={16} />
                  زبون جديد
                </div>
                <div className="pos-local-create-grid">
                  <input
                    placeholder="الاسم الكامل"
                    value={localCreateName}
                    onChange={e => setLocalCreateName(e.target.value)}
                  />
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={9}
                    placeholder="رقم الهوية (9 خانات)"
                    value={localCreateId}
                    onChange={e => setLocalCreateId(e.target.value)}
                  />
                  <input
                    dir="ltr"
                    inputMode="tel"
                    maxLength={10}
                    placeholder="الجوال 056/059 (اختياري)"
                    value={localCreatePhone}
                    onChange={e => setLocalCreatePhone(e.target.value)}
                  />
                  <button
                    className="btn primary"
                    onClick={() => void createLocalAndDebt()}>
                    <Icon name="plus" size={15} />
                    إنشاء وتسجيل الدين
                  </button>
                </div>
                {localCreateError != null && (
                  <div className="pos-create-error">{localCreateError}</div>
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDebtSheet(null)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── صرف قسيمة ── */}
      {voucherSheet && (
        <div className="overlay" onClick={() => setVoucherSheet(false)}>
          <div className="modal pos-pay" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <b>صرف قسيمة حملة</b>
              <button className="modal-x" onClick={() => setVoucherSheet(false)}>
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="modal-body">
              <div className="pos-note">
                <Icon name="info" size={15} />
                امسح رمز القسيمة بالقارئ (سيُلتقط تلقائياً) أو الصقه هنا.
                القسيمة تغطي قيمة السلة والفرق يُحسب نقداً.
              </div>
              <input
                className="pos-voucher-input"
                dir="ltr"
                placeholder="SILAV1-… أو رمز QR كامل"
                value={voucherCode}
                onChange={e => setVoucherCode(e.target.value)}
                autoFocus
              />
              <div className="pos-math-row total">
                <span>قيمة السلة الحالية</span>
                <b>{formatMoney(totals.total)}</b>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setVoucherSheet(false)}>
                إلغاء
              </button>
              <span className="spacer" />
              <button
                className="btn primary lg"
                disabled={busy}
                onClick={() => void redeemVoucherOnCart()}>
                <Icon name="ticket" size={16} />
                صرف القسيمة على السلة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v58 (الجولة 62): نافذة الإضافة السريعة لمود نقطة البيع. */}
      <QuickProductSheet
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      />
    </div>
  );
}

// ──────────────────────────────────────────────── صورة منتج

/** صورة المنتج عبر بروتوكول asset — أو حرف أول أنيق عند غيابها.
 *  v59: memo — لا تُعاد رسمها مع كل ضغطة في البحث أو السلة. */
const ProductImage = React.memo(function ProductImage({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage =
    product.image_uri != null &&
    product.image_uri.length > 0 &&
    !failed;
  if (!showImage) {
    return (
      <span className={`${className ?? ''} pos-img-fallback`}>
        {product.name.trim().charAt(0) || '؟'}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={assetSrc(product.image_uri as string)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
});

// ──────────────────────────────────────────────── بلاطة منتج

/** بلاطة منتج — v59: memo + onAdd يستقبل المنتج (رد نداء ثابت من
 *  الأب) فلا تُعاد رسم مئات البلاطات مع كل كتابة في الخصم أو السلة. */
const ProductTile = React.memo(function ProductTile({
  product,
  price,
  pricingMode,
  large,
  onAdd,
  selected,
}: {
  product: Product;
  price: number;
  pricingMode: 'RETAIL' | 'WHOLESALE';
  large: boolean;
  onAdd: (product: Product) => void;
  selected?: boolean;
}) {
  const hasDiscount = product.discount_pct > 0;
  const out =
    product.stock_untracked !== 1 && product.stock_quantity <= 0;
  return (
    <button
      className={`pos-tile ${out ? 'out' : ''} ${large ? 'large' : ''} ${selected ? 'kbsel' : ''}`}
      data-kbsel={selected ? 'true' : undefined}
      onClick={() => onAdd(product)}>
      <span className="pos-tile-img">
        <ProductImage product={product} />
        {hasDiscount && (
          <span className="pos-tile-ribbon">خصم {product.discount_pct}%</span>
        )}
        {product.stock_untracked === 1 ? (
          <span className="pos-tile-stock">بلا تتبع</span>
        ) : (
          <span className={`pos-tile-stock ${out ? 'neg' : product.stock_quantity <= 5 ? 'low' : ''}`}>
            {out ? 'نفد' : `متوفر ${product.stock_quantity}`}
          </span>
        )}
      </span>
      <span className="pos-tile-name">{product.name}</span>
      <span className="pos-tile-foot">
        {product.has_variants === 1 && (
          <span className="chip brand sm">متغيرات</span>
        )}
        {product.sold_by_weight === 1 && (
          <span className="chip muted sm">وزن/كغ</span>
        )}
        <span className="pos-tile-prices">
          {hasDiscount && (
            <s className="pos-old-price">
              {formatMoney(
                pricingMode === 'WHOLESALE'
                  ? product.wholesale_price
                  : product.retail_price,
              )}
            </s>
          )}
          <b className="pos-price">{formatMoney(price)}</b>
        </span>
      </span>
    </button>
  );
});

// ──────────────────────────────────────────────── صف قائمة

/** صف القائمة — v59: memo بنفس نمط البلاطة. */
const ProductListRow = React.memo(function ProductListRow({
  product,
  price,
  pricingMode,
  onAdd,
  selected,
}: {
  product: Product;
  price: number;
  pricingMode: 'RETAIL' | 'WHOLESALE';
  onAdd: (product: Product) => void;
  selected?: boolean;
}) {
  const hasDiscount = product.discount_pct > 0;
  const out =
    product.stock_untracked !== 1 && product.stock_quantity <= 0;
  return (
    <button
      className={`pos-lrow ${out ? 'out' : ''} ${selected ? 'kbsel' : ''}`}
      data-kbsel={selected ? 'true' : undefined}
      onClick={() => onAdd(product)}>
      <span className="pos-lrow-img">
        <ProductImage product={product} />
      </span>
      <span className="pos-lrow-name">
        {product.name}
        <span className="pos-lrow-tags">
          {product.has_variants === 1 && (
            <span className="chip brand sm">متغيرات</span>
          )}
          {product.sold_by_weight === 1 && (
            <span className="chip muted sm">وزن/كغ</span>
          )}
          {hasDiscount && (
            <span className="chip warn sm">خصم {product.discount_pct}%</span>
          )}
        </span>
      </span>
      <span className="pos-lrow-prices">
        {hasDiscount && (
          <s className="pos-old-price">
            {formatMoney(
              pricingMode === 'WHOLESALE'
                ? product.wholesale_price
                : product.retail_price,
            )}
          </s>
        )}
        <b className="pos-price">{formatMoney(price)}</b>
      </span>
      <span className={`pos-lrow-stock ${out ? 'neg' : ''}`}>
        {product.stock_untracked === 1
          ? 'بلا تتبع'
          : out
          ? 'نفد'
          : `${product.stock_quantity}`}
      </span>
      <span className="pos-lrow-add">
        <Icon name="plus" size={16} />
      </span>
    </button>
  );
});

// ──────────────────────────────────────────────── صف سلة

/** صف السلة — v59: memo + أزرار تستقبل مفتاح السطر (رد نداء ثابت). */
const CartRow = React.memo(function CartRow({
  line,
  onInc,
  onDec,
  onRemove,
}: {
  line: CartLine;
  onInc: (key: string) => void;
  onDec: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="pos-line">
      <div className="pos-line-main">
        <div className="pos-line-name">
          <b>{line.name}</b>
          {line.variantLabel != null && line.variantLabel !== '' && (
            <span className="chip muted sm">{line.variantLabel}</span>
          )}
          {line.bundleColor != null && (
            <span className="chip muted sm">ربطة {line.bundleColor}</span>
          )}
        </div>
        <div className="pos-line-math" dir="ltr">
          {line.quantity} × {formatMoney(line.unitPrice)} ={' '}
          <b>{formatMoney(line.unitPrice * line.quantity)}</b>
        </div>
      </div>
      <div className="pos-line-side">
        <div className="pos-stepper">
          <button onClick={() => onDec(line.key)} aria-label="إنقاص">
            <Icon name="minus" size={14} />
          </button>
          <b className="pos-line-qty" dir="ltr">{line.quantity}</b>
          <button onClick={() => onInc(line.key)} aria-label="زيادة">
            <Icon name="plus" size={14} />
          </button>
        </div>
        <button
          className="pos-line-remove"
          onClick={() => onRemove(line.key)}
          aria-label="حذف">
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
});

// ──────────────────────────────────────────────── اختيار المتغيرات

function VariantPicker({
  product,
  pricingMode,
  onAdd,
  onClose,
}: {
  product: Product;
  pricingMode: 'RETAIL' | 'WHOLESALE';
  onAdd: (
    variant: ProductVariant,
    quantity: number,
    asBundle: boolean,
    bundleColor: string,
  ) => void;
  onClose: () => void;
}) {
  const variants = product.variants ?? [];
  const isClothing = variants.some(v => v.kind === 'variant');
  const colors = useMemo(
    () => [...new Set(variants.filter(v => v.kind === 'variant').map(v => v.color))],
    [variants],
  );
  const [color, setColor] = useState<string>(colors[0] ?? '');
  const [qty, setQty] = useState('1');
  const [bundleMode, setBundleMode] = useState(false);

  const sizesOfColor = variants.filter(
    v => v.kind === 'variant' && v.color === color,
  );
  const sizeVariants = variants.filter(v => v.kind === 'size');
  const quantity = Math.max(1, Number(qty) || 1);

  const priceFor = (v: ProductVariant): number => {
    if (v.retail_price != null) return v.retail_price;
    return pricingMode === 'WHOLESALE'
      ? product.wholesale_price
      : product.retail_price;
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal pos-variant" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <b>{product.name}</b>
          <button className="modal-x" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="modal-body">
          {isClothing ? (
            <>
              <div className="pos-variant-label">اللون</div>
              <div className="pos-variant-colors">
                {colors.map(c => (
                  <button
                    key={c}
                    className={`pos-color-chip ${c === color ? 'on' : ''}`}
                    onClick={() => setColor(c)}>
                    {c === '' ? 'بدون لون' : c}
                  </button>
                ))}
              </div>
              <div className="pos-variant-label">المقاس</div>
              <div className="pos-variant-sizes">
                {sizesOfColor.map(v => (
                  <button
                    key={v.id}
                    className="pos-variant-size"
                    onClick={() => onAdd(v, quantity, false, color)}>
                    <b>{v.size === '' ? 'قياس واحد' : v.size}</b>
                    <span>مخزون {v.stock_quantity}</span>
                  </button>
                ))}
              </div>
              <label className="pos-bundle-toggle">
                <input
                  type="checkbox"
                  checked={bundleMode}
                  onChange={e => setBundleMode(e.target.checked)}
                />
                ربطة جملة — قطعة من كل مقاس بلون {color === '' ? '—' : color}
              </label>
              {bundleMode && (
                <div className="pos-bundle-row">
                  <span>عدد الربط:</span>
                  <input
                    type="number"
                    min="1"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                  />
                  <button
                    className="btn primary sm"
                    onClick={() => onAdd(sizesOfColor[0], quantity, true, color)}>
                    <Icon name="plus" size={14} />
                    إضافة الربطة
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="pos-variant-sizes">
              {sizeVariants.map(v => (
                <button
                  key={v.id}
                  className="pos-variant-size"
                  onClick={() => onAdd(v, quantity, false, '')}>
                  <b>{v.size}</b>
                  <span>{formatMoney(priceFor(v))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
