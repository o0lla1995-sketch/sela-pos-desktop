/**
 * printing/dispatch.ts — موحّد إرسال الطباعة والدرج:
 *  • job → api.printJob (ترميز بايتات في النواة) بلا أي حوار ويندوز.
 *  • نبضة الدرج عند كل بيع (إن فُعّلت) + زر يدوي.
 *  • حالة الطابعة المعروضة في الواجهة = قناة config فقط (بلا حالة اتصال
 *    دائمة — كل مهمة تفتح قناتها كالأندرويد تماماً).
 */
import {api} from '../lib/tauri';
import {getPrinter} from '../state/settingsStore';
import type {EscPosOp} from './escpos';

/**
 * مصدر الحقيقة الوحيد لقناة الطابعة هو كائن الإعدادات الكامل
 * (desktop_printer_v1) — نفس ما تكتبه شاشة الإعدادات بالضبط، بلا
 * نموذج مصغّر يضيع إعدادات الدرج/القص عند إعادة التشغيل.
 */
async function ensureChannelSaved(): Promise<void> {
  await api.savePrinterChannel(getPrinter());
}

/** إرسال مهمة طباعة صامتة عبر القناة المحفوظة في الإعدادات. */
export async function printJob(ops: EscPosOp[]): Promise<void> {
  await ensureChannelSaved();
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
