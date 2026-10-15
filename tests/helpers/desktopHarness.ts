/**
 * desktopHarness.ts — بيئة اختبار محاسبية حقيقية: قاعدة SQLite فعلية
 * (node:sqlite) بنفس DDL النواة (يُستخرج من crates/sela-core/src/db.rs
 * حرفياً — مصدر حقيقة واحد) + محاكاة invoke بنفس دلالات جسر Tauri
 * (sql_run/tx_begin/tx_execute/tx_commit/tx_rollback + config_*).
 * خدمات TS المنقولة تعمل هنا كما هي بلا أي تعديل — أي خلل محاسبي
 * يظهر في الاختبار نفسه.
 */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** استخراج DDL النواة (Rust) كما هو — لا نسخ يدوي ينحرف. */
export function coreDdl(): string {
  const rust = readFileSync(
    resolve(__dirname, '../../crates/sela-core/src/db.rs'),
    'utf8',
  );
  const start = rust.indexOf('const DDL: &str = r#"');
  const end = rust.indexOf('"#;', start);
  if (start < 0 || end < 0) {
    throw new Error('تعذر استخراج DDL من db.rs');
  }
  return rust.slice(start + 'const DDL: &str = r#"'.length, end);
}

/** بذور التصنيفات/الوحدات — نفس مصفوفات db.rs. */
export function seedDefaults(db: DatabaseSync): void {
  const cats: string[] = [
    'مشروبات',
    'شوكولاتة وحلويات',
    'معلبات وبقالة',
    'ألبان وأجبان',
    'خبز ومخبوزات',
    'منتجات متنوعة',
  ];
  let count = db.prepare('SELECT COUNT(*) AS c FROM categories').get() as {
    c: number;
  };
  if (count.c === 0) {
    for (const name of cats) {
      db.prepare('INSERT INTO categories (name, store_mode) VALUES (?, ?)').run(
        name,
        'grocery',
      );
    }
  }
  count = db.prepare('SELECT COUNT(*) AS c FROM units').get() as {c: number};
  if (count.c === 0) {
    const units: [string, string, string][] = [
      ['قطعة', 'ق', 'piece'],
      ['كرتونة', 'كرت', 'piece'],
      ['علبة', 'علب', 'piece'],
      ['كيس', 'كيس', 'piece'],
      ['دزينة', 'دز', 'piece'],
      ['زجاجة', 'زج', 'piece'],
      ['عبوة', 'عبوة', 'piece'],
      ['حزمة', 'حزمة', 'piece'],
      ['صندوق', 'صندوق', 'piece'],
      ['شوال', 'شوال', 'piece'],
      ['صينية', 'صينية', 'piece'],
      ['طبق', 'طبق', 'piece'],
      ['كيلوغرام', 'كغ', 'weight'],
      ['غرام', 'غ', 'weight'],
      ['وقية', 'وقية', 'weight'],
      ['نصف كيلو', 'نصف', 'weight'],
      ['رطل', 'رطل', 'weight'],
      ['أونصة', 'أونصة', 'weight'],
      ['لتر', 'ل', 'volume'],
      ['مليلتر', 'مل', 'volume'],
      ['جالون', 'جالون', 'volume'],
      ['متر', 'م', 'length'],
      ['سنتيمتر', 'سم', 'length'],
    ];
    let i = 0;
    for (const [name, short, kind] of units) {
      db.prepare(
        'INSERT INTO units (name, short_name, sort_order, kind, store_mode) VALUES (?, ?, ?, ?, ?)',
      ).run(name, short, i++, kind, 'grocery');
    }
  }
}

interface InvokeState {
  db: DatabaseSync;
  config: Map<string, unknown>;
  sessions: Map<number, {db: DatabaseSync}>;
  nextTx: number;
}

let state: InvokeState | null = null;

/** فتح قاعدة اختبار (ذاكرة أو ملف) وتطبيق DDL + البذور. */
export function bootHarness(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(coreDdl());
  seedDefaults(db);
  state = {db, config: new Map(), sessions: new Map(), nextTx: 1};
  return db;
}

export function harnessDb(): DatabaseSync {
  if (state == null) {
    throw new Error('bootHarness أولاً');
  }
  return state.db;
}

function toSqlValue(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
}

function getLastInsertRowId(db: DatabaseSync): number {
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as {
    id: number;
  };
  return row.id;
}

/** تنفيذ SQL بنفس شكل نتيجة الجسر (rows/insertId/rowsAffected). */
function runSql(db: DatabaseSync, sql: string, params: unknown[]): unknown {
  const clean = sql.trim();
  const stmt = db.prepare(clean);
  const args = params.map(toSqlValue);
  const isSelect =
    /^select/i.test(clean) || /^pragma/i.test(clean) || /^with/i.test(clean);
  if (isSelect) {
    const rows = stmt.all(...args) as Record<string, unknown>[];
    return {
      rowsAffected: 0,
      insertId: null,
      rows,
    };
  }
  const info = stmt.run(...args);
  const rowsAffected = Number(info.changes);
  return {
    rowsAffected,
    insertId: rowsAffected > 0 ? getLastInsertRowId(db) : null,
    rows: [],
  };
}

/** محاكاة invoke بنفس أوامر الجسر الحقيقية. */
export function harnessInvoke(
  cmd: string,
  args: Record<string, unknown> = {},
): unknown {
  if (state == null) {
    throw new Error('bootHarness أولاً');
  }
  switch (cmd) {
    case 'sql_run':
      return runSql(state.db, String(args.sql), (args.params as unknown[]) ?? []);
    case 'tx_begin': {
      const id = state.nextTx++;
      state.db.exec('BEGIN IMMEDIATE');
      state.sessions.set(id, {db: state.db});
      return id;
    }
    case 'tx_execute': {
      const session = state.sessions.get(Number(args.txId));
      if (session == null) {
        throw new Error('المعاملة غير موجودة أو انتهت');
      }
      return runSql(
        session.db,
        String(args.sql),
        (args.params as unknown[]) ?? [],
      );
    }
    case 'tx_commit': {
      const session = state.sessions.get(Number(args.txId));
      if (session == null) {
        throw new Error('المعاملة غير موجودة أو انتهت');
      }
      session.db.exec('COMMIT');
      state.sessions.delete(Number(args.txId));
      return null;
    }
    case 'tx_rollback': {
      const session = state.sessions.get(Number(args.txId));
      if (session == null) {
        throw new Error('المعاملة غير موجودة أو انتهت');
      }
      try {
        session.db.exec('ROLLBACK');
      } catch {
        /* سقطت */
      }
      state.sessions.delete(Number(args.txId));
      return null;
    }
    case 'tx_sessions_alive':
      return state.sessions.size;
    case 'config_get_all': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of state.config) out[k] = v;
      return out;
    }
    case 'config_set':
      state.config.set(String(args.key), args.value);
      return null;
    case 'config_remove':
      state.config.delete(String(args.key));
      return null;
    case 'fs_file_exists':
      return false;
    case 'fs_file_signature':
      return '0:0';
    case 'print_job':
      return {written: 0, channel: 'test'};
    case 'test_printer':
      return {written: 0, channel: 'test'};
    case 'open_drawer':
      return {written: 0};
    case 'bootstrap':
      return {
        dataDir: '/tmp/sela-test',
        deviceId: 'test-device-1',
        coreVersion: '57.1.0',
        printer: null,
      };
    case 'device_id':
      return 'test-device-1';
    case 'uptime_ms':
      return 1000;
    case 'scanner_running':
      return false;
    default:
      throw new Error(`أمر غير مدعوم في بيئة الاختبار: ${cmd}`);
  }
}

/** تشغيل تلقائي (ذاكرة) إن لم يُشغّل بعد — لمحاكاة invoke الكسولة. */
export function ensureBooted(): void {
  if (state == null) {
    bootHarness(':memory:');
  }
}
