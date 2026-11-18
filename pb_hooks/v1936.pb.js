/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.36 — туннель новой заявки: «где лежит» и «чем грузить» запоминаются для плана погрузки
routerAdd("POST", "/api/vs/loadmem/set", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper"]);
  const b = e.requestInfo().body || {};
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 300);
  let n = 0;
  $app.runInTransaction((tx) => {
    lines.forEach((x) => { const l = { material: L.str(x.material).slice(0, 1000), place: L.str(x.place).slice(0, 200), load: L.str(x.load).slice(0, 100), weight: "" };
      if (!l.material || (!l.place && !l.load)) return; X.planRemember(L, tx, l); n++; });
  });
  return e.json(200, { ok: true, saved: n });
}, $apis.requireAuth("users"));
