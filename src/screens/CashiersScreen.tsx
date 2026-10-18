/**
 * screens/CashiersScreen.tsx — الكاشير على الشبكة المحلية (v58).
 * ─────────────────────────────────────────────────────────────────
 * شاشة المدير لكل ما يتعلق بتطبيق «سيلّا كاشير» (نفس شاشة الأندرويد
 * بمكيفات سطح المكتب):
 *  ① مفتاح الخادم — تشغيل/إيقاف + المنفذ + المتصلون الآن.
 *  ② طلبات الاتصال المعلقة — كل جهاز جديد يظهر بانتظار الموافقة.
 *  ③ حسابات الكاشيرين — إنشاء/تعديل/السماح/المنع/سقف الخصم/حذف
 *     مع إحصاءات كل كاشير وأجهزته.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  CashiersRepo,
  type CashierDeviceRecord,
  type CashierRecord,
  type CashierStats,
} from '../database/repositories/CashiersRepo';
import {LanServerService} from '../services/lan/LanServerService';
import {useLanStore} from '../stores/lanStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useToastStore} from '../state/appStores';
import {LAN_ONLINE_WINDOW_MS} from '../core/config';
import './settingsv57.css';

function deviceOnline(device: CashierDeviceRecord): boolean {
  if (!device.last_seen_at) {
    return false;
  }
  const seen = new Date(device.last_seen_at.replace(' ', 'T')).getTime();
  return Number.isFinite(seen) && Date.now() - seen < LAN_ONLINE_WINDOW_MS;
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
        }
      } else {
        await LanServerService.stop();
        toast('أُوقف خادم الكاشير', 'info');
      }
    },
    [toast, updateSettings],
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

  return (
    <div className="screen">
      <h1>الكاشير على الشبكة المحلية</h1>
      <div className="subtitle">
        {lanRunning
          ? `الخادم يعمل — ${connectedCount} جهاز متصل الآن`
          : 'خادم مطفأ — فعّله ليتصل تطبيق «سيلّا كاشير» من نفس الشبكة'}
      </div>

      {/* ① الخادم */}
      <div className="toolbar">
        <button
          type="button"
          className={`switch ${settings.lanServerEnabled && lanRunning ? 'on' : ''}`}
          onClick={() => void toggleServer(!(settings.lanServerEnabled && lanRunning))}>
          <span className="track" />
          <b>{lanRunning ? 'الخادم يعمل' : 'الخادم مطفأ'}</b>
        </button>
        {lanRunning ? (
          <>
            <span className="chip">المنفذ {settings.lanPort ?? 8950}</span>
            <span className={`chip ${connectedCount > 0 ? 'ok' : ''}`}>
              {connectedCount > 0 ? `${connectedCount} متصل` : 'لا اتصالات'}
            </span>
          </>
        ) : null}
        <span className="grow" />
        <button
          className="btn sm ghost"
          onClick={() => void refresh()}
          disabled={loading}>
          {loading ? 'جارٍ التحديث…' : 'تحديث'}
        </button>
      </div>
      {lanStarting ? <div className="subtitle">جارٍ التشغيل…</div> : null}
      {lanError ? (
        <div className="state-banner" style={{marginBottom: 12}}>
          {lanError}
        </div>
      ) : null}
      <div className="subtitle" style={{marginBottom: 16}}>
        أبقِ التطبيق مفتوحاً أثناء عمل الكاشير — كل عملية بيع أو إرجاع من
        الكاشير تُسجَّل هنا لحظياً في الفواتير والخزينة والديون باسمه.
        إن ظهر سؤال جدار حماية ويندوز عند أول تشغيل اختر «السماح».
      </div>

      {/* ② طلبات اتصال معلقة */}
      {pendingDevices.length > 0 ? (
        <>
          <h1 style={{fontSize: 18}}>طلبات اتصال بانتظار موافقتك</h1>
          <div className="subtitle">جهاز كاشير يحاول الدخول لأول مرة</div>
          <div style={{display: 'grid', gap: 10, marginBottom: 20}}>
            {pendingDevices.map(({cashier, device}) => (
              <div
                key={device.id}
                className="st-report-grid"
                style={{gridTemplateColumns: '1fr auto auto', alignItems: 'center'}}>
                <div className="cell">
                  <b>{cashier.display_name}</b>
                  <span className="l">
                    {device.device_label || 'جهاز'} · {device.ip ?? ''}
                  </span>
                </div>
                <span className="chip warn">بانتظار الموافقة</span>
                <div className="cell" style={{flexDirection: 'row', gap: 8}}>
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
        </>
      ) : null}

      {/* ③ الحسابات */}
      <div className="toolbar">
        <h1 style={{fontSize: 18, margin: 0}}>حسابات الكاشيرين</h1>
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
            style={{
              border: '1px solid var(--line)',
              borderRadius: 12,
              padding: 14,
              display: 'grid',
              gap: 10,
              background: 'var(--surface-1)',
            }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
              <b style={{fontSize: 16}}>{cashier.display_name}</b>
              <span style={{color: 'var(--muted)', fontSize: 13}}>
                @{cashier.username} · خصم حتى {cashier.max_discount_pct}%
              </span>
              <span className="grow" />
              <span className={`chip ${cashier.is_active === 1 ? 'ok' : 'danger'}`}>
                {cashier.is_active === 1 ? 'مسموح' : 'ممنوع'}
              </span>
            </div>

            <div className="st-report-grid" style={{gridTemplateColumns: 'repeat(3, 1fr)'}}>
              <div className="cell">
                <span className="v">{stats[cashier.id]?.salesCount ?? 0}</span>
                <span className="l">فاتورة</span>
              </div>
              <div className="cell brand">
                <span className="v">
                  {(stats[cashier.id]?.salesTotal ?? 0).toFixed(2)}
                </span>
                <span className="l">مبيعات ₪</span>
              </div>
              <div className="cell">
                <span className="v">
                  {Math.abs(stats[cashier.id]?.returnsTotal ?? 0).toFixed(2)}
                </span>
                <span className="l">مرتجعات ₪</span>
              </div>
            </div>

            {(devices[cashier.id] ?? []).map(device => (
              <div
                key={device.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'var(--surface-2)',
                  borderRadius: 10,
                  padding: '8px 12px',
                }}>
                <b style={{fontSize: 13.5}}>{device.device_label || 'جهاز'}</b>
                <span style={{color: 'var(--muted)', fontSize: 12.5}}>
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

            <div style={{display: 'flex', gap: 8}}>
              <button
                className="btn sm"
                style={{flex: 1}}
                onClick={() =>
                  void (async () => {
                    await CashiersRepo.updateCashier(cashier.id, {
                      isActive: cashier.is_active === 1 ? 0 : 1,
                    });
                    void refresh();
                  })()
                }>
                {cashier.is_active === 1 ? 'منع الاتصال' : 'السماح بالاتصال'}
              </button>
              <button
                className="btn sm"
                style={{flex: 1}}
                onClick={() => {
                  setEditing(cashier);
                  setFormOpen(true);
                }}>
                تعديل
              </button>
              <button
                className="btn sm danger"
                style={{flex: 1}}
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
    </div>
  );
}

/** نموذج إنشاء/تعديل حساب كاشير. */
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
      <div className="modal" style={{width: 'min(480px, 94vw)'}}>
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
