/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.30 — фото к выдачам из «Невыданного по заявкам»
migrate((app) => {
  const lf = app.findCollectionByNameOrId("leftovers"), users = app.findCollectionByNameOrId("users");
  const R = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = ""';
  app.save(new Collection({
    type: "base", name: "leftover_photos",
    listRule: R, viewRule: R,
    createRule: R + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper") && created_by = @request.auth.id',
    updateRule: null,
    deleteRule: R + ' && (@request.auth.role = "admin" || created_by = @request.auth.id)',
    fields: [
      { name: "leftover", type: "relation", collectionId: lf.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "log_at", type: "text", max: 40 },
      { name: "file", type: "file", maxSelect: 1, maxSize: 20 * 1024 * 1024, protected: true, required: true, thumbs: ["240x240"],
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_lfph_lf ON leftover_photos (leftover)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("leftover_photos")); } catch (_) {}
});
