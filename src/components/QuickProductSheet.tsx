/**
 * components/QuickProductSheet.tsx — الإضافة السريعة لمود «نقطة
 * البيع» (v58 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * نفس منطق الأندرويد (QuickProductService مشترك حرفياً): اسم + سعر
 * + طريقة بيع (حبة/علبة/غرام) + مخزون اختياري — السجائر تُضاف في
 * ثوانٍ وتُباع بالحبة المفردة أو بالعلبة أو بالغرام.
 *
 * v71 (الجولة 83 #٢/#٣): خيارات بيع بالعدد (باكجات) — طلب التاجر
 * نصاً: «نفس الصنف يباع بالقطعة بشيكل واحد مع خيارات أخرى تظهر عند
 * اختيار المنتج في البيع — 3 حبات بـ2 شيكل أو 5 حبات بـ3 شيكل،
 * مثل المطاعم والكافيهات ولكن ليس أحجاماً بل عدداً». الباركود حُذف
 * من النافذة بطلبه الصريح.
 */
import React, {useMemo, useState} from 'react';
import {
  QuickProductService,
  quickPackageLabel,
  type QuickSellBy,
} from '../services/QuickProductService';
import {useCatalogStore, useToastStore} from '../state/appStores';

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

/** v71: صف باكج بيع بالعدد كحقول نص خام — التحويل لحظة الحفظ فقط. */
interface PackageRow {
  count: string;
  price: string;
}

const EMPTY_PACKAGE: PackageRow = {count: '', price: ''};

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
  const [busy, setBusy] = useState(false);
  /** v71 (الجولة 83 #٢): خيارات بيع بالعدد — مطوية افتراضياً. */
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [packageRows, setPackageRows] = useState<PackageRow[]>([]);

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

  /** v71: تحويل صفوف الباكجات لحظة الحفظ — الصف الفارغ يُتجاهل؛
   *  الناقص يوقف الحفظ برسالة تحدد المشكلة. */
  const parsePackageRows = () => {
    const out: {count: number; price: number}[] = [];
    for (const row of packageRows) {
      const countText = row.count.replace(',', '.').trim();
      const priceText = row.price.replace(',', '.').trim();
      if (countText.length === 0 && priceText.length === 0) {
        continue;
      }
      const count = Number(countText);
      if (!Number.isFinite(count) || count < 2 || !Number.isInteger(count)) {
        throw new Error('عدد الحبات في خيار البيع — رقماً صحيحاً 2 أو أكثر');
      }
      const price = Number(priceText);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(
          `سعر خيار «${quickPackageLabel(count)}» — أدخل رقماً أكبر من صفر`,
        );
      }
      out.push({count, price});
    }
    return out;
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('اسم المنتج مطلوب', 'error');
      return;
    }
    setBusy(true);
    try {
      // v71: الوزني يُباع بالوزن من لوحة الوزن — صفوف الباكجات (إن
      //  بقيت من اختيار قطعي سابق) تُتجاهل بصمت لا أن تُفشل الحفظ.
      const packages = sellBy === 'gram' ? [] : parsePackageRows();
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
        barcode: null,
        packages,
      });
      await refreshCatalog();
      toast(
        `أُضيف «${trimmed}» — متاح في نقطة البيع فوراً${
          packages.length > 0
            ? ` بـ${packages.length + 1} خيارات بيع (حبة + ${packages.length} باكج)`
            : ''
        }`,
        'success',
      );
      setName('');
      setPiecePrice('');
      setBoxPrice('');
      setGramPrice('');
      setStock('');
      setPackagesOpen(false);
      setPackageRows([]);
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
      <div className="modal" style={{width: 'min(560px, 94vw)'}}>
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

          {/* v71 (الجولة 83 #٢): خيارات بيع بالعدد (باكجات) — قسم
              مطوي حتى يبقى المسار السريع كما هو. */}
          {sellBy !== 'gram' ? (
            <div className="field">
              <button
                className={`btn sm ${packagesOpen ? 'ghost' : 'primary'}`}
                onClick={() => setPackagesOpen(prev => !prev)}>
                {packagesOpen ? 'إخفاء خيارات البيع بالعدد' : '+ خيارات بيع بالعدد — باكجات (اختياري)'}
              </button>
              {packagesOpen ? (
                <div style={{marginTop: 8, display: 'grid', gap: 8}}>
                  <div className="sub">
                    كل خيار = عدد حبات بسعره المميز (مثال: 3 حبات بـ2
                    شيكل). تظهر عند اختيار المنتج في البيع قبل إضافته
                    للسلة — مع خيار الحبة المفردة دائماً — ويميزها
                    الفاتورة بعدد الحبات.
                  </div>
                  {packageRows.map((row, index) => (
                    <div
                      key={index}
                      className="qp-package-row"
                      style={{display: 'flex', gap: 8, alignItems: 'flex-end'}}>
                      <div style={{flex: 1}}>
                        <label className="sub">عدد الحبات</label>
                        <input
                          value={row.count}
                          onChange={e =>
                            setPackageRows(prev =>
                              prev.map((r, i) =>
                                i === index
                                  ? {...r, count: e.target.value.replace(',', '.')}
                                  : r,
                              ),
                            )
                          }
                          placeholder="3"
                          inputMode="numeric"
                        />
                      </div>
                      <div style={{flex: 1}}>
                        <label className="sub">سعر الباكج ₪</label>
                        <input
                          value={row.price}
                          onChange={e =>
                            setPackageRows(prev =>
                              prev.map((r, i) =>
                                i === index
                                  ? {...r, price: e.target.value.replace(',', '.')}
                                  : r,
                              ),
                            )
                          }
                          placeholder="2"
                          inputMode="decimal"
                        />
                      </div>
                      <button
                        className="btn sm ghost"
                        title="حذف الخيار"
                        onClick={() =>
                          setPackageRows(prev => prev.filter((_, i) => i !== index))
                        }>
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn sm ghost"
                    onClick={() =>
                      setPackageRows(prev => [...prev, {...EMPTY_PACKAGE}])
                    }>
                    + إضافة خيار آخر
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
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
