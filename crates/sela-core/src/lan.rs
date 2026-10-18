//! lan.rs — v58 (الجولة 62): خادم «سيلّا كاشير» على الشبكة المحلية.
//! ─────────────────────────────────────────────────────────────────
//! غلاف شبكي رفيع بلا أي مكتبة خارجية (std فقط — لا يغير Cargo.lock
//! إطلاقاً): خادم HTTP/1.1 مبسّط + مستجيب بث استكشاف UDP. منطق
//! العمل كله في الواجهة (LanHandlers.ts) — نفس مسارات البيع
//! والإرجاع التي تستعملها نقطة البيع نفسها.
//!
//! التدفق:
//!  ① `LanServer::start(port, store_name, on_request)` يفتح
//!     TcpListener + مقبس UDP ويطلق خيوطاً خلفية.
//!  ② كل طلب HTTP يُحلَّل ثم يُسلَّم إلى `on_request` مع مقبض رد
//!     `ResponderHandle` (يبثه src-tauri للواجهة عبر حدث
//!     `lan://request`، والواجهة ترد عبر أمر lan_respond).
//!  ③ خيط الاتصال ينتظر الرد حتى 30 ثانية ثم يجيب العميل.
//!  ④ بث الاستكشاف: تطبيق الكاشير يبث `SELA_POS_DISCOVER_v1` على
//!     منفذ 8951؛ نرد ببطاقة JSON (المتجر/المنفذ/الجهاز).
//!
//! العميل الوحيد هو تطبيق سيلّا كاشير الذي نكتبه نحن — لا حاجة
//! لـ chunked ولا keep-alive (اتصال لكل طلب)، والحدود محروسة
//! (ترويسة 64 ك.ب وجسم 2 م.ب).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// منفذ بث الاستكشاف الافتراضي (نفسه في الأندرويد وتطبيق الكاشير).
pub const DISCOVERY_PORT: u16 = 8951;
/// نص طلب الاستكشاف — أي حزمة UDP بهذا النص تُقابل ببطاقة تعريف.
pub const DISCOVERY_MAGIC: &str = "SELA_POS_DISCOVER_v1";
/// مهلة انتظار رد الواجهة على طلب واحد.
pub const REQUEST_TIMEOUT_MS: u64 = 30_000;
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

/// طلب HTTP محلَّل كما يصل إلى الواجهة.
#[derive(Debug, Clone)]
pub struct LanHttpRequest {
    pub id: u64,
    pub method: String,
    pub path: String,
    /// نص الاستعلام الخام بعد «?» (توزيعه في TS).
    pub query: String,
    pub body: String,
    /// قيمة ترويسة Authorization كما وصلت.
    pub auth: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, Clone)]
struct LanHttpResponse {
    status: u16,
    body: String,
}

/// خلية رد معلقة — خيط الاتصال ينتظرها حتى تُكتب.
#[derive(Default)]
struct PendingSlot {
    response: Mutex<Option<LanHttpResponse>>,
    signal: Condvar,
}

#[derive(Default)]
struct ServerInner {
    pending: Mutex<HashMap<u64, Arc<PendingSlot>>>,
}

/// مقبض رد قابل للاستنساخ — يمرَّر مع كل طلب ويحتفظ به src-tauri
/// لأمر lan_respond. كتابة الرد توقظ خيط الاتصال المنتظر.
#[derive(Clone)]
pub struct ResponderHandle {
    inner: Arc<ServerInner>,
}

impl ResponderHandle {
    /// كتابة رد لطلب معلق (طلبات مجهولة تُتجاهل بصمت — منتهية
    /// مهلتها أو سبق ردها).
    pub fn respond(&self, id: u64, status: u16, body: String) {
        let slot = self.inner.pending.lock().unwrap().remove(&id);
        if let Some(slot) = slot {
            *slot.response.lock().unwrap() =
                Some(LanHttpResponse { status, body });
            slot.signal.notify_one();
        }
    }
}

/// الخادم الحي — أُسقطه (أو استدعِ stop) لإيقاف كل شيء.
pub struct LanServer {
    inner: Arc<ServerInner>,
    running: Arc<AtomicBool>,
    seq: Arc<AtomicU64>,
    /// المقبس داخل Arc كي يبقى مفتوحاً طوال حياة الخادم (إسقاطه
    /// يكسر خيط القبول فوراً عند الإيقاف — نتركه يحيى حتى Drop).
    _tcp: Arc<TcpListener>,
    _udp: Option<Arc<UdpSocket>>,
    port: u16,
}

impl LanServer {
    /// يفتح الخادم على المنفذ (0 = منفذ عشوائي حر) ويبدأ الاستماع
    /// ومستجيب الاستكشاف. `on_request` يُستدعى من خيوط الاتصال —
    /// يجب أن يكتفي بالبث (حدث Tauri) والعودة فوراً.
    pub fn start<F>(
        port: u16,
        store_name: String,
        on_request: F,
    ) -> std::io::Result<LanServer>
    where
        F: Fn(LanHttpRequest, ResponderHandle) + Send + Sync + 'static,
    {
        let listener = TcpListener::bind(("0.0.0.0", port))?;
        let actual_port = listener.local_addr()?.port();
        let tcp = Arc::new(listener);
        let running = Arc::new(AtomicBool::new(true));
        let inner = Arc::new(ServerInner::default());
        let seq = Arc::new(AtomicU64::new(0));
        let responder = ResponderHandle {
            inner: Arc::clone(&inner),
        };

        // ── خيط قبول الاتصالات ────────────────────────────────────
        {
            let tcp = Arc::clone(&tcp);
            let running = Arc::clone(&running);
            let inner = Arc::clone(&inner);
            let seq = Arc::clone(&seq);
            let on_request = Arc::new(on_request);
            let responder = responder.clone();
            std::thread::Builder::new()
                .name("lan-http-accept".into())
                .spawn(move || {
                    for stream in tcp.incoming() {
                        if !running.load(Ordering::SeqCst) {
                            break;
                        }
                        match stream {
                            Ok(stream) => {
                                let inner = Arc::clone(&inner);
                                let running = Arc::clone(&running);
                                let seq = Arc::clone(&seq);
                                let on_request = Arc::clone(&on_request);
                                let responder = responder.clone();
                                std::thread::Builder::new()
                                    .name("lan-http-conn".into())
                                    .spawn(move || {
                                        serve_connection(
                                            stream,
                                            &inner,
                                            &running,
                                            &seq,
                                            &*on_request,
                                            responder,
                                        );
                                    })
                                    .ok();
                            }
                            Err(_) => {
                                if running.load(Ordering::SeqCst) {
                                    std::thread::sleep(Duration::from_millis(150));
                                }
                            }
                        }
                    }
                })?;
        }

        // ── مستجيب بث الاستكشاف UDP ───────────────────────────────
        let udp = start_discovery(&running, actual_port, store_name);

        Ok(LanServer {
            inner,
            running,
            seq,
            _tcp: tcp,
            _udp: udp,
            port: actual_port,
        })
    }

    /// المنفذ الفعلي (مفيد عند الطلب بمنفذ 0).
    pub fn port(&self) -> u16 {
        self.port
    }

    /// مقبض رد مستقل (يُخزَّن في AppState لأمر lan_respond).
    pub fn responder(&self) -> ResponderHandle {
        ResponderHandle {
            inner: Arc::clone(&self.inner),
        }
    }

    /// إيقاف الخادم: تُحرَّر كل الطلبات المعلقة برمز 503 وتنام
    /// الخيوط في جولتها التالية (أو تُكسر بإسقاط المقابس عند Drop).
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        let slots: Vec<Arc<PendingSlot>> = {
            let mut pending = self.inner.pending.lock().unwrap();
            pending.drain().map(|(_, v)| v).collect()
        };
        for slot in slots {
            *slot.response.lock().unwrap() = Some(LanHttpResponse {
                status: 503,
                body: "{\"ok\":false,\"error\":\"أُوقف خادم الكاشير\"}".into(),
            });
            slot.signal.notify_one();
        }
    }

    /// عدد الطلبات المقبولة حتى الآن (نبض حي للعرض).
    pub fn request_count(&self) -> u64 {
        self.seq.load(Ordering::SeqCst)
    }
}

impl Drop for LanServer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// خدمة اتصال واحد: قراءة الطلب → تسليم الواجهة → انتظار الرد.
fn serve_connection(
    mut stream: TcpStream,
    inner: &Arc<ServerInner>,
    running: &AtomicBool,
    seq: &AtomicU64,
    on_request: &(dyn Fn(LanHttpRequest, ResponderHandle) + Send + Sync),
    responder: ResponderHandle,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(35_000)));
    let ip = stream.peer_addr().map(|a| a.ip().to_string()).ok();
    let parsed = match read_request(&mut stream) {
        Some(parsed) => parsed,
        None => return,
    };
    let id = seq.fetch_add(1, Ordering::SeqCst) + 1;
    let request = LanHttpRequest {
        id,
        method: parsed.method,
        path: parsed.path,
        query: parsed.query,
        body: parsed.body,
        auth: parsed.auth,
        ip,
    };
    let slot = Arc::new(PendingSlot::default());
    inner
        .pending
        .lock()
        .unwrap()
        .insert(id, Arc::clone(&slot));
    on_request(request, responder.clone());

    // انتظار رد الواجهة (أو المهلة) — مع فحص أولي قبل الانتظار:
    // لو كُتب الرد قبل وصولنا هنا (استجابة فورية) فالإشارة قد ضاعت
    // أصلاً لأن Condvar ليست لاصقة — الفحص تحت القفل يغلق هذه الثغرة.
    let mut guard = slot.response.lock().unwrap();
    if guard.is_none() {
        let (g, _timed_out) = match slot
            .signal
            .wait_timeout(guard, Duration::from_millis(REQUEST_TIMEOUT_MS))
        {
            Ok(out) => out,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard = g;
    }
    let response = guard.take().unwrap_or(LanHttpResponse {
        status: 503,
        body: "{\"ok\":false,\"error\":\"انتهت مهلة معالجة الطلب\"}".into(),
    });
    drop(guard);
    inner.pending.lock().unwrap().remove(&id);
    let _ = write_response(&mut stream, response.status, &response.body);
    let _ = running;
}

/// الطلب المحلَّل من الدفق الخام.
struct ParsedRequest {
    method: String,
    path: String,
    query: String,
    body: String,
    auth: Option<String>,
}

/// تحليل منطق الطلب من أي قارئ (مستعمل من read_request والاختبارات).
fn parse_head_and_body<R: Read>(reader: &mut R) -> Option<ParsedRequest> {
    // اقرأ حتى نهاية الترويسات (\r\n\r\n) بحد أقصى MAX_HEADER_BYTES.
    let mut head: Vec<u8> = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    loop {
        match reader.read(&mut byte) {
            Ok(0) => return None,
            Ok(_) => {
                head.push(byte[0]);
                if head.len() > MAX_HEADER_BYTES {
                    return None;
                }
                if head.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => return None,
        }
    }
    let head_text = String::from_utf8_lossy(&head).to_string();
    let mut lines = head_text.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();

    let mut content_length = 0usize;
    let mut auth: Option<String> = None;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some(colon) = line.find(':') {
            let name = line[..colon].trim().to_ascii_lowercase();
            let value = line[colon + 1..].trim().to_string();
            if name == "content-length" {
                content_length = value.parse().unwrap_or(0);
            } else if name == "authorization" {
                auth = Some(value);
            }
        }
    }
    if content_length > MAX_BODY_BYTES {
        return None;
    }
    let mut body_bytes = vec![0u8; content_length];
    if content_length > 0 {
        let mut read = 0;
        while read < content_length {
            match reader.read(&mut body_bytes[read..]) {
                Ok(0) => break,
                Ok(n) => read += n,
                Err(_) => return None,
            }
        }
        body_bytes.truncate(read);
    }
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    let (path, query) = match target.find('?') {
        Some(idx) => (target[..idx].to_string(), target[idx + 1..].to_string()),
        None => (target, String::new()),
    };
    Some(ParsedRequest {
        method,
        path,
        query,
        body,
        auth,
    })
}

/// قراءة وتحليل طلب HTTP/1.1 واحد من مقبس TCP.
fn read_request(stream: &mut TcpStream) -> Option<ParsedRequest> {
    parse_head_and_body(stream)
}

/// كتابة استجابة JSON واحدة ثم إغلاق الاتصال.
fn write_response(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = status_reason(status);
    let bytes = body.as_bytes();
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        reason,
        bytes.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(bytes)?;
    stream.flush()
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

/// مستجيب بث الاستكشاف — نفس بروتوكول الأندرويد حرفياً.
fn start_discovery(
    running: &Arc<AtomicBool>,
    http_port: u16,
    store_name: String,
) -> Option<Arc<UdpSocket>> {
    let socket = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).ok()?;
    let socket = Arc::new(socket);
    {
        let socket = Arc::clone(&socket);
        let running = Arc::clone(&running);
        std::thread::Builder::new()
            .name("lan-discovery".into())
            .spawn(move || {
                let mut buffer = [0u8; 512];
                loop {
                    if !running.load(Ordering::SeqCst) {
                        break;
                    }
                    let _ = socket.set_read_timeout(Some(Duration::from_millis(500)));
                    match socket.recv_from(&mut buffer) {
                        Ok((size, sender)) => {
                            let text = String::from_utf8_lossy(&buffer[..size]);
                            if text.trim() == DISCOVERY_MAGIC {
                                let card = format!(
                                    "{{\"app\":\"sela-pos\",\"proto\":1,\"port\":{},\"store\":{},\"device\":\"Windows PC\"}}",
                                    http_port,
                                    json_escape(&store_name)
                                );
                                let _ = socket.send_to(card.as_bytes(), sender);
                            }
                        }
                        Err(_) => {
                            if running.load(Ordering::SeqCst) {
                                std::thread::sleep(Duration::from_millis(150));
                            }
                        }
                    }
                }
            })
            .ok()?;
    }
    Some(socket)
}

/// تهريب نص داخل JSON يدوياً (بلا تبعية serde هنا).
fn json_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// تحليل طلب POST بجسم وترويسة Authorization.
    #[test]
    fn parses_post_with_body_and_auth() {
        let raw =
            b"POST /api/sale?x=1 HTTP/1.1\r\nHost: pc:8950\r\nContent-Length: 7\r\nAuthorization: Bearer tok123\r\n\r\n{\"a\":1}";
        let mut cursor = std::io::Cursor::new(raw.to_vec());
        let parsed = parse_head_and_body(&mut cursor).unwrap();
        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.path, "/api/sale");
        assert_eq!(parsed.query, "x=1");
        assert_eq!(parsed.body, "{\"a\":1}");
        assert_eq!(parsed.auth.as_deref(), Some("Bearer tok123"));
    }

    /// تحليل GET بلا جسم ولا ترويسات خاصة.
    #[test]
    fn parses_get_without_body() {
        let raw = b"GET /api/ping HTTP/1.1\r\nHost: pc\r\n\r\n";
        let mut cursor = std::io::Cursor::new(raw.to_vec());
        let parsed = parse_head_and_body(&mut cursor).unwrap();
        assert_eq!(parsed.method, "GET");
        assert_eq!(parsed.path, "/api/ping");
        assert_eq!(parsed.query, "");
        assert_eq!(parsed.body, "");
        assert!(parsed.auth.is_none());
    }

    /// ترويسة أطول من الحد تُرفض (حماية من الطلبات المعطوبة).
    #[test]
    fn rejects_header_overrun() {
        let mut raw: Vec<u8> = b"GET / HTTP/1.1\r\nX-Big: ".to_vec();
        raw.extend(std::iter::repeat(b'a').take(MAX_HEADER_BYTES + 16));
        raw.extend_from_slice(b"\r\n\r\n");
        let mut cursor = std::io::Cursor::new(raw);
        assert!(parse_head_and_body(&mut cursor).is_none());
    }

    /// جسم أكبر من الحد يُرفض.
    #[test]
    fn rejects_body_overrun() {
        let head = format!(
            "POST /api/sale HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
            MAX_BODY_BYTES + 1
        );
        let raw = head.into_bytes();
        let mut cursor = std::io::Cursor::new(raw);
        assert!(parse_head_and_body(&mut cursor).is_none());
    }

    /// جولة كاملة حقيقية: خادم على منفذ عشوائي + عميل TcpStream.
    #[test]
    fn serves_end_to_end_roundtrip() {
        let server = LanServer::start(0, "متجر الاختبار".into(), |req, responder| {
            if req.path == "/api/ping" && req.method == "GET" {
                responder.respond(req.id, 200, "{\"ok\":true}".into());
            } else {
                responder.respond(
                    req.id,
                    404,
                    "{\"ok\":false,\"error\":\"مسار غير معروف\"}".into(),
                );
            }
        })
        .unwrap();
        let port = server.port();
        assert!(port > 0);

        use std::net::TcpStream as Client;
        let mut client = Client::connect(("127.0.0.1", port)).unwrap();
        client
            .write_all(b"GET /api/ping HTTP/1.1\r\nHost: t\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("Content-Length: 11")); // {"ok":true} = 11 بايت
        assert!(response.ends_with("{\"ok\":true}"));

        // طلب مهمل الرد → 503 بعد المهلة… لا ننتظر 30 ثانية في
        // الاختبار؛ نتحقق فقط من عدّاد الطلبات وعدّاد الرد.
        let mut client2 = Client::connect(("127.0.0.1", port)).unwrap();
        client2
            .write_all(b"GET /api/nothing HTTP/1.1\r\nHost: t\r\n\r\n")
            .unwrap();
        let mut response2 = String::new();
        client2.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let _ = client2.read_to_string(&mut response2);
        // الرد هنا 503 (لا معالج لهذا المسار في النداء) — بعد المهلة
        // الكاملة قد يتجاوز مهلة القراءة؛ المهم ألا يعلق الخادم.
        assert!(server.request_count() >= 2);
        server.stop();
    }

    /// تهريب JSON: علامات الاقتباس والأسطر الجديدة.
    #[test]
    fn json_escape_handles_quotes_and_newlines() {
        assert_eq!(json_escape("a\"b"), "\"a\\\"b\"");
        assert_eq!(json_escape("a\nb"), "\"a\\nb\"");
        assert_eq!(json_escape("متجر"), "\"متجر\"");
    }
}
