/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.7 — отчёт за день (сделано и пропуски), удаление фото из заявки, остатки МПЗ.

// ---------- Отчёт за день ----------
routerAdd("GET", "/api/vs/report/day", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  let day = L.str(e.request.url.query().get("date"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = L.todayLocal();
  const off = (() => { const v = parseInt($os.getenv("VS_TZ_OFFSET_MIN") || "180", 10); return isNaN(v) ? 180 : v; })();
  const from = new Date(new Date(day + "T00:00:00Z").getTime() - off * 60000), to = new Date(from.getTime() + 86400000);
  const F = L.fmt(from), T = L.fmt(to), nowS = L.fmt(new Date());
  const reqCache = {};
  const req = (id) => { if (!id) return null; if (reqCache[id] !== undefined) return reqCache[id]; try { reqCache[id] = $app.findRecordById("requests", id); } catch (_) { reqCache[id] = null; } return reqCache[id]; };
  const rq = (r) => r ? { id: r.id, number: r.getString("number"), object: r.getString("object") } : null;
  // что сделано
  const logs = $app.findRecordsByFilter("activity_log", "created >= {:f} && created < {:t}", "created", 5000, 0, { f: F, t: T });
  const done = logs.map((l) => ({ at: l.getString("created"), user: l.getString("user_name"), action: l.getString("action"), summary: l.getString("summary"),
    request: l.getString("entity") === "requests" ? rq(req(l.getString("entity_id"))) : null }));
  const cnt = (re) => logs.filter((l) => re.test(l.getString("action"))).length;
  const counts = { created: cnt(/^request_create$/), issued: cnt(/^request_issue$/), closed: cnt(/^request_close$/), signed: cnt(/^request_sign$/),
    sent: cnt(/^shipment_send$/), delivered: cnt(/^shipment_deliver$/), steps: cnt(/^shipment_step$/), receipts: cnt(/^receipt_complete$/),
    overrides: cnt(/^override$/), photos_deleted: cnt(/^request_file_delete$/), total: logs.length };
  // пропуски
  const gaps = [];
  const files = (filter, p) => $app.findRecordsByFilter("request_files", filter, "", 0, 0, p);
  const isImg = (f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.getString("file"));
  const touched = {}; logs.forEach((l) => { if (l.getString("entity") === "requests") touched[l.getString("entity_id")] = 1; });
  // 1) открытые заявки
  $app.findRecordsByFilter("requests", "status = 'open'", "created", 0, 0).forEach((r) => {
    const days = Math.floor((to.getTime() - (L.parse(r.getString("created")) || to).getTime()) / 86400000);
    const pd = r.getString("planned_date").slice(0, 10);
    gaps.push({ type: "open", sev: pd && pd <= day ? 2 : touched[r.id] ? 1 : 0, request: rq(r),
      text: "Заявка не закрыта" + (pd ? ", план выдачи " + pd.split("-").reverse().join(".") + (pd < day ? " — ПРОСРОЧЕНА" : pd === day ? " — сегодня" : "") : "") + (touched[r.id] ? " · сегодня по ней работали" : "") + " · открыта дней: " + days });
  });
  // 2) закрыты сегодня без фото закрытия
  $app.findRecordsByFilter("requests", "status = 'closed' && closed_at >= {:f} && closed_at < {:t}", "closed_at", 0, 0, { f: F, t: T }).forEach((r) => {
    if (!files("request = {:r} && kind = 'close'", { r: r.id }).length) gaps.push({ type: "close_nophoto", sev: 2, request: rq(r), text: "Закрыта без фото закрытия" });
  });
  // 3) долг — закрыты без всех подписей
  $app.findRecordsByFilter("requests", "status = 'closed' && signed_all = false", "closed_at", 0, 0).forEach((r) => {
    let sig = {}; try { sig = JSON.parse(r.getString("signatures") || "{}") || {}; } catch (_) {}
    const miss = X.SIGNS.filter((k) => !sig[k[0] || k]).map((k) => k[1] || k);
    gaps.push({ type: "debt", sev: 1, request: rq(r), text: "Нет подписей" + (miss.length ? ": " + miss.join(", ") : "") });
  });
  // 4) отгрузки: без фото погрузки, этапы не отмечены, не доставлены
  $app.findRecordsByFilter("request_shipments", "status != 'cancelled' && (status = 'preparing' || status = 'sent' || (delivered_at >= {:f} && delivered_at < {:t}) || (sent_at >= {:f} && sent_at < {:t}))", "created", 0, 0, { f: F, t: T }).forEach((s) => {
    const r = req(s.getString("request")); const head = "Отгрузка «" + s.getString("vehicle") + "»";
    const st = s.getString("status");
    if (st !== "preparing" && !files("shipment = {:s}", { s: s.id }).filter(isImg).length) gaps.push({ type: "ship_nophoto", sev: 2, request: rq(r), text: head + ": нет фото погрузки" });
    const steps = X.jsonArr(s, "steps"), left = steps.filter((x) => !x.at).map((x) => x.name);
    if (st === "delivered" && left.length) gaps.push({ type: "ship_steps", sev: 1, request: rq(r), text: head + " доставлена, но этапы не отмечены: " + left.join(", ") });
    if (st === "sent") gaps.push({ type: "ship_open", sev: 1, request: rq(r), text: head + ": в пути, доставка не отмечена" });
    if (st === "preparing") gaps.push({ type: "ship_open", sev: 0, request: rq(r), text: head + ": готовится, не отправлена" });
  });
  // 5) учёт не завершён
  $app.findRecordsByFilter("requests", "uchet_status = 'in_uchet'", "uchet_at", 0, 0).forEach((r) => gaps.push({ type: "uchet", sev: 0, request: rq(r), text: "Передана в учёт, учёт не завершён" }));
  // 6) заметки не выполнены
  $app.findRecordsByFilter("request_notes", "done = false", "created", 0, 0).forEach((n) => {
    const r = req(n.getString("request")); if (r && r.getString("status") === "cancelled") return;
    gaps.push({ type: "note", sev: 0, request: rq(r), text: "Заметка не выполнена: " + n.getString("text").slice(0, 200) });
  });
  gaps.sort((a, b) => b.sev - a.sev || String(a.type).localeCompare(String(b.type)) || String(a.request && a.request.number).localeCompare(String(b.request && b.request.number), undefined, { numeric: true }));
  return e.json(200, { day: day, from: F, to: T, now: nowS, counts: counts, done: done, gaps: gaps });
}, $apis.requireAuth("users"));

// ---------- Удалить фото / файл из заявки ----------
routerAdd("POST", "/api/vs/request/file_delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const g = X.guard(L, a, b);
  $app.runInTransaction((tx) => {
    const f = tx.findRecordById("request_files", L.str(b.file));
    const boss = L.isSuper(a) || ["admin", "manager"].indexOf(L.role(a)) >= 0;
    if (!boss && f.getString("uploaded_by") !== a.id) throw new ForbiddenError("Кладовщик может удалить только своё фото. Чужое — руководитель.");
    const r = tx.findRecordById("requests", f.getString("request"));
    const kindRu = { shipment: "фото погрузки", close: "фото закрытия", signed: "подписи", other: "фото" }[f.getString("kind")] || "файл";
    if (r.getString("status") === "closed" && f.getString("kind") === "close") {
      const left = tx.findRecordsByFilter("request_files", "request = {:r} && kind = 'close' && id != {:i}", "", 0, 0, { r: r.id, i: f.id });
      if (!left.length) X.deny(g, "Заявка № " + r.getString("number") + " закрыта — это единственное фото закрытия. Без него заявка будет закрыта без фото.");
    }
    X.check(g);
    const what = kindRu + " «" + f.getString("file").replace(/_[a-z0-9]{10}(\.\w+)$/i, "$1") + "»";
    tx.delete(f);
    if (g.msgs.length) X.ovrSave(L, tx, g, r, "requests", r.id, "удалено " + what + " из заявки № " + r.getString("number"));
    L.log(tx, a, "request_file_delete", "requests", r.id, "Заявка № " + r.getString("number") + ": удалено " + what + (L.str(b.reason) ? " — " + L.str(b.reason).slice(0, 300) : ""), { file: f.id });
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Остатки МПЗ (ведомость 1С) ----------
routerAdd("POST", "/api/vs/mpz/import", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const imp = L.str(b.import_id);
  if (!/^[a-z0-9]{6,40}$/.test(imp)) throw new BadRequestError("Неверный идентификатор загрузки.");
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length > 1000) throw new BadRequestError("Слишком много строк в одной части.");
  let total = 0, removed = 0;
  $app.runInTransaction((tx) => {
    const col = tx.findCollectionByNameOrId("mpz_stock");
    const n = (v) => { const q = parseFloat(String(v === undefined || v === null ? "" : v).replace(",", ".")); return isNaN(q) ? 0 : Math.round(q * 1000) / 1000; };
    rows.forEach((x) => {
      const name = L.str(x.name).slice(0, 1500); if (!name) return;
      const rec = new Record(col);
      rec.set("import_id", imp); rec.set("line_no", parseInt(x.line_no, 10) || 0);
      rec.set("warehouse", L.str(x.warehouse).slice(0, 300)); rec.set("account", L.str(x.account).slice(0, 30)); rec.set("name", name);
      rec.set("code", L.str(x.code).slice(0, 60)); rec.set("quality", L.str(x.quality).slice(0, 100)); rec.set("unit", L.str(x.unit).slice(0, 30));
      ["qty_start", "sum_start", "qty_in", "sum_in", "qty_out", "sum_out", "qty_end", "sum_end"].forEach((k) => rec.set(k, n(x[k])));
      rec.set("search_lc", X.lc(name + " " + L.str(x.code) + " " + L.str(x.code).replace(/^0+/, "") + " " + L.str(x.warehouse) + " " + L.str(x.quality)).slice(0, 3000));
      rec.set("period", L.str(b.period).slice(0, 200)); rec.set("source", L.str(b.file_name).slice(0, 200));
      tx.save(rec);
    });
    if (b.final) {
      const old = tx.findRecordsByFilter("mpz_stock", "import_id != {:i}", "", 0, 0, { i: imp });
      old.forEach((r) => tx.delete(r)); removed = old.length;
      total = tx.findRecordsByFilter("mpz_stock", "import_id = {:i}", "", 0, 0, { i: imp }).length;
      L.log(tx, a, "mpz_import", "mpz", "", "Загружены остатки МПЗ" + (L.str(b.period) ? " (" + L.str(b.period) + ")" : "") + (L.str(b.file_name) ? " «" + L.str(b.file_name) + "»" : "") + ": " + total + " строк", { file: L.str(b.file_name) });
    }
  });
  return e.json(200, { total: total, removed: removed });
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/mpz/meta", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk", "skk_view", "coord"]);
  const one = arrayOf(new DynamicModel({ n: 0, period: "", source: "", at: "", sum: "" }));
  $app.db().newQuery("SELECT COUNT(*) AS n, COALESCE(MAX(period),'') AS period, COALESCE(MAX(source),'') AS source, COALESCE(MAX(created),'') AS at, CAST(COALESCE(SUM(sum_end),0) AS TEXT) AS sum FROM mpz_stock").all(one);
  const wh = arrayOf(new DynamicModel({ v: "", n: 0 })), q = arrayOf(new DynamicModel({ v: "", n: 0 }));
  $app.db().newQuery("SELECT COALESCE(warehouse,'') AS v, COUNT(*) AS n FROM mpz_stock GROUP BY warehouse ORDER BY n DESC").all(wh);
  $app.db().newQuery("SELECT COALESCE(quality,'') AS v, COUNT(*) AS n FROM mpz_stock GROUP BY quality ORDER BY n DESC").all(q);
  const m = one[0] || { n: 0 };
  return e.json(200, { n: m.n, period: m.period, source: m.source, at: m.at, sum: parseFloat(m.sum) || 0, warehouses: wh.map((x) => ({ v: x.v, n: x.n })), qualities: q.map((x) => ({ v: x.v, n: x.n })) });
}, $apis.requireAuth("users"));
                                                                                   
