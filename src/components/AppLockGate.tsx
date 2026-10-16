/**
 * components/AppLockGate.tsx — بوابة قفل التطبيق (مكافئة سطح المكتب
 * لـ AppLockGate الأندرويد v57): إذا ضُبط PIN فالتطبيق يُقفل عند
 * الإقلاع وبعد دقائق الخمول المحددة، وتظهر لوحة PIN فوق كل شيء.
 * البصمة غير متاحة على سطح المكتب — رمز PIN هو طريق القفل الوحيد.
 *
 * v58 (جذر «شاشة البيع لا تعمل»): كان المؤقت القديم يقفل بلا شرط
 * كل 10 ثوانٍ عند مهلة «فوري» (delay === 0) حتى أثناء البيع النشط —
 * فأصبحت نقطة البيع غير قابلة للاستخدام. الدلالة الصحيحة:
 *  • «فوري» = يقفل بعد 20 ثانية من آخر نشاط (خطوة سماح قصيرة)،
 *    وليس أبداً أثناء النقر والكتابة الفعالة.
 *  • بقية المهلات = دقائق خمول كاملة بعد آخر تفاعل.
 * كما لم يعد التطبيق يقفل لحظة تعيين الرمز أول مرة من الإعدادات —
 * القفل عند الإقلاع البارد فقط (نفس سلوك الأندرويد: «عند فتح
 * التطبيق»)، وتفعيل الرمز منتصف الجلسة يبدأ الحماية من الآن دون
 * قطع عمل الكاشير.
 */
import React, {useEffect, useRef, useState} from 'react';
import {useAppLockStore} from '../stores/appLockStore';
import {getNumber, getString} from '../storage/storage';
import {PinPad} from './PinPad';

/** مفتاح التجزئة المخزّن — نفس مفتاح appLockStore. */
const PIN_HASH_KEY = 'applock_pin_hash_v1';

/** دقائق الخمول قبل القفل (نفس إعداد الأندرويد: 0 = فوري، 5 = الافتراضي). */
function lockDelayMinutes(): number {
  return getNumber('app_lock_delay_minutes_v1', 5);
}

/** «فوري» لا تعني القفل أثناء العمل — بل بعد هذه المهلة من السكون. */
const IMMEDIATE_GRACE_MS = 20_000;

export function AppLockGate({children}: {children: React.ReactNode}) {
  const locked = useAppLockStore(s => s.locked);
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const unlock = useAppLockStore(s => s.unlock);
  const load = useAppLockStore(s => s.load);
  const [booted, setBooted] = useState(false);
  const lastActivity = useRef<number>(Date.now());

  useEffect(() => {
    load();
    // القفل عند الإقلاع البارد فقط: إذا كان رمز مضبوطاً قبل فتح
    // التطبيق. تعيين الرمز منتصف الجلسة لا يقفل فوراً — يبدأ من
    // الآن فصاعداً (خمول/إقلاع قادم) دون مقاطعة الكاشير.
    const hadPinAtBoot = getString(PIN_HASH_KEY, '').length > 0;
    if (hadPinAtBoot) {
      useAppLockStore.getState().lock();
    }
    setBooted(true);
  }, [load]);

  const enabled = useAppLockStore(s => s.isEnabled());

  // تتبع النشاط + القفل بعد الخمول الحقيقي.
  useEffect(() => {
    if (!enabled || !booted) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach(e => window.addEventListener(e, mark, {passive: true}));
    const timer = window.setInterval(() => {
      const delay = lockDelayMinutes();
      const lockAfterMs = delay <= 0 ? IMMEDIATE_GRACE_MS : delay * 60_000;
      const idleMs = Date.now() - lastActivity.current;
      if (idleMs >= lockAfterMs) {
        useAppLockStore.getState().lock();
      }
    }, 5_000);
    return () => {
      events.forEach(e => window.removeEventListener(e, mark));
      window.clearInterval(timer);
    };
  }, [enabled, booted]);

  if (locked) {
    return (
      <PinPad
        title="سيلا مقفلة"
        subtitle="أدخل رمز PIN للمتابعة"
        verify={verifyPin}
        onDone={ok => {
          if (ok) {
            unlock();
            lastActivity.current = Date.now();
          }
        }}
        cancelable={false}
      />
    );
  }

  return <>{children}</>;
}
