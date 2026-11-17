/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.29 — пользователей можно убрать из списка: без истории — удаляются, с историей — отключаются и скрываются (история остаётся)
migrate((app) => {
  const u = app.findCollectionByNameOrId("users");
  if (!u.fields.getByName("hidden")) { u.fields.add(new BoolField({ name: "hidden" })); app.save(u); }
}, (app) => {
  const u = app.findCollectionByNameOrId("users");
  const f = u.fields.getByName("hidden"); if (f) { u.fields.removeById(f.id); app.save(u); }
});
