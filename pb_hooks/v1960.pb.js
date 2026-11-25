/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.60 — «Приход склада» (сверка с СКК), диагностика скорости сервера
routerAdd("GET", "/api/vs/whin/list", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk", "skk_view"]);
  const g = (k) => String(e.request.url.query().get(k) || "").trim().slice(0, 100);
  return e.json(200, require(`${__hooks}/lib1960.js`).whinList($app, g("q"), g("mode")));
}, $apis.requireAuth("users"));
// добавить: один УПД {number,date,supplier,note} или список {lines:[{number,date,supplier,note}]}; повтор (тот же номер и поставщик) — пропускается
routerAdd("POST", "/api/vs/whin/add", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib1960.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const src = Array.isArray(b.lines) ? b.lines : [b];
  if (src.length > 500) throw new BadRequestError("За один раз — не больше 500 строк.");
  const col = $app.findCollectionByNameOrId("wh_upds"); let added = 0; const skipped = [];
  $app.runInTransaction((tx) => {
    src.forEach((x) => {
      const number = L.str(x && x.number).slice(0, 120); if (!number) return;
      const supplier = L.str(x && x.supplier).slice(0, 300); let date = L.str(x && x.date).slice(0, 10);
      const m = date.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/); if (m) date = (m[3].length === 2 ? "20" + m[3] : m[3]) + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = "";
      const k = X.nk(number);
      const dup = tx.findRecordsByFilter("wh_upds", "number_norm = {:k}", "", 50, 0, { k }).some((r) => X.sameOrg(r.getString("supplier"), supplier));
      if (dup) { skipped.push(number); return; }
      const r = new Record(col);
      r.set("number", number); r.set("number_norm", k); r.set("date", date || L.todayLocal()); r.set("supplier", supplier); r.set("note", L.str(x && x.note).slice(0, 500));
      r.set("by_name", L.userName(a)); r.set("created_by", a.isSuperuser && a.isSuperuser() ? "" : a.id);
      tx.save(r); added++;
    });
  });
  if (added) L.log($app, a, "whin_add", "wh_upds", "", "Приход склада: добавлено УПД — " + added + (skipped.length ? ", повторы пропущены: " + skipped.slice(0, 10).join(", ") : ""), {});
  return e.json(200, { added, skipped });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/whin/delete", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  const id = L.str((e.requestInfo().body || {}).id);
  let r; try { r = $app.findRecordById("wh_upds", id); } catch (_) { throw new NotFoundError("Запись не найдена."); }
  $app.delete(r);
  L.log($app, a, "whin_delete", "wh_upds", id, "Приход склада: удалён УПД № " + r.getString("number") + (r.getString("supplier") ? " (" + r.getString("supplier") + ")" : ""), {});
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// «⏱ Скорость»: что делает сервер — нагрузка, память, какие запросы и сколько времени он на них тратит (из журнала запросов PocketBase)
routerAdd("GET", "/api/vs/speed/server", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin"]);
  const rd = (p) => { try { return toString($os.readFile(p)); } catch (_) { return ""; } };
  const la = rd("/proc/loadavg").split(" ").slice(0, 3).map(Number);
  const mi = {}; rd("/proc/meminfo").split("\n").forEach((l) => { const m = l.match(/^(\w+):\s+(\d+)/); if (m) mi[m[1]] = Math.round(+m[2] / 1024); });
  const cpus = (rd("/proc/cpuinfo").match(/^processor\s*:/gm) || []).length || 1;
  let db = 0; try { db = Math.round($os.stat($app.dataDir() + "/data.db").size() / 1048576); } catch (_) {}
  const out = { load: la, cpus, mem: { total: mi.MemTotal || 0, avail: mi.MemAvailable || 0, swap: (mi.SwapTotal || 0) - (mi.SwapFree || 0), swap_total: mi.SwapTotal || 0 }, db_mb: db, top: [], slow: [], logs: true };
  const h = Math.min(72, Math.max(1, parseInt(e.request.url.query().get("h") || "24", 10) || 24));
  const since = new Date(Date.now() - h * 3600000).toISOString().replace("T", " ");
  const P = "CASE WHEN instr(json_extract(data,'$.url'),'?') > 0 THEN substr(json_extract(data,'$.url'), 1, instr(json_extract(data,'$.url'),'?') - 1) ELSE json_extract(data,'$.url') END";
  const W = "created >= {:d} AND json_extract(data,'$.type') = 'request' AND json_extract(data,'$.url') NOT LIKE '/api/realtime%'";
  try {
    const db2 = $app.auxDB();
    const T = arrayOf(new DynamicModel({ m: "", p: "", n: 0, avg: 0.5, mx: 0.5, tot: 0.5 }));
    db2.newQuery("SELECT COALESCE(json_extract(data,'$.method'),'') AS m, COALESCE(" + P + ",'') AS p, COUNT(*) AS n, AVG(json_extract(data,'$.execTime')) AS avg, MAX(json_extract(data,'$.execTime')) AS mx, SUM(json_extract(data,'$.execTime')) AS tot FROM _logs WHERE " + W + " GROUP BY m, p ORDER BY tot DESC LIMIT 25").bind({ d: since }).all(T);
    out.top = JSON.parse(JSON.stringify(T)).map((x) => ({ m: x.m, p: x.p.replace(/\/[a-z0-9]{15}(?=\/|$)/g, "/…"), n: x.n, avg: Math.round(x.avg), mx: Math.round(x.mx), tot: Math.round(x.tot / 1000) }));
    const S = arrayOf(new DynamicModel({ created: "", m: "", u: "", t: 0.5, s: 0 }));
    db2.newQuery("SELECT created, COALESCE(json_extract(data,'$.method'),'') AS m, COALESCE(json_extract(data,'$.url'),'') AS u, COALESCE(json_extract(data,'$.execTime'),0) AS t, COALESCE(json_extract(data,'$.status'),0) AS s FROM _logs WHERE " + W + " AND json_extract(data,'$.execTime') >= 700 ORDER BY t DESC LIMIT 40").bind({ d: since }).all(S);
    out.slow = JSON.parse(JSON.stringify(S)).map((x) => ({ at: x.created, m: x.m, u: x.u.replace(/token=[^&]*/, "token=…").slice(0, 300), t: Math.round(x.t), s: x.s }));
  } catch (err) { out.logs = false; out.err = String(err).slice(0, 200); }
  return e.json(200, out);
}, $apis.requireAuth("users"));
