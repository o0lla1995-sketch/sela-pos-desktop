/**
 * screens/SecuritySettingsScreen.tsx — قفل التطبيق (UI-7 — سطح المكتب).
 * ─────────────────────────────────────────────────────────────────
 * منقول من SecuritySettingsScreen الأندرويد (v13→v57) بمكيفات سطح
 * المكتب: لا بصمة هنا (عتاد الهاتف فقط) — رمز PIN من 4 أرقام هو
 * طريق القفل الوحيد، مع مهلة الخمول (نفس مفتاح الأندرويد
 * 'app_lock_delay_minutes_v1' تقرأه بوابة AppLockGate):
 *
 *  • تعيين رمز جديد (إدخال مرتين) / تغييره (تحقق من القديم أولاً)
 *    / إلغاؤه (تحقق أولاً) — عبر PinPad المشترك.
 *  • الرمز يُحفظ محلياً كتجزئة SHA-512 مملّحة فقط (appLockStore) —
 *    لا يغادر الجهاز أبداً ولا يمكن استعادته إن نُسي.
 *  • «قفل الآن» لتجربة البوابة فوراً.
 */
import React, {useCallback, useRef, useState} from 'react';
import {useAppLockStore} from '../stores/appLockStore';
import {useToastStore} from '../state/appStores';
import {PinPad} from '../components/PinPad';
import {getNumber, setJson} from '../storage/storage';
import {Icon} from '../components/Icon';
import './settingsv57.css';

/** نفس مفتاح الأندرويد v57 — تقرأه AppLockGate كل 10 ثوانٍ. */
const LOCK_DELAY_KEY = 'app_lock_delay_minutes_v1';

/** خيارات مهلة الخمول قبل القفل التلقائي (دقائق؛ 0 = فوري). */
const DELAY_OPTIONS: {value: number; label: string}[] = [
  {value: 0, label: 'فوري'},
  {value: 1, label: 'دقيقة'},
  {value: 5, label: '5 دقائق'},
  {value: 15, label: '15 دقيقة'},
  {value: 30, label: '30 دقيقة'},
];

type PinFlow =
  | null
  | 'set1'
  | 'set2'
  | 'changeVerify'
  | 'change1'
  | 'change2'
  | 'removeVerify';

const FLOW_TITLES: Record<
  Exclude<PinFlow, null>,
  {title: string; subtitle: string}
> = {
  set1: {title: 'تعيين رمز الدخول', subtitle: 'اختر رمزاً من 4 أرقام'},
  set2: {title: 'تأكيد الرمز', subtitle: 'أدخل الرمز نفسه مرة أخرى'},
  changeVerify: {
    title: 'التحقق من الرمز الحالي',
    subtitle: 'أدخل رمزك الحالي للمتابعة',
  },
  change1: {title: 'الرمز الجديد', subtitle: 'اختر رمزاً جديداً من 4 أرقام'},
  change2: {
    title: 'تأكيد الرمز الجديد',
    subtitle: 'أدخل الرمز الجديد نفسه مرة أخرى',
  },
  removeVerify: {
    title: 'التحقق قبل الإلغاء',
    subtitle: 'أدخل رمزك الحالي لإلغاء رمز الدخول',
  },
};

/**
 * محتوى الأمان (بطاقات) — يُضمَّن داخل الإعدادات (§ الأمان) ويُعرض
 * أيضاً كشاشة كاملة عبر SecuritySettingsScreen أدناه.
 */
export function SecurityPanel() {
  const toast = useToastStore(s => s.show);
  const pinHash = useAppLockStore(s => s.pinHash);
  const setPin = useAppLockStore(s => s.setPin);
  const clearPin = useAppLockStore(s => s.clearPin);
  const verifyPin = useAppLockStore(s => s.verifyPin);

  const [flow, setFlow] = useState<PinFlow>(null);
  const [firstPin, setFirstPin] = useState('');
  const [flowError, setFlowError] = useState<string | null>(null);
  const [delay, setDelay] = useState<number>(() =>
    getNumber(LOCK_DELAY_KEY, 5),
  );
  /** التقاط الرمز المدخل من داخل PinPad (verify يُستدعى قبل onDone). */
  const enteredRef = useRef('');

  const pinIsSet = pinHash != null;

  const resetFlow = useCallback(() => {
    setFlow(null);
    setFirstPin('');
    setFlowError(null);
    enteredRef.current = '';
  }, []);

  /** الخطوة التالية لكل مسار — نفس آلة حالات شاشة الأندرويد. */
  const handlePinAccepted = useCallback(() => {
    const pin = enteredRef.current;
    enteredRef.current = '';
    switch (flow) {
      case 'set1':
      case 'change1':
        setFirstPin(pin);
        setFlowError(null);
        setFlow(flow === 'set1' ? 'set2' : 'change2');
        break;
      case 'set2':
      case 'change2':
        if (pin === firstPin) {
          setPin(pin);
          toast('تم تعيين رمز الدخول — سيُطلب عند فتح التطبيق', 'success');
          resetFlow();
        } else {
          setFlowError('الرمزان غير متطابقين — أدخل الرمز من جديد');
          setFirstPin('');
          setFlow(flow === 'set2' ? 'set1' : 'change1');
        }
        break;
      case 'changeVerify':
        setFlowError(null);
        setFlow('change1');
        break;
      case 'removeVerify':
        clearPin();
        toast('أُلغي رمز الدخول — لم يعد التطبيق مقفلاً', 'info');
        resetFlow();
        break;
      default:
        break;
    }
  }, [clearPin, firstPin, flow, resetFlow, setPin, toast]);

  /** verify الخاص بالـ PinPad — بوابات كل مسار:
   *  • التحقق من الرمز الحالي (تغيير/إلغاء) يرفض الخاطئ.
   *  • خطوة التأكيد ترفض عدم التطابق وتهزّ اللوحة.
   *  • كل قبول يُخزَّن الرمز في enteredRef (يُقرأ في onDone). */
  const padVerify = useCallback(
    (pin: string): boolean => {
      if (flow === 'changeVerify' || flow === 'removeVerify') {
        if (!verifyPin(pin)) {
          setFlowError('الرمز الحالي غير صحيح');
          return false;
        }
        setFlowError(null);
        enteredRef.current = pin;
        return true;
      }
      if (flow === 'set2' || flow === 'change2') {
        if (pin !== firstPin) {
          setFlowError('الرمزان غير متطابقين — أدخل الرمز من جديد');
          setFirstPin('');
          setFlow(flow === 'set2' ? 'set1' : 'change1');
          return false;
        }
        setFlowError(null);
        enteredRef.current = pin;
        return true;
      }
      enteredRef.current = pin;
      return true;
    },
    [firstPin, flow, verifyPin],
  );

  const changeDelay = useCallback(
    (minutes: number) => {
      setJson(LOCK_DELAY_KEY, minutes);
      setDelay(minutes);
      toast(
        minutes === 0
          ? 'القفل سيصبح فورياً بعد أي خمول'
          : `سيُقفل التطبيق تلقائياً بعد ${minutes} دقيقة خمول`,
        'info',
      );
    },
    [toast],
  );

  const lockNow = useCallback(() => {
    useAppLockStore.getState().lock();
  }, []);

  return (
    <div className="sv57-stack">
      {/* حالة القفل */}
      <div className="sv57-status-card">
        <span className={`sv57-status-dot ${pinIsSet ? 'on' : ''}`} />
        <div style={{flex: 1}}>
          <div className="t">{pinIsSet ? 'القفل مفعّل' : 'القفل متوقف'}</div>
          <div className="s">
            {pinIsSet
              ? 'يُطلب رمز الدخول عند تشغيل التطبيق وبعد مهلة الخمول — لا يقاطعك أثناء البيع'
              : 'فعّل رمز الدخول لحماية متجرك وبياناتك على هذا الجهاز'}
          </div>
        </div>
        {pinIsSet && <span className="chip ok">مفعّل</span>}
      </div>

      {/* مسارات رمز الدخول */}
      {flow == null ? (
        <div className="card sv57-sec">
          <div className="sv57-sec-head">
            <div>
              <div className="sv57-sec-title">رمز الدخول (4 أرقام)</div>
              <div className="sv57-sec-hint">
                {pinIsSet
                  ? 'غيّر الرمز أو ألغِه — كل تغيير يتحقق من الرمز الحالي أولاً'
                  : 'الطريق الوحيد للقفل على سطح المكتب (البصمة للهاتف فقط)'}
              </div>
            </div>
          </div>
          <div className="sv57-pin-actions">
            {pinIsSet ? (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    setFlowError(null);
                    setFlow('changeVerify');
                  }}>
                  تغيير الرمز
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    setFlowError(null);
                    setFlow('removeVerify');
                  }}>
                  إلغاء الرمز
                </button>
              </>
            ) : (
              <button
                className="btn primary"
                onClick={() => {
                  setFlowError(null);
                  setFlow('set1');
                }}>
                تعيين رمز دخول
              </button>
            )}
          </div>
          <div className="sv57-note">
            الرمز يُحفظ محلياً كتجزئة مملّحة فقط — لا يُرسل لأي خادم، ولا
            يمكن استعادته إن نُسي (عندها أعد تعيينه بعد مسح بيانات التطبيق).
          </div>
        </div>
      ) : (
        <div className="card sv57-sec" style={{alignItems: 'center', gap: 10}}>
          {/* v61 (الجولة 26 #5): key=flow — كل خطوة من المسار تركّب لوحة
              جديدة فارغة. البقعة القديمة: اللوحة تبقى محمّلة بأرقام
              الخطوة السابقة فتتجاهل الضغط الرابع وكان التاجر يمسح
              الرموز بيده ليُدخل الرمز الجديد/التأكيد. */}
          <PinPad
            key={flow}
            title={FLOW_TITLES[flow].title}
            subtitle={FLOW_TITLES[flow].subtitle}
            verify={padVerify}
            onDone={ok => {
              if (ok) {
                handlePinAccepted();
              }
            }}
            onCancel={resetFlow}
            cancelLabel="إلغاء المسار"
          />
          {flowError != null && (
            <div className="sv57-note danger">{flowError}</div>
          )}
        </div>
      )}

      {/* مهلة الخمول */}
      <div className="card sv57-sec">
        <div className="sv57-sec-head">
          <div>
            <div className="sv57-sec-title">القفل التلقائي بعد الخمول</div>
            <div className="sv57-sec-hint">
              متى يُقفل التطبيق تلقائياً إن لم يُلمس — بوابة القفل تفتح فوراً
              بعد أي نقرة عندما تكون «فوري»
            </div>
          </div>
        </div>
        <div className="sv57-delay-grid">
          {DELAY_OPTIONS.map(option => (
            <button
              key={option.value}
              className={`chip-toggle ${delay === option.value ? 'on' : ''}`}
              disabled={!pinIsSet}
              onClick={() => changeDelay(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
        {!pinIsSet && (
          <div className="sv57-note">
            فعّل رمز الدخول أولاً — مهلة الخمول تعمل فقط عندما يكون القفل
            مفعّلاً.
          </div>
        )}
      </div>

      {/* تجربة القفل */}
      <div className="card sv57-sec">
        <div className="sv57-sec-head">
          <div>
            <div className="sv57-sec-title">تجربة البوابة</div>
            <div className="sv57-sec-hint">
              «قفل الآن» يعرض شاشة الدخول فوراً — تأكد أنك تتذكر الرمز قبل
              التجربة
            </div>
          </div>
          <button
            className="btn"
            disabled={!pinIsSet}
            onClick={lockNow}>
            <Icon name="lock" size={15} /> قفل الآن
          </button>
        </div>
      </div>

      {/* كيف يعمل القفل */}
      <div className="card sv57-sec">
        <div className="sv57-sec-title">كيف يعمل القفل؟</div>
        <div className="sv57-note">
          عند تشغيل التطبيق تظهر شاشة القفل تلقائياً ويُطلب رمز الأرقام.
          القفل يعود أيضاً بعد فترة خمول تحددها أعلاه (فوري ← 30 دقيقة) —
          لكنه لا يقاطعك أبداً أثناء البيع أو المسح: كل نقرة تُبقي الجلسة
          حية. البصمة غير متاحة على سطح المكتب (عتاد الهاتف فقط) — رمز
          PIN هو طريق القفل الوحيد هنا.
        </div>
      </div>
    </div>
  );
}

/** الشاشة الكاملة (عند فتح قسم الأمان مباشرة من التنقل). */
export function SecuritySettingsScreen() {
  return (
    <div className="screen">
      <h1>قفل التطبيق والأمان</h1>
      <div className="subtitle">
        رمز دخول 4 أرقام يُطلب عند التشغيل وبعد الخمول — محلي مشفّر بالكامل
      </div>
      <SecurityPanel />
    </div>
  );
}
