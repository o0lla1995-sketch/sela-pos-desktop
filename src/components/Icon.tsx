/**
 * components/Icon.tsx — عائلة أيقونات سيلا (SVG — منقولة من تطبيق
 * الأندرويد v57 حرفياً بكل مساراتها). خط 1.8px دائري الأطراف،
 * ترث لون النص عبر currentColor — بديل كامل عن الإيموجي في كل
 * الواجهة (الشريط الجانبي، الإجراءات السريعة، الأزرار، الفراغات).
 */
import React from 'react';

export type IconName =
  | 'home'
  | 'cart'
  | 'basket'
  | 'key'
  | 'phone'
  | 'shield'
  | 'lock'
  | 'fingerprint'
  | 'backspace'
  | 'mail'
  | 'ticket'
  | 'box'
  | 'chart'
  | 'settings'
  | 'camera'
  | 'bell'
  | 'bellOff'
  | 'printer'
  | 'search'
  | 'plus'
  | 'trash'
  | 'checkCircle'
  | 'alert'
  | 'wifiOff'
  | 'bluetooth'
  | 'download'
  | 'edit'
  | 'image'
  | 'paperclip'
  | 'imagePlus'
  | 'scan'
  | 'barcode'
  | 'tag'
  | 'calendar'
  | 'clock'
  | 'refresh'
  | 'info'
  | 'calculator'
  | 'percent'
  | 'packageMinus'
  | 'inbox'
  | 'store'
  | 'sparkles'
  | 'wallet'
  | 'filter'
  | 'send'
  | 'save'
  | 'stethoscope'
  | 'cpu'
  | 'flash'
  | 'database'
  | 'list'
  | 'moon'
  | 'sun'
  | 'clipboard'
  | 'scale'
  | 'shapes'
  | 'swap'
  | 'qrFrame'
  | 'user'
  | 'users'
  | 'book'
  | 'idCard'
  | 'link'
  | 'pause'
  | 'archive'
  | 'undo'
  | 'cloud'
  | 'cloudUp'
  | 'cloudDown'
  | 'layoutGrid'
  | 'layoutList'
  | 'layoutCards'
  | 'minus'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'moreVertical'
  | 'check'
  | 'x';

export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{flexShrink: 0}}>
      {P[name]}
    </svg>
  );
}

const P: Record<IconName, React.ReactNode> = {
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.8 4.6 4.6L19 6.8" />,
  moreVertical: <path d="M12 5.5v.01M12 12v.01M12 18.5v.01" stroke-width={3} />,
  chevronDown: <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronLeft: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  minus: <path d="M5 12h14" />,

  home: (
    <g>
      <path d="M4 11.2 12 4l8 7.2" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
      <path d="M10 20v-5h4v5" />
    </g>
  ),

  cart: (
    <g>
      <circle cx={9.5} cy={19.5} r={1.6} />
      <circle cx={17.5} cy={19.5} r={1.6} />
      <path d="M3 4h2.2l2.1 10.4a1.4 1.4 0 0 0 1.4 1.1h8.5a1.4 1.4 0 0 0 1.4-1.1L20.5 8H6" />
    </g>
  ),

  basket: (
    <g>
      <path d="M3.5 9.5 5.6 19a1.6 1.6 0 0 0 1.6 1.3h9.6a1.6 1.6 0 0 0 1.6-1.3l2.1-9.5" />
      <path d="M2.8 9.5h18.4" />
      <path d="M8.5 9.5 12 3.7l3.5 5.8" />
      <path d="M8.6 13v4M12 13v4M15.4 13v4" />
    </g>
  ),

  key: (
    <g>
      <circle cx={8} cy={8.5} r={4.2} />
      <path d="M11 11.5 20 20.5" />
      <path d="M16.5 17 14.5 19" />
      <path d="M19 14.5 17 16.5" />
    </g>
  ),

  phone: (
    <g>
      <path d="M5 4h3.5l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.6 1.6 0 0 1-1.8 1.6C10.8 19.7 4.3 13.2 3.4 5.8A1.6 1.6 0 0 1 5 4Z" />
    </g>
  ),

  shield: (
    <g>
      <path d="M12 3.2 4.8 6v5.4c0 4.5 3 8.2 7.2 9.4 4.2-1.2 7.2-4.9 7.2-9.4V6L12 3.2Z" />
      <path d="M9 12l2.1 2.1L15.4 10" />
    </g>
  ),

  lock: (
    <g>
      <rect x={5} y={10.5} width={14} height={9.5} rx={2.2} />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </g>
  ),

  fingerprint: (
    <g>
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 21.34c-.46.29-.98.44-1.5.44-.52 0-1.04-.15-1.5-.44" />
      <path d="M8 20.03C7.5 21.25 6.5 22 5.5 22 4 22 3 20 3 17c0-1 .17-2.34.42-3.67" />
      <path d="M18.5 22c1.5 0 2.5-2 2.5-5 0-6-2.5-12-9-12S3 11 3 17c0 1 .17 2.34.42 3.67" />
      <path d="M12 12c0 4.42.42 8.42 1.5 10.57" />
    </g>
  ),

  backspace: (
    <g>
      <path d="M21 4H8l-6 8 6 8h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 21 4Z" />
      <path d="m12 9.5 5 5" />
      <path d="m17 9.5-5 5" />
    </g>
  ),

  mail: (
    <g>
      <rect x={3.5} y={5.5} width={17} height={13} rx={2} />
      <path d="M4 7l8 6 8-6" />
    </g>
  ),

  ticket: (
    <g>
      <path d="M3.5 7.5v9a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-9" />
      <path d="M3.5 7.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2" />
      <path d="M8.5 5.5v2.4M8.5 10v4M8.5 16.1v2.4" />
      <path d="M3.5 12h2M18.5 12h2" />
    </g>
  ),

  box: (
    <g>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </g>
  ),

  chart: (
    <g>
      <path d="M4 4v15a1 1 0 0 0 1 1h15" />
      <path d="M8 16v-5" />
      <path d="M12.5 16V7" />
      <path d="M17 16v-3" />
    </g>
  ),

  settings: (
    <g>
      <path d="M10.3 3.4a1.3 1.3 0 0 1 2.5-.6l.2.9a1.3 1.3 0 0 0 1.8.9l.8-.4a1.3 1.3 0 0 1 1.7 1.7l-.4.8a1.3 1.3 0 0 0 .7 1.8l.9.3a1.3 1.3 0 0 1 0 2.4l-.9.3a1.3 1.3 0 0 0-.7 1.8l.4.8a1.3 1.3 0 0 1-1.7 1.7l-.8-.4a1.3 1.3 0 0 0-1.8.7l-.3.9a1.3 1.3 0 0 1-2.4 0l-.3-.9a1.3 1.3 0 0 0-1.8-.7l-.8.4a1.3 1.3 0 0 1-1.7-1.7l.4-.8a1.3 1.3 0 0 0-.7-1.8l-.9-.3a1.3 1.3 0 0 1 0-2.4l.9-.3a1.3 1.3 0 0 0 .7-1.8l-.4-.8a1.3 1.3 0 0 1 1.7-1.7l.8.4a1.3 1.3 0 0 0 1.8-.7l.2-.9Z" />
      <circle cx={11.2} cy={11.9} r={2.6} />
    </g>
  ),

  camera: (
    <g>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 4.8h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx={12} cy={13} r={3.4} />
    </g>
  ),

  bell: (
    <g>
      <path d="M12 3.6a5.6 5.6 0 0 0-5.6 5.6c0 4.4-1.1 5.9-1.7 6.6-.3.4 0 1 .5 1h13.6c.5 0 .8-.6.5-1-.6-.7-1.7-2.2-1.7-6.6A5.6 5.6 0 0 0 12 3.6Z" />
      <path d="M9.8 20.5a2.4 2.4 0 0 0 4.4 0" />
    </g>
  ),

  bellOff: (
    <g>
      <path d="M6.5 9.2A5.6 5.6 0 0 1 12 3.6a5.6 5.6 0 0 1 5.5 4.6c.1 4.4 1.2 6.5 1.8 7.2.3.4 0 1-.5 1H8.4" />
      <path d="M6.4 8v.7c0 4.4-1.1 5.9-1.7 6.6-.3.4 0 1 .5 1h1.4" />
      <path d="M9.8 20.5a2.4 2.4 0 0 0 4.4 0" />
      <path d="M4 4l16 16" />
    </g>
  ),

  printer: (
    <g>
      <path d="M7 9V4h10v5" />
      <rect x={4} y={9} width={16} height={7} rx={1.4} />
      <path d="M7 14h10v6H7v-6Z" />
    </g>
  ),

  search: (
    <g>
      <circle cx={11} cy={11} r={6.5} />
      <path d="m20 20-4.4-4.4" />
    </g>
  ),

  plus: (
    <g>
      <path d="M12 5v14M5 12h14" />
    </g>
  ),

  trash: (
    <g>
      <path d="M4.5 6.5h15M9.5 6.5V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8v1.7" />
      <path d="M6.5 6.5 7.3 19a1.2 1.2 0 0 0 1.2 1.1h7a1.2 1.2 0 0 0 1.2-1.1l.8-12.5" />
      <path d="M10.2 10.5v6M13.8 10.5v6" />
    </g>
  ),

  checkCircle: (
    <g>
      <circle cx={12} cy={12} r={8.5} />
      <path d="m8.3 12.4 2.6 2.6 4.9-5.4" />
    </g>
  ),

  alert: (
    <g>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10.2v3.6" />
      <circle cx={12} cy={16.4} r={0.4} />
    </g>
  ),

  wifiOff: (
    <g>
      <path d="M4 4l16 16" />
      <path d="M8.1 12.6a5.6 5.6 0 0 1 3-1.5M4.5 9a11 11 0 0 1 3.2-2M15.6 11a5.6 5.6 0 0 1 1.8 1.6M12.6 8a11 11 0 0 1 3 1.1" />
      <circle cx={12} cy={16.5} r={0.5} />
    </g>
  ),

  bluetooth: (
    <g>
      <path d="M7.5 7.2 16 16.8 12 20V4l4 3.2-8.5 9.6" />
    </g>
  ),

  download: (
    <g>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </g>
  ),

  edit: (
    <g>
      <path d="M14.5 5.5 18.5 9.5" />
      <path d="M5 19.5l1-4.2 9.7-9.7a1.6 1.6 0 0 1 2.3 0l1.4 1.4a1.6 1.6 0 0 1 0 2.3l-9.7 9.7-4.7 1.5Z" />
    </g>
  ),

  image: (
    <g>
      <rect x={4} y={5} width={16} height={14} rx={1.6} />
      <circle cx={9} cy={10} r={1.5} />
      <path d="m5 17.5 4.4-4a1.5 1.5 0 0 1 2 0l5.8 5" />
    </g>
  ),

  paperclip: (
    <g>
      <path d="M20.5 11.3 12 19.8a4.9 4.9 0 0 1-6.9-6.9l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
    </g>
  ),

  imagePlus: (
    <g>
      <rect x={3.5} y={5} width={14} height={13} rx={1.6} />
      <path d="m4.5 15.5 3.9-3.6a1.5 1.5 0 0 1 2 0l5.1 4.6" />
      <circle cx={8.5} cy={9} r={1.3} />
      <path d="M18 4.5v6M15 7.5h6" />
    </g>
  ),

  scan: (
    <g>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h16" />
    </g>
  ),

  barcode: (
    <g>
      <path d="M3.5 19V7.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5V19" />
      <path d="M3.5 21h17" />
      <path d="M7.5 9.5v6M10.5 9.5v6M13.5 9.5v6M16.5 9.5v4" />
    </g>
  ),

  tag: (
    <g>
      <path d="M11.2 3.8H19a1.2 1.2 0 0 1 1.2 1.2v7.8L11.6 21a1.4 1.4 0 0 1-2 0l-6.4-6.4a1.4 1.4 0 0 1 0-2l8-8.8Z" />
      <circle cx={16} cy={8} r={1.3} />
    </g>
  ),

  calendar: (
    <g>
      <rect x={4} y={5.5} width={16} height={14.5} rx={1.6} />
      <path d="M8 3.5v4M16 3.5v4M4 10.5h16" />
    </g>
  ),

  clock: (
    <g>
      <circle cx={12} cy={12} r={8.5} />
      <path d="M12 7.5V12l3 2" />
    </g>
  ),

  refresh: (
    <g>
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1" />
      <path d="M17 3.5v3.4h-3.4M7 20.5v-3.4h3.4" />
    </g>
  ),

  info: (
    <g>
      <circle cx={12} cy={12} r={8.5} />
      <path d="M12 11v5" />
      <circle cx={12} cy={7.8} r={0.4} />
    </g>
  ),

  calculator: (
    <g>
      <rect x={5.5} y={3.5} width={13} height={17} rx={1.6} />
      <path d="M8.5 7.5h7" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01" />
    </g>
  ),

  percent: (
    <g>
      <path d="M5.5 18.5 18.5 5.5" />
      <circle cx={7.5} cy={7.5} r={2.2} />
      <circle cx={16.5} cy={16.5} r={2.2} />
    </g>
  ),

  packageMinus: (
    <g>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
      <path d="M9 15.5h6" />
    </g>
  ),

  inbox: (
    <g>
      <path d="M4 13.5 6 5.5a1.2 1.2 0 0 1 1.2-1h9.6A1.2 1.2 0 0 1 18 5.5l2 8" />
      <path d="M4 13.5h4.5l1 2.5h5l1-2.5H20v4.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18v-4.5Z" />
    </g>
  ),

  store: (
    <g>
      <path d="M4 9.5V19a1.2 1.2 0 0 0 1.2 1.2h13.6A1.2 1.2 0 0 0 20 19V9.5" />
      <path d="M3.5 9.5 5 4.5h14l1.5 5" />
      <path d="M9.5 20v-5.5h5V20" />
      <path d="M3.5 9.5a2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0" />
    </g>
  ),

  sparkles: (
    <g>
      <path d="M12 4.5 13.4 9l4.6 1.4-4.6 1.4L12 16.4l-1.4-4.6L6 10.4 10.6 9 12 4.5Z" />
      <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />
    </g>
  ),

  wallet: (
    <g>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z" />
      <path d="M15 12h5.5" />
      <circle cx={15.8} cy={12} r={0.9} />
    </g>
  ),

  filter: (
    <g>
      <path d="M4 6h16M7 12h10M10.5 18h3" />
    </g>
  ),

  send: (
    <g>
      <path d="M20 4.5 4.5 11l5.5 2.5L12.5 19 20 4.5Z" />
      <path d="m10 13.5 4.5-4.5" />
    </g>
  ),

  save: (
    <g>
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h9L20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 5 18.5v-13Z" />
      <path d="M8 4v5h7" />
      <path d="M8 14h8v6H8v-6Z" />
    </g>
  ),

  stethoscope: (
    <g>
      <path d="M6 4v5a4 4 0 0 0 8 0V4" />
      <path d="M6 4H4.5M14 4h1.5M10 13v2.5a4.5 4.5 0 0 0 9 0v-2" />
      <circle cx={19} cy={10.5} r={2} />
    </g>
  ),

  cpu: (
    <g>
      <rect x={7} y={7} width={10} height={10} rx={1.4} />
      <rect x={4} y={4} width={16} height={16} rx={2} />
      <path d="M9.5 2v2M14.5 2v2M9.5 20v2M14.5 20v2M2 9.5h2M2 14.5h2M20 9.5h2M20 14.5h2" />
    </g>
  ),

  flash: (
    <g>
      <path d="M13 3 5.5 13.5H11L10.5 21 18.5 10.5H13L13 3Z" />
    </g>
  ),

  database: (
    <g>
      <ellipse cx={12} cy={5.5} rx={7.5} ry={2.8} />
      <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" />
      <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </g>
  ),

  list: (
    <g>
      <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20" />
      <circle cx={4.6} cy={6.5} r={1} />
      <circle cx={4.6} cy={12} r={1} />
      <circle cx={4.6} cy={17.5} r={1} />
    </g>
  ),

  moon: (
    <g>
      <path d="M20 13.6A8.4 8.4 0 0 1 10.4 4 8.4 8.4 0 1 0 20 13.6Z" />
    </g>
  ),

  sun: (
    <g>
      <circle cx={12} cy={12} r={4} />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </g>
  ),

  clipboard: (
    <g>
      <path d="M9 4.5H7.5A1.5 1.5 0 0 0 6 6v13a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V6a1.5 1.5 0 0 0-1.5-1.5H15" />
      <rect x={9} y={3} width={6} height={3.5} rx={1.2} />
      <path d="m9.2 12.6 1.9 1.9 3.7-4" />
    </g>
  ),

  scale: (
    <g>
      <path d="M12 3.5a8.5 8.5 0 0 0-8.4 9.9l1.6-1.1a2 2 0 0 1 2.7.5l1 1.4a2 2 0 0 1-.5 2.8l-.8.6a8.5 8.5 0 0 0 8.8 0l-.8-.6a2 2 0 0 1-.5-2.8l1-1.4a2 2 0 0 1 2.7-.5l1.6 1.1A8.5 8.5 0 0 0 12 3.5Z" />
      <path d="M12 3.5v4" />
      <path d="M10 7.5h4l1.8 3.4a1 1 0 0 1-.9 1.5h-5.8a1 1 0 0 1-.9-1.5L10 7.5Z" />
    </g>
  ),

  shapes: (
    <g>
      <rect x={3.5} y={13} width={7.5} height={7.5} rx={1.4} />
      <circle cx={16.8} cy={16.8} r={3.8} />
      <path d="M12 3.2l4.2 7.3H7.8L12 3.2Z" />
    </g>
  ),

  swap: (
    <g>
      <path d="M4 8.5h13l-3.2-3.2M20 15.5H7l3.2 3.2" />
    </g>
  ),

  qrFrame: (
    <g>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx={12} cy={12} r={2.2} />
    </g>
  ),

  user: (
    <g>
      <circle cx={12} cy={8} r={3.6} />
      <path d="M5 20c.7-3.6 3.6-5.6 7-5.6s6.3 2 7 5.6" />
    </g>
  ),

  users: (
    <g>
      <circle cx={9} cy={8.5} r={3.2} />
      <path d="M3 19.5c.6-3.1 3.1-4.9 6-4.9s5.4 1.8 6 4.9" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M17.6 14.9c2 .7 3.2 2.3 3.4 4.6" />
    </g>
  ),

  book: (
    <g>
      <path d="M4 5.5A2 2 0 0 1 6 3.5h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19.5a2 2 0 0 1 2-2h13" />
      <path d="M8.5 8h7M8.5 11.5h7" />
    </g>
  ),

  idCard: (
    <g>
      <rect x={3} y={5} width={18} height={14} rx={2.4} />
      <circle cx={8.6} cy={11} r={1.9} />
      <path d="M5.6 16c.4-1.6 1.6-2.5 3-2.5s2.6.9 3 2.5" />
      <path d="M14.5 9.5h4.5M14.5 12.5h4.5M14.5 15.5h3" />
    </g>
  ),

  link: (
    <g>
      <path d="M10 14a4 4 0 0 0 6 .4l2.5-2.5a4 4 0 0 0-5.6-5.6L11.4 7.7" />
      <path d="M14 10a4 4 0 0 0-6-.4L5.5 12.1a4 4 0 0 0 5.6 5.6l1.5-1.4" />
    </g>
  ),

  pause: (
    <g>
      <path d="M9.5 5.5v13" />
      <path d="M14.5 5.5v13" />
    </g>
  ),

  archive: (
    <g>
      <path d="M3.5 7.5h17" />
      <path d="M5 7.5v11a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-11" />
      <path d="M9.5 11.5h5" />
    </g>
  ),

  undo: (
    <g>
      <path d="M4 9h9.5a5 5 0 0 1 0 10H8" />
      <path d="m7.5 5.5-3.5 3.5 3.5 3.5" />
    </g>
  ),

  cloud: (
    <g>
      <path d="M7 18.5a4.5 4.5 0 1 1 .7-8.95A6 6 0 0 1 19.4 11.4a3.55 3.55 0 0 1-.9 7.1H7z" />
    </g>
  ),

  cloudUp: (
    <g>
      <path d="M7 18.5a4.5 4.5 0 1 1 .7-8.95A6 6 0 0 1 19.4 11.4a3.55 3.55 0 0 1-.9 7.1H7z" />
      <path d="M12 16v-4.5" />
      <path d="m9.8 13.2 2.2-2.2 2.2 2.2" />
    </g>
  ),

  cloudDown: (
    <g>
      <path d="M7 18.5a4.5 4.5 0 1 1 .7-8.95A6 6 0 0 1 19.4 11.4a3.55 3.55 0 0 1-.9 7.1H7z" />
      <path d="M12 11.5V16" />
      <path d="m9.8 14.3 2.2 2.2 2.2-2.2" />
    </g>
  ),

  layoutGrid: (
    <g>
      <rect x={3.5} y={3.5} width={7.4} height={7.4} rx={1.4} />
      <rect x={13.1} y={3.5} width={7.4} height={7.4} rx={1.4} />
      <rect x={3.5} y={13.1} width={7.4} height={7.4} rx={1.4} />
      <rect x={13.1} y={13.1} width={7.4} height={7.4} rx={1.4} />
    </g>
  ),

  layoutList: (
    <g>
      <rect x={3.5} y={4} width={17} height={4.6} rx={1.3} />
      <rect x={3.5} y={9.7} width={17} height={4.6} rx={1.3} />
      <rect x={3.5} y={15.4} width={17} height={4.6} rx={1.3} />
    </g>
  ),

  layoutCards: (
    <g>
      <rect x={3} y={4.5} width={8} height={13.5} rx={1.6} />
      <rect x={13} y={4.5} width={8} height={13.5} rx={1.6} />
    </g>
  ),

};
