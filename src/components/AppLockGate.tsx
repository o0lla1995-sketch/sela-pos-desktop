/**
 * components/AppLockGate.tsx — بوابة قفل التطبيق (مكافئة سطح المكتب
 * لـ AppLockGate الأندرويد v57): إذا ضُبط PIN فالتطبيق يُقفل عند
 * الإقلاع وبعد دقائق الخمول المحددة، وتظهر لوحة PIN فوق كل شيء.
 * البصمة غير متاحة على سطح المكتب — رمز PIN هو طريق القفل الوحيد.
 *
 * v59 (جولة المستخدم #8): بوابة الدخول صارت **متزامنة مع أول إطار**
 * — في v58 كان القفل يُفعّل داخل useEffect أي بعد رسم الشاشات:
 * كانت نقطة البيع (وأي شاشة) تظهر وميضاً قبل لوحة PIN، ويكفي ذلك
 * لتفهم «البيع يحدث قبل الدخول». الآن إن كان رمز مضبوطاً فأول ما
 * يُرسم هو لوحة PIN نفسها — لا شاشة بيع ولا أي محتوى قبلها.
 *
 * كذلك يُكتم موجّه الباركود (الخطاف الأصلي + بديل JS) طوال فتح
 * القفل: لا يُضاف منتج لسلة ولا يُنفَّذ أي مسح قبل الدخول.
 *
 * v58 (سلوك مؤقت الخمول — محفوظ): «فوري» = يقفل بعد 20 ثانية من
 * آخر نشاط (خطوة سماح قصيرة)، وليس أبداً أثناء النقر والكتابة
 * الفعالة؛ بقية المهلات = دقائق خمول كاملة بعد آخر تفاعل.
 */
import React, {useEffect, useRef, useState} from 'react';
import {useAppLockStore} from '../stores/appLockStore';
import {getNumber, getString} from '../storage/storage';
import {suppressScanner} from '../lib/scanner';
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
  const [unlockedOnce, setUnlockedOnce] = useState(false);

  /**
   * هل كان الرمز مضبوطاً لحظة فتح التطبيق؟ يُقرأ مرة واحدة أثناء
   * أول رسم — المرآة (config.json) محمّلة قبل تركيب البوابة في
   * app.tsx فالقراءة متزامنة وموثوقة، وبها تُرسم لوحة PIN من أول
   * إطار بلا وميض للمحتوى. تعيين الرمز منتصف الجلسة لا يقفل فوراً
   * (سلوك مقصود كي لا يقطع الكاشير) لكن الإقلاع التالي يبدأ مقفلاً.
   */
  const pinAtBoot = useRef<boolean | null>(null);
  if (pinAtBoot.current === null) {
    // قراءة متزامنة أثناء أول رسم فقط (المرآة محمّلة قبل التركيب) —
    // بلا أي كتابة للمخزن أثناء الرسم، فلا إعادة رسم ولا تحذيرات.
    pinAtBoot.current = getString(PIN_HASH_KEY, '').length > 0;
  }
  const gateUp = locked || (pinAtBoot.current === true && !unlockedOnce);

  const enabled = useAppLockStore(s => s.isEnabled());
  const lastActivity = useRef<number>(Date.now());

  // تحميل حالة الرمز للتحقق (verifyPin يقرأ المخزن لحظة الاستخدام —
  // قبل أول ضغطة على اللوحة بزمن).
  useEffect(() => {
    load();
  }, [load]);

  // مؤقت الخمول: قفل تلقائي بعد آخر تفاعل حقيقي.
  useEffect(() => {
    if (!enabled) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // كتم الباركود طالما البوابة مغلقة — لا بيع ولا مسح قبل الدخول.
  useEffect(() => {
    void suppressScanner(gateUp);
    return () => {
      void suppressScanner(false);
    };
  }, [gateUp]);

  if (gateUp) {
    return (
      <PinPad
        title="سيلا مقفلة"
        subtitle="أدخل رمز PIN للمتابعة"
        verify={verifyPin}
        onDone={ok => {
          if (ok) {
            unlock();
            setUnlockedOnce(true);
            lastActivity.current = Date.now();
          }
        }}
        cancelable={false}
      />
    );
  }

  return <>{children}</>;
}
