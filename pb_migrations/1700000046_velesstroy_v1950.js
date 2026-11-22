/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.50 — на одном флажке несколько разных материалов (items: [{m, q, u}])
migrate((app) => {
  const c = app.findCollectionByNameOrId("smap_flags");
  if (!c.fields.getByName("items")) c.fields.add(new JSONField({ name: "items", maxSize: 60000 }));
  const sl = c.fields.getByName("search_lc"); if (sl) sl.max = 8000;   // поиск по всем материалам флажка
  app.save(c);
}, (app) => { const c = app.findCollectionByNameOrId("smap_flags"); c.fields.removeByName("items"); app.save(c); });
