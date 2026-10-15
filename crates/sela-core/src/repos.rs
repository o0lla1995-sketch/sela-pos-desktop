/**
 * repos.rs — مستودعات المنتجات/التصنيفات/الوحدات/الجرد/المبيعات.
 * كل استعلام منقول من المستودع الأندرويد المقابل بنصّه (حدود LIKE،
 * الترتيب، LIMIT 500، رسائل الخطأ العربية نفسها).
 */
use crate::models::*;
use crate::sysinfo::local_now;
use crate::Result;
use rusqlite::{params, Connection, OptionalExtension};

fn row_to_product(row: &rusqlite::Row) -> rusqlite::Result<Product> {
    Ok(Product {
        id: row.get("id")?,
        name: row.get("name")?,
        cost_price: row.get("cost_price")?,
        retail_price: row.get("retail_price")?,
        wholesale_price: row.get("wholesale_price")?,
        stock_quantity: row.get::<_, i64>("stock_quantity")? as f64,
        category_id: row.get("category_id")?,
        image_uri: row.get("image_uri")?,
        created_at: row.get("created_at")?,
        low_stock_threshold: row.get("low_stock_threshold")?,
        barcode: row.get("barcode")?,
        units: None,
    })
}

fn row_to_sale(row: &rusqlite::Row) -> rusqlite::Result<SaleRecord> {
    Ok(SaleRecord {
        id: row.get("id")?,
        invoice_number: row.get("invoice_number")?,
        total_amount: row.get("total_amount")?,
        total_cost: row.get("total_cost")?,
        total_profit: row.get("total_profit")?,
        discount: row.get("discount")?,
        payment_type: row.get::<_, Option<String>>("payment_type")?.unwrap_or_else(|| "RETAIL".into()),
        created_at: row.get("created_at")?,
    })
}

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<SaleItemRecord> {
    Ok(SaleItemRecord {
        id: row.get("id")?,
        sale_id: row.get("sale_id")?,
        product_id: row.get("product_id")?,
        quantity: row.get::<_, f64>("quantity")?,
        unit_price: row.get("unit_price")?,
        cost_price: row.get("cost_price")?,
        total_line_price: row.get("total_line_price")?,
        unit_name: row.get("unit_name")?,
        base_quantity: row.get("base_quantity")?,
    })
}

fn row_to_unit_row(row: &rusqlite::Row) -> rusqlite::Result<ProductUnit> {
    Ok(ProductUnit {
        id: row.get("id")?,
        product_id: row.get("product_id")?,
        unit_id: row.get("unit_id")?,
        unit_name: row.get("unit_name")?,
        unit_short: row.get("unit_short")?,
        conversion: row.get("conversion")?,
        barcode: row.get("barcode")?,
        retail_price: row.get("retail_price")?,
        wholesale_price: row.get("wholesale_price")?,
    })
}

pub struct ProductFilter {
    pub search: Option<String>,
    pub category_id: Option<i64>, // None = الكل
}

impl Default for ProductFilter {
    fn default() -> Self {
        ProductFilter { search: None, category_id: None }
    }
}

/// ProductRepo — بنفس نصوص الاستعلامات وحدودها.
pub mod products {
    use super::*;

    pub fn list(conn: &Connection, filter: &ProductFilter) -> Result<Vec<Product>> {
        let mut conditions: Vec<String> = Vec::new();
        let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(q) = filter.search.as_deref().map(str::trim) {
            if !q.is_empty() {
                conditions.push("p.name LIKE ?".into());
                binds.push(Box::new(format!("%{q}%")));
            }
        }
        if let Some(cid) = filter.category_id {
            conditions.push("p.category_id = ?".into());
            binds.push(Box::new(cid));
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let sql = format!(
            "SELECT p.* FROM products p {where_clause} ORDER BY p.name ASC LIMIT 500"
        );
        let mut stmt = conn.prepare(&sql)?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(refs.as_slice(), row_to_product)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn list_with_units(conn: &Connection, filter: &ProductFilter) -> Result<Vec<Product>> {
        let mut all = list(conn, filter)?;
        for product in all.iter_mut() {
            product.units = Some(units::list_for_product(conn, product.id)?);
        }
        Ok(all)
    }

    pub fn get_by_id(conn: &Connection, id: i64) -> Result<Option<Product>> {
        let found = conn
            .query_row("SELECT * FROM products WHERE id = ?1", params![id], row_to_product)
            .optional()?;
        Ok(found)
    }

    pub fn find_by_barcode(conn: &Connection, code: &str) -> Result<Option<Product>> {
        let clean = code.trim();
        if clean.is_empty() {
            return Ok(None);
        }
        let found = conn
            .query_row(
                "SELECT * FROM products WHERE barcode = ?1 LIMIT 1",
                params![clean],
                row_to_product,
            )
            .optional()?;
        Ok(found)
    }

    pub fn count_all(conn: &Connection) -> Result<i64> {
        Ok(conn.query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))?)
    }

    pub fn create(conn: &mut Connection, input: &ProductInput) -> Result<i64> {
        validate_product(input)?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO products
             (name, cost_price, retail_price, wholesale_price, stock_quantity,
              category_id, image_uri, low_stock_threshold, barcode, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                input.name.trim(),
                input.cost_price,
                input.retail_price,
                input.wholesale_price,
                input.stock_quantity,
                input.category_id,
                input.image_uri,
                input.low_stock_threshold,
                normalize_barcode(input.barcode.as_deref()),
                local_now(),
            ],
        )?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(id)
    }

    pub fn update(conn: &Connection, id: i64, input: &ProductInput) -> Result<()> {
        validate_product(input)?;
        conn.execute(
            "UPDATE products SET
               name = ?1, cost_price = ?2, retail_price = ?3, wholesale_price = ?4,
               stock_quantity = ?5, category_id = ?6, image_uri = ?7,
               low_stock_threshold = ?8, barcode = ?9
             WHERE id = ?10",
            params![
                input.name.trim(),
                input.cost_price,
                input.retail_price,
                input.wholesale_price,
                input.stock_quantity,
                input.category_id,
                input.image_uri,
                input.low_stock_threshold,
                normalize_barcode(input.barcode.as_deref()),
                id,
            ],
        )?;
        Ok(())
    }

    pub fn remove(conn: &Connection, id: i64) -> Result<()> {
        conn.execute("DELETE FROM products WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// استبدال صفوف وحدات منتج — من UnitRepo.replaceForProduct حرفياً
    /// (تحويل ≥ 1، سعر > 0 وإلا NULL، باركود منسق أو NULL).
    pub fn replace_units(
        conn: &mut Connection,
        product_id: i64,
        rows: &[ReplaceUnitRow],
    ) -> Result<()> {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM product_units WHERE product_id = ?1", params![product_id])?;
        for row in rows {
            let conversion = row.conversion.max(1.0);
            if conversion < 0.001 {
                return Err(crate::SelaError::msg("معامل التحويل غير صالح"));
            }
            tx.execute(
                "INSERT OR REPLACE INTO product_units
                 (product_id, unit_id, conversion, barcode, retail_price, wholesale_price)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    product_id,
                    row.unit_id,
                    conversion,
                    normalize_barcode(row.barcode.as_deref()),
                    positive_or_null(row.retail_price),
                    positive_or_null(row.wholesale_price),
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    fn validate_product(input: &ProductInput) -> Result<()> {
        if input.name.trim().is_empty() {
            return Err(crate::SelaError::msg("اسم المنتج مطلوب"));
        }
        if input.retail_price < 0.0 || input.wholesale_price < 0.0 || input.cost_price < 0.0 {
            return Err(crate::SelaError::msg("الأسعار لا يمكن أن تكون سالبة"));
        }
        if input.stock_quantity < 0.0 {
            return Err(crate::SelaError::msg("الكمية لا يمكن أن تكون سالبة"));
        }
        Ok(())
    }

    fn normalize_barcode(code: Option<&str>) -> Option<String> {
        match code.map(str::trim) {
            Some(c) if !c.is_empty() => Some(c.to_string()),
            _ => None,
        }
    }

    fn positive_or_null(v: Option<f64>) -> Option<f64> {
        match v {
            Some(x) if x > 0.0 => Some(x),
            _ => None,
        }
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ReplaceUnitRow {
    pub unit_id: i64,
    pub conversion: f64,
    #[serde(default)]
    pub barcode: Option<String>,
    #[serde(default)]
    pub retail_price: Option<f64>,
    #[serde(default)]
    pub wholesale_price: Option<f64>,
}

pub mod categories {
    use super::*;

    pub fn list(conn: &Connection) -> Result<Vec<Category>> {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name,
                    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
             FROM categories c ORDER BY c.name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Category {
                id: row.get("id")?,
                name: row.get("name")?,
                product_count: row.get("product_count")?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn create(conn: &Connection, name: &str) -> Result<i64> {
        let clean = name.trim();
        if clean.is_empty() {
            return Err(crate::SelaError::msg("اسم التصنيف مطلوب"));
        }
        conn.execute("INSERT INTO categories (name) VALUES (?1)", params![clean])?;
        Ok(conn.last_insert_rowid())
    }

    pub fn rename(conn: &Connection, id: i64, name: &str) -> Result<()> {
        let clean = name.trim();
        if clean.is_empty() {
            return Err(crate::SelaError::msg("اسم التصنيف مطلوب"));
        }
        conn.execute("UPDATE categories SET name = ?1 WHERE id = ?2", params![clean, id])?;
        Ok(())
    }

    pub fn remove(conn: &Connection, id: i64) -> Result<()> {
        conn.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
        Ok(())
    }
}

pub mod units {
    use super::*;

    pub fn list(conn: &Connection) -> Result<Vec<Unit>> {
        let mut stmt = conn.prepare("SELECT * FROM units ORDER BY sort_order ASC, id ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Unit {
                id: row.get("id")?,
                name: row.get("name")?,
                short_name: row.get("short_name")?,
                sort_order: row.get("sort_order")?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn list_for_product(conn: &Connection, product_id: i64) -> Result<Vec<ProductUnit>> {
        let mut stmt = conn.prepare(
            "SELECT pu.*, u.name AS unit_name, u.short_name AS unit_short
             FROM product_units pu
             JOIN units u ON u.id = pu.unit_id
             WHERE pu.product_id = ?1
             ORDER BY u.sort_order ASC",
        )?;
        let rows = stmt.query_map(params![product_id], row_to_unit_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// UnitRepo.findByBarcode — بحث باركود الوحدة (كرتونة كاملة).
    pub fn find_by_barcode(conn: &Connection, code: &str) -> Result<Option<(i64, ProductUnit)>> {
        let clean = code.trim();
        if clean.is_empty() {
            return Ok(None);
        }
        let found = conn
            .query_row(
                "SELECT pu.*, u.name AS unit_name, u.short_name AS unit_short
                 FROM product_units pu
                 JOIN units u ON u.id = pu.unit_id
                 WHERE pu.barcode = ?1
                 LIMIT 1",
                params![clean],
                row_to_unit_row,
            )
            .optional()?;
        Ok(found.map(|pu| (pu.product_id, pu)))
    }

    pub fn upsert(conn: &Connection, unit: &Unit) -> Result<i64> {
        let name = unit.name.trim();
        let short = unit.short_name.trim();
        if name.is_empty() || short.is_empty() {
            return Err(crate::SelaError::msg("اسم الوحدة واختصارها مطلوبان"));
        }
        if unit.id > 0 {
            conn.execute(
                "UPDATE units SET name = ?1, short_name = ?2, sort_order = ?3 WHERE id = ?4",
                params![name, short, unit.sort_order, unit.id],
            )?;
            Ok(unit.id)
        } else {
            conn.execute(
                "INSERT INTO units (name, short_name, sort_order) VALUES (?1, ?2, ?3)",
                params![name, short, unit.sort_order],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }

    pub fn remove(conn: &Connection, id: i64) -> Result<()> {
        let used: i64 = conn.query_row(
            "SELECT COUNT(*) FROM product_units WHERE unit_id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        if used > 0 {
            return Err(crate::SelaError::msg(
                "لا يمكن حذف وحدة مستخدمة في منتجات — انقلها منها أولاً",
            ));
        }
        conn.execute("DELETE FROM units WHERE id = ?1", params![id])?;
        Ok(())
    }
}

pub mod sales {
    use super::*;

    pub fn list_recent(conn: &Connection, limit: i64) -> Result<Vec<SaleRecord>> {
        let limit = limit.clamp(1, 200);
        let mut stmt = conn.prepare("SELECT * FROM sales ORDER BY id DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit], row_to_sale)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn list_range(
        conn: &Connection,
        from_day: &str, // 'YYYY-MM-DD' شاملة
        to_day: &str,
        limit: i64,
    ) -> Result<Vec<SaleRecord>> {
        let limit = limit.clamp(1, 2000);
        let from = format!("{from_day} 00:00:00");
        let to = format!("{to_day} 23:59:59");
        let mut stmt = conn.prepare(
            "SELECT * FROM sales WHERE created_at >= ?1 AND created_at <= ?2
             ORDER BY id DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![from, to, limit], row_to_sale)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_items_for_sale(conn: &Connection, sale_id: i64) -> Result<Vec<SaleItemRecord>> {
        let mut stmt = conn.prepare("SELECT * FROM sale_items WHERE sale_id = ?1 ORDER BY id ASC")?;
        let rows = stmt.query_map(params![sale_id], row_to_item)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_by_id(conn: &Connection, sale_id: i64) -> Result<Option<SaleRecord>> {
        let found = conn
            .query_row("SELECT * FROM sales WHERE id = ?1", params![sale_id], row_to_sale)
            .optional()?;
        Ok(found)
    }

    pub fn count_all(conn: &Connection) -> Result<i64> {
        Ok(conn.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))?)
    }
}

pub mod stocktakes {
    use super::*;
    use rusqlite::Row;

    fn row_to_stocktake(row: &Row) -> rusqlite::Result<Stocktake> {
        Ok(Stocktake {
            id: row.get("id")?,
            started_at: row.get("started_at")?,
            completed_at: row.get("completed_at")?,
            status: row.get("status")?,
            note: row.get("note")?,
        })
    }

    fn row_to_stocktake_item(row: &Row) -> rusqlite::Result<StocktakeItem> {
        Ok(StocktakeItem {
            id: row.get("id")?,
            stocktake_id: row.get("stocktake_id")?,
            product_id: row.get("product_id")?,
            product_name: row.get("product_name")?,
            category_id: row.get("category_id")?,
            system_qty: row.get("system_qty")?,
            counted_qty: row.get("counted_qty")?,
            unit_hint: None,
        })
    }

    pub fn get_open(conn: &Connection) -> Result<Option<Stocktake>> {
        let found = conn
            .query_row(
                "SELECT * FROM stocktakes WHERE status = 'open' ORDER BY id DESC LIMIT 1",
                [],
                row_to_stocktake,
            )
            .optional()?;
        Ok(found)
    }

    pub fn list(conn: &Connection, limit: i64) -> Result<Vec<Stocktake>> {
        let mut stmt = conn.prepare("SELECT * FROM stocktakes ORDER BY id DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit], row_to_stocktake)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// StocktakeRepo.start — جلسة تلتقط صورة المخزون الحالي لكل منتج.
    pub fn start(conn: &mut Connection) -> Result<Stocktake> {
        if let Some(open) = get_open(conn)? {
            return Ok(open);
        }
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO stocktakes (started_at, status) VALUES (?1, 'open')",
            params![local_now()],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO stocktake_items (stocktake_id, product_id, system_qty)
             SELECT ?1, p.id, p.stock_quantity FROM products p",
            params![id],
        )?;
        tx.commit()?;
        let session = conn
            .query_row("SELECT * FROM stocktakes WHERE id = ?1", params![id], row_to_stocktake)
            .optional()?;
        session.ok_or_else(|| crate::SelaError::msg("تعذر إنشاء جلسة الجرد"))
    }

    pub fn list_items(
        conn: &Connection,
        stocktake_id: i64,
        filter: &ProductFilter,
        only_pending: bool,
    ) -> Result<Vec<StocktakeItem>> {
        let mut conditions = vec!["si.stocktake_id = ?1".to_string()];
        let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(stocktake_id)];
        if let Some(q) = filter.search.as_deref().map(str::trim) {
            if !q.is_empty() {
                conditions.push("p.name LIKE ?2".into());
                binds.push(Box::new(format!("%{q}%")));
            }
        }
        if let Some(cid) = filter.category_id {
            conditions.push(format!("p.category_id = ?{}", binds.len() + 1));
            binds.push(Box::new(cid));
        }
        if only_pending {
            conditions.push("si.counted_qty IS NULL".into());
        }
        let sql = format!(
            "SELECT si.id, si.stocktake_id, si.product_id, si.system_qty, si.counted_qty,
                    p.name AS product_name, p.category_id
             FROM stocktake_items si
             JOIN products p ON p.id = si.product_id
             WHERE {}
             ORDER BY p.name ASC",
            conditions.join(" AND ")
        );
        let mut stmt = conn.prepare(&sql)?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(refs.as_slice(), row_to_stocktake_item)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn set_counted(conn: &Connection, stocktake_id: i64, product_id: i64, counted: Option<f64>) -> Result<()> {
        conn.execute(
            "UPDATE stocktake_items SET counted_qty = ?1
             WHERE stocktake_id = ?2 AND product_id = ?3",
            params![counted, stocktake_id, product_id],
        )?;
        Ok(())
    }

    pub fn summary(conn: &Connection, stocktake_id: i64) -> Result<StocktakeSummary> {
        let summary = conn.query_row(
            "SELECT
               COUNT(*) AS total_items,
               SUM(CASE WHEN counted_qty IS NOT NULL THEN 1 ELSE 0 END) AS counted_items,
               SUM(CASE WHEN counted_qty IS NOT NULL AND counted_qty = system_qty THEN 1 ELSE 0 END) AS matched_items,
               SUM(CASE WHEN counted_qty IS NOT NULL AND counted_qty < system_qty THEN 1 ELSE 0 END) AS shortage_items,
               SUM(CASE WHEN counted_qty IS NOT NULL AND counted_qty > system_qty THEN 1 ELSE 0 END) AS surplus_items,
               COALESCE(SUM(system_qty), 0) AS total_system,
               COALESCE(SUM(counted_qty), 0) AS total_counted
             FROM stocktake_items WHERE stocktake_id = ?1",
            params![stocktake_id],
            |row| {
                Ok(StocktakeSummary {
                    total_items: row.get("total_items")?,
                    counted_items: row.get("counted_items")?,
                    matched_items: row.get("matched_items")?,
                    shortage_items: row.get("shortage_items")?,
                    surplus_items: row.get("surplus_items")?,
                    total_system: row.get("total_system")?,
                    total_counted: row.get("total_counted")?,
                })
            },
        )?;
        Ok(summary)
    }

    /// StocktakeRepo.complete — تطبيق الفروقات على المخزون داخل معاملة.
    pub fn complete(conn: &mut Connection, id: i64, apply_adjustments: bool) -> Result<i64> {
        let tx = conn.transaction()?;
        let mut adjusted = 0i64;
        if apply_adjustments {
            let affected = tx.execute(
                "UPDATE products
                 SET stock_quantity = (
                   SELECT si.counted_qty FROM stocktake_items si
                   WHERE si.stocktake_id = ?1 AND si.product_id = products.id
                     AND si.counted_qty IS NOT NULL
                 )
                 WHERE id IN (
                   SELECT si.product_id FROM stocktake_items si
                   WHERE si.stocktake_id = ?1 AND si.counted_qty IS NOT NULL
                 )",
                params![id],
            )?;
            adjusted = affected as i64;
        }
        tx.execute(
            "UPDATE stocktakes SET status = 'completed', completed_at = ?2 WHERE id = ?1",
            params![id, local_now()],
        )?;
        tx.commit()?;
        Ok(adjusted)
    }

    pub fn cancel(conn: &mut Connection, id: i64) -> Result<()> {
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM stocktake_items WHERE stocktake_id = ?1", params![id])?;
        tx.execute("DELETE FROM stocktakes WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }
}

/// ملخص الجرد — نفس StocktakeSummary في types.ts.
#[derive(Debug, serde::Serialize)]
pub struct StocktakeSummary {
    pub total_items: i64,
    pub counted_items: i64,
    pub matched_items: i64,
    pub shortage_items: i64,
    pub surplus_items: i64,
    pub total_system: f64,
    pub total_counted: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn(name: &str) -> Connection {
        let dir = std::env::temp_dir().join(format!("sela-repos-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        crate::db::open_and_init(&dir.join("repos.db")).unwrap()
    }

    fn mk_product(conn: &mut Connection, name: &str, barcode: Option<&str>, stock: f64) -> i64 {
        products::create(
            conn,
            &ProductInput {
                name: name.into(),
                cost_price: 2.0,
                retail_price: 4.5,
                wholesale_price: 3.8,
                stock_quantity: stock,
                category_id: None,
                image_uri: None,
                low_stock_threshold: None,
                barcode: barcode.map(|b| b.into()),
            },
        )
        .unwrap()
    }

    #[test]
    fn product_crud_and_filters() {
        let mut conn = test_conn("crud");
        let id1 = mk_product(&mut conn, "شوكولاتة بالحليب", Some("629000111222"), 10.0);
        let _id2 = mk_product(&mut conn, "عصير برتقال", Some("629000111333"), 6.0);

        // بحث LIKE وحد 500 وترتيب أبجدي.
        let all = products::list(&conn, &ProductFilter::default()).unwrap();
        assert_eq!(all.len(), 2);
        let found = products::find_by_barcode(&conn, "629000111222").unwrap().unwrap();
        assert_eq!(found.id, id1);
        assert_eq!(found.name, "شوكولاتة بالحليب");

        let search = products::list(
            &conn,
            &ProductFilter { search: Some("شوكولا".into()), category_id: None },
        )
        .unwrap();
        assert_eq!(search.len(), 1);

        // تحديث ثم مسح.
        products::update(
            &conn,
            id1,
            &ProductInput {
                name: "شوكولاتة داكنة".into(),
                cost_price: 3.0, retail_price: 7.0, wholesale_price: 6.0,
                stock_quantity: 12.0, category_id: None, image_uri: None,
                low_stock_threshold: Some(3), barcode: Some("629000111222".into()),
            },
        )
        .unwrap();
        let updated = products::get_by_id(&conn, id1).unwrap().unwrap();
        assert_eq!(updated.name, "شوكولاتة داكنة");
        assert_eq!(updated.low_stock_threshold, Some(3));

        // اسم فارغ → نفس رسالة الأندرويد.
        let err = products::create(
            &mut conn,
            &ProductInput {
                name: "  ".into(), cost_price: 1.0, retail_price: 2.0,
                wholesale_price: 1.5, stock_quantity: 1.0, category_id: None,
                image_uri: None, low_stock_threshold: None, barcode: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "اسم المنتج مطلوب");
    }

    #[test]
    fn unit_rows_and_barcodes() {
        let mut conn = test_conn("units");
        let pid = mk_product(&mut conn, "ماء معدني", None, 48.0);
        let unit_list = units::list(&conn).unwrap();
        let karton = unit_list.iter().find(|u| u.name == "كرتونة").unwrap();

        products::replace_units(
            &mut conn,
            pid,
            &[
                ReplaceUnitRow {
                    unit_id: karton.id, conversion: 24.0,
                    barcode: Some("629KARTON999".into()),
                    retail_price: Some(48.0), wholesale_price: Some(40.0),
                },
            ],
        )
        .unwrap();

        let rows = units::list_for_product(&conn, pid).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].conversion, 24.0);
        assert_eq!(rows[0].unit_name, "كرتونة");

        // باركود الوحدة يعثر على المنتج والصف.
        let hit = units::find_by_barcode(&conn, "629KARTON999").unwrap().unwrap();
        assert_eq!(hit.0, pid);
        assert_eq!(hit.1.unit_name, "كرتونة");

        // حذف وحدة مستخدمة مرفوض برسالة الأندرويد.
        let err = units::remove(&conn, karton.id).unwrap_err();
        assert!(err.to_string().contains("مستخدمة"));
    }

    #[test]
    fn stocktake_flow_with_adjustments() {
        let mut conn = test_conn("jrd");
        let p1 = mk_product(&mut conn, "جبن", None, 10.0);
        let p2 = mk_product(&mut conn, "زيتون", None, 5.0);

        let session = stocktakes::start(&mut conn).unwrap();
        assert_eq!(session.status, "open");
        // إعادة start داخل جلسة مفتوحة تعيد نفسها.
        let again = stocktakes::start(&mut conn).unwrap();
        assert_eq!(again.id, session.id);

        stocktakes::set_counted(&conn, session.id, p1, Some(8.0)).unwrap();
        stocktakes::set_counted(&conn, session.id, p2, None).unwrap();

        let summary = stocktakes::summary(&conn, session.id).unwrap();
        assert_eq!(summary.total_items, 2);
        assert_eq!(summary.counted_items, 1);
        assert_eq!(summary.shortage_items, 1);

        let adjusted = stocktakes::complete(&mut conn, session.id, true).unwrap();
        assert_eq!(adjusted, 1, "منتج واحد فقط عُدّل");
        let after = products::get_by_id(&conn, p1).unwrap().unwrap();
        assert_eq!(after.stock_quantity as i64, 8);
        let untouched = products::get_by_id(&conn, p2).unwrap().unwrap();
        assert_eq!(untouched.stock_quantity as i64, 5, "غير المعدود لا يُمس");
    }
}
