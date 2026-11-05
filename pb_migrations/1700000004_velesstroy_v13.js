/// VELESSTROY 1.3 — обход запретов с объяснением, сборные отгрузки с этапами, память ручного ввода. Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const X = require(`${__hooks}/lib_ext.js`);

  // ---------- Подсказки: всё, что вводят вручную ----------
  app.save(new Collection({
    type: "base", name: "suggestions",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "field", type: "text", required: true, max: 60 },
      { name: "value", type: "text", required: true, max: 500 },
      { name: "key", type: "text", required: true, max: 600 },
      { name: "uses", type: "number", min: 0 },
      { name: "last", type: "date" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_sug_key ON suggestions (key)", "CREATE INDEX idx_sug_field ON suggestions (field)"],
  }));

  // ---------- Отгрузки: несколько заявок, позиции, этапы ----------
  const reqId = app.findCollectionByNameOrId("requests").id;
  const sh = app.findCollectionByNameOrId("request_shipments");
  sh.fields.add(new RelationField({ name: "requests", collectionId: reqId, maxSelect: 999, cascadeDelete: false }));
  sh.fields.add(new JSONField({ name: "lines" }));
  sh.fields.add(new JSONField({ name: "steps" }));
  sh.fields.add(new BoolField({ name: "issue_done" }));
  sh.fields.add(new JSONField({ name: "overrides" }));
  app.save(sh);
  app.findRecordsByFilter("request_shipments", "", "", 0, 0).forEach((s) => {
    s.set("requests", [s.getString("request")]); s.set("lines", []); s.set("steps", []); app.saveNoValidate(s);
  });

  // ---------- Обходы запретов: где были ----------
  ["requests", "receipts", "reservations"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n); c.fields.add(new JSONField({ name: "overrides" })); app.save(c);
  });
  const it = app.findCollectionByNameOrId("request_items");
  it.fields.add(new JSONField({ name: "acts" })); app.save(it);

  // ---------- Подсказки из уже введённых данных ----------
  Object.keys(X.REMEMBER).forEach((n) => {
    app.findRecordsByFilter(n, "", "created", 0, 0).forEach((r) => X.rememberRecord(app, r));
  });
  app.findRecordsByFilter("requests", "", "created", 0, 0).forEach((r) => {
    let sig = {};
    try { sig = JSON.parse(r.getString("signatures") || "{}") || {}; } catch (_) {}
    Object.keys(sig).forEach((k) => { if (sig[k] && sig[k].who) X.remember(app, "sign_" + k, sig[k].who); });
  });
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("suggestions")); } catch (_) {}
});
      
