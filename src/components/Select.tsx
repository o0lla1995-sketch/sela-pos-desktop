/**
 * components/Select.tsx — قائمة منسدلة مخصّصة v61 (الجولة 26 #7).
 * ─────────────────────────────────────────────────────────────────
 * بديل الـ <select> الأصلي بكل مواضعه: القائمة المنبثقة الأصلية
 * تبدو نظامية وغير متناسقة مع هوية سيلا، وضيّقة داخل جداول
 * وحدات البيع (ملاحظة التاجر: «القائمة المنسدلة مضغوطة»).
 *
 *  • زر مغلق بنفس لغة حقول النظام + سهم يفتح القائمة.
 *  • قائمة منبثقة عائمة (لا تضغطها الخلايا) بعرض الزر على الأقل،
 *    تنقلب للأعلى إن ضاق المساح أسفله، وتمرر داخلياً عند الطول.
 *  • لوحة مفاتيح كاملة: ↑/↓ تحرّكان الخيار النشط، Enter يختاره،
 *    Escape يغلق، Home/End للطرفين، وطباعة حرف تقفز لأول مطابقة.
 *  • ARIA (combobox/listbox/option) وتمييز الخيار المختار.
 *  • أثناء فتح القائمة يُرفع علم عام على <html> كي لا تلتقط
 *    نوافذ الحوار Enter كتأكيد وهي في الحقيقة اختيار خيار
 *    (useEnterConfirm وuseAmountKeyboard يتحققان منه).
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Icon} from './Icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** علم «قائمة منسدلة مفتوحة» — تقرأه خطافات Enter في النظام. */
const SELECT_OPEN_ATTR = 'data-sela-select-open';
let openCount = 0;

function markOpen(delta: number): void {
  openCount = Math.max(0, openCount + delta);
  if (openCount > 0) {
    document.documentElement.setAttribute(SELECT_OPEN_ATTR, '1');
  } else {
    document.documentElement.removeAttribute(SELECT_OPEN_ATTR);
  }
}

/** هل ثمة قائمة منسدلة مفتوحة الآن؟ (للخطافات الخارجية) */
export function selaSelectOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.hasAttribute(SELECT_OPEN_ATTR)
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  style,
  title,
  ariaLabel,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [flipUp, setFlipUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const typeAheadRef = useRef({chars: '', at: 0});

  const selectedIdx = useMemo(
    () => options.findIndex(o => o.value === value),
    [options, value],
  );
  const selected = selectedIdx >= 0 ? options[selectedIdx] : null;

  // فتح/إغلاق مع إدارة العلم العام + مؤشر الخيار النشط.
  const openList = useCallback(() => {
    setActiveIdx(selectedIdx >= 0 ? selectedIdx : 0);
    setOpen(true);
  }, [selectedIdx]);

  const closeList = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    markOpen(1);
    return () => markOpen(-1);
  }, [open]);

  // إغلاق بالنقر خارج القائمة.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node) !== true) {
        closeList();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, closeList]);

  // عزل مفاتيح القائمة عن مستمعي الشاشة (الأسهم كانت تحرّك تحديد
  // الشبكة تحت النافذة، وEnter كان يؤكد حوارات مفتوحة) — تُوقف عند
  // حد الالتقاط قبل وصولها لأي مستمع آخر. الأحداث الواقعة داخل
  // القائمة نفسها تُترك تمضي لزرّها (معالجها الخاص يوقفها بعد ذلك).
  useEffect(() => {
    if (!open) return;
    const onWinKey = (e: KeyboardEvent) => {
      if (
        e.key !== 'Enter' &&
        e.key !== 'NumpadEnter' &&
        e.key !== 'Escape' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'Home' &&
        e.key !== 'End'
      ) {
        return;
      }
      if (wrapRef.current?.contains(e.target as Node) === true) {
        return; // ملك معالج القائمة — يختار/يغلق بنفسه.
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', onWinKey, true);
    return () => window.removeEventListener('keydown', onWinKey, true);
  }, [open]);

  // اتجاه القائمة: أسفل الزر، أو أعلاه إن ضاقت المساحة — والمساحة
  // تُقاس حتى أقرب سلف قابل للتمرير (نافذة حوار بارتفاع محدود) لا
  // حتى حافة الشاشة فقط، كي لا تُقص القائمة داخل النافذة.
  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (wrap == null) return;
    let limitBottom = window.innerHeight;
    let node: HTMLElement | null = wrap.parentElement;
    while (node != null && node !== document.body) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        limitBottom = Math.min(limitBottom, node.getBoundingClientRect().bottom);
        break;
      }
      node = node.parentElement;
    }
    const rect = wrap.getBoundingClientRect();
    const below = Math.max(0, limitBottom - rect.bottom);
    setFlipUp(below < 220 && rect.top > below);
    // تمركز الخيار المختار أول فتح.
    const el = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({block: 'nearest'});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = useCallback(
    (idx: number): void => {
      const option = options[idx];
      if (option == null || option.disabled) return;
      onChange(option.value);
      closeList();
      wrapRef.current?.querySelector<HTMLButtonElement>('.sela-select-btn')?.focus();
    },
    [options, onChange, closeList],
  );

  /** قفزة الكتابة: حرف متتالٍ يقفز لأول تسمية تبدأ به. */
  const typeAhead = useCallback(
    (key: string): void => {
      if (!/^\S$/.test(key)) return;
      const now = Date.now();
      const state = typeAheadRef.current;
      state.chars = now - state.at < 550 ? state.chars + key : key;
      state.at = now;
      const prefix = state.chars;
      const idx = options.findIndex(o => o.label.startsWith(prefix));
      if (idx >= 0) setActiveIdx(idx);
    },
    [options],
  );

  const onButtonKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
          e.preventDefault();
          openList();
        }
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIdx(i => Math.min(options.length - 1, i + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIdx(i => Math.max(0, i - 1));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIdx(options.length - 1);
          break;
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          choose(activeIdx);
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          closeList();
          break;
        case 'Tab':
          closeList();
          break;
        default:
          typeAhead(e.key);
          break;
      }
    },
    [disabled, open, options.length, activeIdx, choose, closeList, openList, typeAhead],
  );

  // تمرير الخيار النشط داخل القائمة الطويلة.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({block: 'nearest'});
  }, [activeIdx, open]);

  return (
    <div
      ref={wrapRef}
      className={`sela-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className}`}
      style={style}>
      <button
        type="button"
        id={id}
        className="sela-select-btn"
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onButtonKeyDown}>
        <span className={`sela-select-value ${selected == null ? 'empty' : ''}`}>
          {selected?.label ?? placeholder ?? '—'}
        </span>
        <span className="sela-select-caret">
          <Icon name="chevronDown" size={15} />
        </span>
      </button>
      {open && (
        <div
          ref={listRef}
          className={`sela-select-list ${flipUp ? 'flip-up' : ''}`}
          role="listbox"
          aria-label={ariaLabel}>
          {options.map((option, idx) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={`sela-select-opt ${
                idx === activeIdx ? 'active' : ''
              } ${option.value === value ? 'selected' : ''}`}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => choose(idx)}>
              <span>{option.label}</span>
              {option.value === value && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
