/**
 * checkout.rs — معاملة البيع نفسها (SaleRepo.createSlice الأندرويد):
 *  • الإجماليات: subtotal = Σ unitPrice×qty، خصم مقيّد [0, subtotal]،
 *    total = subtotal - خصم، totalCost = Σ costPrice×qty، الربح = total - totalCost.
 *  • داخل معاملة واحدة: INSERT sale → INSERT items → خصم مخزون بشرط
 *    `stock_quantity >= ?` — فشل أي سطر يفجّر الكل برسالة عربية
 *    والسلة تبقى سليمة عند المستخدم.
 */
use crate::models::*;
use crate::sysinfo::local_now;
use crate::Result;
use rusqlite::{params, Connection};

pub struct CreateSaleInput<'a> {
    pub invoice_number: &'a str,
    pub lines: &'a [CartLine],
    pub discount: f64,
    pub payment_type: &'a str,
    /// v70 (الجولة 74 #2): طريقة الدفع (بنك/محفظة/نقدي) — خالية
    /// تعني نقدياً (توافق المبيعات القديمة).
    pub payment_method: Option<&'a str>,
}

pub fn create_sale(conn: &mut Connection, input: &CreateSaleInput) -> Result<SaleWithItems> {
    if input.lines.is_empty() {
        return Err(crate::SelaError::msg("السلة فارغة"));
    }
    let subtotal: f64 = input.lines.iter().map(|l| l.unit_price * l.quantity).sum();
    let discount = input.discount.clamp(0.0, subtotal);
    let total_amount = subtotal - discount;
    let total_cost: f64 = input.lines.iter().map(|l| l.cost_price * l.quantity).sum();
    let total_profit = total_amount - total_cost;
    let created_at = local_now();

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO sales
         (invoice_number, total_amount, total_cost, total_profit, discount, payment_type, created_at, payment_method)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            input.invoice_number,
            total_amount,
            total_cost,
            total_profit,
            discount,
            input.payment_type,
            created_at,
            input.payment_method,
        ],
    )?;
    let sale_id = tx.last_insert_rowid();
    if sale_id < 0 {
        return Err(crate::SelaError::msg("فشل إنشاء الفاتورة"));
    }

    for line in input.lines {
        // نفس الأندرويد: baseQty = quantity × (conversion ?? 1).
        let conversion = line.conversion;
        let base_qty = line.quantity * conversion;
        tx.execute(
            "INSERT INTO sale_items
             (sale_id, product_id, quantity, unit_price, cost_price, total_line_price, unit_name, base_quantity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                sale_id,
                line.product_id,
                line.quantity,
                line.unit_price,
                line.cost_price,
                line.unit_price * line.quantity,
                line.unit_name,
                base_qty,
            ],
        )?;
        // حرس البيع الزائد داخل نفس المعاملة (بوحدات أساس).
        let affected = tx.execute(
            "UPDATE products SET stock_quantity = stock_quantity - ?1
             WHERE id = ?2 AND stock_quantity >= ?1",
            params![base_qty, line.product_id],
        )?;
        if affected != 1 {
            return Err(crate::SelaError::msg(format!(
                "الكمية المتوفرة من \"{}\" غير كافية ({} قطعة مطلوبة)",
                line.name, base_qty
            )));
        }
    }
    tx.commit()?;

    read_sale(conn, sale_id)
}

pub fn read_sale(conn: &Connection, sale_id: i64) -> Result<SaleWithItems> {
    let sale = conn
        .query_row("SELECT * FROM sales WHERE id = ?1", params![sale_id], |row| {
            Ok(SaleRecord {
                id: row.get("id")?,
                invoice_number: row.get("invoice_number")?,
                total_amount: row.get("total_amount")?,
                total_cost: row.get("total_cost")?,
                total_profit: row.get("total_profit")?,
                discount: row.get("discount")?,
                payment_type: row
                    .get::<_, Option<String>>("payment_type")?
                    .unwrap_or_else(|| "RETAIL".into()),
                created_at: row.get("created_at")?,
            })
        })
        .map_err(|_| crate::SelaError::msg("تعذر قراءة الفاتورة بعد إنشائها"))?;

    let mut stmt = conn.prepare("SELECT * FROM sale_items WHERE sale_id = ?1 ORDER BY id ASC")?;
    let items = stmt
        .query_map(params![sale_id], |row| {
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
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(SaleWithItems { sale, items })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(pid: i64, qty: f64, unit_price: f64, cost: f64, conversion: f64) -> CartLine {
        CartLine {
            key: format!("{pid}:0"),
            product_id: pid,
            name: "منتج".into(),
            unit_price,
            cost_price: cost,
            quantity: qty,
            unit_id: None,
            unit_name: Some("قطعة".into()),
            conversion,
        }
    }

    fn setup(name: &str) -> (Connection, i64) {
        let dir = std::env::temp_dir().join(format!("sela-checkout-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = crate::db::open_and_init(&dir.join("c.db")).unwrap();
        let pid = crate::repos::products::create(
            &mut conn,
            &ProductInput {
                name: "شوكولاتة".into(),
                cost_price: 2.0,
                retail_price: 4.5,
                wholesale_price: 3.8,
                stock_quantity: 10.0,
                category_id: None, image_uri: None,
                low_stock_threshold: None, barcode: None,
            },
        )
        .unwrap();
        (conn, pid)
    }

    #[test]
    fn totals_discount_clamp_and_stock_deduction() {
        let (mut conn, pid) = setup("totals");
        // 3 × 4.5 = 13.5، خصم 5 → 8.5. تكلفة 3×2=6 → ربح 2.5.
        let out = create_sale(
            &mut conn,
            &CreateSaleInput {
                invoice_number: "INV-20261015-0001",
                lines: &[line(pid, 3.0, 4.5, 2.0, 1.0)],
                discount: 5.0,
                payment_type: "RETAIL",
                payment_method: None,
            },
        )
        .unwrap();
        assert_eq!(out.sale.total_amount, 8.5);
        assert_eq!(out.sale.total_cost, 6.0);
        assert_eq!(out.sale.total_profit, 2.5);
        assert_eq!(out.sale.discount, 5.0);
        assert_eq!(out.items.len(), 1);
        let stock: f64 = conn
            .query_row("SELECT stock_quantity FROM products WHERE id = ?1", params![pid], |r| r.get(0))
            .unwrap();
        assert_eq!(stock as i64, 7, "10 - 3");
    }

    #[test]
    fn discount_capped_at_subtotal() {
        let (mut conn, pid) = setup("cap");
        // خصم 999 فوق إجمالي 9 → يقيد إلى 9 والمجموع صفر.
        let out = create_sale(
            &mut conn,
            &CreateSaleInput {
                invoice_number: "INV-20261015-0002",
                lines: &[line(pid, 2.0, 4.5, 2.0, 1.0)],
                discount: 999.0,
                payment_type: "RETAIL",
                payment_method: None,
            },
        )
        .unwrap();
        assert_eq!(out.sale.total_amount, 0.0);
        assert_eq!(out.sale.discount, 9.0);
    }

    #[test]
    fn oversell_guard_rolls_back_everything() {
        let (mut conn, pid) = setup("oversell");
        // المخزون 10 والمطلوب 24 (كرتونة تحويل 24) → فشل المعاملة كلها.
        let err = create_sale(
            &mut conn,
            &CreateSaleInput {
                invoice_number: "INV-20261015-0003",
                lines: &[line(pid, 1.0, 90.0, 40.0, 24.0)],
                discount: 0.0,
                payment_type: "WHOLESALE",
                payment_method: None,
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("غير كافية"), "رسالة الأندرويد نفسها: {err}");
        // لا فاتورة ولا خصم مخزون — التراجع الكامل.
        let sales: i64 = conn.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0)).unwrap();
        assert_eq!(sales, 0);
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM sale_items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 0);
        let stock: f64 = conn
            .query_row("SELECT stock_quantity FROM products WHERE id = ?1", params![pid], |r| r.get(0))
            .unwrap();
        assert_eq!(stock as i64, 10, "المخزون لم يُمس");
    }

    #[test]
    fn two_lines_partial_failure() {
        let (mut conn, pid) = setup("partial");
        // أضف منتجاً ثانياً بمخزون 1.
        let pid2 = crate::repos::products::create(
            &mut conn,
            &ProductInput {
                name: "علكة".into(), cost_price: 0.5, retail_price: 1.0,
                wholesale_price: 0.8, stock_quantity: 1.0,
                category_id: None, image_uri: None, low_stock_threshold: None, barcode: None,
            },
        )
        .unwrap();
        // السطر الثاني يطلب 5 من مخزون 1 → كل شيء يتراجع (السلة سليمة).
        let err = create_sale(
            &mut conn,
            &CreateSaleInput {
                invoice_number: "INV-20261015-0004",
                lines: &[line(pid, 1.0, 4.5, 2.0, 1.0), line(pid2, 5.0, 1.0, 0.5, 1.0)],
                discount: 0.0,
                payment_type: "RETAIL",
                payment_method: None,
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("غير كافية"));
        let stock2: f64 = conn
            .query_row("SELECT stock_quantity FROM products WHERE id = ?1", params![pid2], |r| r.get(0))
            .unwrap();
        assert_eq!(stock2 as i64, 1, "لا خصم جزئي أبداً");
    }

    #[test]
    fn empty_cart_rejected() {
        let (mut conn, _pid) = setup("empty");
        let err = create_sale(
            &mut conn,
            &CreateSaleInput {
                invoice_number: "X",
                lines: &[],
                discount: 0.0,
                payment_type: "RETAIL",
                payment_method: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "السلة فارغة");
    }
}
