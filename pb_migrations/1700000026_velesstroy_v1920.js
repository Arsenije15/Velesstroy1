/// <reference path="../pb_data/types.d.ts" />
// 1.9.20: фото и видео к позиции заявки; ссылка-отчёт с фото для стропальщиков (без входа)
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const items = app.findCollectionByNameOrId("request_items");
  const rf = app.findCollectionByNameOrId("request_files");
  rf.fields.add(new RelationField({ name: "item", collectionId: items.id, maxSelect: 1, cascadeDelete: true }));
  const k = rf.fields.getByName("kind"); k.values = ["shipment", "close", "signed", "other", "item"];
  const f = rf.fields.getByName("file");
  f.maxSize = 150 * 1024 * 1024;
  f.mimeTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf",
    "video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-matroska", "video/x-msvideo"];
  f.thumbs = ["200x200", "600x0"];
  app.save(rf);
  const reqs = app.findCollectionByNameOrId("requests");
  app.save(new Collection({
    type: "base", name: "req_shares",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "token", type: "text", required: true, max: 60 },
      { name: "requests", type: "relation", collectionId: reqs.id, maxSelect: 200 },
      { name: "title", type: "text", max: 300 },
      { name: "expires", type: "date" },
      { name: "views", type: "number" },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_reqsh_tok ON req_shares (token)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("req_shares")); } catch (_) {}
  const rf = app.findCollectionByNameOrId("request_files");
  rf.fields.removeByName("item"); app.save(rf);
});
