/// <reference path="../pb_data/types.d.ts" />
// 1.9.62: пропуск по нескольким заявкам (requests, request_nos, resp); ссылка «ОМТС — согласование заявок»
migrate((app) => {
  const p = app.findCollectionByNameOrId("passes");
  if (!p.fields.getByName("requests")) p.fields.add(new JSONField({ name: "requests", maxSize: 20000 }));
  if (!p.fields.getByName("request_nos")) p.fields.add(new TextField({ name: "request_nos", max: 500 }));
  if (!p.fields.getByName("resp")) p.fields.add(new TextField({ name: "resp", max: 200 }));
  app.save(p);
  const k = app.findCollectionByNameOrId("skk_links"); const f = k.fields.getByName("scope");
  if (f && f.values.indexOf("omts") < 0) { f.values = f.values.concat(["omts"]); app.save(k); }
}, (app) => {
  const p = app.findCollectionByNameOrId("passes");
  ["requests", "request_nos", "resp"].forEach((n) => { const f = p.fields.getByName(n); if (f) p.fields.removeById(f.id); }); app.save(p);
});
