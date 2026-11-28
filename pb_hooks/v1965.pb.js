/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.65 — папки «Заявки» и «Поставки (УПД)»: очередь чтения → «Ждут подтверждения» → заявка «на почте» / приёмка

// файл в папку: номер — из имени («З-7137.pdf» → 7137), статус «в папке»
onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib1965.js`);
  const a = e.auth; const r = e.record; const kind = r.getString("kind") === "upd" ? "upd" : "zay";
  let name = r.getString("name");
  if (!name) { try { const f = r.get("file"); name = (f && (f.originalName || f.name)) || ""; } catch (_) {} }
  r.set("kind", kind); r.set("name", String(name).slice(0, 300));
  const no = X.parseName(kind, name); r.set("number", no); r.set("number_norm", X.normNo(no));
  r.set("status", "new"); r.set("result", null); r.set("ref", ""); r.set("ref_no", "");
  if (a) r.set("by_name", L.userName(a));
  e.next();
  try { L.log($app, a, "inbox_add", "inbox_files", r.id, "📁 В папку «" + (kind === "upd" ? "Поставки (УПД)" : "Заявки") + "»: " + name, {}); } catch (_) {}
}, "inbox_files");

routerAdd("GET", "/api/vs/inbox/list", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const k = e.request.url.query().get("kind") === "upd" ? "upd" : "zay";
  return e.json(200, { kind: k, items: require(`${__hooks}/lib1965.js`).list($app, k) });
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/inbox/item/{id}", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const r = $app.findRecordById("inbox_files", e.request.pathValue("id"));
  const o = require(`${__hooks}/lib1965.js`).brief(r); let res = null; try { res = JSON.parse(r.getString("result") || "null"); } catch (_) {}
  o.result = res; return e.json(200, o);
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/inbox/queue", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  return e.json(200, require(`${__hooks}/lib1965.js`).queue($app, a, L, e.requestInfo().body || {}));
}, $apis.requireAuth("users"));
// один шаг очереди (страница папки вызывает, пока есть что читать; раз в минуту — сам сервер)
routerAdd("POST", "/api/vs/inbox/next", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, L.WRITE_ROLES);
  return e.json(200, require(`${__hooks}/lib1965.js`).processNext($app, L));
}, $apis.requireAuth("users"));
// подтверждено: заявка создана («на почте») / приёмка создана
routerAdd("POST", "/api/vs/inbox/done", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {}; const r = $app.findRecordById("inbox_files", L.str(b.id));
  const kind = r.getString("kind"); let no = "";
  if (kind === "zay") { const q = $app.findRecordById("requests", L.str(b.ref)); no = q.getString("number"); }
  else { const q = $app.findRecordById("receipts", L.str(b.ref)); no = q.getString("upd_number"); }
  r.set("status", "done"); r.set("ref", L.str(b.ref)); r.set("ref_no", no); r.set("done_at", new Date().toISOString().replace("T", " ")); $app.saveNoValidate(r);
  try { L.log($app, a, "inbox_done", "inbox_files", r.id, "✅ Подтверждено из папки: " + (kind === "zay" ? "заявка № " + no + " — на почте" : "УПД № " + no + " — приёмка"), {}); } catch (_) {}
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/inbox/delete", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  const r = $app.findRecordById("inbox_files", L.str((e.requestInfo().body || {}).id));
  if (r.getString("status") === "reading") throw new BadRequestError("Файл сейчас читается — подождите.");
  const nm = r.getString("name"); $app.delete(r);
  try { L.log($app, a, "inbox_delete", "inbox_files", "", "🗑 Удалён из папки: " + nm, {}); } catch (_) {}
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// раз в минуту: если страница папки закрыта — очередь всё равно идёт
cronAdd("vs_inbox", "* * * * *", () => {
  try {
    const R = arrayOf(new DynamicModel({ n: 0 })); $app.db().newQuery("SELECT COUNT(*) AS n FROM inbox_files WHERE status IN ('queued','reading')").all(R);
    if (R.length && R[0].n > 0) require(`${__hooks}/lib1965.js`).processNext($app, require(`${__hooks}/lib.js`));
  } catch (err) { console.log("inbox cron: " + err); }
});
