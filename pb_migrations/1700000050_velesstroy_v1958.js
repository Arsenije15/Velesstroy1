/// <reference path="../pb_data/types.d.ts" />
// 1.9.58: у каждого флажка свой номер; в позиции заявки — «взято с флажка №»; выдача по заявке сама уменьшает количество на флажке (история — smap_takes)
migrate((app) => {
  const fl = app.findCollectionByNameOrId("smap_flags");
  if (!fl.fields.getByName("no")) fl.fields.add(new NumberField({ name: "no", onlyInt: true }));
  fl.indexes.push("CREATE INDEX idx_smf_no ON smap_flags (no)");
  app.save(fl);
  let n = 0;
  app.findRecordsByFilter("smap_flags", "", "created", 0, 0).forEach((r) => { n++; r.set("no", n); app.saveNoValidate(r); });
  const ri = app.findCollectionByNameOrId("request_items");
  if (!ri.fields.getByName("flag")) ri.fields.add(new RelationField({ name: "flag", collectionId: fl.id, maxSelect: 1, cascadeDelete: false }));
  if (!ri.fields.getByName("flag_mat")) ri.fields.add(new TextField({ name: "flag_mat", max: 300 }));
  app.save(ri);
  const users = app.findCollectionByNameOrId("users"), rq = app.findCollectionByNameOrId("requests");
  app.save(new Collection({
    type: "base", name: "smap_takes", listRule: fl.listRule, viewRule: fl.viewRule, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "flag", type: "relation", collectionId: fl.id, maxSelect: 1, cascadeDelete: true },
      { name: "mat", type: "text", max: 300 }, { name: "unit", type: "text", max: 30 },
      { name: "qty", type: "number" }, { name: "before", type: "text", max: 40 }, { name: "after", type: "text", max: 40 },
      { name: "request", type: "relation", collectionId: rq.id, maxSelect: 1, cascadeDelete: false },
      { name: "request_item", type: "text", max: 20 }, { name: "number", type: "text", max: 100 },
      { name: "by_name", type: "text", max: 200 }, { name: "note", type: "text", max: 300 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_smt_flag ON smap_takes (flag, created)", "CREATE INDEX idx_smt_item ON smap_takes (request_item)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("smap_takes")); } catch (_) {}
  const ri = app.findCollectionByNameOrId("request_items"); ["flag", "flag_mat"].forEach((x) => { const f = ri.fields.getByName(x); if (f) ri.fields.removeById(f.id); }); app.save(ri);
  const fl = app.findCollectionByNameOrId("smap_flags"); const f = fl.fields.getByName("no"); if (f) fl.fields.removeById(f.id);
  fl.indexes = fl.indexes.filter((s) => s.indexOf("idx_smf_no") < 0); app.save(fl);
});
