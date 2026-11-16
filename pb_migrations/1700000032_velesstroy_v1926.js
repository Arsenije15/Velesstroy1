/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.26 — скорость: индексы под частые выборки (открытые заявки, долги, УПД, акты, журнал, брони)
migrate((app) => {
  const IX = [
    ["requests", "idx_req_upd", "updated"], ["requests", "idx_req_cb", "created_by, status"], ["requests", "idx_req_sig", "status, signed_all"], ["requests", "idx_req_created", "created"],
    ["request_items", "idx_ri_upd", "updated"], ["request_shipments", "idx_rs_upd", "updated"],
    ["upd_docs", "idx_upd_st", "status, created"], ["upd_docs", "idx_upd_date", "date"],
    ["skk_acts", "idx_skk_cr", "created"], ["skk_acts", "idx_skk_cl", "closed_at"],
    ["activity_log", "idx_al_act", "action, created"], ["reservations", "idx_resv_end", "end"], ["receipts", "idx_rcp_cr", "created"],
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
