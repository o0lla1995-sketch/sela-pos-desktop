/**
 * hardware.rs — طبقة عتاد سطح المكتب (استبدال بلوتوث الأندرويد):
 *
 *  • القنوات: TCP 9100 / تسلسلي COM / WinSpool RAW (USB عبر مشغّل ويندوز).
 *  • الطباعة صامتة مباشرة (بلا حوارات) بحد أقصى 1024 بايت للدفعة —
 *    نفس CHUNK_SIZE في ThermalPrinterModule.kt.
 *  • درج النقدية: نبضة ESC p عبر الطابعة نفسها.
 *  • قائمة المنافذ التسلسلية والطابعات المثبتة من النظام.
 *
 *  الخطاف العام لقارئ الباركود (WH_KEYBOARD_LL) في hook.rs —
 *  على لينكس يبقى معطلاً وتعتمد الواجهة على مستمع JS الداخلي.
 */
use crate::escpos;
use crate::Result;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// إعدادات القناة — saved_printer_v1 المكتبية.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "channel", rename_all = "lowercase")]
pub enum PrinterChannel {
    None,
    Tcp {
        host: String,
        port: u16,
    },
    Serial {
        /// يقبل comPort (شكل واجهة الإعدادات) وcom_port معاً.
        #[serde(default, alias = "comPort", alias = "com_port")]
        com_port: String,
        baud: u32,
    },
    Spool {
        /// يقبل spoolName وprinter_name معاً.
        #[serde(default, alias = "spoolName", alias = "printer_name")]
        printer_name: String,
    },
}

impl Default for PrinterChannel {
    fn default() -> Self {
        PrinterChannel::None
    }
}

impl PrinterChannel {
    pub fn describe(&self) -> String {
        match self {
            PrinterChannel::None => "غير مربوطة".into(),
            PrinterChannel::Tcp { host, port } => format!("شبكة {host}:{port}"),
            PrinterChannel::Serial { com_port, baud } => format!("تسلسلي {com_port}@{baud}"),
            PrinterChannel::Spool { printer_name } => format!("USB/Spool {printer_name}"),
        }
    }
}

pub const CHUNK_SIZE: usize = 1024;

/// يكتب بايتات إلى القناة بالدفعات — يعيد عدد البايتات المكتوبة.
pub fn send(channel: &PrinterChannel, bytes: &[u8]) -> Result<usize> {
    match channel {
        PrinterChannel::None => Err(crate::SelaError::msg(
            "لا توجد طابعة مربوطة — اربطها من الإعدادات أولاً",
        )),
        PrinterChannel::Tcp { host, port } => send_tcp(host, *port, bytes),
        PrinterChannel::Serial { com_port, baud } => send_serial(com_port, *baud, bytes),
        PrinterChannel::Spool { printer_name } => crate::hardware::spool::send_raw(printer_name, bytes),
    }
}

fn send_tcp(host: &str, port: u16, bytes: &[u8]) -> Result<usize> {
    let addr = format!("{host}:{port}");
    let mut stream = TcpStream::connect(&addr)
        .map_err(|_| crate::SelaError::msg(format!("تعذر الاتصال بالطابعة {addr} — تأكد من العنوان وأن الطابعة تعمل")))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    let mut written = 0usize;
    for chunk in bytes.chunks(CHUNK_SIZE) {
        stream.write_all(chunk)?;
        stream.flush()?;
        written += chunk.len();
    }
    Ok(written)
}

fn send_serial(com_port: &str, baud: u32, bytes: &[u8]) -> Result<usize> {
    let mut port = serialport::new(com_port, baud)
        .timeout(Duration::from_secs(10))
        .open_native()
        .map_err(|e| {
            crate::SelaError::msg(format!("تعذر فتح المنفذ {com_port}@{baud}: {e}"))
        })?;
    let mut written = 0usize;
    for chunk in bytes.chunks(CHUNK_SIZE) {
        use std::io::Write as _;
        port.write_all(chunk)?;
        port.flush()?;
        written += chunk.len();
    }
    // استنزاف الردود المحتملة حتى لا تتراكم بالعازلة.
    let mut scratch = [0u8; 64];
    let _ = port.read(&mut scratch);
    Ok(written)
}

/// طباعة مهمة عمليات كاملة (الواجهة تبني ops بنفس بانية الأندرويد).
pub fn print_job(channel: &PrinterChannel, ops: &[escpos::EscPosOp]) -> Result<usize> {
    let bytes = escpos::encode_job(ops)?;
    send(channel, &bytes)
}

/// فتح درج النقدية عبر القناة المربوطة.
pub fn kick_drawer(channel: &PrinterChannel) -> Result<usize> {
    let bytes = escpos::drawer_kick_bytes();
    send(channel, &bytes)
}

/// المنافذ التسلسلية المتاحة (COMx على ويندوز).
pub fn list_serial_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}

/// الطابعات المثبتة في النظام (EnumPrinters) — ويندوز فقط.
pub fn list_spool_printers() -> Vec<String> {
    crate::hardware::spool::installed_printers()
}

pub mod spool;
pub mod hook;
pub mod discover;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::escpos::EscPosOp;
    /// خادم TCP محلي يتظاهر بطابعة شبكية — يتحقق من البايتات المستلمة
    /// دفعة 1024 بايت (نفس سلوك CHUNK_SIZE في الأندرويد).
    #[test]
    fn tcp_print_and_drawer_kick_over_loopback() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let mut all = Vec::new();
            // اتصالان متوقعان: مهمة الطباعة ثم نبضة الدرج (كل قناة جديدة).
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().unwrap();
                let mut buf = [0u8; 2048];
                sock.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                loop {
                    match sock.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => all.extend_from_slice(&buf[..n]),
                    }
                    if all.len() > 40 {
                        break;
                    }
                }
                drop(sock);
            }
            all
        });

        let channel = PrinterChannel::Tcp { host: "127.0.0.1".into(), port: addr.port() };
        let mut init = EscPosOp::default();
        init.op = "init".into();
        let mut tx = EscPosOp::default();
        tx.op = "text".into();
        tx.value = Some("Hello Desktop POS\n".into());
        let mut cut = EscPosOp::default();
        cut.op = "cut".into();
        let sent = print_job(&channel, &[init, tx, cut]).unwrap();
        assert!(sent > 10);

        let kicked = kick_drawer(&channel).unwrap();
        assert_eq!(kicked, 5);

        let received = server.join().unwrap();
        // بادئة المهمة ESC @ ثم النص ثم القص ثم نبضة الدرج.
        assert_eq!(&received[0..2], &[0x1B, 0x40]);
        assert!(received.windows(4).any(|w| w == [0x1D, 0x56, 0x42, 0x00]), "أمر القص موجود");
        assert!(received.windows(5).any(|w| w == [0x1B, 0x70, 0x00, 0x19, 0xFA]), "نبضة الدرج موجودة");
    }

    #[test]
    fn no_channel_error_is_arabic_and_friendly() {
        let err = send(&PrinterChannel::None, &[0x1B, 0x40]).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("طابعة"), "رسالة عربية واضحة: {msg}");
    }

    #[test]
    fn serial_ports_listing_never_panics() {
        let _ = list_serial_ports(); // على لينكس قد تكون فارغة — المهم ألا تُفجّر.
    }
}
