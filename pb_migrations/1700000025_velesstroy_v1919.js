/// <reference path="../pb_data/types.d.ts" />
// 1.9.19: фото брака к акту СКК; реестр заявок (файл склада)
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const sa = app.findCollectionByNameOrId("skk_acts");
  const R = sa.listRule == null ? "" : String(sa.listRule);
  app.save(new Collection({
    type: "base", name: "skk_photos",
    listRule: R, viewRule: R,
    createRule: '@request.auth.id != "" && @request.auth.active = true && (@request.auth.role = "admin" || @request.auth.role = "skk") && created_by = @request.auth.id && (@request.auth.scope = "" || @request.auth.scope = "skk")',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "act", type: "relation", collectionId: sa.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "file", type: "file", maxSelect: 1, maxSize: 20 * 1024 * 1024, protected: true, required: true, thumbs: ["240x240"],
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] },
      { name: "note", type: "text", max: 300 },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_skkph_act ON skk_photos (act)"],
  }));
  const AUTH = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper" || @request.auth.role = "viewer")';
  app.save(new Collection({
    type: "base", name: "zreg",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "number", type: "text", max: 60 }, { name: "number_n", type: "text", max: 60 },
      { name: "object", type: "text", max: 300 }, { name: "descr", type: "text", max: 1000 }, { name: "lines", type: "text", max: 20 },
      { name: "dept", type: "text", max: 300 }, { name: "applicant", type: "text", max: 200 }, { name: "date_in", type: "text", max: 10 },
      { name: "keeper", type: "text", max: 200 }, { name: "date_out", type: "text", max: 10 }, { name: "receiver", type: "text", max: 200 },
      { name: "doc1c", type: "text", max: 200 }, { name: "accountant", type: "text", max: 200 }, { name: "status", type: "text", max: 100 },
      { name: "comment", type: "text", max: 2000 }, { name: "row_no", type: "number" },
      { name: "search_lc", type: "text", max: 4000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_zreg_n ON zreg (number_n)"],
  }));
}, (app) => {
  ["skk_photos", "zreg"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
