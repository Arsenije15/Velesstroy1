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
    // приход в «Фактический остаток» — один раз на приёмку; если тот же УПД уже внесла СКК — второй раз не считаем
    let n = 0, skip = "";
    const refNo = "УПД № " + r.getString("upd_number") + (r.getString("supplier") ? " · " + r.getString("supplier") : "");
    if (F.active(tx) && items.length) {
      if (tx.findRecordsByFilter("fstock_moves", "src = 'receipt' && ref = {:r}", "", 1, 0, { r: r.id }).length) skip = "уже учтено";
      else if (tx.findRecordsByFilter("fstock_moves", "src = 'upd' && ref_no = {:n}", "", 1, 0, { n: refNo }).length) skip = "этот УПД уже учтён по списку СКК";
      else items.forEach((x) => {
        if (!(x.qty > 0)) return;
        F.move(tx, { stock: F.find(tx, F.key(x.name)), kind: "in", name: x.name, unit: x.unit, delta: x.qty, src: "receipt", ref: r.id, ref_no: refNo, by: L.userName(a) }); n++;
      });
    }
    L.log(tx, a, "receipt_upd_items", "receipts", r.id, "Приёмка УПД № " + r.getString("upd_number") + ": материалы из УПД — " + items.length + " поз." + (n ? ", приход в фактический остаток: " + n : "") + (skip ? " (" + skip + ")" : ""), {});
    out = { items: items.length, fstock: n, skip: skip };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
