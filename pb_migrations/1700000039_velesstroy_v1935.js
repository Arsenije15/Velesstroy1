/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.35 — карта склада: схема зон (+ спутниковый снимок) и флажки «где лежит материал»
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const S = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = ""';
  const W = S + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper")';
  app.save(new Collection({
    type: "base", name: "smap_cfg",
    listRule: S, viewRule: S, createRule: W, updateRule: W, deleteRule: null,
    fields: [
      { name: "zones", type: "json", maxSize: 400000 },
      { name: "bg", type: "file", maxSelect: 1, maxSize: 25 * 1024 * 1024, protected: true, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      { name: "bg_opacity", type: "number" },
      { name: "updated_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  }));
  app.save(new Collection({
    type: "base", name: "smap_flags",
    listRule: S, viewRule: S, createRule: W + " && created_by = @request.auth.id", updateRule: W + " && (@request.body.created_by:isset = false || created_by = @request.auth.id)", deleteRule: W,
    fields: [
      { name: "x", type: "number" }, { name: "y", type: "number" },
      { name: "zone", type: "text", max: 200 },
      { name: "material", type: "text", max: 500, required: true },
      { name: "qty", type: "text", max: 40 }, { name: "unit", type: "text", max: 30 },
      { name: "note", type: "text", max: 1000 },
      { name: "color", type: "text", max: 20 },
      { name: "photo", type: "file", maxSelect: 3, maxSize: 20 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "search_lc", type: "text", max: 2000 },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "updated_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_smap_flags_upd ON smap_flags (updated)"],
  }));
}, (app) => {
  ["smap_flags", "smap_cfg"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
