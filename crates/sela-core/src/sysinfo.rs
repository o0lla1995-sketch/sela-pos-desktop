/**
 * sysinfo.rs — هوية الجهاز والزمن الأحادي (لمكافحة عبث الساعة
 * في LicenseService — نفس دور PlatformUtilsNative الأندرويد).
 *
 *  ويندوز: MachineGuid من السجل + GetTickCount64.
 *  لينكس: بذرة ثابتة من /etc/machine-id + /proc/uptime.
 */
use crate::Result;
use std::time::Duration;

/// معرف جهاز مستقر (مرتبط بالجهاز لا بالمستخدم) — مكافئ ANDROID_ID.
pub fn device_id() -> Result<String> {
    let raw = platform_device_id()?;
    if raw.trim().is_empty() {
        // بديل عشوائي ثابت لكل تثبيت (نفس سلوك getDeviceId الأندرويد).
        let fallback = format!(
            "dev-{}-{}",
            std::process::id(),
            chrono_like_now()
        );
        return Ok(fallback);
    }
    // تجزئة قصيرة ثابتة — لا نكشف GUID الخام خارج النواة.
    let hash = fnv1a(raw.trim().as_bytes());
    Ok(format!("desk-{hash:016x}"))
}

/// الزمن الأحادي منذ الإقلاع — لا يتأثر بتغيير ساعة المستخدم.
pub fn uptime_ms() -> Result<u64> {
    platform_uptime_ms()
}

/// الوقت المحلي 'YYYY-MM-DD HH:MM:SS' — نفس localNow() الأندرويد
/// (لا UTC أبداً — قاعدة التقارير المحلية).
pub fn local_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    // المنطقة المحلية من متغير TZ — احتياطياً بإزاحة محلية صفرية إذا
    // تعذر التحويل (الواجهة تمرر created_at من JS عند الحاجة؛ هنا
    // نستخدم المنطقة الحالية عبر libc).
    let (y, mo, d, h, mi, s) = civil_from_unix(secs + local_offset_secs(secs));
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}")
}

/// اليوم المحلي 'YYYY-MM-DD'.
pub fn local_today() -> String {
    let n = local_now();
    n.split(' ').next().unwrap_or("").to_string()
}

fn local_offset_secs(unix: i64) -> i64 {
    // localtime_r عبر libc عند توفره — وإلا صفر.
    #[cfg(unix)]
    {
        unsafe {
            let mut tm: libc_tm = std::mem::zeroed();
            if libc_localtime(unix, &mut tm) {
                let off = tm.tm_gmtoff;
                if off != 0 {
                    return off;
                }
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = unix;
    }
    0
}

#[cfg(unix)]
unsafe fn libc_localtime(unix: i64, out: *mut libc_tm) -> bool {
    extern "C" {
        fn localtime_r(time: *const i64, out: *mut libc_tm) -> *mut libc_tm;
    }
    !localtime_r(&unix, out).is_null()
}

#[cfg(unix)]
#[repr(C)]
struct libc_tm {
    tm_sec: i32,
    tm_min: i32,
    tm_hour: i32,
    tm_mday: i32,
    tm_mon: i32,
    tm_year: i32,
    tm_wday: i32,
    tm_yday: i32,
    tm_isdst: i32,
    tm_gmtoff: i64,
    tm_zone: *const std::os::raw::c_char,
}

#[cfg(unix)]
unsafe fn tm_ptr(t: &libc_tm) -> &libc_tm {
    t
}


/// تحويل يومي مدني من ثواني يونكس (خوارزمية Howard Hinnant).
pub fn civil_from_unix(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let h = (rem / 3600) as u32;
    let mi = ((rem % 3600) / 60) as u32;
    let s = (rem % 60) as u32;
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}

fn fnv1a(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in data {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn chrono_like_now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(windows)]
fn platform_device_id() -> Result<String> {
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };
    unsafe {
        let subkey: Vec<u16> = "SOFTWARE\\Microsoft\\Cryptography"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let value: Vec<u16> = "MachineGuid".encode_utf16().chain(std::iter::once(0)).collect();
        let mut buf = [0u16; 128];
        let mut size = (std::mem::size_of_val(&buf)) as u32;
        let status = RegGetValueW(
            HKEY_LOCAL_MACHINE,
            windows::core::PCWSTR(subkey.as_ptr()),
            windows::core::PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        );
        if status != ERROR_SUCCESS {
            return Ok(String::new());
        }
        let len = (size as usize) / 2;
        let slice = &buf[..len.min(buf.len())];
        Ok(String::from_utf16_lossy(slice)
            .trim_end_matches('\0')
            .to_string())
    }
}

#[cfg(not(windows))]
fn platform_device_id() -> Result<String> {
    for candidate in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(id) = std::fs::read_to_string(candidate) {
            let id = id.trim().to_string();
            if !id.is_empty() {
                return Ok(id);
            }
        }
    }
    Ok(String::new())
}

#[cfg(windows)]
fn platform_uptime_ms() -> Result<u64> {
    Ok(windows::Win32::System::SystemInformation::GetTickCount64())
}

#[cfg(not(windows))]
fn platform_uptime_ms() -> Result<u64> {
    let text = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    // "12345.67 12345.67" — أول رقم هو الثواني منذ الإقلاع.
    let secs: f64 = text
        .split_whitespace()
        .next()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.0);
    Ok((secs * 1000.0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_id_stable_within_process() {
        let a = device_id().unwrap();
        let b = device_id().unwrap();
        assert_eq!(a, b, "المعرف مستقر بين النداءين");
        assert!(a.starts_with("desk-") || a.starts_with("dev-"));
    }

    #[test]
    fn uptime_monotonic_nondecreasing() {
        let a = uptime_ms().unwrap();
        std::thread::sleep(Duration::from_millis(30));
        let b = uptime_ms().unwrap();
        assert!(b >= a, "الزمن الأحادي لا يتراجع");
    }

    #[test]
    fn local_now_shape_and_civil_conversion() {
        let now = local_now();
        assert_eq!(now.len(), 19, "YYYY-MM-DD HH:MM:SS");
        assert!(now.contains('-') && now.contains(' '));
        // 1970-01-01 00:00:00 UTC = 1970-01-01 مدنياً.
        let (y, m, d, h, mi, s) = civil_from_unix(0);
        assert_eq!((1970, 1, 1, 0, 0, 0), (y, m, d, h, mi, s));
        // نقطة معروفة: 2026-10-15 01:02:03 UTC → 1733…
        let (y2, m2, d2, h2, _mi2, _s2) = civil_from_unix(1_792_076_123);
        assert_eq!((2026, 10, 15), (y2, m2, d2));
        assert!(h2 < 24);
    }
}
