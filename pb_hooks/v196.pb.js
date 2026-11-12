/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.6 — спецификация поставщика (Excel) к УПД; группы участников «Задач и согласований»;
// новый участник без GitHub; список файлов поставщиков (без самих файлов); общая доска склада (s.html).

// ---------- Спецификация поставщика → позиции УПД: наименование поставщика (колонка D) и шифр объекта (колонка B) ----------
routerAdd("POST", "/api/vs/upd/spec", (e) => {
  const L = require(`${__hooks}/lib.js`), K = require(`${__hooks}/lib18.js`), Z = require(`${__hooks}/lib196.js`);
  const a = L.requireRole(e, K.UPD_ROLES);
  const b = e.requestInfo().body || {};
  const spec = (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000).map((x, i) => ({ no: L.str(x.no).slice(0, 20), objcode: L.str(x.objcode).slice(0, 300),
    name: L.str(x.name).slice(0, 1000), unit: L.str(x.unit).slice(0, 20), qty: K.num(x.qty), i: i })).filter((x) => x.name);
  if (!spec.length) throw new BadRequestError("В файле не найдена таблица спецификации (колонки «Шифр объекта» и «Наименование … Поставщика»).");
  const ids = (Array.isArray(b.upds) ? b.upds : [b.id]).map(String).filter(Boolean).slice(0, 50);
  const res = [];
  $app.runInTransaction((tx) => {
    const used = {};
    ids.forEach((id) => {
      const u = tx.findRecordById("upd_docs", id);
      if (u.getString("status") === "draft") throw new BadRequestError("Сначала сохраните УПД.");
      let its = []; try { its = JSON.parse(u.getString("items") || "[]") || []; } catch (_) {}
      const r = Z.matchSpec(its, spec, used);
      u.set("items", its);
      const sn = L.str(b.spec_no).slice(0, 40); if (sn && !u.getString("spec")) u.set("spec", sn);
      tx.save(u);
      r.acts = Z.syncActs(tx, u, its);
      L.log(tx, a, "upd_spec", "upd_docs", u.id, "УПД № " + u.getString("number") + ": спецификация " + L.str(b.file_name).slice(0, 120) + " — сопоставлено " + r.matched + " из " + its.length + ", наименование заменено в " + r.renamed, {});
      res.push({ id: u.id, number: u.getString("number"), acts: r.acts, total: its.length, matched: r.matched, renamed: r.renamed, missing: r.missing.slice(0, 30) });
    });
  });
  return e.json(200, { upds: res, spec_rows: spec.length });
}, $apis.requireAuth("users"));

// ---------- Задачи и согласования: справочник людей по группам, новый участник, список ссылок ----------
routerAdd("GET", "/api/vs/topic/directory", (e) => {
  const L = require(`${__hooks}/lib.js`), Z = require(`${__hooks}/lib196.js`);
  return e.json(200, { groups: Z.GROUPS, people: Z.directory($app) });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/topic/newuser", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), Z = require(`${__hooks}/lib196.js`);
  const a = e.auth; const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => { out = Z.newUser(L, Q, tx, a, tx.findRecordById("topics", L.str(b.topic)), b); });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/topic/links/{id}", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), Z = require(`${__hooks}/lib196.js`);
  const t = $app.findRecordById("topics", e.request.pathValue("id"));
  if (!Z.canEdit(L, Q, e.auth, t)) throw new ForbiddenError("Вы не участник этой темы.");
  const L2 = $app.findRecordsByFilter("topic_links", "topic = {:t}", "-created", 0, 0, { t: t.id }).map((l) => ({ id: l.id, user: l.getString("user"), token: l.getString("token"),
    revoked: l.getBool("revoked"), views: l.getInt("views"), last_view: l.getString("last_view"), created: l.getString("created") }));
  return e.json(200, { links: L2 });
}, $apis.requireAuth("users"));

// ---------- То же по личной ссылке (z.html): участник сам открывает подтемы, выбирает людей, раздаёт ссылки ----------
routerAdd("GET", "/api/vs/pub/topic/{token}/directory", (e) => {
  const P = require(`${__hooks}/lib194.js`), Z = require(`${__hooks}/lib196.js`);
  P.topicLink(e.request.pathValue("token"));
  return e.json(200, { groups: Z.GROUPS, people: Z.directory($app).map((p) => ({ id: p.id, name: p.name, group: p.group, company: p.company })) });
});
routerAdd("POST", "/api/vs/pub/topic/{token}/sub_save", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), P = require(`${__hooks}/lib194.js`), Z = require(`${__hooks}/lib196.js`);
  const k = P.topicLink(e.request.pathValue("token")); const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    if (b.id) P.sameTopic(tx, L.str(b.id), k.topic.id);
    out = Z.subSave(L, Q, tx, k.user, Object.assign({}, b, { topic: k.topic.id }));
  });
  return e.json(200, out);
});
routerAdd("POST", "/api/vs/pub/topic/{token}/link", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), P = require(`${__hooks}/lib194.js`), Z = require(`${__hooks}/lib196.js`);
  const k = P.topicLink(e.request.pathValue("token")); const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => { const t = tx.findRecordById("topics", k.topic.id); Z.needEdit(L, Q, k.user, t); out = Z.linkFor(L, Q, tx, k.user, t, L.str(b.user)); });
  return e.json(200, out);
});
routerAdd("POST", "/api/vs/pub/topic/{token}/members", (e) => {
  // добавить в тему людей из справочника (по одному или группой)
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), P = require(`${__hooks}/lib194.js`), Z = require(`${__hooks}/lib196.js`);
  const k = P.topicLink(e.request.pathValue("token")); const b = e.requestInfo().body || {};
  let n = 0;
  $app.runInTransaction((tx) => {
    const t = tx.findRecordById("topics", k.topic.id); Z.needEdit(L, Q, k.user, t);
    const tm = t.getStringSlice("members");
    (Array.isArray(b.users) ? b.users : []).map(String).slice(0, 200).forEach((id) => { const u = tx.findRecordById("users", id); if (u.getBool("active") && tm.indexOf(id) < 0) { tm.push(id); n++; } });
    t.set("members", tm); tx.save(t);
    if (n) Q.topicLog(L, tx, k.user, t.id, "«" + t.getString("title") + "»: добавлено участников " + n);
  });
  return e.json(200, { added: n });
});
routerAdd("POST", "/api/vs/pub/topic/{token}/newuser", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), P = require(`${__hooks}/lib194.js`), Z = require(`${__hooks}/lib196.js`);
  const k = P.topicLink(e.request.pathValue("token")); const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => { out = Z.newUser(L, Q, tx, k.user, tx.findRecordById("topics", k.topic.id), b); });
  return e.json(200, out);
});

// ---------- Список файлов поставщиков (папки 50 ГБ): на сервер — только имя, путь, размер, дата ----------
routerAdd("POST", "/api/vs/sfiles/import", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "skk"]);
  const b = e.requestInfo().body || {};
  const imp = L.str(b.import_id).replace(/[^a-z0-9]/gi, "").slice(0, 30); if (!imp) throw new BadRequestError("Нет import_id.");
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000);
  // УПД по имени файла или папки: «УПД 6232», «счет-фактура», «СФ 15», «универсальный передаточный», «УТД»
  const UPD = /(^|[^a-zа-яё])(упд|upd|утд|с[\s_\-]?ф)([^a-zа-яё]|$)|сч[её]т[\s_\-]*фактур|универсальн\S*[\s_\-]+передат/i;
  let n = 0, removed = 0;
  $app.runInTransaction((tx) => {
    const col = tx.findCollectionByNameOrId("supplier_files");
    rows.forEach((x) => {
      const name = L.str(x.name).slice(0, 300); if (!name || /^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(name) || name.charAt(0) === "~") return;
      const path = L.str(x.path).slice(0, 1000), sup = L.str(x.supplier).slice(0, 300);
      const r = new Record(col);
      r.set("supplier", sup); r.set("path", path); r.set("name", name); r.set("ext", (name.match(/\.([a-z0-9]{1,8})$/i) || ["", ""])[1].toLowerCase());
      r.set("size", +x.size || 0); r.set("mtime", L.str(x.mtime).slice(0, 25)); r.set("uchet", L.str(x.uchet).slice(0, 120)); r.set("import_id", imp);
      r.set("is_upd", UPD.test(name) || UPD.test(path.split("/").slice(0, -1).join(" ")));
      r.set("search_lc", X.lc(sup + " " + path).slice(0, 1400));
      tx.save(r); n++;
    });
    if (b.final) {
      // заменяем прежний список этих же поставщиков (папок) — одним запросом
      const sups = (Array.isArray(b.suppliers) ? b.suppliers : []).map(String).slice(0, 2000);
      if (sups.length) {
        const P = { imp: imp }; const ph = sups.map((s, i) => { P["s" + i] = s; return "{:s" + i + "}"; }).join(",");
        const q = tx.db().newQuery("DELETE FROM supplier_files WHERE import_id != {:imp} AND supplier IN (" + ph + ")").bind(P);
        removed = q.execute().rowsAffected();
      }
      L.log(tx, a, "sfiles_import", "supplier_files", imp, "Список файлов поставщиков: папок " + sups.length + ", файлов " + (+b.total || n) + (removed ? ", прежних строк заменено " + removed : ""), {});
    }
  });
  return e.json(200, { added: n, removed: removed });
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/sfiles/meta", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk", "skk_view"]);
  const r = new DynamicModel({ n: 0, u: 0, s: 0, sz: 0, last: "" });
  $app.db().newQuery("SELECT COUNT(*) AS n, COALESCE(SUM(is_upd),0) AS u, COUNT(DISTINCT supplier) AS s, COALESCE(SUM(size),0) AS sz, COALESCE(MAX(created),'') AS last FROM supplier_files").one(r);
  return e.json(200, { files: r.n, upd: r.u, suppliers: r.s, bytes: r.sz, last: r.last });
}, $apis.requireAuth("users"));

// ---------- Общая доска склада: одна ссылка, без входа (s.html) ----------
routerAdd("POST", "/api/vs/site/link", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper"]);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    // новая ссылка отключает прежние (если старая ушла не туда)
    tx.findRecordsByFilter("site_links", "active = true", "", 0, 0).forEach((r) => { r.set("active", false); tx.save(r); });
    if (b.off) { L.log(tx, a, "site_link", "site_links", "", "Общая ссылка склада отключена", {}); out = { token: "" }; return; }
    const r = new Record(tx.findCollectionByNameOrId("site_links"));
    r.set("token", $security.randomStringWithAlphabet(24, "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")); r.set("title", "Склад — техника и люди"); r.set("active", true); r.set("views", 0);
    if (L.authId(a)) r.set("created_by", a.id);
    tx.save(r); L.log(tx, a, "site_link", "site_links", r.id, "Создана общая ссылка склада (прежние отключены)", {});
    out = { token: r.getString("token") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/site/link", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper"]);
  let r = null; try { r = $app.findFirstRecordByFilter("site_links", "active = true"); } catch (_) {}
  return e.json(200, r ? { token: r.getString("token"), views: r.getInt("views"), created: r.getString("created") } : { token: "" });
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/pub/site/{token}", (e) => {
  const L = require(`${__hooks}/lib.js`), Z = require(`${__hooks}/lib196.js`);
  const k = Z.siteLink(e.request.pathValue("token"));
  k.set("views", k.getInt("views") + 1); try { $app.saveNoValidate(k); } catch (_) {}
  const since = L.fmt(new Date(Date.now() - 14 * 86400000)).slice(0, 10);
  const rows = $app.findRecordsByFilter("site_board", "end >= {:d} || end = '' || start >= {:d}", "start", 500, 0, { d: since });
  let names = [];
  try { names = $app.findRecordsByFilter("resources", "unavailable = false", "name", 300, 0).map((r) => ({ name: r.getString("name"), kind: r.getString("category") === "worker" ? "people" : "tech" })); } catch (_) {}
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, { rows: rows.map(Z.boardOut), resources: names, fields: require(`${__hooks}/lib197.js`).defsOut($app, ["board"]).board, now: L.fmt(new Date()) });
});
routerAdd("POST", "/api/vs/pub/site/{token}/save", (e) => {
  const L = require(`${__hooks}/lib.js`), Z = require(`${__hooks}/lib196.js`);
  Z.siteLink(e.request.pathValue("token"));
  const b = e.requestInfo().body || {};
  let files = []; try { files = e.findUploadedFiles("photos") || []; } catch (_) {}
  let out = null;
  $app.runInTransaction((tx) => { out = Z.boardSave(L, tx, b, files); });
  return e.json(200, out);
});
