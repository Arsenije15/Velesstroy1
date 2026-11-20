/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.44 — «Заметки» хранятся и на сервере (по пользователю): видны в программе, в браузере и в утреннем обходе
migrate((app) => {
  app.save(new Collection({
    type: "base", name: "zametki",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "text", max: 30, required: true },
      { name: "items", type: "json", maxSize: 3000000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_zametki_user ON zametki (user)"],
  }));
}, (app) => { try { app.delete(app.findCollectionByNameOrId("zametki")); } catch (_) {} });
