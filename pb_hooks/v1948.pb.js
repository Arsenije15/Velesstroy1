/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.48 — копия базы изнутри сервера → в облако
// 1.9.54: не каждые 5 минут, а 3 раза в день — 12:00, 16:00 и 21:00 по Москве (часовой пояс сервера не важен: считаем от UTC)
cronAdd("vs_cloud_snap", "0 * * * *", () => {
  try { const S = require(`${__hooks}/lib1948.js`); if (S.due(new Date())) S.snapshot($app, true); } catch (e) { console.log("cloud snapshot failed: " + e); }
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
