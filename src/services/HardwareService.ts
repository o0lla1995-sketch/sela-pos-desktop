/**
 * services/HardwareService.ts — v70 (الجولة 74 #5): طبقة تجريد
 * الأجهزة الطرفية (HAL).
 * ─────────────────────────────────────────────────────────────────
 * طلب التاجر: «طبقة تجريد للأجهزة لتسهيل التعرف التلقائي على
 * الطابعات (فواتير، تقارير، باركودات) وماسحات الباركود وتعيينها
 * لكل موضع استخدام بكل سهولة وبدون تعقيد».
 *
 *  ① الاكتشاف الموحد: طابعات الشبكة (مسح منفذ 9100 تلقائياً) +
 *     المنافذ التسلسلية + طابعات نظام ويندوز — قائمة واحدة
 *     جاهزة للتعيين، بلا أي إدخال يدوي للعناوين.
 *  ② التعيين لكل موضع استخدام (role): فواتير / تقارير / ملصقات
 *     باركود — لكل دور قناته الخاصة إن أراد التاجر طابعة مستقلة،
 *     وإلا يرث القناة الرئيسية (سلوك كل النسخ السابقة كما هو).
 *  ③ طباعة اختبارية فورية لأي قناة مكتشفة قبل تعيينها.
 *  ④ أجهزة الإدخال (مرشحو الماسحات) من Raw Input — مع مربع اختبار
 *     حي: امسح أي باركود والنظام يعرضه أينما كنت.
 */
import {api} from '../lib/tauri';
import {getJson, setJson, KEYS} from '../storage/storage';
import type {DesktopPrinter} from '../stores/settingsStore';

/** موضع الاستخدام — كل دور يمكن تعيين طابعة مستقلة له. */
export type PrinterRole = 'receipt' | 'report' | 'label';

export const PRINTER_ROLES: {
  role: PrinterRole;
  label: string;
  hint: string;
}[] = [
  {role: 'receipt', label: 'الفواتير', hint: 'إيصالات البيع والدين والقسائم'},
  {role: 'report', label: 'التقارير', hint: 'تقارير الكاشير والجرد والملاحق'},
  {role: 'label', label: 'الباركودات', hint: 'ملصقات المنتجات الحرارية'},
];

export interface RolePrinters {
  receipt: DesktopPrinter | null;
  report: DesktopPrinter | null;
  label: DesktopPrinter | null;
}

function loadRoles(): RolePrinters {
  const stored = getJson<Partial<RolePrinters>>(KEYS.desktopPrinterRoles, {});
  return {
    receipt: stored.receipt ?? null,
    report: stored.report ?? null,
    label: stored.label ?? null,
  };
}

/** الطابعة المعينة للدور — أو null ليرث القناة الرئيسية. */
export function rolePrinter(role: PrinterRole): DesktopPrinter | null {
  return loadRoles()[role] ?? null;
}

/** تعيين قناة لدور (null = عودة للميراث الرئيسي). */
export function assignRolePrinter(
  role: PrinterRole,
  printer: DesktopPrinter | null,
): void {
  const roles = loadRoles();
  roles[role] = printer;
  setJson(KEYS.desktopPrinterRoles, roles);
}

/** تسمية وصفية للقناة (عرض القوائم). */
export function describeChannel(printer: DesktopPrinter): string {
  switch (printer.channel) {
    case 'tcp':
      return `شبكة ${printer.host}:${printer.port}`;
    case 'serial':
      return `تسلسلي ${printer.comPort}@${printer.baud}`;
    case 'spool':
      return `نظام ${printer.spoolName}`;
    default:
      return 'غير معيّنة';
  }
}

/** نتيجة الاكتشاف الموحد — قناتان جاهزتان للتعيين والاختبار. */
export interface DiscoveredDevice {
  id: string;
  kind: 'network' | 'serial' | 'spool';
  label: string;
  sub: string;
  channel: DesktopPrinter;
}

export interface InputDevice {
  name: string;
  kind: string;
}

export const HardwareService = {
  /** مسح شامل: طابعات الشبكة (تلقائي) + تسلسلي + نظام ويندوز. */
  async discover(): Promise<DiscoveredDevice[]> {
    const devices: DiscoveredDevice[] = [];
    const [network, serial, spool] = await Promise.all([
      api.hwDiscoverPrinters().catch(() => []),
      api.listSerialPorts().catch(() => [] as string[]),
      api.listSpoolPrinters().catch(() => [] as string[]),
    ]);
    for (const printer of network) {
      devices.push({
        id: `tcp:${printer.host}:${printer.port}`,
        kind: 'network',
        label: `طابعة شبكة ${printer.host}`,
        sub: `منفذ ${printer.port} · استجابة ${printer.latencyMs}مللي`,
        channel: {
          channel: 'tcp',
          host: printer.host,
          port: printer.port,
          comPort: '',
          baud: 115200,
          spoolName: '',
          autoCut: true,
          kickDrawerOnSale: false,
        },
      });
    }
    for (const port of serial) {
      devices.push({
        id: `serial:${port}`,
        kind: 'serial',
        label: `منفذ تسلسلي ${port}`,
        sub: 'طابعة/درج موصولة بمنفذ COM — معدل 115200',
        channel: {
          channel: 'serial',
          host: '',
          port: 9100,
          comPort: port,
          baud: 115200,
          spoolName: '',
          autoCut: true,
          kickDrawerOnSale: false,
        },
      });
    }
    for (const name of spool) {
      devices.push({
        id: `spool:${name}`,
        kind: 'spool',
        label: `${name}`,
        sub: 'طابعة مثبتة في نظام ويندوز (USB/مشغّل)',
        channel: {
          channel: 'spool',
          host: '',
          port: 9100,
          comPort: '',
          baud: 115200,
          spoolName: name,
          autoCut: true,
          kickDrawerOnSale: false,
        },
      });
    }
    return devices;
  },

  /** أجهزة الإدخال المتصلة — مرشحو ماسحات الباركود. */
  async inputDevices(): Promise<InputDevice[]> {
    return api.hwListInputDevices().catch(() => []);
  },

  /** طباعة اختبارية على قناة — يعيد نجاحاً أو رسالة عربية. */
  async testChannel(printer: DesktopPrinter): Promise<void> {
    await api.savePrinterChannel(printer);
    await api.testPrinter();
  },
};
