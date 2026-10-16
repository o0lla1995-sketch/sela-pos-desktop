/**
 * screens/SettingsScreen.tsx — الإعدادات (UI-7 — سطح المكتب، بتكافؤ
 * الأندرويد v57).
 * ─────────────────────────────────────────────────────────────────
 * أقسام بطاقات بأسلوب v57 مع مكيفات سطح المكتب:
 *  1. بيانات المتجر + منتقي الشعار (حوار أصلي).
 *  2. الطباعة: قناة مكتبية (TCP/تسلسلي COM/Spool ويندوز/بدون)، قص
 *     تلقائي، درج النقدية، عرض الورق، الترميز، الربح وQR على الفاتورة،
 *     طباعة تجريبية وفتح الدرج (api.testPrinter / api.openDrawer).
 *  3. نمط المتجر (STORE_MODES) — التبديل يزرع تصنيفات ووحدات المجال
 *     داخل نطاقه فقط (v34) ثم يقلب الكتالوج فوراً.
 *  4. المخزون والتنبيهات: التفعيل، حد النقص، نافذة الصلاحية.
 *  5. نقطة البيع: التسعير الافتراضي، شكل العرض، ملاحظة الماسح
 *     (البصري للهاتف)، أقل طول كود، الصوت.
 *  6. الأمان: قسم PIN مضمّن من SecuritySettingsScreen.
 *  7. البيع أونلاين + صِلة: ملخص حالة + فتح الشاشات (goTo اختياري).
 *  8. النسخ الاحتياطي: تصدير/استعادة بحوار تأكيد بالأعداد + نسخ
 *     تلقائي إلى مجلد (pick_folder + write_file_in_folder) + مسح كلي.
 *  9. المظهر: داكن/فاتح.
 * 10. حول: الإصدار، معرف الجهاز، مدة التشغيل، الاشتراك، التواصل.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {api, invoke} from '../lib/tauri';
import {useToastStore, useNotificationsStore, useCatalogStore} from '../state/appStores';
import {useSettingsStore} from '../stores/settingsStore';
import {useSilaStore} from '../stores/silaStore';
import {STORE_MODES, storeModeConfig, type StoreMode} from '../core/storeModes';
import {CategoryRepo} from '../database/repositories/CategoryRepo';
import {UnitRepo} from '../database/repositories/UnitRepo';
import {BackupService, type BackupFile} from '../services/BackupService';
import {loadOnlineSettings} from '../services/online/OnlineStoreService';
import {
  mergedContact,
  refreshServerContact,
  loadLicense,
  type LicenseContact,
  type LicensePayload,
} from '../license/LicenseService';
import {getJson, setJson, getNumber} from '../storage/storage';
import {logDiag} from '../state/storage';
import {APP_VERSION_LABEL} from '../core/config';
import {SecurityPanel} from './SecuritySettingsScreen';
import {Icon} from '../components/Icon';
import './settingsv57.css';

/* ── مفاتيح النسخ التلقائي إلى مجلد (سطح المكتب) ────────────────── */
const AUTO_BACKUP_KEYS = {
  folder: 'auto_backup_folder_v1',
  enabled: 'auto_backup_enabled_v1',
  intervalDays: 'auto_backup_interval_days_v1',
  lastAt: 'auto_backup_last_at_v1',
} as const;

const AUTO_INTERVALS: {value: number; label: string}[] = [
  {value: 1, label: 'يومياً'},
  {value: 3, label: 'كل 3 أيام'},
  {value: 7, label: 'أسبوعياً'},
  {value: 14, label: 'كل أسبوعين'},
  {value: 30, label: 'شهرياً'},
];

const POS_VIEWS: {value: 'grid' | 'list' | 'cards'; label: string}[] = [
  {value: 'grid', label: 'شبكة'},
  {value: 'list', label: 'قائمة'},
  {value: 'cards', label: 'بطاقات'},
];

const PRINTER_CHANNELS: {
  value: 'none' | 'tcp' | 'serial' | 'spool';
  label: string;
}[] = [
  {value: 'none', label: 'غير مربوطة'},
  {value: 'tcp', label: 'شبكة TCP (منفذ 9100)'},
  {value: 'serial', label: 'تسلسلي COM'},
  {value: 'spool', label: 'USB عبر مشغّل ويندوز (RAW)'},
];

/** مدة تشغيل الجهاز بالنص العربي. */
function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days} يوم و${hours} ساعة`;
  }
  if (hours > 0) {
    return `${hours} ساعة و${minutes} دقيقة`;
  }
  return `${minutes} دقيقة`;
}

export function SettingsScreen({goTo}: {goTo?: (key: string) => void}) {
  const toast = useToastStore(s => s.show);
  const notify = useNotificationsStore(s => s.push);
  const settings = useSettingsStore(s => s.settings);
  const update = useSettingsStore(s => s.update);
  const printer = useSettingsStore(s => s.printer);
  const updatePrinter = useSettingsStore(s => s.updatePrinter);
  const themeMode = useSettingsStore(s => s.themeMode);
  const setThemeMode = useSettingsStore(s => s.setThemeMode);
  const refreshCatalog = useCatalogStore(s => s.refresh);
  const silaPairing = useSilaStore(s => s.pairing);
  const silaPending = useSilaStore(s => s.pending);

  // ── العتاد: منافذ تسلسلية وطابعات النظام ────────────────────
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [spoolPrinters, setSpoolPrinters] = useState<string[]>([]);
  const [testBusy, setTestBusy] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);

  // ── نمط المتجر ───────────────────────────────────────────────
  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);

  // ── النسخ الاحتياطي ──────────────────────────────────────────
  const [busyExport, setBusyExport] = useState(false);
  const [busyRestore, setBusyRestore] = useState(false);
  const [restoreDoc, setRestoreDoc] = useState<BackupFile | null>(null);
  const [autoFolder, setAutoFolder] = useState<string>(() =>
    getJson<string>(AUTO_BACKUP_KEYS.folder, ''),
  );
  const [autoEnabled, setAutoEnabled] = useState<boolean>(() =>
    getJson<boolean>(AUTO_BACKUP_KEYS.enabled, false),
  );
  const [autoIntervalDays, setAutoIntervalDays] = useState<number>(() =>
    getNumber(AUTO_BACKUP_KEYS.intervalDays, 7),
  );
  const [autoLastAt, setAutoLastAt] = useState<string>(() =>
    getJson<string>(AUTO_BACKUP_KEYS.lastAt, ''),
  );
  const [autoBusy, setAutoBusy] = useState(false);

  // ── حول ──────────────────────────────────────────────────────
  const [deviceId, setDeviceId] = useState('');
  const [uptimeText, setUptimeText] = useState('…');
  const [license, setLicense] = useState<LicensePayload | null>(null);
  // v57.2: قسم التواصل حيّة من السيرفر — دمج {احتياطي، مخزّن} مثل
  // أندرويد (SubscriptionSection) بدل إخفاء القسم كلياً عند غياب
  // الكاش، مع تحديث فوري من GET /api/v1/config عند فتح الإعدادات.
  const [contact, setContact] = useState<LicenseContact>(() =>
    mergedContact(),
  );

  useEffect(() => {
    void api.listSerialPorts().then(setSerialPorts).catch(() => setSerialPorts([]));
    void api.listSpoolPrinters().then(setSpoolPrinters).catch(() => setSpoolPrinters([]));
    void api.deviceId().then(setDeviceId).catch(() => setDeviceId('غير متاح'));
    void api
      .uptimeMs()
      .then(ms => setUptimeText(formatUptime(ms)))
      .catch(() => setUptimeText('غير متاح'));
    setLicense(loadLicense()?.payload ?? null);
    void refreshServerContact().then(live => {
      if (live != null) {
        setContact(mergedContact());
      }
    });
  }, []);

  /* ── الشعار ─────────────────────────────────────────────────── */
  const pickStoreLogo = useCallback(async () => {
    try {
      const path = await api.pickStoreLogo();
      if (path) {
        update({storeLogoPath: path});
        toast('حُفظ الشعار — سيُطبع أعلى الفواتير', 'success');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'فشل اختيار الشعار', 'error');
    }
  }, [toast, update]);

  /* ── الطباعة والدرج ────────────────────────────────────────── */
  const testPrint = useCallback(async () => {
    if (testBusy) {
      return;
    }
    setTestBusy(true);
    try {
      await api.testPrinter();
      toast('أُرسلت صفحة الاختبار إلى الطابعة', 'success');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast(message, 'error');
      notify('printer', 'فشل اختبار الطباعة', message);
    } finally {
      setTestBusy(false);
    }
  }, [testBusy, toast, notify]);

  const openDrawerNow = useCallback(async () => {
    if (drawerBusy) {
      return;
    }
    setDrawerBusy(true);
    try {
      await api.openDrawer();
      toast('أُرسلت نبضة فتح الدرج', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setDrawerBusy(false);
    }
  }, [drawerBusy, toast]);

  /* ── نمط المتجر: زرع داخل نطاق النمط فقط (v34) ────────────── */
  const applyStoreMode = useCallback(
    async (mode: StoreMode) => {
      setModePickerOpen(false);
      if (modeBusy || mode === settings.storeMode) {
        return;
      }
      const config = storeModeConfig(mode);
      const confirmed = window.confirm(
        `تحويل المتجر إلى: ${config.label}\n\n` +
          'ستُزرع تصنيفات ووحدات هذا المجال داخل نطاقه فقط — كل نمط يرى ' +
          'تصنيفاته ووحداته دون خليط أو تراكم (لا يُحذف أي منتج أو تصنيف ' +
          'أو وحدة قائمة)، وتتكيّف صفحة المنتج وطريقة الإدخال مع مجالك ' +
          'تلقائياً.\n\nهل تريد المتابعة؟',
      );
      if (!confirmed) {
        return;
      }
      setModeBusy(true);
      try {
        let addedCategories = 0;
        let addedUnits = 0;
        const existingCategories = await CategoryRepo.list(mode);
        const existingNames = new Set(
          existingCategories.map(cat => cat.name.trim()),
        );
        for (const name of config.categorySeeds) {
          if (!existingNames.has(name)) {
            await CategoryRepo.create(name, mode);
            addedCategories += 1;
          }
        }
        const existingUnits = await UnitRepo.list(mode);
        const existingUnitNames = new Set(
          existingUnits.map(unit => unit.name.trim()),
        );
        for (const seed of config.unitSeeds) {
          if (!existingUnitNames.has(seed.name)) {
            await UnitRepo.create(seed.name, seed.short, seed.kind, mode);
            addedUnits += 1;
          }
        }
        update({storeMode: mode});
        await refreshCatalog();
        toast(
          `أصبح متجرك «${config.label}»` +
            (addedCategories > 0 || addedUnits > 0
              ? ` — أُضيف ${addedCategories} تصنيف و${addedUnits} وحدة لهذا المجال`
              : ''),
          'success',
          5000,
        );
      } catch (e) {
        toast(
          e instanceof Error ? e.message : 'تعذر تحويل نمط المتجر',
          'error',
        );
      } finally {
        setModeBusy(false);
      }
    },
    [modeBusy, refreshCatalog, settings.storeMode, toast, update],
  );

  /* ── النسخ الاحتياطي: تصدير/استعادة/تلقائي/مسح ────────────── */
  const exportBackup = useCallback(async () => {
    if (busyExport) {
      return;
    }
    setBusyExport(true);
    try {
      const {path, summary} = await BackupService.exportBackup();
      toast(
        `تم حفظ النسخة في ${path} — ${summary.products} منتج و${summary.embeddings} بصمة و${summary.sales} فاتورة`,
        'success',
        6000,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('أُلغيت')) {
        toast(message, 'error', 5000);
      }
    } finally {
      setBusyExport(false);
    }
  }, [busyExport, toast]);

  const pickRestoreFile = useCallback(async () => {
    if (busyRestore) {
      return;
    }
    setBusyRestore(true);
    try {
      const doc = await BackupService.pickAndParseBackup();
      setRestoreDoc(doc);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('أُلغيت')) {
        toast(message, 'error', 5000);
      }
    } finally {
      setBusyRestore(false);
    }
  }, [busyRestore, toast]);

  const confirmRestore = useCallback(async () => {
    if (restoreDoc == null) {
      return;
    }
    const doc = restoreDoc;
    setRestoreDoc(null);
    setBusyRestore(true);
    try {
      const result = await BackupService.restoreBackup(doc);
      await refreshCatalog();
      toast(
        `تم الاسترجاع — ${result.products} منتج و${result.sales} فاتورة` +
          (result.skippedSales
            ? ` (تخطي ${result.skippedSales} فاتورة مكررة)`
            : '') +
          ' — سيُعاد تحميل التطبيق',
        'success',
        6000,
      );
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast(
        e instanceof Error
          ? e.message
          : 'فشل الاسترجاع — لم تتغير بياناتك',
        'error',
        6000,
      );
      setBusyRestore(false);
    }
  }, [refreshCatalog, restoreDoc, toast]);

  /** نسخة الآن إلى المجلد التلقائي (write_file_in_folder بلا حوار). */
  const runAutoBackup = useCallback(
    async (silent: boolean) => {
      if (autoFolder.length === 0) {
        if (!silent) {
          toast('اختر مجلد النسخ التلقائي أولاً', 'error');
        }
        return;
      }
      setAutoBusy(true);
      try {
        const {json, summary} = await BackupService.buildBackupJson({
          compact: true,
        });
        // v60 (جذر OS Error 123): ISO الزمني يحمل نقطتين «14:30:45»
        // وهي محظورة في أسماء ملفات ويندوز — ويندوز يرفض الاسم كله
        // بالخطأ 123 (صيغة اسم غير صحيحة)، وكان الاحتياطي v59 يفشل
        // بدوره لأنه يعيد استخدام نفس الاسم المعطوب. النقطتان
        // تُستبدلان بشرطة فيصبح الاسم: sela_backup_2026-10-17_14-30-45.json
        const stamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace('T', '_')
          .replace(/:/g, '-');
        const result = await invoke<string>('write_file_in_folder', {
          folder: autoFolder,
          name: `sela_backup_${stamp}.json`,
          contents: json,
        });
        const now = new Date().toISOString();
        setJson(AUTO_BACKUP_KEYS.lastAt, now);
        setAutoLastAt(now);
        if (result.startsWith('FALLBACK:')) {
          // v59: ويندوز رفض الكتابة في المجلد المختار (صلاحيات/مزامنة
          // سحابية) — حُفظت النسخة في مجلد بيانات سيلا بدل ضياعها.
          const fallbackPath = result.slice('FALLBACK:'.length);
          logDiag(
            'backup',
            `تعذر المجلد المختار — حُفظت النسخة احتياطياً في ${fallbackPath} (${summary.products} منتج، ${summary.sales} فاتورة)`,
            'warn',
          );
          notify(
            'backup',
            'النسخة حُفظت في مجلد بيانات سيلا',
            `تعذر الكتابة في المجلد المختار فحُفظت النسخة تلقائياً في: ${fallbackPath}`,
          );
          toast(
            `تعذر المجلد المختار — حُفظت النسخة في مجلد بيانات سيلا: ${fallbackPath}`,
            'info',
            8000,
          );
        } else {
          logDiag(
            'backup',
            `نسخة ${silent ? 'تلقائية' : 'يدوية'} إلى ${result} — ${summary.products} منتج، ${summary.sales} فاتورة`,
          );
          if (!silent) {
            toast(`حُفظت النسخة في المجلد: ${result}`, 'success', 5000);
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logDiag('backup', `فشلت النسخة ${silent ? 'تلقائية' : 'يدوية'}: ${message}`, 'warn');
        // v58: الفشل الصامت كان يختفي تماماً — الآن يظهر إشعاراً
        // وتوستاً واضحين حتى يعرف التاجر أن النسخ لم يحدث.
        notify('backup', 'فشلت النسخة الاحتياطية التلقائية', message);
        toast(`فشلت النسخة الاحتياطية: ${message}`, 'error', 7000);
      } finally {
        setAutoBusy(false);
      }
    },
    [autoFolder, toast, notify],
  );

  const pickAutoFolder = useCallback(async () => {
    try {
      const folder = await invoke<string>('pick_folder');
      setAutoFolder(folder);
      setJson(AUTO_BACKUP_KEYS.folder, folder);
      toast(`مجلد النسخ التلقائي: ${folder}`, 'info', 5000);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes('أُلغيت')) {
        toast(message, 'error');
      }
    }
  }, [toast]);

  const toggleAutoEnabled = useCallback(
    (enabled: boolean) => {
      setAutoEnabled(enabled);
      setJson(AUTO_BACKUP_KEYS.enabled, enabled);
      if (enabled && autoFolder.length === 0) {
        toast('فعّلت النسخ التلقائي — اختر المجلد الآن', 'info');
      } else {
        toast(
          enabled ? 'فُعّل النسخ التلقائي' : 'أُوقف النسخ التلقائي',
          'info',
        );
      }
    },
    [autoFolder, toast],
  );

  const changeAutoInterval = useCallback(
    (days: number) => {
      setAutoIntervalDays(days);
      setJson(AUTO_BACKUP_KEYS.intervalDays, days);
    },
    [],
  );

  // فحص الاستحقاق مرة عند فتح الشاشة — نسخة صامتة إن حان موعدها.
  useEffect(() => {
    if (!autoEnabled || autoFolder.length === 0) {
      return;
    }
    const lastMs = autoLastAt.length > 0
      ? new Date(autoLastAt).getTime()
      : 0;
    const elapsedDays = (Date.now() - lastMs) / 86400000;
    if (elapsedDays >= autoIntervalDays) {
      void runAutoBackup(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wipe = useCallback(() => {
    if (
      !window.confirm(
        'سيتم حذف كل المنتجات والتصنيفات والوحدات والمبيعات والجرد نهائياً. لا يمكن التراجع!',
      )
    ) {
      return;
    }
    if (!window.confirm('تأكيد أخير: هل أنت متأكد تماماً؟')) {
      return;
    }
    void (async () => {
      try {
        await api.wipeData();
        await refreshCatalog();
        toast('تم حذف جميع البيانات — أُعيد بذر الفئات الافتراضية', 'info');
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      }
    })();
  }, [refreshCatalog, toast]);

  const modeConfig = storeModeConfig(settings.storeMode);
  const [online] = useState(() => loadOnlineSettings());

  // ──────────────────────────────────────────────────────────────
  return (
    <div className="screen">
      <h1>الإعدادات</h1>
      <div className="subtitle">
        تخصيص النظام — المتجر، الطباعة، النمط، التنبيهات، الأمان، النسخ
        الاحتياطي
      </div>

      <div className="sv57-stack">
        {/* ── 1) بيانات المتجر ─────────────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">بيانات المتجر</div>
              <div className="sv57-sec-hint">
                تظهر أعلى الفاتورة المطبوعة وفي الشاشة الرئيسية
              </div>
            </div>
          </div>
          <div className="sv57-form">
            <div className="field">
              <label>اسم المتجر</label>
              <input
                value={settings.storeName}
                onChange={e => update({storeName: e.target.value})}
                placeholder="متجر sela"
              />
            </div>
            <div className="field">
              <label>هاتف المتجر (اختياري)</label>
              <input
                dir="ltr"
                value={settings.storePhone}
                onChange={e => update({storePhone: e.target.value})}
                placeholder="05XXXXXXXX"
              />
            </div>
            <div className="field">
              <label>عنوان المتجر (اختياري)</label>
              <input
                value={settings.storeAddress}
                onChange={e => update({storeAddress: e.target.value})}
              />
            </div>
            <div className="field">
              <label>رسالة أسفل الفاتورة</label>
              <textarea
                rows={2}
                value={settings.footerMessage}
                onChange={e => update({footerMessage: e.target.value})}
                placeholder="شكراً لتعاملكم معنا"
              />
            </div>
          </div>
          <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'}}>
            <button className="btn" onClick={() => void pickStoreLogo()}>
              {settings.storeLogoPath ? 'تغيير الشعار' : 'اختيار شعار المتجر'}
            </button>
            {settings.storeLogoPath != null && (
              <>
                <span className="chip ok">شعار محفوظ</span>
                <button
                  className="btn sm danger"
                  onClick={() => {
                    update({storeLogoPath: null});
                    toast('تمت إزالة الشعار', 'info');
                  }}>
                  إزالة الشعار
                </button>
              </>
            )}
          </div>
          <div className="sv57-sec-hint">
            يُطبع الشعار أعلى الفاتورة الحرارية ويظهر في الشاشة الرئيسية.
          </div>
        </div>

        {/* ── 2) الطباعة (سطح المكتب) ─────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">الطباعة</div>
              <div className="sv57-sec-hint">
                قناة مكتبية بديلة عن بلوتوث الأندرويد — طباعة صامتة مباشرة
                بلا حوارات ويندوز
              </div>
            </div>
          </div>
          <div className="sv57-form">
            <div className="field">
              <label>قناة الطابعة</label>
              <select
                value={printer.channel}
                onChange={e =>
                  updatePrinter({
                    channel: e.target.value as typeof printer.channel,
                  })
                }>
                {PRINTER_CHANNELS.map(ch => (
                  <option key={ch.value} value={ch.value}>
                    {ch.label}
                  </option>
                ))}
              </select>
            </div>
            {printer.channel === 'tcp' && (
              <>
                <div className="field">
                  <label>عنوان الطابعة (IP)</label>
                  <input
                    dir="ltr"
                    value={printer.host}
                    onChange={e => updatePrinter({host: e.target.value})}
                    placeholder="192.168.1.87"
                  />
                </div>
                <div className="field">
                  <label>المنفذ</label>
                  <input
                    dir="ltr"
                    value={printer.port}
                    onChange={e =>
                      updatePrinter({port: Number(e.target.value) || 9100})
                    }
                  />
                </div>
              </>
            )}
            {printer.channel === 'serial' && (
              <>
                <div className="field">
                  <label>المنفذ التسلسلي</label>
                  <input
                    dir="ltr"
                    list="sv57-serial-ports"
                    value={printer.comPort}
                    onChange={e => updatePrinter({comPort: e.target.value})}
                    placeholder="COM3"
                  />
                  <datalist id="sv57-serial-ports">
                    {serialPorts.map(p => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label>السرعة (Baud)</label>
                  <select
                    value={printer.baud}
                    onChange={e =>
                      updatePrinter({baud: Number(e.target.value)})
                    }>
                    {[9600, 19200, 38400, 57600, 115200].map(b => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {printer.channel === 'spool' && (
              <div className="field span2">
                <label>اسم الطابعة المثبتة في ويندوز</label>
                <input
                  dir="ltr"
                  list="sv57-spool-printers"
                  placeholder="مثال: Xprinter XP-58"
                  value={printer.spoolName}
                  onChange={e => updatePrinter({spoolName: e.target.value})}
                />
                <datalist id="sv57-spool-printers">
                  {spoolPrinters.map(p => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                {spoolPrinters.length === 0 && (
                  <span className="sv57-sec-hint">
                    قائمة الطابعات المثبتة تظهر هنا على ويندوز.
                  </span>
                )}
              </div>
            )}
            <div className="field">
              <label>عرض الورق</label>
              <select
                value={settings.paperWidth}
                onChange={e =>
                  update({paperWidth: e.target.value as '58' | '80'})
                }>
                <option value="58">58 مم (32 حرفاً)</option>
                <option value="80">80 مم (48 حرفاً)</option>
              </select>
            </div>
            <div className="field">
              <label>ترميز العربية</label>
              <select
                value={settings.codepage}
                onChange={e => update({codepage: Number(e.target.value)})}>
                <option value={47}>Windows-1256 (الأكثر شيوعاً)</option>
                <option value={45}>IBM-864 (بعض Xprinter)</option>
                <option value={0}>ASCII (إنجليزي فقط)</option>
              </select>
            </div>
          </div>
          <div className="sv57-switches">
            <button
              type="button"
              className={`sv57-switch ${printer.autoCut ? 'on' : ''}`}
              onClick={() => updatePrinter({autoCut: !printer.autoCut})}>
              <span className="sv57-switch-texts">
                <b>قص تلقائي بعد كل فاتورة</b>
                <span className="sv57-switch-hint">
                  أمر ESC/POS بالقص على نهاية كل إيصال
                </span>
              </span>
              <span className="sv57-knob" />
            </button>
            <button
              type="button"
              className={`sv57-switch ${printer.kickDrawerOnSale ? 'on' : ''}`}
              onClick={() =>
                updatePrinter({kickDrawerOnSale: !printer.kickDrawerOnSale})
              }>
              <span className="sv57-switch-texts">
                <b>فتح درج النقدية تلقائياً عند إتمام البيع</b>
                <span className="sv57-switch-hint">
                  نبضة عبر الطابعة (ESC p) مع كل فاتورة نقدية
                </span>
              </span>
              <span className="sv57-knob" />
            </button>
            <button
              type="button"
              className={`sv57-switch ${settings.showProfitOnReceipt ? 'on' : ''}`}
              onClick={() =>
                update({showProfitOnReceipt: !settings.showProfitOnReceipt})
              }>
              <span className="sv57-switch-texts">
                <b>طباعة الربح الصافي على الفاتورة</b>
                <span className="sv57-switch-hint">للمدير فقط — لا تُظهره للزبون</span>
              </span>
              <span className="sv57-knob" />
            </button>
            <button
              type="button"
              className={`sv57-switch ${settings.printQrOnReceipt ? 'on' : ''}`}
              onClick={() =>
                update({printQrOnReceipt: !settings.printQrOnReceipt})
              }>
              <span className="sv57-switch-texts">
                <b>رمز QR برقم الفاتورة والإجمالي</b>
                <span className="sv57-switch-hint">
                  إضافة مكتبية — مسح سريع للتحقق من الفاتورة
                </span>
              </span>
              <span className="sv57-knob" />
            </button>
          </div>
          <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
            <button
              className="btn primary"
              disabled={testBusy || printer.channel === 'none'}
              onClick={() => void testPrint()}>
              {testBusy ? 'جارٍ الطباعة…' : 'طباعة تجريبية'}
            </button>
            <button
              className="btn"
              disabled={drawerBusy || printer.channel === 'none'}
              onClick={() => void openDrawerNow()}>
              {drawerBusy ? '…' : 'فتح الدرج الآن'}
            </button>
          </div>
          <div className="sv57-sec-hint">
            المنافذ التسلسلية المتاحة:{' '}
            {serialPorts.length > 0 ? serialPorts.join(' · ') : '—'}
          </div>
        </div>

        {/* ── 3) نمط المتجر ────────────────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">نمط المتجر</div>
              <div className="sv57-sec-hint">
                يغيّر الأصناف المقترحة ووحدات الإدخال وسلوك صفحة المنتج حسب
                مجالك — كل نمط يرى تصنيفاته ووحداته فقط
              </div>
            </div>
            <button
              className="btn"
              disabled={modeBusy}
              onClick={() => setModePickerOpen(true)}>
              {modeBusy ? 'جارٍ التحويل…' : 'تغيير النمط'}
            </button>
          </div>
          <div className="sv57-mode-current">
            <span className="chip brand">{modeConfig.label}</span>
            <span className="sv57-sec-hint">{modeConfig.blurb}</span>
          </div>
        </div>

        {/* ── 4) المخزون والتنبيهات ────────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">المخزون والتنبيهات</div>
              <div className="sv57-sec-hint">
                حدود تنبيهات النفاد والصلاحية — لكل منتج تجاوز خاص في ملفه
              </div>
            </div>
            {goTo != null && (
              <button className="btn sm ghost" onClick={() => goTo('stock-alerts')}>
                شاشة التنبيهات ←
              </button>
            )}
          </div>
          <div className="sv57-switches">
            <button
              type="button"
              className={`sv57-switch ${settings.stockAlertsEnabled ? 'on' : ''}`}
              onClick={() =>
                update({stockAlertsEnabled: !settings.stockAlertsEnabled})
              }>
              <span className="sv57-switch-texts">
                <b>تنبيهات المخزون والصلاحية</b>
                <span className="sv57-switch-hint">
                  إشعارات النفاد والانخفاض والصلاحية في مركز الإشعارات — مرة
                  يومياً لكل منتج
                </span>
              </span>
              <span className="sv57-knob" />
            </button>
          </div>
          <div className="sv57-form">
            <div className="field">
              <label>حد تنبيه النقص الافتراضي (قطعة)</label>
              <input
                dir="ltr"
                inputMode="numeric"
                value={settings.lowStockDefaultThreshold}
                onChange={e =>
                  update({
                    lowStockDefaultThreshold: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </div>
            <div className="field">
              <label>نافذة التنبيه قبل انتهاء الصلاحية (أيام)</label>
              <input
                dir="ltr"
                inputMode="numeric"
                value={settings.expiryAlertDays}
                onChange={e =>
                  update({
                    expiryAlertDays: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* ── 5) نقطة البيع ────────────────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">نقطة البيع</div>
              <div className="sv57-sec-hint">
                التسعير الافتراضي وشكل عرض المنتجات وسلوك الماسح
              </div>
            </div>
          </div>
          <div className="sv57-form">
            <div className="field">
              <label>نمط التسعير الافتراضي</label>
              <select
                value={settings.defaultPricingMode}
                onChange={e =>
                  update({
                    defaultPricingMode: e.target.value as 'RETAIL' | 'WHOLESALE',
                  })
                }>
                <option value="RETAIL">مفرق</option>
                <option value="WHOLESALE">جملة</option>
              </select>
            </div>
            <div className="field">
              <label>شكل عرض المنتجات في البيع</label>
              <div className="sv57-seg" style={{marginTop: 4}}>
                {POS_VIEWS.map(view => (
                  <button
                    key={view.value}
                    className={settings.posProductView === view.value ? 'on' : ''}
                    onClick={() => update({posProductView: view.value})}>
                    {view.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>طريقة المسح</label>
              <input value="باركود (ماسح سطح المكتب العام)" disabled />
              <span className="sv57-sec-hint">
                البصري للهاتف فقط — سطح المكتب يعمل مع أي ماسح باركود USB
                مباشرة.
              </span>
            </div>
            <div className="field">
              <label>أقل طول كود يعتبره الماسح العام مسحاً</label>
              <input
                dir="ltr"
                inputMode="numeric"
                value={settings.scannerMinLength}
                onChange={e =>
                  update({
                    scannerMinLength: Math.max(2, Number(e.target.value) || 4),
                  })
                }
              />
            </div>
          </div>
          <div className="sv57-switches">
            <button
              type="button"
              className={`sv57-switch ${settings.soundEnabled ? 'on' : ''}`}
              onClick={() => update({soundEnabled: !settings.soundEnabled})}>
              <span className="sv57-switch-texts">
                <b>صوت المسح</b>
                <span className="sv57-switch-hint">
                  نغمة تأكيد عند قراءة باركود من الماسح العام
                </span>
              </span>
              <span className="sv57-knob" />
            </button>
          </div>
        </div>

        {/* ── 6) الأمان (مضمّن من SecuritySettingsScreen) ──────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">الأمان وقفل التطبيق</div>
              <div className="sv57-sec-hint">
                رمز PIN يُطلب عند التشغيل وبعد الخمول — محلي مشفّر بالكامل
              </div>
            </div>
          </div>
          <SecurityPanel />
        </div>

        {/* ── 7) البيع أونلاين + صِلة ──────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">البيع أونلاين + صِلة</div>
              <div className="sv57-sec-hint">
                ملخص حالة القناتين — الإدارة الكاملة من شاشتيهما
              </div>
            </div>
          </div>
          <div className="sv57-duo">
            <div className="sv57-kpi">
              <span className="label">صِلة (الدين الفلسطيني)</span>
              <span className={`value ${silaPairing != null ? 'ok' : 'warn'}`}>
                {silaPairing != null ? 'مقترن' : 'غير مقترن'}
              </span>
              <span className="sub">
                {silaPairing != null
                  ? `${silaPairing.merchantName} · ${silaPending} عملية بانتظار المزامنة`
                  : 'اربط حسابك من شاشة صِلة والقسائم'}
              </span>
            </div>
            <div className="sv57-kpi">
              <span className="label">البيع أونلاين (سيلا ماركت)</span>
              <span className={`value ${online.enabled ? 'ok' : 'warn'}`}>
                {online.enabled ? 'مفعّل' : 'متوقف'}
              </span>
              <span className="sub">
                {online.enabled
                  ? `${online.storeName || settings.storeName}${
                      online.storeNumber != null
                        ? ` · رقم المتجر ${online.storeNumber}`
                        : ''
                    }`
                    : 'فعّله من شاشة البيع أونلاين'}
              </span>
            </div>
          </div>
          {goTo != null ? (
            <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
              <button className="btn" onClick={() => goTo('sila')}>
                فتح صِلة والقسائم ←
              </button>
              <button className="btn" onClick={() => goTo('online-selling')}>
                فتح البيع أونلاين ←
              </button>
              <button className="btn ghost" onClick={() => goTo('online-orders')}>
                الطلبات أونلاين ←
              </button>
            </div>
          ) : (
            <div className="sv57-note">
              افتح شاشتي «صِلة والقسائم» و«البيع أونلاين» من الشريط الجانبي.
            </div>
          )}
        </div>

        {/* ── 8) النسخ الاحتياطي ───────────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">النسخ الاحتياطي</div>
              <div className="sv57-sec-hint">
                نسخة واحدة تحمل كل شيء: المنتجات والوحدات والفواتير والجرد
                والديون والإعدادات — <b>بنفس صيغة تطبيق الأندرويد</b> (يمكن
                استيراد نسخة من هاتفك مباشرة والعكس)
              </div>
            </div>
          </div>
          <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
            <button
              className="btn primary"
              disabled={busyExport}
              onClick={() => void exportBackup()}>
              {busyExport ? 'جارٍ التصدير…' : 'تصدير نسخة احتياطية (JSON)'}
            </button>
            <button
              className="btn"
              disabled={busyRestore}
              onClick={() => void pickRestoreFile()}>
              {busyRestore ? 'جارٍ القراءة…' : 'استعادة من ملف'}
            </button>
          </div>

          {/* النسخ التلقائي إلى مجلد */}
          <div className="sv57-note">
            <b>النسخ التلقائي إلى مجلد:</b> يكتب نسخة JSON مضغوطة إلى مجلد
            تختاره مرة كل فترة عند فتح الإعدادات — بلا حوارات حفظ.
          </div>
          <div className="sv57-switches">
            <button
              type="button"
              className={`sv57-switch ${autoEnabled ? 'on' : ''}`}
              onClick={() => toggleAutoEnabled(!autoEnabled)}>
              <span className="sv57-switch-texts">
                <b>تفعيل النسخ التلقائي</b>
                <span className="sv57-switch-hint">
                  {autoFolder.length > 0
                    ? `المجلد: ${autoFolder}`
                    : 'لم يُختر مجلد بعد'}
                  {autoLastAt.length > 0
                    ? ` · آخر نسخة: ${autoLastAt.slice(0, 16).replace('T', ' ')}`
                    : ''}
                </span>
              </span>
              <span className="sv57-knob" />
            </button>
          </div>
          <div style={{display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center'}}>
            <button className="btn sm" onClick={() => void pickAutoFolder()}>
              اختيار المجلد
            </button>
            <select
              className="btn sm"
              value={autoIntervalDays}
              onChange={e => changeAutoInterval(Number(e.target.value))}
              style={{padding: '5px 10px'}}>
              {AUTO_INTERVALS.map(interval => (
                <option key={interval.value} value={interval.value}>
                  {interval.label}
                </option>
              ))}
            </select>
            <button
              className="btn sm"
              disabled={autoBusy || autoFolder.length === 0}
              onClick={() => void runAutoBackup(false)}>
              {autoBusy ? 'جارٍ النسخ…' : 'نسخة الآن إلى المجلد'}
            </button>
          </div>

          {/* منطقة الخطر */}
          <div className="sv57-danger-zone">
            <b style={{color: 'var(--danger)'}}>منطقة الخطر</b>
            <div className="sv57-sec-hint">
              مسح كل بيانات العمل نهائياً (منتجات وفواتير وجرد وديون) —
              تصدير نسخة احتياطية أولاً.
            </div>
            <div>
              <button className="btn danger" onClick={wipe} disabled={busyExport || busyRestore}>
                مسح كل البيانات
              </button>
            </div>
          </div>
        </div>

        {/* ── 9) المظهر ────────────────────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">المظهر</div>
              <div className="sv57-sec-hint">
                الوضع الداكن الافتراضي (هوية سيلا) أو الفاتح للإضاءة النهارية
              </div>
            </div>
            <div className="sv57-seg">
              <button
                className={themeMode === 'dark' ? 'on' : ''}
                onClick={() => setThemeMode('dark')}>
                داكن
              </button>
              <button
                className={themeMode === 'light' ? 'on' : ''}
                onClick={() => setThemeMode('light')}>
                فاتح
              </button>
            </div>
          </div>
        </div>

        {/* ── 10) حول ──────────────────────────────────────────── */}
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">حول النظام</div>
              <div className="sv57-sec-hint">
                سيلا لسطح المكتب — نواة Rust + واجهة React، بتكافؤ كامل مع
                تطبيق الأندرويد
              </div>
            </div>
          </div>
          <div className="sv57-rows">
            <div className="sv57-info-row">
              <span className="k">الإصدار</span>
              <span className="v">{APP_VERSION_LABEL}</span>
            </div>
            <div className="sv57-info-row">
              <span className="k">معرف الجهاز</span>
              <span className="v">{deviceId || '…'}</span>
            </div>
            <div className="sv57-info-row">
              <span className="k">مدة تشغيل الجهاز</span>
              <span className="v">{uptimeText}</span>
            </div>
            <div className="sv57-info-row">
              <span className="k">الاشتراك</span>
              <span className="v">
                {license != null
                  ? `${license.plan} — حتى ${new Date(license.expiresAt)
                      .toISOString()
                      .slice(0, 10)}`
                  : 'غير مفعّل'}
              </span>
            </div>
          </div>
          {contact != null && (
            <div className="sv57-contacts">
              {contact.phone.length > 0 && (
                <a className="chip brand" href={`tel:${contact.phone}`}>
                  📞 {contact.phone}
                </a>
              )}
              {contact.whatsapp.length > 0 && (
                <a
                  className="chip ok"
                  href={`https://wa.me/${contact.whatsapp.replace(/[^\d]/g, '')}`}
                  target="_blank"
                  rel="noreferrer">
                  واتساب
                </a>
              )}
              {contact.telegram.length > 0 && (
                <a
                  className="chip muted"
                  href={`https://t.me/${contact.telegram.replace('@', '')}`}
                  target="_blank"
                  rel="noreferrer">
                  تيليغرام
                </a>
              )}
              {contact.email.length > 0 && (
                <a className="chip warn" href={`mailto:${contact.email}`}>
                  ✉️ {contact.email}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── منتقي نمط المتجر ──────────────────────────────────── */}
      {modePickerOpen && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(760px, 94vw)'}}>
            <div className="modal-head">
              <b>اختيار نمط المتجر</b>
              <button
                className="btn sm ghost"
                onClick={() => setModePickerOpen(false)}>
                إغلاق
              </button>
            </div>
            <div className="modal-body">
              <div className="sv57-mode-grid">
                {STORE_MODES.map(config => {
                  const active = config.key === settings.storeMode;
                  return (
                    <button
                      key={config.key}
                      className={`sv57-mode-card ${active ? 'on' : ''}`}
                      disabled={modeBusy}
                      onClick={() => void applyStoreMode(config.key)}>
                      <b>
                        {config.label}
                        {active && <Icon name="check" size={13} />}
                      </b>
                      <span>{config.blurb}</span>
                    </button>
                  );
                })}
              </div>
              <div className="sv57-note">
                التبديل يزرع تصنيفات ووحدات المجال الجديد موسومة به فقط إن لم
                تكن موجودة — لا يُحذف أي منتج أو تصنيف أو وحدة قائمة، وبيانات
                الأنماط الأخرى تعود للظهور فوراً إن أعدت النمط.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── تأكيد الاستعادة (بالأعداد) ────────────────────────── */}
      {restoreDoc != null && (
        <div className="overlay">
          <div className="modal" style={{width: 'min(560px, 94vw)'}}>
            <div className="modal-head">
              <b>استرجاع النسخة الاحتياطية</b>
            </div>
            <div className="modal-body">
              <div className="sv57-sec-hint">هذا الملف يحتوي:</div>
              <div className="sv57-rows">
                <div className="sv57-info-row">
                  <span className="k">المنتجات</span>
                  <span className="v">{restoreDoc.products.length}</span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">التصنيفات</span>
                  <span className="v">{restoreDoc.categories.length}</span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">الوحدات</span>
                  <span className="v">{restoreDoc.units.length}</span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">الفواتير</span>
                  <span className="v">{restoreDoc.sales.length}</span>
                </div>
                <div className="sv57-info-row">
                  <span className="k">البصمات البصرية</span>
                  <span className="v">{restoreDoc.embeddings.length}</span>
                </div>
              </div>
              <div className="sv57-note danger">
                سيتم استبدال كل البيانات الحالية بمحتويات النسخة — الفواتير
                والديون والسدادّات تدخل إحصائيات المتجر كاملة. لا يمكن
                التراجع!
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setRestoreDoc(null)}>
                إلغاء
              </button>
              <button
                className="btn primary"
                disabled={busyRestore}
                onClick={() => void confirmRestore()}>
                {busyRestore ? 'جارٍ الاسترجاع…' : 'استرجاع الآن'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
