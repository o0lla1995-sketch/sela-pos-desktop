/**
 * screens/CashiersScreen.tsx — v59 (الجولة 63): الكاشير على الشبكة
 * المحلية — تصميم احترافي كامل (طلب التاجر حرفياً: الأزرار وبطاقات
 * الحسابات وزر الخادم بهوية بصرية راقية).
 * ─────────────────────────────────────────────────────────────────
 *  ① بطاقة الخادم — مفتاح تشغيل راقٍ + مؤشر نبض + رمز QR للاتصال
 *     السريع (امسحه من تطبيق «سيلّا كاشير» فيتصل بلا إدخال يدوي).
 *  ② طلبات الاتصال المعلقة — بطاقات بارزة بانتظار الموافقة.
 *  ③ حسابات الكاشيرين — صورة رمزية بالأحرف الأولى، صلاحيات دقيقة
 *     (بيع الدين / المرتجعات) بمفاتيح فورية، إحصاءاته، أجهزته،
 *     وأزرار مهيكلة (تقرير/تعديل/منع/حذف).
 *  ④ التقرير التفصيلي لكل كاشير — طبقة كاملة: فلترة زمنية
 *     (اليوم/7/30/الكل)، مؤشرات، رسم يومي، أهم المنتجات، سجل
 *     الفواتير، وطباعة حرارية.
 *  ⑤ v69 (الجولة 73): التشغيل التلقائي مع ويندوز + الاتصال عن بُعد
 *     (Tailscale/VPN) — صف التشغيل التلقائي (مفتاح HKCU Run يطلق
 *     البرنامج مخفياً بعد أي إعادة تشغيل)، ولوحة العناوين الكاملة
 *     (شبكة محلية + 100.x) مع زر فتح جدار الحماية لكل الشبكات —
 *     محوّل Tailscale يصنَّف «شبكة عامة» فتُحجب الاتصالات عن بُعد
 *     مهما فُتح المنفذ يدوياً (طلب التاجر نصاً).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {Icon} from '../components/Icon';
import {
  CashiersRepo,
  type CashierDetailedReport,
  type CashierDeviceRecord,
  type CashierRecord,
  type CashierStats,
} from '../database/repositories/CashiersRepo';
import {LanServerService, lanLocalIp} from '../services/lan/LanServerService';
import {
  autostartDisable,
  autostartEnable,
  autostartStatus,
  autostartSupported,
  lanAllIps,
  lanFirewallFix,
  lanFirewallStatus,
  type LanFirewallStatus,
  type LanIpInfo,
} from '../services/lan/LanServerService';
import {ThermalPrinterService} from '../services/printer/ThermalPrinterService';
import {
  buildCashierReportJob,
} from '../services/printer/cashierReportReceipt';
import {useLanStore} from '../stores/lanStore';
import {useSettingsStore} from '../state/settingsStore';
import {useToastStore} from '../state/appStores';
import {formatMoney} from '../core/format';
import {LAN_ONLINE_WINDOW_MS} from '../core/config';
import './cashiers.css';

function deviceOnline(device: CashierDeviceRecord): boolean {
  if (!device.last_seen_at) {
    return false;
  }
  const seen = new Date(device.last_seen_at.replace(' ', 'T')).getTime();
  return Number.isFinite(seen) && Date.now() - seen < LAN_ONLINE_WINDOW_MS;
}

/** لون ثابت لكل كاشير من رقم حسابه (صور رمزية بالأحرف الأولى). */
const AVATAR_COLORS = [
  '#F97316', '#0EA5E9', '#8B5CF6', '#EC4899', '#14B8A6',
  '#F59E0B', '#6366F1', '#10B981', '#EF4444', '#84CC16',
];
function avatarColor(id: number): string {
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2);
  }
  return (parts[0][0] ?? '') + (parts[1][0] ?? '');
}

export function CashiersScreen() {
  const toast = useToastStore(state => state.show);
  const settings = useSettingsStore(state => state.settings);
  const updateSettings = useSettingsStore(state => state.update);
  const lanRunning = useLanStore(state => state.running);
  const lanStarting = useLanStore(state => state.starting);
  const lanError = useLanStore(state => state.lastError);

  const [cashiers, setCashiers] = useState<CashierRecord[]>([]);
  const [devices, setDevices] = useState<
    Record<number, CashierDeviceRecord[]>
  >({});
  const [stats, setStats] = useState<Record<number, CashierStats>>({});
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CashierRecord | null>(null);
  const [localIp, setLocalIp] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [reportFor, setReportFor] = useState<CashierRecord | null>(null);
  // ── v69 (الجولة 73): التشغيل التلقائي + الاتصال عن بُعد ──
  const [autostartOk, setAutostartOk] = useState(false);
  const [autostartOn, setAutostartOn] = useState(false);
  const [allIps, setAllIps] = useState<LanIpInfo[]>([]);
  const [fwStatus, setFwStatus] = useState<LanFirewallStatus | null>(null);
  const [fwBusy, setFwBusy] = useState(false);
  /** عنوان QR المختار (المحلي افتراضياً — يتحول لعنوان Tailscale
   *  بنقرة بطاقته فيتصل الكاشير عن بُعد بلا إدخال يدوي). */
  const [qrTarget, setQrTarget] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await CashiersRepo.list();
      const deviceMap: Record<number, CashierDeviceRecord[]> = {};
      const statsMap: Record<number, CashierStats> = {};
      for (const cashier of list) {
        deviceMap[cashier.id] = await CashiersRepo.devicesFor(cashier.id);
        statsMap[cashier.id] = await CashiersRepo.statsFor(cashier.id);
      }
      setCashiers(list);
      setDevices(deviceMap);
      setStats(statsMap);
    } catch {
      // القاعدة مشغولة مؤقتاً — التحديث التالي يلتقطها.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  // v59: IP المحلي + توليد رمز QR للاتصال السريع — v69: الرمز يعكس
  // العنوان المختار (المحلي افتراضياً، أو عنوان Tailscale بنقرة
  // بطاقته في لوحة العناوين) فيمكن للكاشير البعيد مسحه هو أيضاً.
  const port = settings.lanPort ?? 8950;
  useEffect(() => {
    if (!lanRunning) {
      setLocalIp(null);
      setQrSvg('');
      setQrTarget(null);
      return;
    }
    let alive = true;
    const build = async () => {
      const ip = await lanLocalIp();
      if (!alive) {
        return;
      }
      setLocalIp(ip);
      // أول عنوان يصل هو الافتراضي (المسار الافتراضي للشبكة).
      setQrTarget(prev => prev ?? ip);
    };
    void build();
    const timer = setInterval(build, 12000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [lanRunning]);

  // v69: توليد الرمز فور تغيّر العنوان المستهدف (أو المنفذ أو حالة
  // الخادم) — العنوان المختار في بطاقة الاتصال عن بُعد يحوّل الرمز
  // لعنوان Tailscale فيتمكن الكاشير البعيد من مسحه بلا إدخال يدوي.
  useEffect(() => {
    if (!lanRunning || !qrTarget) {
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const svg = await QRCode.toString(
          `sela-cashier://${qrTarget}:${port}`,
          {type: 'svg', margin: 0, width: 176, color: {dark: '#17171D', light: '#FFFFFF'}},
        );
        if (alive) {
          setQrSvg(svg);
        }
      } catch {
        // العنوان النصي يبقى متاحاً.
      }
    })();
    return () => {
      alive = false;
    };
  }, [lanRunning, port, qrTarget]);

  // ── v69: حالة التشغيل التلقائي (سجل ويندوز) + كل عناوين الجهاز ──
  // العناوين لا تتغير عملياً أثناء الجلسة (عنوان Tailscale ثابت بطبيعته)
  // فتُقرأ مرة عند فتح الشاشة/اشتغال الخادم — لا كل 12 ثانية.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const supported = await autostartSupported();
      const on = supported ? await autostartStatus() : false;
      if (!alive) {
        return;
      }
      setAutostartOk(supported);
      setAutostartOn(on);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!lanRunning) {
      setAllIps([]);
      setFwStatus(null);
      return;
    }
    let alive = true;
    void (async () => {
      const [ips, fw] = await Promise.all([lanAllIps(), lanFirewallStatus()]);
      if (!alive) {
        return;
      }
      setAllIps(ips);
      setFwStatus(fw);
    })();
    return () => {
      alive = false;
    };
  }, [lanRunning]);

  /** v69: تفعيل/إلغاء التشغيل التلقائي مع إقلاع ويندوز. */
  const toggleAutostart = useCallback(
    async (enabled: boolean) => {
      try {
        if (enabled) {
          await autostartEnable();
          setAutostartOn(true);
          toast(
            'فُتح التشغيل التلقائي — سيبدأ سيلا مع ويندوز بالخلفية ويشتغل خادم الكاشير وحده بعد أي إعادة تشغيل',
            'success',
          );
        } else {
          await autostartDisable();
          setAutostartOn(false);
          toast('أُلغي التشغيل التلقائي — لن يبدأ سيلا مع ويندوز', 'info');
        }
      } catch (error) {
        toast(
          error instanceof Error
            ? error.message
            : 'تعذر تغيير التشغيل التلقائي',
          'error',
        );
      }
    },
    [toast],
  );

  /** v69: فتح منفذ الخادم في جدار حماية ويندوز لكل الشبكات —
   *  يحل اتصال Tailscale/VPN (محوّله يصنَّف «شبكة عامة»). موافقة
   *  ويندوز (UAC) مرة واحدة. */
  const fixFirewall = useCallback(async () => {
    if (fwBusy) {
      return;
    }
    setFwBusy(true);
    try {
      await lanFirewallFix(port);
      const fresh = await lanFirewallStatus();
      setFwStatus(fresh);
      if (fresh.tcp && fresh.udp) {
        toast('فُتح المنفذ في جدار الحماية لكل الشبكات — جرّب الاتصال من تطبيق الكاشير الآن', 'success');
      } else {
        toast('أُنفذ الأمر لكن القواعد لم تظهر — أعد المحاولة أو أضفها يدوياً', 'error');
      }
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'فشل فتح المنفذ في جدار الحماية',
        'error',
      );
    } finally {
      setFwBusy(false);
    }
  }, [fwBusy, port, toast]);

  const pendingDevices = useMemo(() => {
    const all: {cashier: CashierRecord; device: CashierDeviceRecord}[] = [];
    for (const cashier of cashiers) {
      for (const device of devices[cashier.id] ?? []) {
        if (device.status === 'pending') {
          all.push({cashier, device});
        }
      }
    }
    return all;
  }, [cashiers, devices]);

  const connectedCount = useMemo(() => {
    let count = 0;
    for (const list of Object.values(devices)) {
      for (const device of list) {
        if (device.status === 'approved' && deviceOnline(device)) {
          count += 1;
        }
      }
    }
    return count;
  }, [devices]);

  const toggleServer = useCallback(
    async (enabled: boolean) => {
      updateSettings({lanServerEnabled: enabled});
      if (enabled) {
        const ok = await LanServerService.start();
        if (!ok) {
          updateSettings({lanServerEnabled: false});
          toast('تعذر تشغيل خادم الكاشير — تأكد من السماح عبر جدار الحماية', 'error');
        } else {
          toast('خادم الكاشير يعمل — ابحث عن المتجر من تطبيق الكاشير', 'success');
          // v69 (الجولة 73): تشغيل الخادم يفتح التشغيل التلقائي مع
          // ويندوز تلقائياً إن لم يكن مفعّلاً — طلب التاجر نصاً: بعد
          // أي إعادة تشغيل يجب أن يعمل الخادم مباشرة بلا تدخّل. يمكنه
          // إلغاءه من الصف المخصص إن أراد.
          try {
            if (autostartOk && !autostartOn) {
              await autostartEnable();
              setAutostartOn(true);
              toast(
                'فُتح التشغيل التلقائي مع ويندوز — الخادم سيبدأ وحده بعد أي إعادة تشغيل للجهاز',
                'info',
              );
            }
          } catch {
            // التشغيل التلقائي فشل (سجل محمي؟) — الخادم يعمل، ولا
            // نربك التاجر بخطأ هنا؛ الصف المخصص يوضح الحالة.
          }
        }
      } else {
        await LanServerService.stop();
        toast('أُوقف خادم الكاشير', 'info');
      }
    },
    [autostartOk, autostartOn, toast, updateSettings],
  );

  const approve = useCallback(
    async (device: CashierDeviceRecord) => {
      await CashiersRepo.approveDevice(device.id);
      toast('تمت الموافقة على الجهاز — يمكن للكاشير الدخول الآن', 'success');
      void refresh();
    },
    [refresh, toast],
  );

  const deny = useCallback(
    async (device: CashierDeviceRecord) => {
      await CashiersRepo.denyDevice(device.id);
      toast('رُفض الجهاز', 'info');
      void refresh();
    },
    [refresh, toast],
  );

  const revoke = useCallback(
    async (device: CashierDeviceRecord) => {
      await CashiersRepo.revokeDevice(device.id);
      toast('أُلغيت ثقة الجهاز — يحتاج موافقتك للدخول مجدداً', 'info');
      void refresh();
    },
    [refresh, toast],
  );

  const togglePerm = useCallback(
    async (cashier: CashierRecord, perm: 'debt' | 'returns') => {
      const patch =
        perm === 'debt'
          ? {canDebt: cashier.can_debt !== 1}
          : {canReturn: cashier.can_return !== 1};
      await CashiersRepo.updateCashier(cashier.id, patch);
      toast(
        perm === 'debt'
          ? patch.canDebt
            ? `فُتح البيع بالدين لـ ${cashier.display_name}`
            : `أُغلق البيع بالدين لـ ${cashier.display_name}`
          : patch.canReturn
          ? `فُتحت المرتجعات لـ ${cashier.display_name}`
          : `أُغلقت المرتجعات لـ ${cashier.display_name}`,
        'info',
      );
      void refresh();
    },
    [refresh, toast],
  );

  const removeCashier = useCallback(
    (cashier: CashierRecord) => {
      if (
        !window.confirm(
          `حذف «${cashier.display_name}»؟ فواتيره تبقى في السجلات، لكن لن يستطيع الدخول مجدداً.`,
        )
      ) {
        return;
      }
      void (async () => {
        await CashiersRepo.removeCashier(cashier.id);
        toast('حُذف حساب الكاشير', 'info');
        void refresh();
      })();
    },
    [refresh, toast],
  );

  const serverOn = settings.lanServerEnabled && lanRunning;

  return (
    <div className="screen">
      <h1>الكاشير على الشبكة المحلية</h1>
      <div className="subtitle">
        {lanRunning
          ? `الخادم يعمل — ${connectedCount} جهاز متصل الآن`
          : 'خادم مطفأ — فعّله ليتصل تطبيق «سيلّا كاشير» من نفس الشبكة'}
      </div>

      {/* ① بطاقة الخادم + QR */}
      <div className={`lan-hero ${serverOn ? '' : 'off'}`} style={{marginBottom: 20}}>
        <div className="lan-hero-main">
          <div className="lan-hero-head">
            <div className={`lan-status-light ${serverOn ? 'on' : 'off'}`}>
              <Icon name={serverOn ? 'store' : 'pause'} size={24} />
            </div>
            <div>
              <div className="lan-hero-title">
                {serverOn ? 'خادم الكاشير يعمل' : 'خادم الكاشير متوقف'}
              </div>
              <div className="lan-hero-sub">
                كل عملية بيع أو إرجاع أو دين من تطبيق الكاشير تُسجَّل هنا
                لحظياً باسم صاحبها في الفواتير والخزينة والمخزون — وتصلك
                إشعاراً فورياً بكل عملية جديدة.
              </div>
            </div>
          </div>
          <div
            className={`lan-server-toggle ${serverOn ? 'on' : ''}`}
            onClick={() => void toggleServer(!serverOn)}>
            <span className="switch-visual" />
            <b>{lanStarting ? 'جارٍ التشغيل…' : serverOn ? 'الخادم يعمل' : 'الخادم مطفأ'}</b>
          </div>
          <div className="lan-chips">
            {lanRunning ? (
              <>
                <span className="chip">المنفذ {port}</span>
                <span className={`chip ${connectedCount > 0 ? 'ok' : ''}`}>
                  {connectedCount > 0 ? `${connectedCount} جهاز متصل` : 'لا اتصالات'}
                </span>
                <span className="chip info">إشعارات لحظية مفعلة</span>
              </>
            ) : (
              <span className="chip">فعّل الخادم ليتصل الكاشير</span>
            )}
          </div>

          {/* v68 (الجولة 72): الاستمرار بالخلفية بعد إغلاق النافذة — */}
          {/* إغلاق النافذة والخادم يعمل يخفيها لأيقونة شريط المهام. */}
          <div
            className={`lan-keep-row ${settings.lanKeepAliveOnClose ? 'on' : ''}`}
            onClick={() =>
              updateSettings({
                lanKeepAliveOnClose: !settings.lanKeepAliveOnClose,
              })
            }>
            <div className="lan-keep-text">
              <b>الاستمرار بالخلفية بعد إغلاق النافذة</b>
              <span>
                عند إغلاق النافذة والخادم يعمل يبقى البرنامج يعمل من
                أيقونة سيلا في شريط المهام — الكاشير لا ينقطع عن
                البيع. للخروج الكامل: أيقونة سيلا ← «إنهاء كامل»، أو
                أوقف الخادم أولاً ثم أغلق.
              </span>
            </div>
            <span className="switch-visual" />
          </div>

          {/* v69 (الجولة 73): التشغيل التلقائي مع إقلاع ويندوز — */}
          {/* طلب التاجر نصاً: بعد إعادة تشغيل الكمبيوتر يجب أن */}
          {/* يعمل الخادم مباشرة بلا فتح البرنامج يدوياً. */}
          {autostartOk ? (
            <div
              className={`lan-keep-row ${autostartOn ? 'on' : ''}`}
              onClick={() => void toggleAutostart(!autostartOn)}>
              <div className="lan-keep-text">
                <b>التشغيل التلقائي مع ويندوز</b>
                <span>
                  سيلا يبدأ مع إقلاع الجهاز بالخلفية (بلا نافذة) وخادم
                  الكاشير يشتغل وحده بعد أي إعادة تشغيل — من أيقونة
                  سيلا في شريط المهام تفتح النافذة متى شئت. يُفتح تلقائياً
                  عند تشغيل الخادم ويمكنك إلغاؤه هنا.
                </span>
              </div>
              <span className="switch-visual" />
            </div>
          ) : null}

          {lanError ? (
            <div className="state-banner">{lanError}</div>
          ) : null}
        </div>

        {lanRunning ? (
          <div className="lan-qr-panel">
            {qrSvg ? (
              <div
                className="lan-qr-frame"
                dangerouslySetInnerHTML={{__html: qrSvg}}
              />
            ) : (
              <div className="lan-qr-frame" style={{padding: '34px 42px'}}>
                <Icon name="qrFrame" size={72} />
              </div>
            )}
            <div className="lan-qr-address">
              {qrTarget ? `${qrTarget}:${port}` : '—'}
            </div>
            <div className="lan-qr-cap">
              امسح الرمز من تطبيق «سيلّا كاشير» للاتصال فوراً — يظهر
              متجرك كذلك تلقائياً في بحث الشبكة
            </div>
          </div>
        ) : null}
      </div>

      {/* v69 (الجولة 73): الاتصال عن بُعد (Tailscale / خارج الشبكة) — */}
      {/* كل عناوين الجهاز + فتح جدار الحماية لكل الشبكات. طلب التاجر */}
      {/* نصاً: عنوان Tailscale الثابت يفشل رغم فتح المنفذ — السبب أن */}
      {/* محوّل Tailscale «شبكة عامة» وويندوز يحجبها بقاعدة «الخاصة». */}
      {lanRunning ? (
        <div className="lan-remote-card">
          <div className="lan-remote-head">
            <div className="lan-remote-icon">
              <Icon name="globe" size={20} />
            </div>
            <div style={{minWidth: 0, flex: 1}}>
              <b>الاتصال عن بُعد — خارج الشبكة (Tailscale / VPN)</b>
              <div className="subtitle" style={{marginTop: 2}}>
                شغّل Tailscale على هذا الجهاز وعلى هاتف الكاشير بنفس
                الحساب، ثم استعمل أحد العناوين أدناه — يعمل من أي مكان
                في العالم.
              </div>
            </div>
          </div>

          {allIps.length > 0 ? (
            <div className="lan-remote-ips">
              {allIps.map(entry => {
                const selected = qrTarget === entry.ip;
                return (
                  <button
                    key={entry.ip}
                    className={`lan-ip-chip ${selected ? 'on' : ''} ${entry.kind}`}
                    onClick={() => setQrTarget(entry.ip)}
                    title="اختيار هذا العنوان لرمز QR">
                    <span className="lan-ip-kind">
                      {entry.kind === 'vpn'
                        ? 'Tailscale/VPN'
                        : entry.kind === 'lan'
                        ? 'شبكة المحل'
                        : 'شبكة أخرى'}
                    </span>
                    <span className="lan-ip-val" dir="ltr">
                      {entry.ip}:{port}
                    </span>
                    {selected ? <span className="lan-ip-qr">QR ✓</span> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="subtitle" style={{padding: '4px 2px'}}>
              تعذّر قراءة عناوين الجهاز — العنوان المحلي معروض أعلى رمز
              QR.
            </div>
          )}

          <div className="lan-remote-fw">
            {fwStatus != null && fwStatus.tcp && fwStatus.udp ? (
              <span className="chip ok">جدار الحماية: المنفذ مفتوح لكل الشبكات ✓</span>
            ) : (
              <>
                <span className="chip warn">
                  جدار حماية ويندوز يحجب الاتصال عن بُعد
                </span>
                <button
                  className="btn sm primary"
                  disabled={fwBusy}
                  onClick={() => void fixFirewall()}>
                  {fwBusy ? 'جارٍ الفتح…' : 'فتح المنفذ الآن (موافقة ويندوز)'}
                </button>
              </>
            )}
          </div>
          <div className="subtitle" style={{fontSize: 11.5, lineHeight: 1.8}}>
            في تطبيق الكاشير على الهاتف: «إدخال يدوي للعنوان» ← ضع عنوان
            Tailscale (يبدأ بـ100.) والمنفذ {port}. إن فشل الاتصال عن بُعد
            بعد Tailscale فاضغط زر الفتح أعلاه — ويندوز يصنّف محوّل
            Tailscale «شبكة عامة» فيحجبه رغم فتح المنفذ يدوياً؛ الزر يسمح
            به لكل الشبكات دفعة واحدة.
          </div>
        </div>
      ) : null}

      {/* ② طلبات اتصال معلقة */}
      {pendingDevices.length > 0 ? (
        <div className="lan-pending" style={{marginBottom: 20}}>
          {pendingDevices.map(({cashier, device}) => (
            <div key={device.id} className="lan-pending-card">
              <div className="lan-pending-icon">
                <Icon name="user" size={21} />
              </div>
              <div style={{minWidth: 0}}>
                <b style={{fontSize: 14.5}}>{cashier.display_name}</b>
                <div className="subtitle" style={{marginTop: 1}}>
                  {device.device_label || 'جهاز'} · {device.ip ?? ''}
                </div>
              </div>
              <span className="chip warn">بانتظار موافقتك</span>
              <div style={{display: 'flex', gap: 8}}>
                <button
                  className="btn sm success"
                  onClick={() => void approve(device)}>
                  السماح
                </button>
                <button
                  className="btn sm danger"
                  onClick={() => void deny(device)}>
                  الرفض
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ③ الحسابات */}
      <div className="toolbar">
        <h1 style={{fontSize: 18, margin: 0}}>حسابات الكاشيرين</h1>
        <span className="subtitle" style={{marginInlineStart: 10}}>
          صلاحيات دقيقة لكل كاشير: البيع بالدين، المرتجعات، وسقف الخصم
        </span>
        <span className="grow" />
        <button
          className="btn sm primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}>
          + كاشير جديد
        </button>
      </div>
      <div className="subtitle" style={{marginBottom: 12}}>
        اسم مستخدم وكلمة مرور لكل كاشير — أنت تمنحها وتتحكم بها
      </div>

      {cashiers.length === 0 && !loading ? (
        <div className="empty">
          <div className="icon" />
          <b>لا كاشيرين بعد</b>
          <span>
            أنشئ حساباً لكل كاشير يعمل على جهازه من تطبيق سيلّا كاشير
          </span>
        </div>
      ) : null}

      <div style={{display: 'grid', gap: 12}}>
        {cashiers.map(cashier => (
          <div
            key={cashier.id}
            className={`cashier-card ${cashier.is_active === 1 ? '' : 'blocked'}`}>
            <div className="cashier-head">
              <div
                className="cashier-avatar"
                style={{background: avatarColor(cashier.id)}}>
                {initials(cashier.display_name)}
              </div>
              <div style={{flex: 1, minWidth: 0}}>
                <div className="cashier-name">{cashier.display_name}</div>
                <div className="cashier-meta">
                  @{cashier.username} · خصم حتى {cashier.max_discount_pct}%
                </div>
              </div>
              <span className={`chip ${cashier.is_active === 1 ? 'ok' : 'danger'}`}>
                {cashier.is_active === 1 ? 'مسموح' : 'ممنوع'}
              </span>
            </div>

            {/* الصلاحيات — طلب التاجر: السماح أو إغلاق الدين والمرتجعات */}
            <div className="perm-pills">
              <div
                className={`perm-pill ${cashier.can_debt === 1 ? 'on' : ''}`}
                onClick={() => void togglePerm(cashier, 'debt')}>
                <Icon name="tag" size={15} />
                <span>
                  {cashier.can_debt === 1 ? 'البيع بالدين مفتوح' : 'البيع بالدين مغلق'}
                </span>
                <span className="perm-dot" />
              </div>
              <div
                className={`perm-pill ${cashier.can_return === 1 ? 'on' : ''}`}
                onClick={() => void togglePerm(cashier, 'returns')}>
                <Icon name="undo" size={15} />
                <span>
                  {cashier.can_return === 1 ? 'المرتجعات مفتوحة' : 'المرتجعات مغلقة'}
                </span>
                <span className="perm-dot" />
              </div>
            </div>

            <div className="cashier-stats">
              <div className="cashier-stat">
                <span className="v">{stats[cashier.id]?.salesCount ?? 0}</span>
                <span className="l">فاتورة</span>
              </div>
              <div className="cashier-stat brand">
                <span className="v">
                  {(stats[cashier.id]?.salesTotal ?? 0).toFixed(2)}
                </span>
                <span className="l">مبيعات ₪</span>
              </div>
              <div className="cashier-stat">
                <span className="v">
                  {Math.abs(stats[cashier.id]?.returnsTotal ?? 0).toFixed(2)}
                </span>
                <span className="l">مرتجعات ₪</span>
              </div>
            </div>

            {(devices[cashier.id] ?? []).length > 0 ? (
              <div className="cashier-devices">
                {(devices[cashier.id] ?? []).map(device => (
                  <div key={device.id} className="cashier-device">
                    <span
                      className={`device-live-dot ${
                        device.status === 'approved' && deviceOnline(device)
                          ? 'on'
                          : ''
                      }`}
                    />
                    <b style={{fontSize: 13}}>{device.device_label || 'جهاز'}</b>
                    <span style={{color: 'var(--muted)', fontSize: 12}}>
                      {device.status === 'approved'
                        ? deviceOnline(device)
                          ? 'متصل الآن'
                          : 'موافق عليه'
                        : device.status === 'pending'
                        ? 'بانتظار الموافقة'
                        : 'مرفوض'}
                    </span>
                    <span className="grow" />
                    {device.status === 'pending' ? (
                      <>
                        <button
                          className="btn sm success"
                          onClick={() => void approve(device)}>
                          سماح
                        </button>
                        <button
                          className="btn sm danger"
                          onClick={() => void deny(device)}>
                          رفض
                        </button>
                      </>
                    ) : device.status === 'approved' ? (
                      <button
                        className="btn sm ghost"
                        onClick={() => void revoke(device)}>
                        قطع الثقة
                      </button>
                    ) : (
                      <button
                        className="btn sm ghost"
                        onClick={() => void approve(device)}>
                        موافقة
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="cashier-actions">
              <button
                className="btn primary"
                onClick={() => setReportFor(cashier)}>
                التقرير التفصيلي
              </button>
              <button
                className="btn"
                onClick={() => {
                  setEditing(cashier);
                  setFormOpen(true);
                }}>
                تعديل
              </button>
              <button
                className="btn"
                onClick={
                  () =>
                    void (async () => {
                      await CashiersRepo.updateCashier(cashier.id, {
                        isActive: cashier.is_active === 1 ? 0 : 1,
                      });
                      void refresh();
                    })()
                }>
                {cashier.is_active === 1 ? 'منع الاتصال' : 'السماح'}
              </button>
              <button
                className="btn danger"
                onClick={() => removeCashier(cashier)}>
                حذف
              </button>
            </div>
          </div>
        ))}
      </div>

      {formOpen ? (
        <CashierFormModal
          cashier={editing ?? undefined}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            void refresh();
          }}
        />
      ) : null}

      {reportFor ? (
        <CashierReportOverlay
          cashier={reportFor}
          onClose={() => setReportFor(null)}
        />
      ) : null}
    </div>
  );
}

/** نموذج إنشاء/تعديل حساب كاشير — مع الصلاحيات. */
function CashierFormModal({
  cashier,
  onClose,
  onSaved,
}: {
  cashier?: CashierRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToastStore(state => state.show);
  const [username, setUsername] = useState(cashier?.username ?? '');
  const [displayName, setDisplayName] = useState(cashier?.display_name ?? '');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [maxDiscount, setMaxDiscount] = useState(
    String(cashier?.max_discount_pct ?? 10),
  );
  const [canDebt, setCanDebt] = useState(cashier ? cashier.can_debt === 1 : true);
  const [canReturn, setCanReturn] = useState(
    cashier ? cashier.can_return === 1 : true,
  );
  const [busy, setBusy] = useState(false);
  const isEdit = cashier != null;

  const save = async () => {
    if (isEdit) {
      if (password.length > 0 && password !== password2) {
        toast('كلمتا المرور غير متطابقتين', 'error');
        return;
      }
      setBusy(true);
      try {
        await CashiersRepo.updateCashier(cashier.id, {
          displayName: displayName.trim() || cashier.display_name,
          maxDiscountPct: Number(maxDiscount) || 0,
          canDebt,
          canReturn,
          ...(password.length >= 4 ? {password} : {}),
        });
        toast('حُدِّث حساب الكاشير', 'success');
        onSaved();
      } catch (error) {
        toast(
          error instanceof Error ? error.message : 'تعذر تحديث الحساب',
          'error',
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!username.trim() || !displayName.trim()) {
      toast('اسم المستخدم واسم الكاشير مطلوبان', 'error');
      return;
    }
    if (password.length < 4) {
      toast('كلمة المرور 4 أحرف على الأقل', 'error');
      return;
    }
    if (password !== password2) {
      toast('كلمتا المرور غير متطابقتين', 'error');
      return;
    }
    setBusy(true);
    try {
      await CashiersRepo.createCashier({
        username,
        password,
        displayName,
        maxDiscountPct: Number(maxDiscount) || 0,
        canDebt,
        canReturn,
      });
      toast(
        'أُنشئ حساب الكاشير — أعطه الاسم وكلمة المرور لتسجيل الدخول',
        'success',
      );
      onSaved();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'تعذر إنشاء الحساب',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay">
      <div className="modal" style={{width: 'min(500px, 94vw)'}}>
        <div className="modal-head">
          <b>{isEdit ? 'تعديل حساب الكاشير' : 'كاشير جديد'}</b>
          <button className="btn sm ghost" onClick={onClose}>
            إغلاق
          </button>
        </div>
        <div className="modal-body">
          {!isEdit ? (
            <div className="field">
              <label>اسم المستخدم (للدخول)</label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="مثال: ahmad"
              />
            </div>
          ) : null}
          <div className="field">
            <label>اسم الكاشير (يظهر في الفواتير)</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="مثال: أحمد"
            />
          </div>
          <div className="field">
            <label>
              {isEdit
                ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)'
                : 'كلمة المرور'}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="4 أحرف على الأقل"
            />
          </div>
          <div className="field">
            <label>تأكيد كلمة المرور</label>
            <input
              type="password"
              value={password2}
              onChange={e => setPassword2(e.target.value)}
              placeholder="أعد كتابة كلمة المرور"
            />
          </div>
          <div className="field">
            <label>أقصى خصم يسمح به للكاشير (%)</label>
            <input
              value={maxDiscount}
              onChange={e => setMaxDiscount(e.target.value)}
              placeholder="10"
            />
          </div>
          {/* الصلاحيات */}
          <div className="perm-pills" style={{marginTop: 4}}>
            <div
              className={`perm-pill ${canDebt ? 'on' : ''}`}
              onClick={() => setCanDebt(v => !v)}>
              <Icon name="tag" size={15} />
              <span>السماح بالبيع بالدين</span>
              <span className="perm-dot" />
            </div>
            <div
              className={`perm-pill ${canReturn ? 'on' : ''}`}
              onClick={() => setCanReturn(v => !v)}>
              <Icon name="undo" size={15} />
              <span>السماح بالمرتجعات والاستبدال</span>
              <span className="perm-dot" />
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            إلغاء
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => void save()}>
            {isEdit ? 'حفظ التعديلات' : 'إنشاء الحساب'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** نوع الفترة الزمنية للتقرير. */
type Period = 'today' | 'week' | 'month' | 'all';

function periodRange(period: Period): {from: string | null; to: string | null} {
  if (period === 'all') {
    return {from: null, to: null};
  }
  const now = new Date();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  if (period === 'today') {
    return {from: to, to};
  }
  const days = period === 'week' ? 6 : 29;
  const start = new Date(now.getTime() - days * 86400000);
  const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
    start.getDate(),
  ).padStart(2, '0')}`;
  return {from, to};
}

const PERIODS: {value: Period; label: string}[] = [
  {value: 'today', label: 'اليوم'},
  {value: 'week', label: '7 أيام'},
  {value: 'month', label: '30 يوماً'},
  {value: 'all', label: 'الكل'},
];

/** ④ التقرير التفصيلي — طبقة كاملة قابلة للطباعة. */
function CashierReportOverlay({
  cashier,
  onClose,
}: {
  cashier: CashierRecord;
  onClose: () => void;
}) {
  const toast = useToastStore(state => state.show);
  const settings = useSettingsStore(state => state.settings);
  const [period, setPeriod] = useState<Period>('today');
  const [report, setReport] = useState<CashierDetailedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const {from, to} = periodRange(period);
        const data = await CashiersRepo.detailedReport(cashier.id, from, to);
        if (alive) {
          setReport(data);
        }
      } catch {
        if (alive) {
          toast('تعذر تحميل التقرير', 'error');
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [cashier.id, period, toast]);

  const maxDaily = useMemo(() => {
    if (!report || report.daily.length === 0) {
      return 1;
    }
    return Math.max(1, ...report.daily.map(d => d.salesTotal));
  }, [report]);

  const print = useCallback(async () => {
    if (!report) {
      return;
    }
    setPrinting(true);
    try {
      const ops = buildCashierReportJob(
        {report, cashierName: cashier.display_name},
        {
          storeName: settings.storeName,
          storePhone: settings.storePhone,
          footerMessage: settings.footerMessage,
          storeLogoPath: settings.storeLogoPath,
          paperWidth: settings.paperWidth,
          codepage: settings.codepage,
          showProfit: settings.showProfitOnReceipt,
        },
      );
      await ThermalPrinterService.printJob(ops, 'report');
      toast('طُبع تقرير الكاشير', 'success');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'فشلت الطباعة',
        'error',
      );
    } finally {
      setPrinting(false);
    }
  }, [cashier.display_name, report, settings, toast]);

  return (
    <div className="cashier-report-overlay" onClick={onClose}>
      <div
        className="cashier-report-panel"
        onClick={e => e.stopPropagation()}>
        <div className="cashier-report-head">
          <Icon name="chart" size={20} />
          <div style={{flex: 1, minWidth: 0}}>
            <b style={{fontSize: 15.5}}>تقرير: {cashier.display_name}</b>
            <div className="subtitle" style={{marginTop: 1}}>
              تقارير الكاشير التفصيلية — قابلة للطباعة والفلترة الزمنية
            </div>
          </div>
          <div style={{display: 'flex', gap: 4}}>
            {PERIODS.map(item => (
              <button
                key={item.value}
                className={`btn sm ${period === item.value ? 'primary' : 'ghost'}`}
                onClick={() => setPeriod(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
          <button
            className="btn sm primary"
            disabled={printing || !report}
            onClick={() => void print()}>
            <Icon name="printer" size={15} /> طباعة
          </button>
          <button className="btn sm ghost" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="cashier-report-body" ref={bodyRef}>
          {loading ? (
            <div className="subtitle">جارٍ التحميل…</div>
          ) : !report || (report.salesCount === 0 && report.returnsCount === 0) ? (
            <div className="empty">
              <div className="icon" />
              <b>لا عمليات في هذه الفترة</b>
              <span>لم يُسجِّل {cashier.display_name} مبيعات أو مرتجعات هنا</span>
            </div>
          ) : (
            <>
              <div className="report-kpis">
                <div className="report-kpi brand">
                  <span className="v">{formatMoney(report.salesTotal)}</span>
                  <span className="l">مبيعات ({report.salesCount} فاتورة)</span>
                </div>
                <div className="report-kpi ok">
                  <span className="v">{formatMoney(report.cashTotal)}</span>
                  <span className="l">نقدي ({report.cashCount})</span>
                </div>
                <div className="report-kpi">
                  <span className="v">{formatMoney(report.debtTotal)}</span>
                  <span className="l">دين ({report.debtCount})</span>
                </div>
                <div className="report-kpi danger">
                  <span className="v">{formatMoney(Math.abs(report.returnsTotal))}</span>
                  <span className="l">مرتجعات ({report.returnsCount})</span>
                </div>
                <div className="report-kpi brand">
                  <span className="v">{formatMoney(report.netTotal)}</span>
                  <span className="l">الصافي</span>
                </div>
                <div className="report-kpi">
                  <span className="v">{formatMoney(report.discountTotal)}</span>
                  <span className="l">خصومات</span>
                </div>
              </div>

              {report.daily.length > 0 ? (
                <>
                  <h1 style={{fontSize: 15, margin: 0}}>المبيعات اليومية</h1>
                  <div className="report-bars">
                    {[...report.daily].reverse().slice(-14).map(day => (
                      <div
                        key={day.day}
                        className="report-bar-col"
                        title={`${day.day} · ${formatMoney(day.salesTotal)}`}>
                        <div
                          className="report-bar"
                          style={{
                            height: `${Math.max(3, (day.salesTotal / maxDaily) * 100)}%`,
                          }}
                        />
                        <span className="report-bar-label">{day.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {report.topProducts.length > 0 ? (
                <>
                  <h1 style={{fontSize: 15, margin: 0}}>أهم المنتجات</h1>
                  <div className="report-list">
                    {report.topProducts.map((product, index) => (
                      <div key={product.productId} className="report-row">
                        <span className="rank">{index + 1}</span>
                        <div style={{minWidth: 0}}>
                          <div className="name">{product.name}</div>
                          <div className="sub">الكمية {product.qty.toFixed(2)}</div>
                        </div>
                        <span className="grow" />
                        <span className="val">{formatMoney(product.total)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <>
                <h1 style={{fontSize: 15, margin: 0}}>
                  سجل الفواتير ({report.invoices.length})
                </h1>
                <div className="report-list">
                  {report.invoices.map(invoice => (
                    <div key={invoice.id} className="report-row">
                      <span className="rank">
                        {invoice.kind === 'return'
                          ? '↩'
                          : invoice.kind === 'debt'
                          ? 'د'
                          : '₪'}
                      </span>
                      <div style={{minWidth: 0}}>
                        <div className="name" style={{direction: 'ltr', textAlign: 'right'}}>
                          {invoice.number}
                        </div>
                        <div className="sub">{invoice.createdAt.slice(0, 16)}</div>
                      </div>
                      <span
                        className={`chip ${
                          invoice.kind === 'return'
                            ? 'danger'
                            : invoice.kind === 'debt'
                            ? 'info'
                            : 'ok'
                        }`}>
                        {invoice.kind === 'return'
                          ? 'مرتجع'
                          : invoice.kind === 'debt'
                          ? 'دين'
                          : 'نقدي'}
                      </span>
                      <span className={`val ${invoice.kind === 'return' ? 'neg' : ''}`}>
                        {formatMoney(invoice.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
