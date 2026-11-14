/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.21 — администратор отправляет сообщение / цитату всем (приходит в 🔔, всплывает и системным уведомлением); остальные только получают

routerAdd("POST", "/api/vs/bc/send", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin"]);
  if (a.getString("scope")) throw new ForbiddenError("Отправлять может только администратор.");
  const b = e.requestInfo().body || {};
  let text = L.str(b.text).trim();
  let q = null;
  if (L.str(b.quote)) { q = $app.findRecordById("bc_quotes", L.str(b.quote)); text = q.getString("text"); }
  if (b.random) {
    const all = $app.findRecordsByFilter("bc_quotes", "id != ''", "sent_count,last_sent", 0, 0);
    if (!all.length) throw new BadRequestError("Список цитат пуст — сначала добавьте цитаты.");
    const min = all[0].getInt("sent_count");
    const pool = all.filter((x) => x.getInt("sent_count") === min);
    q = pool[Math.floor(Math.random() * pool.length)]; text = q.getString("text");
  }
  if (!text) throw new BadRequestError("Напишите текст.");
  if (text.length > 2000) throw new BadRequestError("Слишком длинно (больше 2000 знаков).");
  const r = new Record($app.findCollectionByNameOrId("broadcasts"));
  r.set("text", text); r.set("author", a.id); r.set("author_name", a.getString("name") || a.getString("username"));
  $app.save(r);
  if (q) { q.set("sent_count", q.getInt("sent_count") + 1); q.set("last_sent", new Date().toISOString().replace("T", " ")); $app.saveNoValidate(q); }
  L.log($app, a, "broadcast", "broadcasts", r.id, "Сообщение всем: " + text.slice(0, 200));
  return e.json(200, { id: r.id, text: text });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/bc/delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin"]);
  $app.delete($app.findRecordById("broadcasts", L.str((e.requestInfo().body || {}).id)));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/bc/quotes", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin"]);
  if (a.getString("scope")) throw new ForbiddenError("Только администратор.");
  const b = e.requestInfo().body || {};
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((x) => L.str(x).replace(/\s+/g, " ").trim()).filter((x) => x.length > 1).slice(0, 1000);
  if (!lines.length) throw new BadRequestError("Вставьте цитаты — каждая с новой строки.");
  const have = new Set($app.findRecordsByFilter("bc_quotes", "id != ''", "", 0, 0).map((x) => x.getString("text").toLowerCase()));
  const col = $app.findCollectionByNameOrId("bc_quotes");
  let n = 0, dup = 0;
  $app.runInTransaction((tx) => {
    lines.forEach((t) => {
      if (have.has(t.toLowerCase())) { dup++; return; }
      have.add(t.toLowerCase());
      const r = new Record(col); r.set("text", t.slice(0, 2000)); r.set("sent_count", 0); tx.save(r); n++;
    });
  });
  return e.json(200, { added: n, dup: dup });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/bc/quote_delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin"]);
  const b = e.requestInfo().body || {};
  if (b.all) { $app.db().newQuery("DELETE FROM bc_quotes").execute(); return e.json(200, { ok: true }); }
  $app.delete($app.findRecordById("bc_quotes", L.str(b.id)));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Телефон получателя и срок «забрать до» (сообщение заявителю об остатке) ----------
routerAdd("POST", "/api/vs/request/contact", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const r = $app.findRecordById("requests", L.str(b.request));
  const ph = L.str(b.phone).replace(/[^\d+()\-\s]/g, "").trim().slice(0, 40);
  const digits = ph.replace(/\D/g, "");
  if (ph && (digits.length < 10 || digits.length > 13)) throw new BadRequestError("Проверьте номер телефона: " + ph);
  const until = L.str(b.pickup_until).slice(0, 10);
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new BadRequestError("Неверная дата.");
  r.set("phone", ph); r.set("pickup_until", until);
  $app.saveNoValidate(r);
  const name = L.str(r.getString("recipient")).trim();
  if (name && ph) {
    const lc = X.lc(name).replace(/\s+/g, " ");
    let c; try { c = $app.findFirstRecordByData("contacts", "name_lc", lc); } catch (_) { c = new Record($app.findCollectionByNameOrId("contacts")); c.set("name", name); c.set("name_lc", lc); }
    c.set("phone", ph); $app.save(c);
  }
  L.log($app, a, "request_contact", "requests", r.id, "Заявка № " + r.getString("number") + ": телефон " + (ph || "—") + (until ? ", забрать до " + until.split("-").reverse().join(".") : ""));
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
