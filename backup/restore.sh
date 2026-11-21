#!/usr/bin/env bash
# ВЕЛЕССТРОЙ 1.9.48 — ВОССТАНОВЛЕНИЕ из облака (после поломки / на новом сервере).
#   bash restore.sh                      — база на последнюю копию (не старше 5 минут до поломки) + все файлы
#   bash restore.sh "2026-11-20 14:30"   — база на этот момент (МСК): ближайшая копия НЕ ПОЗЖЕ этого времени
#                                          (каждые 5 минут — 2 суток, по часу — 14 дней, по дню — 30 дней)
#   bash restore.sh ydisk                — из ночной копии на Яндекс Диске (если облако недоступно)
#   bash restore.sh files                — только докопировать файлы из облака
# Текущая база не удаляется: она переименовывается в data.db.before-restore-ДАТА.
# На новом сервере: 1) bash install.sh auto  2) в программе «Резервные копии» ввести ключи  3) bash /opt/velesstroy/backup/restore.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${VS_APP:-$(dirname "$HERE")}"; DATA="${VS_DATA:-$APP/pb_data}"; STATE="${VS_STATE:-$(dirname "$DATA")/backup_state}"; BIN="${VS_BIN:-$APP/bin}"
SVC="${VS_SERVICE:-velesstroy}"; export PATH="$BIN:$PATH"
WHEN="${1:-}"
# shellcheck disable=SC1090
. "$STATE/backup.env"; S3_ENDPOINT="${S3_ENDPOINT:-https://storage.yandexcloud.net}"; S3_REGION="${S3_REGION:-ru-central1}"; YD_URL="${YD_URL:-https://webdav.yandex.ru}"; YD_USER="${YD_USER:-}"
rc(){ export RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER=Other RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_S3_REGION="$S3_REGION" \
        RCLONE_CONFIG_S3_ACCESS_KEY_ID="$S3_KEY" RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$S3_SECRET" RCLONE_CONFIG_S3_FORCE_PATH_STYLE=true RCLONE_CONFIG_S3_NO_CHECK_BUCKET=true
      [ -n "$YD_USER" ] && export RCLONE_CONFIG_YD_TYPE=webdav RCLONE_CONFIG_YD_URL="$YD_URL" RCLONE_CONFIG_YD_VENDOR=other RCLONE_CONFIG_YD_USER="$YD_USER" RCLONE_CONFIG_YD_PASS="$(rclone obscure "$YD_PASS")"
      rclone -q --retries 3 "$@"; }
if [ "$WHEN" = files ]; then rc copy "s3:$S3_BUCKET/files" "$DATA/storage" --transfers 4; chown -R velesstroy:velesstroy "$DATA/storage" 2>/dev/null || true; echo "ГОТОВО: файлы"; exit 0; fi
T=$(mktemp -d); NEW="$T/data.db"
# самая новая копия (по имени — момент базы, UTC) не позже LIM
pick(){ local LIM="$1" d n best=""
  for d in snap hourly daily; do
    n=$(rc lsf "s3:$S3_BUCKET/$d" --include 'data-*.db.gz' 2>/dev/null | sort | awk -v L="$LIM" 'L=="" || substr($0,6,15)<=L' | tail -n 1)
    [ -n "$n" ] && [ "$n" \> "${best#*/}" ] && best="$d/$n"
  done; echo "$best"; }
echo "==> Достаю базу из копии…"
case "$WHEN" in
  ydisk)
    LAST=$(rc lsf "yd:VELESSTROY-backup/daily" | grep '\.db\.gz$' | sort | tail -n 1); [ -n "$LAST" ] || { echo "На Яндекс Диске копий нет"; exit 1; }
    echo "    Яндекс Диск: $LAST"; rc copyto "yd:VELESSTROY-backup/daily/$LAST" "$T/$LAST"; gunzip -c "$T/$LAST" > "$NEW" ;;
  *)
    LIM=""
    if [ -n "$WHEN" ]; then LIM=$(python3 -c "import sys,datetime as d;w=sys.argv[1].strip();t=d.datetime.strptime(w,'%Y-%m-%d %H:%M:%S' if w.count(':')==2 else '%Y-%m-%d %H:%M')-d.timedelta(hours=3);print(t.strftime('%Y%m%d-%H%M%S'))" "$WHEN"); fi
    SRC=$(pick "$LIM"); [ -n "$SRC" ] || { echo "Нет копии не позже ${WHEN:-сейчас}"; exit 1; }
    echo "    копия: $SRC"; rc copyto "s3:$S3_BUCKET/$SRC" "$T/r.db.gz"; gunzip -c "$T/r.db.gz" > "$NEW" ;;
esac
python3 -c "import sqlite3,sys;r=sqlite3.connect(sys.argv[1]).execute('PRAGMA integrity_check').fetchone()[0];print('    проверка базы:',r);sys.exit(r!='ok')" "$NEW"
echo "==> Останавливаю программу"; systemctl stop "$SVC" 2>/dev/null || true
STAMP=$(date +%Y%m%d-%H%M%S)
for f in data.db data.db-wal data.db-shm; do [ -f "$DATA/$f" ] && mv "$DATA/$f" "$DATA/$f.before-restore-$STAMP"; done
cp "$NEW" "$DATA/data.db"
echo "==> Возвращаю файлы (фото, PDF) — существующие не трогаются"
FSRC="s3:$S3_BUCKET/files"; [ "$WHEN" = ydisk ] && FSRC="yd:VELESSTROY-backup/files"
rc copy "$FSRC" "$DATA/storage" --transfers 4 || echo "ВНИМАНИЕ: часть файлов не скопировалась — программа запускается, повторите позже: bash $HERE/restore.sh files"
chown -R velesstroy:velesstroy "$DATA" 2>/dev/null || true
rm -f "$STATE/snap.sig"
rm -rf "$T"
echo "==> Запускаю программу"; systemctl start "$SVC" 2>/dev/null || true
echo "ГОТОВО. Прежняя база сохранена как $DATA/data.db.before-restore-$STAMP"
