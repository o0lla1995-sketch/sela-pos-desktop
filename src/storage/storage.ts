/**
 * storage/storage.ts — غلاف توافقي: نفس مسار أندرويد v57 حرفياً،
 * والتنفيذ فوق مرآة config.json لسطح المكتب (state/storage).
 * كل المفاتيح والدوال بنفس الأسماء حتى تعمل الملفات المنقولة
 * حرفياً بلا أي تغيير في الاستيرادات.
 */
export {
  KEYS,
  getJson,
  setJson,
  getNumber,
  setNumber,
  getString,
  setString,
  getBoolean,
  setBoolean,
  storageDelete,
  deleteKey,
} from '../state/storage';

import {getBoolean, getNumber, getString, setJson, storageDelete} from '../state/storage';

/** كائن خام بنفس واجهة MMKV التي تستعملها بعض الملفات مباشرة. */
export const storage = {
  getString: (key: string, fallback = ''): string => getString(key, fallback),
  getNumber: (key: string, fallback = 0): number => getNumber(key, fallback),
  getBoolean: (key: string, fallback = false): boolean => getBoolean(key, fallback),
  set: (key: string, value: unknown): void => setJson(key, value),
  delete: (key: string): void => storageDelete(key),
};
