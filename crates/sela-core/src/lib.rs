/**
 * sela-core — نواة تطبيق sela لسطح المكتب (v1.0.0).
 * ─────────────────────────────────────────────────────────────────
 *  كل المنطق هنا مطابق حرفياً لتطبيق الأندرويد v6.0.0:
 *   • DDL/بذور/ترحيلات — من connection.ts كما هي.
 *   • معاملة البيع وحرس البيع الزائد — من SaleRepo.createSale كما هي.
 *   • تقارير/جرد/نسخ احتياطي JSON v1 — من المستودعات الأصلية كما هي.
 *   • ترميز ESC/POS — بايتاً ببايت من ThermalPrinterModule.kt.
 *  لا تعتمد النواة على tauri إطلاقاً — قابلة للاختبار الكامل على لينكس.
 */
pub mod backup;
pub mod checkout;
pub mod codepages;
pub mod config;
pub mod db;
pub mod escpos;
pub mod hardware;
pub mod invoice;
pub mod models;
pub mod paths;
pub mod reports;
pub mod repos;
pub mod sysinfo;

use thiserror::Error;

/// خطأ موحّد برسائل عربية مطابقة لرسائل الأندرويد حيثما وجدت.
#[derive(Debug, Error)]
pub enum SelaError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl SelaError {
    pub fn msg(value: impl Into<String>) -> Self {
        SelaError::Message(value.into())
    }
}

pub type Result<T> = std::result::Result<T, SelaError>;

pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
