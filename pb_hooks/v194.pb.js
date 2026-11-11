/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.4 — «Задачи и согласования» по личной ссылке: отдельная страница z.html, без входа,
// участник видит только свою тему и свои подтемы; этапы и сообщения — под его именем. Ссылку можно отключить.

// ---------- Создать личные ссылки участникам темы (руководитель / администратор) ----------
routerAdd("POST", "/api/vs/topic/links/create", (e) => {
  // 1.9.6: ссылку участнику может выдать любой участник темы
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), Z = require(`${__hooks}/lib196.js`);
  const a = e.auth;
  const b = e.requestInfo().body || {};
  const out = [];
  $app.runInTransaction((tx) => {
    const t = tx.findRecordById("topics", L.str(b.topic));
    if (t.getString("status") === "closed") throw new BadRequestError("Тема в архиве — сначала откройте её снова.");
    Z.needEdit(L, Q, a, t);
    const ids = (Array.isArray(b.users) ? b.users : []).map(String).slice(0, 200);
    if (!ids.length) throw new BadRequestError("Выберите участников.");
    ids.forEach((uid) => out.push(Z.linkFor(L, Q, tx, a, t, uid)));
  });
  return e.json(200, { links: out });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/topic/links/revoke", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), Z = require(`${__hooks}/lib196.js`);
  const a = e.auth;
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const rec = tx.findRecordById("topic_links", L.str(b.link));
    const t = tx.findRecordById("topics", rec.getString("topic"));
    Z.needEdit(L, Q, a, t);
    rec.set("revoked", true); tx.save(rec);
    let nm = "";
    try { const u = tx.findRecordById("users", rec.getString("user")); nm = u.getString("name") || u.getString("username"); } catch (_) {}
    Q.topicLog(L, tx, a, t.id, "«" + t.getString("title") + "»: личная ссылка отключена — " + nm);
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Публично (по ссылке, без входа) ----------
routerAdd("GET", "/api/vs/pub/topic/{token}", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), P = require(`${__hooks}/lib194.js`);
  const k = P.topicLink(e.request.pathValue("token"));
  const t = k.topic, u = k.user, boss = Q.isBoss(L, u);
  const subs = $app.findRecordsByFilter("subtopics", "topic = {:t}", "sort", 0, 0, { t: t.id }).filter((s) => boss || Q.isMember(s, u));
  const ids = {}; subs.forEach((s) => { ids[s.id] = 1; });
  const msgs = $app.findRecordsByFilter("topic_msgs", "topic = {:t}", "created", 0, 0, { t: t.id }).filter((m) => ids[m.getString("subtopic")]);
  const names = {};
  const nm = (id) => { if (!id) return ""; if (names[id] === undefined) { try { const r = $app.findRecordById("users", id); names[id] = r.getString("name") || r.getString("username"); } catch (_) { names[id] = "—"; } } return names[id]; };
  k.link.set("views", k.link.getInt("views") + 1); k.link.set("last_view", L.fmt(new Date()));
  try { $app.saveNoValidate(k.link); } catch (_) {}
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, {
    me: { id: u.id, name: u.getString("name") || u.getString("username") },
    members: t.getStringSlice("members").map((id) => ({ id: id, name: nm(id) })),   // 1.9.6: для ссылок и подтем на странице участника
    topic: { title: t.getString("title"), description: t.getString("description"), status: t.getString("status"), updated: t.getString("updated") },
    people: t.getStringSlice("members").map(nm),
    subs: subs.map((s) => ({ id: s.id, title: s.getString("title"), description: s.getString("description"), status: s.getString("status"),
      members: s.getStringSlice("members").map(nm), member_ids: s.getStringSlice("members"), stages: Q.stagesOf(s).map((x) => ({ uid: x.uid, name: x.name, deadline: x.deadline, done: !!x.done, done_at: x.done_at, done_by: x.done_by })) })),
    msgs: msgs.map((m) => ({ sub: m.getString("subtopic"), user: m.getString("user_name"), kind: m.getString("kind"), text: m.getString("text"), at: m.getString("created") })),
    now: L.fmt(new Date()),
  });
});
routerAdd("POST", "/api/vs/pub/topic/{token}/msg", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), P = require(`${__hooks}/lib194.js`);
  const k = P.topicLink(e.request.pathValue("token"));
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => { P.sameTopic(tx, L.str(b.sub), k.topic.id); Q.subMsg(L, tx, k.user, L.str(b.sub), L.str(b.text)); });
  return e.json(200, { ok: true });
});
routerAdd("POST", "/api/vs/pub/topic/{token}/stage", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`), P = require(`${__hooks}/lib194.js`);
  const k = P.topicLink(e.request.pathValue("token"));
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => { P.sameTopic(tx, L.str(b.sub), k.topic.id); out = Q.subStage(L, tx, k.user, L.str(b.sub), L.str(b.uid), !!b.done); });
  return e.json(200, out);
});
// «Материалы — всё в одном месте» на странице участника: новый приход, оперативка, остатки МПЗ (только чтение, только текст)
routerAdd("GET", "/api/vs/pub/topic/{token}/find", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`), P = require(`${__hooks}/lib194.js`);
  P.topicLink(e.request.pathValue("token"));
  const q = X.lc(L.str(e.request.url.query().get("q"))).replace(/["'\\{}]/g, " ").trim();
  const W = q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!W.length) return e.json(200, { oper: [], mpz: [], upd: [] });
  const P2 = {}; W.forEach((w, i) => { P2["w" + i] = w; });
  // 1.9.6: каждое слово — в любом месте названия; «57x3» и «57х3» одинаковы
  W.forEach((w, i) => { P2["x" + i] = w.replace(/x/g, "х"); P2["y" + i] = w.replace(/х/g, "x"); });
  const f = W.map((w, i) => "(search_lc ~ {:w" + i + "} || search_lc ~ {:x" + i + "} || search_lc ~ {:y" + i + "})").join(" && ");
  const take = (c, filt, sort, n) => { try { return $app.findRecordsByFilter(c, filt, sort, n, 0, P2); } catch (_) { return []; } };
  const oper = take("oper_rows", f, "pid", 30).map((x) => ({ pid: x.getString("pid"), name: x.getString("name_proj") || x.getString("name_supp") || x.getString("name_1c"),
    object: [x.getString("object"), x.getString("subobject")].filter(Boolean).join(" / "), code: x.getString("code"), qty: x.getFloat("qty_c") || x.getFloat("qty"),
    unit: x.getString("unit_c") || x.getString("unit"), delivered: x.getFloat("qty_delivered"), supplier: x.getString("supplier"), stage: x.getString("stage"), torg: x.getString("torg") }));
  const mpz = take("mpz_stock", f, "name", 30).map((x) => ({ name: x.getString("name"), code: x.getString("code"), warehouse: x.getString("warehouse"), qty: x.getFloat("qty_end"), unit: x.getString("unit") }));
  const upd = take("upd_docs", "status != 'draft' && " + f, "-created", 10).map((u) => {
    let its = []; try { its = JSON.parse(u.getString("items") || "[]") || []; } catch (_) {}
    const xx = (v) => v.replace(/x/g, "х");
    const hit = its.filter((x) => W.every((w) => xx(X.lc(x.name + " " + (x.spec_name || "") + " " + (x.pid || "") + " " + (x.objcode || ""))).indexOf(xx(w)) >= 0));
    return { number: u.getString("number"), date: u.getString("date"), supplier: u.getString("supplier"), total: its.length,
      items: (hit.length ? hit : its).slice(0, 15).map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, pid: x.pid || "", objcode: x.objcode || "", stage: x.stage || "" })) };
  });
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, { oper: oper, mpz: mpz, upd: upd });
});
