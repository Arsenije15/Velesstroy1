/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.25 — «Единый сводный отчёт» прихода: загрузка частями, сводка по кладовщикам

routerAdd("POST", "/api/vs/ureg/import", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper"]);
  const b = e.requestInfo().body || {};
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000);
  const MX = { gm_no: 40, date_in: 10, kind: 60, short: 300, supplier: 300, contract: 120, contract_date: 10, spec: 120, doc1c_ship: 60, doc_kind: 40, number: 80,
    doc_date: 10, doc_form: 60, keeper: 200, recv_date: 10, nc_has: 120, nc_no: 200, nc_date: 10, status: 120, doc1c: 60, orig_date: 10, buh_no: 60, buh_date: 10, note: 1000 };
  const F = Object.keys(MX);
  let n = 0;
  $app.runInTransaction((tx) => {
    if (b.first) tx.db().newQuery("DELETE FROM ureg").execute();
    const col = tx.findCollectionByNameOrId("ureg");
    rows.forEach((r) => {
      const no = L.str(r.number).trim();
      if (!no) return;
      const rec = new Record(col);
      F.forEach((f) => rec.set(f, L.str(r[f]).replace(/\s+/g, " ").trim().slice(0, MX[f])));
      const nn = X.lc(no).replace(/№/g, "").replace(/\s+/g, "");
      rec.set("number_n", nn.slice(0, 80));
      rec.set("num_d", nn.replace(/\D/g, "").replace(/^0+/, "").slice(0, 40));
      const am = Number(String(r.amount == null ? "" : r.amount).replace(/\s/g, "").replace(",", "."));
      rec.set("amount", isFinite(am) ? am : 0);
      rec.set("row_no", +r.row_no || 0);
      rec.set("search_lc", X.lc(["gm_no", "supplier", "short", "number", "keeper", "status", "contract", "spec", "doc1c", "nc_no", "note"].map((f) => L.str(r[f])).join(" ")).slice(0, 3000));
      tx.save(rec); n++;
    });
    if (b.last) L.log(tx, a, "ureg_import", "ureg", "", "Сводный отчёт: " + L.str(b.file_name).slice(0, 150) + " — " + (+b.total || n) + " строк");
  });
  return e.json(200, { saved: n });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/vs/ureg/meta", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk"]);
  let cnt = 0; try { const r = new DynamicModel({ n: 0 }); $app.db().newQuery("SELECT COUNT(*) AS n FROM ureg").one(r); cnt = r.n; } catch (_) {}
  let last = null;
  try { const l = $app.findRecordsByFilter("activity_log", "action = 'ureg_import'", "-created", 1, 0); if (l.length) last = { at: l[0].getString("created"), summary: l[0].getString("summary"), user: l[0].getString("user_name") }; } catch (_) {}
  return e.json(200, { count: cnt, last: last });
}, $apis.requireAuth("users"));

// сводка по кладовщикам за период (по дате принятия груза)
routerAdd("GET", "/api/vs/ureg/keepers", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk"]);
  const q = e.request.url.query();
  const D = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  const from = D(q.get("from")) || "0000-00-00", to = D(q.get("to")) || "9999-99-99";
  const X = require(`${__hooks}/lib_ext.js`);
  const R = arrayOf(new DynamicModel({ keeper: "", status: "", amount: 0.1, nc_no: "", nc_has: "", recv_date: "" }));
  $app.db().newQuery("SELECT keeper, status, amount, nc_no, nc_has, recv_date FROM ureg WHERE recv_date >= {:f} AND recv_date <= {:t}").bind({ f: from, t: to }).all(R);
  const G = {};
  R.forEach((r) => {
    const k = String(r.keeper || "").trim() || "—"; const g = G[k] || (G[k] = { keeper: k, n: 0, sum: 0, posted: 0, err: 0, notp: 0, nc: 0, first: "", last: "" });
    const st = X.lc(r.status);
    g.n++; g.sum += +r.amount || 0;
    if (/ошибк/.test(st)) g.err++; else if (/^проведено в 1с/.test(st)) g.posted++; else if (!st || /^не провед/.test(st)) g.notp++;
    const nh = X.lc(r.nc_has).trim(); if (r.nc_no || (nh && nh !== "нет" && nh !== "-")) g.nc++;
    if (r.recv_date) { if (!g.first || r.recv_date < g.first) g.first = r.recv_date; if (!g.last || r.recv_date > g.last) g.last = r.recv_date; }
  });
  const out = Object.values(G).sort((a, b) => b.n - a.n);
  return e.json(200, { rows: out });
}, $apis.requireAuth("users"));
