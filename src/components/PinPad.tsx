/**
 * components/PinPad.tsx — لوحة رمز PIN v59 (إعادة تصميم كاملة):
 * بطاقة مركّزة بأيقونة قفل داخل دائرة هوية، نقاط ملء نابضة، مفاتيح
 * كبيرة مريحة، اهتزاز عند الخطأ + رسالة واضحة، ودعم لوحة المفاتيح
 * الفعلية (أرقام + Backspace + Enter + Escape) لسرعة الكاشير.
 *
 * v59: القيمة تُدار عبر مرجع حيّ (pinRef) — الكتابة السريعة جداً
 * (قارئ باركود خلف لوحة PIN أو إدخال آلي) كانت تفقد خانات لأن
 * مستمع keydown يحمل نسخة قديمة من الحالة بين الدفعات المتزامنة.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Icon} from './Icon';

interface PinPadProps {
  title: string;
  subtitle?: string;
  verify: (pin: string) => boolean;
  onDone: (ok: boolean) => void;
  cancelable?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
}

const PIN_LENGTH = 4;

export function PinPad({
  title,
  subtitle,
  verify,
  onDone,
  cancelable = true,
  onCancel,
  cancelLabel = 'إلغاء',
}: PinPadProps) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const timer = useRef<number | null>(null);
  /** القيمة الحقيقية — لا تنسخ بين الدفعات أبداً. */
  const pinRef = useRef('');
  /** أحدث onDone/verify/onCancel — بلا إعادة تركيب المستمع. */
  const cbs = useRef({verify, onDone, onCancel, cancelable});
  cbs.current = {verify, onDone, onCancel, cancelable};

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  function setPinValue(next: string): void {
    pinRef.current = next;
    setPin(next);
  }

  function press(digit: string): void {
    const current = pinRef.current;
    if (current.length >= PIN_LENGTH) return;
    const next = current + digit;
    setPinValue(next);
    if (next.length === PIN_LENGTH) {
      // مهلة قصيرة كي تظهر الخانة الرابعة قبل التمويه.
      timer.current = window.setTimeout(() => {
        if (cbs.current.verify(next)) {
          cbs.current.onDone(true);
        } else {
          setPinValue('');
          setShake(true);
          setAttempts(a => a + 1);
          window.setTimeout(() => setShake(false), 450);
        }
      }, 140);
    }
  }

  function backspace(): void {
    setPinValue(pinRef.current.slice(0, -1));
  }

  // دعم لوحة المفاتيح الفعلية — أرقام/Backspace/Enter/Escape.
  // مستمع ثابت يقرأ كل شيء من المراجع: لا حالة قديمة إطلاقاً.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pinRef.current.length === PIN_LENGTH) {
          if (cbs.current.verify(pinRef.current)) {
            cbs.current.onDone(true);
          } else {
            setPinValue('');
            setShake(true);
            setAttempts(a => a + 1);
            window.setTimeout(() => setShake(false), 450);
          }
        }
      } else if (e.key === 'Escape' && cbs.current.cancelable) {
        cbs.current.onCancel?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pinpad-overlay">
      <div className={`pinpad ${shake ? 'shake' : ''}`}>
        <div className="pinpad-lock">
          <Icon name="lock" size={24} />
        </div>
        <div className="pinpad-title">{title}</div>
        {subtitle != null && <div className="pinpad-sub">{subtitle}</div>}
        <div className="pin-dots" dir="ltr">
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              className={`pin-dot ${i < pin.length ? 'filled' : ''} ${
                i === pin.length ? 'cursor' : ''
              }`}
            />
          ))}
        </div>
        {attempts > 0 && (
          <div className="pinpad-error">
            <Icon name="alert" size={14} />
            رمز خاطئ — حاول مجدداً ({attempts})
          </div>
        )}
        <div className="pin-keys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
            <button key={d} className="pin-key" onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <span className="pin-key-spacer" />
          <button className="pin-key" onClick={() => press('0')}>
            0
          </button>
          <button
            className="pin-key pin-key-action"
            onClick={backspace}
            aria-label="حذف">
            <Icon name="backspace" size={20} />
          </button>
        </div>
        {cancelable && (
          <button className="btn ghost sm" style={{marginTop: 8}} onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}
