/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.33 — «Склад Велесстрой Монтаж»: выдача по накладной, заявка на закупку, пример данных
routerAdd("POST", "/api/vs/mz/issue", (e) => {
  const M = require(`${__hooks}/lib1932.js`), D = require(`${__hooks}/lib1933.js`);
  const a = M.mzWriter(e); const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => { const d = D.issue(tx, a, b); out = { id: d.id, number: d.getString("number") }; });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/mz/purchase", (e) => {
  const M = require(`${__hooks}/lib1932.js`), D = require(`${__hooks}/lib1933.js`);
  const a = M.mzWriter(e); const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => { const d = D.purchase(tx, a, b); out = { id: d.id, number: d.getString("number") }; });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/mz/demo", (e) => {
  const M = require(`${__hooks}/lib1932.js`), D = require(`${__hooks}/lib1933.js`);
  M.mzUser(e);
  const st = D.stateGet($app).d; let n = 0;
  try { const r = new DynamicModel({ n: 0 }); $app.db().newQuery("SELECT COUNT(*) AS n FROM mz_items WHERE demo = 1").one(r); n = r.n; } catch (_) {}
  return e.json(200, { seeded: !!st.seeded, cleared: !!st.cleared, demo_items: n });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/mz/demo", (e) => {
  const M = require(`${__hooks}/lib1932.js`), D = require(`${__hooks}/lib1933.js`);
  const a = M.mzWriter(e); const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    if (b.action === "clear") { D.demoClear(tx); out = { cleared: true }; }
    else out = D.demoSeed(tx, a);
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
// подсказки: что уже вписывали (кому, основание, место, группа, люди, техника) — предлагаются при следующем вводе
onRecordAfterCreateSuccess((e) => { const X = require(`${__hooks}/lib_ext.js`); X.remember($app, "mz_who", e.record.getString("who")); return e.next(); }, "mz_moves");
onRecordAfterCreateSuccess((e) => { const X = require(`${__hooks}/lib_ext.js`); ["grp", "place", "unit"].forEach((f) => X.remember($app, "mz_" + f, e.record.getString(f))); return e.next(); }, "mz_items");
onRecordAfterUpdateSuccess((e) => { const X = require(`${__hooks}/lib_ext.js`); ["grp", "place", "unit"].forEach((f) => X.remember($app, "mz_" + f, e.record.getString(f))); return e.next(); }, "mz_items");
onRecordAfterCreateSuccess((e) => { const X = require(`${__hooks}/lib_ext.js`);
  String(e.record.getString("people")).split(",").forEach((p) => X.remember($app, "mz_people", p.trim()));
  X.remember($app, "mz_tech", e.record.getString("tech")); X.remember($app, "mz_place", e.record.getString("place")); return e.next(); }, "mz_tasks");
onRecordAfterCreateSuccess((e) => { const X = require(`${__hooks}/lib_ext.js`); const r = e.record;
  if (r.getString("kind") === "issue") { X.remember($app, "mz_who", r.getString("who")); X.remember($app, "mz_basis", r.getString("basis")); (r.get("lines") || []).forEach((l) => X.remember($app, "mz_lnote", l.note)); }
  else X.remember($app, "mz_pbasis", r.getString("basis"));
  X.remember($app, "mz_org", r.getString("org")); return e.next(); }, "mz_docs");
