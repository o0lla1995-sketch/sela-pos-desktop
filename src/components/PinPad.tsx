/**
 * components/PinPad.tsx — لوحة رمز PIN v58 (إعادة تصميم كاملة):
 * بطاقة مركّزة بأيقونة قفل داخل دائرة هوية، نقاط ملء نابضة، مفاتيح
 * كبيرة مريحة، اهتزاز عند الخطأ + رسالة واضحة، ودعم لوحة المفاتيح
 * الفعلية (أرقام + Backspace + Enter) لسرعة الكاشير.
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

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  function press(digit: string): void {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      // مهلة قصيرة كي تظهر الخانة الرابعة قبل التمويه.
      timer.current = window.setTimeout(() => {
        if (verify(next)) {
          onDone(true);
        } else {
          setPin('');
          setShake(true);
          setAttempts(a => a + 1);
          window.setTimeout(() => setShake(false), 450);
        }
      }, 140);
    }
  }

  // دعم لوحة المفاتيح الفعلية — أرقام/Backspace/Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        press(e.key);
      } else if (e.key === 'Backspace') {
        setPin(p => p.slice(0, -1));
      } else if (e.key === 'Escape' && cancelable) {
        onCancel?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, cancelable]);

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
            onClick={() => setPin(p => p.slice(0, -1))}
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
