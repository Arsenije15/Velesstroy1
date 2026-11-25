/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.40 — сверка по шифрам; новые акты по моим заявкам
routerAdd("GET", "/api/vs/codes/list", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  return e.json(200, { codes: require(`${__hooks}/lib1940.js`).codesList($app) });
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/codes/report", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  let r; try { r = require(`${__hooks}/lib1940.js`).codeReport($app, String(e.request.url.query().get("code") || "")); } catch (err) { if (err && err.status) throw err; throw new BadRequestError("Сверка не удалась: " + String(err).slice(0, 300)); }
  return e.json(200, r);
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/request/actalerts", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, ["admin", "manager", "storekeeper"]);
  if (a.getString && a.getString("scope") && a.getString("scope") !== "zay") return e.json(200, { alerts: [] });
  return e.json(200, { alerts: require(`${__hooks}/lib1960.js`).actAlertsCached($app, a.id) });   // 1.9.60: пересчёт только при изменениях
}, $apis.requireAuth("users"));
