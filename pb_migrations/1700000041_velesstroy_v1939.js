/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.39 — карта склада: значки объектов (КПП, ангар, кран, погрузчик, контейнер, офис) вместо флажка
migrate((app) => {
  const c = app.findCollectionByNameOrId("smap_flags");
  if (!c.fields.getByName("icon")) { c.fields.add(new TextField({ name: "icon", max: 20 })); app.save(c); }
}, (app) => {
  const c = app.findCollectionByNameOrId("smap_flags"); const f = c.fields.getByName("icon"); if (f) { c.fields.removeById(f.id); app.save(c); }
});
