/**
 * commands.rs — جسر Tauri: كل قدرة في النواة تصبح أمراً للواجهة.
 * الأخطاء دائماً نصوص عربية جاهزة للعرض (نفس رسائل الأندرويد).
 */
use crate::AppState;
use sela_core::backup;
use sela_core::checkout::{self, CreateSaleInput};
use sela_core::config::ConfigStore;
use sela_core::escpos::EscPosOp;
use sela_core::hardware::{self, PrinterChannel};
use sela_core::invoice;
use sela_core::models::*;
use sela_core::repos::{self, ProductFilter, ReplaceUnitRow};
use sela_core::reports;
use serde_json::{json, Map, Value};
use tauri::{command, State};

type CmdResult<T> = Result<T, String>;

fn arabic(e: sela_core::SelaError) -> String {
    e.to_string()
}

// ──────────────────────────────────────────────── الإقلاع والإعدادات

#[command]
pub fn bootstrap(state: State<AppState>) -> CmdResult<Value> {
    let data_dir = sela_core::paths::data_dir().to_string_lossy().to_string();
    let config = state.config.lock().unwrap();
    let printer: PrinterChannel =
        serde_json::from_value(config.get_or("desktop_printer_v1", json!(null)))
            .unwrap_or(PrinterChannel::None);
    Ok(json!({
        "dataDir": data_dir,
        "deviceId": sela_core::sysinfo::device_id().map_err(arabic)?,
        "coreVersion": sela_core::CORE_VERSION,
        "printer": printer,
    }))
}

#[command]
pub fn config_get_all(state: State<AppState>) -> CmdResult<Map<String, Value>> {
    Ok(state.config.lock().unwrap().all())
}

#[command]
pub fn config_set(state: State<AppState>, key: String, value: Value) -> CmdResult<()> {
    state
        .config
        .lock()
        .unwrap()
        .set(&key, value)
        .map_err(arabic)
}

#[command]
pub fn config_remove(state: State<AppState>, key: String) -> CmdResult<()> {
    state
        .config
        .lock()
        .unwrap()
        .remove(&key)
        .map_err(arabic)
}

// ──────────────────────────────────────────────── المنتجات والبحث

fn parse_filter(search: Option<String>, category_id: Option<Value>) -> ProductFilter {
    let category = category_id.and_then(|v| match v {
        Value::Null => None,
        Value::String(s) if s == "all" => None,
        Value::Number(n) => n.as_i64(),
        _ => None,
    });
    ProductFilter { search, category_id: category }
}

#[command]
pub fn list_products(
    state: State<AppState>,
    search: Option<String>,
    category_id: Option<Value>,
) -> CmdResult<Vec<Product>> {
    let conn = state.conn.lock().unwrap();
    repos::products::list_with_units(&conn, &parse_filter(search, category_id))
        .map_err(arabic)
}

#[derive(serde::Deserialize)]
pub struct SaveProductArgs {
    pub id: Option<i64>,
    pub input: ProductInput,
    pub unit_rows: Vec<ReplaceUnitRow>,
}

#[command]
pub fn save_product(state: State<AppState>, args: SaveProductArgs) -> CmdResult<i64> {
    let mut conn = state.conn.lock().unwrap();
    let id = match args.id {
        Some(existing) if existing > 0 => {
            repos::products::update(&conn, existing, &args.input).map_err(arabic)?;
            existing
        }
        _ => repos::products::create(&mut conn, &args.input).map_err(arabic)?,
    };
    if !args.unit_rows.is_empty() || args.id.is_some() {
        repos::products::replace_units(&mut conn, id, &args.unit_rows).map_err(arabic)?;
    }
    Ok(id)
}

#[command]
pub fn delete_product(state: State<AppState>, id: i64) -> CmdResult<()> {
    let conn = state.conn.lock().unwrap();
    repos::products::remove(&conn, id).map_err(arabic)
}

/// بحث الباركود على مستويين (منتج ثم وحدة) — نفس ترتيب PosScreen.
#[command]
pub fn find_barcode(state: State<AppState>, code: String) -> CmdResult<Value> {
    let conn = state.conn.lock().unwrap();
    if let Some(product) = repos::products::find_by_barcode(&conn, &code).map_err(arabic)? {
        return Ok(json!({"kind": "product", "product": product}));
    }
    if let Some((pid, unit)) = repos::units::find_by_barcode(&conn, &code).map_err(arabic)? {
        let product = repos::products::get_by_id(&conn, pid)
            .map_err(arabic)?
            .ok_or_else(|| "المنتج غير موجود".to_string())?;
        return Ok(json!({"kind": "unit", "product": product, "unit": unit}));
    }
    Ok(json!({"kind": "none", "code": code}))
}

// ──────────────────────────────────────────────── التصنيفات والوحدات

#[command]
pub fn list_categories(state: State<AppState>) -> CmdResult<Vec<Category>> {
    let conn = state.conn.lock().unwrap();
    repos::categories::list(&conn).map_err(arabic)
}

#[command]
pub fn upsert_category(state: State<AppState>, id: Option<i64>, name: String) -> CmdResult<i64> {
    let conn = state.conn.lock().unwrap();
    match id {
        Some(existing) if existing > 0 => {
            repos::categories::rename(&conn, existing, &name).map_err(arabic)?;
            Ok(existing)
        }
        _ => repos::categories::create(&conn, &name).map_err(arabic),
    }
}

#[command]
pub fn delete_category(state: State<AppState>, id: i64) -> CmdResult<()> {
    let conn = state.conn.lock().unwrap();
    repos::categories::remove(&conn, id).map_err(arabic)
}

#[command]
pub fn list_units(state: State<AppState>) -> CmdResult<Vec<Unit>> {
    let conn = state.conn.lock().unwrap();
    repos::units::list(&conn).map_err(arabic)
}

#[command]
pub fn upsert_unit(state: State<AppState>, unit: Unit) -> CmdResult<i64> {
    let conn = state.conn.lock().unwrap();
    repos::units::upsert(&conn, &unit).map_err(arabic)
}

#[command]
pub fn delete_unit(state: State<AppState>, id: i64) -> CmdResult<()> {
    let conn = state.conn.lock().unwrap();
    repos::units::remove(&conn, id).map_err(arabic)
}

// ──────────────────────────────────────────────── الجرد

#[command]
pub fn start_stocktake(state: State<AppState>) -> CmdResult<Stocktake> {
    let mut conn = state.conn.lock().unwrap();
    repos::stocktakes::start(&mut conn).map_err(arabic)
}

#[command]
pub fn list_stocktakes(state: State<AppState>, limit: Option<i64>) -> CmdResult<Vec<Stocktake>> {
    let conn = state.conn.lock().unwrap();
    repos::stocktakes::list(&conn, limit.unwrap_or(20)).map_err(arabic)
}

#[command]
pub fn list_stocktake_items(
    state: State<AppState>,
    stocktake_id: i64,
    search: Option<String>,
    category_id: Option<Value>,
    only_pending: Option<bool>,
) -> CmdResult<Vec<StocktakeItem>> {
    let conn = state.conn.lock().unwrap();
    repos::stocktakes::list_items(
        &conn,
        stocktake_id,
        &parse_filter(search, category_id),
        only_pending.unwrap_or(false),
    )
    .map_err(arabic)
}

#[command]
pub fn set_counted(
    state: State<AppState>,
    stocktake_id: i64,
    product_id: i64,
    counted: Option<f64>,
) -> CmdResult<()> {
    let conn = state.conn.lock().unwrap();
    repos::stocktakes::set_counted(&conn, stocktake_id, product_id, counted).map_err(arabic)
}

#[command]
pub fn complete_stocktake(
    state: State<AppState>,
    stocktake_id: i64,
    apply_adjustments: bool,
) -> CmdResult<i64> {
    let mut conn = state.conn.lock().unwrap();
    repos::stocktakes::complete(&mut conn, stocktake_id, apply_adjustments).map_err(arabic)
}

#[command]
pub fn cancel_stocktake(state: State<AppState>, stocktake_id: i64) -> CmdResult<()> {
    let mut conn = state.conn.lock().unwrap();
    repos::stocktakes::cancel(&mut conn, stocktake_id).map_err(arabic)
}

#[command]
pub fn stocktake_summary(
    state: State<AppState>,
    stocktake_id: i64,
) -> CmdResult<repos::StocktakeSummary> {
    let conn = state.conn.lock().unwrap();
    repos::stocktakes::summary(&conn, stocktake_id).map_err(arabic)
}

// ──────────────────────────────────────────────── البيع والفواتير

#[command]
pub fn checkout(
    state: State<AppState>,
    invoice_number: String,
    lines: Vec<CartLine>,
    discount: f64,
    payment_type: String,
) -> CmdResult<SaleWithItems> {
    let mut conn = state.conn.lock().unwrap();
    checkout::create_sale(
        &mut conn,
        &CreateSaleInput {
            invoice_number: &invoice_number,
            lines: &lines,
            discount,
            payment_type: &payment_type,
        },
    )
    .map_err(arabic)
}

#[command]
pub fn list_recent_sales(state: State<AppState>, limit: Option<i64>) -> CmdResult<Vec<SaleRecord>> {
    let conn = state.conn.lock().unwrap();
    repos::sales::list_recent(&conn, limit.unwrap_or(20)).map_err(arabic)
}

#[command]
pub fn list_sales_range(
    state: State<AppState>,
    from: String,
    to: String,
    limit: Option<i64>,
) -> CmdResult<Vec<SaleRecord>> {
    let conn = state.conn.lock().unwrap();
    repos::sales::list_range(&conn, &from, &to, limit.unwrap_or(2000)).map_err(arabic)
}

#[command]
pub fn get_sale(state: State<AppState>, id: i64) -> CmdResult<SaleWithItems> {
    let conn = state.conn.lock().unwrap();
    let sale = repos::sales::get_by_id(&conn, id)
        .map_err(arabic)?
        .ok_or_else(|| "الفاتورة غير موجودة".to_string())?;
    let items = repos::sales::get_items_for_sale(&conn, id).map_err(arabic)?;
    Ok(SaleWithItems { sale, items })
}

// ──────────────────────────────────────────────── التقارير

#[command]
pub fn reports_summary(state: State<AppState>, from: String, to: String) -> CmdResult<ReportSummary> {
    let conn = state.conn.lock().unwrap();
    reports::summary(&conn, &DateRange { from, to }).map_err(arabic)
}

#[command]
pub fn reports_top(state: State<AppState>, from: String, to: String, limit: Option<i64>) -> CmdResult<Vec<TopProduct>> {
    let conn = state.conn.lock().unwrap();
    reports::top_products(&conn, &DateRange { from, to }, limit.unwrap_or(10)).map_err(arabic)
}

#[command]
pub fn reports_daily(state: State<AppState>, from: String, to: String) -> CmdResult<Vec<DailyPoint>> {
    let conn = state.conn.lock().unwrap();
    reports::daily(&conn, &DateRange { from, to }).map_err(arabic)
}

#[command]
pub fn reports_hourly(state: State<AppState>, from: String, to: String) -> CmdResult<Vec<HourlyPoint>> {
    let conn = state.conn.lock().unwrap();
    reports::hourly(&conn, &DateRange { from, to }).map_err(arabic)
}

/// ترقيم الفواتير — يقرأ/يكتب عدّاد اليوم في config (مفاتيح الأندرويد نفسها).
#[command]
pub fn next_invoice(state: State<AppState>) -> CmdResult<Value> {
    let mut config = state.config.lock().unwrap();
    let counter = config
        .get_or("invoice_counter_v1", json!(0))
        .as_u64()
        .unwrap_or(0) as u32;
    let day = config
        .get_or("invoice_day_v1", json!(""))
        .as_str()
        .unwrap_or("")
        .to_string();
    let today = sela_core::sysinfo::local_today();
    let (number, next, day_out) =
        invoice::next_invoice_number(counter, &day, &today).map_err(arabic)?;
    config.set("invoice_counter_v1", json!(next)).map_err(arabic)?;
    config.set("invoice_day_v1", json!(day_out)).map_err(arabic)?;
    Ok(json!({"invoiceNumber": number, "counter": next, "day": day_out}))
}

// ──────────────────────────────────────────────── النسخ الاحتياطي

fn current_settings_json(config: &ConfigStore) -> Value {
    config.get_or("settings_json_v1", json!({}))
}

#[command]
pub fn build_backup(state: State<AppState>) -> CmdResult<Value> {
    let conn = state.conn.lock().unwrap();
    let config = state.config.lock().unwrap();
    let version = format!(
        "{} ({})",
        env!("CARGO_PKG_VERSION"),
        option_env!("DESKTOP_BUILD").unwrap_or("1")
    );
    let (json_text, summary) =
        backup::build_backup_json(&conn, &version, current_settings_json(&config)).map_err(arabic)?;
    drop(config);
    drop(conn);
    Ok(json!({"json": json_text, "summary": summary}))
}

/// حوار حفظ أصلي (rfd) + كتابة الملف — نفس اسم ملف الأندرويد.
#[command]
pub fn export_backup(state: State<AppState>) -> CmdResult<Value> {
    let payload = build_backup(state)?;
    let stamp = sela_core::sysinfo::local_today();
    let file_name = format!("sela_backup_{stamp}.json");
    let picked = rfd::FileDialog::new()
        .set_title("حفظ النسخة الاحتياطية")
        .add_filter("نسخة sela (JSON)", &["json"])
        .set_file_name(&file_name)
        .save_file();
    let path = picked.ok_or_else(|| "أُلغيت عملية الحفظ".to_string())?;
    std::fs::write(&path, payload["json"].as_str().unwrap_or(""))
        .map_err(|e| format!("تعذر كتابة الملف: {e}"))?;
    Ok(json!({"path": path.to_string_lossy(), "summary": payload["summary"]}))
}

/// حوار فتح أصلي + تحقق + استعادة ذرّية + تطبيق settings على config.
#[command]
pub fn import_backup(state: State<AppState>) -> CmdResult<Value> {
    let picked = rfd::FileDialog::new()
        .set_title("اختيار ملف النسخة الاحتياطية")
        .add_filter("نسخة sela (JSON)", &["json"])
        .pick_file();
    let path = picked.ok_or_else(|| "أُلغيت الاستعادة".to_string())?;
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("تعذر قراءة الملف: {e}"))?;
    let doc = backup::parse_backup(&content).map_err(arabic)?;
    let mut conn = state.conn.lock().unwrap();
    let settings = backup::restore_backup(&mut conn, &doc).map_err(arabic)?;
    drop(conn);
    if settings.is_object() {
        state
            .config
            .lock()
            .unwrap()
            .set("settings_json_v1", settings)
            .map_err(arabic)?;
    }
    Ok(json!({
        "path": path.to_string_lossy(),
        "summary": {
            "categories": doc.categories.len(),
            "units": doc.units.len(),
            "products": doc.products.len(),
            "productUnits": doc.product_units.len(),
            "sales": doc.sales.len(),
        }
    }))
}

// ──────────────────────────────────────────────── الطباعة والعتاد

fn printer_channel(state: &State<AppState>) -> PrinterChannel {
    let config = state.config.lock().unwrap();
    serde_json::from_value(config.get_or("desktop_printer_v1", json!(null)))
        .unwrap_or(PrinterChannel::None)
}

#[command]
pub fn print_job(state: State<AppState>, ops: Vec<EscPosOp>) -> CmdResult<Value> {
    let channel = printer_channel(&state);
    let written = hardware::print_job(&channel, &ops).map_err(arabic)?;
    Ok(json!({"written": written, "channel": channel.describe()}))
}

/// اختبار الطابعة — إيصال عربي صغير مركز مع قص.
#[command]
pub fn test_printer(state: State<AppState>) -> CmdResult<Value> {
    let channel = printer_channel(&state);
    let test = vec![
        EscPosOp { op: "init".into(), ..Default::default() },
        EscPosOp { op: "codepage".into(), page: Some(47), ..Default::default() },
        EscPosOp { op: "align".into(), align: Some(1), ..Default::default() },
        EscPosOp { op: "bold".into(), on: Some(true), ..Default::default() },
        EscPosOp { op: "size".into(), width: Some(1), height: Some(1), ..Default::default() },
        EscPosOp { op: "text".into(), value: Some("سيلا — اختبار الطباعة\n".into()), ..Default::default() },
        EscPosOp { op: "size".into(), width: Some(0), height: Some(0), ..Default::default() },
        EscPosOp { op: "bold".into(), on: Some(false), ..Default::default() },
        EscPosOp { op: "text".into(), value: Some("العربية: أ ب ت ث ج ح خ د ذ\n".into()), ..Default::default() },
        EscPosOp { op: "text".into(), value: Some("English: ABCDEFG 12345\n".into()), ..Default::default() },
        EscPosOp { op: "align".into(), align: Some(2), ..Default::default() },
        EscPosOp { op: "text".into(), value: Some("6.50 x 2 = 13.00\n".into()), ..Default::default() },
        EscPosOp { op: "feed".into(), lines: Some(3), ..Default::default() },
        EscPosOp { op: "cut".into(), ..Default::default() },
    ];
    let written = hardware::print_job(&channel, &test).map_err(arabic)?;
    Ok(json!({"written": written, "channel": channel.describe()}))
}

#[command]
pub fn open_drawer(state: State<AppState>) -> CmdResult<Value> {
    let channel = printer_channel(&state);
    let written = hardware::kick_drawer(&channel).map_err(arabic)?;
    Ok(json!({"written": written}))
}

#[command]
pub fn list_serial_ports() -> CmdResult<Vec<String>> {
    Ok(hardware::list_serial_ports())
}

#[command]
pub fn list_spool_printers() -> CmdResult<Vec<String>> {
    Ok(hardware::list_spool_printers())
}

#[command]
pub fn save_printer_channel(state: State<AppState>, channel: PrinterChannel) -> CmdResult<()> {
    state
        .config
        .lock()
        .unwrap()
        .set("desktop_printer_v1", serde_json::to_value(channel).unwrap())
        .map_err(arabic)
}

#[command]
pub fn current_printer_channel(state: State<AppState>) -> CmdResult<PrinterChannel> {
    Ok(printer_channel(&state))
}

/// اختيار شعار المتجر (حوار أصلي) ونسخه إلى مجلد أصول التطبيق.
#[command]
pub fn pick_store_logo(_state: State<AppState>) -> CmdResult<Option<String>> {
    let picked = rfd::FileDialog::new()
        .set_title("اختيار شعار المتجر")
        .add_filter("صور", &["png", "jpg", "jpeg", "bmp"])
        .pick_file();
    let Some(path) = picked else {
        return Ok(None);
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let name = format!(
        "logo-{}-{}.{ext}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        sela_core::sysinfo::local_today().replace('-', "")
    );
    let dest = sela_core::paths::assets_dir().join(name);
    std::fs::copy(&path, &dest).map_err(|e| format!("تعذر نسخ الشعار: {e}"))?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

/// اختيار صورة منتج (حوار أصلي) → ضغط إلى 512px JPEG → حفظ داخل
/// مجلد بيانات التطبيق products/ → إعادة المسار الجديد لimage_uri.
/// المنتج يعرض الصورة في نقطة البيع عبر بروتوكول asset.
#[command]
pub fn pick_product_image(_state: State<AppState>) -> CmdResult<Option<String>> {
    let picked = rfd::FileDialog::new()
        .set_title("اختيار صورة المنتج")
        .add_filter(
            "صور",
            &["png", "jpg", "jpeg", "bmp", "webp", "gif"],
        )
        .pick_file();
    let Some(src) = picked else {
        return Ok(None);
    };
    let compressed =
        sela_core::images::compress_image(&src.to_string_lossy(), 512, 82)
            .map_err(arabic)?;
    let b64 = compressed["base64"].as_str().unwrap_or_default().to_string();
    if b64.is_empty() {
        return Err("تعذر قراءة الصورة".to_string());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = format!("p-{stamp}.jpg");
    let path = sela_core::fsops::write_file_base64("products", &name, &b64)
        .map_err(arabic)?;
    Ok(Some(path))
}

// ──────────────────────────────────────────────── النظام

#[command]
pub fn device_id() -> CmdResult<String> {
    sela_core::sysinfo::device_id().map_err(arabic)
}

#[command]
pub fn uptime_ms() -> CmdResult<u64> {
    sela_core::sysinfo::uptime_ms().map_err(arabic)
}

#[command]
pub fn scanner_running() -> CmdResult<bool> {
    Ok(sela_core::hardware::hook::is_running())
}

/// تعطيل/تفعيل اعتراض الباركود مؤقتاً — تستدعيه الواجهة أثناء فتح
/// لوحات إدخال المبالغ (كي لا يُفسَّر الكتابة على الكيبورد كمسح)
/// وعند ظهور شاشة قفل الدخول (لا بيع قبل الدخول).
#[command]
pub fn scanner_set_enabled(enabled: bool) -> CmdResult<()> {
    sela_core::hardware::hook::set_enabled(enabled);
    Ok(())
}

#[command]
pub fn wipe_data(state: State<AppState>) -> CmdResult<()> {
    let mut conn = state.conn.lock().unwrap();
    sela_core::db::wipe_all(&mut conn).map_err(arabic)
}

// ────────────────────────────── v58 (الجولة 62): خادم الكاشير LAN

use crate::LanEntry;
use sela_core::lan::LanServer;
use tauri::{AppHandle, Emitter};

#[command]
pub fn lan_start(
    app: AppHandle,
    state: State<AppState>,
    port: u16,
    store_name: String,
) -> CmdResult<bool> {
    // يعمل أصلاً — نجاح صامت.
    {
        let lan = state.lan.lock().unwrap();
        if let Some(entry) = lan.as_ref() {
            if entry.server.port() == port {
                return Ok(true);
            }
        }
    }
    let server = {
        let app_emit = app.clone();
        LanServer::start(port, store_name.clone(), move |req, _responder| {
            // بث فوري للواجهة — المعالجة كلها في TS (LanHandlers)
            // والرد يعود عبر أمر lan_respond.
            let _ = app_emit.emit(
                "lan://request",
                serde_json::json!({
                    "id": req.id,
                    "method": req.method,
                    "path": req.path,
                    "query": req.query,
                    "body": req.body,
                    "auth": req.auth,
                    "ip": req.ip,
                }),
            );
        })
        .map_err(|e| format!("تعذر فتح منفذ الكاشير {}: {}", port, e))?
    };
    let entry = LanEntry {
        server: std::sync::Arc::new(server),
    };
    *state.lan.lock().unwrap() = Some(entry);
    Ok(true)
}

#[command]
pub fn lan_stop(state: State<AppState>) -> CmdResult<bool> {
    let entry = state.lan.lock().unwrap().take();
    if let Some(entry) = entry {
        entry.server.stop();
    }
    Ok(true)
}

#[command]
pub fn lan_status(state: State<AppState>) -> bool {
    state.lan.lock().unwrap().is_some()
}

#[command]
pub fn lan_respond(state: State<AppState>, id: u64, status: u16, body: String) -> CmdResult<()> {
    let lan = state.lan.lock().unwrap();
    if let Some(entry) = lan.as_ref() {
        entry.server.responder().respond(id, status, body);
        Ok(())
    } else {
        Err("خادم الكاشير لا يعمل".into())
    }
}
