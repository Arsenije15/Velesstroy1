/// <reference path="../pb_data/types.d.ts" />
// 1.9.9: акт СКК — строка «Приложение» (как на бланке: «Согласно приложению.» / «фото 001; чертёж …»)
migrate((app) => {
  const c = app.findCollectionByNameOrId("skk_acts");
  if (!c.fields.getByName("appendix")) c.fields.add(new TextField({ name: "appendix", max: 2000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("skk_acts");
  const f = c.fields.getByName("appendix"); if (f) { c.fields.removeById(f.id); app.save(c); }
});
