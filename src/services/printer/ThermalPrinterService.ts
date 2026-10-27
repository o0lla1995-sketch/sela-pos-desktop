/**
 * services/printer/ThermalPrinterService.ts — مكافئ سطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 * نفس واجهة أندرويد v57 (printJob/PrinterEvents/…) والتنفيذ عبر
 * قناة سطح المكتب (TCP 9100 / COM / WinSpool) التي تفتحها النواة
 * لكل مهمة — لا اتصال دائم ولا بلوتوث. كل أساليب البلوتوث no-ops
 * حتى تعمل الملفات المنقولة حرفياً بلا تعديل.
 */
import type {EscPosOp} from '../../native/nativeBridge';
import {printJob as dispatchJob, kickDrawerIfEnabled} from '../../printing/dispatch';
import type {PrinterRole} from '../HardwareService';
import {api} from '../../lib/tauri';
import {logDiag} from '../../core/diagnostics';

export interface PrinterDevice {
  name: string | null;
  address: string;
  bondState?: number;
}

/** أحداث وهمية — سطح المكتب بلا اكتشاف بلوتوث. */
type Handler<T> = (payload: T) => void;
export const PrinterEvents = {
  onDeviceFound: (_handler: Handler<PrinterDevice>): void => {},
  onDiscoveryFinished: (_handler: Handler<void>): void => {},
  onConnectionChanged: (_handler: Handler<boolean>): void => {},
  onError: (_handler: Handler<string>): void => {},
};

export const ThermalPrinterService = {
  async isBluetoothEnabled(): Promise<boolean> {
    return false;
  },
  async requestEnableBluetooth(): Promise<boolean> {
    return false;
  },
  async getBondedDevices(): Promise<PrinterDevice[]> {
    return [];
  },
  async startDiscovery(): Promise<boolean> {
    return false;
  },
  async stopDiscovery(): Promise<boolean> {
    return true;
  },
  async connect(_address: string): Promise<boolean> {
    return false;
  },
  async disconnect(): Promise<boolean> {
    return true;
  },
  async isConnected(): Promise<boolean> {
    return true; // كل مهمة تفتح قناتها — القناة «جاهزة» إن كانت مضبوطة
  },
  async getConnectedAddress(): Promise<string | null> {
    return null;
  },

  /** الطباعة الفعلية — ترميز البايتات في النواة (escpos.rs).
   *  v70: دور الاستخدام (فواتير/تقارير/باركودات) يحدد القناة إن
   *  عيّن التاجر طابعة مستقلة له — وإلا الرئيسية كما كان. */
  async printJob(ops: EscPosOp[], role?: PrinterRole): Promise<void> {
    try {
      await dispatchJob(ops as unknown as Parameters<typeof dispatchJob>[0], role);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDiag('printer', `فشل إرسال مهمة الطباعة: ${message}`, 'warn');
      throw error;
    }
  },

  /** اختبار سريع عبر أمر النواة. */
  async testPrint(): Promise<void> {
    await api.testPrinter();
  },

  /** نبضة درج النقدية (إن فُعّلت في الإعدادات). */
  async kickDrawer(): Promise<void> {
    await kickDrawerIfEnabled();
  },
};
