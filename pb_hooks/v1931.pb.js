/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.31 — план погрузки: сохранить места, способ погрузки, вес и машины по позициям отгрузки
routerAdd("POST", "/api/vs/shipment/plan", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("request_shipments", L.str(b.shipment));
    if (s.getString("status") === "cancelled") throw new BadRequestError("Отгрузка отменена.");
    const cars = Array.isArray(b.cars) ? X.carsOf(L, b.cars, s.getString("vehicle")) : X.jsonArr(s, "cars");
    const lines = X.jsonArr(s, "lines").map((l) => {
      const x = (Array.isArray(b.lines) ? b.lines : []).filter((y) => L.str(y && y.item) === l.item)[0];
      if (!x) return l;
      const p = X.planOf(L, x); if (p.car > Math.max(1, cars.length)) p.car = 1;
      const n = Object.assign({}, l, p); X.planRemember(L, tx, n); return n;
    });
    s.set("lines", lines); s.set("cars", cars); tx.save(s);
    L.log(tx, a, "shipment_plan", "requests", s.getString("request"), "План погрузки — " + s.getString("vehicle") + ": " + lines.filter((l) => l.place || l.load).length + " из " + lines.length + " поз. с местом/способом" + (cars.length > 1 ? "; машин " + cars.length : ""), { shipment: s.id });
    out = { ok: true };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
