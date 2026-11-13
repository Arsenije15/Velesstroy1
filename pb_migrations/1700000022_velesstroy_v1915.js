/// <reference path="../pb_data/types.d.ts" />
// 1.9.15: ссылка «Склад: заявки» (scope zay — свои заявки, ресурсы склада, поиск), напоминания в заметках, невыданный остаток по заявкам
const NEW = ' && @request.auth.scope = ""';
const ZAY = {   // что видит человек по ссылке «Склад: заявки»
  requests: '(@request.auth.scope = "" || (@request.auth.scope = "zay" && created_by = @request.auth.id))',
  request_items: '(@request.auth.scope = "" || (@request.auth.scope = "zay" && request.created_by = @request.auth.id))',
  request_files: '(@request.auth.scope = "" || (@request.auth.scope = "zay" && request.created_by = @request.auth.id))',
  request_notes: '(@request.auth.scope = "" || (@request.auth.scope = "zay" && request.created_by = @request.auth.id))',
  request_shipments: '(@request.auth.scope = "" || (@request.auth.scope = "zay" && request.created_by = @request.auth.id))',
  resources: '(@request.auth.scope = "" || @request.auth.scope = "zay")',
  reservations: '(@request.auth.scope = "" || @request.auth.scope = "zay")',
};
migrate((app) => {
  const k = app.findCollectionByNameOrId("skk_links");
  const f = k.fields.getByName("scope"); f.values = ["skk", "sklad", "zay"]; app.save(k);
  const n = app.findCollectionByNameOrId("request_notes");
  if (!n.fields.getByName("remind_at")) n.fields.add(new DateField({ name: "remind_at" }));
  app.save(n);
  Object.keys(ZAY).forEach((name) => {
    let c = null; try { c = app.findCollectionByNameOrId(name); } catch (_) { return; }
    ["listRule", "viewRule"].forEach((fl) => {
      const r = c[fl] == null ? "" : String(c[fl]);
      if (r && r.endsWith(NEW)) c[fl] = r.slice(0, r.length - NEW.length) + " && " + ZAY[name];
    });
    app.save(c);
  });
  const users = app.findCollectionByNameOrId("users"), reqs = app.findCollectionByNameOrId("requests"), items = app.findCollectionByNameOrId("request_items");
  app.save(new Collection({
    type: "base", name: "leftovers",
    listRule: '@request.auth.id != "" && @request.auth.scope = ""', viewRule: '@request.auth.id != "" && @request.auth.scope = ""', createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "request", type: "relation", collectionId: reqs.id, maxSelect: 1 }, { name: "item", type: "relation", collectionId: items.id, maxSelect: 1 },
      { name: "number", type: "text", max: 100 }, { name: "object", type: "text", max: 300 }, { name: "recipient", type: "text", max: 300 },
      { name: "material", type: "text", max: 1000 }, { name: "unit", type: "text", max: 30 }, { name: "qty", type: "number" }, { name: "issued", type: "number" },
      { name: "status", type: "select", maxSelect: 1, values: ["open", "done"] }, { name: "log", type: "json", maxSize: 200000 }, { name: "note", type: "text", max: 1000 },
      { name: "search_lc", type: "text", max: 3000 }, { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_left_status ON leftovers (status)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("leftovers")); } catch (_) {}
  Object.keys(ZAY).forEach((name) => {
    let c = null; try { c = app.findCollectionByNameOrId(name); } catch (_) { return; }
    ["listRule", "viewRule"].forEach((fl) => { const r = c[fl] == null ? "" : String(c[fl]); const t = " && " + ZAY[name]; if (r.endsWith(t)) c[fl] = r.slice(0, r.length - t.length) + NEW; });
    app.save(c);
  });
});
