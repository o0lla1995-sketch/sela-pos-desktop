/**
 * escpos.rs — مرمّز عمليات ESC/POS (منقول بايتاً ببايت من
 * ThermalPrinterModule.kt في أندرويد — نفس المتتاليات نفسها):
 *
 *   init      → 1B 40                     ESC @
 *   codepage  → 1B 74 <page>              ESC t (47=CP1256، 45=CP864، 0=US-ASCII)
 *   align     → 1B 61 <0|1|2>             ESC a
 *   bold      → 1B 45 <0|1>               ESC E
 *   size      → 1D 21 <(h<<4)|w>          GS ! (نفس معادلة كوتلن)
 *   text      → بايتات بالترميز الحالي (محرف غير قابل للتمثيل → '?' كما في Java REPLACE)
 *   feed      → 1B 64 <lines 0..255>      ESC d
 *   cut       → 1D 56 42 00               GS V 66 0 (قص جزئي مع تغذية)
 *   rawBase64 → فك base64 وكتابة الخام
 *   image     → GS v 0 (m=0) + Floyd-Steinberg عتبة 160 (كما في buildRaster)
 *               مع توسيط ESC $ بإزاحة بايتية مقربة مثلثاً لأسفل مثل كوتلن
 */
use crate::codepages::{CP1256_HIGH, CP864_HIGH};
use crate::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

/// عملية واحدة — نفس EscPosOp في nativeBridge.ts.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EscPosOp {
    pub op: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub max_width: Option<i64>,
    #[serde(default)]
    pub center: Option<bool>,
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub align: Option<i64>,
    #[serde(default)]
    pub on: Option<bool>,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default)]
    pub lines: Option<i64>,
    /** حجم وحدة رمز QR للعملية qr (الافتراضي 6). */
    #[serde(default)]
    pub module_size: Option<i64>,
}

/// 0=US-ASCII، 45=IBM864، 47=Windows-1256 — نفس خريطة كوتلن.
pub fn charset_name_for_page(page: i64) -> Option<&'static str> {
    match page {
        0 => Some("US-ASCII"),
        45 => Some("IBM864"),
        47 => Some("windows-1256"),
        _ => None,
    }
}

/// خريطة عكسية: نقطة يونيكود → بايت الترميز (0x80..0xFF).
fn reverse_table(high: &[u16; 128]) -> HashMap<u16, u8> {
    let mut map = HashMap::with_capacity(128);
    for (i, cp) in high.iter().enumerate() {
        map.insert(*cp, 0x80 + i as u8);
    }
    map
}

fn cp1256_reverse() -> &'static HashMap<u16, u8> {
    static TABLE: OnceLock<HashMap<u16, u8>> = OnceLock::new();
    TABLE.get_or_init(|| reverse_table(&CP1256_HIGH))
}

fn cp864_reverse() -> &'static HashMap<u16, u8> {
    static TABLE: OnceLock<HashMap<u16, u8>> = OnceLock::new();
    TABLE.get_or_init(|| reverse_table(&CP864_HIGH))
}

/// ترميز نص إلى بايتات بترميز الصفحة المحدد.
/// المحارف غير القابلة للتمثيل → '?' (سلوك String.getBytes(charset) في جافا
/// مع سياسة REPLACE الافتراضية — نفس ما كان يحدث على الأندرويد).
pub fn encode_text(text: &str, page: i64) -> Result<Vec<u8>> {
    if charset_name_for_page(page).is_none() {
        return Err(crate::SelaError::msg(format!(
            "ترميز الصفحة {page} غير مدعوم — استخدم 0 أو 45 أو 47"
        )));
    }
    let table: Option<&HashMap<u16, u8>> = match page {
        47 => Some(cp1256_reverse()),
        45 => Some(cp864_reverse()),
        _ => None,
    };
    let mut out = Vec::with_capacity(text.len());
    for ch in text.chars() {
        let cp = ch as u32;
        if cp < 0x80 {
            // ASCII مشترك بين الصفحات الثلاث.
            out.push(cp as u8);
        } else if let Some(map) = table {
            match map.get(&(cp as u16)) {
                Some(byte) => out.push(*byte),
                None => out.push(b'?'),
            }
        } else {
            // US-ASCII: كل ما فوق 127 غير قابل للتمثيل.
            out.push(b'?');
        }
    }
    Ok(out)
}

/// نتيجة الصورة النقطية: (بايتات GS v 0، عرض البكسل المطبوع).
pub fn build_raster(path: &str, max_width: i64) -> Result<(Vec<u8>, i64)> {
    let max_width = max_width.clamp(64, 576) as u32;
    let img = image::open(path)
        .map_err(|_| crate::SelaError::msg(format!("تعذر فتح الصورة {path}")))?;
    let rgb = img.to_rgb8();
    let (w0, h0) = (rgb.width(), rgb.height());
    if w0 == 0 || h0 == 0 {
        return Err(crate::SelaError::msg("صورة فارغة"));
    }
    // نفس قياس كوتلن: scale = min(1, maxWidth/w)، بلا تكبير أبداً.
    let scale = (max_width as f32) / (w0 as f32);
    let scale = if scale > 1.0 { 1.0 } else { scale };
    let w = ((w0 as f32 * scale) as i64).max(1) as u32;
    let h = ((h0 as f32 * scale) as i64).max(1) as u32;

    // إعادة أخذ العينات (أقرب جار) — كافٍ لختم الشعار.
    let (bytes_per_row, mut bytes) = raster_from_pixels(&rgb, w, h, w0, h0)?;

    let mut out = Vec::with_capacity(8 + bytes.len());
    out.extend_from_slice(&[0x1D, 0x76, 0x30, 0x00]);
    out.push((bytes_per_row & 0xFF) as u8);
    out.push(((bytes_per_row >> 8) & 0xFF) as u8);
    out.push((h & 0xFF) as u8);
    out.push(((h >> 8) & 0xFF) as u8);
    out.append(&mut bytes);
    Ok((out, w as i64))
}

/// لمعان + Floyd-Steinberg عتبة 160 — نفس خوارزمية buildRaster حرفياً
/// (ink = lum < 160، الخطأ = ink ? old : old-255، توزيع 7/16/3/16/5/16/1/16).
fn raster_from_pixels(
    rgb: &image::RgbImage,
    w: u32,
    h: u32,
    w0: u32,
    h0: u32,
) -> Result<(u32, Vec<u8>)> {
    let sample = |x: u32, y: u32| -> [u8; 3] {
        let sx = ((x as u64 * (w0 - 1) as u64) / (w.max(1) - 1) as u64).min((w0 - 1) as u64) as u32;
        let sy = ((y as u64 * (h0 - 1) as u64) / (h.max(1) - 1) as u64).min((h0 - 1) as u64) as u32;
        let p = rgb.get_pixel(sx.min(w0 - 1), sy.min(h0 - 1));
        [p[0], p[1], p[2]]
    };

    let w = w.max(1) as usize;
    let h = h.max(1) as usize;
    let mut lum = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let [r, g, b] = sample(x as u32, y as u32);
            lum[y * w + x] = 0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32;
        }
    }
    let threshold = 160f32;
    let mut ink = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let old = lum[i].clamp(0.0, 255.0);
            let is_ink = old < threshold;
            ink[i] = is_ink;
            let err = if is_ink { old } else { old - 255.0 };
            let f = err / 16.0;
            if x + 1 < w {
                lum[i + 1] += f * 7.0;
            }
            if y + 1 < h {
                if x > 0 {
                    lum[i + w - 1] += f * 3.0;
                }
                lum[i + w] += f * 5.0;
                if x + 1 < w {
                    lum[i + w + 1] += f;
                }
            }
        }
    }
    let bytes_per_row = ((w + 7) / 8) as u32;
    let mut bytes = vec![0u8; (bytes_per_row as usize) * h];
    for y in 0..h {
        for x in 0..w {
            if ink[y * w + x] {
                bytes[y * bytes_per_row as usize + x / 8] |= 0x80 >> (x % 8);
            }
        }
    }
    let _ = w0;
    Ok((bytes_per_row, bytes))
}

/// يرمّز قائمة عمليات إلى بايتات خام — نفس تنفيذ printJob كوتلن
/// بنفس الترتيب (مع تخطي الصورة إذا كان الملف مفقوداً — سلوك كوتلن
/// يعيد null ويتجاهلها).
pub fn encode_job(ops: &[EscPosOp]) -> Result<Vec<u8>> {
    use base64::Engine;
    let mut buffer: Vec<u8> = Vec::with_capacity(512);
    let mut page = 0i64;
    for op in ops {
        match op.op.as_str() {
            "init" => buffer.extend_from_slice(&[0x1B, 0x40]),
            "codepage" => {
                let p = op.page.unwrap_or(0);
                if charset_name_for_page(p).is_none() {
                    return Err(crate::SelaError::msg(format!(
                        "ترميز الصفحة {p} غير مدعوم — استخدم 0 أو 45 أو 47"
                    )));
                }
                page = p;
                buffer.extend_from_slice(&[0x1B, 0x74, p as u8]);
            }
            "align" => {
                let v = op.align.unwrap_or(0).clamp(0, 2);
                buffer.extend_from_slice(&[0x1B, 0x61, v as u8]);
            }
            "bold" => {
                buffer.extend_from_slice(&[0x1B, 0x45, if op.on.unwrap_or(false) { 1 } else { 0 }]);
            }
            "size" => {
                let w = op.width.unwrap_or(0).clamp(0, 15);
                let h = op.height.unwrap_or(0).clamp(0, 15);
                let n = ((h & 0x0F) << 4) | (w & 0x0F);
                buffer.extend_from_slice(&[0x1D, 0x21, n as u8]);
            }
            "text" => {
                let text = op.value.as_deref().unwrap_or("");
                buffer.extend_from_slice(&encode_text(text, page)?);
            }
            "feed" => {
                let lines = op.lines.unwrap_or(1).clamp(0, 255);
                buffer.extend_from_slice(&[0x1B, 0x64, lines as u8]);
            }
            "cut" => buffer.extend_from_slice(&[0x1D, 0x56, 0x42, 0x00]),
            "barcode128" => {
                // ملصق باركود GS k CODE128 (§3.3 إضافة مكتبية).
                let data = op.value.as_deref().unwrap_or("");
                if !data.is_empty() {
                    buffer.extend_from_slice(&barcode_128_bytes(data, op.height.unwrap_or(60)));
                }
            }
            "qr" => {
                // رمز QR حراري (GS ( k نموذج 2) — إضافة مكتبية §2.ب.
                let data = op.value.as_deref().unwrap_or("");
                if !data.is_empty() {
                    buffer.extend_from_slice(&qr_bytes(data, op.module_size.unwrap_or(6)));
                }
            }
            "rawBase64" => {
                let b64 = op.value.as_deref().unwrap_or("");
                if !b64.is_empty() {
                    let raw = base64::engine::general_purpose::STANDARD
                        .decode(b64)
                        .map_err(|_| crate::SelaError::msg("قيمة rawBase64 غير صالحة"))?;
                    buffer.extend_from_slice(&raw);
                }
            }
            "image" => {
                let path = op.path.as_deref().unwrap_or("");
                let max_width = op.max_width.unwrap_or(384);
                let center = op.center.unwrap_or(true);
                if !path.is_empty() {
                    if let Ok((raster, printed_w)) = build_raster(path, max_width) {
                        if center && printed_w < max_width {
                            // ESC $ بإزاحة مقربة لأسفل إلى حد بايت — مثل كوتلن.
                            let byte_offset = (((max_width - printed_w) / 2) / 8) * 8;
                            buffer.extend_from_slice(&[
                                0x1B, 0x24,
                                (byte_offset & 0xFF) as u8,
                                ((byte_offset >> 8) & 0xFF) as u8,
                            ]);
                        }
                        buffer.extend_from_slice(&raster);
                        buffer.extend_from_slice(&[0x1B, 0x24, 0x00, 0x00]);
                    }
                }
            }
            other => {
                return Err(crate::SelaError::msg(format!("عملية ESC/POS غير معروفة: {other}")));
            }
        }
    }
    Ok(buffer)
}

/// نبضة فتح درج النقدية ESC p (مقبس RJ11 عبر الطابعة):
/// m=0 (الدبوس 2)، t1=0x19، t2=0xFA — متتالية قياسية موثوقة.
pub fn drawer_kick_bytes() -> Vec<u8> {
    vec![0x1B, 0x70, 0x00, 0x19, 0xFA]
}

/// أمر باركود GS k CODE128 (الوضع B) لملصقات المنتجات — إضافة مكتبية.
pub fn barcode_128_bytes(data: &str, height: i64) -> Vec<u8> {
    let h = height.clamp(1, 255) as u8;
    let mut out = Vec::with_capacity(data.len() + 16);
    out.extend_from_slice(&[0x1D, 0x68, h]); // GS h <height>
    out.extend_from_slice(&[0x1D, 0x6B, 0x02]); // GS k — CODE B
    out.push(data.len() as u8);
    out.extend_from_slice(data.as_bytes());
    out
}

/// أمر QR (GS ( k — نموذج 2): بيانات + طباعة.
pub fn qr_bytes(data: &str, module_size: i64) -> Vec<u8> {
    let payload = data.as_bytes();
    let len = payload.len();
    let mut out = Vec::with_capacity(len + 20);
    // 1) تحديد النموذج: GS ( k pL pH cn fn n1 n2 — model 2/2
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, module_size.clamp(1, 16) as u8]);
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]); // مستوى تصحيح M
    // 2) البيانات: GS ( k pL pH cn fn m d1..dk
    let pl = (len + 3) as u8;
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, pl, 0x00, 0x31, 0x50, 0x30]);
    out.extend_from_slice(payload);
    // 3) الطباعة
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;

    fn op(kind: &str) -> EscPosOp {
        EscPosOp {
            op: kind.to_string(),
            value: None, path: None, max_width: None, center: None,
            page: None, align: None, on: None, width: None, height: None, lines: None,
            module_size: None,
        }
    }

    #[test]
    fn byte_sequences_match_kotlin() {
        let mut ops = vec![op("init")];
        // codepage 47 + نص عربي + محاذاة يمين + غامق + حجم مزدوج
        let mut cp = op("codepage"); cp.page = Some(47);
        ops.push(cp);
        let mut al = op("align"); al.align = Some(2);
        ops.push(al);
        let mut b = op("bold"); b.on = Some(true);
        ops.push(b);
        let mut sz = op("size"); sz.width = Some(1); sz.height = Some(1);
        ops.push(sz);
        let mut tx = op("text"); tx.value = Some("سيلا".into());
        ops.push(tx);
        let mut fd = op("feed"); fd.lines = Some(3);
        ops.push(fd);
        ops.push(op("cut"));

        let bytes = encode_job(&ops).unwrap();
        assert_eq!(&bytes[0..2], &[0x1B, 0x40], "ESC @");
        assert_eq!(&bytes[2..5], &[0x1B, 0x74, 47], "ESC t 47 (CP1256)");
        assert_eq!(&bytes[5..8], &[0x1B, 0x61, 2], "ESC a 2 (يمين)");
        assert_eq!(&bytes[8..11], &[0x1B, 0x45, 1], "ESC E 1");
        assert_eq!(&bytes[11..14], &[0x1D, 0x21, 0x11], "GS ! — نفس معادلة كوتلن حرفياً ((h<<4)|w) بالبتّين");
        // «سيلا» في CP1256: س=0xD3، ي=0xED، ل=0xE1، ا=0xC7
        let expect: [u8; 4] = [0xD3, 0xED, 0xE1, 0xC7];
        assert_eq!(&bytes[14..18], &expect, "ترميز CP1256 للنص العربي");
        assert_eq!(&bytes[18..21], &[0x1B, 0x64, 3], "ESC d 3");
        assert_eq!(&bytes[21..25], &[0x1D, 0x56, 0x42, 0x00], "القص GS V 66 0");
    }

    #[test]
    fn arabic_cp1256_encoding() {
        // مطابقة جافا/أندرويد: "شوكولاتة بالحليب" → بايتات windows-1256
        // (القيم المرجعية مستخرجة من جدول Unicode الرسمي، لا من الذاكرة)
        let text = "شوكولاتة بالحليب";
        let bytes = encode_text(text, 47).unwrap();
        let expect: Vec<u8> = vec![
            0xD4, 0xE6, 0xDF, 0xE6, 0xE1, 0xC7, 0xCA, 0xC9, // شوكولاتة
            0x20, //
            0xC8, 0xC7, 0xE1, 0xCD, 0xE1, 0xED, 0xC8, // بالحليب
        ];
        assert_eq!(bytes, expect);
        // عكسه يُفك صحيحاً
        let mut back = String::new();
        for b in &bytes {
            if *b < 0x80 {
                back.push(*b as char);
            } else {
                let code = CP1256_HIGH[(*b as usize) - 0x80];
                back.push(char::from_u32(code as u32).unwrap());
            }
        }
        assert_eq!(back, text, "دورة الترميز كاملة");
    }

    #[test]
    fn ascii_page_and_unmappable() {
        let bytes = encode_text("TOTAL 45.00", 0).unwrap();
        assert_eq!(bytes, b"TOTAL 45.00".to_vec());
        // عربي في صفحة ASCII → علامات استفهام (سلوك جافا REPLACE)
        let bytes2 = encode_text("عربي", 0).unwrap();
        assert_eq!(bytes2, vec![b'?', b'?', b'?', b'?']);
    }

    #[test]
    fn raw_base64_passthrough() {
        let mut raw = op("rawBase64");
        raw.value = Some(base64::engine::general_purpose::STANDARD.encode(&[0x1B, 0x70, 0x00]));
        let bytes = encode_job(&[raw]).unwrap();
        assert_eq!(bytes, vec![0x1B, 0x70, 0x00]);
    }

    #[test]
    fn raster_dither_on_synthetic_logo() {
        // صورة 16×8: النصف الأيسل أسود (حبر) والأيمن أبيض —
        // يجب أن تنتج بكسلات حبر في الجانب الأيسر بعد الترميز.
        let dir = std::env::temp_dir().join(format!("sela-escpos-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("logo.png");
        let img = image::RgbImage::new(16, 8);
        let mut img = img;
        for y in 0..8 {
            for x in 0..16 {
                let v = if x < 8 { 0u8 } else { 255u8 };
                img.put_pixel(x, y, image::Rgb([v, v, v]));
            }
        }
        img.save(&path).unwrap();
        let (raster, printed_w) = build_raster(path.to_str().unwrap(), 384).unwrap();
        assert_eq!(printed_w, 16, "لا تكبير — العرض كما هو");
        assert_eq!(&raster[0..4], &[0x1D, 0x76, 0x30, 0x00]);
        // bytesPerRow = 2، السطر الأول: النصف الأيسر حبر → 0b11110000
        assert_eq!(raster[8], 0xFF, "بايت الصف الأول (8 بكسلات يسارى) حبر كامل");
        assert_eq!(raster[9], 0x00, "النصف الأيمن أبيض");
    }

    #[test]
    fn drawer_and_barcode_commands() {
        assert_eq!(drawer_kick_bytes(), vec![0x1B, 0x70, 0x00, 0x19, 0xFA]);
        let label = barcode_128_bytes("6290123456789", 60);
        assert_eq!(&label[0..3], &[0x1D, 0x68, 60]);
        assert_eq!(&label[3..6], &[0x1D, 0x6B, 0x02]);
        assert_eq!(label[6], 13);
        let qr = qr_bytes("INV-20261015-0001", 6);
        assert_eq!(&qr[0..3], &[0x1D, 0x28, 0x6B]);
    }
}
