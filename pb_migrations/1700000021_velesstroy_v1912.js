/// <reference path="../pb_data/types.d.ts" />
// 1.9.12: вторая ссылка — «Склад» (новый приход, оперативка, МПЗ, журнал актов). Каждая ссылка видит только свои страницы.
const OLD = ' && @request.auth.scope != "skk"', NEW = ' && @request.auth.scope = ""';
migrate((app) => {
  const k = app.findCollectionByNameOrId("skk_links");
  if (!k.fields.getByName("scope")) k.fields.add(new SelectField({ name: "scope", maxSelect: 1, values: ["skk", "sklad"] }));
  app.save(k);
  app.findAllCollections().forEach((c) => {
    let ch = false;
    ["listRule", "viewRule"].forEach((f) => {
      const r = c[f] == null ? "" : String(c[f]);
      if (r && r.endsWith(OLD)) { c[f] = c.name === "acts" ? r.slice(1, r.length - OLD.length - 1) : r.slice(0, r.length - OLD.length) + NEW; ch = true; }
    });
    if (ch) app.save(c);
  });
  // журнал актов (acts) — виден обеим ссылкам; акты СКК — не видны «Складу»
  const sa = app.findCollectionByNameOrId("skk_acts");
  ["listRule", "viewRule"].forEach((f) => { const r = sa[f] == null ? "" : String(sa[f]); if (r && r.indexOf("sklad") < 0) sa[f] = "(" + r + ') && @request.auth.scope != "sklad"'; });
  app.save(sa);
}, (app) => {
  app.findAllCollections().forEach((c) => {
    let ch = false;
    ["listRule", "viewRule"].forEach((f) => { const r = c[f] == null ? "" : String(c[f]); if (r && r.endsWith(NEW)) { c[f] = r.slice(0, r.length - NEW.length) + OLD; ch = true; } });
    if (ch) app.save(c);
  });
});
