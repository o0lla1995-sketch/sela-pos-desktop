/**
 * config.rs — خزّن المفاتيح (بديل MMKV) في config.json.
 * أسماء المفاتيح نفسها المستخدمة في storage.ts الأندرويد،
 * حتى تُستورد نسخة أندرويد الاحتياطية وتُطبَّق مباشرة.
 */
use crate::Result;
use serde_json::{Map, Value};
use std::path::PathBuf;

pub struct ConfigStore {
    path: PathBuf,
    cache: Map<String, Value>,
}

impl ConfigStore {
    pub fn open(path: PathBuf) -> Result<Self> {
        let cache = if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            match serde_json::from_str::<Value>(&raw) {
                Ok(Value::Object(map)) => map,
                _ => Map::new(),
            }
        } else {
            Map::new()
        };
        Ok(ConfigStore { path, cache })
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.cache.get(key)
    }

    pub fn get_or(&self, key: &str, fallback: Value) -> Value {
        self.cache.get(key).cloned().unwrap_or(fallback)
    }

    pub fn set(&mut self, key: &str, value: Value) -> Result<()> {
        self.cache.insert(key.to_string(), value);
        self.flush()
    }

    pub fn remove(&mut self, key: &str) -> Result<()> {
        self.cache.remove(key);
        self.flush()
    }

    /// الخريطة كاملة (تحميل المرآة في الواجهة عند الإقلاع).
    pub fn all(&self) -> Map<String, Value> {
        self.cache.clone()
    }

    pub fn flush(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&Value::Object(self.cache.clone()))?;
        std::fs::write(&self.path, json)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn set_get_roundtrip_and_persistence() {
        let dir = std::env::temp_dir().join(format!("sela-cfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        {
            let mut store = ConfigStore::open(path.clone()).unwrap();
            store.set("invoice_counter_v1", json!(7)).unwrap();
            store.set("settings_json_v1", json!({"storeName": "متجر sela"})).unwrap();
        }
        {
            let store = ConfigStore::open(path.clone()).unwrap();
            assert_eq!(store.get("invoice_counter_v1"), Some(&json!(7)));
            assert_eq!(
                store.get("settings_json_v1").and_then(|v| v.get("storeName")),
                Some(&json!("متجر sela"))
            );
            assert_eq!(store.get("absent_key"), None);
        }
    }
}
