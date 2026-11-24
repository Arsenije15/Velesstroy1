// VELESSTROY 1.9.46 — копия в облако (план Б): пути, ключи, статус
function paths(app) {
  const absP = (x) => { x = String(x).replace(/\/+$/, ""); if (x[0] !== "/") { x = $os.getwd() + "/" + x.replace(/^\.\//, ""); } return x; };
  const data = absP(app.dataDir()), hooks = absP(__hooks);
  const root = data.replace(/\/[^\/]+$/, "");
  return { data, state: root + "/backup_state", script: hooks.replace(/\/[^\/]+$/, "") + "/backup/backup.sh" };
}
const RX = { s3_key: /^[A-Za-z0-9_\-]{8,128}$/, s3_secret: /^[A-Za-z0-9_\-+\/=]{16,128}$/, s3_bucket: /^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$/,
  s3_endpoint: /^https?:\/\/[A-Za-z0-9.\-]+(:\d+)?\/?$/, yd_user: /^[A-Za-z0-9._@+\-]{3,80}$/, yd_pass: /^[A-Za-z0-9]{8,64}$/, yd_url: /^https?:\/\/[A-Za-z0-9.\-]+(:\d+)?(\/[A-Za-z0-9._\-\/]*)?$/ };
function readEnv(p) {
  const o = {}; let t = ""; try { t = toString($os.readFile(p)); } catch (_) { return o; }
  t.split("\n").forEach((l) => { const m = l.match(/^([A-Z0-9_]+)='([^']*)'$/); if (m) o[m[1]] = m[2]; });
  return o;
}
function readStatus(p) { try { return JSON.parse(toString($os.readFile(p))); } catch (_) { return {}; } }
function mask(s) { s = String(s || ""); return s ? "•••" + s.slice(-4) : ""; }
function status(app) {
  const P = paths(app), E = readEnv(P.state + "/backup.env"), S = readStatus(P.state + "/status.json");
  const conf = !!(E.S3_KEY && E.S3_SECRET && E.S3_BUCKET);
  const now = Date.now(), age = (k) => { const x = S[k]; return x && x.last_ok ? (now - Date.parse(x.last_ok)) / 60000 : Infinity; };
  const alarm = [];
  if (!conf) alarm.push("Копия в облако не настроена — при поломке сервера данные можно потерять.");
  else {
    // 1.9.54: копия базы 3 раза в день (12, 16, 21 МСК) — самый длинный перерыв 21:00 → 12:00 = 15 ч
    if (age("db") > 16 * 60) alarm.push("Копия базы не подтверждена " + (isFinite(age("db")) ? (age("db") >= 120 ? Math.round(age("db") / 60) + " ч" : Math.round(age("db")) + " мин") : "ни разу") + (S.db && !S.db.ok ? ": " + S.db.msg : ""));
    if (age("files") > 60) alarm.push("Файлы не копировались " + (isFinite(age("files")) ? Math.round(age("files")) + " мин" : "ни разу") + (S.files && !S.files.ok ? ": " + S.files.msg : ""));
    if (age("daily") > 26 * 60 && S.daily) alarm.push("Ночная копия не делалась больше суток" + (!S.daily.ok ? ": " + S.daily.msg : ""));
    if (E.YD_USER && S.ydisk && !S.ydisk.ok) alarm.push("Яндекс Диск: " + S.ydisk.msg);
    if (S.restore && !S.restore.ok) alarm.push("Проверка восстановления не прошла: " + S.restore.msg);
  }
  let log = ""; try { log = toString($os.readFile(P.state + "/backup.log")).split("\n").slice(-30).join("\n"); } catch (_) {}
  return { configured: conf, bucket: E.S3_BUCKET || "", endpoint: E.S3_ENDPOINT || "", key: mask(E.S3_KEY), has_secret: !!E.S3_SECRET, yd_user: E.YD_USER || "", has_yd_pass: !!E.YD_PASS,
    status: S, alarm, log };
}
function saveConfig(app, b) {
  const P = paths(app), E = readEnv(P.state + "/backup.env");
  const v = { S3_KEY: b.s3_key, S3_SECRET: b.s3_secret, S3_BUCKET: b.s3_bucket, S3_ENDPOINT: b.s3_endpoint, YD_USER: b.yd_user, YD_PASS: b.yd_pass, YD_URL: b.yd_url };
  const map = { S3_KEY: "s3_key", S3_SECRET: "s3_secret", S3_BUCKET: "s3_bucket", S3_ENDPOINT: "s3_endpoint", YD_USER: "yd_user", YD_PASS: "yd_pass", YD_URL: "yd_url" };
  const out = {};
  Object.keys(v).forEach((k) => {
    let x = String(v[k] == null ? "" : v[k]).trim();
    if (!x && (k === "S3_SECRET" || k === "YD_PASS" || k === "S3_KEY") && E[k]) x = E[k];   // пустое поле = оставить прежнее
    if (k === "YD_PASS") x = x.replace(/\s+/g, "");
    if (x && !RX[map[k]].test(x)) throw new BadRequestError("Неверное значение: " + ({ S3_KEY: "идентификатор ключа", S3_SECRET: "секретный ключ", S3_BUCKET: "имя бакета (маленькие латинские буквы, цифры, «-»)", S3_ENDPOINT: "адрес хранилища", YD_USER: "логин Яндекса", YD_PASS: "пароль приложения Яндекса (16 латинских букв)", YD_URL: "адрес WebDAV" })[k]);
    if (x) out[k] = x;
  });
  if (!out.S3_KEY || !out.S3_SECRET || !out.S3_BUCKET) throw new BadRequestError("Нужны все три: идентификатор ключа, секретный ключ и имя бакета.");
  if (!out.YD_USER) delete out.YD_PASS;
  if (out.YD_USER && !out.YD_PASS) throw new BadRequestError("Для Яндекс Диска нужен пароль приложения.");
  try { $os.mkdirAll(P.state, 0o700); } catch (_) {}
  const txt = "# ВЕЛЕССТРОЙ — ключи резервной копии (записано программой " + new Date().toISOString() + ")\n" + Object.keys(out).map((k) => k + "='" + out[k] + "'").join("\n") + "\n";
  $os.writeFile(P.state + "/backup.env", txt, 0o600);
  return P;
}
function run(app, what) {
  if (["files", "check", "daily", "restoretest", "push", "all"].indexOf(what) < 0) throw new BadRequestError("Неизвестная команда.");
  const P = paths(app);
  $os.cmd("sh", "-c", 'VS_DATA="$1" VS_STATE="$2" nohup bash "$3" "$4" >/dev/null 2>&1 &', "sh", P.data, P.state, P.script, what).run();
}
module.exports = { paths, status, saveConfig, run, readEnv };
