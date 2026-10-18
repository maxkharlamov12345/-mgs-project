#!/usr/bin/env python3
"""Превью фото для плиток ленты: assets/t/<имя>.webp — 960px по ширине, WebP q82 (чётко и на Retina-экранах).
Полные фото на сайте — оригинальные JPEG (WebP-копии полных фото убраны: Максу заметна разница).
Делает только недостающие / устаревшие. Запускать после добавления новых фото и после make_minis.sh:
    python3 tools/make_thumbs.py"""
import os, glob
from PIL import Image
W, Q = 960, 82
os.makedirs('assets/t', exist_ok=True)
t = 0
for f in sorted(glob.glob('assets/*.jpg')):
    th = 'assets/t/' + os.path.splitext(os.path.basename(f))[0] + '.webp'
    if os.path.exists(th) and os.path.getmtime(th) >= os.path.getmtime(f):
        continue
    im = Image.open(f).convert('RGB')
    s = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS) if im.width > W else im
    s.save(th, 'WEBP', quality=Q, method=6); t += 1
print('превью сделано:', t)

# пропорции всех фото (высота / ширина) — чтобы слайдер просмотра сразу знал размеры и не «перестраивался»,
# пока фото догружаются. Страницы подключают assets/dims.js и берут оттуда window.MGS_RATIOS.
import json
R = {}
for f in sorted(glob.glob('assets/*.jpg')):
    w, h = Image.open(f).size
    R[f] = round(h / w, 4)
open('assets/dims.js', 'w').write('window.MGS_RATIOS=' + json.dumps(R, separators=(',', ':')) + ';\n')
print('пропорции записаны:', len(R))
