/**
 * storage.ts — مرآة config.json في الذاكرة (بديل MMKV).
 * القراءة متزامنة من المرآة (كما كان مع MMKV) والكتابة تحدّث المرآة
 * فوراً وتكتب config.json خلف الكواليس — نفس مفاتيح الأندرويد v57
 * حرفياً حتى تُستورد نسخة أندرويد احتياطية وتعمل مباشرة.
 */
import {api} from '../lib/tauri';

export const KEYS = {
  settings: 'settings_json_v1',
  cartDraft: 'cart_draft_v2',
  invoiceCounter: 'invoice_counter_v1',
  invoiceDay: 'invoice_day_v1',
  /** سلسلة فواتير الدين INV-D — عدّاد مستقل (v14). */
  debtInvoiceCounter: 'debt_invoice_counter_v1',
  debtInvoiceDay: 'debt_invoice_day_v1',
  /** سلسلة سندات السداد RCP (v15). */
  paymentReceiptCounter: 'payment_receipt_counter_v1',
  paymentReceiptDay: 'payment_receipt_day_v1',
  /** سلسلة دفتر المتجر المحلي INV-L / RCP-L (v16). */
  localDebtCounter: 'local_debt_counter_v1',
  localDebtDay: 'local_debt_day_v1',
  localReceiptCounter: 'local_receipt_counter_v1',
  localReceiptDay: 'local_receipt_day_v1',
  /** سلسلة المرتجعات RET (v23). */
  returnCounter: 'return_counter_v1',
  returnDay: 'return_day_v1',
  savedPrinter: 'saved_printer_v1',
  desktopPrinter: 'desktop_printer_v1',
  /** v70 (الجولة 74 #5): تعيين طابعة لكل موضع استخدام (HAL). */
  desktopPrinterRoles: 'desktop_printer_roles_v1',
  seededFlag: 'db_seeded_v1',
  notifications: 'notifications_v1',
  stockAlertLedger: 'stock_alert_ledger_v1',
  /** دفتر مخصومات تنبيهات الاشتراك (v47). */
  licenseAlertLedger: 'license_alert_ledger_v1',
  diagnosticsLog: 'diagnostics_log_v1',
  schemaVersion: 'db_schema_version',
  themeMode: 'theme_mode_v1',
  licensePayload: 'license_payload_b64_v1',
  licenseSignature: 'license_signature_b64_v1',
  licenseAnchor: 'license_anchor_v1',
  licenseLastVerify: 'license_last_verify_v1',
  licenseRollbackStrikes: 'license_rollback_strikes_v1',
  licenseServerUrl: 'license_server_url_v1',
  licenseDeviceId: 'license_device_id_v1',
  licenseContact: 'license_contact_v1',
  /** جيل بصمات التعرف الحالية في القاعدة (v10). */
  embeddingModelVersion: 'embedding_model_version_v1',
  /** اقتران التاجر بخدمة صِلة (v11). */
  silaPairing: 'sila_pairing_v1',
  /** سلسلة فواتير القسائم INV-V (v20). */
  voucherInvoiceCounter: 'voucher_invoice_counter_v1',
  voucherInvoiceDay: 'voucher_invoice_day_v1',
  /** مؤشر مزامنة التسويات + وقتها (v20). */
  silaSettlementsCursor: 'sila_settlements_cursor_v1',
  silaSettlementsSyncedAt: 'sila_settlements_synced_at_v1',
  /** قسائم أُلغي تسليمها صراحة من لافتة نقطة البيع (v43). */
  voucherHandoverDismissed: 'voucher_handover_dismissed_v1',
  /** نسخ Google Drive السحابي (v28) — محفوظة للتوافق مع نسخ الهاتف. */
  driveClientId: 'drive_client_id_v1',
  driveClientSecret: 'drive_client_secret_v1',
  driveRefreshToken: 'drive_refresh_token_v1',
  driveAccessToken: 'drive_access_token_v1',
  driveAccessExpiresAt: 'drive_access_expires_at_v1',
  driveAccountEmail: 'drive_account_email_v1',
  driveFolderId: 'drive_folder_id_v1',
  driveAutoEnabled: 'drive_auto_enabled_v1',
  driveAutoIntervalDays: 'drive_auto_interval_days_v1',
  driveLastUploadAt: 'drive_last_upload_at_v1',
  driveHistory: 'drive_history_v1',
  /** وحدة البيع أونلاين — الإعدادات + حالة المزامنة (v48). */
  onlineSettings: 'online_settings_v1',
  onlinePollCursor: 'online_poll_cursor_v1',
  onlineInvoiceCounter: 'online_invoice_counter_v1',
  onlineInvoiceDay: 'online_invoice_day_v1',
  onlineSeenOrders: 'online_seen_orders_v1',
  /** صور المتجر المرفوعة — بية الكتالوج (v49). */
  onlineSyncedImages: 'online_synced_images_v1',
  onlineUploadedHashes: 'online_uploaded_hashes_v1',
} as const;

let mirror: Record<string, unknown> = {};

/** حارس التحميل الواحد — v70: initStorage تُستدعى من main.tsx قبل
 * تقييم أي وحدة متجر، وapp.tsx يستدعيها مجدداً داخل إقلاعه (بلا
 * ضرر): إعادة التحميل الفعلية تحدث مرة واحدة فقط كي لا تُستبدل
 * المرآة بنسخة من القرص تسبق كتابة configSet جارية (سباق إقلاع
 * نظري كان قد يعيد إعداداً قديماً). */
let mirrorLoaded = false;

/** تحميل المرآة عند الإقلاع (مرة واحدة). */
export async function initStorage(): Promise<void> {
  if (mirrorLoaded) {
    return;
  }
  mirrorLoaded = true;
  mirror = await api.configGetAll();
}

function raw(key: string): unknown {
  return mirror[key];
}

export function getJson<T>(key: string, fallback: T): T {
  try {
    const value = raw(key);
    if (value == null) return fallback;
    if (typeof value === 'string') {
      // بذور أندرويد قديمة كانت تخزن بعض القيم كسلاسل JSON.
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
    return value as T;
  } catch {
    return fallback;
  }
}

export function setJson(key: string, value: unknown): void {
  mirror[key] = value;
  void api.configSet(key, value).catch(() => {
    /* أفضل جهد — المرآة محدثة محلياً على أي حال */
  });
}

export function getNumber(key: string, fallback: number): number {
  const value = raw(key);
  if (value == null) return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function setNumber(key: string, value: number): void {
  setJson(key, value);
}

export function getString(key: string, fallback: string): string {
  const value = raw(key);
  if (value == null) return fallback;
  return typeof value === 'string' ? value : String(value);
}

export function setString(key: string, value: string): void {
  setJson(key, value);
}

export function getBoolean(key: string, fallback: boolean): boolean {
  const value = raw(key);
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return fallback;
}

export function setBoolean(key: string, value: boolean): void {
  setJson(key, value);
}

export function storageDelete(key: string): void {
  delete mirror[key];
  void api.configRemove(key).catch(() => {});
}

/** الاسم القديم في أندرويد — نفس الحذف. */
export const deleteKey = storageDelete;

export const storage = {delete: storageDelete};

/** سجل حلقي للتشخيصات (نمط diagnostics الأندرويد). */
export function logDiag(
  scope: string,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const entry = {
    at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    scope,
    level,
    message,
  };
  const log = getJson<{at: string; scope: string; level: string; message: string}[]>(
    KEYS.diagnosticsLog,
    [],
  );
  log.push(entry);
  setJson(KEYS.diagnosticsLog, log.slice(-400));
}
