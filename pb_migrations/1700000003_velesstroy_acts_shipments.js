/// VELESSTROY 1.2 — акты несоответствия, отгрузки по заявкам, подписи, фото. Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const USERS = app.findCollectionByNameOrId("users").id;
  const ts = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const req = app.findCollectionByNameOrId("requests");

  // ---------- Журнал актов несоответствия (загружается из Excel) ----------
  app.save(new Collection({
    type: "base", name: "acts",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "row_key", type: "text", required: true, max: 120 },
      { name: "act_no", type: "text", max: 60 },
      { name: "act_date", type: "text", max: 30 },
      { name: "supplier", type: "text", max: 300 },
      { name: "supplier_key", type: "text", max: 300 },
      { name: "torg", type: "text", max: 500 },
      { name: "upd_keys", type: "text", max: 1000 },
      { name: "project", type: "text", max: 500 },
      { name: "material", type: "text", max: 1000 },
      { name: "unit", type: "text", max: 30 },
      { name: "qty", type: "text", max: 40 },
      { name: "reason", type: "text", max: 3000 },
      { name: "act_code", type: "text", max: 20 },
      { name: "author", type: "text", max: 200 },
      { name: "doc_status", type: "text", max: 100 },
      { name: "open", type: "bool" },
      { name: "act_status", type: "text", max: 100 },
      { name: "closed_date", type: "text", max: 30 },
      { name: "note", type: "text", max: 3000 },
      { name: "place", type: "text", max: 100 },
      { name: "import_id", type: "text", max: 40 },
      ...ts,
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_acts_row ON acts (row_key)",
      "CREATE INDEX idx_acts_sup ON acts (supplier_key)",
      "CREATE INDEX idx_acts_imp ON acts (import_id)",
    ],
  }));

  // ---------- Отгрузки по заявкам ----------
  app.save(new Collection({
    type: "base", name: "request_shipments",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "request", type: "relation", collectionId: req.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["preparing", "sent", "delivered", "cancelled"] },
      { name: "vehicle", type: "text", max: 200 },
      { name: "driver", type: "text", max: 200 },
      { name: "resource_ids", type: "json" },
      { name: "reservation_ids", type: "json" },
      { name: "hours", type: "number", min: 0 },
      { name: "note", type: "text", max: 2000 },
      { name: "created_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "sent_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "sent_at", type: "date" },
      { name: "delivered_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "delivered_at", type: "date" },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_ship_req ON request_shipments (request)", "CREATE INDEX idx_ship_status ON request_shipments (status)"],
  }));

  // ---------- Фото по заявкам ----------
  const ships = app.findCollectionByNameOrId("request_shipments");
  app.save(new Collection({
    type: "base", name: "request_files",
    listRule: AUTH, viewRule: AUTH,
    createRule: AUTH + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper")' +
      ' && request.status != "cancelled" && uploaded_by = @request.auth.id',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "request", type: "relation", collectionId: req.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "shipment", type: "relation", collectionId: ships.id, maxSelect: 1 },
      { name: "kind", type: "select", maxSelect: 1, values: ["shipment", "close", "signed", "other"] },
      { name: "file", type: "file", maxSelect: 1, maxSize: 15728640, required: true, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"] },
      { name: "comment", type: "text", max: 1000 },
      { name: "uploaded_by", type: "relation", collectionId: USERS, maxSelect: 1, required: true },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_rfiles_req ON request_files (request)"],
  }));

  // ---------- Новые поля: подписи заявки, служебка по приёмке ----------
  req.fields.add(new JSONField({ name: "signatures" }));
  req.fields.add(new BoolField({ name: "signed_all" }));
  app.save(req);
  const rc = app.findCollectionByNameOrId("receipts");
  rc.fields.add(new JSONField({ name: "acts_found" }));
  rc.fields.add(new BoolField({ name: "memo_required" }));
  rc.fields.add(new RelationField({ name: "memo_done_by", collectionId: USERS, maxSelect: 1 }));
  rc.fields.add(new DateField({ name: "memo_done_at" }));
  rc.fields.add(new TextField({ name: "memo_comment", max: 1000 }));
  app.save(rc);

  // ---------- Поле поиска в нижнем регистре (SQLite не умеет без учёта регистра для кириллицы) ----------
  const X = require(`${__hooks}/lib_ext.js`);
  ["requests", "request_items", "acts", "receipts", "activity_log"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n);
    c.fields.add(new TextField({ name: "search_lc", max: 6000 }));
    app.save(c);
    app.findRecordsByFilter(n, "", "", 0, 0).forEach((r) => { r.set("search_lc", X.searchText(n, r)); app.saveNoValidate(r); });
  });
}, (app) => {
  ["request_files", "request_shipments", "acts"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
