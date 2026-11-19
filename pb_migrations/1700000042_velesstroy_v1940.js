/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.40 — карта склада: до 20 фото у флажка
migrate((app) => { const c = app.findCollectionByNameOrId("smap_flags"); const f = c.fields.getByName("photo"); f.maxSelect = 20; app.save(c); },
  (app) => { const c = app.findCollectionByNameOrId("smap_flags"); const f = c.fields.getByName("photo"); f.maxSelect = 3; app.save(c); });
