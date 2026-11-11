/// VELESSTROY 1.9.8 — работа без интернета (заявки, отгрузка, фото груза): метка «из очереди телефона», чтобы повторная отправка не создала дубль.
migrate((app) => {
  ["request_shipments", "request_files"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n);
    if (!c.fields.getByName("client_id")) c.fields.add(new TextField({ name: "client_id", max: 40 }));
    c.addIndex("idx_" + n + "_client", true, "client_id", "client_id != ''");
    app.save(c);
  });
}, (app) => {
  ["request_shipments", "request_files"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n); c.removeIndex("idx_" + n + "_client");
    const f = c.fields.getByName("client_id"); if (f) c.fields.removeById(f.id); app.save(c);
  });
});
