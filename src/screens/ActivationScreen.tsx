/**
 * ActivationScreen.tsx — بوابة الاشتراك (منقولة من ActivationScreen الأندرويد):
 * تفعيل بمفتاح، نبضة، إلغاء ارتباط، جهات الاتصال، وحالات القفل الأربع
 * بنفس الرسائل العربية.
 */
import React, {useEffect, useState} from 'react';
import {
  activateLicense,
  heartbeat,
  unbindDevice,
  getCachedContact,
  type LicenseStatus,
} from '../license/LicenseService';
import {LICENSE_CONTACT_FALLBACK} from '../core/config';
import {useToastStore} from '../state/appStores';

export function ActivationScreen({
  status,
  onRefresh,
}: {
  status: LicenseStatus | null;
  onRefresh: () => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const toast = useToastStore(s => s.show);
  const contact = getCachedContact() ?? LICENSE_CONTACT_FALLBACK;

  useEffect(() => {
    void heartbeat(true).finally(onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activate = async () => {
    if (key.trim().length < 4) {
      toast('أدخل مفتاح التفعيل كما استلمته من الإدارة', 'error');
      return;
    }
    setBusy(true);
    try {
      await activateLicense(key, setPhase);
      toast('تم تفعيل الاشتراك بنجاح', 'success');
      setKey('');
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'تعذر التفعيل', 'error');
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  const unbind = async () => {
    setBusy(true);
    try {
      await unbindDevice();
      toast('تم فك ارتباط هذا الجهاز', 'info');
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const lockText: Record<string, string> = {
    expired: 'انتهت صلاحية الاشتراك — جدّده عبر الإدارة',
    revoked: 'تم إيقاف الاشتراك من الإدارة — تواصل معها',
    offline_too_long: 'انقطع الاتصال بالسيرفر طويلاً — اتصل بالإنترنت ثم أعد المحاولة',
    tampered: 'تم رصد تلاعب بساعة الجهاز — تواصل مع الإدارة',
    unknown_device: 'هذا الجهاز غير مرتبط بالاشتراك — أعد التفعيل بمفتاحك',
  };

  return (
    <div className="activation">
      <div className="activation-card">
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <div className="brand-dot">س</div>
          <div>
            <h1>سيلا — نقاط البيع</h1>
            <span style={{color: 'var(--muted)', fontSize: 12}}>
              Sela POS Desktop · إصدار سطح المكتب
            </span>
          </div>
        </div>

        {status?.state === 'locked' ? (
          <div>
            <div className="lock-reason" style={{fontSize: 15, fontWeight: 800}}>
              {lockText[status.lockReason ?? ''] ?? 'الاشتراك غير نشط'}
            </div>
            <p className="lead">
              لا يمكن استخدام النظام قبل تجديد الاشتراك. تواصل مع الإدارة عبر
              أحد قنوات التواصل أدناه ثم أعد المحاولة.
            </p>
          </div>
        ) : (
          <p className="lead">
            أدخل مفتاح التفعيل الذي استلمته من الإدارة. يظل النظام يعمل دون
            إنترنت حتى 72 ساعة، وبعدها يلزم الاتصال مرة واحدة كل فترة للتحقق.
          </p>
        )}

        <div className="field">
          <label>مفتاح التفعيل</label>
          <input
            dir="ltr"
            value={key}
            placeholder="SELA-XXXX-XXXX"
            onChange={e => setKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !busy && activate()}
            disabled={busy}
            style={{letterSpacing: 1.5, textTransform: 'uppercase'}}
          />
        </div>

        <div className="activation-status">{phase}</div>

        <div style={{display: 'flex', gap: 10}}>
          <button className="btn primary" onClick={activate} disabled={busy}>
            {busy ? 'جارٍ التفعيل…' : 'تفعيل'}
          </button>
          <button
            className="btn"
            onClick={() => void heartbeat(true).finally(onRefresh)}
            disabled={busy}>
            إعادة التحقق
          </button>
          {status?.license != null && (
            <button className="btn ghost" onClick={unbind} disabled={busy}>
              فك ارتباط الجهاز
            </button>
          )}
        </div>

        <div>
          <div style={{fontSize: 11.5, color: 'var(--muted)', marginBottom: 8}}>
            {contact.note}
          </div>
          <div className="contacts">
            {contact.phone && (
              <a className="chip brand" href={`tel:${contact.phone}`}>
                هاتف: {contact.phone}
              </a>
            )}
            {contact.whatsapp && (
              <a
                className="chip ok"
                href={`https://wa.me/${contact.whatsapp.replace(/[^\d]/g, '')}`}
                target="_blank">
                واتساب
              </a>
            )}
            {contact.telegram && (
              <a className="chip muted" href={`https://t.me/${contact.telegram}`} target="_blank">
                تيليجرام
              </a>
            )}
            {contact.email && (
              <a className="chip muted" href={`mailto:${contact.email}`}>
                {contact.email}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
