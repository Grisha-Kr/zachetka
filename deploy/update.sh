#!/usr/bin/env bash
# Обновление «Моей зачётки» до последней версии кода из GitHub.
# Запуск на сервере (от root):  bash /opt/zachetka/src/deploy/update.sh
set -euo pipefail
APP=/opt/zachetka
[ "$(id -u)" = "0" ] || { echo "Запустите от имени root."; exit 1; }

echo "Делаю резервную копию базы перед обновлением…"
mkdir -p "$APP/pb_data/backups"
systemctl stop zachetka
tar -czf "$APP/pb_data/backups/before-update-$(date +%Y%m%d-%H%M).tar.gz" -C "$APP/pb_data" data.db auxiliary.db 2>/dev/null || true

echo "Загружаю новую версию кода…"
git -C "$APP/src" pull --ff-only
chown -R zachetka:zachetka "$APP"

systemctl start zachetka
sleep 3
if systemctl is-active --quiet zachetka; then
  echo "Готово: приложение обновлено и работает."
else
  journalctl -u zachetka -n 30 --no-pager
  echo "Приложение не запустилось. Текст ошибки выше; копия базы лежит в $APP/pb_data/backups."
  exit 1
fi
