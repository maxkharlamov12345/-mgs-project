#!/usr/bin/env python3
"""Лёгкие превью фото для плиток ленты: assets/t/<имя>.jpg, 640px по ширине, q68.
Запускать после добавления новых фото: python3 tools/make_thumbs.py  (делает только недостающие)."""
import os, glob
from PIL import Image
os.makedirs('assets/t', exist_ok=True)
n = 0
for f in sorted(glob.glob('assets/*.jpg')):
    out = 'assets/t/' + os.path.basename(f)
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(f):
        continue
    im = Image.open(f).convert('RGB')
    if im.width > 640:
        im = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS)
    im.save(out, 'JPEG', quality=68, progressive=True, optimize=True)
    n += 1
print('превью сделано:', n)
