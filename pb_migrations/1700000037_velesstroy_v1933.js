/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.33 — «Склад Велесстрой Монтаж»: пример данных (demo), накладные на выдачу и заявки на закупку (mz_docs)
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const it = app.findCollectionByNameOrId("mz_items"); if (!it.fields.getByName("demo")) { it.fields.add(new BoolField({ name: "demo" })); app.save(it); }
  const R = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = "mz"';
  const W = R + ' && @request.auth.role = "storekeeper"';
  const docs = new Collection({
    type: "base", name: "mz_docs",
    listRule: R, viewRule: R, createRule: null,
    updateRule: W + ' && @request.body.lines:isset = false && @request.body.number:isset = false && @request.body.kind:isset = false && @request.body.demo:isset = false',
    deleteRule: null,
    fields: [
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["issue", "purchase"] },
      { name: "number", type: "text", max: 40 }, { name: "doc_date", type: "text", max: 10 },
      { name: "who", type: "text", max: 200 }, { name: "basis", type: "text", max: 300 }, { name: "org", type: "text", max: 200 },
      { name: "need_by", type: "text", max: 10 }, { name: "note", type: "text", max: 2000 },
      { name: "lines", type: "json", maxSize: 400000 },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "sent", "signed", "done"] },
      { name: "files", type: "file", maxSelect: 10, maxSize: 30 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"] },
      { name: "search_lc", type: "text", max: 5000 }, { name: "demo", type: "bool" },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_mzd_k ON mz_docs (kind, created)"],
  });
  app.save(docs);
  const mv = app.findCollectionByNameOrId("mz_moves");
  if (!mv.fields.getByName("doc")) mv.fields.add(new RelationField({ name: "doc", collectionId: docs.id, maxSelect: 1 }));
  if (!mv.fields.getByName("demo")) mv.fields.add(new BoolField({ name: "demo" }));
  app.save(mv);
}, (app) => {
  try { const mv = app.findCollectionByNameOrId("mz_moves"); ["doc", "demo"].forEach((n) => { const f = mv.fields.getByName(n); if (f) mv.fields.removeById(f.id); }); app.save(mv); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("mz_docs")); } catch (_) {}
});
