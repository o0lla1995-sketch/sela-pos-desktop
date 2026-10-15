#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
/**
 * main.rs — إقلاع سيلا POS لسطح المكتب.
 *  • يفتح القاعدة وconfig في %AppData%\sela-pos.
 *  • يشغّل خطاف قارئ الباركود العام (ويندوز) — كل كود يُبثّ كحدث
 *    «scanner://barcode» للواجهة التي توجهه للشاشة النشطة.
 */

mod commands;

use sela_core::config::ConfigStore;
use sela_core::db;
use sela_core::hardware;
use std::sync::Mutex;
use tauri::Emitter;

pub struct AppState {
    pub conn: Mutex<rusqlite::Connection>,
    pub config: Mutex<ConfigStore>,
}

fn main() {
    sela_core::paths::ensure_dirs().expect("تعذر إنشاء شجرة بيانات sela-pos");
    let conn = db::open_and_init(&sela_core::paths::db_path()).expect("تعذر فتح قاعدة البيانات");
    let config = ConfigStore::open(sela_core::paths::config_path()).expect("تعذر فتح config.json");

    tauri::Builder::default()
        .manage(AppState {
            conn: Mutex::new(conn),
            config: Mutex::new(config),
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
            commands::wipe_data
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
