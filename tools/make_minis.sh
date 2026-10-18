#!/bin/sh
# Лёгкие копии превью для ленты «2 в ряд» на телефоне: <имя>-mini.mp4 — 10 с, 360px, без звука, сильное сжатие.
# Запускать после добавления новых видео: sh tools/make_minis.sh  (делает недостающие)
for f in assets/*-preview.mp4; do
  m="${f%-preview.mp4}-mini.mp4"
  [ -f "$m" ] && [ "$m" -nt "$f" ] && continue
  ffmpeg -v error -y -i "$f" -t 10 -an -vf "scale=360:-2,fps=24" -c:v libx264 -preset veryslow -crf 32 -profile:v high -pix_fmt yuv420p -movflags +faststart "$m"
  echo "$m"
done
# заставки плиток — первый кадр превью (для рилсов; у обложек «Комплекса» свои p<N>-preview.jpg)
for f in assets/*-preview.mp4; do j="${f%.mp4}.jpg"; [ -f "$j" ] && continue; ffmpeg -v error -y -ss 0.05 -i "$f" -frames:v 1 -vf "scale=540:-2" -q:v 5 "$j"; echo "$j"; done
