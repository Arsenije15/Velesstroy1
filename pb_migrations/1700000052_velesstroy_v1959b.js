/// <reference path="../pb_data/types.d.ts" />
// 1.9.59: на флажке — несколько УПД: у основного материала поле «УПД», у остальных — d в списке материалов
migrate((app) => {
  const c = app.findCollectionByNameOrId("smap_flags");
  if (!c.fields.getByName("upd")) { c.fields.add(new TextField({ name: "upd", max: 120 })); app.save(c); }
}, (app) => {
  const c = app.findCollectionByNameOrId("smap_flags"); const f = c.fields.getByName("upd"); if (f) { c.fields.removeById(f.id); app.save(c); }
});
