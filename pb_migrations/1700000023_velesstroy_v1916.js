/// <reference path="../pb_data/types.d.ts" />
// 1.9.16: откуда взяли материал и чем (позиция заявки); место выгрузки прихода (УПД)
migrate((app) => {
  const it = app.findCollectionByNameOrId("request_items");
  [["pick_place", 300], ["pick_tool", 300], ["pick_by_name", 200]].forEach(([n, m]) => { if (!it.fields.getByName(n)) it.fields.add(new TextField({ name: n, max: m })); });
  if (!it.fields.getByName("pick_at")) it.fields.add(new DateField({ name: "pick_at" }));
  app.save(it);
  const u = app.findCollectionByNameOrId("upd_docs");
  [["unload_place", 300], ["unload_by_name", 200]].forEach(([n, m]) => { if (!u.fields.getByName(n)) u.fields.add(new TextField({ name: n, max: m })); });
  if (!u.fields.getByName("unload_at")) u.fields.add(new DateField({ name: "unload_at" }));
  app.save(u);
}, (app) => {
  const it = app.findCollectionByNameOrId("request_items"); ["pick_place", "pick_tool", "pick_by_name", "pick_at"].forEach((n) => { const f = it.fields.getByName(n); if (f) it.fields.removeById(f.id); }); app.save(it);
  const u = app.findCollectionByNameOrId("upd_docs"); ["unload_place", "unload_by_name", "unload_at"].forEach((n) => { const f = u.fields.getByName(n); if (f) u.fields.removeById(f.id); }); app.save(u);
});
