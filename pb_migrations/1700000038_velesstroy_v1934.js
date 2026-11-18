/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.34 — «Монтаж»: непроектный материал (можно заказывать); проектный (арматура, материал, СИЗ) — только по заявкам со склада Велесстроя
migrate((app) => {
  const it = app.findCollectionByNameOrId("mz_items");
  if (!it.fields.getByName("nonproj")) { it.fields.add(new BoolField({ name: "nonproj" })); app.save(it); }
}, (app) => {
  const it = app.findCollectionByNameOrId("mz_items"); const f = it.fields.getByName("nonproj"); if (f) { it.fields.removeById(f.id); app.save(it); }
});
