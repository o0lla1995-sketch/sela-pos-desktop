# قاعدة البيانات ومسارات الملفات (Desktop)

## المسارات (Windows)
| الغرض | المسار |
|---|---|
| جذر التطبيق | `%AppData%\sela-pos\` (`C:\Users\<user>\AppData\Roaming\sela-pos`) |
| قاعدة البيانات | `%AppData%\sela-pos\sela.db` (+ WAL/SHM) |
| الإعدادات/المفاتيح (بديل MMKV) | `%AppData%\sela-pos\config.json` |
| أصول الصور (شعار/صور منتجات) | `%AppData%\sela-pos\assets\` |
| سجل التشخيصات | داخل `config.json` (حلقي، نفس `diagnostics`) |

لا يُكتب شيء بجانب الـ exe (Portable-safe). تُنشأ الشجرة عند أول إقلاع.

## المخطط — SQLite (مطابق حرفياً لـ DDL الأندرويد v3)
الجداول: `categories, units, product_units, stocktakes, stocktake_items, products,
product_embeddings, sales, sale_items` + فهارس `idx_*` نفسها + `PRAGMA journal_mode=WAL;
foreign_keys=ON`. البذور الأولى: 6 تصنيفات عربية، 10 وحدات — بنفس الترتيب.
`created_at` يُكتب **دائماً كتوقيت محلي** `YYYY-MM-DD HH:MM:SS` (قاعدة التقارير).

## config.json — نفس مفاتيح MMKV بأسمائها
```jsonc
{
  "settings_json_v1": { ...AppSettings },   // نفس AppSettings الأندرويد + حقول مكتبية
  "cart_draft_v2": { lines, pricingMode, discount },
  "invoice_counter_v1": 12, "invoice_day_v1": "2026-10-15",
  "saved_printer_v1": { ... },               // قناة مكتبية بدل بلوتوث
  "db_seeded_v1": true, "db_schema_version": 3,
  "notifications_v1": [...], "stock_alert_ledger_v1": { keys: [...] },
  "theme_mode_v1": "dark",
  "license_payload_b64_v1": "...", "license_signature_b64_v1": "...",
  "license_anchor_v1": {...}, "license_last_verify_v1": 0,
  "license_rollback_stikes_v1": 0,            // (اسم أندرويد: license_rollback_strikes_v1)
  "license_server_url_v1": "", "license_device_id_v1": "",
  "license_contact_v1": {...},
  "desktop_printer_v1": { channel: "tcp|serial|spool", host, port, comPort, baud, spoolName, autoCut, kickDrawerOnSale, test... },
  "diagnostics_log_v1": [ ...حلقي ]
}
```
> الإضافات المكتبية فقط: `desktop_printer_v1` + حقول عناوين (window) — كل ما عداه أسماء
> MMKV الأصلية كما هي، ليقرأ ملف نسخة أندرويد الاحتياطية (`settings`) ويُطبَّق مباشرة.

## صيغة النسخة الاحتياطية — JSON v1 (دون أي تغيير)
`{ "app":"sela", "backupVersion":1, createdAt, appVersion, categories[], units[], products[],
product_units[], embeddings[], sales[], sale_items[], stocktakes[], stocktake_items[], settings{} }`
الاستعادة: معاملة واحدة، ترقيم هويات (categories→units→products→product_units→embeddings→
sales→items→stocktakes→items)، إما الكل أو لا شيء — نفس خوارزمية BackupService.ts.
