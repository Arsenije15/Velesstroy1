/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.48 — каждые 5 минут, если база менялась: копия базы изнутри сервера → в облако
cronAdd("vs_cloud_snap", "*/5 * * * *", () => {
  try { require(`${__hooks}/lib1948.js`).snapshot($app, false); } catch (e) { console.log("cloud snapshot failed: " + e); }
});
routerAdd("POST", "/api/vs/backup/cloud/snapnow", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin"]); if (a.getString && a.getString("scope")) throw new ForbiddenError("Только для администратора.");
  const force = !!((e.requestInfo().body || {}).force);
  return e.json(200, require(`${__hooks}/lib1948.js`).snapshot($app, force));
}, $apis.requireAuth("users"));
// любая запись через программу помечает базу «изменённой» (время файла может не успеть смениться за долю секунды)
onRecordAfterCreateSuccess((e) => { try { $app.store().set("vs_db_dirty", true); } catch (_) {} e.next(); });
onRecordAfterUpdateSuccess((e) => { try { $app.store().set("vs_db_dirty", true); } catch (_) {} e.next(); });
onRecordAfterDeleteSuccess((e) => { try { $app.store().set("vs_db_dirty", true); } catch (_) {} e.next(); });
