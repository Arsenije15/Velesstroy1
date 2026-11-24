#!/usr/bin/env bash
# ВЕЛЕССТРОЙ 1.9.48 — резервные копии в другое место (ПЛАН Б, фаза 1).
#   База:   копию делает САМ сервер (VACUUM INTO) 3 раза в день (12:00, 16:00, 21:00 МСК) и по кнопке; этот скрипт только отправляет
#           готовые файлы. К рабочей базе скрипт НЕ прикасается (чужое соединение может повредить служебные файлы базы).
#           Хранится: папка snap — 48 часов, hourly — 14 дней, по дню — 30 дней.
#   Файлы:  фото, PDF, сканы (pb_data/storage) — каждые 10 минут; из копии ничего не удаляется.
#   Ночью:  копия дня в облако (30 дней) и на Яндекс Диск (14 дней) + файлы на Яндекс Диск.
# Команды: push | files | daily | check | restoretest | all
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${VS_APP:-$(dirname "$HERE")}"
DATA="${VS_DATA:-$APP/pb_data}"
STATE="${VS_STATE:-$(dirname "$DATA")/backup_state}"
BIN="${VS_BIN:-$APP/bin}"
export PATH="$BIN:$PATH"
mkdir -p "$STATE"; chmod 700 "$STATE" 2>/dev/null || true
ENVF="$STATE/backup.env"; ST="$STATE/status.json"; LOG="$STATE/backup.log"; SNAP="$STATE/snap"
S3_KEY=""; S3_SECRET=""; S3_BUCKET=""; S3_ENDPOINT="https://storage.yandexcloud.net"; S3_REGION="ru-central1"; YD_USER=""; YD_PASS=""; YD_URL="https://webdav.yandex.ru"
# shellcheck disable=SC1090
[ -f "$ENVF" ] && . "$ENVF"
log(){ echo "$(date -u '+%F %T') [$1] $2" >> "$LOG"; tail -n 2000 "$LOG" > "$LOG.t" 2>/dev/null && mv "$LOG.t" "$LOG"; }
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
  # 1.9.54: одна операция облака не может висеть дольше RC_TIMEOUT (по умолчанию 15 мин) — иначе зависшая отправка держит замок
  # и все следующие копии базы молча ждут (так было 24.11: копии не уходили почти 5 часов)
  timeout -k 30 "${RC_TIMEOUT:-900}" rclone -q --retries 3 --low-level-retries 5 --contimeout 20s --timeout 120s "$@"
}
# самая новая копия базы в облаке: «папка/имя» (snap → hourly → daily)
newest(){ local d n best=""; for d in snap hourly daily; do n=$(rc lsf "s3:$S3_BUCKET/$d" --include 'data-*.db.gz' 2>/dev/null | sort | tail -n 1); [ -n "$n" ] && [ "$n" \> "${best#*/}" ] && best="$d/$n"; done; echo "$best"; }

cmd_push(){   # отправить готовые копии базы, сделанные сервером
  need_s3 || { setst db err "Ключи облака не заданы"; return 1; }
  exec 9>>"$STATE/push.lock"
  if ! flock -n 9; then   # идёт другая отправка; если она «висит» дольше 30 мин — сказать об этом на странице
    local age=$(( $(date +%s) - $(stat -c %Y "$STATE/push.lock" 2>/dev/null || date +%s) ))
    if [ "$age" -gt 1800 ]; then log push "ERR предыдущая отправка идёт уже $((age/60)) мин"; setst db err "Отправка копии базы зависла ($((age/60)) мин) — перезапустите сервер или нажмите «Копию базы сейчас» позже"; fi
    return 0
  fi
  touch "$STATE/push.lock"
  shopt -s nullglob; local f b h ok=1 n=0 last=""
  # 1.9.54: облако недоступно долго — на сервере держим не больше SNAP_KEEP (12) неотправленных копий, самые старые удаляются
  # (каждая новая копия содержит всю базу целиком — данные не теряются, только промежуточные моменты); диск не переполнится
  local all=("$SNAP"/data-*.db) keep="${SNAP_KEEP:-12}" i
  if [ "${#all[@]}" -gt "$keep" ]; then
    for ((i=0; i<${#all[@]}-keep; i++)); do rm -f "${all[$i]}" "${all[$i]}.gz" "${all[$i]}.gz.t" "${all[$i]}.json"; done
    log push "на сервере было ${#all[@]} неотправленных копий — оставлены последние $keep"
  fi
  for f in "$SNAP"/data-*.db; do
    b=$(basename "$f"); h=${b:5:11}
    if [ ! -f "$f.gz" ]; then gzip -6 -c "$f" > "$f.gz.t" && mv "$f.gz.t" "$f.gz" || { ok=0; continue; }; fi
    if rc copyto "$f.gz" "s3:$S3_BUCKET/snap/$b.gz" && rc copyto "$f.json" "s3:$S3_BUCKET/snap/$b.json"; then
      if [ -z "$(rc lsf "s3:$S3_BUCKET/hourly" --include "data-$h*.db.gz" 2>/dev/null)" ]; then
        rc copyto "$f.gz" "s3:$S3_BUCKET/hourly/$b.gz" && rc copyto "$f.json" "s3:$S3_BUCKET/hourly/$b.json" || ok=0
      fi
      rm -f "$f" "$f.gz" "$f.json"; last=$b; n=$((n+1))
    else ok=0; log push "ERR не отправлено $b — повторю"; fi
  done
  rc delete "s3:$S3_BUCKET/snap" --min-age 48h >/dev/null 2>&1 || true
  rc delete "s3:$S3_BUCKET/hourly" --min-age 14d >/dev/null 2>&1 || true
  if [ "$ok" = 1 ]; then [ -n "$last" ] && { setst db ok "Последняя копия базы: $last" "{\"newest\": \"$last\", \"pending\": 0}"; log push "ok $n → $last"; }
  else setst db err "Копии базы не уходят в облако (ждут отправки: $(ls "$SNAP"/data-*.db 2>/dev/null | wc -l))"; return 1; fi
}

cmd_files(){
  need_s3 || { setst files err "Ключи облака не заданы"; return 1; }
  [ -d "$DATA/storage" ] || mkdir -p "$DATA/storage"
  local n out; n=$(find "$DATA/storage" -type f 2>/dev/null | wc -l)
  if out=$(rc copy "$DATA/storage" "s3:$S3_BUCKET/files" --transfers 4 2>&1); then
    setst files ok "Файлов: $n" "{\"count\": $n}"; log files "ok $n"
  else setst files err "$(echo "$out" | tail -n 2 | tr '\n"' ' _' | cut -c1-300)"; log files "ERR $out"; return 1; fi
}

cmd_daily(){   # копия дня = самая новая копия базы (не трогая рабочую базу)
  need_s3 || { setst daily err "Ключи облака не заданы"; return 1; }
  local nw name T out sz; nw=$(newest)
  [ -n "$nw" ] || { setst daily err "В облаке ещё нет ни одной копии базы"; return 1; }
  name="${nw#*/}"; T=$(mktemp -d)   # имя = момент базы в копии (без изменений — та же копия обновляется)
  if ! out=$(rc copyto "s3:$S3_BUCKET/$nw" "$T/$name" 2>&1); then setst daily err "Не скачалась копия: $(echo "$out" | tail -n1 | cut -c1-200)"; rm -rf "$T"; return 1; fi
  sz=$(stat -c %s "$T/$name")
  rc copyto "s3:$S3_BUCKET/${nw%.gz}.json" "$T/$name.json" >/dev/null 2>&1 || true
  if out=$(rc copyto "$T/$name" "s3:$S3_BUCKET/daily/$name" 2>&1); then
    [ -f "$T/$name.json" ] && rc copyto "$T/$name.json" "s3:$S3_BUCKET/daily/${name%.gz}.json" >/dev/null 2>&1
    rc delete "s3:$S3_BUCKET/daily" --min-age 30d >/dev/null 2>&1 || true
    setst daily ok "$name (из ${nw#*/})" "{\"size\": $sz}"; log daily "ok $name ← $nw"
  else setst daily err "Не удалось отправить копию дня"; log daily "ERR $out"; fi
  if [ -n "$YD_USER" ]; then
    local o1 o2
    if o1=$(rc copyto "$T/$name" "yd:VELESSTROY-backup/daily/$name" 2>&1) && o2=$(rc copy "$DATA/storage" "yd:VELESSTROY-backup/files" --transfers 2 2>&1); then
      rc delete "yd:VELESSTROY-backup/daily" --min-age 14d >/dev/null 2>&1 || true
      setst ydisk ok "Яндекс Диск: база $name + файлы" "{\"size\": $sz}"
    else setst ydisk err "Яндекс Диск: $(echo "${o1:-} ${o2:-}" | tail -n 2 | tr '\n"' ' _' | cut -c1-300)"; log daily "ERR yd ${o1:-} ${o2:-}"; fi
  fi
  rm -rf "$T"
}

cmd_check(){   # успевают ли копии за изменениями базы (только время файлов — базу не открываем)
  need_s3 || { setst db err "Ключи облака не заданы"; return 1; }
  local nw res; nw=$(newest)
  res=$(python3 - "$DATA/data.db" "${nw#*/}" "$(ls "$SNAP"/data-*.db 2>/dev/null | wc -l)" <<'PY'
import os, sys, json, calendar, time
db, nw, pend = sys.argv[1], sys.argv[2], int(sys.argv[3])
lt = max([os.path.getmtime(p) for p in (db, db + "-wal") if os.path.exists(p)] or [0])
try: nt = calendar.timegm(time.strptime(nw[5:20], "%Y%m%d-%H%M%S"))
except Exception: nt = 0
lag = lt - nt
ok = bool(nw) and lag < 900 and pend < 3
msg = ("Последняя копия базы: " + nw) if ok else ("В облаке нет копии базы" if not nw else ("Ждут отправки: " + str(pend) if pend >= 3 else "Изменения базы старше последней копии на " + str(int(lag // 60)) + " мин"))
print("ok" if ok else "err"); print(msg); print(json.dumps({"newest": nw, "lag_s": int(max(lag, 0)), "pending": pend}))
PY
)
  setst db "$(echo "$res" | sed -n 1p)" "$(echo "$res" | sed -n 2p)" "$(echo "$res" | sed -n 3p)"
  [ "$(echo "$res" | sed -n 1p)" = ok ]
}

cmd_restoretest(){   # честная проверка: скачать последнюю копию, проверить целостность и сверить с описью, сделанной сервером
  need_s3 || { setst restore err "Ключи облака не заданы"; return 1; }
  local nw T out; nw=$(newest); [ -n "$nw" ] || { setst restore err "В облаке ещё нет копии базы"; return 1; }
  T=$(mktemp -d)
  if ! out=$(rc copyto "s3:$S3_BUCKET/$nw" "$T/r.db.gz" 2>&1); then setst restore err "Не скачалась: $(echo "$out" | tail -n1 | cut -c1-200)"; rm -rf "$T"; return 1; fi
  rc copyto "s3:$S3_BUCKET/${nw%.gz}.json" "$T/r.json" >/dev/null 2>&1 || true
  gunzip "$T/r.db.gz"
  if out=$(python3 - "$T/r.db" "$T/r.json" <<'PY' 2>&1
import sqlite3, sys, json, os
d = sqlite3.connect(sys.argv[1])
if d.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise SystemExit("integrity")
m = json.load(open(sys.argv[2])) if os.path.exists(sys.argv[2]) else {"counts": {}}
tabs = [r[0] for r in d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
bad = []; rows = 0
for t in tabs:
    n = d.execute('SELECT count(*) FROM "%s"' % t.replace('"', '""')).fetchone()[0]; rows += n
    if t in m["counts"] and m["counts"][t] != n: bad.append(t)
print(json.dumps({"tables": len(tabs), "rows": rows, "missing": len(bad), "checked": len(m["counts"])}))
PY
); then
    local miss; miss=$(echo "$out" | python3 -c "import json,sys;print(json.load(sys.stdin)['missing'])")
    if [ "$miss" = 0 ]; then setst restore ok "Восстановлено из облака (${nw#*/}) и сверено с описью" "$out"; else setst restore err "Не совпало таблиц: $miss" "$out"; fi
    log restore "$nw $out"
  else setst restore err "Копия повреждена: $(echo "$out" | tail -n 1 | cut -c1-200)"; log restore "ERR $out"; fi
  rm -rf "$T"
}

case "${1:-all}" in
  push) cmd_push ;;
  files) cmd_files; cmd_push; cmd_check ;;
  daily) cmd_daily ;;
  check) cmd_check ;;
  restoretest) cmd_restoretest ;;
  conf) exit 0 ;;   # 1.9.46 (Litestream) — больше не нужно
  all) cmd_files; cmd_push; cmd_check; cmd_daily; cmd_restoretest ;;
  *) echo "backup.sh push|files|daily|check|restoretest|all"; exit 2 ;;
esac
