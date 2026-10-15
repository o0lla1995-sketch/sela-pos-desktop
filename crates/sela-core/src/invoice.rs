/**
 * invoice.rs — ترقيم الفواتير INV-YYYYMMDD-NNNN (format.ts الأندرويد):
 * معدّاد يومي دائم — يبدأ من 1 كل يوم جديد، وبقية اليوم يتابع.
 */
use crate::Result;

pub fn next_invoice_number(
    counter: u32,
    last_day: &str,
    today: &str,
) -> Result<(String, u32, String)> {
    let is_same_day = last_day == today;
    let next: u32 = if is_same_day { counter + 1 } else { 1 };
    let compact_day = today.replace('-', "");
    let number = format!("INV-{compact_day}-{:04}", next);
    Ok((number, next, today.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_sequence_and_reset() {
        // أول فاتورة اليوم.
        let (n1, c1, d1) = next_invoice_number(0, "2026-10-14", "2026-10-15").unwrap();
        assert_eq!(n1, "INV-20261015-0001");
        assert_eq!(c1, 1);
        assert_eq!(d1, "2026-10-15");

        // الثانية بنفس اليوم.
        let (n2, c2, _) = next_invoice_number(c1, &d1, "2026-10-15").unwrap();
        assert_eq!(n2, "INV-20261015-0002");
        assert_eq!(c2, 2);

        // يوم جديد → يعيد التسلسل إلى 0001.
        let (n3, c3, d3) = next_invoice_number(c2, "2026-10-15", "2026-10-16").unwrap();
        assert_eq!(n3, "INV-20261016-0001");
        assert_eq!(c3, 1);
        assert_eq!(d3, "2026-10-16");
    }
}
