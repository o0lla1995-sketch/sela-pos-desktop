/**
 * paths.rs — شجرة %AppData%\sela-pos وفتح قاعدة البيانات.
 * لا يُكتب شيء بجانب الـ exe (Portable-safe).
 */
use crate::Result;
use std::path::{Path, PathBuf};

/// جذر بيانات التطبيق: %APPDATA% على ويندوز،
/// $XDG_DATA_HOME|$HOME/.local/share على لينكس — ثم sela-pos.
/// متغير SELA_POS_HOME يتجاوز الكل (اختبارات/أجهزة محمولة).
pub fn data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("SELA_POS_HOME") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            if !appdata.trim().is_empty() {
                return Path::new(&appdata).join("sela-pos");
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.trim().is_empty() {
                return Path::new(&xdg).join("sela-pos");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.trim().is_empty() {
                return Path::new(&home).join(".local/share/sela-pos");
            }
        }
    }
    PathBuf::from(".sela-pos")
}

pub fn assets_dir() -> PathBuf {
    data_dir().join("assets")
}

pub fn db_path() -> PathBuf {
    data_dir().join("sela.db")
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

/// ينشئ الشجرة كاملة (بيانات/أصول) — آمن للتكرار.
pub fn ensure_dirs() -> Result<PathBuf> {
    let root = data_dir();
    std::fs::create_dir_all(&root)?;
    std::fs::create_dir_all(assets_dir())?;
    Ok(root)
}
