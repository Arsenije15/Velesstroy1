/// <reference path="../pb_data/types.d.ts" />
// 1.9.61: материальные пропуска сохраняются (черновик → «Подтвердить»), команда «пропуск 7015»
const FULL = '@request.auth.id != "" && @request.auth.scope = "" && @request.auth.role != "coord"';
migrate((app) => {
  app.save(new Collection({
    type: "base", name: "passes", listRule: FULL, viewRule: FULL, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "title", type: "text", max: 300 }, { name: "org", type: "text", max: 200 }, { name: "no", type: "text", max: 120 },
      { name: "request", type: "relation", collectionId: app.findCollectionByNameOrId("requests").id, maxSelect: 1, cascadeDelete: false },
      { name: "request_no", type: "text", max: 120 }, { name: "date", type: "text", max: 10 }, { name: "vehicle", type: "text", max: 200 },
      { name: "rows", type: "json", maxSize: 200000 }, { name: "head", type: "text", max: 300 }, { name: "mol", type: "text", max: 300 },
      { name: "status", type: "select", values: ["draft", "confirmed"], maxSelect: 1 },
      { name: "by_name", type: "text", max: 200 }, { name: "created_by", type: "text", max: 20 },
      { name: "confirmed_by_name", type: "text", max: 200 }, { name: "confirmed_at", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_pass_req ON passes (request)", "CREATE INDEX idx_pass_status ON passes (status)"],
  }));
}, (app) => { try { app.delete(app.findCollectionByNameOrId("passes")); } catch (_) {} });
