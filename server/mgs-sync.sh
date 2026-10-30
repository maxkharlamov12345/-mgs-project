#!/usr/bin/env bash
# MGS: каждую минуту (systemd-таймер mgs-sync.timer) подтягивает изменения из GitHub:
#   /srv/www/test ← ветка main, /srv/www/prod ← ветка prod (если её ещё нет — main);
#   затем применяет изменения настроек сервера из server/ (ветка main): docker-compose.yml, Caddyfile, admin/,
#   и обновляет сам себя. Так правки сервера доходят без консоли.
set -u
exec 9>/run/mgs-sync.lock
flock -n 9 || exit 0
BASE=/opt/mgs
LOG=/var/log/mgs-sync.log
log(){ echo "$(date '+%F %T') $*" >> "$LOG"; }

sync(){ d=$1; b=$2; git -C "$d" fetch -q --depth 1 origin "$b" 2>/dev/null && git -C "$d" reset -q --hard FETCH_HEAD; }
sync /srv/www/test main
if git -C /srv/www/prod ls-remote --exit-code --heads origin prod >/dev/null 2>&1; then sync /srv/www/prod prod; else sync /srv/www/prod main; fi

SRC=/srv/www/test/server
[ -d "$SRC" ] && [ -f "$BASE/.env" ] || exit 0

# 1) сам скрипт
if ! cmp -s "$SRC/mgs-sync.sh" /usr/local/bin/mgs-sync; then
  install -m 755 "$SRC/mgs-sync.sh" /usr/local/bin/mgs-sync && log "mgs-sync обновлён"
fi

# 2) настройки контейнеров
changed=0
for f in docker-compose.yml Caddyfile; do
  if ! cmp -s "$SRC/$f" "$BASE/$f"; then cp "$SRC/$f" "$BASE/$f"; changed=1; log "обновлён $f"; fi
done
mkdir -p "$BASE/admin"
admin_changed=0
if ! diff -rq "$SRC/admin" "$BASE/admin" >/dev/null 2>&1; then
  rm -rf "$BASE/admin.new" && cp -r "$SRC/admin" "$BASE/admin.new" && rm -rf "$BASE/admin" && mv "$BASE/admin.new" "$BASE/admin"
  admin_changed=1; log "обновлён admin/"
fi

convert_changed=0
mkdir -p "$BASE/convert"
if ! diff -rq "$SRC/convert" "$BASE/convert" >/dev/null 2>&1; then
  rm -rf "$BASE/convert.new" && cp -r "$SRC/convert" "$BASE/convert.new" && rm -rf "$BASE/convert" && mv "$BASE/convert.new" "$BASE/convert"
  convert_changed=1; log "обновлён convert/"
fi

cd "$BASE" || exit 0
# 3) миграции базы: server/migrations/*.sql по порядку, каждая один раз (учёт — таблица ops.migrations)
psql_(){ docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
if ls "$SRC"/migrations/*.sql >/dev/null 2>&1; then
  psql_ -c "create schema if not exists ops; create table if not exists ops.migrations(name text primary key, applied_at timestamptz default now());" >/dev/null 2>&1
  done_list=$(psql_ -At -c "select name from ops.migrations" 2>/dev/null) || done_list=__fail__
  if [ "$done_list" != __fail__ ]; then
    for f in "$SRC"/migrations/*.sql; do
      n=$(basename "$f")
      grep -qxF "$n" <<<"$done_list" && continue
      if { echo "begin;"; cat "$f"; echo; echo "insert into ops.migrations(name) values ('$n');"; echo "commit;"; } | psql_ >> "$LOG" 2>&1
      then log "миграция $n применена"; else log "ОШИБКА миграции $n"; break; fi
    done
  fi
fi
if [ $changed = 1 ]; then
  if docker compose up -d --remove-orphans >> "$LOG" 2>&1; then log "контейнеры обновлены"; else log "ОШИБКА docker compose up"; fi
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >> "$LOG" 2>&1 || true
fi
[ $admin_changed = 1 ] && docker compose restart admin >> "$LOG" 2>&1 || true
if [ $convert_changed = 1 ]; then
  if docker compose build convert >> "$LOG" 2>&1 && docker compose up -d convert >> "$LOG" 2>&1; then log "convert пересобран"; else log "ОШИБКА сборки convert"; fi
fi
exit 0
