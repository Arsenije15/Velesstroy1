/// <reference path="../pb_data/types.d.ts" />
// 1.9.65: папки «Заявки» и «Поставки (УПД)» — файлы З-7137.pdf / П-83464.pdf; помощник читает по очереди → «Ждут подтверждения»
const VIEW = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = "" && @request.auth.role != "coord"';
const CREATE = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper") && uploaded_by = @request.auth.id';
migrate((app) => {
  app.save(new Collection({
    type: "base", name: "inbox_files", listRule: VIEW, viewRule: VIEW, createRule: CREATE, updateRule: null, deleteRule: null,
    fields: [
      { name: "kind", type: "select", values: ["zay", "upd"], maxSelect: 1, required: true },
      { name: "file", type: "file", maxSelect: 1, maxSize: 52428800, required: true, protected: true,
        mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "name", type: "text", max: 300 }, { name: "number", type: "text", max: 120 }, { name: "number_norm", type: "text", max: 120 },
      { name: "status", type: "select", values: ["new", "queued", "reading", "ready", "done", "error"], maxSelect: 1 },
      { name: "result", type: "json", maxSize: 3000000 }, { name: "error", type: "text", max: 1000 }, { name: "note", type: "text", max: 1000 },
      { name: "uploaded_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1, cascadeDelete: false },
      { name: "by_name", type: "text", max: 200 }, { name: "queued_by", type: "text", max: 200 },
      { name: "queued_at", type: "text", max: 40 }, { name: "read_at", type: "text", max: 40 }, { name: "done_at", type: "text", max: 40 },
      { name: "upd_doc", type: "text", max: 20 }, { name: "ref", type: "text", max: 20 }, { name: "ref_no", type: "text", max: 120 }, { name: "ms", type: "number" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_inbox_kind_st ON inbox_files (kind, status)", "CREATE INDEX idx_inbox_no ON inbox_files (number_norm)"],
  }));
}, (app) => { try { app.delete(app.findCollectionByNameOrId("inbox_files")); } catch (_) {} });
