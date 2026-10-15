/**
 * database/connection.ts — محول قاعدة البيانات لسطح المكتب.
 * ─────────────────────────────────────────────────────────────────
 * يقدم نفس واجهة op-sqlite التي كُتبت عليها خدمات أندرويد v57 حرفياً:
 *  • getDb().execute(sql, params?) → {rows, insertId, rowsAffected}
 *  • getDb().transaction(async tx => …) — معاملة ذرّية على اتصال مخصص
 *    (BEGIN IMMEDIATE في النواة)؛ أي رمي داخل رد النداء يُرجِع كل شيء.
 * القاعدة نفسها تفتحها النواة (Rust) عند الإقلاع — DDL/البذور/الترحيلات
 * كلها هناك؛ initDatabase() هنا no-op للتوافق فقط.
 */
import {invoke} from '../lib/tauri';

export interface QueryResult {
  rows: Record<string, unknown>[];
  insertId?: number | null;
  rowsAffected: number;
}

export interface Tx {
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
}

export interface DB {
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  transaction(fn: (tx: Tx) => Promise<void>): Promise<void>;
}

const db: DB = {
  async execute(sql: string, params?: unknown[]) {
    return invoke<QueryResult>('sql_run', {sql, params: params ?? []});
  },
  async transaction(fn: (tx: Tx) => Promise<void>) {
    const txId = await invoke<number>('tx_begin');
    const tx: Tx = {
      async execute(sql: string, params?: unknown[]) {
        return invoke<QueryResult>('tx_execute', {
          txId,
          sql,
          params: params ?? [],
        });
      },
    };
    try {
      await fn(tx);
      await invoke('tx_commit', {txId});
    } catch (error) {
      // التراجع دائماً عند أي فشل — ثم إعادة رمي الخطأ للمستدعي
      // (نفس دلالات op-sqlite تماماً).
      try {
        await invoke('tx_rollback', {txId});
      } catch {
        /* الجلسة سقطت — لا شيء للتراجع عنه */
      }
      throw error;
    }
  },
};

export function getDb(): DB {
  return db;
}

/** لا عمل — النواة (Rust) تهيئ القاعدة والترحيلات عند الإقلاع. */
export async function initDatabase(): Promise<void> {
  return;
}

/** مسح كل بيانات العمل — عبر أمر النواة (نفس ترتيب wipeAllData). */
export async function wipeAllData(): Promise<void> {
  const {api} = await import('../lib/tauri');
  await api.wipeData();
}

export function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Extracts a readable message from native promise rejections. */
export function nativeErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as {message?: string; code?: string};
    if (candidate.message) {
      return candidate.message;
    }
    if (candidate.code) {
      return `${fallback} (${candidate.code})`;
    }
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return fallback;
}
