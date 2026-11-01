#!/usr/bin/env bash
# ВЕЛЕССТРОЙ — установка и обновление на VPS (Ubuntu 22.04/24.04 или Debian 12).
# Первый запуск: устанавливает всё и печатает пароли. Повторный запуск: обновляет программу, данные сохраняются.
# Использование:  bash install.sh               — доступ по IP (http://IP)
#                 bash install.sh sklad.example.ru  — свой домен + бесплатный HTTPS (Let's Encrypt)
set -euo pipefail
PB_VERSION="0.39.10"
DOMAIN="${1:-}"
APP=/opt/velesstroy
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT_LOCAL=8090
say(){ echo -e "\n\033[1;33m==> $*\033[0m"; }

[ "$(id -u)" = "0" ] || { echo "Запустите от root (sudo bash install.sh)"; exit 1; }
for d in pb_hooks pb_migrations pb_public; do [ -d "$SRC/$d" ] || { echo "Не найдена папка $SRC/$d — запускайте из папки проекта"; exit 1; }; done

say "Пакеты"
if command -v apt-get >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl unzip ca-certificates python3 >/dev/null
fi

FIRST=0; [ -f "$APP/pocketbase" ] || FIRST=1
mkdir -p "$APP"
if [ "$FIRST" = "1" ]; then
  say "Скачиваю сервер (PocketBase $PB_VERSION)"
  case "$(uname -m)" in x86_64) ARCH=amd64;; aarch64|arm64) ARCH=arm64;; *) echo "Неизвестная архитектура"; exit 1;; esac
  TMP=$(mktemp -d)
  curl -fL --retry 5 --retry-delay 3 -o "$TMP/pb.zip" \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -o -q "$TMP/pb.zip" pocketbase -d "$APP"; chmod +x "$APP/pocketbase"; rm -rf "$TMP"
fi

say "Копирую программу (данные в $APP/pb_data не трогаются)"
rm -rf "$APP/pb_hooks" "$APP/pb_migrations" "$APP/pb_public"
cp -r "$SRC/pb_hooks" "$SRC/pb_migrations" "$SRC/pb_public" "$APP/"
id velesstroy >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin velesstroy
mkdir -p "$APP/pb_data"; chown -R velesstroy:velesstroy "$APP"

if [ -n "$DOMAIN" ]; then echo "$DOMAIN" > "$APP/.domain"; elif [ -f "$APP/.domain" ]; then DOMAIN=$(cat "$APP/.domain"); fi
if [ -n "$DOMAIN" ]; then SERVE="serve $DOMAIN"; else SERVE="serve --http 0.0.0.0:80"; fi

say "Служба автозапуска"
cat > /etc/systemd/system/velesstroy.service <<EOF
[Unit]
Description=VELESSTROY warehouse
After=network-online.target
Wants=network-online.target
[Service]
User=velesstroy
WorkingDirectory=$APP
Environment=VS_TZ_OFFSET_MIN=180
ExecStart=$APP/pocketbase $SERVE --dir $APP/pb_data --hooksDir $APP/pb_hooks --migrationsDir $APP/pb_migrations --publicDir $APP/pb_public
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=65535
[Install]
WantedBy=multi-user.target
EOF

if [ "$FIRST" = "1" ]; then
  say "Создаю базу и учётные записи"
  sudo -u velesstroy "$APP/pocketbase" migrate up --dir "$APP/pb_data" --migrationsDir "$APP/pb_migrations" --hooksDir "$APP/pb_hooks" >/dev/null
  GEN(){ python3 -c "import secrets,string;a='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';print(''.join(secrets.choice(a) for _ in range($1)))"; }
  SU_PASS=$(GEN 16); ADM_PASS=$(GEN 12)
  sudo -u velesstroy "$APP/pocketbase" superuser upsert "root@velesstroy.local" "$SU_PASS" --dir "$APP/pb_data" >/dev/null
fi

systemctl daemon-reload
systemctl enable velesstroy >/dev/null 2>&1
systemctl restart velesstroy
command -v ufw >/dev/null && ufw status | grep -q active && { ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; }

# ждём запуска
for i in $(seq 1 30); do curl --noproxy "*" -fs "http://127.0.0.1:80/api/health" >/dev/null 2>&1 && break; \
  [ -n "$DOMAIN" ] && curl --noproxy "*" -fsk "https://127.0.0.1/api/health" -H "Host: $DOMAIN" >/dev/null 2>&1 && break; sleep 1; done

if [ "$FIRST" = "1" ]; then
  BASE="http://127.0.0.1:80"; curl --noproxy "*" -fs "$BASE/api/health" >/dev/null 2>&1 || BASE="https://$DOMAIN"
  J(){ python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
  TOK=$(curl --noproxy "*" -fsS -X POST "$BASE/api/collections/_superusers/auth-with-password" -H 'Content-Type: application/json' \
        -d "{\"identity\":\"root@velesstroy.local\",\"password\":\"$SU_PASS\"}" | J "['token']")
  curl --noproxy "*" -fsS -X POST "$BASE/api/collections/users/records" -H "Authorization: $TOK" -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"email\":\"admin@velesstroy.local\",\"name\":\"Администратор\",\"role\":\"admin\",\"active\":true,\"password\":\"$ADM_PASS\",\"passwordConfirm\":\"$ADM_PASS\"}" >/dev/null
  # ежедневная резервная копия в 03:00 МСК (00:00 UTC), хранить 14 штук
  curl --noproxy "*" -fsS -X PATCH "$BASE/api/settings" -H "Authorization: $TOK" -H 'Content-Type: application/json' \
    -d '{"meta":{"appName":"ВЕЛЕССТРОЙ"},"backups":{"cron":"0 0 * * *","cronMaxKeep":14}}' >/dev/null
  IP=$(curl -fs4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
  URL=$([ -n "$DOMAIN" ] && echo "https://$DOMAIN" || echo "http://$IP")
  cat > "$APP/ПАРОЛИ.txt" <<EOF
ВЕЛЕССТРОЙ — доступы (сохраните и удалите этот файл)
Ссылка для всех:        $URL
Вход в программу:       логин admin   пароль $ADM_PASS
Техническая панель:     $URL/_/   e-mail root@velesstroy.local   пароль $SU_PASS
EOF
  chmod 600 "$APP/ПАРОЛИ.txt"
  say "ГОТОВО"
  cat "$APP/ПАРОЛИ.txt"
else
  say "ОБНОВЛЕНО — данные сохранены"
fi
systemctl is-active --quiet velesstroy && echo "Служба работает." || { echo "ОШИБКА: служба не запустилась. Журнал:"; journalctl -u velesstroy -n 30 --no-pager; exit 1; }
