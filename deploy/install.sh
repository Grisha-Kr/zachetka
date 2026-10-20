#!/usr/bin/env bash
# Установка «Моей зачётки» на сервер Ubuntu 22.04 / 24.04.
#
# Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/Grisha-Kr/zachetka/main/deploy/install.sh | bash -s -- АДРЕС ПОЧТА "ВАШЕ ИМЯ"
#
#   АДРЕС  — полный адрес приложения без https, например zachetka.grishaweb.ru
#   ПОЧТА  — ваша почта: вход в панель администратора и контакт в политике конфиденциальности
#   ИМЯ    — как указать вас в политике конфиденциальности (оператор данных)
#
# Как устроен сервер (рассчитан на несколько приложений):
#   Caddy принимает все запросы на портах 80/443, сам получает сертификаты https
#   и по адресу направляет запрос в нужное приложение.
#   Каждое приложение: своя папка /opt/ИМЯ, свой порт на 127.0.0.1, своя служба systemd,
#   свой файл /etc/caddy/sites/ИМЯ.caddy.
#
# Повторный запуск безопасен: обновит код и программу, данные не тронет.

set -euo pipefail

APP="zachetka"            # имя приложения: папка, служба, пользователь
PORT="8090"               # внутренний порт приложения (у следующих приложений 8091, 8092…)
PB_VERSION="0.40.3"
REPO_URL="${REPO_URL:-https://github.com/Grisha-Kr/zachetka.git}"
APP_DIR="/opt/$APP"

DOMAIN="${1:-}"
CONTACT="${2:-}"
OWNER="${3:-}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "запустите команду от имени root."
[ -n "$DOMAIN" ] || fail "не указан адрес. Пример: bash install.sh zachetka.grishaweb.ru me@yandex.ru \"Иван Иванов\""
[ -n "$CONTACT" ] || fail "не указана почта."
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

say "1/7. Устанавливаю нужные программы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git unzip curl ufw openssl ca-certificates caddy >/dev/null

say "2/7. Проверяю, что адрес $DOMAIN указывает на этот сервер"
MY_IP="$(curl -fsS4 --max-time 10 https://ifconfig.me 2>/dev/null || curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -n "$MY_IP" ] && [ "$MY_IP" != "$DNS_IP" ]; then
  echo "  Адрес $DOMAIN сейчас указывает на «${DNS_IP:-никуда}», а у сервера IP $MY_IP."
  echo "  Добавьте A-запись в настройках домена и подождите 15–60 минут, потом запустите команду снова."
  echo "  Если уверены, что всё настроено, добавьте SKIP_DNS_CHECK=1 перед командой."
  [ "${SKIP_DNS_CHECK:-0}" = "1" ] || exit 1
fi

say "3/7. Загружаю код приложения"
id "$APP" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/src/.git" ]; then
  git -C "$APP_DIR/src" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR/src"
fi

say "4/7. Устанавливаю PocketBase $PB_VERSION"
case "$(dpkg --print-architecture)" in
  amd64) ARCH=amd64 ;;
  arm64) ARCH=arm64 ;;
  *) fail "неподдерживаемая архитектура процессора $(dpkg --print-architecture)." ;;
esac
if ! "$APP_DIR/pocketbase" --version 2>/dev/null | grep -q "$PB_VERSION"; then
  curl -fsSL -o /tmp/pocketbase.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -o -q /tmp/pocketbase.zip pocketbase -d "$APP_DIR"
  rm -f /tmp/pocketbase.zip
  chmod +x "$APP_DIR/pocketbase"
fi

if [ ! -f "$APP_DIR/$APP.env" ]; then
  cat > "$APP_DIR/$APP.env" <<EOF
APP_URL=https://$DOMAIN
OWNER_NAME=$OWNER
CONTACT_EMAIL=$CONTACT
USER_QUOTA_MB=500
BEHIND_PROXY=1
EOF
fi
chmod 600 "$APP_DIR/$APP.env"
chown -R "$APP:$APP" "$APP_DIR"

say "5/7. Настраиваю автозапуск приложения"
cat > "/etc/systemd/system/$APP.service" <<EOF
[Unit]
Description=$APP (PocketBase)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP
Group=$APP
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/$APP.env
ExecStart=$APP_DIR/pocketbase serve --http 127.0.0.1:$PORT --dir $APP_DIR/pb_data --publicDir $APP_DIR/src/pb_public --hooksDir $APP_DIR/src/pb_hooks --migrationsDir $APP_DIR/src/pb_migrations
Restart=always
RestartSec=5
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$APP" >/dev/null 2>&1
systemctl restart "$APP"
sleep 4
systemctl is-active --quiet "$APP" || { journalctl -u "$APP" -n 30 --no-pager; fail "приложение не запустилось, текст ошибки выше."; }

say "6/7. Настраиваю адрес https://$DOMAIN"
mkdir -p /etc/caddy/sites
# HTTP/3 выключен, TLS только 1.2: в части российских сетей соединения с TLS 1.3
# обрываются по дороге (рекомендация хостинга AdminVPS). Включить TLS 1.3 обратно:
# в файлах /etc/caddy/sites/*.caddy заменить "tls1.2 tls1.2" на "tls1.2 tls1.3".
cat > /etc/caddy/Caddyfile <<EOF
{
	email $CONTACT
	servers {
		protocols h1 h2
	}
}

import /etc/caddy/sites/*.caddy
EOF
cat > "/etc/caddy/sites/$APP.caddy" <<EOF
$DOMAIN {
	tls {
		protocols tls1.2 tls1.2
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; fail "ошибка в настройках Caddy, текст выше."; }

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

say "7/7. Создаю вход в панель администратора"
SU_FILE="$APP_DIR/superuser.txt"
if [ ! -f "$SU_FILE" ]; then
  SU_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  sudo -u "$APP" "$APP_DIR/pocketbase" superuser upsert "$CONTACT" "$SU_PASS" --dir "$APP_DIR/pb_data" >/dev/null
  printf 'Панель: https://%s/_/\nПочта: %s\nПароль: %s\n' "$DOMAIN" "$CONTACT" "$SU_PASS" > "$SU_FILE"
  chmod 600 "$SU_FILE"
fi

say "Готово!"
echo "  Приложение:   https://$DOMAIN"
echo "  Первое открытие может занять до минуты: сервер получает сертификат https."
echo "  Сразу создайте аккаунт владельца: первый зарегистрированный становится администратором."
echo
echo "  Вход в панель администратора (сохраните себе):"
sed 's/^/    /' "$SU_FILE"
echo
echo "  Эти данные лежат в $SU_FILE. Обновление: bash $APP_DIR/src/deploy/update.sh"
