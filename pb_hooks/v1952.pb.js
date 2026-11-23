/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.52 — удалить отгрузку совсем; изменить количество невыданного; «Фактический остаток» склада

// ---------- автоматическое движение фактического остатка ----------
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib1952.js`).onItem(e); e.next(); }, "request_items");
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib1952.js`).onLeft(e); e.next(); }, "leftovers");
onRecordAfterCreateSuccess((e) => { require(`${__hooks}/lib1952.js`).onUpd(e); e.next(); }, "upd_docs");
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib1952.js`).onUpd(e); e.next(); }, "upd_docs");

// ---------- Отгрузка: удалить совсем (не только отменить) ----------
routerAdd("POST", "/api/vs/shipment/delete", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  const reason = L.str(b.reason);
  if (reason.length < 3) throw new BadRequestError("Укажите причину удаления.");
  const M = L.isSuper(a) || ["admin", "manager"].indexOf(L.role(a)) >= 0;
  let out = null;
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("request_shipments", L.str(b.shipment));
    const st = s.getString("status");
    if (!M && !(st === "preparing" || st === "cancelled")) throw new ForbiddenError("Отправленную или доставленную отгрузку удаляет руководитель или администратор.");
    if (!M && L.authId(a) !== s.getString("created_by")) throw new ForbiddenError("Удалить можно только свою подготовленную отгрузку. Чужую — руководитель или администратор.");
    const lines = X.jsonArr(s, "lines");
    const back = [];
    // доставлена и выдача записана в заявки — выданное по позициям уменьшается обратно
    if (st === "delivered" && s.getBool("issue_done")) {
      lines.forEach((l) => {
        let it = null; try { it = tx.findRecordById("request_items", l.item); } catch (_) { return; }
        const rq = tx.findRecordById("requests", it.getString("request"));
        if (rq.getString("status") !== "open") throw new BadRequestError("Заявка № " + rq.getString("number") + " закрыта — откройте её повторно, чтобы вернуть выданное по «" + l.material + "», или измените отгрузку.");
        const nv = Math.max(0, Math.round((it.getFloat("qty_issued") - l.qty) * 1000) / 1000);
        it.set("qty_issued", nv); tx.save(it); back.push(l.material + ": −" + l.qty + " " + l.unit);
      });
    }
    // техника и люди освобождаются
    X.jsonArr(s, "reservation_ids").forEach((id) => {
      try { const v = tx.findRecordById("reservations", id); if (v.getString("status") === "reserved" || v.getString("status") === "in_work") { v.set("status", "released"); v.set("released_at", L.fmt(new Date())); if (L.authId(a)) v.set("released_by", a.id); tx.save(v); } } catch (_) {}
    });
    const files = tx.findRecordsByFilter("request_files", "shipment = {:s}", "", 0, 0, { s: s.id });
    files.forEach((f) => tx.delete(f));
    tx.findRecordsByFilter("share_links", "shipment = {:s}", "", 0, 0, { s: s.id }).forEach((x) => tx.delete(x));
    const reqs = X.shipRequests(s);
    let nums = []; reqs.forEach((id) => { try { nums.push(tx.findRecordById("requests", id).getString("number")); } catch (_) {} });
    const info = { vehicle: s.getString("vehicle"), driver: s.getString("driver"), status: st, lines: lines.map((l) => ({ number: l.number, material: l.material, qty: l.qty, unit: l.unit })), photos: files.length, reason: reason, back: back };
    L.log(tx, a, "shipment_delete", "requests", reqs[0] || s.getString("request"), "Отгрузка " + s.getString("vehicle") + " (заявки № " + nums.join(", ") + ") удалена — причина: " + reason +
      (files.length ? "; фото: " + files.length : "") + (back.length ? "; выданное уменьшено: " + back.join("; ") : ""), info);
    tx.delete(s);
    out = { ok: true, deleted: info };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Невыданное: изменить количество (сколько осталось вывезти) ----------
routerAdd("POST", "/api/vs/leftover/qty", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const v = tx.findRecordById("leftovers", L.str(b.id));
    const left = parseFloat(String(b.left).replace(",", "."));
    if (isNaN(left) || left < 0) throw new BadRequestError("Укажите, сколько осталось вывезти (0 или больше).");
    const old = Math.round((v.getFloat("qty") - v.getFloat("issued")) * 1000) / 1000;
    const nq = Math.round((v.getFloat("issued") + left) * 1000) / 1000;
    if (Math.abs(nq - v.getFloat("qty")) < 1e-9) { out = { changed: 0 }; return; }
    const why = L.str(b.reason).slice(0, 300);
    let log = []; try { log = JSON.parse(v.getString("log") || "[]") || []; } catch (_) {}
    log.push({ at: L.fmt(new Date()), qty: 0, to: "", note: "Осталось вывезти: " + String(old).replace(".", ",") + " → " + String(left).replace(".", ",") + " " + v.getString("unit") + (why ? " — " + why : ""), by: L.userName(a) });
    v.set("log", log); v.set("qty", nq);
    v.set("status", left > 1e-9 ? "open" : "done");
    tx.save(v);
    L.log(tx, a, "leftover_qty", "requests", v.getString("request"), "Невыданное по заявке № " + v.getString("number") + ": «" + v.getString("material").slice(0, 80) + "» — осталось вывезти " + old + " → " + left + " " + v.getString("unit") + (why ? " — " + why : ""), {});
    out = { changed: 1, qty: nq, status: v.getString("status") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Фактический остаток ----------
// начать / начать заново: из последней выгрузки МПЗ (или пустой)
routerAdd("POST", "/api/vs/fstock/init", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib1952.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  const b = e.requestInfo().body || {};
  if (!b.confirm) throw new BadRequestError("Нужно подтверждение.");
  let n = 0, skipped = 0;
  $app.runInTransaction((tx) => {
    // всё прежнее — удаляется (движение тоже)
    tx.db().newQuery("DELETE FROM fstock_moves").execute();
    tx.db().newQuery("DELETE FROM fstock").execute();
    if (L.str(b.from) === "mpz") {
      let imp = "";
      try { imp = tx.findRecordsByFilter("mpz_stock", "", "-created", 1, 0)[0].getString("import_id"); } catch (_) {}
      const rows = imp ? tx.findRecordsByFilter("mpz_stock", "import_id = {:i}", "name", 0, 0, { i: imp }) : [];
      const G = {};
      rows.forEach((r) => {
        const k = F.key(r.getString("name")); if (!k) { skipped++; return; }
        const id = k + "|" + F.key(r.getString("unit"));
        const g = G[id] || (G[id] = { name: r.getString("name"), unit: r.getString("unit"), code: r.getString("code"), qty: 0, k: k });
        g.qty += r.getFloat("qty_end");
      });
      const col = tx.findCollectionByNameOrId("fstock");
      const keys = {};
      Object.keys(G).forEach((id) => {
        const g = G[id];
        if (keys[g.k]) { skipped++; return; }   // то же название с другой единицей — первая
        keys[g.k] = 1;
        const s = new Record(col);
        s.set("name", g.name.slice(0, 1500)); s.set("key", g.k); s.set("unit", g.unit); s.set("code", g.code); s.set("qty", F.r3(g.qty)); s.set("src", "mpz"); s.set("alias_lc", "|");
        s.set("search_lc", F.searchText(s)); if (L.authId(a)) s.set("updated_by", a.id);
        tx.save(s); n++;
      });
      if (!n) throw new BadRequestError("В МПЗ нет загруженной выгрузки — загрузите ведомость МПЗ или начните с пустого списка.");
    }
    L.log(tx, a, "fstock_init", "fstock", "", "Фактический остаток начат заново" + (n ? ": из МПЗ " + n + " поз." : " (пустой список)") + (L.str(b.note) ? " — " + L.str(b.note) : ""), { n: n, skipped: skipped });
  });
  return e.json(200, { ok: true, n: n, skipped: skipped });
}, $apis.requireAuth("users"));

// добавить позицию / изменить название, единицу, место, примечание
routerAdd("POST", "/api/vs/fstock/save", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib1952.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  const name = L.str(b.name).slice(0, 1500);
  if (!name) throw new BadRequestError("Укажите наименование.");
  let out = null;
  $app.runInTransaction((tx) => {
    const k = F.key(name);
    const ex = F.find(tx, k);
    let s;
    if (L.str(b.id)) { s = tx.findRecordById("fstock", L.str(b.id)); if (ex && ex.id !== s.id) throw new BadRequestError("Позиция с таким названием уже есть: «" + ex.getString("name") + "»."); }
    else {
      if (ex) throw new BadRequestError("Позиция с таким названием уже есть: «" + ex.getString("name") + "» — " + ex.getFloat("qty") + " " + ex.getString("unit") + ".");
      s = new Record(tx.findCollectionByNameOrId("fstock")); s.set("qty", 0); s.set("src", "manual"); s.set("alias_lc", "|");
    }
    s.set("name", name); s.set("key", k); s.set("unit", L.str(b.unit).slice(0, 30)); s.set("place", L.str(b.place).slice(0, 300)); s.set("note", L.str(b.note).slice(0, 1000));
    if (b.code !== undefined) s.set("code", L.str(b.code).slice(0, 60));
    s.set("search_lc", F.searchText(s)); if (L.authId(a)) s.set("updated_by", a.id);
    tx.save(s);
    if (!L.str(b.id)) {
      const q = parseFloat(String(b.qty || "0").replace(",", "."));
      if (q) F.move(tx, { stock: s, kind: "add", name: name, unit: s.getString("unit"), delta: q, src: "manual", note: "Новая позиция", by: L.userName(a) });
    }
    out = { id: s.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// пересчёт: фактически на складе столько-то (с причиной)
routerAdd("POST", "/api/vs/fstock/count", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib1952.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  const q = parseFloat(String(b.qty).replace(",", "."));
  if (isNaN(q)) throw new BadRequestError("Укажите количество.");
  const why = L.str(b.reason); if (why.length < 3) throw new BadRequestError("Укажите причину (пересчёт, пересорт, брак…).");
  let out = null;
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("fstock", L.str(b.id));
    const old = s.getFloat("qty");
    F.move(tx, { stock: s, kind: "count", name: s.getString("name"), unit: s.getString("unit"), set: q, delta: 0, src: "manual", note: why, by: L.userName(a) });
    L.log(tx, a, "fstock_count", "fstock", s.id, "Фактический остаток «" + s.getString("name").slice(0, 80) + "»: " + old + " → " + q + " " + s.getString("unit") + " — " + why, {});
    out = { qty: s.getFloat("qty") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// «Не сопоставлено»: привязать движение к позиции (и запомнить название как синоним) или создать новую позицию
routerAdd("POST", "/api/vs/fstock/link", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib1952.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const m = tx.findRecordById("fstock_moves", L.str(b.move));
    if (!m.getBool("pending")) throw new BadRequestError("Это движение уже учтено.");
    const act = L.str(b.action) || "link";
    if (act === "skip") {   // не учитывать (например, материал не со склада)
      m.set("pending", false); m.set("note", ("Не учтено: " + L.str(b.reason)).slice(0, 1000)); tx.save(m);
      out = { ok: true }; return;
    }
    let s;
    if (act === "new") {
      const k = m.getString("key");
      if (F.find(tx, k)) throw new BadRequestError("Позиция с таким названием уже есть — выберите её.");
      s = new Record(tx.findCollectionByNameOrId("fstock"));
      s.set("name", m.getString("name")); s.set("key", k); s.set("unit", m.getString("unit")); s.set("qty", 0); s.set("src", m.getString("src") === "upd" ? "upd" : "manual"); s.set("alias_lc", "|");
      s.set("search_lc", F.searchText(s)); if (L.authId(a)) s.set("updated_by", a.id); tx.save(s);
    } else {
      s = tx.findRecordById("fstock", L.str(b.stock));
      if (b.remember !== false) { F.addAlias(s, m.getString("key")); s.set("search_lc", F.searchText(s)); }
    }
    const q = F.r3(s.getFloat("qty") + m.getFloat("delta"));
    s.set("qty", q); tx.save(s);
    m.set("stock", s.id); m.set("after", q); m.set("pending", false); if (!m.getString("by_name")) m.set("by_name", L.userName(a)); tx.save(m);
    // остальные несопоставленные с тем же названием — сразу туда же
    let more = 0;
    if (b.remember !== false) {
      tx.findRecordsByFilter("fstock_moves", "pending = true && key = {:k}", "created", 0, 0, { k: m.getString("key") }).forEach((x) => {
        const q2 = F.r3(s.getFloat("qty") + x.getFloat("delta")); s.set("qty", q2); tx.save(s);
        x.set("stock", s.id); x.set("after", q2); x.set("pending", false); tx.save(x); more++;
      });
    }
    out = { stock: s.id, qty: s.getFloat("qty"), more: more };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// удалить позицию (руководитель)
routerAdd("POST", "/api/vs/fstock/del", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("fstock", L.str(b.id));
    L.log(tx, a, "fstock_del", "fstock", s.id, "Фактический остаток: позиция «" + s.getString("name").slice(0, 80) + "» удалена (было " + s.getFloat("qty") + " " + s.getString("unit") + ")", {});
    tx.delete(s);
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
