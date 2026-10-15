/**
 * SettingsScreen.tsx — الإعدادات (§3.6): المتجر، الفاتورة، العتاد
 * (طابعة TCP/تسلسلي/Spool + اختبار + درج)، النسخ الاحتياطي (§4)،
 * المظهر، والاشتراك.
 */
import React, {useEffect, useState} from 'react';
import {api} from '../lib/tauri';
import {useToastStore, useNotificationsStore} from '../state/appStores';
import {useSettingsStore} from '../state/settingsStore';
import {buildTestJob} from '../printing/receipt';
import {printJob} from '../printing/dispatch';
import {getJson, KEYS, logDiag} from '../state/storage';
import {formatMoney} from '../core/format';
import {APP_VERSION_LABEL} from '../core/config';
import type {LicenseContact, LicensePayload} from '../license/LicenseService';

export function SettingsScreen() {
  const toast = useToastStore(s => s.show);
  const notify = useNotificationsStore(s => s.push);
  const settings = useSettingsStore(s => s.settings);
  const update = useSettingsStore(s => s.update);
  const printer = useSettingsStore(s => s.printer);
  const updatePrinter = useSettingsStore(s => s.updatePrinter);
  const themeMode = useSettingsStore(s => s.themeMode);
  const setThemeMode = useSettingsStore(s => s.setThemeMode);

  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [spoolPrinters, setSpoolPrinters] = useState<string[]>([]);
  const [tab, setTab] = useState<'store' | 'receipt' | 'hardware' | 'backup' | 'about'>('store');
  const [diagnostics, setDiagnostics] = useState<
    {at: string; scope: string; level: string; message: string}[]
  >([]);

  useEffect(() => {
    void api.listSerialPorts().then(setSerialPorts).catch(() => setSerialPorts([]));
    void api.listSpoolPrinters().then(setSpoolPrinters).catch(() => setSpoolPrinters([]));
    setDiagnostics(getJson(KEYS.diagnosticsLog, []).slice(-14).reverse());
  }, [tab]);

  const saveStoreLogo = async () => {
    try {
      const path = await api.pickStoreLogo();
      if (path) {
        update({storeLogoPath: path});
        toast('حُفظ الشعار — سيُطبع أعلى الفواتير', 'success');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const testPrint = async () => {
    try {
      await printJob(
        buildTestJob({
          storeName: settings.storeName,
          storePhone: settings.storePhone,
          footerMessage: settings.footerMessage,
          paperWidth: settings.paperWidth,
          codepage: settings.codepage,
          showProfit: false,
          storeLogoPath: settings.storeLogoPath,
        }),
      );
      toast('أُرسلت صفحة الاختبار إلى الطابعة', 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast(message, 'error');
      notify('printer', 'فشل اختبار الطباعة', message);
    }
  };

  const testDrawer = async () => {
    try {
      const oldKick = printer.kickDrawerOnSale;
      updatePrinter({kickDrawerOnSale: true});
      await api.openDrawer();
      updatePrinter({kickDrawerOnSale: oldKick});
      toast('أُرسلت نبضة فتح الدرج', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className="screen">
      <h1>الإعدادات</h1>
      <div className="subtitle">المتجر · الفاتورة · العتاد · النسخ الاحتياطي</div>

      <div className="toolbar">
        {(
          [
            ['store', 'المتجر'],
            ['receipt', 'الفاتورة'],
            ['hardware', 'الطابعة والعتاد'],
            ['backup', 'النسخ الاحتياطي'],
            ['about', 'عن النظام'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`chip-toggle ${tab === key ? 'on' : ''}`}
            onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'store' && (
        <div className="card" style={{maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="field">
            <label>اسم المتجر (يُطبع على الفاتورة)</label>
            <input value={settings.storeName} onChange={e => update({storeName: e.target.value})} />
          </div>
          <div className="field">
            <label>هاتف المتجر</label>
            <input dir="ltr" value={settings.storePhone} onChange={e => update({storePhone: e.target.value})} />
          </div>
          <div className="field">
            <label>عنوان المتجر</label>
            <input value={settings.storeAddress} onChange={e => update({storeAddress: e.target.value})} />
          </div>
          <div className="field">
            <label>تذييل الفاتورة</label>
            <textarea
              rows={2}
              value={settings.footerMessage}
              onChange={e => update({footerMessage: e.target.value})}
            />
          </div>
          <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'}}>
            <button className="btn" onClick={() => void saveStoreLogo()}>
              اختيار شعار المتجر
            </button>
            {settings.storeLogoPath && (
              <>
                <span className="chip ok">شعار محفوظ</span>
                <button
                  className="btn sm danger"
                  onClick={() => update({storeLogoPath: null})}>
                  إزالة الشعار
                </button>
              </>
            )}
          </div>
          <div className="grid-2">
            <div className="field">
              <label>حد تنبيه النقص الافتراضي</label>
              <input
                dir="ltr"
                value={settings.lowStockDefaultThreshold}
                onChange={e =>
                  update({lowStockDefaultThreshold: Number(e.target.value) || 5})
                }
              />
            </div>
            <div className="field">
              <label>الوضع الافتراضي للتسعير</label>
              <select
                value={settings.defaultPricingMode}
                onChange={e =>
                  update({defaultPricingMode: e.target.value as 'RETAIL' | 'WHOLESALE'})
                }>
                <option value="RETAIL">مفرق</option>
                <option value="WHOLESALE">جملة</option>
              </select>
            </div>
          </div>
          <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
            <span style={{color: 'var(--ink-soft)', fontSize: 13}}>المظهر:</span>
            <button
              className={`chip-toggle ${themeMode === 'dark' ? 'on' : ''}`}
              onClick={() => setThemeMode('dark')}>
              داكن
            </button>
            <button
              className={`chip-toggle ${themeMode === 'light' ? 'on' : ''}`}
              onClick={() => setThemeMode('light')}>
              فاتح
            </button>
            <label style={{display: 'flex', gap: 8, alignItems: 'center', marginInlineStart: 12, fontSize: 13}}>
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={e => update({soundEnabled: e.target.checked})}
              />
              صوت المسح
            </label>
          </div>
        </div>
      )}

      {tab === 'receipt' && (
        <div className="card" style={{maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="grid-2">
            <div className="field">
              <label>عرض الورق</label>
              <select
                value={settings.paperWidth}
                onChange={e => update({paperWidth: e.target.value as '58' | '80'})}>
                <option value="58">58 مم (32 حرفاً)</option>
                <option value="80">80 مم (48 حرفاً)</option>
              </select>
            </div>
            <div className="field">
              <label>ترميز العربية</label>
              <select value={settings.codepage} onChange={e => update({codepage: Number(e.target.value)})}>
                <option value={47}>Windows-1256 (الأكثر شيوعاً)</option>
                <option value={45}>IBM-864 (بعض Xprinter)</option>
                <option value={0}>ASCII (إنجليزي فقط)</option>
              </select>
            </div>
          </div>
          <label style={{display: 'flex', gap: 8, alignItems: 'center', fontSize: 13}}>
            <input
              type="checkbox"
              checked={settings.showProfitOnReceipt}
              onChange={e => update({showProfitOnReceipt: e.target.checked})}
            />
            طباعة الربح الصافي على الفاتورة (للمدير فقط)
          </label>
          <label style={{display: 'flex', gap: 8, alignItems: 'center', fontSize: 13}}>
            <input
              type="checkbox"
              checked={settings.printQrOnReceipt}
              onChange={e => update({printQrOnReceipt: e.target.checked})}
            />
            رمز QR برقم الفاتورة والإجمالي (§2.ب)
          </label>
        </div>
      )}

      {tab === 'hardware' && (
        <div className="card" style={{maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 14}}>
          <div className="field">
            <label>قناة الطابعة (بديل بلوتوث الأندرويد — §2.ب)</label>
            <select
              value={printer.channel}
              onChange={e =>
                updatePrinter({channel: e.target.value as typeof printer.channel})
              }>
              <option value="none">غير مربوطة</option>
              <option value="tcp">شبكة TCP (منفذ 9100)</option>
              <option value="serial">تسلسلي COM</option>
              <option value="spool">USB عبر مشغّل ويندوز (RAW)</option>
            </select>
          </div>

          {printer.channel === 'tcp' && (
            <div className="grid-2">
              <div className="field">
                <label>عنوان الطابعة (IP)</label>
                <input dir="ltr" value={printer.host} onChange={e => updatePrinter({host: e.target.value})} />
              </div>
              <div className="field">
                <label>المنفذ</label>
                <input dir="ltr" value={printer.port} onChange={e => updatePrinter({port: Number(e.target.value) || 9100})} />
              </div>
            </div>
          )}
          {printer.channel === 'serial' && (
            <div className="grid-2">
              <div className="field">
                <label>المنفذ التسلسلي</label>
                <input
                  dir="ltr"
                  list="serial-ports"
                  value={printer.comPort}
                  onChange={e => updatePrinter({comPort: e.target.value})}
                />
                <datalist id="serial-ports">
                  {serialPorts.map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>السرعة (Baud)</label>
                <select value={printer.baud} onChange={e => updatePrinter({baud: Number(e.target.value)})}>
                  {[9600, 19200, 38400, 57600, 115200].map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {printer.channel === 'spool' && (
            <div className="field">
              <label>اسم الطابعة المثبتة في ويندوز</label>
              <input
                dir="ltr"
                list="spool-printers"
                placeholder="مثال: Xprinter XP-58"
                value={printer.spoolName}
                onChange={e => updatePrinter({spoolName: e.target.value})}
              />
              <datalist id="spool-printers">
                {spoolPrinters.map(p => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              {spoolPrinters.length === 0 && (
                <span style={{fontSize: 11, color: 'var(--muted)'}}>
                  قائمة الطابعات المثبتة تظهر هنا على ويندوز.
                </span>
              )}
            </div>
          )}

          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            <label style={{display: 'flex', gap: 8, alignItems: 'center', fontSize: 13}}>
              <input
                type="checkbox"
                checked={printer.kickDrawerOnSale}
                onChange={e => updatePrinter({kickDrawerOnSale: e.target.checked})}
              />
              فتح درج النقدية تلقائياً عند إتمام البيع (نبضة عبر الطابعة)
            </label>
          </div>

          <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
            <button className="btn primary" onClick={() => void testPrint()}>
              طباعة تجريبية
            </button>
            <button className="btn" onClick={() => void testDrawer()}>
              فتح الدرج الآن
            </button>
          </div>

          <div style={{fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.8}}>
            الطباعة صامتة مباشرة (بلا حوارات ويندوز). المنافذ التسلسلية
            المتاحة: {serialPorts.length > 0 ? serialPorts.join(' · ') : '—'}
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <BackupPanel toast={toast} />
      )}

      {tab === 'about' && (
        <AboutPanel diagnostics={diagnostics} />
      )}
    </div>
  );
}

function BackupPanel({toast}: {toast: (m: string, k?: 'success' | 'error' | 'info') => void}) {
  const [busy, setBusy] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const result = await api.exportBackup();
      const s = result.summary as {
        products: number; sales: number; embeddings: number; units: number;
      };
      setLastSummary(
        `آخر نسخة: ${s.products} منتجاً · ${s.sales} فاتورة · ${s.units} وحدات → ${result.path}`,
      );
      toast(`حُفظت النسخة: ${result.path}`, 'success');
      logDiag('backup', `نسخة احتياطية إلى ${result.path}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('أُلغيت')) toast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async () => {
    if (
      !window.confirm(
        'الاستعادة تستبدل كل البيانات الحالية بمن في الملف — متابعة؟',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.importBackup();
      const s = result.summary as {
        products: number; sales: number; categories: number;
      };
      toast(
        `استُعادت النسخة: ${s.products} منتجاً · ${s.sales} فاتورة — أعد تشغيل التطبيق لتحديث الشاشات`,
        'success',
      );
      logDiag('backup', `استعادة من ${result.path}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('أُلغيت')) toast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const wipe = () => {
    if (!window.confirm('مسح كل بيانات العمل نهائياً (منتجات وفواتير وجرد)؟')) return;
    if (!window.confirm('تأكيد أخير: هذا لا يمكن التراجع عنه — أنت متأكد؟')) return;
    void api
      .wipeData()
      .then(() => toast('مُسحت كل البيانات وأُعيد بذر الفئات الافتراضية', 'info'))
      .catch(e => toast(String(e), 'error'));
  };

  return (
    <div className="card" style={{maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14}}>
      <div style={{fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.9}}>
        نسخة واحدة تحمل كل شيء: المنتجات والوحدات والفواتير والجرد والإعدادات
        — <b>بنفس صيغة تطبيق الأندرويد</b>: يمكنك استيراد نسخة أخذتها من هاتفك
        مباشرة، والعكس.
      </div>
      <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
        <button className="btn primary" onClick={() => void exportBackup()} disabled={busy}>
          تصدير نسخة احتياطية (JSON)
        </button>
        <button className="btn" onClick={() => void importBackup()} disabled={busy}>
          استعادة من ملف
        </button>
        <button className="btn danger" onClick={wipe} disabled={busy}>
          مسح كل البيانات
        </button>
      </div>
      {lastSummary && <div style={{fontSize: 11.5, color: 'var(--muted)'}} dir="auto">{lastSummary}</div>}
    </div>
  );
}

function AboutPanel({
  diagnostics,
}: {
  diagnostics: {at: string; scope: string; level: string; message: string}[];
}) {
  const license = getJson<LicensePayload | null>(KEYS.licensePayload, null);
  const contact = getJson<LicenseContact | null>(KEYS.licenseContact, null);
  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760}}>
      <div className="card">
        <b>سيلا — نقاط البيع لسطح المكتب</b>
        <div style={{color: 'var(--muted)', fontSize: 12.5, marginTop: 6, lineHeight: 1.9}}>
          الإصدار {APP_VERSION_LABEL} · نواة Rust + واجهة React — تطابق كامل
          لتطبيق الأندرويد v6.0.0 (المنطق، القاعدة، الطباعة، الترخيص).
          {contact && (
            <>
              <br />
              الاشتراك: {license ? `مفعّل (خطة ${license.plan})` : 'غير مفعّل'}
            </>
          )}
        </div>
      </div>
      <div className="card">
        <b style={{display: 'block', marginBottom: 10}}>سجل التشخيصات (آخر 14)</b>
        {diagnostics.length === 0 && (
          <div style={{color: 'var(--muted)', fontSize: 12}}>لا أحداث بعد.</div>
        )}
        {diagnostics.map((d, i) => (
          <div key={i} style={{fontSize: 11.5, padding: '6px 0', borderBottom: '1px solid var(--line)'}}>
            <span dir="ltr" style={{color: 'var(--muted)'}}>{d.at}</span>{' '}
            <span className={`chip ${d.level === 'error' ? 'danger' : d.level === 'warn' ? 'warn' : 'muted'}`}>
              {d.scope}
            </span>{' '}
            <span style={{color: 'var(--ink-soft)'}}>{d.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
