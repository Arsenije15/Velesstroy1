/// VELESSTROY 1.9.10 — ссылка на «Склад / СКК» для любого человека (видит только эту страницу)
// права на выдачу ссылок: admin, manager, skk (в каждом обработчике свой список — JSVM не видит общие переменные)
routerAdd("POST", "/api/vs/skk/links/create", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const b = e.requestInfo().body || {};
  const name = L.str(b.name).replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 3) throw new BadRequestError("Напишите, кому ссылка (ФИО или организация).");
  const mode = b.mode === "work" ? "work" : "view";
  const AL = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = null;
  $app.runInTransaction((tx) => {
    const u = new Record(tx.findCollectionByNameOrId("users"));
    const un = "skk_" + $security.randomStringWithAlphabet(8, "23456789abcdefghjkmnpqrstuvwxyz");
    u.set("username", un); u.set("email", un + "@velesstroy.local"); u.set("name", name);
    u.set("role", mode === "work" ? "skk" : "skk_view"); u.set("scope", "skk"); u.set("tgroup", "skk"); u.set("active", true);
    u.set("warehouse", L.str(b.company).slice(0, 100)); u.setPassword($security.randomStringWithAlphabet(24, AL)); u.set("verified", true);
    tx.save(u);
    const k = new Record(tx.findCollectionByNameOrId("skk_links"));
    k.set("token", $security.randomStringWithAlphabet(28, AL)); k.set("user", u.id); k.set("label", name); k.set("mode", mode); k.set("active", true); k.set("views", 0);
    if (L.authId(a)) k.set("created_by", a.id);
    tx.save(k);
    L.log(tx, a, "skk_link", "skk_links", k.id, "Ссылка на «Склад / СКК» для «" + name + "» (" + (mode === "work" ? "работа" : "просмотр") + ")", {});
    out = { id: k.id, token: k.getString("token"), mode: mode, name: name };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/skk/links", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "skk"]);
  const rows = $app.findRecordsByFilter("skk_links", "active = true", "-created", 300, 0).map((k) => {
    let by = ""; try { const c = $app.findRecordById("users", k.getString("created_by")); by = c.getString("name") || c.getString("username"); } catch (_) {}
    return { id: k.id, token: k.getString("token"), name: k.getString("label"), mode: k.getString("mode"), views: k.getInt("views"), last_open: k.getString("last_open"), created: k.getString("created"), by: by };
  });
  return e.json(200, { links: rows });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/skk/links/off", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const k = tx.findRecordById("skk_links", L.str(b.id));
    k.set("active", false); tx.save(k);
    try { const u = tx.findRecordById("users", k.getString("user")); if (u.getString("scope") === "skk") { u.set("active", false); tx.save(u); } } catch (_) {}
    L.log(tx, a, "skk_link", "skk_links", k.id, "Ссылка на «Склад / СКК» для «" + k.getString("label") + "» отключена", {});
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
  if (!u.getBool("active") || u.getString("scope") !== "skk") throw new ApiError(410, "Ссылка отключена — попросите новую.", {});
  k.set("views", k.getInt("views") + 1); k.set("last_open", L.fmt(new Date())); try { $app.saveNoValidate(k); } catch (_) {}
  return $apis.recordAuthResponse(e, u, "link");
});
// человек по ссылке — только «Склад / СКК»: УПД, акты, оперативка, МПЗ, поставщики (остальное API закрыто)
routerUse((e) => {
  const a = e.auth;
  if (a && a.getString("scope") === "skk") {
    const p = e.request.url.path;
    let okp = true;
    if (p.indexOf("/api/vs/") === 0) okp = /^\/api\/vs\/(upd|skk|oper|mpz|suppliers|fields|sfiles|pub)(\/|$)/.test(p);
    else if (p.indexOf("/api/collections/") === 0) okp = /^\/api\/collections\/(users|upd_docs|skk_acts|suppliers|supplier_splits|supplier_files|oper_rows|mpz_stock|upd_photos|suggestions|form_fields|field_files)\//.test(p);
    if (!okp) throw new ForbiddenError("По этой ссылке доступна только страница «Склад / СКК».");
  }
  return e.next();
});
