/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.56 — прочитанный при приёмке УПД: материалы и количество — в приёмку (в «Фактический остаток» — приход);
// список УПД СКК («Склад / СКК → УПД») не трогаем — там только то, что вносит СКК
routerAdd("POST", "/api/vs/receipt/upd_items", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib1952.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("receipts", L.str(b.receipt));
    const num = (x) => { const v = parseFloat(String(x == null ? "" : x).replace(/\s/g, "").replace(",", ".")); return isNaN(v) ? null : Math.round(v * 1000) / 1000; };
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 1500).map((x, k) => ({
      no: num(x.no) || k + 1, name: L.str(x.name).slice(0, 1000), unit: L.str(x.unit).slice(0, 20), qty: num(x.qty) })).filter((x) => x.name);
    r.set("upd_items", items);
    if (/^\d{4}-\d{2}-\d{2}$/.test(L.str(b.date))) r.set("upd_date", L.str(b.date));
    tx.save(r);
    // черновик чтения (файл уже приложен к приёмке) — в список УПД СКК не попадает, удаляем
    if (L.str(b.upd_doc)) {
      try { const u = tx.findRecordById("upd_docs", L.str(b.upd_doc)); if (u.getString("status") === "draft" && (L.isSuper(a) || u.getString("uploaded_by") === a.id)) tx.delete(u); } catch (_) {}
    }
    // приход в «Фактический остаток» по приёмке; если тот же УПД уже внесла СКК — не считаем.
    // 1.9.59: материалы поправили позже — проводится только разница (было учтено → стало)
    let n = 0, skip = "";
    const refNo = "УПД № " + r.getString("upd_number") + (r.getString("supplier") ? " · " + r.getString("supplier") : "");
    if (F.active(tx)) {
      const prev = tx.findRecordsByFilter("fstock_moves", "src = 'receipt' && ref = {:r}", "", 0, 0, { r: r.id });
      if (!prev.length && tx.findRecordsByFilter("fstock_moves", "src = 'upd' && ref_no = {:n}", "", 1, 0, { n: refNo }).length) skip = "этот УПД уже учтён по списку СКК";
      else {
        const was = {}, now = {}, nm = {};
        prev.forEach((m) => { const k = m.getString("key") || F.key(m.getString("name")); was[k] = (was[k] || 0) + m.getFloat("delta"); if (!nm[k]) nm[k] = { name: m.getString("name"), unit: m.getString("unit") }; });
        items.forEach((x) => { if (!(x.qty > 0)) return; const k = F.key(x.name); now[k] = (now[k] || 0) + x.qty; nm[k] = { name: x.name, unit: x.unit }; });
        Object.keys(nm).forEach((k) => {
          const d = Math.round(((now[k] || 0) - (was[k] || 0)) * 1000) / 1000; if (!d) return;
          F.move(tx, { stock: F.find(tx, k) || F.find(tx, F.key(nm[k].name)), kind: d > 0 ? "in" : "out", name: nm[k].name, unit: nm[k].unit, delta: d, src: "receipt", ref: r.id, ref_no: refNo, by: L.userName(a), note: prev.length ? "исправление приёмки" : "" }); n++;
        });
      }
    }
    L.log(tx, a, "receipt_upd_items", "receipts", r.id, "Приёмка УПД № " + r.getString("upd_number") + ": материалы из УПД — " + items.length + " поз." + (n ? ", приход в фактический остаток: " + n : "") + (skip ? " (" + skip + ")" : ""), {});
    out = { items: items.length, fstock: n, skip: skip };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// 1.9.59: «Приёмка материалов» — УПД из приёмок, которых нет в списке УПД СКК (за всё время)
routerAdd("GET", "/api/vs/receipt/not_in_skk", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, L.WRITE_ROLES.concat(["viewer"]).filter((x, i, A) => A.indexOf(x) === i));
  const q = String(e.request.url.query().get("q") || "").toLowerCase().trim().slice(0, 100);
  const rows = arrayOf(new DynamicModel({ id: "", upd_number: "", supplier: "", status: "", created: "", finished_at: "", upd_items: "" }));
  $app.db().newQuery("SELECT id, COALESCE(upd_number,'') AS upd_number, COALESCE(supplier,'') AS supplier, COALESCE(status,'') AS status, COALESCE(created,'') AS created, " +
    "COALESCE(finished_at,'') AS finished_at, COALESCE(upd_items,'') AS upd_items FROM receipts ORDER BY created DESC LIMIT 5000").all(rows);
  const nums = arrayOf(new DynamicModel({ n: "" }));
  $app.db().newQuery("SELECT DISTINCT COALESCE(number,'') AS n FROM upd_docs WHERE status != 'draft'").all(nums);
  const nk = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "").replace(/^№/, "");
  const have = {}; JSON.parse(JSON.stringify(nums)).forEach((x) => { have[nk(x.n)] = 1; });
  let out = JSON.parse(JSON.stringify(rows)).filter((r) => !have[nk(r.upd_number)]).map((r) => { let it = []; try { it = typeof r.upd_items === "string" ? JSON.parse(r.upd_items || "[]") : r.upd_items || []; } catch (_) {} if (!Array.isArray(it)) it = [];
    return { id: r.id, upd_number: r.upd_number, supplier: r.supplier, status: r.status, created: r.created, finished_at: r.finished_at, n: it.length, mats: it.map((x) => x && x.name).join("; ").slice(0, 2000) }; });
  if (q) { const W = q.split(/\s+/).filter(Boolean); out = out.filter((r) => { const s = (r.upd_number + " " + r.supplier + " " + r.mats).toLowerCase(); return W.every((w) => s.indexOf(w) >= 0); }); }
  return e.json(200, { items: out.slice(0, 300), total: out.length });
}, $apis.requireAuth("users"));
