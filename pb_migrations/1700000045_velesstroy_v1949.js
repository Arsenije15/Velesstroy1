/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.49 — флажок «🕰 Старый запас» (обход склада): при открытии заявки напоминание брать его в первую очередь
migrate((app) => {
  const c = app.findCollectionByNameOrId("smap_flags");
  if (!c.fields.getByName("old")) c.fields.add(new BoolField({ name: "old" }));
  app.save(c);
}, (app) => { const c = app.findCollectionByNameOrId("smap_flags"); c.fields.removeByName("old"); app.save(c); });
