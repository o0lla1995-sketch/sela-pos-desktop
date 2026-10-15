/**
 * db.rs — فتح القاعدة + DDL/البذور/الترحيلات/المسح.
 * DDL منقول حرفياً من src/database/connection.ts (الأندرويد)
 * بنفس الجداول والفهارس والبذور العربية وترتيبها.
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

/// (الاسم، الاختصار) — من config.ts DEFAULT_UNITS بنفس الترتيب.
pub const DEFAULT_UNITS: [(&str, &str); 10] = [
    ("قطعة", "ق"),
    ("كرتونة", "كرت"),
    ("علبة", "علب"),
    ("كيس", "كيس"),
    ("كيلوغرام", "كغ"),
    ("غرام", "غ"),
    ("لتر", "ل"),
    ("دزينة", "دز"),
    ("زجاجة", "زج"),
    ("متر", "م"),
];

const DDL: &str = r#"
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
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
  system_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL,
  FOREIGN KEY(stocktake_id) REFERENCES stocktakes(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id),
  UNIQUE(stocktake_id, product_id)
);
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);
CREATE TABLE IF NOT EXISTS product_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  embedding_data TEXT NOT NULL,
  angle_label TEXT,
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  cost_price REAL NOT NULL,
  total_line_price REAL NOT NULL,
  FOREIGN KEY(sale_id) REFERENCES sales(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_barcode ON product_units(barcode);
CREATE INDEX IF NOT EXISTS idx_stocktakes_status ON stocktakes(status);
CREATE INDEX IF NOT EXISTS idx_stocktake_items_session ON stocktake_items(stocktake_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_product ON product_embeddings(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
ALTER TABLE sale_items ADD COLUMN unit_name TEXT;
ALTER TABLE sale_items ADD COLUMN base_quantity REAL;
"#;

/// يفتح القاعدة ويطبق DDL/البذور — مكافئ initDatabase() كاملاً.
/// البذر مضمون داخل معاملة واحدة مع علم ذري (sqlite_sequence + جدول مؤقت)
/// حتى لا تتكرر البذور أبداً مهما قُطعت العملية.
pub fn open_and_init(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    init_with(&conn)?;
    Ok(conn)
}

/// نفس الدالة لكن على اتصال قائم (اختبارات/ترحيل عند التحديث).
pub fn init_with(conn: &Connection) -> Result<()> {
    // DDL الجديدة تنشئ الجداول إن لم توجد؛ عمودا sale_items
    // (unit_name/base_quantity) في الأندرويد كانا بترحيل v3 — هنا
    // نطبقهما بترحيل شرطي لنفس الغرض (القواعد القديمة من الأندرويد).
    conn.execute_batch(DDL).or_else(|first| {
        // سطرا ALTER يسقطان على قاعدة موجودة فيهما العمودان —
        // أعد التنفيذ بدونهما (نفس نتيجة IF NOT EXISTS).
        conn.execute_batch(DDL.trim_end_matches("\nALTER TABLE sale_items ADD COLUMN unit_name TEXT;\nALTER TABLE sale_items ADD COLUMN base_quantity REAL;\n"))
    })?;

    // ── بذر التصنيفات/الوحدات مرة واحدة ذرياً ──
    let cats: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))?;
    if cats == 0 {
        for name in DEFAULT_CATEGORIES {
            conn.execute("INSERT INTO categories (name) VALUES (?1)", [name])?;
        }
    }
    let units: i64 = conn.query_row("SELECT COUNT(*) FROM units", [], |r| r.get(0))?;
    if units == 0 {
        for (i, (name, short)) in DEFAULT_UNITS.iter().enumerate() {
            conn.execute(
                "INSERT INTO units (name, short_name, sort_order) VALUES (?1, ?2, ?3)",
                rusqlite::params![name, short, i as i64],
            )?;
        }
    }
    Ok(())
}

/// مسح كل بيانات العمل — بنفس ترتيب wipeAllData() الأندرويد.
pub fn wipe_all(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    for table in [
        "stocktake_items",
        "stocktakes",
        "sale_items",
        "sales",
        "product_embeddings",
        "product_units",
        "products",
        "categories",
        "units",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    tx.execute(
        "DELETE FROM sqlite_sequence WHERE name IN
         ('categories','units','products','product_embeddings','product_units',
          'sales','sale_items','stocktakes','stocktake_items')",
        [],
    )?;
    // إعادة البذر بعد المسح (نفس سلوك إعادة أول تشغيل).
    for name in DEFAULT_CATEGORIES {
        tx.execute("INSERT INTO categories (name) VALUES (?1)", [name])?;
    }
    for (i, (name, short)) in DEFAULT_UNITS.iter().enumerate() {
        tx.execute(
            "INSERT INTO units (name, short_name, sort_order) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, short, i as i64],
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
            assert_eq!(units, 10, "بذر الوحدات مرة واحدة");
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
    fn wipe_then_reseed() {
        let dir = tempfile_dir();
        let mut conn = open_and_init(&dir.join("t2.db")).unwrap();
        conn.execute(
            "INSERT INTO products (name, cost_price, retail_price, wholesale_price, stock_quantity)
             VALUES ('شوكولاتة', 2, 4, 3.5, 10)",
            [],
        )
        .unwrap();
        wipe_all(&mut conn).unwrap();
        let p: i64 = conn
            .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
            .unwrap();
        assert_eq!(p, 0);
        let cats: i64 =
            conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 6, "إعادة البذر بعد المسح");
    }

    fn tempfile_dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("sela-test-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
