/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.61 — «⚡ Пульт», пропуск по команде (черновик сохраняется сам → «Подтвердить»)
routerAdd("GET", "/api/vs/pult", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  return e.json(200, require(`${__hooks}/lib1961.js`).pult($app));
}, $apis.requireAuth("users"));
// черновик пропуска по заявке: {no:"7015", pos:[1,2]} или {request:id}
routerAdd("POST", "/api/vs/pass/draft", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  return e.json(200, require(`${__hooks}/lib1961.js`).passDraft($app, a, L, e.requestInfo().body || {}));
}, $apis.requireAuth("users"));
// сохранить черновик (подтверждённый не меняется — сначала «Вернуть в черновик»)
routerAdd("POST", "/api/vs/pass/save", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let p; try { p = $app.findRecordById("passes", L.str(b.id)); } catch (_) { throw new NotFoundError("Пропуск не найден."); }
  if (p.getString("status") !== "draft") throw new BadRequestError("Пропуск уже подтверждён — изменить можно после «Вернуть в черновик».");
  ["no", "date", "vehicle", "head", "mol"].forEach((k) => { if (b[k] !== undefined) p.set(k, L.str(b[k]).slice(0, k === "date" ? 10 : 300)); });
  if (Array.isArray(b.rows)) p.set("rows", b.rows.slice(0, 200).map((r) => ({ n: L.str(r && r.n).slice(0, 500), q: L.str(r && r.q).slice(0, 60), t: L.str(r && r.t).slice(0, 10), w: L.str(r && r.w).slice(0, 200), d: L.str(r && r.d).slice(0, 300), item: L.str(r && r.item).slice(0, 20) })));
  $app.save(p);
  return e.json(200, { ok: true, updated: p.getString("updated") });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/pass/confirm", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let p; try { p = $app.findRecordById("passes", L.str(b.id)); } catch (_) { throw new NotFoundError("Пропуск не найден."); }
  const back = !!b.back;
  if (back) { if (!L.isSuper(a) && a.getString("role") !== "admin") throw new ForbiddenError("Вернуть в черновик может только администратор."); p.set("status", "draft"); p.set("confirmed_by_name", ""); p.set("confirmed_at", ""); }
  else {
    let rw = []; try { rw = JSON.parse(p.getString("rows") || "[]") || []; } catch (_) {}
    if (!rw.some((r) => r && r.n)) throw new BadRequestError("В пропуске нет ни одной строки с наименованием.");
    p.set("status", "confirmed"); p.set("confirmed_by_name", L.userName(a)); p.set("confirmed_at", L.fmt(new Date()));
  }
  $app.save(p);
  L.log($app, a, back ? "pass_reopen" : "pass_confirm", "passes", p.id, (back ? "Пропуск возвращён в черновик: " : "Пропуск подтверждён: ") + p.getString("title"), {});
  return e.json(200, JSON.parse(JSON.stringify(p)));
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/pass/delete", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  let p; try { p = $app.findRecordById("passes", L.str((e.requestInfo().body || {}).id)); } catch (_) { throw new NotFoundError("Пропуск не найден."); }
  if (p.getString("status") !== "draft" && !L.isSuper(a) && a.getString("role") !== "admin") throw new ForbiddenError("Подтверждённый пропуск удаляет только администратор.");
  $app.delete(p);
  L.log($app, a, "pass_delete", "passes", p.id, "Пропуск удалён: " + p.getString("title"), {});
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
