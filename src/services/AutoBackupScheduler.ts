/**
 * services/AutoBackupScheduler.ts — v71 (الجولة 75 #5): مجدول النسخ
 * الاحتياطي التلقائي على مستوى التطبيق كله.
 * ─────────────────────────────────────────────────────────────────
 * جذر المشكلة (طلب التاجر نصاً: «بعد تشغيل التطبيق لعدة فترة لم أجد
 * أي نسخة احتياطية»): فحص الاستحقاق كان يعمل مرة واحدة فقط عند فتح
 * شاشة الإعدادات (useEffect بلا تبعيات داخل SettingsScreen) —
 * التاجر الذي يترك التطبيق مفتوحاً على نقطة البيع أياماً لا تُنشأ
 * له نسخة أبداً لأنه لا يزور الإعدادات.
 *
 * الحل: مجدول واحد على مستوى الجذر (app.tsx):
 *  • فحص فوري عند الإقلاع بعد تهيئة التخزين.
 *  • دورية كل 30 دقيقة طوال عمر التطبيق (من أي شاشة).
 *  • عند الاستحقاق (مرّ الفاصل المضبوط أو أكثر): نسخة صامتة إلى
 *    مجلد التاجر، مع نفس مسار الاحتياط عند رفض المجلد (FALLBACK)
 *    ونفس إشعارات الفشل — بلا ازدواج منطق.
 *  • حارس تكديس: عملية واحدة فقط في كل لحظة (runningRef) — فشل
 *    سابق لا يمنع المحاولة التالية، لكن لا عمليات متوازية أبداً.
 *
 * مفاتيح الإعدادات نفسها المستخدمة في شاشة الإعدادات (المصدر
 * الواحد للحقيقة) — الشاشة تعرضها وتعدّلها، والمجدول يقرأها حياً
 * عند كل فحص كي يسري أي تغيير فوراً بلا إعادة تشغيل.
 */
import {invoke} from '@tauri-apps/api/core';
import {BackupService} from './BackupService';
import {getJson, getNumber, setJson, logDiag} from '../state/storage';
import {useNotificationsStore} from '../stores/notificationsStore';

/** مفاتيح النسخ التلقائي — مشتركة مع شاشة الإعدادات. */
export const AUTO_BACKUP_KEYS = {
  folder: 'auto_backup_folder_v1',
  enabled: 'auto_backup_enabled_v1',
  intervalDays: 'auto_backup_interval_days_v1',
  lastAt: 'auto_backup_last_at_v1',
} as const;

/** دورية الفحص — 30 دقيقة (الفحص رخيص؛ النسخة نفسها عند الاستحقاق). */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

const runningRef = {current: false};

/** هل حان موعد نسخة تلقائية الآن؟ (مفعّل + مجلد + مضى الفاصل). */
export function autoBackupDue(): boolean {
  const enabled = getJson<boolean>(AUTO_BACKUP_KEYS.enabled, false);
  if (!enabled) {
    return false;
  }
  const folder = getJson<string>(AUTO_BACKUP_KEYS.folder, '');
  if (folder.length === 0) {
    return false;
  }
  const intervalDays = getNumber(AUTO_BACKUP_KEYS.intervalDays, 7);
  const lastAt = getJson<string>(AUTO_BACKUP_KEYS.lastAt, '');
  const lastMs = lastAt.length > 0 ? new Date(lastAt).getTime() : 0;
  const elapsedDays = (Date.now() - lastMs) / 86400000;
  return elapsedDays >= intervalDays;
}

/**
 * تنفيذ نسخة تلقائية صامتة الآن — نفس منطق شاشة الإعدادات حرفياً
 * (اسم الملف الآمن لويندوز + مسار FALLBACK + إشعار الفشل) لكن بلا
 * توستات ناجحة كي لا يُزعج التاجر أثناء البيع.
 */
export async function runScheduledAutoBackup(): Promise<void> {
  if (runningRef.current) {
    return;
  }
  runningRef.current = true;
  try {
    const {json, summary} = await BackupService.buildBackupJson({
      compact: true,
    });
    // ISO الزمني نقطتاه محظورتان في أسماء ملفات ويندوز (خطأ 123)
    // — تُستبدلان بشرطات: sela_backup_2026-10-17_14-30-45.json
    const stamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
    const folder = getJson<string>(AUTO_BACKUP_KEYS.folder, '');
    const result = await invoke<string>('write_file_in_folder', {
      folder,
      name: `sela_backup_${stamp}.json`,
      contents: json,
    });
    const now = new Date().toISOString();
    setJson(AUTO_BACKUP_KEYS.lastAt, now);
    if (result.startsWith('FALLBACK:')) {
      const fallbackPath = result.slice('FALLBACK:'.length);
      logDiag(
        'backup',
        `[مجدول] تعذر المجلد المختار — حُفظت النسخة احتياطياً في ${fallbackPath} (${summary.products} منتج، ${summary.sales} فاتورة)`,
        'warn',
      );
      useNotificationsStore
        .getState()
        .push(
          'backup',
          'النسخة التلقائية حُفظت في مجلد بيانات سيلا',
          `تعذر الكتابة في المجلد المختار فحُفظت تلقائياً في: ${fallbackPath}`,
        );
    } else {
      logDiag(
        'backup',
        `[مجدول] نسخة تلقائية إلى ${result} — ${summary.products} منتج، ${summary.sales} فاتورة`,
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logDiag('backup', `[مجدول] فشلت النسخة التلقائية: ${message}`, 'warn');
    useNotificationsStore
      .getState()
      .push('backup', 'فشلت النسخة الاحتياطية التلقائية', message);
  } finally {
    runningRef.current = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** الفحص الدوري — يقرأ الإعدادات حياً عند كل دورة. */
async function tick(): Promise<void> {
  if (autoBackupDue()) {
    await runScheduledAutoBackup();
  }
}

/**
 * تشغيل المجدول — يُستدعى مرة واحدة من app.tsx بعد تهيئة التخزين.
 * فحص فوري عند الإقلاع (بعد مهلة قصيرة كي لا يزاحم إقلاع قاعدة
 * البيانات) ثم دورية كل 30 دقيقة.
 */
export function startAutoBackupScheduler(): void {
  if (timer != null) {
    return;
  }
  window.setTimeout(() => {
    void tick();
  }, 90 * 1000);
  timer = setInterval(() => {
    void tick();
  }, CHECK_INTERVAL_MS);
}
