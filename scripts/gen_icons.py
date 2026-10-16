#!/usr/bin/env python3
"""توليد أيقونات سيلا POS لسطح المكتب — v59 بحرف s الإنجليزية.

طلب التاجر (الجولة 59): «قم بتغيير الأيقونة إلى مثل أيقونة تطبيق
الأندرويد سلة وحرف s باللغة الإنجليزية» — نفس هوية الأندرويد
(خلفية متدرجة داكنة + أقواس مسح بيضاء) لكن الحرف s لاتيني بدل
السين العربية.

التنفيذ بلا اعتماد على خطوط النظام:
  1. الخلفية والأقواس: SVG → cairosvg (متجهي خالص).
  2. الحرف s: PIL + ملف Tajawal-Black.ttf مباشرة من مستودع الواجهة
     (يضمن الشكل ذاته على أي جهاز توليد).
  3. الدمج في لوحة 1024 ثم التصدير لكل المقاسات + ICO متعدد.

الناتج في src-tauri/icons/:
  • 32x32.png / 128x128.png / 128x128@2x.png (256)
  • icon.ico متعدد المقاسات (16/24/32/48/64/128/256)
  • معاينة 512 للريليز
"""

import io
import os

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)

FONT_PATH = os.path.join(ROOT, "public", "fonts", "Tajawal-Black.ttf")

BG_AND_BRACKETS = """<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#1E1E26"/>
      <stop offset="100%" stop-color="#141418"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="30">
    <path d="M 812 344 V 238 Q 812 212 786 212 H 680" stroke-linecap="round"/>
    <path d="M 812 680 V 786 Q 812 812 786 812 H 680" stroke-linecap="round"/>
    <path d="M 212 344 V 238 Q 212 212 238 212 H 344" stroke-linecap="round"/>
    <path d="M 212 680 V 786 Q 212 812 238 812 H 344" stroke-linecap="round"/>
  </g>
</svg>"""


def render_letter_layer(size: int = 1024) -> Image.Image:
    """حرف s برتقالي — Tajawal Black من ملف المستودع مباشرة.

    الحرف يُرسم على لوحة أكبر ثم يُقص لمركز الضبط البصري: حجم
    الخط 4.1× ربع اللوحة يجعل عرض الحرف ~45% من الأيقونة — نفس
    الوزن البصري للسين العربية في أيقونة الأندرويد الأصلية.
    """
    scale = size // 4  # 256 عند 1024
    font = ImageFont.truetype(FONT_PATH, int(4.1 * scale))
    # لوحة عريضة لقياس النص الحقيقي ثم قصّه بدقة.
    canvas = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    text = "s"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    # تمركز أفقي، ورفع بصري ~2% (الحرف الصغير يبدو نازلاً عن
    # المنتصف الحسابي فيركز فوق خط الأساس قليلاً).
    x = (canvas.width - text_w) // 2 - bbox[0]
    y = (canvas.height - text_h) // 2 - bbox[1] - int(size * 0.02)
    draw.text((x, y), text, font=font, fill=(249, 115, 22, 255))
    # قصّ إلى مربع الحجم المطلوب حول المركز.
    left = (canvas.width - size) // 2
    top = (canvas.height - size) // 2
    return canvas.crop((left, top, left + size, top + size))


def composite_1024() -> Image.Image:
    """الطبقتان مدمجتين في لوحة RGBA واحدة 1024×1024."""
    bg_buf = io.BytesIO()
    cairosvg.svg2png(
        bytestring=BG_AND_BRACKETS.encode("utf-8"),
        write_to=bg_buf,
        output_width=1024,
        output_height=1024,
    )
    bg_buf.seek(0)
    base = Image.open(bg_buf).convert("RGBA")
    letter = render_letter_layer(1024)
    base.alpha_composite(letter)
    return base


FULL = composite_1024()

# ── PNG بكل المقاسات ──
jobs = [
    (32, os.path.join(OUT, "32x32.png")),
    (128, os.path.join(OUT, "128x128.png")),
    (256, os.path.join(OUT, "128x128@2x.png")),
    (512, os.path.join(ROOT, "docs", "icon-preview-512.png")),
]
for px, out in jobs:
    os.makedirs(os.path.dirname(out), exist_ok=True)
    resized = FULL.resize((px, px), Image.LANCZOS)
    resized.save(out)
    print(f"  + {os.path.relpath(out, ROOT)} ({px}x{px}, RGBA)")

# ── ICO متعدد المقاسات ──
ico_path = os.path.join(OUT, "icon.ico")
base256 = FULL.resize((256, 256), Image.LANCZOS)
base256.save(
    ico_path,
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(f"  + src-tauri/icons/icon.ico ({os.path.getsize(ico_path):,} bytes، 7 مقاسات)")
print("تم: أيقونة سطح المكتب — هوية أندرويد بحرف s الإنجليزية.")
