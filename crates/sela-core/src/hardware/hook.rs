#![allow(dead_code)]
/**
 * hook.rs — المستمع العام لقارئ الباركود/QR (المهمة §2.أ).
 *
 * قارئات USB/بلوتوث HID تُحاكي لوحة مفاتيح: تكتب الكود بسرعة ثم Enter.
 * نثبّت WH_KEYBOARD_LL على نافذة بعيدة كل النظام: نلتقط الاندفاعات
 * (فجوة < 50مللي بين ضربات، طول ≥ 4، تنتهي بـ Enter أو Tab) ونستدعي
 * نداء العودة مباشرة — الواجهة توجّه الكود لأي شاشة كانت نشطة، دون
 * أي تركيز على حقل نصي (المهمة §2.أ). المدخلات المولّدة برمجياً
 * (injected) تُتجاهل كي لا نسمع أنفسنا.
 *
 * على لينكس يعيد start() = false وتتكفل الواجهة بمستمع JS الداخلي
 * الذي يغذّي نفس process_key() — منطق اندفاعة واحد مشترك.
 */

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// تُستدعى بكل كود مكتمل (من خيط الخطاف على ويندوز).
pub type ScanCallback = Box<dyn Fn(String) + Send + 'static>;

static RUNNING: AtomicBool = AtomicBool::new(false);
static CALLBACK: Mutex<Option<ScanCallback>> = Mutex::new(None);
static ENABLED: AtomicBool = AtomicBool::new(true);
static MIN_LEN: AtomicUsize = AtomicUsize::new(4);
static BUFFER: Mutex<HookBuffer> = Mutex::new(HookBuffer { text: String::new(), last: None });

const GAP_MS: u64 = 50;

struct HookBuffer {
    text: String,
    last: Option<Instant>,
}

/// يبدأ الخطاف (ويندوز فقط). يعيد false إذا غير مدعوم.
pub fn start(callback: ScanCallback, min_length: usize) -> bool {
    *CALLBACK.lock().unwrap() = Some(callback);
    ENABLED.store(true, Ordering::SeqCst);
    MIN_LEN.store(min_length.clamp(2, 64), Ordering::Relaxed);
    if cfg!(not(windows)) {
        return false;
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return true;
    }
    #[cfg(windows)]
    {
        std::thread::spawn(|| {
            windows_impl::run_message_loop();
            RUNNING.store(false, Ordering::SeqCst);
        });
    }
    true
}

pub fn stop() {
    RUNNING.store(false, Ordering::SeqCst);
    *CALLBACK.lock().unwrap() = None;
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    if !enabled {
        BUFFER.lock().unwrap().text.clear();
    }
}

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}

pub fn emit_to_callback(code: &str) {
    if let Some(cb) = CALLBACK.lock().unwrap().as_ref() {
        cb(code.to_string());
    }
}

/// تغذية مفتاح إلى منطق الاندفاعة المشترك (الخطاف الأصلي + مستمع JS).
/// يعيد Some(code) عند اكتمال كود صالح. مفتاح = رمز أفتراضي VK.
pub fn process_key(vk: u32, is_key_down: bool) -> Option<String> {
    if !is_key_down || !ENABLED.load(Ordering::SeqCst) {
        return None;
    }
    let mut guard = BUFFER.lock().unwrap();
    let now = Instant::now();
    let stale = matches!(guard.last, Some(t) if now.duration_since(t) > Duration::from_millis(GAP_MS));
    if stale {
        guard.text.clear();
    }
    guard.last = Some(now);

    let min_len = MIN_LEN.load(Ordering::Relaxed);
    match vk {
        0x0D | 0x09 => {
            let code = guard.text.clone();
            guard.text.clear();
            if code.len() >= min_len && code.chars().all(|c| c.is_ascii_graphic()) {
                return Some(code);
            }
            None
        }
        0x30..=0x39 => {
            guard.text.push(char::from(b'0' + (vk - 0x30) as u8));
            None
        }
        0x41..=0x5A => {
            guard.text.push(char::from(b'A' + (vk - 0x41) as u8));
            None
        }
        0x60..=0x69 => {
            guard.text.push(char::from(b'0' + (vk - 0x60) as u8));
            None
        }
        0xBD => {
            guard.text.push('-');
            None
        }
        0xBE => {
            guard.text.push('.');
            None
        }
        0x08 => {
            guard.text.pop();
            None
        }
        0x1B => {
            guard.text.clear();
            None
        }
        _ => None,
    }
}

#[cfg(windows)]
mod windows_impl {
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
        KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        LLKHF_INJECTED, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    pub fn run_message_loop() {
        unsafe {
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_proc), None, 0);
            if hook.is_invalid() {
                return;
            }
            let mut msg = MSG::default();
            // حلقة رسائل قياسية — تظل حية حتى PostThreadMessage بالخروج.
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            let _ = UnhookWindowsHookEx(hook);
        }
    }

    unsafe extern "system" fn low_level_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= 0 {
            let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let injected = (kb.flags & LLKHF_INJECTED.0) != 0;
            if !injected {
                let is_down = wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN;
                if is_down {
                    if let Some(code) = super::process_key(kb.vkCode, true) {
                        super::emit_to_callback(&code);
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn burst_detection_and_min_length() {
        // محاكاة قارئ: أرقام سريعة ثم Enter → كود.
        MIN_LEN.store(4, Ordering::Relaxed);
        ENABLED.store(true, Ordering::SeqCst);
        BUFFER.lock().unwrap().text.clear();

        for vk in [0x36, 0x32, 0x39, 0x30, 0x31, 0x32, 0x33, 0x34] {
            assert_eq!(process_key(vk, true), None);
        }
        assert_eq!(process_key(0x0D, true).as_deref(), Some("62901234"), "الكود يكتمل بـ Enter");
        assert_eq!(process_key(0x0D, true), None, "Enter بلا مخزون → لا شيء");

        // قصير جداً.
        for vk in [0x31, 0x32] {
            assert_eq!(process_key(vk, true), None);
        }
        assert_eq!(process_key(0x0D, true), None, "أقل من الحد الأدنى مرفوض");
    }

    #[test]
    fn callback_dispatch() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        MIN_LEN.store(4, Ordering::Relaxed);
        ENABLED.store(true, Ordering::SeqCst);
        start(
            Box::new(|code| {
                assert_eq!(code, "12345");
                COUNTER.fetch_add(1, Ordering::SeqCst);
            }),
            4,
        );
        for vk in [0x31, 0x32, 0x33, 0x34, 0x35] {
            let _ = process_key(vk, true);
        }
        let code = process_key(0x0D, true);
        assert_eq!(code.as_deref(), Some("12345"));
        emit_to_callback(&code.unwrap());
        assert_eq!(COUNTER.load(Ordering::SeqCst), 1);
        stop();
    }
}
