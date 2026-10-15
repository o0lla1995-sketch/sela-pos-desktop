/**
 * settingsStore.ts — منقول من الأندرويد + حقل قناة الطابعة المكتبية.
 * الحقول الأصلية بنفس أسمائها حتى تعمل نسخة أندرويد الاحتياطية كما هي.
 */
import {create} from 'zustand';
import {getJson, setJson, KEYS} from './storage';
import {
  CODEPAGE_CP1256,
  DEFAULT_LOW_STOCK_THRESHOLD,
} from '../core/config';
import type {PricingMode} from '../core/types';

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

export interface AppSettings {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  footerMessage: string;
  storeLogoPath: string | null;
  defaultPricingMode: PricingMode;
  scannerMinLength: number;
  soundEnabled: boolean;
  /** Receipt */
  paperWidth: '58' | '80';
  codepage: number;
  showProfitOnReceipt: boolean;
  printQrOnReceipt: boolean;
  /** Stock alerts */
  stockAlertsEnabled: boolean;
  lowStockDefaultThreshold: number;
}

const DEFAULTS: AppSettings = {
  storeName: 'متجر sela',
  storePhone: '',
  storeAddress: '',
  footerMessage: 'شكراً لتعاملكم معنا — لا يوجد إرجاع أو استبدال بعد الفاتورة',
  storeLogoPath: null,
  defaultPricingMode: 'RETAIL',
  scannerMinLength: 4,
  soundEnabled: true,
  paperWidth: '58',
  codepage: CODEPAGE_CP1256,
  showProfitOnReceipt: false,
  printQrOnReceipt: false,
  stockAlertsEnabled: true,
  lowStockDefaultThreshold: DEFAULT_LOW_STOCK_THRESHOLD,
};

interface SettingsState {
  settings: AppSettings;
  printer: DesktopPrinter;
  themeMode: 'dark' | 'light';
  update: (patch: Partial<AppSettings>) => void;
  updatePrinter: (patch: Partial<DesktopPrinter>) => void;
  setThemeMode: (mode: 'dark' | 'light') => void;
  reset: () => void;
}

function loadInitial(): AppSettings {
  const stored = getJson<Partial<AppSettings>>(KEYS.settings, {});
  return {...DEFAULTS, ...stored};
}

function loadPrinter(): DesktopPrinter {
  const stored = getJson<Partial<DesktopPrinter>>(KEYS.desktopPrinter, {});
  return {...DEFAULT_PRINTER, ...stored};
}

function persist(settings: AppSettings): void {
  setJson(KEYS.settings, settings);
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
