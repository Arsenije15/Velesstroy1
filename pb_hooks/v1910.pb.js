/// VELESSTROY 1.9.10 — ссылка на «Склад / СКК» для любого человека (видит только эту страницу)
// права на выдачу ссылок: admin, manager, skk (в каждом обработчике свой список — JSVM не видит общие переменные)
routerAdd("POST", "/api/vs/skk/links/create", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const b = e.requestInfo().body || {};
  const scope = b.scope === "sklad" ? "sklad" : b.scope === "zay" ? "zay" : "skk";   // zay (1.9.15) — «Склад: заявки»: ресурсы склада, поиск, свои заявки   // 1.9.12: «Склад» — новый приход, оперативка, МПЗ, журнал актов
  const a = L.requireRole(e, scope === "skk" ? ["admin", "manager", "skk"] : ["admin", "manager", "storekeeper"]);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("По ссылке нельзя выдавать ссылки.");
  const name = L.str(b.name).replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 3) throw new BadRequestError("Напишите, кому ссылка (ФИО или организация).");
  const mode = b.mode === "work" ? "work" : "view";
  const AL = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = null;
  $app.runInTransaction((tx) => {
    const u = new Record(tx.findCollectionByNameOrId("users"));
    const un = "skk_" + $security.randomStringWithAlphabet(8, "23456789abcdefghjkmnpqrstuvwxyz");
    u.set("username", un); u.set("email", un + "@velesstroy.local"); u.set("name", name);
    u.set("role", scope !== "skk" ? (mode === "work" ? "storekeeper" : "viewer") : (mode === "work" ? "skk" : "skk_view")); u.set("scope", scope); u.set("tgroup", scope === "skk" ? "skk" : "sklad"); u.set("active", true);
    u.set("warehouse", L.str(b.company).slice(0, 100)); u.setPassword($security.randomStringWithAlphabet(24, AL)); u.set("verified", true);
    tx.save(u);
    const k = new Record(tx.findCollectionByNameOrId("skk_links"));
    k.set("token", $security.randomStringWithAlphabet(28, AL)); k.set("user", u.id); k.set("label", name); k.set("mode", mode); k.set("scope", scope); k.set("active", true); k.set("views", 0);
    if (L.authId(a)) k.set("created_by", a.id);
    tx.save(k);
    L.log(tx, a, "skk_link", "skk_links", k.id, "Ссылка на «" + ({ sklad: "Склад", zay: "Склад: заявки" }[scope] || "Склад / СКК") + "» для «" + name + "» (" + (mode === "work" ? "работа" : "просмотр") + ")", {});
    out = { id: k.id, token: k.getString("token"), mode: mode, scope: scope, name: name };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/skk/links", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk", "storekeeper"]);
  if (a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const r0 = a.getString("role");
  const mine = (sc) => r0 === "skk" ? sc === "skk" : r0 === "storekeeper" ? sc !== "skk" : true;
  const rows = $app.findRecordsByFilter("skk_links", "active = true", "-created", 300, 0).filter((k) => mine(k.getString("scope") || "skk")).map((k) => {
    let by = ""; try { const c = $app.findRecordById("users", k.getString("created_by")); by = c.getString("name") || c.getString("username"); } catch (_) {}
    return { id: k.id, token: k.getString("token"), name: k.getString("label"), mode: k.getString("mode"), scope: k.getString("scope") || "skk", views: k.getInt("views"), last_open: k.getString("last_open"), created: k.getString("created"), by: by };
  });
  return e.json(200, { links: rows });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/skk/links/off", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk", "storekeeper"]);
  if (a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const k = tx.findRecordById("skk_links", L.str(b.id));
    const ks = k.getString("scope") || "skk", r0 = a.getString("role");
    if ((r0 === "skk" && ks !== "skk") || (r0 === "storekeeper" && ks === "skk")) throw new ForbiddenError("Эту ссылку выдали не вы.");
    k.set("active", false); tx.save(k);
    try { const u = tx.findRecordById("users", k.getString("user")); if (u.getString("scope")) { u.set("active", false); tx.save(u); } } catch (_) {}
    L.log(tx, a, "skk_link", "skk_links", k.id, "Ссылка для «" + k.getString("label") + "» отключена", {});
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// открыть ссылку: вход под пользователем ссылки (видит только «Склад / СКК»)
routerAdd("POST", "/api/vs/pub/skk/{token}", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const t = e.request.pathValue("token");
  if (!/^[A-Za-z0-9]{16,64}$/.test(t || "")) throw new NotFoundError("Ссылка не найдена.");
  let k = null; try { k = $app.findFirstRecordByFilter("skk_links", "token = {:t}", { t: t }); } catch (_) { throw new NotFoundError("Ссылка не найдена."); }
  if (!k.getBool("active")) throw new ApiError(410, "Ссылка отключена — попросите новую.", {});
  const u = $app.findRecordById("users", k.getString("user"));
  if (!u.getBool("active") || !u.getString("scope")) throw new ApiError(410, "Ссылка отключена — попросите новую.", {});
  k.set("views", k.getInt("views") + 1); k.set("last_open", L.fmt(new Date())); try { $app.saveNoValidate(k); } catch (_) {}
  return $apis.recordAuthResponse(e, u, "link");
});
// человек по ссылке — только «Склад / СКК»: УПД, акты, оперативка, МПЗ, поставщики (остальное API закрыто)
routerUse((e) => {
  const a = e.auth;
  const sc = a ? a.getString("scope") : "";
  if (sc === "skk") {
    const p = e.request.url.path;
    let okp = true;
    if (p.indexOf("/api/vs/") === 0) okp = /^\/api\/vs\/(upd|skk|oper|mpz|suppliers|fields|sfiles|pub)(\/|$)/.test(p);
    else if (p.indexOf("/api/collections/") === 0) okp = /^\/api\/collections\/(users|upd_docs|skk_acts|suppliers|supplier_splits|supplier_files|oper_rows|mpz_stock|upd_photos|suggestions|form_fields|field_files|acts)\//.test(p);
    if (!okp) throw new ForbiddenError("По этой ссылке доступна только страница «Склад / СКК».");
  } else if (sc === "sklad") {
    // 1.9.12: «Склад» — новый приход (УПД + фото груза), оперативка, МПЗ, журнал актов; ссылки на СКК и акты СКК закрыты
    const p = e.request.url.path;
    let okp = true;
    if (p.indexOf("/api/vs/") === 0) okp = /^\/api\/vs\/(upd|oper|mpz|fields|pub)(\/|$)/.test(p) && !/^\/api\/vs\/upd\/(spec|delete)/.test(p);
    else if (p.indexOf("/api/collections/") === 0) okp = /^\/api\/collections\/(users|upd_docs|upd_photos|oper_rows|mpz_stock|acts|suggestions|form_fields|field_files)\//.test(p);
    if (!okp) throw new ForbiddenError("По этой ссылке доступна только страница «Склад».");
  } else if (sc === "zay") {
    // 1.9.15: «Склад: заявки» — ресурсы склада (как в программе), поиск (оперативка, МПЗ, журнал актов) и свои заявки (с проверкой на акт)
    const p = e.request.url.path;
    let okp = true;
    if (p.indexOf("/api/vs/") === 0) okp = /^\/api\/vs\/(request\/(create|update|note|ocr|file_delete)|acts\/match|reserve|reservation\/action|resource\/status|actcheck|oper|mpz|fields|pub)(\/|$)/.test(p);
    else if (p.indexOf("/api/collections/") === 0) okp = /^\/api\/collections\/(users|requests|request_items|request_files|request_notes|request_shipments|request_ocr|resources|reservations|oper_rows|mpz_stock|acts|suggestions|form_fields|field_files)\//.test(p);
    if (!okp) throw new ForbiddenError("По этой ссылке доступны только «Ресурсы склада», «Поиск» и «Мои заявки».");
  }
  return e.next();
});
