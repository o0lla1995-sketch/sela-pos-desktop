/**
 * Settings store — persisted to MMKV as one JSON blob.
 * Every UI screen reads its tunables from here so the shop owner can
 * adjust the system without touching code.
 */
import {create} from 'zustand';
import {getJson, setJson, KEYS} from '../storage/storage';
import {
  DEFAULT_MATCH_THRESHOLD,
  DEFAULT_RECOGNITION_COOLDOWN_MS,
  CODEPAGE_CP1256,
  DEFAULT_EXPIRY_ALERT_DAYS,
  DEFAULT_LOW_STOCK_THRESHOLD,
  type ScannerMode,
} from '../core/config';
import type {PricingMode} from '../core/types';
import type {StoreMode} from '../core/storeModes';
import {defaultPaymentMethodsEnabled} from '../core/paymentMethods';

/** v40 (الجولة 48 #5): شكل عرض المنتجات داخل نقطة البيع — الافتراض
 *  الشبكة الحالية (طلب التاجر: «اجعل الشكل الافتراضي هو الحالي»).
 *  grid: البلاطات المربعة الحالية بالصور.
 *  list: صفوف مضغوطة (مصغّر + اسم + سعر + مخزون) — أكثر أصناف في
 *  الشاشة للمخازن الكبيرة.
 *  cards: بطاقات كبيرة بصور كبيرة (اثنتان في الصف) — للملابس
 *  والبصريين حيث الصورة تبيع. */
export type PosProductView = 'grid' | 'list' | 'cards';

export interface AppSettings {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  footerMessage: string;
  /** Store logo (local file path) shown in-app and on receipts. */
  storeLogoPath: string | null;
  defaultPricingMode: PricingMode;
  /** Scanner engine: barcode / visual / both (merchant's choice).
   *  v37 (الجولة 45 #2ب): الافتراض «باركود» فقط (طلب التاجر
   *  نصاً) — كان «both». */
  scannerMode: ScannerMode;
  /** v37 (الجولة 45 #2ب): هل عدّل التاجر طريقة المسح بنفسه؟
   *  يُستعمل لترحيل الافتراض القديم «both» إلى «barcode» مرة
   *  واحدة بلا طغيان على اختيار التاجر الصريح. */
  scannerModeTouched: boolean;
  /** Vision */
  recognitionEnabled: boolean;
  matchThreshold: number;
  recognitionCooldownMs: number;
  soundEnabled: boolean;
  /** Receipt */
  paperWidth: '58' | '80';
  codepage: number;
  showProfitOnReceipt: boolean;
  /** Saved printer */
  printerAddress: string | null;
  printerName: string | null;
  /** Stock alerts */
  stockAlertsEnabled: boolean;
  lowStockDefaultThreshold: number;
  /** v33 (round-41 #4): نمط المتجر — بقالة افتراضياً؛ يغيّر الأصناف
   *  المقترحة ووحدات الإدخال وسلوك صفحة المنتج حسب المجال
   *  (كافيتريا/ملابس/صيدلية/فواكه/مطعم). */
  storeMode: StoreMode;
  /** v32 (round-40 #3): نافذة التنبيه قبل انتهاء الصلاحية (أيام). */
  expiryAlertDays: number;
  systemNotificationsEnabled: boolean;
  /** v40 (الجولة 48 #5): شكل عرض المنتجات في نقطة البيع — الشبكة
   *  الحالية هي الافتراض. */
  posProductView: PosProductView;
  /** سطح المكتب: أقل طول كود يعتبره خطاف الماسح العام مسحاً. */
  scannerMinLength: number;
  /** سطح المكتب: طباعة رمز QR بالفاتورة (رقمها) — إضافة مكتبية. */
  printQrOnReceipt: boolean;
  /** v58 (الجولة 62): تشغيل خادم الشبكة المحلية لتطبيق سيلّا
   *  كاشير — يسمح لأجهزة الكاشيرين المعتمدين بالاتصال والبيع
   *  باسمهم من نفس الشبكة. مطفأ افتراضياً. */
  lanServerEnabled: boolean;
  /** v58: منفذ خادم الكاشير (HTTP) — 8950 افتراضياً. */
  lanPort: number;
  /** v68 (الجولة 72): الاستمرار بالخلفية بعد إغلاق النافذة —
   *  إغلاق النافذة مع خادم الكاشير يعمل يخفي البرنامج في أيقونة
   *  شريط المهام بدل إيقاف الخادم والخروج (طلب التاجر نصاً: يجب
   *  أن تبقى نقطة البيع تعمل حتى بعد إغلاق البرنامج). الخروج
   *  الكامل من قائمة أيقونة سيلا أو بإيقاف الخادم أولاً. */
  lanKeepAliveOnClose: boolean;
  /** v70 (الجولة 74 #2): طرق الدفع المفعّلة لدى التاجر — تظهر في
   *  واجهة الدفع (بنوك ومحافظ فلسطينية). النقدي مقفول دائماً.
   *  الخريطة جزئية الترقية = كل غير مذكور مفعّل. */
  paymentMethodsEnabled: Record<string, boolean>;
}

/** قناة طابعة سطح المكتب (بديل بلوتوث الأندرويد). */
export interface DesktopPrinter {
  channel: 'none' | 'tcp' | 'serial' | 'spool';
  host: string;
  port: number;
  comPort: string;
  baud: number;
  spoolName: string;
  autoCut: boolean;
  kickDrawerOnSale: boolean;
}

export const DEFAULT_PRINTER: DesktopPrinter = {
  channel: 'none',
  host: '192.168.1.87',
  port: 9100,
  comPort: 'COM3',
  baud: 115200,
  spoolName: '',
  autoCut: true,
  kickDrawerOnSale: true,
};

const DEFAULTS: AppSettings = {
  storeName: 'متجر sela',
  storePhone: '',
  storeAddress: '',
  footerMessage: 'شكراً لتعاملكم معنا — لا يوجد إرجاع أو استبدال بعد الفاتورة',
  storeLogoPath: null,
  defaultPricingMode: 'RETAIL',
  // v37 (الجولة 45 #2ب): طريقة المسح الافتراضية أثناء البيع =
  //  الباركود فقط (طلب التاجر نصاً) — كانت «both».
  scannerMode: 'barcode',
  scannerModeTouched: false,
  recognitionEnabled: true,
  matchThreshold: DEFAULT_MATCH_THRESHOLD,
  recognitionCooldownMs: DEFAULT_RECOGNITION_COOLDOWN_MS,
  soundEnabled: true,
  paperWidth: '58',
  codepage: CODEPAGE_CP1256,
  showProfitOnReceipt: false,
  printerAddress: null,
  printerName: null,
  stockAlertsEnabled: true,
  lowStockDefaultThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
  storeMode: 'grocery',
  expiryAlertDays: DEFAULT_EXPIRY_ALERT_DAYS,
  systemNotificationsEnabled: true,
  posProductView: 'grid',
  lanServerEnabled: false,
  lanPort: 8950,
  lanKeepAliveOnClose: true,
  scannerMinLength: 4,
  printQrOnReceipt: false,
  paymentMethodsEnabled: defaultPaymentMethodsEnabled(),
};

interface SettingsState {
  settings: AppSettings;
  /** قناة الطابعة المكتبية — مخزنة في مفتاحها الخاص. */
  printer: DesktopPrinter;
  themeMode: 'dark' | 'light';
  update: (patch: Partial<AppSettings>) => void;
  updatePrinter: (patch: Partial<DesktopPrinter>) => void;
  setThemeMode: (mode: 'dark' | 'light') => void;
  reset: () => void;
}

function loadInitial(): AppSettings {
  const stored = getJson<Partial<AppSettings>>(KEYS.settings, {});
  const merged = {...DEFAULTS, ...stored};
  // v37 (الجولة 45 #2ب): الترحيل الأحادي — «both» المخزنة كانت
  //  مجرد افتراض قديم لا اختيار التاجر: إن لم يلمس التاجر
  //  الإعداد بنفسه (لا علم scannerModeTouched) يُرحَّل إلى
  //  «باركود فقط». أي اختيار صريح بعد اليوم يُحترم حرفياً ولا
  //  يُلمس مرة أخرى.
  if (!merged.scannerModeTouched && merged.scannerMode === 'both') {
    merged.scannerMode = 'barcode';
  }
  return merged;
}

function persist(settings: AppSettings): void {
  setJson(KEYS.settings, settings);
}

function loadPrinter(): DesktopPrinter {
  const stored = getJson<Partial<DesktopPrinter>>(KEYS.desktopPrinter, {});
  return {...DEFAULT_PRINTER, ...stored};
}

export const useSettingsStore = create<SettingsState>(set => ({
  settings: loadInitial(),
  printer: loadPrinter(),
  themeMode: getJson<'dark' | 'light'>(KEYS.themeMode, 'dark'),
  update: patch =>
    set(state => {
      const next = {...state.settings, ...patch};
      persist(next);
      return {settings: next};
    }),
  updatePrinter: patch =>
    set(state => {
      const next = {...state.printer, ...patch};
      setJson(KEYS.desktopPrinter, next);
      return {printer: next};
    }),
  setThemeMode: mode => {
    setJson(KEYS.themeMode, mode);
    set({themeMode: mode});
  },
  reset: () =>
    set(() => {
      persist(DEFAULTS);
      return {settings: {...DEFAULTS}};
    }),
}));

/** Imperative accessor for services outside React. */
export function getSettings(): AppSettings {
  return useSettingsStore.getState().settings;
}

export function getPrinter(): DesktopPrinter {
  return useSettingsStore.getState().printer;
}
