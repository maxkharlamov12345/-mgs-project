#!/usr/bin/env python3
"""Коллаж 2×2 для плитки «Комплекса» — одна картинка вместо четырёх.

  python3 tools/make_collage.py assets/collage-<имя>.jpg фото1 фото2 фото3 фото4

Порядок фото: верх-лево, верх-право, низ-лево, низ-право (кухня, прихожая, санузел, детская/другое).
Размер 1000×1250 (4:5), зазоры 8 px цвета фона сайта — в ленте плитка обрезается по центру,
поэтому швы всегда остаются посередине. JPEG q74, progressive.
"""
import sys
from PIL import Image, ImageOps

W, H, GAP, BG = 1000, 1250, 8, (15, 14, 12)

def main(out, *src):
    assert len(src) == 4, 'нужно ровно 4 фото'
    cw, ch = (W - GAP) // 2, (H - GAP) // 2
    canvas = Image.new('RGB', (W, H), BG)
    for i, p in enumerate(src):
        im = ImageOps.fit(Image.open(p).convert('RGB'), (cw, ch), Image.LANCZOS, centering=(0.5, 0.5))
        canvas.paste(im, ((i % 2) * (cw + GAP) + (W - 2 * cw - GAP) * (i % 2), (i // 2) * (ch + GAP) + (H - 2 * ch - GAP) * (i // 2)))
    canvas.save(out, 'JPEG', quality=74, progressive=True, optimize=True)

if __name__ == '__main__':
    main(*sys.argv[1:])
