/// VELESSTROY 1.6 — сохранённые распределения поставщиков между учётчицами. Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const W = AUTH + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper")';
  const M = AUTH + ' && (@request.auth.role = "admin" || @request.auth.role = "manager")';
  const USERS = app.findCollectionByNameOrId("users").id;
  app.save(new Collection({
    type: "base", name: "supplier_splits",
    listRule: AUTH, viewRule: AUTH, createRule: W + " && created_by = @request.auth.id", updateRule: M, deleteRule: M,
    fields: [
      { name: "title", type: "text", required: true, max: 200 },
      { name: "people", type: "json", maxSize: 20000 },
      { name: "items", type: "json", maxSize: 2000000 },
      { name: "settings", type: "json", maxSize: 5000 },
      { name: "created_by", type: "relation", collectionId: USERS, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("supplier_splits")); } catch (_) {}
});
