/// VELESSTROY 1.9.2 — участник согласований видит в теме «Новый приход» (УПД без черновиков и их фото), только чтение. Данные не трогает.
const A = '(@request.auth.id != "" && @request.auth.active = true)';
migrate((app) => {
  const d = app.findCollectionByNameOrId("upd_docs"); d.listRule = d.viewRule = A + ' && (@request.auth.role != "coord" || status != "draft")'; app.save(d);
  const p = app.findCollectionByNameOrId("upd_photos"); p.listRule = p.viewRule = A + ' && (@request.auth.role != "coord" || upd.status != "draft")'; app.save(p);
}, (app) => {
  ["upd_docs", "upd_photos"].forEach((n) => { const c = app.findCollectionByNameOrId(n); c.listRule = c.viewRule = "(" + A + ') && @request.auth.role != "coord"'; app.save(c); });
});
