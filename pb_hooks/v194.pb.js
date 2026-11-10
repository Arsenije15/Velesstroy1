/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.4 — «Задачи и согласования» по личной ссылке: отдельная страница z.html, без входа,
// участник видит только свою тему и свои подтемы; этапы и сообщения — под его именем. Ссылку можно отключить.

// ---------- Создать личные ссылки участникам темы (руководитель / администратор) ----------
routerAdd("POST", "/api/vs/topic/links/create", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, Q.BOSS_ROLES);
  const b = e.requestInfo().body || {};
  const out = [];
  $app.runInTransaction((tx) => {
    const t = tx.findRecordById("topics", L.str(b.topic));
    if (t.getString("status") === "closed") throw new BadRequestError("Тема в архиве — сначала откройте её снова.");
    const mem = t.getStringSlice("members");
    const ids = (Array.isArray(b.users) ? b.users : []).map(String).slice(0, 200);
    if (!ids.length) throw new BadRequestError("Выберите участников.");
    ids.forEach((uid) => {
      if (mem.indexOf(uid) < 0) throw new BadRequestError("Человек не участвует в этой теме.");
      const u = tx.findRecordById("users", uid);
      // уже есть действующая ссылка — отдаём её же (повторная отправка не плодит ссылки)
      let rec = null;
      try { rec = tx.findFirstRecordByFilter("topic_links", "topic = {:t} && user = {:u} && revoked = false", { t: t.id, u: uid }); } catch (_) {}
      if (!rec) {
        rec = new Record(tx.findCollectionByNameOrId("topic_links"));
        rec.set("token", $security.randomStringWithAlphabet(32, "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"));
        rec.set("topic", t.id); rec.set("user", uid); rec.set("revoked", false); rec.set("views", 0);
        if (L.authId(a)) rec.set("created_by", a.id);
        tx.save(rec);
        Q.topicLog(L, tx, a, t.id, "«" + t.getString("title") + "»: личная ссылка для " + (u.getString("name") || u.getString("username")));
      }
      out.push({ id: rec.id, user: uid, name: u.getString("name") || u.getString("username"), token: rec.getString("token") });
    });
  });
  return e.json(200, { links: out });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/topic/links/revoke", (e) => {
  const L = require(`${__hooks}/lib.js`), Q = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, Q.BOSS_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const rec = tx.findRecordById("topic_links", L.str(b.link));
    rec.set("revoked", true); tx.save(rec);
    const t = tx.findRecordById("topics", rec.getString("topic")); let nm = "";
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
    me: { name: u.getString("name") || u.getString("username") },
    topic: { title: t.getString("title"), description: t.getString("description"), status: t.getString("status"), updated: t.getString("updated") },
    people: t.getStringSlice("members").map(nm),
    subs: subs.map((s) => ({ id: s.id, title: s.getString("title"), description: s.getString("description"), status: s.getString("status"),
      members: s.getStringSlice("members").map(nm), stages: Q.stagesOf(s).map((x) => ({ uid: x.uid, name: x.name, deadline: x.deadline, done: !!x.done, done_at: x.done_at, done_by: x.done_by })) })),
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
  const f = W.map((w, i) => "search_lc ~ {:w" + i + "}").join(" && ");
  const take = (c, filt, sort, n) => { try { return $app.findRecordsByFilter(c, filt, sort, n, 0, P2); } catch (_) { return []; } };
  const oper = take("oper_rows", f, "pid", 30).map((x) => ({ pid: x.getString("pid"), name: x.getString("name_proj") || x.getString("name_supp") || x.getString("name_1c"),
    object: [x.getString("object"), x.getString("subobject")].filter(Boolean).join(" / "), code: x.getString("code"), qty: x.getFloat("qty_c") || x.getFloat("qty"),
    unit: x.getString("unit_c") || x.getString("unit"), delivered: x.getFloat("qty_delivered"), supplier: x.getString("supplier"), stage: x.getString("stage"), torg: x.getString("torg") }));
  const mpz = take("mpz_stock", f, "name", 30).map((x) => ({ name: x.getString("name"), code: x.getString("code"), warehouse: x.getString("warehouse"), qty: x.getFloat("qty_end"), unit: x.getString("unit") }));
  const upd = take("upd_docs", "status != 'draft' && " + f, "-created", 10).map((u) => {
    let its = []; try { its = JSON.parse(u.getString("items") || "[]") || []; } catch (_) {}
    const hit = its.filter((x) => W.every((w) => X.lc(x.name + " " + (x.pid || "") + " " + (x.objcode || "")).indexOf(w) >= 0));
    return { number: u.getString("number"), date: u.getString("date"), supplier: u.getString("supplier"), total: its.length,
      items: (hit.length ? hit : its).slice(0, 15).map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, pid: x.pid || "", objcode: x.objcode || "", stage: x.stage || "" })) };
  });
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, { oper: oper, mpz: mpz, upd: upd });
});
