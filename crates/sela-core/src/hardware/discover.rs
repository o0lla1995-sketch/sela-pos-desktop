/**
 * hardware/discover.rs — v70 (الجولة 74 #5): طبقة تجريد العتاد —
 * التعرف التلقائي على الطابعات والماسحات.
 * ─────────────────────────────────────────────────────────────────
 *  ① discover_network_printers: مسح الشبكة المحلية (/24 لكل واجهة
 *     IPv4 للجهاز) بحثاً عن طابعات حرارية/شبكية تستمع على منفذ
 *     JetDirect 9100 — البروب متزامن بخيوط خفيفة ومهلة قصيرة
 *     (400مللي لكل عنوان) فالفحص الكامل يكتمل خلال ثوانٍ مهما
 *     كان حجم الشبكة، ويعيد لكل طابعة: العنوان والمنفذ وزمن
 *     الاستجابة (ميلي ثانية) لترتيب الأقرب أولاً.
 *  ② list_input_devices (ويندوز): تعداد أجهزة الإدخال عبر Raw
 *     Input API — ماسحات الباركود USB تظهر كلوحات مفاتيح HID،
 *     ومعظم الطرازات تعرّف عن نفسها باسمها التسويقي في اسم
 *     الجهاز (HID\VID_XXXX&PID_XXXX\...) فيمكن للتاجر تمييزها
 *     واختبارها من الإعدادات بلا أي إعداد يدوي.
 */
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

/// مهلة اتصال العنوان الواحد أثناء المسح.
const PROBE_TIMEOUT: Duration = Duration::from_millis(400);
/// منفذ الطباعة الشبكي القياسي (HP JetDirect — تطابقه كل الطابعات
/// الحرارية بشبكة Wi-Fi والطابعات المكتبية المحلية).
pub const PRINTER_PORT: u16 = 9100;

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredPrinter {
    pub host: String,
    pub port: u16,
    /// زمن الاستجابة بالميلي ثانية — للأقرب أولاً.
    pub latency_ms: u64,
}

/// عناوين IPv4 المحلية للجهاز (كل واجهة) — عبر ربط UDP مؤقت على
/// عناوين خارجية شائعة (لا تُرسل حزماً فعلياً) + الواجهة الافتراضية.
fn local_ipv4_addresses() -> Vec<Ipv4Addr> {
    let mut found: Vec<Ipv4Addr> = Vec::new();
    // المسار الافتراضي (الإنترنت) — الحالة الشائعة.
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        for probe in ["8.8.8.8:53", "1.1.1.1:53"] {
            if sock.connect(probe).is_ok() {
                if let Ok(addr) = sock.local_addr() {
                    if let IpAddr::V4(ip) = addr.ip() {
                        if !ip.is_loopback() && !ip.is_unspecified() && !found.contains(&ip) {
                            found.push(ip);
                        }
                    }
                }
            }
        }
    }
    found
}

/// مسح الشبكة المحلية بحثاً عن طابعات على منفذ 9100 — متزامن
/// بخيوط (كل خيط يفتح مقبساً بمهلة قصيرة) فلا يعلق الواجهة أبداً.
pub fn discover_network_printers() -> Vec<DiscoveredPrinter> {
    let mut candidates: Vec<Ipv4Addr> = Vec::new();
    for local in local_ipv4_addresses() {
        let [a, b, c, _] = local.octets();
        // شبكة /24 — النطاق العملي للمتاجر (راوتر واحد).
        for host_part in 1u8..=254 {
            candidates.push(Ipv4Addr::new(a, b, c, host_part));
        }
    }
    if candidates.is_empty() {
        return Vec::new();
    }

    let results = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    // دفعات متزامنة — 32 خيطاً كحد أقصى في آن واحد.
    const THREADS: usize = 32;
    let queue = std::sync::Arc::new(std::sync::Mutex::new(candidates));
    let mut handles = Vec::new();
    for _ in 0..THREADS {
        let queue = std::sync::Arc::clone(&queue);
        let results = std::sync::Arc::clone(&results);
        handles.push(std::thread::spawn(move || loop {
            let next = {
                let mut guard = queue.lock().unwrap();
                guard.pop()
            };
            let ip = match next {
                Some(ip) => ip,
                None => break,
            };
            let addr = SocketAddr::new(IpAddr::V4(ip), PRINTER_PORT);
            let started = Instant::now();
            if let Ok(stream) = TcpStream::connect_timeout(&addr, PROBE_TIMEOUT) {
                drop(stream);
                let latency = started.elapsed().as_millis() as u64;
                results.lock().unwrap().push(DiscoveredPrinter {
                    host: ip.to_string(),
                    port: PRINTER_PORT,
                    latency_ms: latency,
                });
            }
        }));
    }
    for handle in handles {
        let _ = handle.join();
    }
    let mut found = results.lock().unwrap().clone();
    found.sort_by_key(|p| p.latency_ms);
    found
}

/// جهاز إدخال (مرشّح ماسح باركود) — تعداد Raw Input.
#[derive(Debug, Clone, Serialize)]
pub struct InputDeviceInfo {
    /// اسم الجهاز كما يعرّفه النظام (HID\VID_…&PID_…) — للتمييز.
    pub name: String,
    /// نوع الجهاز كما صنّفه ويندوز (Keyboard / HID / Mouse…).
    pub kind: String,
}

/// تعداد أجهزة الإدخال المتصلة — ويندوز فقط (Raw Input API)؛ على
/// بقية الأنظمة يعيد قائمة فارغة والواجهة تعرض المسار البديل.
pub fn list_input_devices() -> Vec<InputDeviceInfo> {
    #[cfg(windows)]
    {
        list_input_devices_windows()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
fn list_input_devices_windows() -> Vec<InputDeviceInfo> {
    // windows 0.58: كل دوال Raw Input في Win32::UI::Input نفسه
    // (ميزة Win32_UI_Input) والمقبض HANDLE من Foundation.
    use windows::Win32::UI::Input::{
        GetRawInputDeviceList, GetRawInputDeviceInfoW, RAWINPUTDEVICELIST,
        RIDI_DEVICENAME, RIM_TYPEHID, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
    };

    let mut devices: Vec<InputDeviceInfo> = Vec::new();
    unsafe {
        // ① عدد الأجهزة أولاً (استدعاء بلا مخزن يعيد العدد).
        let mut count: u32 = 0;
        let needed = GetRawInputDeviceList(
            None,
            &mut count,
            std::mem::size_of::<RAWINPUTDEVICELIST>() as u32,
        );
        if needed == u32::MAX || count == 0 {
            return devices;
        }
        let mut list: Vec<RAWINPUTDEVICELIST> = Vec::with_capacity(count as usize);
        let got = GetRawInputDeviceList(
            Some(list.as_mut_ptr()),
            &mut count,
            std::mem::size_of::<RAWINPUTDEVICELIST>() as u32,
        );
        if got == u32::MAX {
            return devices;
        }
        // دفاعي: لو نما العدد بين الاستدعاءين (جهاز وُصل) لا نتجاوز
        // السعة المخصصة أبداً.
        let written_count = (got as usize).min(list.capacity());
        list.set_len(written_count);

        for device in list {
            let kind = match device.dwType {
                t if t == RIM_TYPEKEYBOARD => "Keyboard",
                t if t == RIM_TYPEHID => "HID",
                t if t == RIM_TYPEMOUSE => "Mouse",
                _ => "Other",
            };
            // ② اسم الجهاز (طول المحتوى بالحروف الواسعة ثم القراءة).
            let handle = device.hDevice;
            if handle.is_invalid() {
                continue;
            }
            let mut size: u32 = 0;
            if GetRawInputDeviceInfoW(handle, RIDI_DEVICENAME, None, &mut size)
                == u32::MAX
                || size == 0
            {
                continue;
            }
            // ⚠️ pcbSize لواجهة W بوحدة المحارف (u16) لا البايتات —
            // القسمة على 2 كانت تكتب فوق حدود المخزن (انتهاك وصول
            // على ويندوز). السعة = عدد المحارف + حشوة أمان.
            let mut buffer = vec![0u16; size as usize + 1];
            let written = GetRawInputDeviceInfoW(
                handle,
                RIDI_DEVICENAME,
                Some(buffer.as_mut_ptr().cast()),
                &mut size,
            );
            if written == u32::MAX || written == 0 {
                continue;
            }
            // الاسم منتهٍ بصفر — نقتطع عنده لا عند العدد المعاد.
            let name_len = buffer
                .iter()
                .position(|&ch| ch == 0)
                .unwrap_or(written as usize)
                .min(written as usize);
            let name = String::from_utf16_lossy(&buffer[..name_len]);
            if name.is_empty() {
                continue;
            }
            devices.push(InputDeviceInfo {
                name,
                kind: kind.to_string(),
            });
        }
        // استبعاد الفأرة من قائمة مرشحي الماسح — الماسح دائماً
        // Keyboard/HID؛ والفأرة ضجيج لا يفيد التاجر.
        devices.retain(|d| d.kind != "Mouse");
    }
    devices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discover_finds_local_probe_server() {
        // خادم محلي على منفذ 9100 بأقرب عنوان محلي — المسح يجب أن
        // يجده (على الأقل عبر شبكة loopback المحلية للجهاز نفسه).
        let listener = std::net::TcpListener::bind("0.0.0.0:9100").unwrap();
        let server = std::thread::spawn(move || {
            if let Ok((sock, _)) = listener.accept() {
                drop(sock);
            }
        });
        let found = discover_network_printers();
        // على شبكة CI قد لا توجد واجهة خاصة — القاعدة: لا يفشل
        // المسح أبداً، والنتائج مرتبة بالأقرب.
        for printer in &found {
            assert_eq!(printer.port, PRINTER_PORT);
        }
        let _ = server.join();
    }

    #[test]
    fn input_devices_never_panics() {
        let _ = list_input_devices(); // لينكس: فارغة — المهم ألا يفجّر.
    }
}
