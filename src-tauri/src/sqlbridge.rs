/**
 * sqlbridge.rs — صندوق رفيع: أوامر Tauri فوق منطق sela-core::sqlbridge.
 * كل قدرة تمر عبر النواة القابلة للاختبار؛ هنا الأسلاك فقط:
 * جلسات المعاملات (اتصال مخصص لكل معاملة BEGIN IMMEDIATE) وحوارات
 * الملفات (نسخ/تصدير/استيراد/مجلد النسخ التلقائي).
 */
use crate::AppState;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::{command, State};

type CmdResult<T> = Result<T, String>;

// ──────────────────────────────────────────────── تنفيذ مباشر (auto-commit)

#[command]
pub fn sql_run(state: State<AppState>, sql: String, params: Option<Vec<Value>>) -> CmdResult<Value> {
    let mut conn = state.conn.lock().unwrap();
    sela_core::sqlbridge::run_on(&mut conn, &sql, &params.unwrap_or_default())
}

// ──────────────────────────────────────────────── جلسات المعاملات

#[command]
pub fn tx_begin(state: State<AppState>) -> CmdResult<u64> {
    let id = state.next_tx.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let conn = sela_core::db::open_session(&state.db_path)
        .map_err(|e| format!("تعذر فتح جلسة معاملة: {e}"))?;
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("تعذر بدء المعاملة: {e}"))?;
    state.sessions.lock().unwrap().insert(id, conn);
    Ok(id)
}

#[command]
pub fn tx_execute(
    state: State<AppState>,
    tx_id: u64,
    sql: String,
    params: Option<Vec<Value>>,
) -> CmdResult<Value> {
    let mut sessions = state.sessions.lock().unwrap();
    let conn = sessions
        .get_mut(&tx_id)
        .ok_or_else(|| "المعاملة غير موجودة أو انتهت".to_string())?;
    sela_core::sqlbridge::run_on(conn, &sql, &params.unwrap_or_default())
}

#[command]
pub fn tx_commit(state: State<AppState>, tx_id: u64) -> CmdResult<()> {
    let conn = state
        .sessions
        .lock()
        .unwrap()
        .remove(&tx_id)
        .ok_or_else(|| "المعاملة غير موجودة أو انتهت".to_string())?;
    conn.execute_batch("COMMIT")
        .map_err(|e| format!("تعذر تثبيت المعاملة: {e}"))?;
    Ok(())
}

#[command]
pub fn tx_rollback(state: State<AppState>, tx_id: u64) -> CmdResult<()> {
    let conn = state
        .sessions
        .lock()
        .unwrap()
        .remove(&tx_id)
        .ok_or_else(|| "المعاملة غير موجودة أو انتهت".to_string())?;
    let _ = conn.execute_batch("ROLLBACK");
    Ok(())
}

/// عدد الجلسات الحية (تشخيص فقط).
#[command]
pub fn tx_sessions_alive(state: State<AppState>) -> CmdResult<usize> {
    Ok(state.sessions.lock().unwrap().len())
}

// ──────────────────────────────────────────────── ملفات (نسخ/تصدير/استيراد)

/// حوار حفظ أصلي + كتابة نص — لمسار BackupService (النسخة v2).
#[command]
pub fn save_text_file(default_name: String, contents: String) -> CmdResult<String> {
    let picked = rfd::FileDialog::new()
        .set_title("حفظ الملف")
        .set_file_name(&default_name)
        .save_file();
    let path = picked.ok_or_else(|| "أُلغيت عملية الحفظ".to_string())?;
    std::fs::write(&path, contents).map_err(|e| format!("تعذر كتابة الملف: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// حوار فتح أصلي + قراءة نص — للاستعادة.
#[command]
pub fn open_text_file() -> CmdResult<Value> {
    let picked = rfd::FileDialog::new().set_title("اختيار ملف").pick_file();
    let path = picked.ok_or_else(|| "أُلغيت العملية".to_string())?;
    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("تعذر قراءة الملف: {e}"))?;
    Ok(json!({
        "path": path.to_string_lossy(),
        "contents": contents,
    }))
}

/// اختيار مجلد (النسخ التلقائي للمجلد).
#[command]
pub fn pick_folder() -> CmdResult<String> {
    let picked = rfd::FileDialog::new().set_title("اختيار مجلد").pick_folder();
    let path = picked.ok_or_else(|| "أُلغيت العملية".to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// كتابة ملف داخل مجلد (النسخ التلقائي) — يعيد المسار الكامل.
#[command]
pub fn write_file_in_folder(folder: String, name: String, contents: String) -> CmdResult<String> {
    let dir = std::path::PathBuf::from(&folder);
    if !dir.is_dir() {
        return Err("المجلد غير موجود".to_string());
    }
    let path = dir.join(&name);
    std::fs::write(&path, contents).map_err(|e| format!("تعذر كتابة الملف: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

// ──────────────────────────────────────────────── ملفات وصور (جسر nativeBridge)

/// هل الملف موجود؟ (بصمات صور الكتالوج).
#[command]
pub fn fs_file_exists(path: String) -> bool {
    sela_core::fsops::file_exists(&path)
}

/// بصمة الملف (حجم:تعديل) — اكتشاف تغيّر الصور بلا إعادة ضغط.
#[command]
pub fn fs_file_signature(path: String) -> CmdResult<String> {
    sela_core::fsops::file_signature(&path).map_err(|e| e.to_string())
}

/// ضغط صورة منتج للرفع لمتجر سيلا (JPEG + sha256) — نفس عقد
/// ImageDecoderNative.compressToWebP.
#[command]
pub fn image_compress(path: String, max_dim: i64, quality: i64) -> CmdResult<Value> {
    let max = u32::try_from(max_dim.max(1)).unwrap_or(1024);
    let q = u8::try_from(quality.clamp(1, 100)).unwrap_or(80);
    sela_core::images::compress_image(&path, max, q).map_err(|e| e.to_string())
}

/// قراءة ملف ثنائي base64 (صور النسخ الاحتياطي).
#[command]
pub fn fs_read_file_base64(path: String) -> CmdResult<String> {
    sela_core::fsops::read_file_base64(&path).map_err(|e| e.to_string())
}

/// كتابة ملف ثنائي من base64 داخل مجلد بيانات التطبيق (استعادة الصور).
#[command]
pub fn fs_write_file_base64(subdir: String, name: String, data: String) -> CmdResult<String> {
    sela_core::fsops::write_file_base64(&subdir, &name, &data).map_err(|e| e.to_string())
}

/// فتح مسار بالتطبيق الافتراضي للنظام (best-effort).
#[command]
pub fn open_path(path: String) {
    sela_core::fsops::open_path(&path)
}

/// فتح مجلد في مستكشف الملفات واختيار الملف (إن أُعطي).
#[command]
pub fn reveal_in_folder(folder: String) {
    sela_core::fsops::open_path(&folder)
}
