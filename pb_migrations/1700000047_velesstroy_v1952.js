/// <reference path="../pb_data/types.d.ts" />
// 1.9.52: флажок — до 30 фото; «Фактический остаток» склада (позиции + движение: −выдача по заявкам, +приход по УПД)
const FULL = '@request.auth.id != "" && @request.auth.scope = "" && @request.auth.role != "coord"';
migrate((app) => {
  const fl = app.findCollectionByNameOrId("smap_flags"); fl.fields.getByName("photo").maxSelect = 30; app.save(fl);
  const users = app.findCollectionByNameOrId("users");
  const st = new Collection({
    type: "base", name: "fstock",
    listRule: FULL, viewRule: FULL, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "name", type: "text", required: true, max: 1500 },
      { name: "key", type: "text", max: 1500 },
      { name: "alias_lc", type: "text", max: 20000 },
      { name: "unit", type: "text", max: 30 },
      { name: "qty", type: "number" },
      { name: "code", type: "text", max: 60 },
      { name: "place", type: "text", max: 300 },
      { name: "note", type: "text", max: 1000 },
      { name: "src", type: "text", max: 20 },
      { name: "search_lc", type: "text", max: 4000 },
      { name: "updated_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_fst_key ON fstock (key)", "CREATE INDEX idx_fst_name ON fstock (name)"],
  });
  app.save(st);
  app.save(new Collection({
    type: "base", name: "fstock_moves",
    listRule: FULL, viewRule: FULL, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "stock", type: "relation", collectionId: st.id, maxSelect: 1, cascadeDelete: true },
      { name: "kind", type: "select", maxSelect: 1, values: ["init", "in", "out", "count", "add"] },
      { name: "name", type: "text", max: 1500 },
      { name: "key", type: "text", max: 1500 },
      { name: "unit", type: "text", max: 30 },
      { name: "delta", type: "number" },
      { name: "after", type: "number" },
      { name: "pending", type: "bool" },
      { name: "src", type: "text", max: 20 },
      { name: "ref", type: "text", max: 40 },
      { name: "ref_no", type: "text", max: 300 },
      { name: "note", type: "text", max: 1000 },
      { name: "by_name", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_fsm_stock ON fstock_moves (stock, created)", "CREATE INDEX idx_fsm_pend ON fstock_moves (pending)", "CREATE INDEX idx_fsm_ref ON fstock_moves (src, ref)"],
  }));
}, (app) => {
  ["fstock_moves", "fstock"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
  const fl = app.findCollectionByNameOrId("smap_flags"); fl.fields.getByName("photo").maxSelect = 20; app.save(fl);
});
