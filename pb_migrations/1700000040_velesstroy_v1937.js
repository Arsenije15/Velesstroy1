/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.37 — «Монтаж»: нормативы — расход материала на единицу работ и нормы выдачи инструмента / расходников
migrate((app) => {
  const users = app.findCollectionByNameOrId("users"), items = app.findCollectionByNameOrId("mz_items");
  const R = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = "mz"';
  const W = R + ' && @request.auth.role = "storekeeper"';
  app.save(new Collection({
    type: "base", name: "mz_norms",
    listRule: R, viewRule: R, createRule: W + " && created_by = @request.auth.id", updateRule: W + " && @request.body.created_by:isset = false", deleteRule: W,
    fields: [
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["work", "issue"] },
      { name: "work", type: "text", max: 300 }, { name: "work_unit", type: "text", max: 40 },
      { name: "item", type: "relation", collectionId: items.id, maxSelect: 1 },
      { name: "name", type: "text", max: 500, required: true }, { name: "size", type: "text", max: 100 }, { name: "unit", type: "text", max: 30 },
      { name: "qty", type: "number", min: 0 },
      { name: "period_days", type: "number", min: 0 }, { name: "per", type: "text", max: 60 },
      { name: "note", type: "text", max: 1000 }, { name: "search_lc", type: "text", max: 2000 },
      { name: "demo", type: "bool" },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_mzn_kind ON mz_norms (kind, work)"],
  }));
}, (app) => { try { app.delete(app.findCollectionByNameOrId("mz_norms")); } catch (_) {} });
