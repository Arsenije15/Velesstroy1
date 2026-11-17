/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.31 — план погрузки: где лежит материал, чем грузить, на какую машину; память по материалу
migrate((app) => {
  const sh = app.findCollectionByNameOrId("request_shipments");
  if (!sh.fields.getByName("cars")) { sh.fields.add(new JSONField({ name: "cars", maxSize: 20000 })); app.save(sh); }
  const R = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = ""';
  app.save(new Collection({
    type: "base", name: "load_memory",
    listRule: R, viewRule: R, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "key", type: "text", max: 600, required: true }, { name: "material", type: "text", max: 1000 },
      { name: "place", type: "text", max: 200 }, { name: "load", type: "text", max: 100 }, { name: "weight", type: "text", max: 60 },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_lmem_key ON load_memory (key)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("load_memory")); } catch (_) {}
  const sh = app.findCollectionByNameOrId("request_shipments"); const f = sh.fields.getByName("cars"); if (f) { sh.fields.removeById(f.id); app.save(sh); }
});
