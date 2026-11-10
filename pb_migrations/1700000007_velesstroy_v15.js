/// VELESSTROY 1.5 — поля печатной формы заявки, учёт (выдано фактически), заметки, архив заявок из Excel. Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const USERS = app.findCollectionByNameOrId("users").id;
  const ts = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];
  // ---------- Шапка печатной формы и учёт ----------
  const rq = app.findCollectionByNameOrId("requests");
  [["planned_date", 40], ["from_wh", 300], ["to_org", 300], ["contract_no", 100], ["contract_date", 60], ["poa_no", 100], ["poa_date", 60],
   ["tmc_kind", 60], ["uchet_status", 20]].forEach((f) => rq.fields.add(new TextField({ name: f[0], max: f[1] })));
  rq.fields.add(new RelationField({ name: "uchet_by", collectionId: USERS, maxSelect: 1 }));
  rq.fields.add(new DateField({ name: "uchet_at" }));
  rq.fields.add(new RelationField({ name: "uchet_done_by", collectionId: USERS, maxSelect: 1 }));
  rq.fields.add(new DateField({ name: "uchet_done_at" }));
  app.save(rq);
  const it = app.findCollectionByNameOrId("request_items");
  [["project_name", 1000], ["name1c", 1000], ["objcode", 300], ["stock_note", 500], ["fact_unit", 30], ["fact_qty", 40], ["issue_doc", 300]]
    .forEach((f) => it.fields.add(new TextField({ name: f[0], max: f[1] })));
  app.save(it);

  // ---------- Заметки по заявке ----------
  const reqId = rq.id;
  app.save(new Collection({
    type: "base", name: "request_notes",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "request", type: "relation", collectionId: reqId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "text", type: "text", required: true, max: 3000 },
      { name: "done", type: "bool" },
      { name: "done_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "done_at", type: "date" },
      { name: "created_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "author_name", type: "text", max: 200 },
      ...ts,
    ],
    indexes: ["CREATE INDEX idx_rnotes_req ON request_notes (request)"],
  }));

  // ---------- Архив заявок (из старого Excel) ----------
  app.save(new Collection({
    type: "base", name: "request_archive",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "row_key", type: "text", required: true, max: 120 },
      { name: "sheet", type: "text", max: 120 },
      { name: "line_no", type: "number" },
      { name: "opp_no", type: "text", max: 120 },
      { name: "omts_no", type: "text", max: 200 },
      { name: "nums", type: "text", max: 400 },
      { name: "applicant", type: "text", max: 300 },
      { name: "req_date", type: "text", max: 30 },
      { name: "recipient", type: "text", max: 300 },
      { name: "project_code", type: "text", max: 300 },
      { name: "material", type: "text", max: 1500 },
      { name: "proj_flag", type: "text", max: 60 },
      { name: "unit", type: "text", max: 30 },
      { name: "qty", type: "number" },
      { name: "transfer", type: "text", max: 1000 },
      { name: "note", type: "text", max: 2000 },
      { name: "search_lc", type: "text", max: 6000 },
      { name: "import_id", type: "text", max: 40 },
      ...ts,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_arch_row ON request_archive (row_key)", "CREATE INDEX idx_arch_imp ON request_archive (import_id)"],
  }));
}, (app) => {
  ["request_notes", "request_archive"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
