/**
 * config.ts — ثوابت التطبيق (منقولة من الأندرويد + حقول سطح المكتب).
 */
export const BASE_UNIT_NAME = 'قطعة';
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const RECEIPT_WIDTH_58 = 32;
export const RECEIPT_WIDTH_80 = 48;
export const CODEPAGE_CP1256 = 47;
export const CODEPAGE_CP864 = 45;
export const CODEPAGE_ASCII = 0;
export const CURRENCY = '₪';
export const APP_NAME = 'sela';
export const APP_NAME_AR = 'سيلا';
export const APP_VERSION = '1.0.0';
export const APP_BUILD_CODE = 1;
export const APP_VERSION_LABEL = `${APP_VERSION} (${APP_BUILD_CODE})`;
export const APP_PLATFORM = 'desktop';

// ───────────────────────────────────────────── Subscription / licensing
export const LICENSE_SERVER_URL =
  'http://8jz9a3yyhn3eltmwqgnchn29.130.61.171.201.sslip.io';
export const LICENSE_PUBLIC_KEY_HEX =
  '6ee513c1b7f0b057d970c6c2f4b33e5d026bc4c798b5a0b8bb72818d3197d103';
export const LICENSE_GRACE_SOFT_HOURS = 72;
export const LICENSE_GRACE_HARD_HOURS = 240;
export const LICENSE_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
export const LICENSE_CONTACT_FALLBACK = {
  phone: '+972 59 000 0000',
  whatsapp: '+972 59 000 0000',
  telegram: '',
  email: 'abdalasela@gmail.com',
  note: 'لشراء أو تجديد الاشتراك تواصل مع الإدارة عبر أحد قنوات التواصل',
};

/** وحدات البذر — نفس قائمة الأندرويد بنفس الترتيب (تكامل قواعد أندرويد
 * القديمة يعتمد على نفس ids في قاعدة البيانات). */
export const DEFAULT_UNITS: {name: string; short: string}[] = [
  {name: 'قطعة', short: 'ق'},
  {name: 'كرتونة', short: 'كرت'},
  {name: 'علبة', short: 'علب'},
  {name: 'كيس', short: 'كيس'},
  {name: 'كيلوغرام', short: 'كغ'},
  {name: 'غرام', short: 'غ'},
  {name: 'لتر', short: 'ل'},
  {name: 'دزينة', short: 'دز'},
  {name: 'زجاجة', short: 'زج'},
  {name: 'متر', short: 'م'},
];

/** حاجب إعادة المسح لنفس الكود (نفس BARCODE_DEDUPE_MS الأندرويد). */
export const BARCODE_DEDUPE_MS = 1600;
