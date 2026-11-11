/// VELESSTROY 1.9.7 — конструктор полей: описания полей форм и значения своих полей (extra). Данные не трогает.
migrate((app) => {
  const IN = '@request.auth.id != "" && @request.auth.active = true';
  app.save(new Collection({
    type: "base", name: "form_fields",
    listRule: IN, viewRule: IN, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "form", type: "select", required: true, maxSelect: 1, values: ["request", "request_item", "act_row", "upd", "subtopic", "board"] },
      { name: "key", type: "text", required: true, max: 40 }, { name: "label", type: "text", max: 120 },
      { name: "type", type: "select", maxSelect: 1, values: ["text", "number", "date", "select", "bool", "photo"] },
      { name: "options", type: "json", maxSize: 20000 }, { name: "required", type: "bool" }, { name: "hidden", type: "bool" },
      { name: "builtin", type: "bool" }, { name: "sort", type: "number" }, { name: "hint", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_ff_form_key ON form_fields (form, key)"],
  }));
  ["requests", "request_items", "upd_docs", "subtopics", "site_board"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n);
    if (!c.fields.getByName("extra")) { c.fields.add(new JSONField({ name: "extra", maxSize: 200000 })); app.save(c); }
  });
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base", name: "field_files",
    listRule: IN + ' && @request.auth.role != "coord"', viewRule: IN + ' && @request.auth.role != "coord"', createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "form", type: "text", max: 20 }, { name: "rec", type: "text", max: 30 }, { name: "key", type: "text", max: 40 },
      { name: "file", type: "file", maxSelect: 1, maxSize: 20000000, protected: true, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"], thumbs: ["480x0"] },
      { name: "uploaded_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_ffile_rec ON field_files (rec, key)"],
  }));
}, (app) => {
  ["form_fields", "field_files"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
