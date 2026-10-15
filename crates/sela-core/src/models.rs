/**
 * models.rs — نماذج البيانات (تطابق حقول core/types.ts حرفياً
 * بأسماء snake_case نفسها — تمريرها إلى الواجهة JSON-فم-JSON).
 */
use serde::{Deserialize, Serialize};

pub type PricingMode = String; // "RETAIL" | "WHOLESALE"

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct Category {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Unit {
    pub id: i64,
    pub name: String,
    pub short_name: String,
    pub sort_order: i64,
}

/// صف وحدة مبيعة لمنتج — من types.ts ProductUnit (مع أسماء العرض المجمعة).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductUnit {
    pub id: i64,
    pub product_id: i64,
    pub unit_id: i64,
    #[serde(rename = "unitName")]
    pub unit_name: String,
    #[serde(rename = "unitShort")]
    pub unit_short: String,
    pub conversion: f64,
    #[serde(default)]
    pub barcode: Option<String>,
    #[serde(default)]
    pub retail_price: Option<f64>,
    #[serde(default)]
    pub wholesale_price: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Product {
    pub id: i64,
    pub name: String,
    pub cost_price: f64,
    pub retail_price: f64,
    pub wholesale_price: f64,
    pub stock_quantity: f64,
    pub category_id: Option<i64>,
    pub image_uri: Option<String>,
    pub created_at: String,
    pub low_stock_threshold: Option<i64>,
    pub barcode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<Vec<ProductUnit>>,
}

/// مدخل نموذج منتج — من ProductRepo.ProductInput.
#[derive(Debug, Clone, Deserialize)]
pub struct ProductInput {
    pub name: String,
    pub cost_price: f64,
    pub retail_price: f64,
    pub wholesale_price: f64,
    pub stock_quantity: f64,
    pub category_id: Option<i64>,
    pub image_uri: Option<String>,
    pub low_stock_threshold: Option<i64>,
    pub barcode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleRecord {
    pub id: i64,
    pub invoice_number: String,
    pub total_amount: f64,
    pub total_cost: f64,
    pub total_profit: f64,
    pub discount: f64,
    pub payment_type: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleItemRecord {
    pub id: i64,
    pub sale_id: i64,
    pub product_id: i64,
    pub quantity: f64,
    pub unit_price: f64,
    pub cost_price: f64,
    pub total_line_price: f64,
    #[serde(default)]
    pub unit_name: Option<String>,
    #[serde(default)]
    pub base_quantity: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleWithItems {
    pub sale: SaleRecord,
    pub items: Vec<SaleItemRecord>,
}

/// سطر سلة قادم من الواجهة — نفس CartLine في types.ts.
#[derive(Debug, Clone, Deserialize)]
pub struct CartLine {
    #[serde(default)]
    pub key: String,
    pub product_id: i64,
    #[serde(default)]
    pub name: String,
    pub unit_price: f64,
    pub cost_price: f64,
    pub quantity: f64,
    #[serde(default)]
    pub unit_id: Option<i64>,
    #[serde(default)]
    pub unit_name: Option<String>,
    #[serde(default = "default_conversion")]
    pub conversion: f64,
}
fn default_conversion() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stocktake {
    pub id: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StocktakeItem {
    pub id: i64,
    pub stocktake_id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub category_id: Option<i64>,
    pub system_qty: f64,
    pub counted_qty: Option<f64>,
    #[serde(default)]
    pub unit_hint: Option<String>,
}

/// إدخال عدّ جرد قادم من الواجهة.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountedInput {
    pub product_id: i64,
    pub counted_qty: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateRange {
    /// شاملة 'YYYY-MM-DD'
    pub from: String,
    /// شاملة 'YYYY-MM-DD'
    pub to: String,
}

impl DateRange {
    /// نطاق اليوم/أمس/آخر٧/هذا الشهر — بقواعد format.ts المحلية نفسها.
    pub fn of(kind: &str, today: &str, month_start: &str, yesterday: &str, week_ago: &str) -> DateRange {
        let (from, to) = match kind {
            "today" => (today.to_string(), today.to_string()),
            "yesterday" => (yesterday.to_string(), yesterday.to_string()),
            "last7" => (week_ago.to_string(), today.to_string()),
            "thisMonth" => (month_start.to_string(), today.to_string()),
            _ => (today.to_string(), today.to_string()),
        };
        DateRange { from, to }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSummary {
    pub revenue: f64,
    pub cogs: f64,
    pub net_profit: f64,
    pub invoices_count: i64,
    pub items_count: f64,
    pub discount_total: f64,
    pub avg_invoice: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopProduct {
    pub product_id: i64,
    pub name: String,
    pub quantity: f64,
    pub revenue: f64,
    pub profit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyPoint {
    pub day: String,
    pub revenue: f64,
    pub profit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HourlyPoint {
    pub hour: i64,
    pub revenue: f64,
    pub orders: i64,
}
