/**
 * LanServerService — v58 (الجولة 62): صلة التشغيل بين خادم Rust
 * الأصلي (sela-core/src/lan.rs عبر أوامر Tauri) ومنطق البروتوكول
 * النقي (LanHandlers).
 * ─────────────────────────────────────────────────────────────────
 * start(port) يشغّل الخادم (lan_start) ويشترك في حدث `lan://request`
 * القادم من Rust؛ كل طلب يُمرَّر إلى handleLanRequest ثم يُعاد رده
 * عبر أمر lan_respond. stop() يغلق الخادم ويلغي الاشتراك.
 * ensureStarted() يستعمل إعدادات التاجر (تشغيل تلقائي عند الإقلاع).
 *
 * منطق العمل كله في TS: نفس InvoiceService ونفس المعاملات الذرية
 * التي تمر منها مبيعات نقطة البيع نفسها — فالخزينة والديون
 * والمخزون تتحدث لحظياً وبلا أي مسار مزامنة موازٍ.
 */
import {invoke} from '../../lib/tauri';
import {listen, type UnlistenFn} from '@tauri-apps/api/event';
import {
  handleLanRequest,
  setLanEventSink,
  setPrinterStatusProvider,
  type LanEvent,
} from './LanHandlers';
import {usePrinterStore} from '../../stores/printerStore';
import {useLanStore} from '../../stores/lanStore';
import {useSettingsStore} from '../../stores/settingsStore';
import {notificationsStore} from '../../stores/notificationsStore';
import {formatMoney} from '../../core/format';
import {LAN_DEFAULT_PORT} from '../../core/config';

let unlisten: UnlistenFn | null = null;
let currentPort = LAN_DEFAULT_PORT;

// ── v59 (الجولة 63): أحداث الخادم الحية → مركز الإشعارات +
// النافذة العائمة. المدير يرى كل عملية كاشير لحظياً (بيع/مرتجع/
// جهاز جديد ينتظر موافقته) دون أن يفتح شاشة الكاشير.
function lanEventToNotification(event: LanEvent): void {
  try {
    if (event.kind === 'sale') {
      const title = event.offline
        ? `كاشير: بيع بعد انقطاع — ${event.cashierName}`
        : `بيع من كاشير — ${event.cashierName}`;
      const body = `فاتورة ${event.invoiceNumber} · ${event.itemCount} صنف · ${formatMoney(
        event.total,
      )}${event.debt ? ' · دين' : ''}`;
      notificationsStore.push('cashier', title, body, {system: true});
    } else if (event.kind === 'return') {
      const title = event.isExchange
        ? `استبدال من كاشير — ${event.cashierName}`
        : `مرتجع من كاشير — ${event.cashierName}`;
      const body = `إشعار ${event.returnNumber} · ${formatMoney(
        event.refundMinor / 100,
      )}${event.isExchange ? ' · استبدال' : ''}`;
      notificationsStore.push('cashier', title, body, {system: true});
    } else if (event.kind === 'device_pending') {
      notificationsStore.push(
        'cashier',
        'جهاز كاشير ينتظر موافقتك',
        `${event.cashierName} · ${event.deviceLabel}${
          event.ip ? ` · ${event.ip}` : ''
        } — افتح شاشة الكاشير للسماح أو الرفض`,
        {system: true},
      );
    } else if (event.kind === 'login') {
      notificationsStore.push(
        'cashier',
        `دخول كاشير — ${event.cashierName}`,
        `${event.deviceLabel} سجّل الدخول الآن`,
      );
    }
  } catch {
    // إشعار فاشل لا يمس العملية نفسها أبداً.
  }
}
setLanEventSink(lanEventToNotification);

// v60: مزوّد حالة الطابعة — من متجر الطابعة (مشتق من إعدادات طباعة
// سطح المكتب)؛ يغذي /api/printer-status وقرار طباعة فواتير الكاشير
// من طابعة نقطة البيع عند البيع/الإرجاع.
setPrinterStatusProvider(async () => {
  const state = usePrinterStore.getState();
  return {
    connected: state.status === 'connected',
    name: state.deviceName ?? null,
  };
});

/** v59: عنوان IP المحلي (لرمز QR للاتصال السريع). */
export async function lanLocalIp(): Promise<string | null> {
  try {
    return await invoke<string | null>('lan_local_ip');
  } catch {
    return null;
  }
}

/** تحويل نص الاستعلام (?a=1&b=2) إلى خريطة. */
function parseQuery(raw: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) {
    return out;
  }
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    try {
      out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(
        pair.slice(eq + 1),
      );
    } catch {
      out[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return out;
}

/** خارج Tauri (معاينة المتصفح): الخادم غير متاح — لا يُعطَّل شيء. */
function insideTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export const LanServerService = {
  isRunning(): boolean {
    return useLanStore.getState().running;
  },

  async start(port?: number): Promise<boolean> {
    const store = useLanStore.getState();
    if (store.running || store.starting) {
      return true;
    }
    if (!insideTauri()) {
      useLanStore
        .getState()
        .setError('خادم الكاشير يعمل داخل تطبيق سطح المكتب فقط');
      return false;
    }
    const settings = useSettingsStore.getState().settings;
    const chosenPort = port ?? settings.lanPort ?? LAN_DEFAULT_PORT;
    useLanStore.getState().setStarting(true);
    try {
      await invoke<boolean>('lan_start', {
        port: chosenPort,
        storeName: settings.storeName,
      });
      currentPort = chosenPort;
      useLanStore.getState().setPort(chosenPort);
      useLanStore.getState().setRunning(true);
      useLanStore.getState().setError(null);

      if (unlisten == null) {
        unlisten = await listen<{
          id: number;
          method: string;
          path: string;
          query?: string;
          body?: string;
          auth?: string | null;
          ip?: string | null;
        }>('lan://request', event => {
          const payload = event.payload;
          useLanStore.getState().bumpRequests();
          handleLanRequest({
            id: String(payload.id),
            method: payload.method,
            path: payload.path,
            query: parseQuery(payload.query),
            body: payload.body ?? '',
            auth: payload.auth ?? null,
            ip: payload.ip ?? null,
          })
            .then(response => {
              void invoke('lan_respond', {
                id: Number(payload.id),
                status: response.status,
                body: response.body,
              });
            })
            .catch(error => {
              const message =
                error instanceof Error
                  ? error.message
                  : 'خطأ غير متوقع في الخادم';
              void invoke('lan_respond', {
                id: Number(payload.id),
                status: 400,
                body: JSON.stringify({ok: false, error: message}),
              });
            });
        });
      }
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'تعذر تشغيل خادم الكاشير';
      useLanStore.getState().setError(String(message));
      return false;
    } finally {
      useLanStore.getState().setStarting(false);
    }
  },

  async stop(): Promise<void> {
    if (insideTauri()) {
      try {
        await invoke('lan_stop');
      } catch {
        // الإيقاف لا يفشل أبداً أمام المستخدم.
      }
    }
    unlisten?.();
    unlisten = null;
    useLanStore.getState().setRunning(false);
  },

  /** الإقلاع وفق إعدادات التاجر — يشغّل الخادم إن كان مفعّلاً. */
  async ensureStarted(): Promise<void> {
    const settings = useSettingsStore.getState().settings;
    if (settings.lanServerEnabled) {
      await this.start();
    }
  },

  port(): number {
    return currentPort;
  },
};
