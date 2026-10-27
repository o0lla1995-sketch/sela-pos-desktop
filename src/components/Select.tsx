/**
 * components/Select.tsx — قائمة منسدلة مخصّصة v72 (الجولة 76 #4).
 * ─────────────────────────────────────────────────────────────────
 * بديل الـ <select> الأصلي بكل مواضعه: القائمة المنبثقة الأصلية
 * تبدو نظامية وغير متناسقة مع هوية سيلا، وضيّقة داخل جداول
 * وحدات البيع (ملاحظة التاجر: «القائمة المنسدلة مضغوطة»).
 *
 *  • زر مغلق بنفس لغة حقول النظام + سهم يفتح القائمة.
 *  • v72 (الجولة 76 #4 — طلب التاجر نصاً: «القوائم المنسدلة داخل
 *    النوافذ المنبثقة مقصوصة/مخفية»): القائمة تُرسم الآن عبر
 *    createPortal على <body> بتموضع fixed محسوب من موضع الزر —
 *    فلا تُقصها حواف النافذة (modal) ولا حواف الجداول ولا أي
 *    حاوية قابلة للتمرير مهما كان عمق التداخل. كان النمط القديم
 *    position:absolute داخل الزر، وoverflow-y:auto على .modal
 *    يقصّ كل ما تجاوز حدّه — نافذة «تسجيل سداد دين» و«تسجيل
 *    مصروف» أشهر الضحايا (المحافظ والبنوك وفئات المصروف تختفي).
 *    تُعاد الإزاحة لحظياً عند التمرير/تحجيم النافذة، وتنقلب
 *    للأعلى إن ضاق المساح أسفل الزر.
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
import {createPortal} from 'react-dom';
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

/** إحداثيات القائمة العائمة (fixed) — تُحسب من مستطيل الزر. */
interface FloatRect {
  top: number;
  left: number;
  width: number;
  maxWidth: number;
  flipUp: boolean;
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
  const [floatRect, setFloatRect] = useState<FloatRect | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
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

  // ── v72: حساب تموضع القائمة العائمة من مستطيل الزر ──
  // fixed على مستوى الـ body: لا قصّ من overflow أي حاوية كانت،
  // والحد الوحيد هو حافة نافذة التطبيق نفسها.
  const measure = useCallback(() => {
    const btn = btnRef.current;
    if (btn == null) return;
    const rect = btn.getBoundingClientRect();
    const gap = 6;
    const listMaxH = 264;
    const below = Math.max(0, window.innerHeight - rect.bottom - gap);
    const flipUp = below < Math.min(listMaxH, 180) && rect.top > below;
    setFloatRect({
      top: flipUp
        ? Math.max(8, rect.top - gap - Math.min(listMaxH, rect.top - 8))
        : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxWidth: Math.min(360, window.innerWidth - 16),
      flipUp,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // تمركز الخيار المختار أول فتح.
    const el = listRef.current?.children[selectedIdx] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({block: 'nearest'});
    // إعادة القياس لحظياً مع أي تمرير/تحجيم (النافذة نفسها قد
    // تتمرر أو يتحرك الزر تحتها).
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // إغلاق بالنقر خارج القائمة (الزر نفسه يبدّل).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapRef.current?.contains(target) !== true &&
        listRef.current?.contains(target) !== true
      ) {
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
      const target = e.target as Node;
      if (
        wrapRef.current?.contains(target) === true ||
        listRef.current?.contains(target) === true
      ) {
        return; // ملك معالج القائمة — يختار/يغلق بنفسه.
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', onWinKey, true);
    return () => window.removeEventListener('keydown', onWinKey, true);
  }, [open]);

  const choose = useCallback(
    (idx: number): void => {
      const option = options[idx];
      if (option == null || option.disabled) return;
      onChange(option.value);
      closeList();
      btnRef.current?.focus();
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
    [
      disabled,
      open,
      options.length,
      activeIdx,
      choose,
      closeList,
      openList,
      typeAhead,
    ],
  );

  // تمرير الخيار النشط داخل القائمة الطويلة.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[activeIdx] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({block: 'nearest'});
  }, [activeIdx, open]);

  const listBox = open ? (
    <div
      ref={listRef}
      className={`sela-select-list ${floatRect?.flipUp ? 'flip-up' : ''}`}
      style={{
        position: 'fixed',
        top: floatRect?.top ?? -9999,
        left: floatRect?.left ?? -9999,
        minWidth: floatRect?.width ?? 0,
        maxWidth: floatRect?.maxWidth ?? 320,
      }}
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
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={`sela-select ${open ? 'open' : ''} ${disabled ? 'disabled' : ''} ${className}`}
      style={style}>
      <button
        type="button"
        ref={btnRef}
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
      {listBox != null && createPortal(listBox, document.body)}
    </div>
  );
}
