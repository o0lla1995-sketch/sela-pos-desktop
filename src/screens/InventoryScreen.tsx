/**
 * InventoryScreen.tsx — المخزون والكتالوج (§3.3): جدول قابل للتصفية
 * + نموذج منتج + إدارة التصنيفات والوحدات + طباعة ملصق باركود.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {api} from '../lib/tauri';
import {useCatalogStore, useToastStore} from '../state/appStores';
import {useSettingsStore} from '../state/settingsStore';
import {formatMoney} from '../core/format';
import {ProductFormModal} from './ProductFormModal';
import {buildBarcodeLabel} from '../printing/receipt';
import {printJob} from '../printing/dispatch';
import type {Category, Product, Unit} from '../core/types';

export function InventoryScreen() {
  const toast = useToastStore(s => s.show);
  const products = useCatalogStore(s => s.products);
  const refresh = useCatalogStore(s => s.refresh);
  const settings = useSettingsStore(s => s.settings);

  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [catFilter, setCatFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'stock' | 'retail'>('name');
  const [editing, setEditing] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [tab, setTab] = useState<'products' | 'categories' | 'units'>('products');

  const reloadMeta = useCallback(async () => {
    try {
      const [cats, unitList] = await Promise.all([api.listCategories(), api.listUnits()]);
      setCategories(cats);
      setUnits(unitList);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
    void reloadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    let list = products;
    if (catFilter !== 'all') list = list.filter(p => p.category_id === catFilter);
    const q = search.trim();
    if (q) list = list.filter(p => p.name.includes(q) || p.barcode === q);
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === 'stock') return b.stock_quantity - a.stock_quantity;
      if (sort === 'retail') return b.retail_price - a.retail_price;
      return a.name.localeCompare(b.name, 'ar');
    });
    return sorted;
  }, [products, catFilter, search, sort]);

  const printLabel = async (product: Product) => {
    try {
      await printJob(
        buildBarcodeLabel(product, settings.paperWidth, settings.codepage),
      );
      toast(`طُبع ملصق ${product.name}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className="screen">
      <h1>المخزون والكتالوج</h1>
      <div className="subtitle">
        {products.length} منتجاً · إدارة الأسعار والمخزون والوحدات والملصقات
      </div>

      <div className="toolbar">
        <button
          className={`chip-toggle ${tab === 'products' ? 'on' : ''}`}
          onClick={() => setTab('products')}>
          المنتجات
        </button>
        <button
          className={`chip-toggle ${tab === 'categories' ? 'on' : ''}`}
          onClick={() => setTab('categories')}>
          التصنيفات
        </button>
        <button
          className={`chip-toggle ${tab === 'units' ? 'on' : ''}`}
          onClick={() => setTab('units')}>
          الوحدات
        </button>
        <span className="grow" />
        {tab === 'products' && (
          <button
            className="btn primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}>
            + منتج جديد
          </button>
        )}
      </div>

      {tab === 'products' && (
        <>
          <div className="toolbar">
            <select
              value={catFilter}
              onChange={e =>
                setCatFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              className="btn"
              style={{padding: '8px 12px'}}>
              <option value="all">كل التصنيفات</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.productCount ?? 0})
                </option>
              ))}
            </select>
            <input
              placeholder="بحث بالاسم أو الباركود…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '8px 12px', background: 'var(--bg)',
                border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)', minWidth: 220,
              }}
            />
            <select
              value={sort}
              onChange={e => setSort(e.target.value as typeof sort)}
              className="btn"
              style={{padding: '8px 12px'}}>
              <option value="name">ترتيب: الاسم</option>
              <option value="stock">ترتيب: المخزون</option>
              <option value="retail">ترتيب: سعر المفرق</option>
            </select>
          </div>

          <table className="data">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>التصنيف</th>
                <th>شراء</th>
                <th>مفرق</th>
                <th>جملة</th>
                <th>المخزون</th>
                <th>الوحدات</th>
                <th>الباركود</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(product => (
                <tr key={product.id}>
                  <td>
                    <b>{product.name}</b>
                    {product.stock_quantity <= 0 && (
                      <span className="chip danger" style={{marginInlineStart: 8}}>نفد</span>
                    )}
                  </td>
                  <td>{categories.find(c => c.id === product.category_id)?.name ?? '—'}</td>
                  <td>{formatMoney(product.cost_price)}</td>
                  <td>{formatMoney(product.retail_price)}</td>
                  <td>{formatMoney(product.wholesale_price)}</td>
                  <td>{product.stock_quantity}</td>
                  <td>
                    {(product.units ?? []).map(u => u.unitShort).join(' · ') || 'قطعة'}
                  </td>
                  <td dir="ltr" style={{fontSize: 11.5, color: 'var(--muted)'}}>
                    {product.barcode ?? '—'}
                  </td>
                  <td className="row-actions">
                    {product.barcode && (
                      <button className="btn sm" onClick={() => void printLabel(product)} title="ملصق باركود">
                        🏷️
                      </button>
                    )}
                    <button
                      className="btn sm"
                      onClick={() => {
                        setEditing(product.id);
                        setFormOpen(true);
                      }}>
                      تعديل
                    </button>
                    <button
                      className="btn sm danger"
                      onClick={() => {
                        if (window.confirm(`حذف «${product.name}» نهائياً؟`)) {
                          void api
                            .deleteProduct(product.id)
                            .then(() => {
                              toast('حُذف المنتج', 'info');
                              void refresh();
                            })
                            .catch(e => toast(String(e), 'error'));
                        }
                      }}>
                      حذف
                    </button>
                </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'categories' && (
        <CategoriesManager
          categories={categories}
          reload={reloadMeta}
          toast={toast}
        />
      )}
      {tab === 'units' && (
        <UnitsManager units={units} reload={reloadMeta} toast={toast} />
      )}

      {formOpen && (
        <ProductFormModal
          productId={editing ?? undefined}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            void refresh();
            void reloadMeta();
          }}
        />
      )}
    </div>
  );
}

function CategoriesManager({
  categories,
  reload,
  toast,
}: {
  categories: Category[];
  reload: () => Promise<void>;
  toast: (m: string, k?: 'success' | 'error' | 'info') => void;
}) {
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  return (
    <div className="card" style={{maxWidth: 620}}>
      <div className="toolbar" style={{marginBottom: 10}}>
        <input
          placeholder={editingId ? 'اسم جديد للتصنيف…' : 'تصنيف جديد…'}
          value={name}
          onChange={e => setName(e.target.value)}
          style={{
            flex: 1, padding: '10px 12px', background: 'var(--bg)',
            border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)',
          }}
        />
        <button
          className="btn primary"
          onClick={() => {
            if (!name.trim()) return;
            void api
              .upsertCategory(editingId, name.trim())
              .then(() => {
                toast(editingId ? 'عُدّل التصنيف' : 'أُضيف التصنيف', 'success');
                setName('');
                setEditingId(null);
                void reload();
              })
              .catch(e => toast(String(e), 'error'));
          }}>
          {editingId ? 'حفظ' : 'إضافة'}
        </button>
        {editingId && (
          <button className="btn" onClick={() => {setEditingId(null); setName('');}}>
            إلغاء
          </button>
        )}
      </div>
      {categories.map(c => (
        <div
          key={c.id}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 0', borderBottom: '1px solid var(--line)',
          }}>
          <span>
            {c.name}{' '}
            <span className="chip muted" style={{marginInlineStart: 6}}>
              {c.productCount ?? 0} منتجاً
            </span>
          </span>
          <span style={{display: 'flex', gap: 6}}>
            <button className="btn sm" onClick={() => {setEditingId(c.id); setName(c.name);}}>
              تعديل
            </button>
            <button
              className="btn sm danger"
              onClick={() => {
                if ((c.productCount ?? 0) > 0) {
                  toast('لا يمكن حذف تصنيف يحوي منتجات — انقلها أولاً', 'error');
                  return;
                }
                if (window.confirm(`حذف «${c.name}»؟`)) {
                  void api
                    .deleteCategory(c.id)
                    .then(() => void reload())
                    .catch(e => toast(String(e), 'error'));
                }
              }}>
              حذف
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

function UnitsManager({
  units,
  reload,
  toast,
}: {
  units: Unit[];
  reload: () => Promise<void>;
  toast: (m: string, k?: 'success' | 'error' | 'info') => void;
}) {
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  return (
    <div className="card" style={{maxWidth: 620}}>
      <div className="toolbar" style={{marginBottom: 10}}>
        <input
          placeholder="اسم الوحدة (كرتونة…)"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{flex: 1, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)'}}
        />
        <input
          placeholder="اختصار"
          value={short}
          onChange={e => setShort(e.target.value)}
          style={{width: 110, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)'}}
        />
        <button
          className="btn primary"
          onClick={() => {
            if (!name.trim() || !short.trim()) return;
            void api
              .upsertUnit({
                id: 0,
                name,
                short_name: short,
                sort_order: units.length,
              })
              .then(() => {
                toast('أُضيفت الوحدة', 'success');
                setName('');
                setShort('');
                void reload();
              })
              .catch(e => toast(String(e), 'error'));
          }}>
          إضافة
        </button>
      </div>
      {units.map(u => (
        <div
          key={u.id}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '9px 0', borderBottom: '1px solid var(--line)',
          }}>
          <span>
            {u.name} — <span style={{color: 'var(--muted)'}}>{u.short_name}</span>
          </span>
          <button
            className="btn sm danger"
            onClick={() => {
              if (window.confirm(`حذف وحدة «${u.name}»؟`)) {
                void api
                  .deleteUnit(u.id)
                  .then(() => void reload())
                  .catch(e => toast(String(e), 'error'));
              }
            }}>
            حذف
          </button>
        </div>
      ))}
    </div>
  );
}
