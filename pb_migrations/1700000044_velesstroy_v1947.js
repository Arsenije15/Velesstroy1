/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.47 — карта склада: рабочее поле шире снимка (поля вокруг: слева/справа/сверху/снизу)
migrate((app) => {
  const c = app.findCollectionByNameOrId("smap_cfg");
  if (!c.fields.getByName("ext")) c.fields.add(new JSONField({ name: "ext", maxSize: 2000 }));
  app.save(c);
}, (app) => { const c = app.findCollectionByNameOrId("smap_cfg"); c.fields.removeByName("ext"); app.save(c); });
