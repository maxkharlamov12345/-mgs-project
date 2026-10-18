#!/usr/bin/env python3
"""Лёгкие копии фото для сайта (делает только недостающие / устаревшие):
  assets/<имя>.webp    — то же фото в WebP (q85, почти как исходник): на сайте показываем его, JPEG остаётся исходником;
  assets/t/<имя>.webp  — превью для плиток ленты, 640px по ширине, q72.
Полные фото — на ~20% легче JPEG при том же качестве, превью — на ~45% (iPhone — с iOS 14).
Запускать после добавления новых фото: python3 tools/make_thumbs.py"""
import os, glob
from PIL import Image
os.makedirs('assets/t', exist_ok=True)

def fresh(out, src):
    return os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src)

n = t = 0
for f in sorted(glob.glob('assets/*.jpg')):
    base = os.path.splitext(os.path.basename(f))[0]
    full, th = 'assets/' + base + '.webp', 'assets/t/' + base + '.webp'
    if fresh(full, f) and fresh(th, f):
        continue
    im = Image.open(f).convert('RGB')
    if not fresh(full, f):
        im.save(full, 'WEBP', quality=85, method=6); n += 1
    if not fresh(th, f):
        s = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS) if im.width > 640 else im
        s.save(th, 'WEBP', quality=72, method=6); t += 1
print('webp сделано:', n, '| превью сделано:', t)
