/**
 * PosScreen.tsx — كاشير نقطة البيع (المهمة §3.1):
 *  • شبكة المنتجات/يسار + السلة والملخص/يمين — عرض أفقي عريض.
 *  • البحث الفوري + مسح الباركود العام (بلا تركيز أي حقل).
 *  • وضع التسعير مفرق/جملة يعيد تسعير كل السطور فوراً (نفس الأندرويد).
 *  • خصم مطلق مطبّق على الفاتورة (يقيد بالإجمالي — نفس القاعدة).
 *  • F9 إتمام البيع → معاملة ذرّية واحدة في النواة → طباعة الإيصال
 *    الحراري صامتاً + نبضة درج النقدية إن فُعّلت.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useCartStore, cartTotals} from '../state/cartStore';
import {
  useCatalogStore,
  useToastStore,
  useNotificationsStore,
} from '../state/appStores';
import {useSettingsStore} from '../state/settingsStore';
import {api} from '../lib/tauri';
import {beep, setActiveBarcodeHandler} from '../lib/scanner';
import {formatMoney, parseNumber} from '../core/format';
import {buildReceiptJob} from '../printing/receipt';
import {printJob, kickDrawerIfEnabled} from '../printing/dispatch';
import type {CartLine, PricingMode, Product, ProductUnit} from '../core/types';
import {ProductFormModal} from './ProductFormModal';

export function PosScreen() {
  const lines = useCartStore(s => s.lines);
  const pricingMode = useCartStore(s => s.pricingMode);
  const discount = useCartStore(s => s.discount);
  const addProduct = useCartStore(s => s.addProduct);
  const increment = useCartStore(s => s.increment);
  const decrement = useCartStore(s => s.decrement);
  const removeLine = useCartStore(s => s.removeLine);
  const setQuantity = useCartStore(s => s.setQuantity);
  const setDiscount = useCartStore(s => s.setDiscount);
  const setPricingMode = useCartStore(s => s.setPricingMode);
  const clear = useCartStore(s => s.clear);

  const products = useCatalogStore(s => s.products);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const settings = useSettingsStore(s => s.settings);
  const toast = useToastStore(s => s.show);
  const notify = useNotificationsStore(s => s.push);

  const [search, setSearch] = useState('');
  const [discountText, setDiscountText] = useState('');
  const [busy, setBusy] = useState(false);
  const [formBarcode, setFormBarcode] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(() => cartTotals(lines, discount), [lines, discount]);

  const visible = useMemo(() => {
    const q = search.trim();
    if (!q) return products;
    return products.filter(p => p.name.includes(q) || p.barcode === q);
  }, [products, search]);

  /** إضافة منتج من الشبكة (بوحدته الأساس أو وحدة مختارة سابقاً). */
  const addToCart = useCallback(
    (product: Product, unit: ProductUnit | null) => {
      if (product.stock_quantity <= 0) {
        toast(`نفد مخزون ${product.name}`, 'error');
        return;
      }
      const result = addProduct(product, pricingMode, unit);
      if (result.added) {
        beep('ok');
      } else if (result.reason) {
        toast(result.reason, 'error');
      }
    },
    [addProduct, pricingMode, toast],
  );

  /** مسح باركود → بحث منتج → وحدة → عرض إضافة منتج جديد (نفس PosScreen الأندرويد). */
  const handleBarcode = useCallback(
    async (code: string) => {
      try {
        const hit = await api.findBarcode(code);
        if (hit.kind === 'product' && hit.product) {
          addToCart(hit.product as Product, null);
          return;
        }
        if (hit.kind === 'unit' && hit.product && hit.unit) {
          const result = addProduct(
            hit.product as Product,
            pricingMode,
            hit.unit as ProductUnit,
          );
          if (result.added) {
            beep();
            toast(
              `أُضيفت وحدة ${(hit.unit as ProductUnit).unitName} من ${(hit.product as Product).name}`,
              'success',
            );
          } else if (result.reason) {
            toast(result.reason, 'error');
          }
          return;
        }
        // غير معروف → نفس سلوك الأندرويد: عرض إضافة منتج بهذا الباركود.
        const yes = window.confirm(
          `لا يوجد منتج مسجل بالباركود ${code}. هل تريد إضافة منتج جديد بهذا الباركود؟`,
        );
        if (yes) setFormBarcode(code);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [addProduct, pricingMode, toast, addToCart],
  );

  useEffect(() => {
    setActiveBarcodeHandler(code => void handleBarcode(code));
    return () => setActiveBarcodeHandler(null);
  }, [handleBarcode]);

  /** إتمام البيع — معاملة ذرّية + إيصال + درج. */
  const checkout = useCallback(async () => {
    if (lines.length === 0 || busy) return;
    setBusy(true);
    try {
      const {invoiceNumber} = await api.nextInvoice();
      const payload = await api.checkout(
        invoiceNumber,
        lines.map(l => ({
          key: l.key,
          product_id: l.productId,
          name: l.name,
          unit_price: l.unitPrice,
          cost_price: l.costPrice,
          quantity: l.quantity,
          unit_id: l.unitId,
          unit_name: l.unitName,
          conversion: l.conversion,
        })),
        discount,
        pricingMode,
      );

      // الطباعة الصامتة (فشلها لا يفشل البيع — رسالة مستقلة).
      try {
        const job = buildReceiptJob(
          {sale: payload.sale, items: payload.items, products},
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
        await kickDrawerIfEnabled();
      } catch (printError) {
        const message =
          printError instanceof Error ? printError.message : String(printError);
        toast(`تم البيع لكن تعذرت الطباعة: ${message}`, 'error');
        notify('printer', 'تعذرت طباعة الإيصال', message);
      }

      notify(
        'sale',
        `فاتورة ${payload.sale.invoice_number}`,
        `${totals.itemsCount} أصناف · ${formatMoney(payload.sale.total_amount)}`,
      );
      beep('ok');
      clear();
      setDiscountText('');
      void refreshCatalog();
      toast(`تمت فاتورة ${payload.sale.invoice_number} بنجاح`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }, [
    lines, discount, pricingMode, busy, settings, products,
    toast, notify, clear, refreshCatalog, totals.itemsCount,
    kickDrawerIfEnabled,
  ]);

  /** اختصارات لوحة المفاتيح (§3.1): F2 بحث، F3 تسعير، F4 خصم، F9 إتمام،
   *  Del حذف المحدد، +/− كمية المحدد، Esc تفريغ التحديد. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F3') {
        e.preventDefault();
        setPricingMode(pricingMode === 'RETAIL' ? 'WHOLESALE' : 'RETAIL');
      } else if (e.key === 'F4') {
        e.preventDefault();
        (document.getElementById('discount-input') as HTMLInputElement | null)?.focus();
      } else if (e.key === 'F9') {
        e.preventDefault();
        void checkout();
      } else if (e.key === 'Delete' && selectedKey) {
        removeLine(selectedKey);
        setSelectedKey(null);
      } else if (e.key === 'Escape') {
        setSelectedKey(null);
      } else if ((e.key === '+' || e.key === '-') && selectedKey) {
        e.preventDefault();
        if (e.key === '+') increment(selectedKey);
        else decrement(selectedKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkout, pricingMode, setPricingMode, selectedKey, removeLine, increment, decrement]);

  return (
    <div className="pos">
      {/* ─── المنتجات: الجهة اليسرى (§3.1) ─── */}
      <div className="pos-left">
        <div className="pos-toolbar">
          <div className="pos-search">
            <input
              ref={searchRef}
              value={search}
              placeholder="ابحث بالاسم أو امسح الباركود…"
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && search.trim()) void handleBarcode(search.trim());
              }}
            />
            <span className="hint">F2</span>
          </div>
          <button
            className={`chip-toggle ${pricingMode === 'WHOLESALE' ? 'on' : ''}`}
            onClick={() =>
              setPricingMode(pricingMode === 'RETAIL' ? 'WHOLESALE' : 'RETAIL')
            }
            title="تبديل التسعير (F3)">
            {pricingMode === 'WHOLESALE' ? 'جملة' : 'مفرق'}
          </button>
          <span className="chip muted">{visible.length} منتجاً</span>
        </div>

        <div className="pos-grid">
          {visible.map(product => {
            const out = product.stock_quantity <= 0;
            const low =
              !out &&
              product.stock_quantity <=
                (product.low_stock_threshold ?? settings.lowStockDefaultThreshold);
            const unitPrice =
              pricingMode === 'WHOLESALE'
                ? product.wholesale_price
                : product.retail_price;
            return (
              <button
                key={product.id}
                className={`tile ${out ? 'out' : ''}`}
                onClick={() => addToCart(product, null)}
                disabled={out}
                title={out ? 'نفد المخزون' : `${product.name} — ${formatMoney(unitPrice)}`}>
                <span className="name">{product.name}</span>
                {product.units && product.units.length > 0 && (
                  <span className="stock">
                    {product.units.map(u => u.unitShort).join(' · ')}
                  </span>
                )}
                <span className="stock">
                  {out
                    ? 'نفد'
                    : `مخزون: ${product.stock_quantity}${low ? ' (منخفض)' : ''}`}
                </span>
                <span className="prices">
                  <b>{formatMoney(unitPrice)}</b>
                </span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <div className="empty" style={{gridColumn: '1 / -1'}}>
              <div className="icon">🛒</div>
              لا منتجات مطابقة — جرّب كلمة أعم أو أضف منتجات من المخزون
            </div>
          )}
        </div>
      </div>

      {/* ─── السلة: الجهة اليمنى (§3.1) ─── */}
      <div className="pos-cart">
        <div className="cart-head">
          <div className="row">
            <b>سلة البيع</b>
            <span className="chip brand">{totals.itemsCount} صنف</span>
          </div>
          <div className="row" style={{marginTop: 6}}>
            <span style={{color: 'var(--muted)', fontSize: 11.5}}>
              {lines.length > 0 ? 'Del يحذف المحدد · +/− كمية' : 'المسح يضيف مباشرة'}
            </span>
            {lines.length > 0 && (
              <button className="btn sm ghost" onClick={() => { clear(); setDiscountText(''); }}>
                تفريغ
              </button>
            )}
          </div>
        </div>

        <div className="cart-lines">
          {lines.map((line: CartLine) => (
            <div
              key={line.key}
              className={`cart-line ${selectedKey === line.key ? 'selected' : ''}`}
              onClick={() => setSelectedKey(line.key)}
              style={
                selectedKey === line.key
                  ? {borderColor: 'var(--brand)', background: 'var(--brand-soft)'}
                  : undefined
              }>
              <div className="top">
                <div>
                  <b>{line.name}</b>
                  <div className="unit">
                    {line.unitName} · {formatMoney(line.unitPrice)}
                  </div>
                </div>
                <span className="line-total">
                  {formatMoney(line.unitPrice * line.quantity)}
                </span>
              </div>
              <div className="stepper">
                <button onClick={() => decrement(line.key)} title="−">−</button>
                <span className="qty">
                  <input
                    dir="ltr"
                    value={line.quantity}
                    onChange={e => {
                      const v = parseNumber(e.target.value);
                      if (Number.isFinite(v)) {
                        const result = setQuantity(line.key, v);
                        if (!result.ok && result.reason) toast(result.reason, 'error');
                      }
                    }}
                  />
                </span>
                <button onClick={() => {
                  const result = increment(line.key);
                  if (!result.ok && result.reason) toast(result.reason, 'error');
                }} title="+">+</button>
                <button
                  className="remove-line"
                  onClick={() => removeLine(line.key)}
                  title="حذف السطر">
                  ✕
                </button>
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <div className="empty">
              <div className="icon">🧾</div>
              اسحب باركوداً أو انقر منتجاً — السلة تُحفظ مسودةً تلقائياً
            </div>
          )}
        </div>

        <div className="cart-summary">
          <div className="summary-row">
            <span>المجموع قبل الخصم</span>
            <span>{formatMoney(totals.subtotal)}</span>
          </div>
          <div className="discount-row">
            <div className="field" style={{flex: 1}}>
              <label>خصم (₪) — F4</label>
              <input
                id="discount-input"
                dir="ltr"
                value={discountText}
                placeholder="0.00"
                onChange={e => {
                  setDiscountText(e.target.value);
                  const v = parseNumber(e.target.value);
                  setDiscount(Number.isFinite(v) ? v : 0);
                }}
              />
            </div>
          </div>
          <div className="summary-row">
            <span>الربح المتوقع</span>
            <span>{formatMoney(totals.profit)}</span>
          </div>
          <div className="summary-row total">
            <span>الإجمالي</span>
            <b>{formatMoney(totals.total)}</b>
          </div>
          <button
            className="checkout-btn"
            onClick={() => void checkout()}
            disabled={lines.length === 0 || busy}>
            {busy ? 'جارٍ إتمام البيع…' : `إتمام البيع — F9 (${formatMoney(totals.total)})`}
          </button>
        </div>
      </div>

      {formBarcode != null && (
        <ProductFormModal
          barcodeSeed={formBarcode}
          onClose={() => setFormBarcode(null)}
          onSaved={() => {
            setFormBarcode(null);
            void refreshCatalog();
          }}
        />
      )}
    </div>
  );
}
