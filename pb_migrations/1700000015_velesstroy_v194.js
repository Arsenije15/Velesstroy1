/// VELESSTROY 1.9.4 — личные ссылки участникам «Задач и согласований» (отдельная страница без входа), поиск по всем позициям большого УПД. Данные не трогает.
migrate((app) => {
  const BOSS = '@request.auth.id != "" && @request.auth.active = true && (@request.auth.role = "admin" || @request.auth.role = "manager")';
  const u = app.findCollectionByNameOrId("upd_docs"); const f = u.fields.getByName("search_lc"); f.max = 20000; app.save(u);
  const users = app.findCollectionByNameOrId("users"), topics = app.findCollectionByNameOrId("topics");
  app.save(new Collection({
    type: "base", name: "topic_links",
    listRule: BOSS, viewRule: BOSS, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "token", type: "text", required: true, max: 64 },
      { name: "topic", type: "relation", collectionId: topics.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "revoked", type: "bool" },
      { name: "views", type: "number" },
      { name: "last_view", type: "date" },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_tlink_token ON topic_links (token)", "CREATE INDEX idx_tlink_topic ON topic_links (topic)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("topic_links")); } catch (_) {}
  const u = app.findCollectionByNameOrId("upd_docs"); const f = u.fields.getByName("search_lc"); f.max = 3000; app.save(u);
});
