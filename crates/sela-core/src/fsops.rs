/**
 * fsops.rs — عمليات ملفات سطح المكتب التي تحتاجها الملفات المنقولة:
 *  • file_exists / file_signature — بصمات صور الكتالوج (OnlineImageSync).
 *  • open_path — فتح ملف/مجلد بالتطبيق الافتراضي للنظام.
 */
use crate::Result;

pub fn file_exists(path: &str) -> bool {
    std::fs::metadata(path).is_ok()
}

/// بصمة الملف: الحجم بالبايت + آخر تعديل بالميلي ثانية — نفس عقد
/// fileSignature الأندرويد (تغيّر الملف يغيّر البصمة).
pub fn file_signature(path: &str) -> Result<String> {
    let meta = std::fs::metadata(path)
        .map_err(|e| crate::SelaError::msg(format!("ملف غير موجود: {e}")))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(format!("{}:{}", meta.len(), modified))
}

/// قراءة ملف ثنائي وإعادته base64 (نسخ صور المنتجات في النسخ الاحتياطي).
pub fn read_file_base64(path: &str) -> Result<String> {
    let bytes = std::fs::read(path)
        .map_err(|e| crate::SelaError::msg(format!("تعذر قراءة الملف: {e}")))?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// كتابة ملف ثنائي من base64 داخل مجلد فرعي من بيانات التطبيق
/// (استعادة الصور) — يعيد المسار الكامل الجديد.
pub fn write_file_base64(subdir: &str, name: &str, b64: &str) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|_| crate::SelaError::msg("بيانات الصورة غير صالحة"))?;
    let dir = crate::paths::data_dir().join(subdir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| crate::SelaError::msg(format!("تعذر إنشاء المجلد: {e}")))?;
    let path = dir.join(name);
    std::fs::write(&path, bytes)
        .map_err(|e| crate::SelaError::msg(format!("تعذر كتابة الصورة: {e}")))?;
    Ok(path.to_string_lossy().to_string())
}

/// فتح مسار بالتطبيق الافتراضي (best-effort، لا يخطئ أبداً).
pub fn open_path(path: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", path])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(path).spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exists_and_signature_work() {
        let dir = std::env::temp_dir().join(format!("sela-fs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.txt");
        std::fs::write(&p, "hello").unwrap();
        let path = p.to_string_lossy().to_string();
        assert!(file_exists(&path));
        assert!(!file_exists(&format!("{path}.missing")));
        let sig = file_signature(&path).unwrap();
        assert!(sig.starts_with("5:"), "الحجم 5 بايت: {sig}");
    }
}
