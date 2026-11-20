/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.44 — «Заметки» на сервере: GET — свои заметки, POST sync — слить с телефонными и вернуть общий список
routerAdd("GET", "/api/vs/zametki", (e) => {
  const Z = require(`${__hooks}/lib1944.js`);
  return e.json(200, { items: Z.get($app, e.auth.id) });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/zametki/sync", (e) => {
  const Z = require(`${__hooks}/lib1944.js`);
  const b = e.requestInfo().body || {};
  const items = Array.isArray(b.items) ? b.items.slice(0, 3000) : [];
  return e.json(200, { items: Z.sync($app, e.auth.id, items) });
}, $apis.requireAuth("users"));
