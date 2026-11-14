/// <reference path="../pb_data/types.d.ts" />
// 1.9.21: сообщения / цитаты от администратора всем (через 🔔); библиотека цитат администратора
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base", name: "broadcasts",
    listRule: '@request.auth.id != ""', viewRule: '@request.auth.id != ""', createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "text", type: "text", required: true, max: 2000 },
      { name: "author", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "author_name", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_bc_created ON broadcasts (created)"],
  }));
  const ADM = '@request.auth.id != "" && @request.auth.role = "admin" && @request.auth.scope = ""';
  app.save(new Collection({
    type: "base", name: "bc_quotes",
    listRule: ADM, viewRule: ADM, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "text", type: "text", required: true, max: 2000 },
      { name: "sent_count", type: "number" },
      { name: "last_sent", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
  }));
  // телефон получателя и срок «забрать до» по заявке; справочник телефонов получателей
  const rq = app.findCollectionByNameOrId("requests");
  rq.fields.add(new TextField({ name: "phone", max: 40 }));
  rq.fields.add(new TextField({ name: "pickup_until", max: 10 }));
  app.save(rq);
  app.save(new Collection({
    type: "base", name: "contacts",
    listRule: '@request.auth.id != "" && @request.auth.scope = ""', viewRule: '@request.auth.id != "" && @request.auth.scope = ""', createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "name", type: "text", required: true, max: 200 }, { name: "name_lc", type: "text", max: 200 },
      { name: "phone", type: "text", max: 40 },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_contacts_lc ON contacts (name_lc)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("contacts")); } catch (_) {}
  try { const rq = app.findCollectionByNameOrId("requests"); rq.fields.removeByName("phone"); rq.fields.removeByName("pickup_until"); app.save(rq); } catch (_) {}
  ["broadcasts", "bc_quotes"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
