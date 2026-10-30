#!/usr/bin/env bash
# Установка сервера MGS (Ubuntu 24.04): облегчённый Supabase + HTTPS + app (сотрудники), my (клиенты), test.
# Запуск в консоли сервера (под root):
#   curl -fsSL https://raw.githubusercontent.com/maxkharlamov12345/-mgs-project/main/server/install.sh | bash
# Повторный запуск безопасен: секреты и данные не перезаписываются.
set -euo pipefail

MAIN_DOMAIN=mgsmebel.com
API_DOMAIN=api.$MAIN_DOMAIN
APP_DOMAIN=app.$MAIN_DOMAIN
MY_DOMAIN=my.$MAIN_DOMAIN
TEST_DOMAIN=test.$MAIN_DOMAIN
REPO=https://github.com/maxkharlamov12345/-mgs-project.git
BASE=/opt/mgs
step(){ printf '\n\033[1;32m== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Запустите под root"; exit 1; }

step "1/7 Пакеты (Docker, git)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q docker.io docker-compose-v2 git openssl curl ufw >/dev/null
mkdir -p /etc/docker
# зеркало Docker Hub от Timeweb — Docker Hub из России может не отвечать
[ -f /etc/docker/daemon.json ] || echo '{"registry-mirrors":["https://dockerhub.timeweb.cloud"],"log-opts":{"max-size":"20m","max-file":"3"}}' > /etc/docker/daemon.json
systemctl enable --now docker >/dev/null
systemctl restart docker
# подкачка 2 ГБ — запас по памяти на сервере с 2 ГБ
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "2/7 Брандмауэр (открыты только SSH, HTTP, HTTPS)"
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

step "3/7 Код: test — ветка main, app/my — ветка prod"
mkdir -p /srv/www
[ -d /srv/www/test/.git ] || git clone -q --depth 1 -b main "$REPO" /srv/www/test
if [ ! -d /srv/www/prod/.git ]; then
  if git ls-remote --exit-code --heads "$REPO" prod >/dev/null 2>&1; then git clone -q --depth 1 -b prod "$REPO" /srv/www/prod
  else git clone -q --depth 1 -b main "$REPO" /srv/www/prod; fi
fi
# каждую минуту: код из GitHub + изменения настроек сервера (server/) — см. server/mgs-sync.sh
install -m 755 /srv/www/test/server/mgs-sync.sh /usr/local/bin/mgs-sync
cat > /etc/systemd/system/mgs-sync.service <<'S'
[Unit]
Description=MGS: обновление сайта из GitHub
[Service]
Type=oneshot
ExecStart=/usr/local/bin/mgs-sync
S
cat > /etc/systemd/system/mgs-sync.timer <<'S'
[Unit]
Description=MGS: обновление сайта из GitHub каждую минуту
[Timer]
OnBootSec=30
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
S
systemctl daemon-reload && systemctl enable --now mgs-sync.timer >/dev/null

step "4/7 Supabase: файлы и секретные ключи"
mkdir -p "$BASE" && cd "$BASE"
cp /srv/www/test/server/docker-compose.yml /srv/www/test/server/Caddyfile "$BASE"/
rm -rf "$BASE/admin" && cp -r /srv/www/test/server/admin "$BASE/admin"
if [ ! -d "$BASE/src" ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase.git "$BASE/src"
  git -C "$BASE/src" sparse-checkout set docker/volumes/db
fi
mkdir -p volumes/db volumes/storage
for f in realtime.sql webhooks.sql roles.sql jwt.sql _supabase.sql logs.sql pooler.sql; do
  [ -f "volumes/db/$f" ] || cp "src/docker/volumes/db/$f" volumes/db/
done
if [ ! -f .env ]; then
  b64url(){ openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  JWT_SECRET=$(openssl rand -hex 32)
  NOW=$(date +%s); EXP=$((NOW + 10*365*24*3600))
  jwt(){ local h p s
    h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
    p=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' "$1" "$NOW" "$EXP" | b64url)
    s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
    echo "$h.$p.$s"; }
  cat > .env <<EOF
MAIN_DOMAIN=$MAIN_DOMAIN
API_DOMAIN=$API_DOMAIN
APP_DOMAIN=$APP_DOMAIN
MY_DOMAIN=$MY_DOMAIN
TEST_DOMAIN=$TEST_DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$JWT_SECRET
ANON_KEY=$(jwt anon)
SERVICE_ROLE_KEY=$(jwt service_role)
EOF
  chmod 600 .env
  echo "Ключи созданы и сохранены в $BASE/.env (только на сервере)."
fi
set -a; . ./.env; set +a

step "5/7 Запуск (первый раз качает образы, 3–7 минут)"
docker compose pull -q
docker compose up -d
echo -n "Ждём базу и хранилище"
for i in $(seq 1 120); do
  st=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q storage)" 2>/dev/null || true)
  [ "$st" = healthy ] && break; echo -n "."; sleep 5
done; echo
[ "$st" = healthy ] || { echo "Хранилище не запустилось. Пришлите вывод: docker compose -f $BASE/docker-compose.yml logs --tail 50"; exit 1; }

step "6/7 Таблицы проектов и хранилище моделей"
{ sed 's/52428800/209715200/' /srv/www/test/3d/setup.sql
  echo "grant select, insert, update, delete on public.projects, public.items to authenticated;"
  echo "grant all on public.projects, public.items to service_role;"
} | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null
echo "Готово: projects, items, shared_project(), бакет models (до 200 МБ на файл)."

step "7/7 Сотрудник для входа в кабинет"
NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose ps -q auth)")
add_user(){
  local email pass
  read -r -p "Почта сотрудника: " email </dev/tty
  read -r -s -p "Пароль (не меньше 8 символов): " pass </dev/tty; echo
  docker run --rm --network "$NET" curlimages/curl:8.11.1 -s -o /dev/null -w "%{http_code}" \
    -X POST http://auth:9999/admin/users -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\",\"email_confirm\":true}" | grep -q '^20' \
    && echo "Сотрудник $email создан." || echo "Не удалось создать (возможно, такой уже есть)."
}
read -r -p "Создать сотрудника сейчас? [Y/n] " ans </dev/tty || ans=n
[ "${ans:-Y}" = n ] || [ "${ans:-Y}" = N ] || add_user

cat > /usr/local/bin/mgs-add-user <<S
#!/usr/bin/env bash
cd $BASE && set -a && . ./.env && set +a
NET=\$(docker inspect -f '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}{{end}}' "\$(docker compose ps -q auth)")
read -r -p "Почта сотрудника: " email; read -r -s -p "Пароль: " pass; echo
docker run --rm --network "\$NET" curlimages/curl:8.11.1 -s -X POST http://auth:9999/admin/users -H "Authorization: Bearer \$SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"email\":\"\$email\",\"password\":\"\$pass\",\"email_confirm\":true}" | head -c 300; echo
S
chmod +x /usr/local/bin/mgs-add-user

printf '\n\033[1;32m== ГОТОВО ==\033[0m\n'
echo "API:     https://$API_DOMAIN"
echo "Сотрудники: https://$APP_DOMAIN   (рабочая версия)"
echo "Клиенты:    https://$MY_DOMAIN"
echo "Тест:    https://$TEST_DOMAIN/3d/"
echo
echo "Пришлите в чат ТОЛЬКО эту строку (публичный ключ, он и так виден в коде сайта):"
echo "ANON_KEY=$ANON_KEY"
echo
echo "Ещё сотрудник: mgs-add-user"
