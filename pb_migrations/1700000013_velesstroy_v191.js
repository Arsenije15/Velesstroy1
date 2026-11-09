/// VELESSTROY 1.9.1 — фото к приходу делятся на «фото УПД» и «фото груза». Данные не трогает.
migrate((app) => {
  const c = app.findCollectionByNameOrId("upd_photos");
  if (!c.fields.getByName("kind")) c.fields.add(new SelectField({ name: "kind", maxSelect: 1, values: ["upd", "cargo"] }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("upd_photos"); const f = c.fields.getByName("kind"); if (f) { c.fields.removeById(f.id); app.save(c); }
});
