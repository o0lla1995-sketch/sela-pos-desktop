/**
 * sqlbridge.rs (sela-core) — منطق جسر SQL الخالص: تحويل معاملات JSON
 * إلى SQLite، وقراءة الصفوف ككائنات JSON بنفس شكل op-sqlite
 * (rows/insertId/rowsAffected) الذي كُتبت عليه خدمات أندرويد v57.
 * الاتصالات المعاملاتية (BEGIN IMMEDIATE) تُدار من صندوق src-tauri؛
 * هنا التنفيذ والتحويل القابلان للاختبار المحلي بلا GTK.
 */
use crate::Result;
use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;
use serde_json::{json, Map, Value};

/// JSON → قيمة SQLite (نفس تحويل op-sqlite للمعاملات).
pub fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        // الكائنات/المصفوفات تُخزن نصاً (JSON) — نفس سلوك درايفرات TS.
        other => SqlValue::Text(other.to_string()),
    }
}

fn bind_params<'a>(
    stmt: &'a mut rusqlite::Statement<'_>,
    params: &'a [Value],
) -> std::result::Result<(), String> {
    for (i, p) in params.iter().enumerate() {
        stmt.raw_bind_parameter(i + 1, to_sql(p))
            .map_err(|e| format!("تعذر ربط المعامل {i}: {e}"))?;
    }
    Ok(())
}

/// صف واحد → كائن JSON بأسماء الأعمدة (نفس شكل صفوف op-sqlite).
fn row_to_json(names: &[String], row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let mut obj = Map::with_capacity(names.len());
    for (i, name) in names.iter().enumerate() {
        let v = match row.get_ref(i)? {
            rusqlite::types::ValueRef::Null => Value::Null,
            rusqlite::types::ValueRef::Integer(n) => json!(n),
            rusqlite::types::ValueRef::Real(f) => json!(f),
            rusqlite::types::ValueRef::Text(t) => {
                Value::String(String::from_utf8_lossy(t).to_string())
            }
            rusqlite::types::ValueRef::Blob(b) => Value::String(format!(
                "blob:{}bytes",
                b.len()
            )),
        };
        obj.insert(name.clone(), v);
    }
    Ok(Value::Object(obj))
}

/// تنفيذ على اتصال (auto-commit أو داخل معاملة) — يعيد نفس شكل
/// نتيجة op-sqlite: {rowsAffected, insertId, rows}.
pub fn run_on(
    conn: &mut Connection,
    sql: &str,
    params: &[Value],
) -> std::result::Result<Value, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| format!("خطأ SQL: {e}"))?;
    let has_columns = stmt.column_count() > 0;
    bind_params(&mut stmt, params)?;
    if has_columns {
        // SELECT (أو RETURNING) — اجمع الصفوف.
        let names: Vec<String> = stmt
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut rows: Vec<Value> = Vec::new();
        let mut result = stmt.raw_query();
        while let Some(row) = result.next().map_err(|e| format!("خطأ قراءة: {e}"))? {
            rows.push(row_to_json(&names, &row).map_err(|e| format!("خطأ صف: {e}"))?);
        }
        drop(result);
        drop(stmt);
        let rows_affected = conn.changes() as i64;
        let insert_id: i64 = conn.last_insert_rowid();
        Ok(json!({
            "rowsAffected": rows_affected,
            "insertId": if rows_affected > 0 { Value::from(insert_id) } else { Value::Null },
            "rows": rows,
        }))
    } else {
        let affected = stmt
            .raw_execute()
            .map_err(|e| format!("خطأ تنفيذ: {e}"))? as i64;
        drop(stmt);
        let insert_id: i64 = conn.last_insert_rowid();
        Ok(json!({
            "rowsAffected": affected,
            "insertId": if affected > 0 { Value::from(insert_id) } else { Value::Null },
            "rows": [],
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, qty REAL);
             CREATE TABLE g (id INTEGER PRIMARY KEY AUTOINCREMENT, v INTEGER);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn insert_returns_insert_id_and_rows_affected() {
        let mut conn = mem();
        let r = run_on(
            &mut conn,
            "INSERT INTO t (name, qty) VALUES (?, ?)",
            &[json!("شوكولاتة"), json!(2.5)],
        )
        .unwrap();
        assert_eq!(r["rowsAffected"], json!(1));
        assert_eq!(r["insertId"], json!(1));

        let r2 = run_on(
            &mut conn,
            "INSERT INTO t (name, qty) VALUES (?, ?)",
            &[json!("حلويات"), json!(1)],
        )
        .unwrap();
        assert_eq!(r2["insertId"], json!(2));
    }

    #[test]
    fn select_rows_are_named_objects() {
        let mut conn = mem();
        run_on(&mut conn, "INSERT INTO t (name, qty) VALUES (?, ?)", &[json!("لبن"), json!(3)]).unwrap();
        let r = run_on(&mut conn, "SELECT id, name, qty FROM t WHERE name = ?", &[json!("لبن")])
            .unwrap();
        let rows = r["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], json!("لبن"));
        assert_eq!(rows[0]["qty"], json!(3.0));
        assert_eq!(rows[0]["id"], json!(1));
    }

    #[test]
    fn update_rows_affected_matches_op_sqlite_semantics() {
        let mut conn = mem();
        run_on(&mut conn, "INSERT INTO g (v) VALUES (5)", &[]).unwrap();
        // شرط يفشل → صفر صفوف (نفس حارس البيع الزائد في الأندرويد).
        let miss = run_on(
            &mut conn,
            "UPDATE g SET v = v - ? WHERE id = ? AND v >= ?",
            &[json!(10), json!(1), json!(10)],
        )
        .unwrap();
        assert_eq!(miss["rowsAffected"], json!(0));
        assert!(miss["insertId"].is_null());
        // شرط ينجح → صف واحد.
        let hit = run_on(
            &mut conn,
            "UPDATE g SET v = v - ? WHERE id = ? AND v >= ?",
            &[json!(2), json!(1), json!(2)],
        )
        .unwrap();
        assert_eq!(hit["rowsAffected"], json!(1));
        let check = run_on(&mut conn, "SELECT v FROM g WHERE id = 1", &[]).unwrap();
        assert_eq!(check["rows"][0]["v"], json!(3));
    }

    #[test]
    fn null_and_bool_params_bind_like_typescript() {
        let mut conn = mem();
        conn.execute_batch("CREATE TABLE b (id INTEGER PRIMARY KEY, x INTEGER, y TEXT)")
            .unwrap();
        run_on(
            &mut conn,
            "INSERT INTO b (id, x, y) VALUES (?, ?, ?)",
            &[json!(1), json!(true), json!(null)],
        )
        .unwrap();
        let r = run_on(&mut conn, "SELECT x, y FROM b WHERE id = 1", &[]).unwrap();
        assert_eq!(r["rows"][0]["x"], json!(1));
        assert!(r["rows"][0]["y"].is_null());
    }

    #[test]
    fn transaction_rollback_and_commit_semantics() {
        let mut conn = mem();
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        run_on(&mut conn, "INSERT INTO t (name, qty) VALUES ('أ', 1)", &[]).unwrap();
        conn.execute_batch("ROLLBACK").unwrap();
        let after = run_on(&mut conn, "SELECT COUNT(*) AS c FROM t", &[]).unwrap();
        assert_eq!(after["rows"][0]["c"], json!(0), "التراجع يمحو كل شيء");

        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        run_on(&mut conn, "INSERT INTO t (name, qty) VALUES ('ب', 2)", &[]).unwrap();
        conn.execute_batch("COMMIT").unwrap();
        let after2 = run_on(&mut conn, "SELECT COUNT(*) AS c FROM t", &[]).unwrap();
        assert_eq!(after2["rows"][0]["c"], json!(1), "التثبيت يحفظ كل شيء");
    }

    #[test]
    fn arabic_text_round_trips_untouched() {
        let mut conn = mem();
        let name = "شوكولاتة وحلويات — وقية";
        run_on(&mut conn, "INSERT INTO t (name, qty) VALUES (?, ?)", &[json!(name), json!(1)])
            .unwrap();
        let r = run_on(&mut conn, "SELECT name FROM t", &[]).unwrap();
        assert_eq!(r["rows"][0]["name"], json!(name));
    }
}
