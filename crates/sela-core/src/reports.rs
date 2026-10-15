/**
 * reports.rs — استعلامات التقارير من ReportRepo.ts حرفياً
 * (نفس الدوال التجميعية ونفس النطاقات الزمنية 'YYYY-MM-DD 00:00:00'
 * … '23:59:59' على created_at المحلي).
 */
use crate::models::*;
use crate::Result;
use rusqlite::{params, Connection};

fn range_bounds(range: &DateRange) -> (String, String) {
    (format!("{} 00:00:00", range.from), format!("{} 23:59:59", range.to))
}

pub fn summary(conn: &Connection, range: &DateRange) -> Result<ReportSummary> {
    let (from, to) = range_bounds(range);
    let head = conn.query_row(
        "SELECT
           COALESCE(SUM(total_amount), 0) AS revenue,
           COALESCE(SUM(total_cost), 0) AS cogs,
           COALESCE(SUM(total_profit), 0) AS profit,
           COALESCE(SUM(discount), 0) AS discount_total,
           COUNT(*) AS invoices
         FROM sales
         WHERE created_at >= ?1 AND created_at <= ?2",
        params![from, to],
        |row| {
            Ok((
                row.get::<_, f64>("revenue")?,
                row.get::<_, f64>("cogs")?,
                row.get::<_, f64>("profit")?,
                row.get::<_, f64>("discount_total")?,
                row.get::<_, i64>("invoices")?,
            ))
        },
    )?;
    let items_count: f64 = conn.query_row(
        "SELECT COALESCE(SUM(si.quantity), 0) AS items
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.created_at >= ?1 AND s.created_at <= ?2",
        params![from, to],
        |r| r.get(0),
    )?;
    let (revenue, cogs, profit, discount_total, invoices) = head;
    let avg_invoice = if invoices > 0 { revenue / invoices as f64 } else { 0.0 };
    Ok(ReportSummary {
        revenue,
        cogs,
        net_profit: profit,
        invoices_count: invoices,
        items_count,
        discount_total,
        avg_invoice,
    })
}

pub fn top_products(conn: &Connection, range: &DateRange, limit: i64) -> Result<Vec<TopProduct>> {
    let (from, to) = range_bounds(range);
    let mut stmt = conn.prepare(
        "SELECT
           si.product_id AS product_id,
           p.name AS name,
           SUM(si.quantity) AS quantity,
           SUM(si.total_line_price) AS revenue,
           SUM(si.total_line_price - si.cost_price * si.quantity) AS profit
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         WHERE s.created_at >= ?1 AND s.created_at <= ?2
         GROUP BY si.product_id, p.name
         ORDER BY revenue DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![from, to, limit], |row| {
        Ok(TopProduct {
            product_id: row.get("product_id")?,
            name: row.get("name")?,
            quantity: row.get("quantity")?,
            revenue: row.get("revenue")?,
            profit: row.get("profit")?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn daily(conn: &Connection, range: &DateRange) -> Result<Vec<DailyPoint>> {
    let (from, to) = range_bounds(range);
    let mut stmt = conn.prepare(
        "SELECT
           substr(created_at, 1, 10) AS day,
           SUM(total_amount) AS revenue,
           SUM(total_profit) AS profit
         FROM sales
         WHERE created_at >= ?1 AND created_at <= ?2
         GROUP BY day
         ORDER BY day ASC",
    )?;
    let rows = stmt.query_map(params![from, to], |row| {
        Ok(DailyPoint {
            day: row.get("day")?,
            revenue: row.get("revenue")?,
            profit: row.get("profit")?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn hourly(conn: &Connection, range: &DateRange) -> Result<Vec<HourlyPoint>> {
    let (from, to) = range_bounds(range);
    let mut stmt = conn.prepare(
        "SELECT
           CAST(substr(created_at, 12, 2) AS INTEGER) AS hour,
           SUM(total_amount) AS revenue,
           COUNT(*) AS orders
         FROM sales
         WHERE created_at >= ?1 AND created_at <= ?2
         GROUP BY hour
         ORDER BY hour ASC",
    )?;
    let rows = stmt.query_map(params![from, to], |row| {
        Ok(HourlyPoint {
            hour: row.get("hour")?,
            revenue: row.get("revenue")?,
            orders: row.get("orders")?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkout::{create_sale, CreateSaleInput};
    use crate::models::CartLine;

    fn line(pid: i64, qty: f64, price: f64, cost: f64) -> CartLine {
        CartLine {
            key: format!("{pid}:0"),
            product_id: pid,
            name: "م".into(),
            unit_price: price,
            cost_price: cost,
            quantity: qty,
            unit_id: None,
            unit_name: None,
            conversion: 1.0,
        }
    }

    #[test]
    fn summary_top_daily_hourly_match_manual_math() {
        let dir = std::env::temp_dir().join(format!("sela-reports-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = crate::db::open_and_init(&dir.join("r.db")).unwrap();
        let pid = crate::repos::products::create(
            &mut conn,
            &crate::models::ProductInput {
                name: "شوكولاتة".into(),
                cost_price: 2.0, retail_price: 5.0, wholesale_price: 4.0,
                stock_quantity: 100.0, category_id: None, image_uri: None,
                low_stock_threshold: None, barcode: None,
            },
        )
        .unwrap();

        // فاتورتان «اليوم» (2026-10-15) وفاتورة «أمس».
        for (inv, day, qty) in [
            ("INV-20261015-0001", "2026-10-15 09:15:00", 4.0),
            ("INV-20261015-0002", "2026-10-15 14:30:00", 2.0),
            ("INV-20261014-0001", "2026-10-14 18:05:00", 10.0),
        ] {
            let out = create_sale(
                &mut conn,
                &CreateSaleInput {
                    invoice_number: inv,
                    lines: &[line(pid, qty, 5.0, 2.0)],
                    discount: 0.0,
                    payment_type: "RETAIL",
                },
            )
            .unwrap();
            // نفّذ التواريخ المطلوبة حرفياً (created_at من المعاملة محلي الآن —
            // نعدّلها مباشرة لاختبار النطاقات كما يفعل اختبار الأندرويد).
            conn.execute(
                "UPDATE sales SET created_at = ?1 WHERE id = ?2",
                params![day, out.sale.id],
            )
            .unwrap();
        }

        let range = DateRange { from: "2026-10-15".into(), to: "2026-10-15".into() };
        let s = summary(&conn, &range).unwrap();
        // 4×5=20 + 2×5=10 → إيراد 30، تكلفة 12، ربح 18، متوسط 15.
        assert_eq!(s.revenue, 30.0);
        assert_eq!(s.cogs, 12.0);
        assert_eq!(s.net_profit, 18.0);
        assert_eq!(s.invoices_count, 2);
        assert_eq!(s.items_count, 6.0);
        assert_eq!(s.avg_invoice, 15.0);

        let top = top_products(&conn, &range, 10).unwrap();
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].quantity, 6.0);
        assert_eq!(top[0].revenue, 30.0);
        assert_eq!(top[0].profit, 18.0);

        let d = daily(&conn, &range).unwrap();
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].day, "2026-10-15");
        assert_eq!(d[0].revenue, 30.0);

        let h = hourly(&conn, &range).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].hour, 9);
        assert_eq!(h[0].revenue, 20.0);
        assert_eq!(h[1].hour, 14);
        assert_eq!(h[1].revenue, 10.0);

        // نطاق الشهر يشمل الأمس أيضاً.
        let month = DateRange { from: "2026-10-01".into(), to: "2026-10-31".into() };
        let s2 = summary(&conn, &month).unwrap();
        assert_eq!(s2.invoices_count, 3);
        assert_eq!(s2.revenue, 80.0);
    }
}
