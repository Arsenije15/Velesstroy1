/// VELESSTROY 1.4 — сканы заявок для распознавания (PDF / фото). Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const USERS = app.findCollectionByNameOrId("users").id;
  app.save(new Collection({
    type: "base", name: "request_ocr",
    listRule: AUTH + " && uploaded_by = @request.auth.id", viewRule: AUTH + " && uploaded_by = @request.auth.id",
    createRule: AUTH + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper") && uploaded_by = @request.auth.id',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "file", type: "file", maxSelect: 1, maxSize: 26214400, required: true, protected: true,
        mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "uploaded_by", type: "relation", collectionId: USERS, maxSelect: 1, required: true },
      { name: "result", type: "json" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("request_ocr")); } catch (_) {}
});
