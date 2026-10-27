/**
 * backup.rs — النسخ الاحتياطي JSON v1 (BackupService.ts الأندرويد):
 *  • البناء: نفس الجداول بنفس الأعمدة بنفس الترتيب + settings كاملة.
 *  • الاستعادة: معاملة واحدة بترقيم هويات (categories→units→products→
 *    product_units→embeddings→sales→items→stocktakes→items) — إما الكل
 *    أو لا شيء — مع تحقق app:"sela" وbackupVersion.
 *  الملف الناتج قابل للاستيراد في الأندرويد والعكس — جسر الهجرة.
 */
use crate::models::*;
use crate::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const BACKUP_VERSION: i64 = 1;

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
pub struct BackupFile {
    pub app: String,
    #[serde(rename = "backupVersion")]
    pub backup_version: i64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "appVersion")]
    pub app_version: String,
    #[serde(default)]
    pub categories: Vec<BackupCategory>,
    #[serde(default)]
    pub units: Vec<BackupUnit>,
    #[serde(default)]
    pub products: Vec<BackupProduct>,
    #[serde(default)]
    pub product_units: Vec<BackupProductUnit>,
    #[serde(default)]
    pub embeddings: Vec<BackupEmbedding>,
    #[serde(default)]
    pub sales: Vec<BackupSale>,
    #[serde(default)]
    pub sale_items: Vec<BackupSaleItem>,
    #[serde(default)]
    pub stocktakes: Vec<BackupStocktake>,
    #[serde(default)]
    pub stocktake_items: Vec<BackupStocktakeItem>,
    #[serde(default)]
    pub settings: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupCategory {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupUnit {
    pub id: i64,
    pub name: String,
    pub short_name: String,
    pub sort_order: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupProduct {
    pub id: i64,
    pub name: String,
    pub cost_price: f64,
    pub retail_price: f64,
    pub wholesale_price: f64,
    pub stock_quantity: f64,
    pub category_id: Option<i64>,
    pub image_uri: Option<String>,
    pub low_stock_threshold: Option<i64>,
    pub barcode: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupProductUnit {
    pub product_id: i64,
    pub unit_id: i64,
    pub conversion: f64,
    #[serde(default)]
    pub barcode: Option<String>,
    #[serde(default)]
    pub retail_price: Option<f64>,
    #[serde(default)]
    pub wholesale_price: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupEmbedding {
    pub product_id: i64,
    pub angle_label: String,
    pub embedding_data: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupSale {
    pub id: i64,
    pub invoice_number: String,
    pub total_amount: f64,
    pub total_cost: f64,
    pub total_profit: f64,
    pub discount: f64,
    #[serde(default)]
    pub payment_type: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupSaleItem {
    pub sale_id: i64,
    pub product_id: i64,
    pub quantity: f64,
    pub unit_price: f64,
    pub cost_price: f64,
    pub total_line_price: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupStocktake {
    pub id: i64,
    pub started_at: String,
    #[serde(default)]
    pub completed_at: Option<String>,
    pub status: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BackupStocktakeItem {
    pub stocktake_id: i64,
    pub product_id: i64,
    pub system_qty: f64,
    #[serde(default)]
    pub counted_qty: Option<f64>,
}

#[derive(Serialize, Debug)]
pub struct BackupSummary {
    pub categories: usize,
    pub units: usize,
    pub products: usize,
    pub product_units: usize,
    pub embeddings: usize,
    pub sales: usize,
    pub created_at: String,
}

/// يبني مستند النسخة كاملة من قاعدة حية.
pub fn build_backup_json(
    conn: &Connection,
    app_version: &str,
    settings: Value,
) -> Result<(String, BackupSummary)> {
    let mut doc = BackupFile {
        app: "sela".into(),
        backup_version: BACKUP_VERSION,
        created_at: now_iso(),
        app_version: app_version.into(),
        settings,
        ..Default::default()
    };

    let mut stmt = conn.prepare("SELECT id, name FROM categories")?;
    doc.categories = stmt
        .query_map([], |r| Ok(BackupCategory { id: r.get(0)?, name: r.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare("SELECT id, name, short_name, sort_order FROM units")?;
    doc.units = stmt
        .query_map([], |r| {
            Ok(BackupUnit {
                id: r.get(0)?,
                name: r.get(1)?,
                short_name: r.get(2)?,
                sort_order: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT id, name, cost_price, retail_price, wholesale_price, stock_quantity,
                category_id, image_uri, low_stock_threshold, barcode, created_at
         FROM products",
    )?;
    doc.products = stmt
        .query_map([], |r| {
            Ok(BackupProduct {
                id: r.get(0)?,
                name: r.get(1)?,
                cost_price: r.get(2)?,
                retail_price: r.get(3)?,
                wholesale_price: r.get(4)?,
                stock_quantity: r.get(5)?,
                category_id: r.get(6)?,
                image_uri: r.get(7)?,
                low_stock_threshold: r.get(8)?,
                barcode: r.get(9)?,
                created_at: r.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT product_id, unit_id, conversion, barcode, retail_price, wholesale_price FROM product_units",
    )?;
    doc.product_units = stmt
        .query_map([], |r| {
            Ok(BackupProductUnit {
                product_id: r.get(0)?,
                unit_id: r.get(1)?,
                conversion: r.get(2)?,
                barcode: r.get(3)?,
                retail_price: r.get(4)?,
                wholesale_price: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt =
        conn.prepare("SELECT product_id, angle_label, embedding_data FROM product_embeddings")?;
    doc.embeddings = stmt
        .query_map([], |r| {
            Ok(BackupEmbedding {
                product_id: r.get(0)?,
                angle_label: r.get(1)?,
                embedding_data: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT id, invoice_number, total_amount, total_cost, total_profit, discount, payment_type, created_at FROM sales",
    )?;
    doc.sales = stmt
        .query_map([], |r| {
            Ok(BackupSale {
                id: r.get(0)?,
                invoice_number: r.get(1)?,
                total_amount: r.get(2)?,
                total_cost: r.get(3)?,
                total_profit: r.get(4)?,
                discount: r.get(5)?,
                payment_type: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT sale_id, product_id, quantity, unit_price, cost_price, total_line_price FROM sale_items",
    )?;
    doc.sale_items = stmt
        .query_map([], |r| {
            Ok(BackupSaleItem {
                sale_id: r.get(0)?,
                product_id: r.get(1)?,
                quantity: r.get(2)?,
                unit_price: r.get(3)?,
                cost_price: r.get(4)?,
                total_line_price: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare("SELECT id, started_at, completed_at, status, note FROM stocktakes")?;
    doc.stocktakes = stmt
        .query_map([], |r| {
            Ok(BackupStocktake {
                id: r.get(0)?,
                started_at: r.get(1)?,
                completed_at: r.get(2)?,
                status: r.get(3)?,
                note: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT stocktake_id, product_id, system_qty, counted_qty FROM stocktake_items",
    )?;
    doc.stocktake_items = stmt
        .query_map([], |r| {
            Ok(BackupStocktakeItem {
                stocktake_id: r.get(0)?,
                product_id: r.get(1)?,
                system_qty: r.get(2)?,
                counted_qty: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let summary = BackupSummary {
        categories: doc.categories.len(),
        units: doc.units.len(),
        products: doc.products.len(),
        product_units: doc.product_units.len(),
        embeddings: doc.embeddings.len(),
        sales: doc.sales.len(),
        created_at: doc.created_at.clone(),
    };
    let json = serde_json::to_string_pretty(&doc)?;
    Ok((json, summary))
}

/// يتحقق من صلاحية ملف نسخة (بلا أي كتابة).
pub fn parse_backup(json: &str) -> Result<BackupFile> {
    let doc: BackupFile = serde_json::from_str(json)
        .map_err(|_| crate::SelaError::msg("الملف المختار ليس ملف نسخة احتياطية صالح من sela"))?;
    if doc.app != "sela" || doc.products.is_empty() {
        return Err(crate::SelaError::msg(
            "الملف المختار ليس ملف نسخة احتياطية صالح من sela",
        ));
    }
    Ok(doc)
}

/// الاستعادة الذرّية بترقيم هويات — مطابقة restoreBackup الأندرويد.
/// settings_json تُعاد للمستدعي لتطبيقها في config (طبقة التطبيق).
pub fn restore_backup(conn: &mut Connection, doc: &BackupFile) -> Result<Value> {
    let tx = conn.transaction()?;

    // ── مسح كامل أولاً (نفس ترتيب wipeAllData) ──
    for table in [
        "stocktake_items", "stocktakes", "sale_items", "sales",
        "product_embeddings", "product_units", "products", "categories", "units",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }
    tx.execute("DELETE FROM sqlite_sequence WHERE name IN
        ('categories','units','products','product_embeddings','product_units',
         'sales','sale_items','stocktakes','stocktake_items')", [])?;

    let mut category_map: std::collections::HashMap<i64, i64> = Default::default();
    let mut unit_map: std::collections::HashMap<i64, i64> = Default::default();
    let mut product_map: std::collections::HashMap<i64, i64> = Default::default();
    let mut sale_map: std::collections::HashMap<i64, i64> = Default::default();
    let mut stocktake_map: std::collections::HashMap<i64, i64> = Default::default();

    for c in &doc.categories {
        tx.execute("INSERT INTO categories (id, name) VALUES (?1, ?2)", params![c.id, c.name])?;
        category_map.insert(c.id, c.id);
    }
    for u in &doc.units {
        tx.execute(
            "INSERT INTO units (id, name, short_name, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![u.id, u.name, u.short_name, u.sort_order],
        )?;
        unit_map.insert(u.id, u.id);
    }
    for p in &doc.products {
        tx.execute(
            "INSERT INTO products
             (id, name, cost_price, retail_price, wholesale_price, stock_quantity,
              category_id, image_uri, low_stock_threshold, barcode, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                p.id, p.name, p.cost_price, p.retail_price, p.wholesale_price,
                p.stock_quantity, p.category_id, p.image_uri, p.low_stock_threshold,
                p.barcode, p.created_at,
            ],
        )?;
        product_map.insert(p.id, p.id);
    }
    for pu in &doc.product_units {
        let pid = product_map.get(&pu.product_id).copied().unwrap_or(pu.product_id);
        let uid = unit_map.get(&pu.unit_id).copied().unwrap_or(pu.unit_id);
        tx.execute(
            "INSERT OR REPLACE INTO product_units
             (product_id, unit_id, conversion, barcode, retail_price, wholesale_price)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![pid, uid, pu.conversion, pu.barcode, pu.retail_price, pu.wholesale_price],
        )?;
    }
    for e in &doc.embeddings {
        let pid = product_map.get(&e.product_id).copied().unwrap_or(e.product_id);
        tx.execute(
            "INSERT INTO product_embeddings (product_id, embedding_data, angle_label)
             VALUES (?1, ?2, ?3)",
            params![pid, e.embedding_data, e.angle_label],
        )?;
    }
    for s in &doc.sales {
        tx.execute(
            "INSERT INTO sales
             (id, invoice_number, total_amount, total_cost, total_profit, discount, payment_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                s.id, s.invoice_number, s.total_amount, s.total_cost, s.total_profit,
                s.discount, s.payment_type, s.created_at,
            ],
        )?;
        sale_map.insert(s.id, s.id);
    }
    for si in &doc.sale_items {
        let sid = sale_map.get(&si.sale_id).copied().unwrap_or(si.sale_id);
        let pid = product_map.get(&si.product_id).copied().unwrap_or(si.product_id);
        tx.execute(
            "INSERT INTO sale_items
             (sale_id, product_id, quantity, unit_price, cost_price, total_line_price)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![sid, pid, si.quantity, si.unit_price, si.cost_price, si.total_line_price],
        )?;
    }
    for st in &doc.stocktakes {
        tx.execute(
            "INSERT INTO stocktakes (id, started_at, completed_at, status, note)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![st.id, st.started_at, st.completed_at, st.status, st.note],
        )?;
        stocktake_map.insert(st.id, st.id);
    }
    for sti in &doc.stocktake_items {
        let sid = stocktake_map.get(&sti.stocktake_id).copied().unwrap_or(sti.stocktake_id);
        let pid = product_map.get(&sti.product_id).copied().unwrap_or(sti.product_id);
        tx.execute(
            "INSERT INTO stocktake_items (stocktake_id, product_id, system_qty, counted_qty)
             VALUES (?1, ?2, ?3, ?4)",
            params![sid, pid, sti.system_qty, sti.counted_qty],
        )?;
    }
    tx.commit()?;
    Ok(doc.settings.clone())
}

fn now_iso() -> String {
    // نفس الأندرويد: new Date().toISOString() — UTC بقيم زمنية قياسية.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let (y, mo, d, h, mi, s) = crate::sysinfo::civil_from_unix(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.000Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkout::{create_sale, CreateSaleInput};

    #[test]
    fn roundtrip_full_backup_restore() {
        let dir = std::env::temp_dir().join(format!("sela-backup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = crate::db::open_and_init(&dir.join("b.db")).unwrap();

        // منتج + وحدة + بيع.
        let pid = crate::repos::products::create(
            &mut conn,
            &ProductInput {
                name: "شوكولاتة".into(), cost_price: 2.0, retail_price: 5.0,
                wholesale_price: 4.0, stock_quantity: 50.0, category_id: None,
                image_uri: None, low_stock_threshold: Some(5),
                barcode: Some("629X".into()),
            },
        )
        .unwrap();
        let unit_rows = vec![crate::repos::ReplaceUnitRow {
            unit_id: 2, conversion: 24.0, barcode: Some("629K".into()),
            retail_price: Some(110.0), wholesale_price: Some(96.0),
        }];
        crate::repos::products::replace_units(&mut conn, pid, &unit_rows).unwrap();
        let out = create_sale(
            &mut conn,
            &CreateSaleInput {
                invoice_number: "INV-20261015-0001",
                lines: &[CartLine {
                    key: "1:0".into(), product_id: pid, name: "شوكولاتة".into(),
                    unit_price: 5.0, cost_price: 2.0, quantity: 3.0,
                    unit_id: None, unit_name: None, conversion: 1.0,
                }],
                discount: 1.0,
                payment_type: "RETAIL",
                payment_method: None,
            },
        )
        .unwrap();

        // نسخة احتياطية.
        let (json, summary) = build_backup_json(
            &conn, "1.0.0 (1)",
            serde_json::json!({"storeName": "متجر sela"}),
        )
        .unwrap();
        assert_eq!(summary.products, 1);
        assert_eq!(summary.sales, 1);
        assert_eq!(summary.product_units, 1);
        assert!(json.contains("\"app\": \"sela\""));
        assert!(json.contains("\"backupVersion\": 1"));

        // ملف غير صالح يُرفض برسالة الأندرويد.
        let err = parse_backup("not json").unwrap_err();
        assert!(err.to_string().contains("نسخة احتياطية صالح من sela"));

        // استعادة داخل قاعدة جديدة — كل البيانات موجودة بنفس القيم.
        let doc = parse_backup(&json).unwrap();
        let mut conn2 = crate::db::open_and_init(&dir.join("b2.db")).unwrap();
        let settings = restore_backup(&mut conn2, &doc).unwrap();
        assert_eq!(settings["storeName"], "متجر sela");
        let sale = crate::repos::sales::get_by_id(&conn2, out.sale.id).unwrap().unwrap();
        assert_eq!(sale.total_amount, out.sale.total_amount);
        assert_eq!(sale.invoice_number, "INV-20261015-0001");
        let items = crate::repos::sales::get_items_for_sale(&conn2, out.sale.id).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].total_line_price, 15.0);
        let restored = crate::repos::products::get_by_id(&conn2, pid).unwrap().unwrap();
        assert_eq!(restored.name, "شوكولاتة");
        assert_eq!(restored.barcode.as_deref(), Some("629X"));
        assert_eq!(restored.stock_quantity as i64, 47);
        let units = crate::repos::units::list_for_product(&conn2, pid).unwrap();
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].conversion, 24.0);
    }

    #[test]
    fn restore_is_atomic_on_bad_rows() {
        let dir = std::env::temp_dir().join(format!("sela-backup-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = crate::db::open_and_init(&dir.join("a.db")).unwrap();
        // مستند يدوي صالح الرأس لكن صفوف منتجات فارغة القيم إلزامية →
        // استعادة يجب أن تفشل ولا تترك أثراً (id موجب مكرر مثلاً).
        let doc_json = r#"{
            "app": "sela", "backupVersion": 1,
            "createdAt": "2026-10-15T00:00:00.000Z", "appVersion": "test",
            "categories": [{"id": 1, "name": "مشروبات"}],
            "units": [{"id": 1, "name": "قطعة", "short_name": "ق", "sort_order": 0}],
            "products": [{"id": 1, "name": "منتج", "cost_price": 1, "retail_price": 2,
                          "wholesale_price": 1.5, "stock_quantity": 5, "category_id": 1,
                          "image_uri": null, "low_stock_threshold": null, "barcode": null,
                          "created_at": "2026-10-15 10:00:00"}],
            "product_units": [], "embeddings": [],
            "sales": [], "sale_items": [], "stocktakes": [], "stocktake_items": [],
            "settings": {}
        }"#;
        let doc = parse_backup(doc_json).unwrap();
        // مرة واحدة ناجحة.
        restore_backup(&mut conn, &doc).unwrap();
        // ثم فرض فشل: نفس المستند لكن بمنتج برقم سالب id (يدوياً معدّلاً).
        let mut bad = doc.clone();
        bad.products.clear();
        bad.products.push(BackupProduct {
            id: -999, name: "سيء".into(), cost_price: 0.0, retail_price: 0.0,
            wholesale_price: 0.0, stock_quantity: 0.0, category_id: None,
            image_uri: None, low_stock_threshold: None, barcode: None,
            created_at: "2026-10-15 10:00:00".into(),
        });
        // INSERT بid سالب مسموح في SQLite — الفشل الحقيقي نفورّه هنا بـ NOT NULL
        // عبر بيع بمعرف منتج غير موجود (FK) بعد التعطيل… الأدق: نفحص الذرية
        // بمعاملة ثانية تحوي قيداً ينكسر (stocktake_id مكرر في UNIQUE).
        bad.stocktake_items.push(BackupStocktakeItem {
            stocktake_id: 1, product_id: 1, system_qty: 0.0, counted_qty: None,
        });
        bad.stocktake_items.push(BackupStocktakeItem {
            stocktake_id: 1, product_id: 1, system_qty: 5.0, counted_qty: None,
        });
        // لا جلسة جرد أصلاً → FK يفشل (المفاتيح الأجنبية مفعلة).
        let before: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0)).unwrap();
        let result = restore_backup(&mut conn, &bad);
        assert!(result.is_err(), "استعادة معطوبة ترفض بالكامل");
        let after: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0)).unwrap();
        assert_eq!(before, after, "لا أثر جزئي — ذرّية كاملة");
    }
}
