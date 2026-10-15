/**
 * state/settingsStore.ts — غلاف توافقي: الشاشات القديمة تستورد من
 * هنا، والمخزن الحي الآن في stores/settingsStore.ts (أندرويد v57 +
 * حقول سطح المكتب مدمجة: قناة الطابعة، الوضع الفاتح/الداكن).
 */
export {
  useSettingsStore,
  getSettings,
  getPrinter,
  DEFAULT_PRINTER,
} from '../stores/settingsStore';
export type {
  AppSettings,
  DesktopPrinter,
  PosProductView,
} from '../stores/settingsStore';
