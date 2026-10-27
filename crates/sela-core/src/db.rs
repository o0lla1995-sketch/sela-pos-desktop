/**
 * db.rs — فتح القاعدة + DDL/البذور/الترحيلات/المسح.
 * DDL منقول حرفياً من src/database/connection.ts (الأندرويد v57.0.0)
 * بنفس الجداول والفهارس والبذور العربية وترتيبها — الحالة النهائية
 * لكل الترحيلات (v2..v27) مدمجة داخل التعريف مباشرة، وقاعدة سطح
 * المكتب القديمة (v1.0.0) تُشفى بأعمدة محروسة بـ pragma.
 */
use crate::Result;
use rusqlite::Connection;

pub const DEFAULT_CATEGORIES: [&str; 6] = [
    "مشروبات",
    "شوكولاتة وحلويات",
    "معلبات وبقالة",
    "ألبان وأجبان",
    "خبز ومخبوزات",
    "منتجات متنوعة",
];

/// (الاسم، الاختصار، النوع) — من config.ts DEFAULT_UNITS (v9.2) بنفس الترتيب.
pub const DEFAULT_UNITS: [(&str, &str, &str); 23] = [
    ("قطعة", "ق", "piece"),
    ("كرتونة", "كرت", "piece"),
    ("علبة", "علب", "piece"),
    ("كيس", "كيس", "piece"),
    ("دزينة", "دز", "piece"),
    ("زجاجة", "زج", "piece"),
    ("عبوة", "عبوة", "piece"),
    ("حزمة", "حزمة", "piece"),
    ("صندوق", "صندوق", "piece"),
    ("شوال", "شوال", "piece"),
    ("صينية", "صينية", "piece"),
    ("طبق", "طبق", "piece"),
    ("كيلوغرام", "كغ", "weight"),
    ("غرام", "غ", "weight"),
    ("وقية", "وقية", "weight"),
    ("نصف كيلو", "نصف", "weight"),
    ("رطل", "رطل", "weight"),
    ("أونصة", "أونصة", "weight"),
    ("لتر", "ل", "volume"),
    ("مليلتر", "مل", "volume"),
    ("جالون", "جالون", "volume"),
    ("متر", "م", "length"),
    ("سنتيمتر", "سم", "length"),
];

/// v34: النمط الافتراضي للمتجر (بقالة) — تُوسم به البذور.
pub const DEFAULT_STORE_MODE: &str = "grocery";

/// الحالة النهائية الكاملة لمخطط أندرويد v57 (تثبيت طازج).
/// كل الأعمدة التي أضافتها الترحيلات v2..v27 مدمجة هنا مباشرة
/// بنفس القيود CHECK النهائية (بما فيها 'online' من ترحيل v24).
const DDL: &str = r#"
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  store_mode TEXT
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'piece',
  store_mode TEXT
);
CREATE TABLE IF NOT EXISTS product_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  conversion REAL NOT NULL DEFAULT 1,
  barcode TEXT,
  retail_price REAL,
  wholesale_price REAL,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE CASCADE,
  UNIQUE(product_id, unit_id)
);
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'variant'
    CHECK (kind IN ('variant','size')),
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  stock_quantity REAL NOT NULL DEFAULT 0,
  retail_price REAL,
  cost_price REAL,
  created_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE(product_id, kind, color, size)
);
CREATE TABLE IF NOT EXISTS stocktakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  status TEXT NOT NULL DEFAULT 'open',
  note TEXT
);
CREATE TABLE IF NOT EXISTS stocktake_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  variant_id INTEGER,
  variant_label TEXT,
  system_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL,
  FOREIGN KEY(stocktake_id) REFERENCES stocktakes(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
);
-- ملاحظة: فهرس idx_stocktake_items_line يُنشأ في heal_v57 بعد ضمان
-- عمود variant_id (نفس درس v23.0.1 الأندرويد: لا فهرس قبل عموده).
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cost_price REAL NOT NULL,
  retail_price REAL NOT NULL,
  wholesale_price REAL NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER,
  image_uri TEXT,
  low_stock_threshold INTEGER,
  barcode TEXT,
  sold_by_weight INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  expiry_date TEXT,
  style_group TEXT,
  variant_size TEXT,
  variant_color TEXT,
  has_variants INTEGER NOT NULL DEFAULT 0,
  base_unit_name TEXT,
  stock_untracked INTEGER NOT NULL DEFAULT 0,
  sizes_count INTEGER,
  discount_pct REAL NOT NULL DEFAULT 0,
  online_listed INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);
CREATE TABLE IF NOT EXISTS product_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  embedding_data TEXT NOT NULL,
  angle_label TEXT,
  thumbnail_path TEXT,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE,
  total_amount REAL NOT NULL,
  total_cost REAL NOT NULL,
  total_profit REAL NOT NULL,
  discount REAL DEFAULT 0,
  payment_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  returned_minor REAL NOT NULL DEFAULT 0,
  return_kind TEXT
    CHECK (return_kind IS NULL OR return_kind IN ('cash','sila','local','online')),
  cashier_id INTEGER,
  -- v59 (الجولة 63): مرجع عملية الكاشير الفريد (ميزة العمل دون اتصال)
  client_ref TEXT,
  -- v70 (الجولة 74 #2): طريقة الدفع المختارة (بنك/محفظة/نقدي)
  -- لتتبع الأرصدة — NULL = نقدي (توافق المبيعات القديمة).
  payment_method TEXT
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  cost_price REAL NOT NULL,
  total_line_price REAL NOT NULL,
  unit_name TEXT,
  base_quantity REAL,
  variant_label TEXT,
  variant_id INTEGER,
  variant_color TEXT,
  FOREIGN KEY(sale_id) REFERENCES sales(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS sale_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  invoice_ref TEXT NOT NULL,
  book TEXT NOT NULL
    CHECK (book IN ('cash','sila','local','online')),
  refund_method TEXT NOT NULL DEFAULT 'none'
    CHECK (refund_method IN ('none','cash')),
  refund_minor INTEGER NOT NULL CHECK (refund_minor > 0),
  debt_adjusted_minor INTEGER NOT NULL DEFAULT 0,
  is_exchange INTEGER NOT NULL DEFAULT 0,
  exchange_minor INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cashier_id INTEGER,
  -- v59 (الجولة 63): مرجع عملية المرتجع الفريد من جهاز الكاشير
  client_ref TEXT,
  -- v70 (الجولة 74 #2): طريقة الدفع الأصلية للفاتورة المرجَعة
  -- (يُرَد المبلغ لنفس الحساب/المحفظة) — NULL = نقدي.
  payment_method TEXT
);
CREATE TABLE IF NOT EXISTS sale_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_name TEXT,
  base_quantity REAL NOT NULL CHECK (base_quantity > 0),
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sale_return_exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_name TEXT,
  base_quantity REAL NOT NULL CHECK (base_quantity > 0),
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  variant_id INTEGER,
  variant_color TEXT,
  variant_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sale_returns_sale ON sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_created ON sale_returns(created_at);
CREATE INDEX IF NOT EXISTS idx_sri_return ON sale_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sri_sale_item ON sale_return_items(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_srex_return ON sale_return_exchanges(return_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_barcode ON product_units(barcode);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_stocktakes_status ON stocktakes(status);
CREATE INDEX IF NOT EXISTS idx_stocktake_items_session ON stocktake_items(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_product ON product_embeddings(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE TABLE IF NOT EXISTS sila_debt_queue (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_id TEXT,
  customer_name TEXT,
  customer_phone_last4 TEXT,
  customer_card TEXT,
  offline_qr TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ILS',
  pos_invoice_ref TEXT NOT NULL UNIQUE,
  description TEXT,
  scanned_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','syncing','synced','failed')),
  reference_code TEXT,
  transaction_id TEXT,
  outstanding_after INTEGER,
  synced_at TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  credit_covered_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sila_customers (
  customer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_last4 TEXT,
  id_number TEXT,
  outstanding_minor INTEGER NOT NULL DEFAULT 0,
  credit_minor INTEGER NOT NULL DEFAULT 0,
  reconcile_offset_minor INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  pos_outstanding_minor INTEGER NOT NULL DEFAULT 0,
  app_outstanding_minor INTEGER NOT NULL DEFAULT 0,
  other_minor INTEGER NOT NULL DEFAULT 0,
  pos_purchases_minor INTEGER NOT NULL DEFAULT 0,
  app_purchases_minor INTEGER NOT NULL DEFAULT 0,
  last_payment_at TEXT,
  last_payment_amount_minor INTEGER,
  device_outstanding_minor INTEGER NOT NULL DEFAULT 0,
  device_purchases_minor INTEGER NOT NULL DEFAULT 0,
  device_payments_minor INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sila_payment_queue (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_id TEXT,
  customer_name TEXT,
  customer_phone_last4 TEXT,
  amount_minor INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  pos_receipt_ref TEXT NOT NULL UNIQUE,
  description TEXT,
  paid_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','syncing','synced','failed')),
  kind TEXT NOT NULL DEFAULT 'repayment'
    CHECK (kind IN ('repayment','return_reversal')),
  reference_code TEXT,
  transaction_id TEXT,
  outstanding_after INTEGER,
  synced_at TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sila_dq_state ON sila_debt_queue(state, created_at);
CREATE INDEX IF NOT EXISTS idx_sila_pq_state ON sila_payment_queue(state, created_at);
CREATE TABLE IF NOT EXISTS local_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  id_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  sila_customer_id TEXT,
  sila_linked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS local_debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_customer_id INTEGER NOT NULL REFERENCES local_customers(id) ON DELETE CASCADE,
  invoice_ref TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  description TEXT,
  migrated INTEGER NOT NULL DEFAULT 0,
  migrated_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS local_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_customer_id INTEGER NOT NULL REFERENCES local_customers(id) ON DELETE CASCADE,
  receipt_ref TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash','card','other')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_local_debts_cust ON local_debts(local_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_pays_cust ON local_payments(local_customer_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sila_app_collections (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id TEXT NOT NULL,
  customer_name TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  pos_purchases_minor INTEGER,
  pos_outstanding_minor INTEGER,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sila_acct_cust ON sila_app_collections(customer_id, detected_at DESC);
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  campaign_kind TEXT,
  voucher_id TEXT,
  value_minor INTEGER NOT NULL DEFAULT 0,
  pos_receipt_ref TEXT UNIQUE,
  reference_code TEXT,
  beneficiary_last4 TEXT,
  redeemed_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','ok','failed')),
  cart_json TEXT,
  sale_id INTEGER,
  counter_extra_minor INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vr_state ON voucher_redemptions(state, created_at);
CREATE TABLE IF NOT EXISTS campaign_debts (
  campaign_id TEXT PRIMARY KEY,
  campaign_name TEXT NOT NULL,
  kind TEXT,
  campaign_status TEXT,
  merchant_status TEXT,
  starts_at TEXT,
  ends_at TEXT,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  redeemed_value_minor INTEGER NOT NULL DEFAULT 0,
  settled_minor INTEGER NOT NULL DEFAULT 0,
  settled_pending_minor INTEGER NOT NULL DEFAULT 0,
  settled_confirmed_minor INTEGER NOT NULL DEFAULT 0,
  due_minor INTEGER NOT NULL DEFAULT 0,
  settlement_state TEXT NOT NULL DEFAULT 'none'
    CHECK (settlement_state IN ('none','partial','full')),
  last_redemption_at TEXT,
  last_settlement_at TEXT,
  updated_at TEXT,
  active_in_store INTEGER NOT NULL DEFAULT 0,
  store_state TEXT NOT NULL DEFAULT 'available'
    CHECK (store_state IN ('available','active','completed'))
);
CREATE INDEX IF NOT EXISTS idx_cdebts_active ON campaign_debts(active_in_store, due_minor DESC);
CREATE INDEX IF NOT EXISTS idx_cdebts_store_state ON campaign_debts(store_state, due_minor DESC);
CREATE TABLE IF NOT EXISTS campaign_settlements (
  settlement_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  amount_minor INTEGER NOT NULL,
  kind TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','disputed','cancelled')),
  method TEXT,
  reference TEXT,
  created_at TEXT NOT NULL,
  mirrored_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_csettle_campaign ON campaign_settlements(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csettle_status ON campaign_settlements(status, created_at);
CREATE TABLE IF NOT EXISTS cash_movements (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL
    CHECK (kind IN ('expense','withdrawal','deposit','online_collection','online_refund')),
  category TEXT NOT NULL DEFAULT 'أخرى',
  note TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  auth_method TEXT NOT NULL DEFAULT 'none'
    CHECK (auth_method IN ('fingerprint','pin','none')),
  photo_path TEXT,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_mov_kind_date ON cash_movements(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_mov_date ON cash_movements(created_at);
CREATE TABLE IF NOT EXISTS online_orders (
  server_id INTEGER PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
    CHECK (status IN ('new','accepted','rejected','sent','delivered','cancelled','returned')),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_id_number TEXT NOT NULL DEFAULT '',
  region_name TEXT,
  address TEXT,
  note TEXT,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  items_total_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  returned_minor INTEGER NOT NULL DEFAULT 0,
  invoice_ref TEXT,
  sale_id INTEGER,
  reject_reason TEXT,
  cancel_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  server_created_at INTEGER NOT NULL DEFAULT 0,
  server_updated_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_online_orders_status ON online_orders(status, server_updated_at);
CREATE TABLE IF NOT EXISTS online_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_order_id INTEGER NOT NULL REFERENCES online_orders(server_id) ON DELETE CASCADE,
  product_id INTEGER,
  product_ref TEXT,
  product_name TEXT NOT NULL,
  variant TEXT,
  unit_price_minor INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  line_total_minor INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_online_items_variant_unique
 ON online_order_items(server_order_id, product_ref, COALESCE(variant, ''));
-- ── v58 (الجولة 62): الكاشير على الشبكة المحلية (سيلّا كاشير) ──
-- حسابات الكاشيرين (كلمة المرور SHA-512 مملّحة فقط) وأجهزتهم
-- (أول اتصال pending حتى يوافق المدير).
CREATE TABLE IF NOT EXISTS lan_cashiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  max_discount_pct REAL NOT NULL DEFAULT 10,
  can_debt INTEGER NOT NULL DEFAULT 1,
  can_return INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS lan_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cashier_id INTEGER NOT NULL REFERENCES lan_cashiers(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied')),
  token TEXT,
  ip TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_seen_at TEXT,
  UNIQUE (cashier_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_landev_status ON lan_devices(status, cashier_id);
"#;

/// هل الجدول موجود؟
fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |_| Ok(()),
    )
    .is_ok()
}

/// هل العمود موجود في الجدول؟ (pragma_table_info — نفس أسلوب الأندرويد)
/// الجدول غير الموجود يُعتبر مكتملاً: أنشأه DDL للتو بكل أعمدته.
fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    if !table_exists(conn, table) {
        return true;
    }
    let sql = format!(
        "SELECT COUNT(*) AS cnt FROM pragma_table_info('{table}') WHERE name = ?"
    );
    conn.query_row(&sql, [column], |r| r.get::<_, i64>(0))
        .map(|c| c > 0)
        .unwrap_or(false)
}

/// شفاء قاعدة سطح المكتب القديمة (v1.0.0 — مخطط أندرويد v6):
/// إضافة كل أعمدة v57 الناقصة بأعمدة ALTER محروسة (idempotent)،
/// وإعادة بناء stocktake_items بصفوف المتغيرات (نفس ترحيل v22).
fn heal_v57(conn: &Connection) -> Result<()> {
    let upgrades: &[(&str, &str, &str)] = &[
        ("categories", "store_mode", "TEXT"),
        ("units", "kind", "TEXT NOT NULL DEFAULT 'piece'"),
        ("units", "store_mode", "TEXT"),
        ("products", "sold_by_weight", "INTEGER NOT NULL DEFAULT 0"),
        ("products", "is_archived", "INTEGER NOT NULL DEFAULT 0"),
        ("products", "expiry_date", "TEXT"),
        ("products", "style_group", "TEXT"),
        ("products", "variant_size", "TEXT"),
        ("products", "variant_color", "TEXT"),
        ("products", "has_variants", "INTEGER NOT NULL DEFAULT 0"),
        ("products", "base_unit_name", "TEXT"),
        ("products", "stock_untracked", "INTEGER NOT NULL DEFAULT 0"),
        ("products", "sizes_count", "INTEGER"),
        ("products", "discount_pct", "REAL NOT NULL DEFAULT 0"),
        ("products", "online_listed", "INTEGER NOT NULL DEFAULT 0"),
        ("product_embeddings", "thumbnail_path", "TEXT"),
        ("sales", "returned_minor", "REAL NOT NULL DEFAULT 0"),
        ("sales", "cashier_id", "INTEGER"),
        ("sale_items", "variant_label", "TEXT"),
        ("sale_items", "variant_id", "INTEGER"),
        ("sale_items", "variant_color", "TEXT"),
        ("sale_returns", "is_exchange", "INTEGER NOT NULL DEFAULT 0"),
        ("sale_returns", "cashier_id", "INTEGER"),
        ("sale_returns", "exchange_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_debt_queue", "credit_covered_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "credit_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "reconcile_offset_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "pos_outstanding_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "app_outstanding_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "other_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "pos_purchases_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "app_purchases_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "last_payment_at", "TEXT"),
        ("sila_customers", "last_payment_amount_minor", "INTEGER"),
        ("sila_customers", "device_outstanding_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "device_purchases_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_customers", "device_payments_minor", "INTEGER NOT NULL DEFAULT 0"),
        ("sila_payment_queue", "kind", "TEXT NOT NULL DEFAULT 'repayment'"),
        ("cash_movements", "photo_path", "TEXT"),
        ("online_order_items", "variant", "TEXT"),
        // ── v59 (الجولة 63): مزامنة الكاشير دون اتصال + الصلاحيات ──
        ("sales", "client_ref", "TEXT"),
        ("sale_returns", "client_ref", "TEXT"),
        ("lan_cashiers", "can_debt", "INTEGER NOT NULL DEFAULT 1"),
        ("lan_cashiers", "can_return", "INTEGER NOT NULL DEFAULT 1"),
        // ── v70 (الجولة 74 #2): طريقة الدفع لكل عملية (بنك/محفظة/
        // نقدي) لتتبع الأرصدة الواردة — NULL = نقدي (المبيعات
        // القديمة قبل v70 تبقى محسوبة نقداً بلا ترحيل).
        ("sales", "payment_method", "TEXT"),
        ("sale_returns", "payment_method", "TEXT"),
    ];
    for (table, column, ddl) in upgrades {
        if !has_column(conn, table, column) {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {ddl}"),
                [],
            )?;
        }
    }
    // sales.return_kind: قيد CHECK الفعلي موجود فقط في جدول طازج؛
    // القاعدة القديمة تكتفي بالعمود (نفس نهج الأندرويد في الترحيل v15
    // — القيود تُطبق على التثبيتات الجديدة، والعمود يكفي للقديمة).
    if !has_column(conn, "sales", "return_kind") {
        conn.execute_batch("ALTER TABLE sales ADD COLUMN return_kind TEXT")?;
    }
    // stocktake_items: إعادة البناء بصفوف المتغيرات (ترحيل v22).
    if !has_column(conn, "stocktake_items", "variant_id") {
        conn.execute_batch(
            "CREATE TABLE stocktake_items_v22 (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               stocktake_id INTEGER NOT NULL,
               product_id INTEGER NOT NULL,
               variant_id INTEGER,
               variant_label TEXT,
               system_qty REAL NOT NULL DEFAULT 0,
               counted_qty REAL,
               FOREIGN KEY(stocktake_id) REFERENCES stocktakes(id) ON DELETE CASCADE,
               FOREIGN KEY(product_id) REFERENCES products(id),
               FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
             );
             INSERT INTO stocktake_items_v22
               (stocktake_id, product_id, system_qty, counted_qty)
             SELECT stocktake_id, product_id, system_qty, counted_qty
               FROM stocktake_items;
             DROP TABLE stocktake_items;
             ALTER TABLE stocktake_items_v22 RENAME TO stocktake_items;",
        )?;
    }
    // ── فهارس لا تُنشأ إلا بعد ضمان أعمدتها (درس v23.0.1) ──
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_stocktake_items_line
           ON stocktake_items(stocktake_id, product_id, IFNULL(variant_id, 0));
         CREATE INDEX IF NOT EXISTS idx_products_archived
           ON products(is_archived, name);
         CREATE INDEX IF NOT EXISTS idx_sales_return_kind ON sales(return_kind);
         -- v59: ميزة عمليات الكاشير (لا ازدواج عند إعادة المزامنة)
         CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_ref
           ON sales(client_ref) WHERE client_ref IS NOT NULL;
         CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_returns_client_ref
           ON sale_returns(client_ref) WHERE client_ref IS NOT NULL;",
    )?;
    Ok(())
}

/// يفتح القاعدة ويطبق DDL/البذور — مكافئ initDatabase() كاملاً.
pub fn open_and_init(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    init_with(&conn)?;
    Ok(conn)
}

/// فتح اتصال جلسة (معاملة) على نفس الملف — نفس الأعلام.
pub fn open_session(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(conn)
}

/// نفس الدالة لكن على اتصال قائم (اختبارات/ترقية عند التحديث).
pub fn init_with(conn: &Connection) -> Result<()> {
    conn.execute_batch(DDL)?;
    heal_v57(conn)?;

    // ── بذر التصنيفات/الوحدات مرة واحدة ── (نفس initDatabase)
    let cats: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))?;
    if cats == 0 {
        for name in DEFAULT_CATEGORIES {
            conn.execute(
                "INSERT INTO categories (name, store_mode) VALUES (?1, ?2)",
                rusqlite::params![name, DEFAULT_STORE_MODE],
            )?;
        }
    }
    let units: i64 = conn.query_row("SELECT COUNT(*) FROM units", [], |r| r.get(0))?;
    if units == 0 {
        for (i, (name, short, kind)) in DEFAULT_UNITS.iter().enumerate() {
            conn.execute(
                "INSERT INTO units (name, short_name, sort_order, kind, store_mode)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![name, short, i as i64, kind, DEFAULT_STORE_MODE],
            )?;
        }
    }
    Ok(())
}

/// كل جداول بيانات العمل (للمسح والنسخ) — بنفس ترتيب wipeAllData().
pub const BUSINESS_TABLES: [&str; 27] = [
    "stocktake_items",
    "stocktakes",
    "sale_return_items",
    "sale_return_exchanges",
    "sale_returns",
    "sale_items",
    "sales",
    "product_embeddings",
    "product_units",
    "product_variants",
    "products",
    "categories",
    "units",
    "sila_customers",
    "sila_debt_queue",
    "sila_payment_queue",
    "sila_app_collections",
    "local_payments",
    "local_debts",
    "local_customers",
    "campaign_settlements",
    "campaign_debts",
    "voucher_redemptions",
    "cash_movements",
    "online_order_items",
    "online_orders",
    "sqlite_sequence",
];

/// مسح كل بيانات العمل — بنفس ترتيب wipeAllData() الأندرويد v57.
pub fn wipe_all(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    for table in BUSINESS_TABLES {
        if table == "sqlite_sequence" {
            continue;
        }
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    tx.execute(
        "DELETE FROM sqlite_sequence WHERE name IN
         ('categories','units','products','product_embeddings','product_units',
          'product_variants','sales','sale_items','stocktakes','stocktake_items',
          'sale_returns','sale_return_items','sale_return_exchanges',
          'sila_debt_queue','sila_payment_queue','sila_app_collections',
          'local_customers','local_debts','local_payments','voucher_redemptions',
          'campaign_settlements','cash_movements','online_order_items')",
        [],
    )?;
    // إعادة البذر بعد المسح (نفس سلوك إعادة أول تشغيل).
    for name in DEFAULT_CATEGORIES {
        tx.execute(
            "INSERT INTO categories (name, store_mode) VALUES (?1, ?2)",
            rusqlite::params![name, DEFAULT_STORE_MODE],
        )?;
    }
    for (i, (name, short, kind)) in DEFAULT_UNITS.iter().enumerate() {
        tx.execute(
            "INSERT INTO units (name, short_name, sort_order, kind, store_mode)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![name, short, i as i64, kind, DEFAULT_STORE_MODE],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_seeds_once_and_respects_existing() {
        let dir = tempfile_dir();
        let path = dir.join("t.db");
        {
            let conn = open_and_init(&path).unwrap();
            let cats: i64 =
                conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();
            let units: i64 =
                conn.query_row("SELECT COUNT(*) FROM units", [], |r| r.get(0)).unwrap();
            assert_eq!(cats, 6, "بذر التصنيفات مرة واحدة");
            assert_eq!(units, 23, "كتالوج الوحدات الكامل (23 وحدة)");
            // أعمدة v57 كلها حية على التثبيت الطازج.
            for (t, c) in [
                ("products", "discount_pct"),
                ("products", "online_listed"),
                ("products", "has_variants"),
                ("sales", "return_kind"),
                ("sale_items", "variant_id"),
                ("cash_movements", "photo_path"),
                ("online_orders", "invoice_ref"),
                ("campaign_debts", "store_state"),
                ("sila_customers", "device_outstanding_minor"),
            ] {
                assert!(has_column(&conn, t, c), "عمود {t}.{c} مفقود");
            }
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM online_orders", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0);
        }
        // إعادة الفتح لا تضاعف البذور.
        {
            let conn = open_and_init(&path).unwrap();
            let cats: i64 =
                conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();
            assert_eq!(cats, 6, "لا تكرار بذر عند إعادة الفتح");
        }
    }

    #[test]
    fn heals_old_v1_desktop_database() {
        let dir = tempfile_dir();
        let path = dir.join("old.db");
        {
            // قاعدة v1.0.0 القديمة (مخطط v6): بلا أعمدة v57 وبلا جداولها.
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
                 CREATE TABLE units (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                   short_name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                   cost_price REAL NOT NULL, retail_price REAL NOT NULL, wholesale_price REAL NOT NULL,
                   stock_quantity INTEGER NOT NULL DEFAULT 0, category_id INTEGER, image_uri TEXT,
                   low_stock_threshold INTEGER, barcode TEXT,
                   created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
                 CREATE TABLE stocktakes (id INTEGER PRIMARY KEY AUTOINCREMENT,
                   started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME,
                   status TEXT NOT NULL DEFAULT 'open', note TEXT);
                 CREATE TABLE stocktake_items (id INTEGER PRIMARY KEY AUTOINCREMENT,
                   stocktake_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
                   system_qty REAL NOT NULL DEFAULT 0, counted_qty REAL);
                 CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT,
                   invoice_number TEXT UNIQUE, total_amount REAL NOT NULL, total_cost REAL NOT NULL,
                   total_profit REAL NOT NULL, discount REAL DEFAULT 0, payment_type TEXT,
                   created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
                 INSERT INTO categories (name) VALUES ('مشروبات');
                 INSERT INTO units (name, short_name) VALUES ('قطعة', 'ق');
                 INSERT INTO products (name, cost_price, retail_price, wholesale_price, stock_quantity)
                   VALUES ('شوكولاتة', 2, 4, 3.5, 10);
                 INSERT INTO stocktakes (id, status) VALUES (1, 'open');
                 INSERT INTO stocktake_items (stocktake_id, product_id, system_qty, counted_qty)
                   VALUES (1, 1, 5, 4);",
            )
            .unwrap();
        }
        // الترقية: DDL + شفاء محروس.
        {
            let conn = open_and_init(&path).unwrap();
            assert!(has_column(&conn, "products", "discount_pct"));
            assert!(has_column(&conn, "sales", "return_kind"));
            assert!(has_column(&conn, "stocktake_items", "variant_id"));
            // عدّ الجرد القديم نجا إعادة البناء.
            let rows: i64 = conn
                .query_row("SELECT COUNT(*) FROM stocktake_items", [], |r| r.get(0))
                .unwrap();
            assert_eq!(rows, 1, "عدّ الجرد القديم محفوظ بعد إعادة البناء");
            // البذور لم تُكرر (القاعدة فيها بيانات).
            let cats: i64 =
                conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();
            assert_eq!(cats, 1);
        }
    }

    #[test]
    fn wipe_then_reseed() {
        let dir = tempfile_dir();
        let mut conn = open_and_init(&dir.join("t2.db")).unwrap();
        conn.execute(
            "INSERT INTO products (name, cost_price, retail_price, wholesale_price, stock_quantity)
             VALUES ('شوكولاتة', 2, 4, 3.5, 10)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cash_movements (ref, kind, category, amount_minor)
             VALUES ('EXP-000001', 'expense', 'أخرى', 500)",
            [],
        )
        .unwrap();
        wipe_all(&mut conn).unwrap();
        let p: i64 = conn
            .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
            .unwrap();
        assert_eq!(p, 0);
        let cm: i64 = conn
            .query_row("SELECT COUNT(*) FROM cash_movements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cm, 0);
        let cats: i64 =
            conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 6, "إعادة البذر بعد المسح");
        let units: i64 =
            conn.query_row("SELECT COUNT(*) FROM units", [], |r| r.get(0)).unwrap();
        assert_eq!(units, 23, "إعادة بذر كتالوج الوحدات");
    }

    fn tempfile_dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("sela-test-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
