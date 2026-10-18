/**
 * sela-core — نواة تطبيق sela لسطح المكتب (v57.0.0).
 * ────────────────────────────────────────────────────────────────
 *  المنطق هنا مطابق حرفياً لتطبيق الأندرويد v57.0.0:
 *   • DDL/بذور/ترحيلات — من connection.ts (كل الترحيلات مدمجة).
 *   • جسر SQL بنفس شكل op-sqlite (rows/insertId/rowsAffected)
 *     — تُبنى عليه خدمات TS المنقولة حرفياً.
 *   • تقارير/جرد/نسخ احتياطي JSON — من المستودعات الأصلية.
 *   • ترميز ESC/POS — بايتاً ببايت من ThermalPrinterModule.kt.
 *  لا تعتمد النواة على tauri إطلاقاً — قابلة للاختبار الكامل على لينكس.
 */
pub mod backup;
pub mod checkout;
pub mod codepages;
pub mod config;
pub mod db;
pub mod escpos;
pub mod fsops;
pub mod hardware;
pub mod images;
pub mod invoice;
pub mod lan;
pub mod models;
pub mod paths;
pub mod reports;
pub mod repos;
pub mod sqlbridge;
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
