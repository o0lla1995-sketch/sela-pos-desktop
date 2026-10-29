#!/usr/bin/env python3
"""Round 80 (desktop #4a): trim the baked-in uniform borders from the
official payment-method logo PNGs.

Root cause of the merchant complaint «تبدو صغيرة في اطار الصورة»:
the downloaded app-icon artwork carries baked-in margins (8–18% per
side on 4 of 6 logos) INSIDE the 160×160 canvas, and on top of that
the .pmi-real chip adds 6% CSS padding — the actual logo ends up
occupying ~65–75% of its frame.

Fix: auto-crop each PNG to its non-uniform-border bounding box
(detected per-side against the corner color), keep a tiny 2% safety
margin, re-save. Then CSS padding drops to 2.5%.
"""
from PIL import Image
import os

D = '/home/z/my-project/sela-pos-desktop/src/assets/pm-logos'
SAFETY = 0.02  # keep 2% margin so rounded corners never clip


def border_thickness_side(img, is_top: bool) -> int:
    """Rows of a uniform color matching the corners, scanned from one side."""
    px = img.load()
    w, h = img.size
    corner = px[0, 0] if is_top else px[0, h - 1]

    def row_uniform(y):
        for x in range(0, w, 4):
            p = px[x, y]
            if p[:3] != corner[:3] or p[3] != corner[3]:
                return False
        return True

    t = 0
    rng = range(h) if is_top else range(h - 1, -1, -1)
    for y in rng:
        if row_uniform(y):
            t += 1
        else:
            break
    return t


def border_thickness_vertical(img, is_left: bool) -> int:
    px = img.load()
    w, h = img.size
    corner = px[0, 0] if is_left else px[w - 1, 0]

    def col_uniform(x):
        for y in range(0, h, 4):
            p = px[x, y]
            if p[:3] != corner[:3] or p[3] != corner[3]:
                return False
        return True

    t = 0
    rng = range(w) if is_left else range(w - 1, -1, -1)
    for x in rng:
        if col_uniform(x):
            t += 1
        else:
            break
    return t


for f in sorted(os.listdir(D)):
    if not f.endswith('.png'):
        continue
    path = os.path.join(D, f)
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    top = border_thickness_side(img, True)
    bottom = border_thickness_side(img, False)
    left = border_thickness_vertical(img, True)
    right = border_thickness_vertical(img, False)
    # Only trim when the margin is meaningful (>= 4px per side)
    if min(top, bottom, left, right) < 4:
        print(f'{f:22s} no meaningful border (t{top} b{bottom} l{left} r{right}) — skipped')
        continue
    sx = max(0, left - round(w * SAFETY))
    sy = max(0, top - round(h * SAFETY))
    ex = min(w, w - right + round(w * SAFETY))
    ey = min(h, h - bottom + round(h * SAFETY))
    cropped = img.crop((sx, sy, ex, ey))
    # normalize back to square canvas (contain, centered) is NOT needed:
    # CSS uses object-fit: contain; a tight non-square crop still fills
    # the square chip better than the padded original. But keeping the
    # artwork square keeps the white chip visually balanced — pad to
    # square with the corner color.
    cw, ch = cropped.size
    side = max(cw, ch)
    canvas = Image.new('RGBA', (side, side), px_corner := img.getpixel((0, 0)))
    canvas.paste(cropped, ((side - cw) // 2, (side - ch) // 2))
    canvas.save(path, optimize=True)
    print(
        f'{f:22s} trimmed t{top} b{bottom} l{left} r{right} '
        f'-> {side}x{side} ({os.path.getsize(path)} bytes)'
    )
