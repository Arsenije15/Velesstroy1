/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.46 — ПЛАН Б, фаза 1: непрерывная копия базы и файлов в облако + Яндекс Диск (только администратор)
routerAdd("GET", "/api/vs/backup/cloud", (e) => {
  const L = require(`${__hooks}/lib.js`), B = require(`${__hooks}/lib1946.js`);
  const a = L.requireRole(e, ["admin"]); if (a.getString && a.getString("scope")) throw new ForbiddenError("Только для администратора.");
  return e.json(200, B.status($app));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/backup/cloud/config", (e) => {
  const L = require(`${__hooks}/lib.js`), B = require(`${__hooks}/lib1946.js`);
  const a = L.requireRole(e, ["admin"]); if (a.getString && a.getString("scope")) throw new ForbiddenError("Только для администратора.");
  B.saveConfig($app, e.requestInfo().body || {});
  B.run($app, "conf"); B.run($app, "files");
  L.log($app, a, "backup_cloud", "backup", "", "Ключи копии в облако сохранены");
  return e.json(200, B.status($app));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/backup/cloud/run", (e) => {
  const L = require(`${__hooks}/lib.js`), B = require(`${__hooks}/lib1946.js`);
  const a = L.requireRole(e, ["admin"]); if (a.getString && a.getString("scope")) throw new ForbiddenError("Только для администратора.");
  B.run($app, String((e.requestInfo().body || {}).what || ""));
  return e.json(200, { started: true });
}, $apis.requireAuth("users"));
