/**
 * PosScreen.tsx — نقطة البيع v57 (منقولة من PosScreen الأندرويد):
 * شبكة المنتجات بالخصومات + متغيرات الملابس/الأحجام + منتجات الوزن
 * + خصم الفاتورة + سلة حية + بيع نقدي/دين صِلة/دين المتجر + صرف
 * القسائم على السلة + لوحة مبلغ داخلية + مسح باركود عام (منتج أو
 * رمز صِلة) + طباعة إيصال بعد البيع + فتح الدرج.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  useCartStore,
  cartTotals,
  applyProductDiscount,
  unitPriceFor,
} from '../stores/cartStore';
import {useCatalogStore, useToastStore} from '../state/appStores';
import {useSettingsStore} from '../stores/settingsStore';
import {InvoiceService} from '../services/InvoiceService';
import {ProductRepo} from '../database/repositories/ProductRepo';
import {
  LocalDebtsRepo,
  isValidIdNumber,
} from '../database/repositories/LocalDebtsRepo';
import {SilaRepo} from '../services/sila/SilaRepo';
import {parseSilaQr} from '../services/sila/qr';
import {useSilaStore} from '../stores/silaStore';
import {
  VoucherService,
  VoucherRedeemError,
} from '../services/VoucherService';
import {VouchersRepo} from '../services/sila/VouchersRepo';
import {ThermalPrinterService} from '../services/printer/ThermalPrinterService';
import {usePrinterStore} from '../stores/printerStore';
import {setActiveBarcodeHandler, beep} from '../lib/scanner';
import {
  formatMoney,
  localToday,
} from '../core/format';
import {
  QUICK_WEIGHTS,
  WEIGHT_QTY_DECIMALS,
} from '../core/config';
import {applyAmountKey, AMOUNT_KEYPAD_KEYS} from '../core/amountKeypad';
import type {
  CartLine,
  Product,
  ProductVariant,
  SilaCustomer,
  LocalCustomerBalance,
} from '../core/types';
import './pos.css';

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
  const [categoryId, setCategoryId] = useState<number | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [variantPick, setVariantPick] = useState<VariantPickState | null>(null);
  const [weightPick, setWeightPick] = useState<WeightPickState | null>(null);
  const [weightValue, setWeightValue] = useState('');
  const [bundleColor, setBundleColor] = useState<string | null>(null);
  const [bundleCount, setBundleCount] = useState('1');
  const [paySheet, setPaySheet] = useState<PayKind | null>(null);
  const [amountText, setAmountText] = useState('');
  const [debtConfirm, setDebtConfirm] = useState<DebtConfirmState | null>(null);
  const [debtSheet, setDebtSheet] = useState<'sila' | 'local' | null>(null);
  const [silaCustomers, setSilaCustomers] = useState<SilaCustomer[]>([]);
  const [silaQuery, setSilaQuery] = useState('');
  const [localCustomers, setLocalCustomers] = useState<LocalCustomerBalance[]>([]);
  const [localQuery, setLocalQuery] = useState('');
  const [localCreateName, setLocalCreateName] = useState('');
  const [localCreateId, setLocalCreateId] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherSheet, setVoucherSheet] = useState(false);
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

  // ── اختصارات لوحة المفاتيح (§3.1) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F3') {
        e.preventDefault();
        setPricingMode(pricingMode === 'RETAIL' ? 'WHOLESALE' : 'RETAIL');
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (lines.length > 0 && !busy) setPaySheet('cash');
      } else if (e.key === 'Escape') {
        setPaySheet(null);
        setDebtConfirm(null);
        setVariantPick(null);
        setWeightPick(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pricingMode, setPricingMode, lines.length, busy]);

  // ── بيع نقدي ──
  const completeCashSale = useCallback(
    async (paidText: string) => {
      if (lines.length === 0) return;
      const paid = paidText === '' ? totals.total : Number(paidText);
      if (!Number.isFinite(paid)) {
        toast('المبلغ المدفوع غير صالح', 'error');
        return;
      }
      if (paid + 0.001 < totals.total) {
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
          print: printerStatus === 'connected',
          receiptSettings: receiptSettings(),
          onPrintError: m => toast(`تم حفظ البيع لكن الطباعة فشلت: ${m}`, 'error'),
          productNames: new Map(lines.map(l => [l.productId, l.name])),
        });
        if (paid > totals.total) {
          toast(`الباقي للزبون: ${formatMoney(paid - totals.total)}`, 'success', 5000);
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
      setLocalCustomers(list);
      setDebtSheet('local');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }, [toast]);

  const createLocalAndDebt = useCallback(async () => {
    const name = localCreateName.trim();
    const idNumber = localCreateId.trim();
    if (name.length < 2) {
      toast('اكتب اسم الزبون', 'error');
      return;
    }
    if (!idNumber) {
      toast('اكتب رقم هوية الزبون', 'error');
      return;
    }
    if (!isValidIdNumber(idNumber)) {
      toast('رقم الهوية غير صالح (9 خانات مع خانة تحقق)', 'error');
      return;
    }
    try {
      const customer = await LocalDebtsRepo.createCustomer({
        name,
        idNumber,
        phone: null,
        notes: 'أُنشئ أثناء البيع بالدين',
      });
      setDebtConfirm({
        kind: 'local',
        customerId: null,
        localCustomerId: customer.id,
        customerName: customer.name,
        customerPhoneLast4: null,
        customerCard: null,
        offlineQr: null,
        amountMinor: Math.round(totals.total * 100),
      });
      setDebtSheet(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }, [localCreateName, localCreateId, toast, totals.total]);

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

  return (
    <div className="pos-root">
      {/* ── الشريط العلوي ── */}
      <div className="pos-topbar">
        <input
          ref={searchRef}
          className="pos-search"
          placeholder="بحث بالاسم أو الباركود… (F2)"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="chip-toggle">
          <button
            className={pricingMode === 'RETAIL' ? 'on' : ''}
            onClick={() => setPricingMode('RETAIL')}>
            مفرق (F3)
          </button>
          <button
            className={pricingMode === 'WHOLESALE' ? 'on' : ''}
            onClick={() => setPricingMode('WHOLESALE')}>
            جملة
          </button>
        </div>
        <select
          className="pos-category"
          value={String(categoryId)}
          onChange={e =>
            setCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }>
          <option value="all">كل التصنيفات</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="pos-scanhint">المسح العام نشط — وجّه القارئ نحو أي مكان</span>
      </div>

      <div className="pos-body">
        {/* ── شبكة المنتجات ── */}
        <div className="pos-grid-wrap">
          {filtered.length === 0 && (
            <div className="empty">لا منتجات مطابقة — أضف منتجات من المخزون.</div>
          )}
          <div className="pos-grid">
            {filtered.map(product => {
              const price = priceOf(product);
              const hasDiscount = product.discount_pct > 0;
              const out =
                product.stock_untracked !== 1 && product.stock_quantity <= 0;
              return (
                <button
                  key={product.id}
                  className={`pos-tile ${out ? 'out' : ''}`}
                  onClick={() => tryAdd(product)}>
                  <div className="pos-tile-name">{product.name}</div>
                  {product.has_variants === 1 && (
                    <span className="chip brand">متغيرات</span>
                  )}
                  {product.sold_by_weight === 1 && (
                    <span className="chip">وزن/كغ</span>
                  )}
                  {hasDiscount && (
                    <span className="chip warn">خصم {product.discount_pct}%</span>
                  )}
                  <div className="pos-tile-prices">
                    {hasDiscount && (
                      <span className="pos-old-price">
                        {formatMoney(
                          pricingMode === 'WHOLESALE'
                            ? product.wholesale_price
                            : product.retail_price,
                        )}
                      </span>
                    )}
                    <span className="pos-price">{formatMoney(price)}</span>
                  </div>
                  <div className="pos-tile-stock">
                    {product.stock_untracked === 1
                      ? 'بلا تتبع'
                      : out
                      ? 'نفد'
                      : `متوفر ${product.stock_quantity}`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── السلة ── */}
        <aside className="pos-cart">
          <div className="pos-cart-head">
            <b>السلة ({totals.itemsCount})</b>
            <button className="btn ghost sm" onClick={() => clearCart()}>
              تفريغ
            </button>
          </div>
          <div className="pos-cart-lines">
            {lines.length === 0 && (
              <div className="empty">اسحب منتجاً أو امسح باركوده…</div>
            )}
            {lines.map(line => (
              <CartRow
                key={line.key}
                line={line}
                onInc={() => {
                  const r = increment(line.key);
                  if (!r.ok && r.reason) toast(r.reason, 'error');
                }}
                onDec={() => decrement(line.key)}
                onRemove={() => removeLine(line.key)}
              />
            ))}
          </div>
          <div className="pos-cart-math">
            <label className="pos-discount-row">
              <span>خصم الفاتورة (₪)</span>
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
            </label>
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
              className="btn primary big"
              disabled={lines.length === 0 || busy}
              onClick={() => setPaySheet('cash')}>
              إتمام البيع — F9
            </button>
            <div className="pos-pay-row">
              <button
                className="btn"
                disabled={lines.length === 0 || busy || !silaPaired}
                title={silaPaired ? '' : 'اربط صِلة أولاً من شاشة صِلة'}
                onClick={() => void openSilaPicker()}>
                دين صِلة
              </button>
              <button
                className="btn"
                disabled={lines.length === 0 || busy}
                onClick={() => void openLocalPicker()}>
                دين المتجر
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setVoucherCode('');
                  setVoucherSheet(true);
                }}>
                قسيمة
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── لوحة الدفع النقدي ── */}
      {paySheet === 'cash' && (
        <div className="overlay" onClick={() => setPaySheet(null)}>
          <div className="modal pos-pay" onClick={e => e.stopPropagation()}>
            <h3>الدفع نقدي</h3>
            <div className="pos-pay-total">{formatMoney(totals.total)}</div>
            <div className="pos-amount-display" dir="ltr">
              {amountText === '' ? '0' : amountText} ₪
            </div>
            <div className="pos-amount-keys">
              {AMOUNT_KEYPAD_KEYS.map((row, i) => (
                <React.Fragment key={i}>
                  {row.map(k => (
                    <button
                      key={k}
                      className="pin-key"
                      onClick={() => setAmountText(t => applyAmountKey(t, k))}>
                      {k}
                    </button>
                  ))}
                </React.Fragment>
              ))}
            </div>
            {amountText !== '' && (
              <div className="pos-change">
                الباقي: <b>{formatMoney(change)}</b>
              </div>
            )}
            <div className="pos-pay-buttons">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void completeCashSale(amountText)}>
                تأكيد البيع وطباعة الإيصال
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => void completeCashSale('')}>
                بدون مبلغ (كامل)
              </button>
              <button className="btn ghost" onClick={() => setPaySheet(null)}>
                إلغاء
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
            setBundleColor(null);
            setBundleCount('1');
          }}
          onClose={() => setVariantPick(null)}
        />
      )}

      {/* ── لوحة الوزن ── */}
      {weightPick != null && (
        <div className="overlay" onClick={() => setWeightPick(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{weightPick.product.name} — وزن بالكيلو</h3>
            <div className="pos-amount-display" dir="ltr">
              {weightValue === '' ? '0' : weightValue} كغ
            </div>
            <div className="pos-amount-keys">
              {AMOUNT_KEYPAD_KEYS.map((row, i) => (
                <React.Fragment key={i}>
                  {row.map(k => (
                    <button
                      key={k}
                      className="pin-key"
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
            <div className="pos-quickweights">
              {QUICK_WEIGHTS.map(w => (
                <button
                  key={w.kg}
                  className="btn sm"
                  onClick={() => setWeightValue(String(w.kg))}>
                  {w.label}
                </button>
              ))}
            </div>
            <div className="pos-pay-buttons">
              <button
                className="btn primary"
                onClick={() => {
                  const qty = Number(weightValue);
                  if (!Number.isFinite(qty) || qty <= 0) {
                    toast('أدخل وزناً صحيحاً', 'error');
                    return;
                  }
                  const r = addWeighted(weightPick.product, pricingMode, qty);
                  if (r.added) beep('ok');
                  else if (r.reason) toast(r.reason, 'error');
                  setWeightPick(null);
                }}>
                إضافة للسلة
              </button>
              <button className="btn ghost" onClick={() => setWeightPick(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── تأكيد الدين ── */}
      {debtConfirm != null && (
        <div className="overlay" onClick={() => setDebtConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>
              {debtConfirm.kind === 'sila' ? 'بيع بالدين — صِلة' : 'بيع بالدين — دفتر المتجر'}
            </h3>
            <div className="pos-debt-customer">
              <b>{debtConfirm.customerName}</b>
              {debtConfirm.customerPhoneLast4 != null && (
                <span> · هاتف ***{debtConfirm.customerPhoneLast4}</span>
              )}
            </div>
            <div className="pos-math-row total">
              <span>قيمة الدين</span>
              <b>{formatMoney(debtConfirm.amountMinor / 100)}</b>
            </div>
            {debtConfirm.kind === 'sila' &&
              (debtConfirm.creditMinor ?? 0) > 0 && (
                <div className="dc-hint">
                  رصيد مسبق في صِلة يغطي {formatMoney(Math.min(debtConfirm.creditMinor ?? 0, debtConfirm.amountMinor) / 100)} — سيُخصم تلقائياً عند الرفع.
                </div>
              )}
            <div className="pos-pay-buttons">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void completeDebtSale(debtConfirm)}>
                تأكيد الدين وطباعة الإيصال
              </button>
              <button className="btn ghost" onClick={() => setDebtConfirm(null)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── اختيار زبون صِلة ── */}
      {debtSheet === 'sila' && (
        <div className="overlay" onClick={() => setDebtSheet(null)}>
          <div className="modal pos-picker" onClick={e => e.stopPropagation()}>
            <h3>اختر زبون صِلة</h3>
            <input
              className="field"
              placeholder="بحث بالاسم…"
              value={silaQuery}
              onChange={e => setSilaQuery(e.target.value)}
            />
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
                    <span>
                      <b>{customer.name}</b>
                      {customer.phone_last4 != null && (
                        <span> · ***{customer.phone_last4}</span>
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
            <button className="btn ghost sm" onClick={() => setDebtSheet(null)}>
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* ── اختيار زبون دفتر المتجر (+ إنشاء سريع) ── */}
      {debtSheet === 'local' && (
        <div className="overlay" onClick={() => setDebtSheet(null)}>
          <div className="modal pos-picker" onClick={e => e.stopPropagation()}>
            <h3>اختر زبون دفتر المتجر</h3>
            <input
              className="field"
              placeholder="بحث بالاسم أو الهوية…"
              value={localQuery}
              onChange={e => setLocalQuery(e.target.value)}
            />
            <div className="pos-picker-list">
              {localCustomers
                .filter(
                  c =>
                    c.customer.name.includes(localQuery.trim()) ||
                    c.customer.id_number.includes(localQuery.trim()),
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
                    <span>
                      <b>{customer.customer.name}</b>
                      <span dir="ltr"> · {customer.customer.id_number}</span>
                    </span>
                    <span className="chip danger">
                      قائم {formatMoney(customer.outstandingMinor / 100)}
                    </span>
                  </button>
                ))}
            </div>
            <div className="pos-local-create">
              <b>زبون جديد</b>
              <input
                className="field"
                placeholder="الاسم"
                value={localCreateName}
                onChange={e => setLocalCreateName(e.target.value)}
              />
              <input
                className="field"
                dir="ltr"
                placeholder="رقم الهوية (9 خانات)"
                value={localCreateId}
                onChange={e => setLocalCreateId(e.target.value)}
              />
              <button className="btn sm" onClick={() => void createLocalAndDebt()}>
                إنشاء وتسجيل الدين
              </button>
            </div>
            <button className="btn ghost sm" onClick={() => setDebtSheet(null)}>
              إغلاق
            </button>
          </div>
        </div>
      )}

      {/* ── صرف قسيمة ── */}
      {voucherSheet && (
        <div className="overlay" onClick={() => setVoucherSheet(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>صرف قسيمة حملة</h3>
            <div className="dc-hint">
              امسح رمز القسيمة بالقارئ (سيُلتقط تلقائياً) أو الصقه هنا. القسيمة
              تغطي قيمة السلة والفرق يُحسب نقداً.
            </div>
            <input
              className="field"
              dir="ltr"
              placeholder="SILAV1-… أو رمز QR كامل"
              value={voucherCode}
              onChange={e => setVoucherCode(e.target.value)}
            />
            <div className="pos-math-row total">
              <span>قيمة السلة الحالية</span>
              <b>{formatMoney(totals.total)}</b>
            </div>
            <div className="pos-pay-buttons">
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void redeemVoucherOnCart()}>
                صرف القسيمة على السلة
              </button>
              <button className="btn ghost" onClick={() => setVoucherSheet(false)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────── صف سلة

function CartRow({
  line,
  onInc,
  onDec,
  onRemove,
}: {
  line: CartLine;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="pos-line">
      <div className="pos-line-main">
        <div className="pos-line-name">
          {line.name}
          {line.variantLabel != null && line.variantLabel !== '' && (
            <span className="chip sm"> {line.variantLabel} </span>
          )}
          {line.bundleColor != null && (
            <span className="chip sm"> ربطة {line.bundleColor} </span>
          )}
        </div>
        <div className="pos-line-math" dir="ltr">
          {line.quantity} × {formatMoney(line.unitPrice)} ={' '}
          <b>{formatMoney(line.unitPrice * line.quantity)}</b>
        </div>
      </div>
      <div className="pos-line-ctrl">
        <button className="btn sm" onClick={onInc}>+</button>
        <button className="btn sm" onClick={onDec}>−</button>
        <button className="btn sm danger-ghost" onClick={onRemove}>حذف</button>
      </div>
    </div>
  );
}

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
        <h3>{product.name}</h3>
        {isClothing ? (
          <>
            <div className="pos-variant-colors">
              {colors.map(c => (
                <button
                  key={c}
                  className={`chip-toggle-btn ${c === color ? 'on' : ''}`}
                  onClick={() => setColor(c)}>
                  {c === '' ? 'بدون لون' : c}
                </button>
              ))}
            </div>
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
            <div className="pos-bundle">
              <label>
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
                    className="field"
                    type="number"
                    min="1"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                  />
                  <button
                    className="btn primary sm"
                    onClick={() => onAdd(sizesOfColor[0], quantity, true, color)}>
                    إضافة الربطة
                  </button>
                </div>
              )}
            </div>
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
        <button className="btn ghost sm" style={{marginTop: 10}} onClick={onClose}>
          إلغاء
        </button>
      </div>
    </div>
  );
}
