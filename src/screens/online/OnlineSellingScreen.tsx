/**
 * OnlineSellingScreen.tsx — إعدادات البيع أونلاين (متجر سيلا ماركت) —
 * منقولة من OnlineSellingScreen الأندرويد (الجولة 56) إلى سطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 * بوابة التاجر إلى متجر سيلا ماركت: تفعيل/تعطيل النشر (registerStore)،
 * ملف المتجر (الاسم، الوصف، التصنيف، المنطقة، الهاتف، واتساب)، مناطق
 * التوصيل بأسعارها (تُضاف لفاتورة المستخدم حسب منطقته)، بوابة إدارة
 * المنتجات المدرجة (منتجات النقطة — الإدراج انتقائي v55)، وحالة
 * المزامنة (آخر مزامنة منتجات / استطلاع طلبات / رفع الصور + زر فوري).
 *
 * التفعيل يتطلب اشتراكاً فعّالاً (الخادم يرفض غير الفعّال ويخفي
 * المنتجات فور انتهاء الاشتراك — حماية مدمجة لا تُكسر).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ensureEngineStarted,
  getImageSyncProgress,
  loadOnlineSettings,
  onlineErrorText,
  registerStore,
  saveOnlineSettings,
  stopEngine,
  syncProducts,
} from '../../services/online/OnlineStoreService';
import {useToastStore} from '../../state/appStores';
import {relativeTime} from '../../core/format';
import type {
  OnlineDeliveryRegion,
  OnlineSellingSettings,
} from '../../core/types';
import './online.css';

export function OnlineSellingScreen({goTo}: {goTo: (key: string) => void}) {
  const toast = useToastStore(s => s.show);

  const [settings, setSettings] = useState<OnlineSellingSettings>(() =>
    loadOnlineSettings(),
  );
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const patch = useCallback((part: Partial<OnlineSellingSettings>) => {
    setSettings(prev => ({...prev, ...part}));
  }, []);

  /** متطلبات التفعيل/النشر — تُفحص على الإعدادات المرشّحة نفسها. */
  const validate = useCallback(
    (target: OnlineSellingSettings): string | null => {
      if (target.enabled) {
        if (target.storeName.trim().length < 2) {
          return 'اسم المتجر مطلوب (حرفان على الأقل)';
        }
        if (target.phone.trim().length < 7) {
          return 'رقم هاتف المتجر مطلوب — يتواصل به المستخدمون';
        }
        if (target.deliveryRegions.length === 0) {
          return 'أضف منطقة توصيل واحدة على الأقل بسعرها — يختارها المستخدم عند الطلب';
        }
      }
      return null;
    },
    [],
  );

  /** حفظ ونشر: تسجيل المتجر على الخادم + نشر الكتالوج المدرج فوراً. */
  const save = useCallback(
    async (next: OnlineSellingSettings) => {
      const problem = validate(next);
      if (problem != null && next.enabled) {
        toast(problem, 'error');
        return;
      }
      setBusy(true);
      try {
        saveOnlineSettings(next);
        await registerStore(next);
        if (next.enabled) {
          ensureEngineStarted();
        } else {
          stopEngine();
        }
        // «حفظ ونشر»: بعد التسجيل ننشر الكتالوج فوراً — المدرجة فقط (v55).
        let savedCount = 0;
        if (next.enabled) {
          try {
            savedCount = await syncProducts();
          } catch {
            // التسجيل نجح — أول مزامنة خلفية جارية من registerStore.
          }
        }
        setSettings(loadOnlineSettings());
        toast(
          next.enabled
            ? `متجرك ${next.storeName} يعمل على سيلا ماركت${
                savedCount > 0
                  ? ` — نُشر ${savedCount} منتجاً`
                  : ' — المنتجات تُنشر الآن'
              }`
            : 'تم إخفاء منتجات متجرك من المتجر — بياناتك محفوظة',
          'success',
        );
      } catch (error) {
        // فشل التسجيل: تُحفظ الإعدادات محلياً معطّلة حتى ينجح التسجيل.
        saveOnlineSettings({...next, enabled: false});
        stopEngine();
        setSettings(loadOnlineSettings());
        toast(onlineErrorText(error), 'error');
      } finally {
        setBusy(false);
      }
    },
    [toast, validate],
  );

  /** مسار التفعيل: المفتاح لا ينقلب قبل استيفاء المتطلبات. */
  const toggleEnabled = useCallback(
    (value: boolean) => {
      const next = {...settings, enabled: value};
      if (value) {
        const problem = validate(next);
        if (problem != null) {
          toast(problem, 'error');
          return;
        }
      }
      void save(next);
    },
    [save, settings, toast, validate],
  );

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const saved = await syncProducts();
      setSettings(loadOnlineSettings());
      toast(`تمت مزامنة ${saved} منتجاً مع المتجر`, 'success');
    } catch (error) {
      toast(onlineErrorText(error), 'error');
    } finally {
      setSyncing(false);
    }
  }, [toast]);

  useEffect(() => {
    ensureEngineStarted();
  }, []);

  // v49: تقدم مزامنة صور المتجر (استطلاع كل ثانيتين أثناء التشغيل).
  const [imageSync, setImageSync] = useState(() => getImageSyncProgress());
  useEffect(() => {
    const timer = setInterval(() => {
      setImageSync(getImageSyncProgress());
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const addRegion = useCallback(() => {
    patch({
      deliveryRegions: [...settings.deliveryRegions, {name: '', feeMinor: 0}],
    });
  }, [patch, settings.deliveryRegions]);

  const setRegion = useCallback(
    (index: number, part: Partial<OnlineDeliveryRegion>) => {
      patch({
        deliveryRegions: settings.deliveryRegions.map((r, i) =>
          i === index ? {...r, ...part} : r,
        ),
      });
    },
    [patch, settings.deliveryRegions],
  );

  const removeRegion = useCallback(
    (index: number) => {
      const confirmed = window.confirm(
        'حذف المنطقة: لن تظهر هذه المنطقة للمستخدمين في الطلبات الجديدة.',
      );
      if (!confirmed) {
        return;
      }
      patch({
        deliveryRegions: settings.deliveryRegions.filter(
          (_, i) => i !== index,
        ),
      });
    },
    [patch, settings.deliveryRegions],
  );

  return (
    <div className="screen">
      <h1>البيع أونلاين</h1>
      <div className="subtitle">
        إعدادات متجر سيلا ماركت — ملف المتجر، مناطق التوصيل، والمزامنة
      </div>

      <div className="grid-2">
        {/* التفعيل + مسار التفعيل */}
        <div className="card" style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
            <label className="olo-switch">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={e => toggleEnabled(e.target.checked)}
              />
              <span className="track" />
            </label>
            <div style={{flex: 1, minWidth: 0}}>
              <div className="olo-card-title">نشر منتجات متجرك أونلاين</div>
              <div className="olo-entry-hint">
                {settings.enabled
                  ? 'متجرك منشور — المنتجات والطلبات تعمل'
                  : 'متجرك مخفي — لن تظهر منتجاتك للمستخدمين'}
              </div>
            </div>
          </div>
          {!settings.enabled && (
            <div className="olo-hint" style={{flexBasis: 'auto'}}>
              عند التفعيل تتزامن منتجاتك المدرجة دورياً ويصلك إشعار عند كل
              طلب. يتطلب التفعيل: اسم متجر (حرفان على الأقل)، هاتف متجر،
              ومنطقة توصيل واحدة بسعرها — ثم «حفظ ونشر».
            </div>
          )}
          {settings.storeNumber != null && (
            <div className="olo-sync-row">
              رقم متجرك في سيلا ماركت:
              <b style={{color: 'var(--brand-ink)'}}>{settings.storeNumber}</b>
            </div>
          )}
          {busy && (
            <div className="olo-sync-row">⏳ جارٍ تسجيل المتجر على الخادم…</div>
          )}
        </div>

        {/* المزامنة */}
        <div className="card" style={{display: 'flex', flexDirection: 'column', gap: 8}}>
          <div className="olo-card-title">المزامنة</div>
          <div className="olo-sync-row">
            ⟳ آخر مزامنة منتجات:
            {settings.lastProductsSyncAt != null
              ? relativeTime(
                  new Date(settings.lastProductsSyncAt).toISOString(),
                )
              : 'لم تتم بعد'}
          </div>
          <div className="olo-sync-row">
            🔔 آخر استطلاع طلبات:
            {settings.lastPollAt != null
              ? relativeTime(new Date(settings.lastPollAt).toISOString())
              : 'لم يتم بعد'}
          </div>
          {imageSync.running ? (
            <div className="olo-sync-row">
              ⏳ رفع صور المنتجات: {imageSync.done}/{imageSync.total} ·{' '}
              {imageSync.uploaded} صورة مرفوعة
            </div>
          ) : (
            <div className="olo-sync-row">
              🖼️ صور المنتجات:
              {imageSync.lastRunAt != null
                ? `آخر رفع ${relativeTime(
                    new Date(imageSync.lastRunAt).toISOString(),
                  )}` +
                  (imageSync.lastError != null
                    ? ' — آخر خطأ محفوظ في التشخيص'
                    : '')
                : 'تُرفع تلقائياً بعد مزامنة المنتجات'}
            </div>
          )}
          <button
            className="btn"
            onClick={() => void syncNow()}
            disabled={syncing || !settings.enabled}>
            {syncing ? 'جارٍ المزامنة…' : '⟳ مزامنة المنتجات الآن'}
          </button>
          <div className="olo-hint" style={{flexBasis: 'auto'}}>
            تلقائية أثناء عمل التطبيق (منتجات كل ١٥ دقيقة، طلبات كل ٦٠
            ثانية) — وهذا زر فوري.
          </div>
        </div>
      </div>

      {/* ملف المتجر */}
      <div className="card" style={{marginTop: 14}}>
        <div className="olo-card-title">ملف المتجر</div>
        <div className="olo-card-sub">يظهر للمستخدمين في المتجر</div>
        <div className="field" style={{marginBottom: 10}}>
          <label>اسم المتجر</label>
          <input
            value={settings.storeName}
            onChange={e => patch({storeName: e.target.value})}
            placeholder="مثال: سوبر ماركت النور"
          />
        </div>
        <div className="field" style={{marginBottom: 10}}>
          <label>وصف مختصر</label>
          <textarea
            style={{minHeight: 72, resize: 'vertical'}}
            value={settings.description}
            onChange={e => patch({description: e.target.value})}
            placeholder="ما يميز متجرك (اختياري)"
          />
        </div>
        <div className="grid-2" style={{marginBottom: 10}}>
          <div className="field">
            <label>التصنيف</label>
            <input
              value={settings.category}
              onChange={e => patch({category: e.target.value})}
              placeholder="بقالة / ملابس / صيدلية…"
            />
          </div>
          <div className="field">
            <label>المنطقة (المدينة)</label>
            <input
              value={settings.region}
              onChange={e => patch({region: e.target.value})}
              placeholder="رام الله…"
            />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>هاتف المتجر</label>
            <input
              dir="ltr"
              style={{textAlign: 'end'}}
              value={settings.phone}
              onChange={e => patch({phone: e.target.value})}
              placeholder="0591234567"
            />
          </div>
          <div className="field">
            <label>واتساب</label>
            <input
              dir="ltr"
              style={{textAlign: 'end'}}
              value={settings.whatsapp}
              onChange={e => patch({whatsapp: e.target.value})}
              placeholder="0591234567"
            />
          </div>
        </div>
      </div>

      {/* مناطق التوصيل وأسعارها */}
      <div className="card" style={{marginTop: 14}}>
        <div className="olo-card-title">مناطق التوصيل وأسعارها</div>
        <div className="olo-card-sub">
          سعر التوصيل يُضاف لفاتورة المستخدم حسب منطقته
        </div>
        {settings.deliveryRegions.map((region, index) => (
          <div className="olo-region-row" key={index} style={{marginBottom: 8}}>
            <div className="field">
              <label>اسم المنطقة</label>
              <input
                value={region.name}
                onChange={e => setRegion(index, {name: e.target.value})}
                placeholder="اسم المنطقة"
              />
            </div>
            <div className="olo-fee-wrap">
              <div className="field">
                <label>سعر التوصيل</label>
                <input
                  dir="ltr"
                  style={{textAlign: 'center'}}
                  value={String(region.feeMinor / 100)}
                  onChange={e => {
                    const num =
                      Number(e.target.value.replace(/[^\d.]/g, '')) || 0;
                    setRegion(index, {
                      feeMinor: Math.min(100000000, Math.round(num * 100)),
                    });
                  }}
                  placeholder="0.00"
                />
              </div>
              <span className="olo-fee-suffix">₪</span>
            </div>
            <button
              className="btn sm danger"
              style={{marginTop: 22}}
              onClick={() => removeRegion(index)}
              title="حذف المنطقة">
              🗑
            </button>
          </div>
        ))}
        <button className="olo-dashed-btn" onClick={addRegion}>
          ＋ إضافة منطقة توصيل
        </button>
      </div>

      {/* v55: بوابة إدارة المنتجات المدرجة */}
      <div className="card" style={{marginTop: 14}}>
        <div className="olo-card-title">منتجات متجري أونلاين</div>
        <div className="olo-card-sub">
          حدد ما يُعرض على المتجر فقط — وحدّثه وزامنه من شاشة واحدة
        </div>
        <button className="olo-entry" onClick={() => goTo('online-products')}>
          <span className="olo-entry-icon">🏪</span>
          <span
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              alignItems: 'flex-start',
              minWidth: 0,
            }}>
            <span className="olo-entry-title">
              إدارة المعروض في المتجر (منتجات النقطة)
            </span>
            <span className="olo-entry-hint">
              إدراج وإلغاء وعرض المخزون والخصم — وكل عملية بيع تُزامن فوراً
            </span>
          </span>
          <span style={{color: 'var(--muted)'}}>‹</span>
        </button>
        <div className="olo-hint" style={{marginTop: 10, flexBasis: 'auto'}}>
          الإدراج انتقائي (v55): تُزامَن المنتجات المعلّمة «مدرج للبيع
          أونلاين» فقط دون باقي منتجاتك. لإضافة منتجات جديدة أو تحديث
          بياناتها انتقل إلى{' '}
          <button
            className="btn sm ghost"
            style={{padding: '2px 8px'}}
            onClick={() => goTo('inventory')}>
            شاشة المخزون
          </button>
          .
        </div>
      </div>

      {/* حفظ ونشر */}
      <button
        className="btn primary"
        style={{marginTop: 14, width: '100%', padding: 14, fontSize: 15}}
        disabled={busy}
        onClick={() => void save({...settings})}>
        {busy ? 'جارٍ الحفظ والنشر…' : 'حفظ ونشر'}
      </button>
      <div className="olo-footer-hint">
        دورة الطلب: قبول ← تجهيز وإرسال (فاتورة + خصم مخزون + مبيعات اليوم +
        دين مؤقت) ← تأكيد التسليم (الدين إلى الخزينة بسند تحصيل). الإرجاع
        والاستبدال من مركز الفواتير كأي بيع عادي.
      </div>
    </div>
  );
}
