/**
 * components/QuickProductSheet.tsx — الإضافة السريعة لمود «نقطة
 * البيع» (v58 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * نفس منطق الأندرويد (QuickProductService مشترك حرفياً): اسم + سعر
 * + طريقة بيع (حبة/علبة/غرام) + مخزون اختياري — السجائر تُضاف في
 * ثوانٍ وتُباع بالحبة المفردة أو بالعلبة أو بالغرام.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {QuickProductService, type QuickSellBy} from '../services/QuickProductService';
import {useCatalogStore} from '../state/appStores';
import {useToastStore} from '../state/appStores';
import {pushBarcodeHandler, beep} from '../lib/scanner';

const SELL_BY_OPTIONS: {key: QuickSellBy; label: string; hint: string}[] = [
  {key: 'piece', label: 'بالحبة', hint: 'سعر الحبة — وسعر العلبة يُشتق'},
  {key: 'box', label: 'بالعلبة', hint: 'سعر العلبة — وسعر الحبة يُشتق'},
  {key: 'gram', label: 'بالغرام', hint: 'منتج وزني بالغرام'},
];

function parsePositiveNumber(text: string): number | null {
  const value = Number(text.replace(',', '.').trim());
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export function QuickProductSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToastStore(state => state.show);
  const refreshCatalog = useCatalogStore(state => state.refresh);

  const [name, setName] = useState('');
  const [sellBy, setSellBy] = useState<QuickSellBy>('piece');
  const [piecePrice, setPiecePrice] = useState('');
  const [boxPrice, setBoxPrice] = useState('');
  const [perBox, setPerBox] = useState('20');
  const [gramPrice, setGramPrice] = useState('');
  const [stock, setStock] = useState('');
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);

  /* v73 (الجولة 77 #1): الماسح اللاسلكي ← حقل الباركود — النافذة
   *  تفتح فوق شاشة البيع فيعلو معالجها معالج السلة طوال فتحها:
   *  مسح الجوال يعبّئ باركود المنتج الجديد بدل إضافته للسلة. */
  useEffect(() => {
    if (!open) {
      return;
    }
    return pushBarcodeHandler(code => {
      setBarcode(code);
      beep('ok');
    });
  }, [open]);

  const perBoxCount = useMemo(() => {
    const parsed = parsePositiveNumber(perBox);
    return parsed != null ? Math.round(parsed) : 0;
  }, [perBox]);

  const derivedBoxPrice = useMemo(() => {
    const price = parsePositiveNumber(piecePrice);
    if (price == null || perBoxCount < 2) {
      return null;
    }
    return Math.round(price * perBoxCount * 100) / 100;
  }, [piecePrice, perBoxCount]);

  const derivedPiecePrice = useMemo(() => {
    const price = parsePositiveNumber(boxPrice);
    if (price == null || perBoxCount < 2) {
      return null;
    }
    return Math.round((price / perBoxCount) * 100) / 100;
  }, [boxPrice, perBoxCount]);

  if (!open) {
    return null;
  }

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('اسم المنتج مطلوب', 'error');
      return;
    }
    setBusy(true);
    try {
      const stockInput = parsePositiveNumber(stock);
      await QuickProductService.createQuickProduct({
        name: trimmed,
        sellBy,
        price:
          sellBy === 'piece'
            ? parsePositiveNumber(piecePrice) ?? 0
            : sellBy === 'box'
            ? parsePositiveNumber(boxPrice) ?? 0
            : parsePositiveNumber(gramPrice) ?? 0,
        perBox: perBoxCount >= 2 ? perBoxCount : 20,
        boxPriceOverride:
          sellBy === 'piece' ? parsePositiveNumber(boxPrice) : null,
        stockInput,
        barcode: barcode.trim() || null,
      });
      await refreshCatalog();
      toast(`أُضيف «${trimmed}» — متاح في نقطة البيع فوراً`, 'success');
      setName('');
      setPiecePrice('');
      setBoxPrice('');
      setGramPrice('');
      setStock('');
      setBarcode('');
      onClose();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر إضافة المنتج',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <div className="modal" style={{width: 'min(520px, 94vw)'}}>
        <div className="modal-head">
          <div>
            <b>إضافة منتج سريع</b>
            <div className="sub">اسم وسعر وطريقة البيع — لا شيء آخر مطلوب</div>
          </div>
          <button className="btn sm ghost" onClick={onClose}>
            إغلاق
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>اسم المنتج — مثال: مارلبورو</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="اسم المنتج"
              autoFocus
            />
          </div>

          <div className="field">
            <label>طريقة البيع</label>
            <div className="seg">
              {SELL_BY_OPTIONS.map(option => (
                <button
                  key={option.key}
                  className={sellBy === option.key ? 'on' : ''}
                  onClick={() => setSellBy(option.key)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="sub" style={{marginTop: 6}}>
              {SELL_BY_OPTIONS.find(o => o.key === sellBy)?.hint}
            </div>
          </div>

          {sellBy !== 'gram' ? (
            <>
              <div className="field">
                <label>عدد الحبات في العلبة</label>
                <input
                  value={perBox}
                  onChange={e => setPerBox(e.target.value)}
                  placeholder="20"
                />
              </div>
              {sellBy === 'piece' ? (
                <>
                  <div className="field">
                    <label>سعر الحبة (₪)</label>
                    <input
                      value={piecePrice}
                      onChange={e => setPiecePrice(e.target.value)}
                      placeholder="مثال: 1"
                    />
                  </div>
                  {derivedBoxPrice != null ? (
                    <div className="sub" style={{margin: '-4px 0 8px'}}>
                      سعر العلبة المشتق: {derivedBoxPrice.toFixed(2)} ₪
                    </div>
                  ) : null}
                  <div className="field">
                    <label>سعر العلبة (₪) — اختياري لتجاوز المشتق</label>
                    <input
                      value={boxPrice}
                      onChange={e => setBoxPrice(e.target.value)}
                      placeholder={derivedBoxPrice?.toFixed(2) ?? 'مثال: 18'}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label>سعر العلبة (₪)</label>
                    <input
                      value={boxPrice}
                      onChange={e => setBoxPrice(e.target.value)}
                      placeholder="مثال: 18"
                    />
                  </div>
                  {derivedPiecePrice != null ? (
                    <div className="sub" style={{margin: '-4px 0 8px'}}>
                      سعر الحبة المشتق: {derivedPiecePrice.toFixed(2)} ₪
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <div className="field">
              <label>سعر الغرام (₪)</label>
              <input
                value={gramPrice}
                onChange={e => setGramPrice(e.target.value)}
                placeholder="مثال: 0.06"
              />
            </div>
          )}

          <div className="field">
            <label>
              المخزون الابتدائي (
              {sellBy === 'gram' ? 'بالغرام' : 'بالعلبة'}) — اتركه فارغاً
              لبلا تتبع
            </label>
            <input
              value={stock}
              onChange={e => setStock(e.target.value)}
              placeholder="اختياري"
            />
          </div>
          <div className="field">
            <label>باركود (اختياري)</label>
            <input
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              placeholder="امسحه أو اكتبه"
            />
          </div>
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            إلغاء
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void save()}>
            {busy ? 'جارٍ الإضافة…' : 'إضافة المنتج'}
          </button>
        </div>
      </div>
    </div>
  );
}
