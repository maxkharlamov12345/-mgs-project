#!/bin/sh
# Тестовые VP9-копии всех видео (в тестовом Chromium нет H.264 — без них видео в проверке не играют).
# Запуск из корня репозитория: sh tools/tests/qa/make_vp9.sh   (~1 мин, кладёт в tools/tests/qa/vp9/, в git не попадает)
D=tools/tests/qa/vp9; mkdir -p $D
for f in assets/*.mp4; do o=$D/$(basename $f); [ -f $o ] && [ $o -nt $f ] && continue
  ffmpeg -v error -y -i $f -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -crf 42 -b:v 0 -an -movflags +faststart $o; done
echo готово: $(ls $D | wc -l) видео
