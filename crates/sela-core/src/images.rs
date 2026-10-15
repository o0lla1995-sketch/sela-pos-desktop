/**
 * images.rs — ضغط صور المنتجات لرفعها لمتجر سيلا (نفس عقد
 * ImageDecoderNative.compressToWebP الأندرويد): فك الترميز، تصغير
 * لأقصى بعد مع الحفاظ على النسبة، ترميز JPEG، وبصمة sha256
 * للبايتات الناتجة (أساس منع إعادة الرفع).
 * سطح المكتب يرفع JPEG (الأندرويد يرفع WebP) — الخادم يقبل كليهما.
 */
use crate::Result;
use base64::Engine;
use image::imageops::FilterType;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub fn compress_image(path: &str, max_dim: u32, quality: u8) -> Result<Value> {
    let bytes = std::fs::read(path)?;
    let format = image::guess_format(&bytes)
        .map_err(|e| crate::SelaError::msg(format!("تعذر تمييز نوع الصورة: {e}")))?;
    let img = image::load_from_memory_with_format(&bytes, format)
        .map_err(|e| crate::SelaError::msg(format!("تعذر فتح الصورة: {e}")))?;

    // تصغير لأقصى بعد (نفس سلوك الأندرويد: fit داخل المربع).
    let (w, h) = (img.width(), img.height());
    let (out_w, out_h) = if w.max(h) > max_dim && w.max(h) > 0 {
        if w >= h {
            let nw = max_dim;
            let nh = ((h as f64) * (max_dim as f64) / (w as f64)).round().max(1.0) as u32;
            (nw, nh)
        } else {
            let nh = max_dim;
            let nw = ((w as f64) * (max_dim as f64) / (h as f64)).round().max(1.0) as u32;
            (nw, nh)
        }
    } else {
        (w, h)
    };
    let resized = if (out_w, out_h) != (w, h) {
        img.resize_exact(out_w, out_h, FilterType::Lanczos3)
    } else {
        img
    };

    // ترميز JPEG بالجودة المطلوبة.
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
        encoder
            .encode_image(&resized)
            .map_err(|e| crate::SelaError::msg(format!("تعذر ترميز الصورة: {e}")))?;
    }

    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(&buf);
        format!("{:x}", hasher.finalize())
    };
    let base64 = base64::engine::general_purpose::STANDARD.encode(&buf);

    Ok(json!({
        "base64": base64,
        "hash": hash,
        "ext": "jpg",
        "width": out_w,
        "height": out_h,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_image(w: u32, h: u32) -> String {
        let dir = std::env::temp_dir().join(format!("sela-img-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("t-{w}x{h}.png"));
        let img = image::RgbImage::from_pixel(w, h, image::Rgb([200u8, 30, 30]));
        img.save(&path).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn compresses_large_image_to_max_dim() {
        let path = temp_image(1600, 900);
        let v = compress_image(&path, 512, 80).unwrap();
        assert_eq!(v["width"], json!(512));
        assert_eq!(v["height"], json!(288), "النسبة محفوظة");
        assert_eq!(v["ext"], json!("jpg"));
        let b64 = v["base64"].as_str().unwrap();
        assert!(!b64.is_empty());
        let hash = v["hash"].as_str().unwrap();
        assert_eq!(hash.len(), 64, "sha256 سداسية عشرية");
    }

    #[test]
    fn small_image_keeps_dimensions() {
        let path = temp_image(200, 100);
        let v = compress_image(&path, 1024, 80).unwrap();
        assert_eq!(v["width"], json!(200));
        assert_eq!(v["height"], json!(100));
    }
}
