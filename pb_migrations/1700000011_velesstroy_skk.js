/// VELESSTROY 1.8 — СКК (контроль качества): роль «skk», УПД со скана, акты СКК. Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const users = app.findCollectionByNameOrId("users");
  const rf = users.fields.getByName("role");
  if (rf.values.indexOf("skk") < 0) { rf.values = rf.values.concat(["skk"]); app.save(users); }
  const UP = AUTH + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper" || @request.auth.role = "skk")';
  const upd = new Collection({
    type: "base", name: "upd_docs",
    listRule: AUTH, viewRule: AUTH,
    // файл загружает сам пользователь (черновик), дальше — только через сервер
    createRule: UP + ' && uploaded_by = @request.auth.id && status = "draft"', updateRule: null, deleteRule: null,
    fields: [
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "new", "act", "ok"] },
      { name: "number", type: "text", max: 60 }, { name: "date", type: "text", max: 20 },
      { name: "supplier", type: "text", max: 300 }, { name: "supplier_key", type: "text", max: 300 },
      { name: "inn", type: "text", max: 12 }, { name: "kpp", type: "text", max: 9 },
      { name: "basis", type: "text", max: 500 }, { name: "spec", type: "text", max: 40 },
      { name: "total_nt", type: "number" }, { name: "total", type: "number" },
      { name: "items", type: "json", maxSize: 400000 },
      { name: "note", type: "text", max: 2000 },
      { name: "file", type: "file", maxSelect: 1, maxSize: 30 * 1024 * 1024, protected: true,
        mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "ocr", type: "json", maxSize: 400000 },
      { name: "uploaded_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "search_lc", type: "text", max: 3000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_upd_sup ON upd_docs (supplier_key)", "CREATE INDEX idx_upd_no ON upd_docs (number)"],
  });
  app.save(upd);
  app.save(new Collection({
    type: "base", name: "skk_acts",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "number", type: "text", required: true, max: 60 },
      { name: "date", type: "text", max: 20 },
      { name: "object", type: "text", max: 500 },
      { name: "rep_osk", type: "text", max: 300 }, { name: "rep_sklad", type: "text", max: 300 }, { name: "rep_omts", type: "text", max: 300 },
      { name: "upd_line", type: "text", max: 1000 },
      { name: "upds", type: "relation", collectionId: upd.id, maxSelect: 50 },
      { name: "supplier", type: "text", max: 300 }, { name: "supplier_key", type: "text", max: 300 },
      { name: "rows", type: "json", maxSize: 400000 },
      { name: "conclusion", type: "text", max: 3000 }, { name: "verdict", type: "text", max: 1000 },
      { name: "status", type: "select", maxSelect: 1, values: ["open", "closed"] },
      { name: "closed_at", type: "date" },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "search_lc", type: "text", max: 5000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_skk_no ON skk_acts (number)", "CREATE INDEX idx_skk_sup ON skk_acts (supplier_key)"],
  }));
}, (app) => {
  ["skk_acts", "upd_docs"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
    
