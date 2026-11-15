/// <reference path="../pb_data/types.d.ts" />
// 1.9.24: обход склада; сертификаты / паспорта качества к УПД; реквизиты компании для претензий
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const upd = app.findCollectionByNameOrId("upd_docs");
  const S = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = ""';
  app.save(new Collection({
    type: "base", name: "walk_entries",
    listRule: S, viewRule: S,
    createRule: S + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper") && created_by = @request.auth.id',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "walk_date", type: "text", max: 10 },
      { name: "place", type: "text", max: 200 }, { name: "material", type: "text", max: 500 },
      { name: "qty", type: "text", max: 40 }, { name: "unit", type: "text", max: 30 }, { name: "note", type: "text", max: 1000 },
      { name: "photo", type: "file", maxSelect: 1, maxSize: 20 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "search_lc", type: "text", max: 2000 },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_walk_date ON walk_entries (walk_date)"],
  }));
  const UR = upd.listRule == null ? "" : String(upd.listRule);
  app.save(new Collection({
    type: "base", name: "upd_certs",
    listRule: UR, viewRule: UR,
    createRule: '@request.auth.id != "" && @request.auth.active = true && (@request.auth.scope = "" || @request.auth.scope = "skk" || @request.auth.scope = "sklad") && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper" || @request.auth.role = "skk") && uploaded_by = @request.auth.id && status = "reading"',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "upd", type: "relation", collectionId: upd.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "file", type: "file", maxSelect: 1, maxSize: 30 * 1024 * 1024, protected: true, required: true,
        mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "status", type: "select", maxSelect: 1, values: ["reading", "done", "error"] },
      { name: "kind", type: "text", max: 80 }, { name: "number", type: "text", max: 120 }, { name: "date", type: "text", max: 10 },
      { name: "valid_to", type: "text", max: 10 }, { name: "batch", type: "text", max: 120 },
      { name: "text", type: "text", max: 30000 },
      { name: "uploaded_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_cert_upd ON upd_certs (upd)"],
  }));
  const A = '@request.auth.id != "" && @request.auth.active = true';
  app.save(new Collection({
    type: "base", name: "org_settings",
    listRule: A, viewRule: A, createRule: null, updateRule: null, deleteRule: null,
    fields: [ { name: "key", type: "text", max: 40 }, { name: "data", type: "json", maxSize: 20000 } ],
    indexes: ["CREATE UNIQUE INDEX idx_org_key ON org_settings (key)"],
  }));
}, (app) => {
  ["walk_entries", "upd_certs", "org_settings"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
