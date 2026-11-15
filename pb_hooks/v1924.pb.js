/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.24 — сертификаты / паспорта качества к УПД (чтение, сверка); реквизиты компании для претензий; обход склада

// ---------- Сертификат: прочитать (в фоне, как УПД) ----------
routerAdd("POST", "/api/vs/cert/ocr", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "skk"]);
  const rec = $app.findRecordById("upd_certs", L.str((e.requestInfo().body || {}).id));
  if (!L.isSuper(a) && rec.getString("uploaded_by") !== a.id && L.role(a) !== "admin") throw new ForbiddenError("Это не ваш файл.");
  const path = $app.dataDir() + "/storage/" + rec.collection().id + "/" + rec.id + "/" + rec.getString("file");
  const job = $app.dataDir() + "/ocr_jobs/cert_" + rec.id.replace(/[^a-z0-9]/g, "") + ".txt";
  try { $os.cmd("sh", "-c", 'mkdir -p "$(dirname "$3")"; rm -f "$3" "$3.tmp"; date +%s > "$3.start"; ( timeout 300 nice -n 10 python3 "$1" "$2" > "$3.tmp" 2>&1; echo; echo "__EXIT__$?" >> "$3.tmp"; mv "$3.tmp" "$3" ) </dev/null >/dev/null 2>&1 &', "sh", `${__hooks}/cert_ocr.py`, path, job).run(); }
  catch (err) { throw new BadRequestError("Распознавание не запустилось: " + String(err).slice(0, 200)); }
  return e.json(200, { started: true });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/vs/cert/ocr_status/{id}", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "skk", "viewer", "skk_view"]);
  const rec = $app.findRecordById("upd_certs", e.request.pathValue("id"));
  if (rec.getString("status") !== "reading") return e.json(200, { status: rec.getString("status") });
  const job = $app.dataDir() + "/ocr_jobs/cert_" + rec.id.replace(/[^a-z0-9]/g, "") + ".txt";
  let txt = null; try { txt = toString($os.readFile(job)); } catch (_) {}
  if (txt === null) {
    let st = 0; try { st = parseInt(toString($os.readFile(job + ".start")), 10) || 0; } catch (_) {}
    const sec = st ? Math.round(Date.now() / 1000 - st) : 0;
    if (!st || sec > 360) { rec.set("status", "error"); $app.saveNoValidate(rec); return e.json(200, { status: "error", message: "Документ не прочитан — впишите данные вручную." }); }
    return e.json(200, { status: "reading", sec: sec });
  }
  [job, job + ".start"].forEach((f) => { try { $os.remove(f); } catch (_) {} });
  const body = txt.replace(/\n?__EXIT__\d+\s*$/, "").trim();
  let res = null; try { res = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)); } catch (_) {}
  if (!res || res.error) { rec.set("status", "error"); $app.saveNoValidate(rec); return e.json(200, { status: "error", message: (res && res.error) || "Ошибка распознавания" }); }
  ["kind", "number", "date", "valid_to", "batch"].forEach((k) => rec.set(k, String(res[k] || "").slice(0, k === "kind" ? 80 : 120)));
  rec.set("text", String(res.text || "").slice(0, 30000)); rec.set("status", "done");
  $app.saveNoValidate(rec);
  return e.json(200, { status: "done" });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/cert/save", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "skk"]);
  const b = e.requestInfo().body || {};
  const rec = $app.findRecordById("upd_certs", L.str(b.id));
  const D = (v) => { const s = L.str(v).slice(0, 10); if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestError("Неверная дата: " + s); return s; };
  rec.set("kind", L.str(b.kind).slice(0, 80)); rec.set("number", L.str(b.number).trim().slice(0, 120)); rec.set("date", D(b.date));
  rec.set("valid_to", D(b.valid_to)); rec.set("batch", L.str(b.batch).trim().slice(0, 120));
  if (rec.getString("status") === "reading") rec.set("status", "done");
  $app.saveNoValidate(rec);
  L.log($app, a, "cert_save", "upd_docs", rec.getString("upd"), "Сертификат № " + rec.getString("number"));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/cert/delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "skk"]);
  const rec = $app.findRecordById("upd_certs", L.str((e.requestInfo().body || {}).id));
  $app.delete(rec);
  L.log($app, a, "cert_delete", "upd_docs", rec.getString("upd"), "Удалён сертификат № " + rec.getString("number"));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Реквизиты компании (бланк претензии) ----------
routerAdd("POST", "/api/vs/org/save", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "skk"]);
  const b = e.requestInfo().body || {};
  const F = ["name", "inn", "kpp", "ogrn", "address", "phone", "email", "signer_post", "signer_name", "days"];
  const d = {}; F.forEach((k) => d[k] = L.str(b[k]).replace(/\s+/g, " ").trim().slice(0, 400));
  let r; try { r = $app.findFirstRecordByData("org_settings", "key", "org"); } catch (_) { r = new Record($app.findCollectionByNameOrId("org_settings")); r.set("key", "org"); }
  r.set("data", d); $app.save(r);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Обход склада: изменить / удалить запись ----------
routerAdd("POST", "/api/vs/walk/save", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper"]);
  const b = e.requestInfo().body || {};
  const r = $app.findRecordById("walk_entries", L.str(b.id));
  if (L.role(a) !== "admin" && L.role(a) !== "manager" && r.getString("created_by") !== a.id) throw new ForbiddenError("Изменить может тот, кто записал.");
  ["place", "material", "qty", "unit", "note"].forEach((k) => { if (b[k] !== undefined) r.set(k, L.str(b[k]).replace(/\s+/g, " ").trim().slice(0, k === "note" ? 1000 : k === "material" ? 500 : 200)); });
  r.set("search_lc", X.lc([r.getString("place"), r.getString("material"), r.getString("note")].join(" ")).slice(0, 2000));
  $app.save(r);
  X.remember($app, "walk_place", r.getString("place"));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/walk/delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper"]);
  const r = $app.findRecordById("walk_entries", L.str((e.requestInfo().body || {}).id));
  if (L.role(a) !== "admin" && L.role(a) !== "manager" && r.getString("created_by") !== a.id) throw new ForbiddenError("Удалить может тот, кто записал.");
  $app.delete(r);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// поиск по записи обхода: search_lc при создании через коллекцию + запомнить место
onRecordCreateRequest((e) => {
  const X = require(`${__hooks}/lib_ext.js`);
  const r = e.record;
  r.set("search_lc", X.lc([r.getString("place"), r.getString("material"), r.getString("note")].join(" ")).slice(0, 2000));
  e.next();
  try { X.remember($app, "walk_place", r.getString("place")); } catch (_) {}
}, "walk_entries");
