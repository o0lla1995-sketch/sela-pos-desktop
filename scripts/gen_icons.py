#!/usr/bin/env python3
"""توليد أيقونات سيلا POS لسطح المكتب — مطابقة حرفياً لأيقونة أندرويد.

المصدر: نفس ملفات SVG المعتمدة في تطبيق الأندرويد (assets-design/icons):
  • الخلفية: تدرج شعاعي داكن #1E1E26 → #141418
  • الأمامية: أقواس مسح بيضاء (زوايا أربع) + س برتقالية #F97316 (Tajawal Black)

الناتج في src-tauri/icons/:
  • 32x32.png / 128x128.png / 128x128@2x.png (256)
  • icon.ico متعدد المقاسات (16/24/32/48/64/128/256)
  • معاينة 512 للريليز
"""
import io
import os

import cairosvg
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src-tauri", "icons")
os.makedirs(OUT, exist_ok=True)

BG = """<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#1E1E26"/>
      <stop offset="100%" stop-color="#141418"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
</svg>"""

FG = """<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g fill="none" stroke="#FFFFFF" stroke-width="30">
    <path d="M 812 344 V 238 Q 812 212 786 212 H 680" stroke-linecap="round"/>
    <path d="M 812 680 V 786 Q 812 812 786 812 H 680" stroke-linecap="round"/>
    <path d="M 212 344 V 238 Q 212 212 238 212 H 344" stroke-linecap="round"/>
    <path d="M 212 680 V 786 Q 212 812 238 812 H 344" stroke-linecap="round"/>
  </g>
  <text x="512" y="676" font-family="Tajawal" font-weight="900" font-size="470"
        fill="#F97316" text-anchor="middle">س</text>
</svg>"""


def composite_1024() -> str:
    """الطبقتان مدمجتين في لوحة واحدة 1024×1024 (تطابق الأيقونة
    الكاملة القديمة للأندرويد ic_launcher)."""
    fg_inner = FG.split(">", 1)[1].rsplit("</svg>", 1)[0]
    # من الخلفية نأخذ <defs> وحدها (الرسم النهائي يعاد ترتيبه أدناه).
    defs = BG.split("<defs>", 1)[1].rsplit("</defs>", 1)[0]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>{defs}</defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  {fg_inner.strip()}
</svg>'''


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
    cairosvg.svg2png(bytestring=FULL.encode("utf-8"), write_to=out,
                     output_width=px, output_height=px)
    print(f"  + {os.path.relpath(out, ROOT)} ({px}x{px})")

# ── ICO متعدد المقاسات ──
# PIL يبني كل مقاس بالتصغير من اللوحة الكبيرة (append_images غير
# مدعوم للـ ICO) — نمرر قائمة المقاسات ونرسم من 256px.
base = None
png256 = io.BytesIO()
cairosvg.svg2png(bytestring=FULL.encode("utf-8"), write_to=png256,
                 output_width=256, output_height=256)
png256.seek(0)
base = Image.open(png256).convert("RGBA")
ico_path = os.path.join(OUT, "icon.ico")
base.save(ico_path, format="ICO",
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                (64, 64), (128, 128), (256, 256)])
print(f"  + src-tauri/icons/icon.ico ({os.path.getsize(ico_path):,} bytes، 7 مقاسات)")
print("تم: أيقونات سطح المكتب مطابقة لأندرويد حرفياً.")
