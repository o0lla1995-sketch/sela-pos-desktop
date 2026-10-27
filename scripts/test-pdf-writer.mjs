/**
 * Test: PDF writer xref validity — بنية الكائنات والإزاحات.
 * تشغيل: node scripts/test-pdf-writer.mjs (من جذر sela-pos-desktop)
 */
import {buildImagePagesPdf} from '../src/services/pdfWriter.ts';

// صفحتا اختبار (Flate غير متاح في node القديم — نمرر بايتات وهمية).
const fakePng = new Uint8Array([120, 156, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const bytes = buildImagePagesPdf([
  {data: fakePng, filter: 'FlateDecode', widthPx: 1240, heightPx: 1754, wPt: 595.28, hPt: 841.89},
  {data: fakePng, filter: 'FlateDecode', widthPx: 1240, heightPx: 1754, wPt: 595.28, hPt: 841.89},
  {data: fakePng, filter: 'FlateDecode', widthPx: 1240, heightPx: 1754, wPt: 595.28, hPt: 841.89},
]);

const text = Buffer.from(bytes).toString('latin1');
const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
const xrefBlock = text.slice(startxref, text.indexOf('trailer'));
const lines = xrefBlock.split('\n').filter(l => l.length > 0);
const header0 = lines[1]; // lines[0] = "xref"
const count = Number(header0.split(' ')[1]);
// entries تشمل سطر الرأس الحر 0000000000 65535 f ثم كائنًا لكل إزاحة.
const entries = lines.slice(2).filter(l => l.endsWith(' n '));
console.log('xref count declared:', count, '| object entries:', entries.length);
if (count !== entries.length + 1) {
  throw new Error('MISMATCH: declared count != objects + free head');
}

// تحقق: كل إزاحة تشير فعلاً إلى «N 0 obj»
for (let i = 0; i < entries.length; i += 1) {
  const off = Number(entries[i].slice(0, 10));
  const expectId = i + 1;
  const at = text.slice(off, off + 24);
  if (!at.startsWith(`${expectId} 0 obj`)) {
    throw new Error(`BAD OFFSET for object ${expectId}: got "${at}"`);
  }
}
// تحقق الكائنات المنطقية
if (!text.includes('/Count 3')) throw new Error('pages count wrong');
if (!text.includes('/Root 1 0 R')) throw new Error('root wrong');
if ((text.match(/\/Type \/Page[^s]/g) || []).length !== 3) throw new Error('page objects wrong');
if ((text.match(/\/Type \/XObject/g) || []).length !== 3) throw new Error('image objects wrong');
console.log('bytes:', bytes.length, '— all', entries.length, 'xref offsets point at their objects correctly ✓');
console.log('PDF WRITER OK');
