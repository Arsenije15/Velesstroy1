/// VELESSTROY — заявки на выдачу ТМЦ (добавляется к существующей базе, данные не трогает)
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const USERS = app.findCollectionByNameOrId("users").id;
  const ts = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  const req = new Collection({
    type: "base", name: "requests",
    listRule: AUTH, viewRule: AUTH,
    createRule: null, updateRule: null, deleteRule: null, // только через серверную логику
    fields: [
      { name: "number", type: "text", required: true, max: 100 },
      { name: "number_norm", type: "text", max: 100 },
      { name: "req_date", type: "date" },
      { name: "object", type: "text", max: 300 },
      { name: "recipient", type: "text", max: 300 },
      { name: "note", type: "text", max: 2000 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["open", "closed", "cancelled"] },
      { name: "created_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "closed_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "closed_at", type: "date" },
      { name: "close_comment", type: "text", max: 2000 },
      { name: "warehouse", type: "text", max: 100 },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_requests_num ON requests (number_norm)", "CREATE INDEX idx_requests_status ON requests (status)"],
  });
  app.save(req);
  app.save(new Collection({
    type: "base", name: "request_items",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "request", type: "relation", collectionId: req.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "sort", type: "number", onlyInt: true },
      { name: "material", type: "text", required: true, max: 500 },
      { name: "supplier", type: "text", max: 300 },
      { name: "unit", type: "text", max: 30 },
      { name: "qty_ordered", type: "number", min: 0 },
      { name: "qty_issued", type: "number", min: 0 },
      { name: "rd", type: "text", max: 100 },
      { name: "supply_doc", type: "text", max: 200 },
      { name: "issued_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "issued_at", type: "date" },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_reqitems_req ON request_items (request)"],
  }));
}, (app) => {
  ["request_items", "requests"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
