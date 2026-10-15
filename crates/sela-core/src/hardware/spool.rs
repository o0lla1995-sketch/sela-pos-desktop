#![allow(non_snake_case)]
/**
 * spool.rs — كتابة RAW عبر مشغّل طباعة ويندوز (Winspool).
 * هذه هي القناة القياسية لطابعات USB الحرارية المثبتة بمشغّلها:
 * نفتح الطابعة بـ OpenPrinter ثم StartDoc بمُعايرة بيانات "RAW"
 * فتُكتب أوامر ESC/POS مباشرة — بلا حوار ويندوز (طباعة صامتة).
 */

use crate::Result;

pub fn send_raw(printer_name: &str, bytes: &[u8]) -> Result<usize> {
    imp::spool_impl(printer_name, bytes)
}

pub fn installed_printers() -> Vec<String> {
    imp::list_printers_impl()
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Graphics::Printing::{
        DocInfo1W, EndDocPrinter, EndPagePrinter, EnumPrintersW, OpenPrinter2W,
        StartDocPrinterW, StartPagePrinter, WritePrinter, PRINTER_ENUM_CONNECTIONS,
        PRINTER_ENUM_LOCAL, PRINTER_INFO_1W,
    };

    pub fn spool_impl(name: &str, bytes: &[u8]) -> Result<usize> {
        unsafe {
            let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
            let mut printer = HANDLE::default();
            if OpenPrinter2W(PCWSTR(wide.as_ptr()), &mut printer, None, None).is_err() {
                return Err(crate::SelaError::msg(format!(
                    "تعذر فتح الطابعة «{name}» — تأكد من اسمها في إعدادات النظام"
                )));
            }
            let result = (|| -> Result<usize> {
                let doc_name: Vec<u16> = "sela receipt"
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                let datatype: Vec<u16> = "RAW".encode_utf16().chain(std::iter::once(0)).collect();
                let mut output: Vec<u16> = vec![0];
                let doc = DocInfo1W {
                    pDocName: PCWSTR(doc_name.as_ptr()),
                    pOutputFile: PCWSTR(output.as_mut_ptr()),
                    pDatatype: PCWSTR(datatype.as_ptr()),
                };
                if StartDocPrinterW(printer, 1, &doc as *const _ as *const _).0 == 0 {
                    return Err(crate::SelaError::msg("فشل بدء مستند الطباعة (RAW)"));
                }
                StartPagePrinter(printer);
                let mut written_total = 0usize;
                let mut ok = true;
                for chunk in bytes.chunks(crate::hardware::CHUNK_SIZE) {
                    let mut written: u32 = 0;
                    let w = WritePrinter(
                        printer,
                        chunk.as_ptr() as *const _,
                        chunk.len() as u32,
                        &mut written,
                    );
                    if w.is_err() || written as usize != chunk.len() {
                        ok = false;
                        break;
                    }
                    written_total += written as usize;
                }
                EndPagePrinter(printer);
                EndDocPrinter(printer);
                if !ok {
                    return Err(crate::SelaError::msg(
                        "انقطعت الكتابة إلى الطابعة أثناء الإرسال — أعد المحاولة",
                    ));
                }
                Ok(written_total)
            })();
            let _ = CloseHandle(printer);
            result
        }
    }

    pub fn list_printers_impl() -> Vec<String> {
        unsafe {
            let mut needed: u32 = 0;
            let mut returned: u32 = 0;
            let flags = PRINTER_ENUM_LOCAL.0 | PRINTER_ENUM_CONNECTIONS.0;
            let _ = EnumPrintersW(flags, None, 1, None, 0, &mut needed, &mut returned);
            if needed == 0 {
                return Vec::new();
            }
            let mut buffer = vec![0u8; needed as usize];
            let ok = EnumPrintersW(
                flags,
                None,
                1,
                Some(buffer.as_mut_ptr() as *mut _),
                needed,
                &mut needed,
                &mut returned,
            );
            if !ok.is_ok() || returned == 0 {
                return Vec::new();
            }
            let struct_size = std::mem::size_of::<PRINTER_INFO_1W>();
            let mut names = Vec::with_capacity(returned as usize);
            for i in 0..returned as usize {
                let offset = i * struct_size;
                if offset + struct_size > buffer.len() {
                    break;
                }
                let info = buffer.as_ptr().add(offset) as *const PRINTER_INFO_1W;
                let name_ptr = (*info).pName;
                if name_ptr.is_null() {
                    continue;
                }
                let mut len = 0usize;
                while *name_ptr.0.add(len) != 0 {
                    len += 1;
                    if len > 512 {
                        break;
                    }
                }
                let slice = std::slice::from_raw_parts(name_ptr.0, len);
                if let Ok(name) = String::from_utf16(slice) {
                    names.push(name);
                }
            }
            names.sort();
            names.dedup();
            names
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn spool_impl(_name: &str, _bytes: &[u8]) -> Result<usize> {
        Err(crate::SelaError::msg(
            "قناة USB/Spool مدعومة على ويندوز فقط — استخدم TCP أو التسلسلي هنا",
        ))
    }
    pub fn list_printers_impl() -> Vec<String> {
        Vec::new()
    }
}
