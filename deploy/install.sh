#!/usr/bin/env bash
# Установка «Моей зачётки» на чистый сервер Ubuntu 22.04 / 24.04.
#
# Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/Grisha-Kr/zachetka/main/deploy/install.sh | bash -s -- ДОМЕН ПОЧТА "ВАШЕ ИМЯ"
#
#   ДОМЕН  — адрес приложения без https, например zachetka-ivanov.ru
#   ПОЧТА  — ваша почта: станет входом в панель администратора и контактом в политике конфиденциальности
#   ИМЯ    — как вас указать в политике конфиденциальности (оператор данных)
#
# Повторный запуск безопасен: он обновит код и программу, данные не тронет.

set -euo pipefail

PB_VERSION="0.40.3"
REPO_URL="${REPO_URL:-https://github.com/Grisha-Kr/zachetka.git}"
APP=/opt/zachetka

DOMAIN="${1:-}"
CONTACT="${2:-}"
OWNER="${3:-}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "запустите команду от имени root."
[ -n "$DOMAIN" ] || fail "не указан домен. Пример: bash install.sh zachetka-ivanov.ru me@yandex.ru \"Иван Иванов\""
[ -n "$CONTACT" ] || fail "не указана почта."
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

say "1/6. Устанавливаю нужные программы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git unzip curl ufw openssl ca-certificates >/dev/null

say "2/6. Проверяю, что домен $DOMAIN указывает на этот сервер"
MY_IP="$(curl -fsS4 https://ifconfig.me 2>/dev/null || curl -fsS4 https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -n "$MY_IP" ] && [ "$MY_IP" != "$DNS_IP" ]; then
  echo "  Домен $DOMAIN сейчас указывает на «${DNS_IP:-никуда}», а у сервера адрес $MY_IP."
  echo "  Пропишите A-запись домена на $MY_IP и подождите 15–60 минут, потом запустите команду снова."
  echo "  Если вы уверены, что всё настроено, продолжите: SKIP_DNS_CHECK=1 перед командой."
  [ "${SKIP_DNS_CHECK:-0}" = "1" ] || exit 1
fi

say "3/6. Загружаю код приложения"
id zachetka >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin zachetka
mkdir -p "$APP"
if [ -d "$APP/src/.git" ]; then
  git -C "$APP/src" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP/src"
fi

say "4/6. Устанавливаю PocketBase $PB_VERSION"
case "$(dpkg --print-architecture)" in
  amd64) ARCH=amd64 ;;
  arm64) ARCH=arm64 ;;
  *) fail "неподдерживаемая архитектура процессора $(dpkg --print-architecture)." ;;
esac
if ! "$APP/pocketbase" --version 2>/dev/null | grep -q "$PB_VERSION"; then
  curl -fsSL -o /tmp/pocketbase.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -o -q /tmp/pocketbase.zip pocketbase -d "$APP"
  rm -f /tmp/pocketbase.zip
  chmod +x "$APP/pocketbase"
fi

if [ ! -f "$APP/zachetka.env" ]; then
  cat > "$APP/zachetka.env" <<EOF
APP_URL=https://$DOMAIN
OWNER_NAME=$OWNER
CONTACT_EMAIL=$CONTACT
USER_QUOTA_MB=500
EOF
fi
chmod 600 "$APP/zachetka.env"
chown -R zachetka:zachetka "$APP"

say "5/6. Настраиваю автозапуск и защищённое соединение"
cat > /etc/systemd/system/zachetka.service <<EOF
[Unit]
Description=Моя зачётка (PocketBase)
After=network-online.target
Wants=network-online.target

[Service]
User=zachetka
Group=zachetka
WorkingDirectory=$APP
EnvironmentFile=$APP/zachetka.env
ExecStart=$APP/pocketbase serve $DOMAIN --dir $APP/pb_data --publicDir $APP/src/pb_public --hooksDir $APP/src/pb_hooks --migrationsDir $APP/src/pb_migrations
Restart=always
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
EOF

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable zachetka >/dev/null 2>&1
systemctl restart zachetka
sleep 4
systemctl is-active --quiet zachetka || { journalctl -u zachetka -n 30 --no-pager; fail "приложение не запустилось, текст ошибки выше."; }

say "6/6. Создаю вход в панель администратора"
SU_FILE="$APP/superuser.txt"
if [ ! -f "$SU_FILE" ]; then
  SU_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  sudo -u zachetka "$APP/pocketbase" superuser upsert "$CONTACT" "$SU_PASS" --dir "$APP/pb_data" >/dev/null
  printf 'Панель: https://%s/_/\nПочта: %s\nПароль: %s\n' "$DOMAIN" "$CONTACT" "$SU_PASS" > "$SU_FILE"
  chmod 600 "$SU_FILE"
fi

say "Готово!"
echo "  Приложение:   https://$DOMAIN"
echo "  Сразу откройте его и создайте аккаунт владельца: первый зарегистрированный становится администратором."
echo
echo "  Вход в панель администратора (сохраните себе):"
sed 's/^/    /' "$SU_FILE"
echo
echo "  Эти данные лежат в $SU_FILE. Обновление: bash $APP/src/deploy/update.sh"
