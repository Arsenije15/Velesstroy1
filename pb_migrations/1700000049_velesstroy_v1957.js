/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.57 — скорость: индексы под выборки, которых не хватало (фото позиций и отгрузок, фото УПД, подсказки, невыданное)
migrate((app) => {
  const IX = [
    ["request_files", "idx_rf_item", "item"], ["request_files", "idx_rf_ship", "shipment"],
    ["upd_photos", "idx_updph_upd", "upd"], ["suggestions", "idx_sug_fl", "field, last"],
    ["leftovers", "idx_left_req", "request"], ["approvals", "idx_appr_st", "status"], ["receipts", "idx_rcp_st_cr", "status, created"],
  ];
  const by = {};
  IX.forEach(([c, n, f]) => (by[c] = by[c] || []).push([n, f]));
  Object.keys(by).forEach((c) => {
    let col; try { col = app.findCollectionByNameOrId(c); } catch (_) { return; }
    let add = 0;
    by[c].forEach(([n, f]) => {
      if (!f.split(",").every((x) => col.fields.getByName(x.trim()))) return;
      if ((col.indexes || []).some((s) => s.indexOf(n) >= 0)) return;
      col.indexes.push(`CREATE INDEX ${n} ON ${c} (${f})`); add++;
    });
    if (add) app.save(col);
  });
}, (app) => {});
