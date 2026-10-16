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

/// عمر جلسة المعاملة قبل اعتبارها مسرّبة (v58): أي معاملة صحية
/// تكتمل خلال أجزاء من الثانية؛ جلسة تتجاوز هذه المدة معناها أن
/// الواجهة سقطت قبل tx_commit/tx_rollback — واتصالها يحتجز قفل
/// الكتابة (BEGIN IMMEDIATE) فيعطل كل الكتابات اللاحقة بخطأ
/// «database is locked». الكنس التلقائي يتراجع عنها ويحرر القفل.
const STALE_TX_AFTER: std::time::Duration = std::time::Duration::from_secs(120);

/// جلسة معاملة حية + لحظة إنشائها (لمرس الكنس التلقائي).
pub struct TxSession {
    pub conn: Connection,
    pub created: std::time::Instant,
}

/// يتراجع عن كل الجلسات المسرّبة ويحرر أقفالها — يُستدعى قبل بدء
/// أي معاملة جديدة (وأي إعادة محاولة بعد «database is locked»).
fn sweep_stale_sessions(state: &AppState) -> usize {
    let mut sessions = state.sessions.lock().unwrap();
    let stale: Vec<u64> = sessions
        .iter()
        .filter(|(_, s)| s.created.elapsed() > STALE_TX_AFTER)
        .map(|(id, _)| *id)
        .collect();
    for id in &stale {
        if let Some(session) = sessions.remove(id) {
            let _ = session.conn.execute_batch("ROLLBACK");
        }
    }
    stale.len()
}

// ──────────────────────────────────────────────── تنفيذ مباشر (auto-commit)

#[command]
pub fn sql_run(state: State<AppState>, sql: String, params: Option<Vec<Value>>) -> CmdResult<Value> {
    let bound = params.unwrap_or_default();
    let mut conn = state.conn.lock().unwrap();
    match sela_core::sqlbridge::run_on(&mut conn, &sql, &bound) {
        Ok(result) => Ok(result),
        Err(message) => {
            // v58: أول «database is locked» يكنس الجلسات المسرّبة
            // (قفل كتابة متروك من معاملة سقطت) ثم يعيد المحاولة
            // مرة واحدة قبل تسليم الخطأ للمستخدم.
            if !message.contains("locked") && !message.contains("busy") {
                return Err(message);
            }
            drop(conn);
            let freed = sweep_stale_sessions(&state);
            let mut conn = state.conn.lock().unwrap();
            match sela_core::sqlbridge::run_on(&mut conn, &sql, &bound) {
                Ok(result) => {
                    if freed > 0 {
                        eprintln!(
                            "[sela] حُرّرت {freed} جلسة معاملة مسرّبة كانت تحتجز قفل الكتابة"
                        );
                    }
                    Ok(result)
                }
                Err(retry) => Err(retry),
            }
        }
    }
}

// ──────────────────────────────────────────────── جلسات المعاملات

#[command]
pub fn tx_begin(state: State<AppState>) -> CmdResult<u64> {
    // v58: قبل أي معاملة جديدة — تحرير أقفال الجلسات المسرّبة.
    sweep_stale_sessions(&state);
    let id = state.next_tx.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let conn = sela_core::db::open_session(&state.db_path)
        .map_err(|e| format!("تعذر فتح جلسة معاملة: {e}"))?;
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("تعذر بدء المعاملة: {e}"))?;
    state.sessions.lock().unwrap().insert(
        id,
        TxSession {
            conn,
            created: std::time::Instant::now(),
        },
    );
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
    let session = sessions
        .get_mut(&tx_id)
        .ok_or_else(|| "المعاملة غير موجودة أو انتهت".to_string())?;
    sela_core::sqlbridge::run_on(&mut session.conn, &sql, &params.unwrap_or_default())
}

#[command]
pub fn tx_commit(state: State<AppState>, tx_id: u64) -> CmdResult<()> {
    let session = state
        .sessions
        .lock()
        .unwrap()
        .remove(&tx_id)
        .ok_or_else(|| "المعاملة غير موجودة أو انتهت".to_string())?;
    session
        .conn
        .execute_batch("COMMIT")
        .map_err(|e| format!("تعذر تثبيت المعاملة: {e}"))
}

#[command]
pub fn tx_rollback(state: State<AppState>, tx_id: u64) -> CmdResult<()> {
    let session = state
        .sessions
        .lock()
        .unwrap()
        .remove(&tx_id)
        .ok_or_else(|| "المعاملة غير موجودة أو انتهت".to_string())?;
    let _ = session.conn.execute_batch("ROLLBACK");
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
/// v59: كتابة ذرّية مقاومة للأعطال — كتابة إلى ملف مؤقت ثم استبدال،
/// وإنشاء المجلد إن حُذف، وتشخيص عربي واضح لكل سبب فشل (قرص
/// منفصل/صلاحيات ويندوز/ملف مقفول من مزامنة سحابية) حتى يعرف
/// التاجر ماذا يفعل بدل «تعذر كتابة الملف» المبهمة.
/// v60 (جذر OS Error 123): الاسم يُعقَّم دائماً قبل الاستخدام —
/// ويندوز يرفض أي اسم يحمل < > : " / \ | ? * أو محارف تحكم
/// بالخطأ 123 (صيغة اسم غير صحيحة)، وكان طابع ISO الزمني من
/// الواجهة يحمل نقطتين فيفشل كل من المسار الرئيسي والاحتياطي.
#[command]
pub fn write_file_in_folder(folder: String, name: String, contents: String) -> CmdResult<String> {
    // تعقيم الاسم: نستبدل كل محرف غير صالح بشرطة بدل رفض العملية
    // كلها — النسخة الاحتياطية أولوية قصوى ولا يجوز ضياعها.
    let sanitized: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || (c as u32) < 0x20
            {
                '-'
            } else {
                c
            }
        })
        .collect();
    let name = sanitized.trim().trim_end_matches('.').to_string();
    if name.is_empty() {
        return Err("اسم ملف النسخة غير صالح".to_string());
    }
    let dir = std::path::PathBuf::from(&folder);
    // القرص/الفلاش انفصل أو المسار حُذف؟ رسالة تشرح السبب والفعل.
    if !dir.is_dir() {
        // ربما حُذف المجلد فقط لكن القرص موجود — نحاول إنشاءه.
        if std::fs::create_dir_all(&dir).is_err() {
            return Err(format!(
                "المجلد غير متاح: «{folder}» — تأكد أن القرص/الفلاش موصول وأن المجلد لم يُحذف، أو اختر مجلداً جديداً من الإعدادات"
            ));
        }
    }
    let path = dir.join(&name);
    let tmp = dir.join(format!("{name}.part"));

    // محاولة 1: كتابة مؤقتة ثم استبدال ذرّي (لا يكسر نسخة قائمة).
    let write_err = match std::fs::write(&tmp, &contents) {
        Ok(()) => match std::fs::rename(&tmp, &path) {
            Ok(()) => return Ok(path.to_string_lossy().to_string()),
            // على ويندوز: الاسم الهدف مفتوح من برنامج آخر (مزامنة
            // سحابية/مضاد فيروسات) — نحاول الكتابة المباشرة.
            Err(e) => format!("{e}"),
        },
        Err(e) => format!("{e}"),
    };

    // محاولة 2: كتابة مباشرة (بعض الأقراص/المزامنات لا تدعم rename).
    if std::fs::write(&path, &contents).is_ok() {
        let _ = std::fs::remove_file(&tmp);
        return Ok(path.to_string_lossy().to_string());
    }
    let _ = std::fs::remove_file(&tmp);

    // محاولة 3: احتياطي دائم — مجلد بيانات التطبيق (مضمون الصلاحية)
    // كي لا تضيع النسخة إن رفض ويندوز الكتابة في مجلد المستخدم
    // (حماية المجلدات من برامج الفدية تحجب أحياناً Documents/Desktop).
    // البادئة FALLBACK: تخبر الواجهة أن الملف لم يصل للمجلد المختار.
    let fallback_dir = sela_core::paths::data_dir().join("backups");
    if std::fs::create_dir_all(&fallback_dir).is_ok() {
        let fallback_path = fallback_dir.join(&name);
        if std::fs::write(&fallback_path, &contents).is_ok() {
            return Ok(format!(
                "FALLBACK:{}",
                fallback_path.to_string_lossy()
            ));
        }
    }

    Err(format!(
        "تعذر كتابة ملف النسخة في «{folder}» ({write_err}). جرّب: اختيار مجلد آخر، أو فتح صلاحية الكتابة لسيلا على هذا المجلد من إعدادات حماية ويندوز، أو تأكد أن الملف ليس مفتوحاً في برنامج آخر"
    ))
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
