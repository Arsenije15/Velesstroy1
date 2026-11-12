/// <reference path="../pb_data/types.d.ts" />
// 1.9.10: ссылка на страницу «Склад / СКК» для любого человека — только эта страница. Данные не трогает.
const NOSKK = ' && @request.auth.scope != "skk"';
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("scope")) users.fields.add(new TextField({ name: "scope", max: 20 }));
  app.save(users);
  app.save(new Collection({
    type: "base", name: "skk_links",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "token", type: "text", required: true, max: 64 }, { name: "user", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "label", type: "text", max: 200 }, { name: "mode", type: "select", maxSelect: 1, values: ["view", "work"] },
      { name: "active", type: "bool" }, { name: "views", type: "number" }, { name: "last_open", type: "text", max: 25 },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_skklink_token ON skk_links (token)"],
  }));
  // остальные разделы (и их обновления в реальном времени) человеку по ссылке не видны
  ["rules", "receipts", "approvals", "checklist_templates", "checklist_items", "attachments", "resources", "reservations", "activity_log", "requests", "request_items", "acts",
   "request_shipments", "request_files", "request_ocr", "request_notes", "request_archive", "share_links", "topics", "subtopics", "topic_msgs", "topic_links", "site_links", "site_board"].forEach((n) => {
    let c = null; try { c = app.findCollectionByNameOrId(n); } catch (_) { return; }
    ["listRule", "viewRule"].forEach((k) => { const r = c[k] == null ? "" : String(c[k]); if (r && r.indexOf(NOSKK) < 0) c[k] = "(" + r + ")" + NOSKK; });
    app.save(c);
  });
}, (app) => {
  app.findAllCollections().forEach((c) => { let ch = false; ["listRule", "viewRule"].forEach((k) => { const r = c[k] == null ? "" : String(c[k]); if (r && r.indexOf(NOSKK) > 0) { c[k] = r.slice(1, r.length - NOSKK.length - 1); ch = true; } }); if (ch) app.save(c); });
  try { app.delete(app.findCollectionByNameOrId("skk_links")); } catch (_) {}
  const u = app.findCollectionByNameOrId("users"); const f = u.fields.getByName("scope"); if (f) { u.fields.removeById(f.id); app.save(u); }
});
