#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
/**
 * main.rs — إقلاع سيلا POS لسطح المكتب.
 *  • يفتح القاعدة وconfig في %AppData%\sela-pos.
 *  • يشغّل خطاف قارئ الباركود العام (ويندوز) — كل كود يُبثّ كحدث
 *    «scanner://barcode» للواجهة التي توجهه للشاشة النشطة.
 */

mod commands;
mod sqlbridge;

use sela_core::config::ConfigStore;
use sela_core::db;
use sela_core::hardware;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub struct AppState {
    pub conn: Mutex<rusqlite::Connection>,
    pub config: Mutex<ConfigStore>,
    /// جلسات المعاملات — اتصال مخصص لكل معاملة (BEGIN IMMEDIATE)
    /// مع لحظة الإنشاء لمرصد المسرّب منها (v58).
    pub sessions: Mutex<HashMap<u64, sqlbridge::TxSession>>,
    pub next_tx: AtomicU64,
    pub db_path: std::path::PathBuf,
}

fn main() {
    sela_core::paths::ensure_dirs().expect("تعذر إنشاء شجرة بيانات sela-pos");
    let db_path = sela_core::paths::db_path();
    let conn = db::open_and_init(&db_path).expect("تعذر فتح قاعدة البيانات");
    let config = ConfigStore::open(sela_core::paths::config_path()).expect("تعذر فتح config.json");

    tauri::Builder::default()
        // ── مثيل واحد فقط (v58) ─────────────────────────────────────
        // فتح التطبيق مرتين كان يفتح قاعدتي اتصال على نفس الملف —
        // أقفال كتابة متزاحمة («database is locked») وتراكب كتابة
        // config.json. الآن: النسخة الثانية تركّز نافذة الأولى وتخرج.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // ── طبقة الشبكة عبر نواة Rust (v57.2) ─────────────────────
        // طلبات HTTP كلها تنفَّذ من العملية الأصلية لا من WebView:
        // سياسة CSP وسلوك CORS الخاصين بالمتصفح لا ينطبقان عليها —
        // نفس سلوك OkHttp في تطبيق الأندرويد (سيرفر التفعيل لا يرسل
        // ترويسات CORS أصلاً، وهذا هو الجذر الذي منع التفعيل قبلها).
        .plugin(tauri_plugin_http::init())
        .manage(AppState {
            conn: Mutex::new(conn),
            config: Mutex::new(config),
            sessions: Mutex::new(HashMap::new()),
            next_tx: AtomicU64::new(1),
            db_path,
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::config_get_all,
            commands::config_set,
            commands::config_remove,
            commands::list_products,
            commands::save_product,
            commands::delete_product,
            commands::find_barcode,
            commands::list_categories,
            commands::upsert_category,
            commands::delete_category,
            commands::list_units,
            commands::upsert_unit,
            commands::delete_unit,
            commands::start_stocktake,
            commands::list_stocktakes,
            commands::list_stocktake_items,
            commands::set_counted,
            commands::complete_stocktake,
            commands::cancel_stocktake,
            commands::stocktake_summary,
            commands::checkout,
            commands::list_recent_sales,
            commands::list_sales_range,
            commands::get_sale,
            commands::reports_summary,
            commands::reports_top,
            commands::reports_daily,
            commands::reports_hourly,
            commands::next_invoice,
            commands::build_backup,
            commands::export_backup,
            commands::import_backup,
            commands::print_job,
            commands::test_printer,
            commands::open_drawer,
            commands::list_serial_ports,
            commands::list_spool_printers,
            commands::save_printer_channel,
            commands::current_printer_channel,
            commands::pick_store_logo,
            commands::device_id,
            commands::uptime_ms,
            commands::scanner_running,
            commands::wipe_data,
            // ── جسر SQL العام (واجهة op-sqlite للخدمات المنقولة) ──
            sqlbridge::sql_run,
            sqlbridge::tx_begin,
            sqlbridge::tx_execute,
            sqlbridge::tx_commit,
            sqlbridge::tx_rollback,
            sqlbridge::tx_sessions_alive,
            // ── ملفات النسخ/التصدير/الاستيراد ──
            sqlbridge::save_text_file,
            sqlbridge::open_text_file,
            sqlbridge::pick_folder,
            sqlbridge::write_file_in_folder,
            // ── ملفات وصور (جسر nativeBridge) ──
            sqlbridge::fs_file_exists,
            sqlbridge::fs_file_signature,
            sqlbridge::fs_read_file_base64,
            sqlbridge::fs_write_file_base64,
            sqlbridge::image_compress,
            sqlbridge::open_path,
            sqlbridge::reveal_in_folder
        ])
        .setup(|app| {
            // ── خطاف الباركود العام: كل كود مكتمل يصل الواجهة كحدث ──
            let handle = app.handle().clone();
            let started = hardware::hook::start(
                Box::new(move |code| {
                    let _ = handle.emit("scanner://barcode", code.clone());
                }),
                4,
            );
            if !started {
                // لينكس/ماك: الواجهة تركّب مستمع JS داخلياً بنفس منطق الاندفاعة.
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("فشل تشغيل نافذة سيلا");
}
