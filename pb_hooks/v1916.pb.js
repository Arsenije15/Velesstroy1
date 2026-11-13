/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.16 — откуда и чем брали материал по заявке; место выгрузки прихода; подсказка «в прошлый раз»

// ---------- Позиция заявки: откуда взяли и чем ----------
routerAdd("POST", "/api/vs/request/pick", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const it = tx.findRecordById("request_items", L.str(b.item));
    const r = tx.findRecordById("requests", it.getString("request"));
    if (r.getString("status") === "cancelled") throw new BadRequestError("Заявка аннулирована.");
    const place = L.str(b.place).slice(0, 300), tool = L.str(b.tool).slice(0, 300);
    it.set("pick_place", place); it.set("pick_tool", tool); it.set("pick_by_name", place || tool ? L.userName(a) : ""); it.set("pick_at", place || tool ? L.fmt(new Date()) : "");
    tx.save(it);
    X.remember(tx, "pick_place", place); X.remember(tx, "pick_tool", tool);
    L.log(tx, a, "request_pick", "requests", r.id, "Заявка № " + r.getString("number") + ": «" + it.getString("material").slice(0, 80) + "» — взяли: " + (place || "—") + (tool ? ", чем: " + tool : ""), { item: it.id });
    out = { ok: true };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Приход (УПД): место выгрузки ----------
routerAdd("POST", "/api/vs/upd/unload", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "skk"]);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const u = tx.findRecordById("upd_docs", L.str(b.upd));
    const place = L.str(b.place).slice(0, 300);
    u.set("unload_place", place); u.set("unload_by_name", place ? L.userName(a) : ""); u.set("unload_at", place ? L.fmt(new Date()) : "");
    tx.saveNoValidate(u);
    X.remember(tx, "unload_place", place);
    L.log(tx, a, "upd_unload", "upd_docs", u.id, "УПД № " + u.getString("number") + ": место выгрузки — " + (place || "снято"), {});
    out = { ok: true };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Подсказка: где брали / куда выгружали такой материал раньше ----------
routerAdd("POST", "/api/vs/pickhist", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const Z = require(`${__hooks}/lib19.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk", "skk_view"]);
  const b = e.requestInfo().body || {};
  const names = (Array.isArray(b.names) ? b.names : []).map((x) => L.str(x).slice(0, 500)).slice(0, 300);
  const skip = L.str(b.request);
  const picks = $app.findRecordsByFilter("request_items", "pick_place != '' || pick_tool != ''", "-pick_at", 3000, 0).filter((x) => x.getString("request") !== skip).map((x) => {
    let num = "", rid = x.getString("request"); try { num = $app.findRecordById("requests", rid).getString("number"); } catch (_) {}
    return { m: x.getString("material"), S: Z.tokset(x.getString("material")), T: Z.toks(x.getString("material")), place: x.getString("pick_place"), tool: x.getString("pick_tool"), at: x.getString("pick_at"), by: x.getString("pick_by_name"), number: num, request: rid };
  });
  const unl = [];
  $app.findRecordsByFilter("upd_docs", "unload_place != ''", "-unload_at", 1500, 0).forEach((u) => {
    let its = []; try { its = JSON.parse(u.getString("items") || "[]") || []; } catch (_) {}
    its.forEach((x) => { const nm = x.spec_name || x.name || ""; if (nm) unl.push({ m: nm, S: Z.tokset(nm), T: Z.toks(nm), place: u.getString("unload_place"), at: u.getString("unload_at") || u.getString("created"), number: u.getString("number"), supplier: u.getString("supplier"), upd: u.id }); });
  });
  const best = (A, SA, pool) => { let bb = null; pool.forEach((p) => { const s = (Z.simT(A, p.S) + Z.simT(p.T, SA)) / 2; if (s >= 0.8 && (!bb || s > bb.s + 0.001 || (Math.abs(s - bb.s) < 0.001 && p.at > bb.p.at))) bb = { s: s, p: p }; }); return bb ? Object.assign({ score: Math.round(bb.s * 100) / 100 }, bb.p, { S: undefined, T: undefined }) : null; };
  const out = names.map((n) => { const A = Z.toks(n), SA = Z.tokset(n); if (A.length < 2) return {}; return { pick: best(A, SA, picks), unload: best(A, SA, unl) }; });
  return e.json(200, { results: out });
}, $apis.requireAuth("users"));
