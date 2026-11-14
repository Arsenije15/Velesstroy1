/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.19 — фото брака к акту СКК; акты СКК → «Журнал актов несоответствия» (.xlsx); реестр заявок; бэкап на компьютер

// ---------- Фото брака: удалить ----------
routerAdd("POST", "/api/vs/skk/photo/delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "skk"]);
  const p = $app.findRecordById("skk_photos", L.str((e.requestInfo().body || {}).id));
  $app.delete(p);
  L.log($app, a, "skk_photo_delete", "skk_acts", p.getString("act"), "Удалено фото брака");
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Акты СКК → файл «Журнал актов несоответствия»: строка акта по № (заготовка), лишние строки вставляются ----------
routerAdd("POST", "/api/vs/skk/journal", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "skk"]);
  const b = e.requestInfo().body || {};
  const acts = (Array.isArray(b.acts) ? b.acts : []).slice(0, 300).map((x) => ({ number: L.str(x.number).trim().slice(0, 60),
    rows: (Array.isArray(x.rows) ? x.rows : []).slice(0, 200).map((r) => (Array.isArray(r) ? r : []).slice(0, 19).map((v) => (typeof v === "number" ? v : L.str(v).slice(0, 3000)))) }))
    .filter((x) => x.number && x.rows.length);
  if (!acts.length) throw new BadRequestError("Не выбраны акты.");
  const b64 = L.str(b.b64);
  if (b64.length < 100) throw new BadRequestError("Загрузите файл журнала актов (.xlsx).");
  const dir = $app.dataDir() + "/journal_tmp/" + $security.randomString(12);
  let res = null;
  try {
    $os.mkdirAll(dir, 0o700);
    $os.writeFile(dir + "/in.b64", b64, 0o600);
    $os.writeFile(dir + "/acts.json", JSON.stringify(acts), 0o600);
    const txt = toString($os.cmd("sh", "-c", 'timeout 240 python3 "$1" "$2/in.b64" "$2/acts.json" "$2/out.b64" 2>&1', "sh", `${__hooks}/skk_journal_fill.py`, dir).output()).trim();
    try { res = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); } catch (_) { throw new BadRequestError("Ошибка при записи журнала: " + txt.split("\n").slice(-2).join(" | ").slice(0, 300)); }
    if (res.error) throw new BadRequestError(res.error);
    res.b64 = toString($os.readFile(dir + "/out.b64"));
  } finally { try { $os.removeAll(dir); } catch (_) {} }
  return e.json(200, res);
}, $apis.requireAuth("users"));

// ---------- Реестр заявок (файл склада): загрузка частями, проверка номеров ----------
routerAdd("POST", "/api/vs/zreg/import", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper"]);
  const b = e.requestInfo().body || {};
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000);
  const N = (s) => X.lc(L.str(s)).replace(/№/g, "").replace(/\s+/g, "").replace(/\.+$/, "");
  const F = ["number", "object", "descr", "lines", "dept", "applicant", "date_in", "keeper", "date_out", "receiver", "doc1c", "accountant", "status", "comment"];
  let n = 0;
  $app.runInTransaction((tx) => {
    if (b.first) tx.db().newQuery("DELETE FROM zreg").execute();
    const col = tx.findCollectionByNameOrId("zreg");
    rows.forEach((r) => {
      const no = L.str(r.number).trim();
      if (!no) return;
      const rec = new Record(col);
      const MX = { number: 60, date_in: 10, date_out: 10, lines: 20, status: 100, object: 300, dept: 300, comment: 2000, descr: 1000 };
      F.forEach((f) => rec.set(f, L.str(r[f]).replace(/\s+/g, " ").trim().slice(0, MX[f] || 200)));
      rec.set("number_n", N(no).slice(0, 60));
      rec.set("row_no", +r.row_no || 0);
      rec.set("search_lc", X.lc(F.map((f) => L.str(r[f])).join(" ")).slice(0, 4000));
      tx.save(rec); n++;
    });
    if (b.last) L.log(tx, a, "zreg_import", "zreg", "", "Реестр заявок: " + L.str(b.file_name).slice(0, 150) + " — " + (+b.total || n) + " номеров");
  });
  return e.json(200, { saved: n });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/vs/zreg/meta", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  let cnt = 0; try { const r = new DynamicModel({ n: 0 }); $app.db().newQuery("SELECT COUNT(*) AS n FROM zreg").one(r); cnt = r.n; } catch (_) {}
  let last = null;
  try { const l = $app.findRecordsByFilter("activity_log", "action = 'zreg_import'", "-created", 1, 0); if (l.length) last = { at: l[0].getString("created"), summary: l[0].getString("summary"), user: l[0].getString("user_name") }; } catch (_) {}
  return e.json(200, { count: cnt, last: last });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/zreg/check", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const b = e.requestInfo().body || {};
  const N = (s) => X.lc(L.str(s)).replace(/№/g, "").replace(/\s+/g, "").replace(/\.+$/, "");
  const nums = (Array.isArray(b.numbers) ? b.numbers : []).map((x) => L.str(x).trim()).filter(Boolean).slice(0, 500);
  const pick = (r) => { const o = {}; ["number", "object", "descr", "lines", "dept", "applicant", "date_in", "keeper", "date_out", "receiver", "doc1c", "accountant", "status", "comment", "row_no"].forEach((f) => o[f] = f === "row_no" ? r.getInt(f) : r.getString(f)); return o; };
  const out = nums.map((q) => {
    const n = N(q);
    if (!n) return { q: q, found: [], similar: [] };
    const found = $app.findRecordsByFilter("zreg", "number_n = {:n}", "row_no", 20, 0, { n: n }).map(pick);
    // похожие: «630» ↔ «630-1», «630-2»
    const base = n.replace(/-\d+$/, "");
    const sim = found.length ? [] : $app.findRecordsByFilter("zreg", "number_n = {:b} || number_n ~ {:p}", "row_no", 20, 0, { b: base, p: base + "-%" })
      .filter((r) => { const v = r.getString("number_n"); return v === base || v.indexOf(base + "-") === 0; }).map(pick);
    return { q: q, found: found, similar: sim };
  });
  return e.json(200, { results: out });
}, $apis.requireAuth("users"));

// ---------- Бэкап на компьютер: снимок базы + список файлов (только администратор) ----------
routerAdd("GET", "/api/vs/backup/db", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin"]);
  if (L.authId(a) && a.getString && a.getString("scope")) throw new ForbiddenError("Только для администратора.");
  const dir = $app.dataDir() + "/backup_tmp";
  try { $os.mkdirAll(dir, 0o700); } catch (_) {}
  // старые снимки (прошлые скачивания) — удалить
  try { toString($os.cmd("sh", "-c", 'find "$1" -name "*.db" -mmin +30 -delete', "sh", dir).output()); } catch (_) {}
  const name = "velesstroy_" + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "") + "_" + $security.randomString(6) + ".db";
  $app.db().newQuery("VACUUM INTO {:p}").bind({ p: dir + "/" + name }).execute();
  L.log($app, a, "backup_db", "backup", "", "Бэкап базы скачан на компьютер");
  e.response.header().set("Content-Disposition", 'attachment; filename="data.db"');
  return e.fileFS($os.dirFS(dir), name);
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/vs/backup/files", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin"]);
  const out = [];
  $app.findAllCollections("base", "auth").forEach((c) => {
    const ff = []; c.fields.forEach((f) => { if (f.type() === "file") ff.push(f.name); });
    if (!ff.length || c.name.indexOf("_") === 0) return;
    const recs = $app.findRecordsByFilter(c.name, ff.map((f) => f + " != ''").join(" || "), "", 0, 0);
    recs.forEach((r) => ff.forEach((f) => { let v = r.get(f); if (!v) return; if (!Array.isArray(v)) v = [String(v)]; v.forEach((x) => x && out.push({ c: c.name, id: r.id, f: String(x) })); }));
  });
  return e.json(200, { files: out, at: new Date().toISOString() });
}, $apis.requireAuth("users"));
