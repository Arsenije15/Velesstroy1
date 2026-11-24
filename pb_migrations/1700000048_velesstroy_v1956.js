/// <reference path="../pb_data/types.d.ts" />
// 1.9.56: прочитанный при приёмке УПД хранится в самой приёмке (материалы, количество) — не в списке УПД СКК
migrate((app) => {
  const c = app.findCollectionByNameOrId("receipts");
  c.fields.add(new Field({ type: "json", name: "upd_items", maxSize: 2000000 }));
  c.fields.add(new Field({ type: "text", name: "upd_date", max: 20 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("receipts");
  ["upd_items", "upd_date"].forEach((n) => { const f = c.fields.getByName(n); if (f) c.fields.removeById(f.id); });
  app.save(c);
});
