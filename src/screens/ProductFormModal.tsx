/**
 * ProductFormModal.tsx — نموذج منتج + وحداته (منقول من ProductFormScreen):
 * نفس قواعد التحقق ورسائل الأندرويد، ووحدات البيع بمعامل التحويل
 * والتجاوزات (باركود الكرتونة، سعر مفرق/جملة).
 */
import React, {useEffect, useMemo, useState} from 'react';
import {api} from '../lib/tauri';
import {useToastStore} from '../state/appStores';
import {parseNumber} from '../core/format';
import type {Category, Product, ProductUnit, Unit} from '../core/types';

interface DraftUnitRow {
  unit_id: number;
  conversion: number;
  barcode: string;
  retail_price: string;
  wholesale_price: string;
}

export function ProductFormModal({
  productId,
  barcodeSeed,
  onClose,
  onSaved,
}: {
  productId?: number;
  barcodeSeed?: string | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const toast = useToastStore(s => s.show);
  const editing = productId != null && productId > 0;

  const [name, setName] = useState('');
  const [cost, setCost] = useState('0');
  const [retail, setRetail] = useState('0');
  const [wholesale, setWholesale] = useState('0');
  const [stock, setStock] = useState('0');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [barcode, setBarcode] = useState(barcodeSeed ?? '');
  const [threshold, setThreshold] = useState('');
  const [unitRows, setUnitRows] = useState<DraftUnitRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [unitList, categories] = await Promise.all([
          api.listUnits(),
          api.listCategories(),
        ]);
        setUnits(unitList);
        setCategories(
          await api.listCategories().catch(() => [] as Category[]),
        );
        if (editing) {
          const all = await api.listProducts();
          const product = all.find(p => p.id === productId);
          if (product) {
            setName(product.name);
            setCost(String(product.cost_price));
            setRetail(String(product.retail_price));
            setWholesale(String(product.wholesale_price));
            setStock(String(product.stock_quantity));
            setCategoryId(product.category_id ?? '');
            setBarcode(product.barcode ?? '');
            setThreshold(product.low_stock_threshold?.toString() ?? '');
            setUnitRows(
              (product.units ?? []).map(u => ({
                unit_id: u.unit_id,
                conversion: u.conversion,
                barcode: u.barcode ?? '',
                retail_price: u.retail_price?.toString() ?? '',
                wholesale_price: u.wholesale_price?.toString() ?? '',
              })),
            );
          }
        } else if (categories.length > 0 && categories[0]) {
          setCategoryId(categories[0].id);
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const save = async () => {
    setBusy(true);
    try {
      const id = await api.saveProduct({
        id: editing ? productId : null,
        input: {
          name,
          cost_price: parseNumber(cost) || 0,
          retail_price: parseNumber(retail) || 0,
          wholesale_price: parseNumber(wholesale) || 0,
          stock_quantity: parseNumber(stock) || 0,
          category_id: categoryId === '' ? null : categoryId,
          image_uri: null,
          low_stock_threshold: threshold.trim() ? parseNumber(threshold) || null : null,
          barcode: barcode.trim() || null,
        },
        unit_rows: unitRows
          .filter(r => units.some(u => u.id === r.unit_id))
          .map(r => ({
            unit_id: r.unit_id,
            conversion: Math.max(1, parseNumber(String(r.conversion)) || 1),
            barcode: r.barcode.trim() || null,
            retail_price: r.retail_price.trim() ? parseNumber(r.retail_price) || null : null,
            wholesale_price: r.wholesale_price.trim() ? parseNumber(r.wholesale_price) || null : null,
          })),
      });
      toast(editing ? 'تم تحديث المنتج' : 'تمت إضافة المنتج', 'success');
      onSaved(id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addUnitRow = () => {
    const first = units.find(u => !unitRows.some(r => r.unit_id === u.id));
    if (!first) return;
    setUnitRows([...unitRows, {
      unit_id: first.id,
      conversion: 1,
      barcode: '',
      retail_price: '',
      wholesale_price: '',
    }]);
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <b>{editing ? 'تعديل منتج' : 'منتج جديد'}</b>
          <button className="btn sm ghost" onClick={onClose}>إغلاق ✕</button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            <div className="field">
              <label>اسم المنتج *</label>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>الباركود (وحدة الأساس)</label>
              <input dir="ltr" value={barcode} onChange={e => setBarcode(e.target.value)} />
            </div>
          </div>
          <div className="grid-4">
            <div className="field">
              <label>سعر الشراء</label>
              <input dir="ltr" value={cost} onChange={e => setCost(e.target.value)} />
            </div>
            <div className="field">
              <label>سعر المفرق</label>
              <input dir="ltr" value={retail} onChange={e => setRetail(e.target.value)} />
            </div>
            <div className="field">
              <label>سعر الجملة</label>
              <input dir="ltr" value={wholesale} onChange={e => setWholesale(e.target.value)} />
            </div>
            <div className="field">
              <label>المخزون (قطعة)</label>
              <input dir="ltr" value={stock} onChange={e => setStock(e.target.value)} />
            </div>
          </div>
          <div className="grid-4">
            <div className="field">
              <label>التصنيف</label>
              <select
                value={categoryId}
                onChange={e => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">بلا تصنيف</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>حد تنبيه النقص (قطعة)</label>
              <input
                dir="ltr"
                placeholder="افتراضي عام"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
              />
            </div>
          </div>

          <div className="card" style={{background: 'var(--surface-2)'}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
              <b style={{fontSize: 13}}>وحدات البيع (كرتونة/علبة…)</b>
              <button className="btn sm" onClick={addUnitRow}>+ وحدة</button>
            </div>
            {unitRows.length === 0 && (
              <div style={{color: 'var(--muted)', fontSize: 12}}>
                بلا وحدات — يُباع المنتج بالوحدة الأساس (قطعة).
              </div>
            )}
            {unitRows.map((row, i) => (
              <div key={row.unit_id} className="grid-4" style={{marginBottom: 8, alignItems: 'end'}}>
                <div className="field">
                  <label>الوحدة</label>
                  <select
                    value={row.unit_id}
                    onChange={e => {
                      const unitId = Number(e.target.value);
                      setUnitRows(rows => rows.map((r, j) => j === i ? {...r, unit_id: unitId} : r));
                    }}>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>معامل التحويل</label>
                  <input
                    dir="ltr"
                    value={row.conversion}
                    onChange={e =>
                      setUnitRows(rows =>
                        rows.map((r, j) => j === i ? {...r, conversion: parseNumber(e.target.value) || 1} : r),
                      )}
                  />
                </div>
                <div className="field">
                  <label>باركود الوحدة</label>
                  <input
                    dir="ltr"
                    value={row.barcode}
                    onChange={e =>
                      setUnitRows(rows => rows.map((r, j) => j === i ? {...r, barcode: e.target.value} : r))
                    }
                  />
                </div>
                <div style={{display: 'flex', gap: 6, alignItems: 'end'}}>
                  <div className="field" style={{flex: 1}}>
                    <label>مفرق</label>
                    <input
                      dir="ltr"
                      value={row.retail_price}
                      onChange={e =>
                        setUnitRows(rows => rows.map((r, j) => j === i ? {...r, retail_price: e.target.value} : r))
                      }
                    />
                  </div>
                  <button
                    className="btn sm danger"
                    onClick={() => setUnitRows(rows => rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}
