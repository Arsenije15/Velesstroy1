/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9 — оперативка, справочник поставщиков, сопоставление прихода (УПД) с оперативкой, «Задачи и согласования».

// ---------- Оперативка: загрузка Excel (повторная загрузка файла заменяет только его строки) ----------
routerAdd("POST", "/api/vs/oper/import", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, Q.OPER_ROLES);
  const b = e.requestInfo().body || {};
  const imp = L.str(b.import_id), src = L.str(b.source).slice(0, 200);
  if (!/^[a-z0-9]{6,40}$/.test(imp)) throw new BadRequestError("Неверный идентификатор загрузки.");
  if (!src) throw new BadRequestError("Нет имени файла.");
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length > 1000) throw new BadRequestError("Слишком много строк в одной части.");
  let total = 0, removed = 0, sups = 0;
  $app.runInTransaction((tx) => {
    const col = tx.findCollectionByNameOrId("oper_rows");
    const n = (v) => { const q = parseFloat(String(v === undefined || v === null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(q) ? 0 : Math.round(q * 1000) / 1000; };
    const S = (v, m) => L.str(v).replace(/\s+/g, " ").trim().slice(0, m || 300);
    rows.forEach((x) => {
      const nm = S(x.name_proj, 1000) || S(x.name_supp, 1000) || S(x.name_1c, 1000);
      if (!nm && !S(x.pid)) return;
      const r = new Record(col);
      r.set("source", src); r.set("sheet", S(x.sheet, 120)); r.set("line_no", parseInt(x.line_no, 10) || 0); r.set("import_id", imp);
      ["pid", "order_no", "object", "subobject", "svod", "grp", "buyer", "code", "gost", "nom_group", "unit", "unit_c", "plan_mount", "plan_ship", "plan_delivery", "stage", "supplier", "contract", "spec", "torg", "torg_date", "note"]
        .forEach((k) => r.set(k, S(x[k], k === "torg" ? 500 : k === "note" ? 1000 : 300)));
      ["name_proj", "name_supp", "name_1c"].forEach((k) => r.set(k, S(x[k], 1000)));
      ["qty", "qty_c", "qty_shipped", "qty_delivered"].forEach((k) => r.set(k, n(x[k])));
      r.set("supplier_key", X.supplierKey(S(x.supplier)));
      r.set("upd_keys", X.updKeysField(S(x.torg, 500)).slice(0, 1000));
      r.set("search_lc", X.lc([S(x.pid), nm, S(x.name_supp, 1000), S(x.name_1c, 1000), S(x.code), S(x.object), S(x.subobject), S(x.supplier), S(x.torg, 500), S(x.stage), S(x.order_no), S(x.gost)].join(" ")).slice(0, 4000));
      tx.save(r);
    });
    if (b.final) {
      const old = tx.findRecordsByFilter("oper_rows", "source = {:s} && import_id != {:i}", "", 0, 0, { s: src, i: imp });
      old.forEach((r) => tx.delete(r)); removed = old.length;
      const now = tx.findRecordsByFilter("oper_rows", "source = {:s}", "", 0, 0, { s: src });
      total = now.length;
      const seen = {}; now.forEach((r) => { const s = r.getString("supplier"); if (s && !seen[r.getString("supplier_key")]) { seen[r.getString("supplier_key")] = 1; if (Q.upsertSupplier(X, tx, s, "оперативка")) sups++; } });
      L.log(tx, a, "oper_import", "oper_rows", "", "Загружена оперативка «" + src + "»: " + total + " строк, поставщиков " + sups, {});
    }
  });
  return e.json(200, { total: total, removed: removed, suppliers: sups });
}, $apis.requireAuth("users"));
routerAdd("GET", "/api/vs/oper/meta", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk", "skk_view", "coord"]);
  const src = arrayOf(new DynamicModel({ source: "", n: 0, last: "" })), st = arrayOf(new DynamicModel({ v: "", n: 0 }));
  $app.db().newQuery("SELECT source, COUNT(*) AS n, COALESCE(MAX(updated),'') AS last FROM oper_rows GROUP BY source ORDER BY source").all(src);
  $app.db().newQuery("SELECT COALESCE(stage,'') AS v, COUNT(*) AS n FROM oper_rows GROUP BY stage ORDER BY n DESC").all(st);
  return e.json(200, { sources: src.map((x) => ({ source: x.source, n: x.n, last: x.last })), stages: st.map((x) => ({ v: x.v, n: x.n })) });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/oper/delete_source", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  const src = L.str((e.requestInfo().body || {}).source); let n = 0;
  $app.runInTransaction((tx) => { const rows = tx.findRecordsByFilter("oper_rows", "source = {:s}", "", 0, 0, { s: src }); rows.forEach((r) => tx.delete(r)); n = rows.length;
    L.log(tx, a, "oper_delete", "oper_rows", "", "Оперативка: удалён файл «" + src + "» (" + n + " строк)", {}); });
  return e.json(200, { removed: n });
}, $apis.requireAuth("users"));

// ---------- Справочник поставщиков ----------
routerAdd("POST", "/api/vs/suppliers/save", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const b = e.requestInfo().body || {};
  let out = { added: 0 };
  $app.runInTransaction((tx) => {
    if (b.id) {   // переименовать / включить / выключить
      const r = tx.findRecordById("suppliers", L.str(b.id));
      if (b.name !== undefined) { const nm = L.str(b.name).trim(); if (!nm) throw new BadRequestError("Пустое название."); r.set("name", nm.slice(0, 300)); r.set("key", X.supplierKey(nm)); }
      if (b.active !== undefined) r.set("active", !!b.active);
      if (b.inn !== undefined) r.set("inn", L.str(b.inn).replace(/\D/g, "").slice(0, 12));
      tx.save(r); L.log(tx, a, "supplier_update", "suppliers", r.id, "Поставщик «" + r.getString("name") + "»" + (r.getBool("active") ? "" : " — выключен"), {}); out = { id: r.id }; return;
    }
    const names = (Array.isArray(b.names) ? b.names : [b.name]).map((x) => L.str(x).trim()).filter(Boolean).slice(0, 3000);
    if (!names.length) throw new BadRequestError("Напишите название поставщика.");
    let added = 0;
    names.forEach((nm) => { const before = tx.findRecordsByFilter("suppliers", "key = {:k}", "", 1, 0, { k: X.supplierKey(nm) }).length; if (Q.upsertSupplier(X, tx, nm, L.str(b.source) || "вручную", L.str(b.inn).replace(/\D/g, "")) && !before) added++; });
    L.log(tx, a, "supplier_add", "suppliers", "", "Справочник поставщиков: добавлено " + added + (names.length > 1 ? " из " + names.length : " — " + names[0]), {});
    out = { added: added, total: names.length };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Приход: сопоставить позиции УПД с оперативкой ----------
routerAdd("GET", "/api/vs/upd/match/{id}", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`), Q = require(`${__hooks}/lib19.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk", "skk_view"]);
  const u = $app.findRecordById("upd_docs", e.request.pathValue("id"));
  let items = []; try { items = JSON.parse(u.getString("items") || "[]") || []; } catch (_) {}
  const sk = u.getString("supplier_key"), w = sk.slice(0, 6);   // ключ без пробелов: «металлинвестнижнийтагил»
  let rows = w ? $app.findRecordsByFilter("oper_rows", "supplier_key ~ {:w}", "", 3000, 0, { w: w }).filter((r) => X.supplierMatch(sk, r.getString("supplier_key"))) : [];
  const uk = X.updKeys(u.getString("number"));
  const byUpd = rows.filter((r) => uk.some((k) => r.getString("upd_keys").indexOf("|" + k + "|") >= 0));
  const pick = (r, score, why) => ({ id: r.id, score: Math.round(score * 100), why: why, pid: r.getString("pid"), code: r.getString("code"), object: r.getString("object"), subobject: r.getString("subobject"),
    name: r.getString("name_proj") || r.getString("name_supp") || r.getString("name_1c"), name_supp: r.getString("name_supp"), stage: r.getString("stage"), unit: r.getString("unit_c") || r.getString("unit"),
    qty: r.getFloat("qty_c") || r.getFloat("qty"), torg: r.getString("torg"), source: r.getString("source") });
  const res = items.map((it) => {
    const c = rows.map((r) => {
      const s = Math.max(Q.sim(it.name, r.getString("name_supp")), Q.sim(it.name, r.getString("name_proj")), Q.sim(it.name, r.getString("name_1c")));
      const onUpd = byUpd.indexOf(r) >= 0;
      return { r: r, s: Math.min(1, s * 0.8 + (onUpd ? 0.35 : 0) + (r.getString("unit_c") && it.unit && r.getString("unit_c").toLowerCase().indexOf(String(it.unit).toLowerCase()) === 0 ? 0.05 : 0)), onUpd: onUpd, sim: s };
    }).filter((x) => x.sim >= 0.25 || (x.onUpd && byUpd.length === 1)).sort((x, y) => y.s - x.s).slice(0, 5);
    return { name: it.name, candidates: c.map((x) => pick(x.r, x.s, (x.onUpd ? "УПД в оперативке; " : "") + "название " + Math.round(x.sim * 100) + "%")) };
  });
  return e.json(200, { supplier_rows: rows.length, upd_rows: byUpd.length, items: res });
}, $apis.requireAuth("users"));

// ---------- Задачи и согласования ----------
routerAdd("POST", "/api/vs/topic/save", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, Q.BOSS_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const t = b.id ? tx.findRecordById("topics", L.str(b.id)) : new Record(tx.findCollectionByNameOrId("topics"));
    const title = L.str(b.title).trim(); if (!title) throw new BadRequestError("Напишите название темы.");
    const mem = (Array.isArray(b.members) ? b.members : []).map(String);
    mem.forEach((id) => tx.findRecordById("users", id));
    const old = b.id ? t.getStringSlice("members") : [];
    if (b.id) tx.findRecordsByFilter("subtopics", "topic = {:t}", "", 0, 0, { t: t.id }).forEach((s) => s.getStringSlice("members").forEach((m) => { if (mem.indexOf(m) < 0) mem.push(m); }));
    if (L.authId(a) && mem.indexOf(a.id) < 0) mem.push(a.id);
    t.set("title", title.slice(0, 300)); t.set("description", L.str(b.description).slice(0, 3000)); t.set("members", mem);
    if (!b.id) { t.set("status", "open"); if (L.authId(a)) t.set("created_by", a.id); }
    tx.save(t);
    Q.topicLog(L, tx, a, t.id, (b.id ? "Тема изменена: «" : "Новая тема: «") + title + "», участников " + mem.length + (b.id && mem.length !== old.length ? " (было " + old.length + ")" : ""));
    out = { id: t.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/topic/status", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, Q.BOSS_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const t = tx.findRecordById("topics", L.str(b.id)); const close = L.str(b.status) === "closed";
    t.set("status", close ? "closed" : "open"); t.set("closed_at", close ? L.fmt(new Date()) : ""); tx.save(t);
    Q.topicLog(L, tx, a, t.id, (close ? "Тема закрыта (в архив): «" : "Тема открыта снова: «") + t.getString("title") + "»");
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/sub/save", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, Q.BOSS_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const s = b.id ? tx.findRecordById("subtopics", L.str(b.id)) : new Record(tx.findCollectionByNameOrId("subtopics"));
    const t = tx.findRecordById("topics", b.id ? s.getString("topic") : L.str(b.topic));
    if (t.getString("status") === "closed") throw new BadRequestError("Тема в архиве — сначала откройте её снова.");
    const title = L.str(b.title).trim(); if (!title) throw new BadRequestError("Напишите название подтемы.");
    const mem = (Array.isArray(b.members) ? b.members : []).map(String); mem.forEach((id) => tx.findRecordById("users", id));
    if (!mem.length) throw new BadRequestError("Выберите участников подтемы.");
    const old = b.id ? Q.stagesOf(s) : [];
    const stages = (Array.isArray(b.stages) ? b.stages : []).slice(0, 100).map((x) => {
      const o = old.find((y) => y.uid && y.uid === x.uid) || {};
      return { uid: L.str(x.uid) || $security.randomString(8), name: L.str(x.name).trim().slice(0, 300), deadline: L.str(x.deadline).slice(0, 10), done: !!o.done, done_at: o.done_at || "", done_by: o.done_by || "" };
    }).filter((x) => x.name);
    s.set("topic", t.id); s.set("title", title.slice(0, 300)); s.set("description", L.str(b.description).slice(0, 3000)); s.set("members", mem); s.set("stages", stages);
    if (!b.id) { s.set("status", "open"); s.set("sort", Date.now() / 1000); if (L.authId(a)) s.set("created_by", a.id); }
    tx.save(s);
    const tm = t.getStringSlice("members"); mem.forEach((m) => { if (tm.indexOf(m) < 0) tm.push(m); }); t.set("members", tm); tx.save(t);
    const msg = new Record(tx.findCollectionByNameOrId("topic_msgs"));
    msg.set("topic", t.id); msg.set("subtopic", s.id); msg.set("user", L.authId(a) ? a.id : ""); msg.set("user_name", L.userName(a)); msg.set("kind", "sys");
    msg.set("text", b.id ? "изменил(а) подтему: этапов " + stages.length + ", участников " + mem.length : "открыл(а) подтему: этапов " + stages.length + ", участников " + mem.length); tx.save(msg);
    Q.topicLog(L, tx, a, t.id, "«" + t.getString("title") + "» → подтема «" + title + "»" + (b.id ? " изменена" : " открыта"));
    out = { id: s.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/sub/stage", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = e.auth;
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("subtopics", L.str(b.sub)), t = tx.findRecordById("topics", s.getString("topic"));
    Q.subAccess(L, a, s, t);
    if (s.getString("status") === "closed" && !Q.isBoss(L, a)) throw new BadRequestError("Подтема закрыта.");
    const st = Q.stagesOf(s), x = st.find((y) => y.uid === L.str(b.uid)); if (!x) throw new BadRequestError("Этап не найден.");
    x.done = !!b.done; x.done_at = x.done ? L.fmt(new Date()) : ""; x.done_by = x.done ? L.userName(a) : "";
    s.set("stages", st); tx.save(s);
    const msg = new Record(tx.findCollectionByNameOrId("topic_msgs"));
    msg.set("topic", t.id); msg.set("subtopic", s.id); msg.set("user", L.authId(a)); msg.set("user_name", L.userName(a)); msg.set("kind", "stage");
    msg.set("text", (x.done ? "✔ отметил(а) этап «" : "↺ снял(а) отметку с этапа «") + x.name + "»"); tx.save(msg);
    Q.topicLog(L, tx, a, t.id, "«" + t.getString("title") + "» / «" + s.getString("title") + "»: этап «" + x.name + "» " + (x.done ? "выполнен" : "снова не выполнен"));
    out = { done: st.filter((y) => y.done).length, total: st.length };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/sub/msg", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = e.auth;
  const b = e.requestInfo().body || {};
  const text = L.str(b.text).trim(); if (!text) throw new BadRequestError("Пустое сообщение.");
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("subtopics", L.str(b.sub)), t = tx.findRecordById("topics", s.getString("topic"));
    Q.subAccess(L, a, s, t);
    const msg = new Record(tx.findCollectionByNameOrId("topic_msgs"));
    msg.set("topic", t.id); msg.set("subtopic", s.id); msg.set("user", L.authId(a)); msg.set("user_name", L.userName(a)); msg.set("kind", "msg"); msg.set("text", text.slice(0, 3000)); tx.save(msg);
    t.set("status", t.getString("status")); tx.save(t);   // «обновлено» у темы — для списка
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/sub/status", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, Q.BOSS_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("subtopics", L.str(b.sub)), t = tx.findRecordById("topics", s.getString("topic"));
    const close = L.str(b.status) === "closed"; s.set("status", close ? "closed" : "open"); tx.save(s);
    const msg = new Record(tx.findCollectionByNameOrId("topic_msgs"));
    msg.set("topic", t.id); msg.set("subtopic", s.id); msg.set("user", L.authId(a) ? a.id : ""); msg.set("user_name", L.userName(a)); msg.set("kind", "sys"); msg.set("text", close ? "закрыл(а) подтему" : "открыл(а) подтему снова"); tx.save(msg);
    Q.topicLog(L, tx, a, t.id, "«" + t.getString("title") + "» / «" + s.getString("title") + "» " + (close ? "закрыта" : "открыта снова"));
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
// Имена участников темы (участнику согласований закрыт список пользователей)
routerAdd("GET", "/api/vs/topic/people/{id}", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = e.auth; const t = $app.findRecordById("topics", e.request.pathValue("id"));
  if (!Q.isBoss(L, a) && !Q.isMember(t, a)) throw new ForbiddenError("Вы не участник этой темы.");
  const ids = t.getStringSlice("members"); const out = [];
  ids.forEach((id) => { try { const u = $app.findRecordById("users", id); out.push({ id: u.id, name: u.getString("name") || u.getString("username"), role: u.getString("role"), company: u.getString("warehouse") }); } catch (_) {} });
  return e.json(200, { people: out });
}, $apis.requireAuth("users"));
