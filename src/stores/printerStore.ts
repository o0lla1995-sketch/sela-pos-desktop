/**
 * stores/printerStore.ts — حالة الطابعة لسطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 * نفس واجهة أندرويد v57 (status/deviceName/…) لكن الحالة تُشتق من
 * قناة سطح المكتب المحفوظة في الإعدادات (desktop_printer_v1): كل
 * مهمة طباعة تفتح قناتها بنفسها — فوجود قناة مضبوطة يعني «جاهزة».
 * أساليب البلوتوث no-ops (لا اكتشاف على المكتب).
 */
import {create} from 'zustand';
import {logDiag} from '../core/diagnostics';
import type {PrinterDevice} from '../core/types';

export type PrinterStatus = 'disconnected' | 'connecting' | 'connected';

interface PrinterState {
  status: PrinterStatus;
  deviceName: string | null;
  deviceAddress: string | null;
  bonded: PrinterDevice[];
  discovered: PrinterDevice[];
  scanning: boolean;
  lastError: string | null;

  refreshBonded: () => Promise<void>;
  startScan: () => Promise<void>;
  connect: (device: PrinterDevice) => Promise<void>;
  connectSaved: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  checkConnection: () => Promise<void>;
}

/** تحديث الحالة من قناة الإعدادات (المصدر الوحيد للحقيقة). */
async function refreshFromChannel(
  set: (partial: Partial<PrinterState>) => void,
): Promise<void> {
  try {
    const channel = await import('../lib/tauri').then(({api}) =>
      api.currentPrinterChannel(),
    );
    const configured =
      channel != null &&
      (channel as {channel?: string}).channel != null &&
      (channel as {channel?: string}).channel !== 'none';
    set({
      status: configured ? 'connected' : 'disconnected',
      deviceName: configured
        ? String(
            (channel as {host?: string; port?: number; printer?: string})
              .printer ??
              (channel as {host?: string}).host ??
              (channel as {port?: number}).port ??
              'قناة سطح المكتب',
          )
        : null,
      deviceAddress: configured
        ? String((channel as {host?: string}).host ?? '')
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDiag('printer', `تعذر قراءة قناة الطابعة: ${message}`, 'warn');
  }
}

export const usePrinterStore = create<PrinterState>((set, _get) => ({
  status: 'disconnected',
  deviceName: null,
  deviceAddress: null,
  bonded: [],
  discovered: [],
  scanning: false,
  lastError: null,

  refreshBonded: async () => {
    await refreshFromChannel(set);
  },

  startScan: async () => {
    set({scanning: false, lastError: 'البحث البلوتوثي غير مدعوم على سطح المكتب — اضبط القناة من الإعدادات'});
  },

  connect: async () => {
    await refreshFromChannel(set);
  },

  connectSaved: async (): Promise<boolean> => {
    await refreshFromChannel(set);
    return usePrinterStore.getState().status === 'connected';
  },

  disconnect: async () => {
    set({status: 'disconnected', deviceName: null, deviceAddress: null});
  },

  checkConnection: async () => {
    await refreshFromChannel(set);
  },
}));
