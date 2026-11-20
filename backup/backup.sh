#!/usr/bin/env bash
# ВЕЛЕССТРОЙ 1.9.46 — резервные копии в другое место (ПЛАН Б, фаза 1).
#   База:   Litestream пишет КАЖДОЕ изменение data.db в облако (Яндекс Object Storage) не позже чем через 10 секунд;
#           можно восстановить на любой момент за последние 14 дней.
#   Файлы:  фото, PDF, сканы (pb_data/storage) — копируются каждые 10 минут; из копии ничего не удаляется.
#   Ночью:  полная проверенная копия базы — в облако (30 дней) и на Яндекс Диск (14 дней) + файлы на Яндекс Диск.
# Команды: conf | files | daily | check | restoretest | all
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${VS_APP:-$(dirname "$HERE")}"
DATA="${VS_DATA:-$APP/pb_data}"
STATE="${VS_STATE:-$(dirname "$DATA")/backup_state}"
BIN="${VS_BIN:-$APP/bin}"
export PATH="$BIN:$PATH"
mkdir -p "$STATE"; chmod 700 "$STATE" 2>/dev/null || true
ENVF="$STATE/backup.env"; ST="$STATE/status.json"; LOG="$STATE/backup.log"
S3_KEY=""; S3_SECRET=""; S3_BUCKET=""; S3_ENDPOINT="https://storage.yandexcloud.net"; S3_REGION="ru-central1"; YD_USER=""; YD_PASS=""; YD_URL="https://webdav.yandex.ru"
# shellcheck disable=SC1090
[ -f "$ENVF" ] && . "$ENVF"
log(){ echo "$(date -u '+%F %T') [$1] $2" >> "$LOG"; tail -n 2000 "$LOG" > "$LOG.t" 2>/dev/null && mv "$LOG.t" "$LOG"; }
# статус: setst ключ ok|err "текст" [доп. JSON]
setst(){ python3 - "$ST" "$1" "$2" "${3:-}" "${4:-null}" <<'PY'
import json, sys, time, os
p, k, ok, msg, extra = sys.argv[1:6]
try: d = json.load(open(p))
except Exception: d = {}
e = d.get(k, {})
e.update({"ok": ok == "ok", "msg": msg, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
if ok == "ok": e["last_ok"] = e["at"]
x = json.loads(extra)
if isinstance(x, dict): e.update(x)
d[k] = e
t = p + ".t"; json.dump(d, open(t, "w"), ensure_ascii=False); os.replace(t, p)
PY
}
need_s3(){ [ -n "$S3_KEY" ] && [ -n "$S3_SECRET" ] && [ -n "$S3_BUCKET" ]; }
rc(){
  export RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER=Other RCLONE_CONFIG_S3_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_S3_REGION="$S3_REGION" \
    RCLONE_CONFIG_S3_ACCESS_KEY_ID="$S3_KEY" RCLONE_CONFIG_S3_SECRET_ACCESS_KEY="$S3_SECRET" RCLONE_CONFIG_S3_FORCE_PATH_STYLE=true RCLONE_CONFIG_S3_NO_CHECK_BUCKET=true
  if [ -n "$YD_USER" ]; then
    export RCLONE_CONFIG_YD_TYPE=webdav RCLONE_CONFIG_YD_URL="$YD_URL" RCLONE_CONFIG_YD_VENDOR=other RCLONE_CONFIG_YD_USER="$YD_USER" RCLONE_CONFIG_YD_PASS="$(rclone obscure "$YD_PASS")"
  fi
  rclone -q --retries 3 --low-level-retries 5 --contimeout 20s --timeout 120s "$@"
}

cmd_conf(){   # конфиг Litestream из ключей (вызывается после сохранения ключей в программе)
  if ! need_s3; then rm -f "$STATE/litestream.yml"; setst db err "Ключи облака не заданы"; return 1; fi
  umask 077
  cat > "$STATE/litestream.yml" <<EOF
dbs:
  - path: $DATA/data.db
    replicas:
      - type: s3
        bucket: $S3_BUCKET
        path: db
        endpoint: $S3_ENDPOINT
        region: $S3_REGION
        access-key-id: $S3_KEY
        secret-access-key: $S3_SECRET
        force-path-style: true
        sync-interval: 10s
        snapshot-interval: 24h
        retention: 336h
EOF
  log conf "конфиг Litestream записан"; return 0
}

cmd_files(){
  need_s3 || { setst files err "Ключи облака не заданы"; return 1; }
  [ -d "$DATA/storage" ] || mkdir -p "$DATA/storage"
  local n out; n=$(find "$DATA/storage" -type f 2>/dev/null | wc -l)
  if out=$(rc copy "$DATA/storage" "s3:$S3_BUCKET/files" --transfers 4 2>&1); then
    setst files ok "Файлов: $n" "{\"count\": $n}"; log files "ok $n"
  else setst files err "$(echo "$out" | tail -n 2 | tr '\n"' ' _' | cut -c1-300)"; log files "ERR $out"; return 1; fi
}

cmd_daily(){
  need_s3 || { setst daily err "Ключи облака не заданы"; return 1; }
  local T name gz sz ok=1 out
  T=$(mktemp -d); name="data-$(date -u +%Y%m%d-%H%M).db"
  if ! out=$(python3 - "$DATA/data.db" "$T/$name" <<'PY' 2>&1
import sqlite3, sys
s = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True); d = sqlite3.connect(sys.argv[2]); s.backup(d)
r = d.execute("PRAGMA integrity_check").fetchone()[0]; d.close(); s.close()
if r != "ok": raise SystemExit("integrity: " + r)
PY
); then setst daily err "Копия базы не прошла проверку: $(echo "$out" | tail -n1 | cut -c1-200)"; log daily "ERR $out"; rm -rf "$T"; return 1; fi
  gzip -6 "$T/$name"; gz="$T/$name.gz"; sz=$(stat -c %s "$gz")
  if out=$(rc copyto "$gz" "s3:$S3_BUCKET/daily/$name.gz" 2>&1); then rc delete "s3:$S3_BUCKET/daily" --min-age 30d >/dev/null 2>&1 || true
  else ok=0; log daily "ERR s3 $out"; fi
  if [ -n "$YD_USER" ]; then
    if out=$(rc copyto "$gz" "yd:VELESSTROY-backup/daily/$name.gz" 2>&1) && out2=$(rc copy "$DATA/storage" "yd:VELESSTROY-backup/files" --transfers 2 2>&1); then
      rc delete "yd:VELESSTROY-backup/daily" --min-age 14d >/dev/null 2>&1 || true
      setst ydisk ok "Яндекс Диск: база $name.gz + файлы" "{\"size\": $sz}"
    else setst ydisk err "Яндекс Диск: $(echo "${out:-} ${out2:-}" | tail -n 2 | tr '\n"' ' _' | cut -c1-300)"; log daily "ERR yd ${out:-} ${out2:-}"; fi
  fi
  rm -rf "$T"
  if [ "$ok" = 1 ]; then setst daily ok "$name.gz" "{\"size\": $sz}"; log daily "ok $name $sz"; else setst daily err "Не удалось отправить ночную копию в облако"; return 1; fi
}

cmd_check(){   # жива ли непрерывная копия базы: самое новое изменение в облаке
  need_s3 || { setst db err "Ключи облака не заданы"; return 1; }
  local out res
  if ! out=$(rc lsjson -R --files-only "s3:$S3_BUCKET/db" 2>&1); then setst db err "Облако недоступно: $(echo "$out" | tail -n 1 | tr '"' ' ' | cut -c1-250)"; return 1; fi
  res=$(printf '%s' "$out" | python3 -c '
import json, sys, os
from datetime import datetime, timezone
try: L = json.load(sys.stdin) or []
except Exception: L = []
def ts(s):
    try: return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except Exception: return 0
newest = max([x.get("ModTime", "") for x in L] or [""]); nt = ts(newest)
db = sys.argv[1]; lt = max([os.path.getmtime(p) for p in (db, db + "-wal") if os.path.exists(p)] or [0])
lag = lt - nt; ok = bool(L) and lag < 600
msg = ("Копия базы в облаке: " + str(len(L)) + " частей") if ok else ("В облаке нет копии базы — служба Litestream не работает?" if not L else "Последние изменения базы не дошли до облака (отставание " + str(int(lag // 60)) + " мин)")
print("ok" if ok else "err"); print(msg); print(json.dumps({"parts": len(L), "newest": (newest[:19] + "Z") if newest else "", "lag_s": int(max(lag, 0))}))
' "$DATA/data.db")
  setst db "$(echo "$res" | sed -n 1p)" "$(echo "$res" | sed -n 2p)" "$(echo "$res" | sed -n 3p)"
  [ "$(echo "$res" | sed -n 1p)" = ok ]
}

cmd_restoretest(){   # честная проверка: восстановить базу из облака во временный файл и сравнить с рабочей
  need_s3 && [ -f "$STATE/litestream.yml" ] || { setst restore err "Ключи облака не заданы"; return 1; }
  local T out; T=$(mktemp -d)
  if ! out=$(litestream restore -config "$STATE/litestream.yml" -o "$T/r.db" "$DATA/data.db" 2>&1); then
    setst restore err "Восстановление не удалось: $(echo "$out" | tail -n 1 | tr '"' ' ' | cut -c1-250)"; log restore "ERR $out"; rm -rf "$T"; return 1; fi
  if out=$(python3 - "$DATA/data.db" "$T/r.db" <<'PY' 2>&1
import sqlite3, sys, json
live = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True); rest = sqlite3.connect(sys.argv[2])
if rest.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise SystemExit("integrity")
tabs = [r[0] for r in rest.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'")]
miss = 0; tot = 0
for t in tabs:
    a = live.execute('SELECT count(*) FROM "%s"' % t).fetchone()[0]; b = rest.execute('SELECT count(*) FROM "%s"' % t).fetchone()[0]
    tot += b; miss += max(0, a - b)
print(json.dumps({"tables": len(tabs), "rows": tot, "missing": miss}))
PY
); then
    local miss; miss=$(echo "$out" | python3 -c "import json,sys;print(json.load(sys.stdin)['missing'])")
    if [ "$miss" -le 5 ]; then setst restore ok "Восстановлено и сверено с рабочей базой" "$out"; else setst restore err "В копии не хватает $miss строк" "$out"; fi
    log restore "$out"
  else setst restore err "Копия повреждена: $(echo "$out" | tail -n 1 | cut -c1-200)"; log restore "ERR $out"; fi
  rm -rf "$T"
}

case "${1:-all}" in
  conf) cmd_conf ;;
  files) cmd_files; cmd_check ;;
  daily) cmd_daily ;;
  check) cmd_check ;;
  restoretest) cmd_restoretest ;;
  all) cmd_files; cmd_check; cmd_daily; cmd_restoretest ;;
  *) echo "backup.sh conf|files|daily|check|restoretest|all"; exit 2 ;;
esac
