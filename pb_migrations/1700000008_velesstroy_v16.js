/// VELESSTROY 1.6 — архив из нескольких Excel (раздел, статус, выдано), ссылки для получателей отгрузки. Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const USERS = app.findCollectionByNameOrId("users").id;
  const ar = app.findCollectionByNameOrId("request_archive");
  [["section", 120], ["status", 300], ["issue_date", 30], ["source", 200]].forEach((f) => ar.fields.add(new TextField({ name: f[0], max: f[1] })));
  ar.fields.add(new NumberField({ name: "qty_issued" }));
  ar.indexes = (ar.indexes || []).concat(["CREATE INDEX idx_arch_sheet ON request_archive (sheet)"]);
  app.save(ar);
  // номера заявок из 2 цифр тоже ищутся точно (раньше — от 3 цифр)
  app.findRecordsByFilter("request_archive", "omts_no != '' || opp_no != ''", "", 0, 0).forEach((r) => {
    const n = (r.getString("omts_no").match(/\d{2,}/g) || []).concat((r.getString("opp_no").match(/\d{2,}/) || []).slice(0, 1));
    const v = n.length ? "|" + n.join("|") + "|" : "";
    if (v !== r.getString("nums")) { r.set("nums", v); app.saveNoValidate(r); }
  });
  // ---------- Ссылки для получателей: видят только одну отгрузку, ссылка истекает ----------
  const sh = app.findCollectionByNameOrId("request_shipments");
  app.save(new Collection({
    type: "base", name: "share_links",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "token", type: "text", required: true, max: 64 },
      { name: "shipment", type: "relation", collectionId: sh.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "expires_at", type: "date", required: true },
      { name: "revoked", type: "bool" },
      { name: "note", type: "text", max: 300 },
      { name: "views", type: "number" },
      { name: "last_view", type: "date" },
      { name: "created_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_share_token ON share_links (token)", "CREATE INDEX idx_share_ship ON share_links (shipment)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("share_links")); } catch (_) {}
});
