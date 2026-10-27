/**
 * printing/dispatch.ts — موحّد إرسال الطباعة والدرج:
 *  • job → api.printJob (ترميز بايتات في النواة) بلا أي حوار ويندوز.
 *  • نبضة الدرج عند كل بيع (إن فُعّلت) + زر يدوي.
 *  • حالة الطابعة المعروضة في الواجهة = قناة config فقط (بلا حالة اتصال
 *    دائمة — كل مهمة تفتح قناتها كالأندرويد تماماً).
 *  • v70 (الجولة 74 #5): الطباعة لكل موضع استخدام (role) — إن عيّن
 *    التاجر طابعة مستقلة للفواتير/التقارير/الباركودات من «الأجهزة
 *    الطرفية» تُستخدم هنا؛ وإلا القناة الرئيسية كما كان دائماً.
 */
import {api} from '../lib/tauri';
import {getPrinter} from '../state/settingsStore';
import {rolePrinter, type PrinterRole} from '../services/HardwareService';
import type {EscPosOp} from './escpos';

/**
 * مصدر الحقيقة الوحيد لقناة الطابعة هو كائن الإعدادات الكامل
 * (desktop_printer_v1) — نفس ما تكتبه شاشة الإعدادات بالضبط، بلا
 * نموذج مصغّر يضيع إعدادات الدرج/القص عند إعادة التشغيل.
 */
async function ensureChannelSaved(role?: PrinterRole): Promise<void> {
  const dedicated = role != null ? rolePrinter(role) : null;
  await api.savePrinterChannel(dedicated ?? getPrinter());
}

/** إرسال مهمة طباعة صامتة — دور الاستخدام يحدد القناة إن عُيّنت. */
export async function printJob(ops: EscPosOp[], role?: PrinterRole): Promise<void> {
  await ensureChannelSaved(role);
  await api.printJob(ops);
}

/** نبضة درج النقدية (ESC p) — تُستدعى بعد كل بيع حسب الإعداد. */
export async function kickDrawerIfEnabled(): Promise<void> {
  const printer = getPrinter();
  if (!printer.kickDrawerOnSale || printer.channel === 'none') return;
  try {
    await ensureChannelSaved();
    await api.openDrawer();
  } catch {
    /* فشل الدرج لا يفشل البيع — رسالة تظهر من مستدعيه عند الحاجة */
  }
}
