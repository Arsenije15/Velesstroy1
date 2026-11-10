/// VELESSTROY — схема базы данных (PocketBase). Выполняется автоматически при запуске.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const ROLE = (r) => AUTH + ' && (' + r.map((x) => '@request.auth.role = "' + x + '"').join(' || ') + ')';
  const ts = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  // ---------- Пользователи (роли) ----------
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "username", max: 50 }));
  users.fields.add(new SelectField({ name: "role", required: true, maxSelect: 1, values: ["admin", "manager", "storekeeper", "viewer"] }));
  users.fields.add(new BoolField({ name: "active" }));
  users.fields.add(new TextField({ name: "warehouse", max: 100 }));
  users.fields.add(new BoolField({ name: "demo" }));
  users.addIndex("idx_users_username", true, "username", "username != ''");
  users.passwordAuth.identityFields = ["email", "username"];
  users.authRule = "active = true";
  users.listRule = AUTH;
  users.viewRule = AUTH;
  users.createRule = ROLE(["admin"]);
  users.updateRule = ROLE(["admin"]);
  users.deleteRule = null;
  app.save(users);
  const USERS = users.id;

  const mk = (def) => { const c = new Collection(def); app.save(c); return c; };

  // ---------- База ограничений и инструкций ----------
  mk({
    type: "base", name: "rules",
    listRule: AUTH, viewRule: AUTH,
    createRule: ROLE(["admin", "manager"]),
    updateRule: ROLE(["admin", "manager"]),
    deleteRule: null, // правила не удаляются, а деактивируются — история сохраняется
    fields: [
      { name: "upd_number", type: "text", max: 100 },
      { name: "supplier", type: "text", max: 200 },
      { name: "sender", type: "text", max: 200 },
      { name: "description", type: "text", required: true, max: 2000 },
      { name: "reason", type: "text", max: 2000 },
      { name: "action", type: "select", required: true, maxSelect: 1, values: ["allow", "deny", "approval"] },
      { name: "approver_role", type: "select", maxSelect: 1, values: ["manager", "admin"] },
      { name: "valid_from", type: "date" },
      { name: "valid_to", type: "date" },
      { name: "active", type: "bool" },
      { name: "warehouse", type: "text", max: 100 },
      { name: "version", type: "number", onlyInt: true },
      { name: "created_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "updated_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "demo", type: "bool" },
      ...ts,
    ],
  });

  // ---------- Приёмки ----------
  const receipts = mk({
    type: "base", name: "receipts",
    listRule: AUTH, viewRule: AUTH,
    createRule: null, updateRule: null, deleteRule: null, // только через серверную логику
    fields: [
      { name: "upd_number", type: "text", required: true, max: 100 },
      { name: "upd_norm", type: "text", max: 100 },
      { name: "supplier", type: "text", max: 200 },
      { name: "sender", type: "text", max: 200 },
      { name: "vehicle", type: "text", max: 100 },
      { name: "check_result", type: "select", maxSelect: 1, values: ["green", "red", "yellow", "notfound"] },
      { name: "status", type: "select", required: true, maxSelect: 1,
        values: ["denied", "pending_approval", "rejected", "in_progress", "nonconformity", "completed", "completed_remarks"] },
      { name: "rule_ids", type: "json" },
      { name: "instruction", type: "text", max: 5000 },
      { name: "approver_role", type: "select", maxSelect: 1, values: ["manager", "admin"] },
      { name: "storekeeper", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "nc_flag", type: "bool" },
      { name: "nc_description", type: "text", max: 5000 },
      { name: "qty_doc", type: "text", max: 200 },
      { name: "qty_fact", type: "text", max: 200 },
      { name: "damage", type: "text", max: 2000 },
      { name: "notes", type: "text", max: 5000 },
      { name: "nc_decision", type: "text", max: 2000 },
      { name: "finished_at", type: "date" },
      { name: "warehouse", type: "text", max: 100 },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_receipts_upd ON receipts (upd_norm)", "CREATE INDEX idx_receipts_status ON receipts (status)"],
  });

  mk({
    type: "base", name: "approvals",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "receipt", type: "relation", collectionId: receipts.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "kind", type: "select", maxSelect: 1, values: ["approval", "notfound", "nonconformity"] },
      { name: "requested_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "request_comment", type: "text", max: 2000 },
      { name: "approver_role", type: "select", maxSelect: 1, values: ["manager", "admin"] },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "approved", "rejected"] },
      { name: "decided_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "decided_at", type: "date" },
      { name: "decision_comment", type: "text", max: 2000 },
      ...ts,
    ],
  });

  const tpl = mk({
    type: "base", name: "checklist_templates",
    listRule: AUTH, viewRule: AUTH,
    createRule: ROLE(["admin"]), updateRule: ROLE(["admin"]), deleteRule: null,
    fields: [
      { name: "title", type: "text", required: true, max: 500 },
      { name: "sort", type: "number", onlyInt: true },
      { name: "required", type: "bool" },
      { name: "active", type: "bool" },
      ...ts,
    ],
  });

  mk({
    type: "base", name: "checklist_items",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "receipt", type: "relation", collectionId: receipts.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "template", type: "relation", collectionId: tpl.id, maxSelect: 1 },
      { name: "title", type: "text", max: 500 },
      { name: "sort", type: "number", onlyInt: true },
      { name: "required", type: "bool" },
      { name: "done", type: "bool" },
      { name: "comment", type: "text", max: 2000 },
      { name: "done_at", type: "date" },
      { name: "done_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      ...ts,
    ],
  });

  mk({
    type: "base", name: "attachments",
    listRule: AUTH, viewRule: AUTH,
    // загрузить фото может кладовщик/руководитель/админ и только в незакрытую приёмку
    createRule: ROLE(["admin", "manager", "storekeeper"]) +
      ' && (receipt.status = "in_progress" || receipt.status = "nonconformity" || receipt.status = "pending_approval") && uploaded_by = @request.auth.id',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "receipt", type: "relation", collectionId: receipts.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "kind", type: "select", maxSelect: 1, values: ["document", "material", "damage"] },
      { name: "file", type: "file", maxSelect: 1, maxSize: 15728640, required: true, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"] },
      { name: "comment", type: "text", max: 1000 },
      { name: "uploaded_by", type: "relation", collectionId: USERS, maxSelect: 1, required: true },
      ...ts,
    ],
  });

  // ---------- Ресурсы склада ----------
  const resources = mk({
    type: "base", name: "resources",
    listRule: AUTH, viewRule: AUTH,
    createRule: ROLE(["admin", "manager"]),
    updateRule: ROLE(["admin", "manager"]),
    deleteRule: null,
    fields: [
      { name: "category", type: "select", required: true, maxSelect: 1, values: ["crane", "worker"] },
      { name: "name", type: "text", required: true, max: 200 },
      { name: "inv_number", type: "text", max: 100 },
      { name: "qty_total", type: "number", onlyInt: true, min: 0 },
      { name: "unit", type: "text", max: 20 },
      { name: "unavailable", type: "bool" },
      { name: "unavailable_reason", type: "text", max: 500 },
      { name: "archived", type: "bool" },
      { name: "warehouse", type: "text", max: 100 },
      { name: "demo", type: "bool" },
      ...ts,
    ],
  });

  mk({
    type: "base", name: "reservations",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "resource", type: "relation", collectionId: resources.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "qty", type: "number", onlyInt: true, min: 1 },
      { name: "site", type: "text", max: 300 },
      { name: "purpose", type: "text", max: 500 },
      { name: "start", type: "date", required: true },
      { name: "end", type: "date", required: true },
      { name: "responsible", type: "text", max: 200 },
      { name: "comment", type: "text", max: 1000 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["reserved", "in_work", "released", "cancelled"] },
      { name: "created_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "released_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "released_at", type: "date" },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_res_resource ON reservations (resource, status)"],
  });

  // ---------- Журнал действий (удалить нельзя никому, кроме суперпользователя сервера) ----------
  mk({
    type: "base", name: "activity_log",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "user_name", type: "text", max: 200 },
      { name: "action", type: "text", max: 100 },
      { name: "entity", type: "text", max: 50 },
      { name: "entity_id", type: "text", max: 50 },
      { name: "summary", type: "text", max: 2000 },
      { name: "details", type: "json" },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_log_created ON activity_log (created)"],
  });

  // Начальный чек-лист (5 пунктов, администратор может менять)
  const items = [
    "Проверить соответствие фактического груза данным УПД",
    "Проверить количество и комплектность материала",
    "Проверить состояние груза и отсутствие видимых повреждений",
    "Зафиксировать выявленные расхождения и замечания, если они имеются",
    "Завершить оформление приёмки и подтвердить получение материала",
  ];
  items.forEach((t, i) => {
    const r = new Record(tpl);
    r.set("title", t); r.set("sort", (i + 1) * 10); r.set("required", true); r.set("active", true);
    app.save(r);
  });
}, (app) => {
  ["activity_log", "reservations", "resources", "attachments", "checklist_items", "checklist_templates", "approvals", "receipts", "rules"]
    .forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
