#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
/**
 * main.rs — إقلاع سيلا POS لسطح المكتب.
 *  • يفتح القاعدة وconfig في %AppData%\sela-pos.
 *  • يشغّل خطاف قارئ الباركود العام (ويندوز) — كل كود يُبثّ كحدث
 *    «scanner://barcode» للواجهة التي توجهه للشاشة النشطة.
 *  • v68 (الجولة 72): أيقونة شريط المهام + الاستمرار بالخلفية —
 *    إغلاق النافذة مع خادم الكاشير يعمل لم يعد يوقف الخادم: النافذة
 *    تُخفى والبرنامج يبقى حياً من أيقونة سيلا في شريط المهام (فتح
 *    النقطة بنقرة، إنهاء كامل من القائمة). منطق الطلبات كله في
 *    الواجهة (LanHandlers) لذا يجب أن تبقى العملية — لا الخادم
 *    وحده — حية، وهذا ما تفعله الآلية هنا بأقل تغيير ممكن.
 */

mod commands;
mod sqlbridge;

use sela_core::config::ConfigStore;
use sela_core::db;
use sela_core::hardware;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub struct AppState {
    pub conn: Mutex<rusqlite::Connection>,
    pub config: Mutex<ConfigStore>,
    /// جلسات المعاملات — اتصال مخصص لكل معاملة (BEGIN IMMEDIATE)
    /// مع لحظة الإنشاء لمرصد المسرّب منها (v58).
    pub sessions: Mutex<HashMap<u64, sqlbridge::TxSession>>,
    pub next_tx: AtomicU64,
    pub db_path: std::path::PathBuf,
    /// v58 (الجولة 62): خادم «سيلّا كاشير» على الشبكة المحلية —
    /// None = مطفأ. الأوامر: lan_start/lan_stop/lan_status/lan_respond.
    pub lan: Mutex<Option<LanEntry>>,
}

/// خادم الكاشير الحي (خيوط قبول HTTP + مستجيب بث الاستكشاف UDP).
pub struct LanEntry {
    pub server: std::sync::Arc<sela_core::lan::LanServer>,
}

/// v68: أيقونة سيلا في شريط المهام — تُدار في حالة التطبيق كي تبقى
/// حية طوال عمر العملية (إسقاط TrayIcon يزيلها من الشريط).
pub struct TrayState {
    pub tray: TrayIcon<tauri::Wry>,
}

/// v68: هل إعداد «الاستمرار بالخلفية بعد إغلاق النافذة» مفعّل؟
/// يعيش داخل settings_json_v1 (يحرّره التاجر من شاشة الكاشير)
/// والافتراضي مفعّل — طلب التاجر نصاً: الخادم يبقى يعمل حتى بعد
/// إغلاق البرنامج.
fn lan_keep_alive_on_close(state: &AppState) -> bool {
    let Ok(config) = state.config.lock() else {
        return true;
    };
    config
        .get("settings_json_v1")
        .and_then(|v| v.get("lanKeepAliveOnClose"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// v68: تحديث نص أيقونة الشريط بحالة خادم الكاشير لحظياً.
pub fn refresh_tray_tooltip(app: &AppHandle) {
    let Some(tray_state) = app.try_state::<TrayState>() else {
        return;
    };
    let tooltip = {
        let state = app.state::<AppState>();
        let lan = state.lan.lock().unwrap();
        match lan.as_ref() {
            Some(entry) => format!(
                "سيلا POS — خادم الكاشير يعمل (المنفذ {}) · البرنامج يعمل بالخلفية",
                entry.server.port()
            ),
            None => "سيلا POS — نقطة البيع".to_string(),
        }
    };
    let _ = tray_state.tray.set_tooltip(Some(tooltip.as_str()));
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
        // v68: هذا يخدم الاستمرار بالخلفية أيضاً — فتح التطبيق من
        // الاختصار بينما البرنامج مخفي في الشريط يُظهر النافذة.
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
            lan: Mutex::new(None),
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
            commands::scanner_set_enabled,
            commands::pick_product_image,
            commands::wipe_data,
            commands::lan_start,
            commands::lan_stop,
            commands::lan_status,
            commands::lan_local_ip,
            commands::lan_respond,
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

            // ── v68: أيقونة شريط المهام ────────────────────────────
            // تظهر طوال عمل البرنامج: نقرة يسار تفتح النافذة (أو
            // تُظهرها إن كانت مخفية بالخلفية)، والقائمة اليمنى فيها
            // «إظهار نقطة البيع» و«إنهاء كامل» — الطريق الوحيد
            // للخروج الكامل بينما الخادم يعمل والنافذة مخفية.
            let show_item =
                MenuItem::with_id(app, "show", "إظهار نقطة البيع", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(
                app,
                "quit",
                "إنهاء كامل (إيقاف الخادم والخروج)",
                true,
                None::<&str>,
            )?;
            let menu = Menu::with_items(
                app,
                &[&show_item, &PredefinedMenuItem::separator(app)?, &quit_item],
            )?;

            let mut builder = TrayIconBuilder::with_id("sela-tray")
                .tooltip("سيلا POS — نقطة البيع")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        // الخروج الكامل — AppState تُسقَط فيوقف خادم
                        // الكاشير نفسه (Drop لـ LanServer).
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // نقرة يسار على الأيقونة = فتح/إظهار النافذة.
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            let tray = builder.build(app)?;
            app.manage(TrayState { tray });

            Ok(())
        })
        // ── v68: الإغلاق مع خادم حي = إخفاء للخلفية لا خروج ──────
        // طلب التاجر نصاً: «يجب أن تبقي نقطة البيع تعمل حتى بعد
        // إغلاق البرنامج». الخادم يعتمد على الواجهة الحية (الطلبات
        // تُبثّ حدثاً وتُردّ من TS) — لذا نخفي النافذة ونُبقي
        // العملية كلها. الخروج الحقيقي من قائمة أيقونة الشريط، أو
        // بإغلاق النافذة والخادم متوقف (سلوك ما قبل v68 نفسه).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let hide_to_tray = {
                    let state = app.state::<AppState>();
                    let server_running =
                        state.lan.lock().map(|lan| lan.is_some()).unwrap_or(false);
                    server_running && lan_keep_alive_on_close(&state)
                };
                if hide_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    refresh_tray_tooltip(app);
                    // الواجهة تُظهر إشعار نظام واضحاً (مرة على الأقل)
                    // كي لا يظن التاجر أن البرنامج أُغلق وفُقد الخادم.
                    let _ = app.emit("app://hidden-to-tray", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("فشل تشغيل نافذة سيلا");
}
