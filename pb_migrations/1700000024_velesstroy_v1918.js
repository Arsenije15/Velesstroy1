/// <reference path="../pb_data/types.d.ts" />
// 1.9.18: АОСР → Общий журнал работ (Раздел 3 и Раздел 6)
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const AUTH = '@request.auth.id != "" && @request.auth.active = true && (@request.auth.scope = "" || @request.auth.scope = "skk")';
  const UP = AUTH + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "skk")';
  app.save(new Collection({
    type: "base", name: "aosr",
    listRule: AUTH, viewRule: AUTH,
    createRule: UP + ' && uploaded_by = @request.auth.id && status = "draft"', updateRule: null, deleteRule: null,
    fields: [
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "ok"] },
      { name: "kind", type: "text", max: 30 }, { name: "number", type: "text", max: 120 }, { name: "date", type: "text", max: 10 },
      { name: "work_full", type: "text", max: 6000 }, { name: "code", type: "text", max: 200 }, { name: "work_short", type: "text", max: 6000 },
      { name: "d_start", type: "text", max: 10 }, { name: "d_end", type: "text", max: 10 },
      { name: "reps", type: "json", maxSize: 20000 }, { name: "performer", type: "text", max: 600 },
      { name: "file", type: "file", maxSelect: 1, maxSize: 30 * 1024 * 1024, protected: true,
        mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "ocr", type: "json", maxSize: 200000 },
      { name: "uploaded_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "journal_at", type: "date" },
      { name: "search_lc", type: "text", max: 8000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_aosr_no ON aosr (number)", "CREATE INDEX idx_aosr_date ON aosr (date)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("aosr")); } catch (_) {}
});
