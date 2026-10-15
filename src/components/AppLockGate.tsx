/**
 * components/AppLockGate.tsx — بوابة قفل التطبيق (مكافئة سطح المكتب
 * لـ AppLockGate الأندرويد v57): إذا ضُبط PIN فالتطبيق يُقفل عند
 * الإقلاع وبعد دقائق الخمول المحددة، وتظهر لوحة PIN فوق كل شيء.
 * البصمة غير متاحة على سطح المكتب — رمز PIN هو طريق القفل الوحيد.
 */
import React, {useEffect, useRef, useState} from 'react';
import {useAppLockStore} from '../stores/appLockStore';
import {getNumber, KEYS} from '../storage/storage';
import {PinPad} from './PinPad';

/** دقائق الخمول قبل القفل (نفس إعداد الأندرويد: 0 = فوري، 5 = الافتراضي). */
function lockDelayMinutes(): number {
  return getNumber('app_lock_delay_minutes_v1', 5);
}

export function AppLockGate({children}: {children: React.ReactNode}) {
  const locked = useAppLockStore(s => s.locked);
  const verifyPin = useAppLockStore(s => s.verifyPin);
  const unlock = useAppLockStore(s => s.unlock);
  const load = useAppLockStore(s => s.load);
  const [booted, setBooted] = useState(false);
  const lastActivity = useRef<number>(Date.now());
  const armed = useRef<boolean | null>(null);

  useEffect(() => {
    load();
    setBooted(true);
  }, [load]);

  const enabled = useAppLockStore(s => s.isEnabled());

  // القفل عند الإقلاع (مرة واحدة عند أول تفعيل البوابة).
  useEffect(() => {
    if (!booted || !enabled) return;
    if (armed.current == null) {
      armed.current = true;
      useAppLockStore.getState().lock();
    }
  }, [booted, enabled]);

  // تتبع النشاط + القفل بعد الخمول.
  useEffect(() => {
    if (!enabled) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const events = ['mousedown', 'keydown', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, mark));
    const timer = window.setInterval(() => {
      const delay = lockDelayMinutes();
      const idleMs = Date.now() - lastActivity.current;
      if (delay === 0 || idleMs >= delay * 60 * 1000) {
        useAppLockStore.getState().lock();
      }
    }, 10_000);
    return () => {
      events.forEach(e => window.removeEventListener(e, mark));
      window.clearInterval(timer);
    };
  }, [enabled]);

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
