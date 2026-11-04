/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY — заявки на выдачу ТМЦ. Заказанное количество фиксируется при создании,
// выданное вносит склад, закрытая заявка изменений не принимает. Всё пишется в журнал.

// ---------- Создать заявку ----------
routerAdd("POST", "/api/vs/request/create", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const number = L.str(b.number);
  const norm = number.toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
  if (!norm) throw new BadRequestError("Укажите номер заявки.");
  const items = Array.isArray(b.items) ? b.items : [];
  const clean = [];
  items.forEach((it, i) => {
    const material = L.str(it && it.material);
    const qty = Math.round(parseFloat(String(it && it.qty_ordered).replace(",", ".")) * 1000) / 1000;
    if (!material && !(qty > 0)) return; // пустая строка формы
    if (!material) throw new BadRequestError("Строка " + (i + 1) + ": укажите материал.");
    if (!(qty > 0)) throw new BadRequestError("Строка " + (i + 1) + ": укажите заказанное количество больше нуля.");
    clean.push({ material: material, qty: qty, supplier: L.str(it.supplier), unit: L.str(it.unit), rd: L.str(it.rd), supply_doc: L.str(it.supply_doc) });
  });
  if (!clean.length) throw new BadRequestError("Добавьте хотя бы одну позицию.");
  let out = null;
  $app.runInTransaction((tx) => {
    const dup = tx.findRecordsByFilter("requests", "number_norm = {:n} && status != 'cancelled'", "", 1, 0, { n: norm });
    if (dup.length) throw new ApiError(409, "Заявка № " + number + " уже есть в системе.", { request: dup[0].id });
    const r = new Record(tx.findCollectionByNameOrId("requests"));
    r.set("number", number); r.set("number_norm", norm);
    const d = L.parse(b.req_date);
    if (d) r.set("req_date", L.fmt(d));
    r.set("object", L.str(b.object)); r.set("recipient", L.str(b.recipient)); r.set("note", L.str(b.note));
    r.set("status", "open"); r.set("signatures", {}); r.set("signed_all", false);
    if (L.authId(a)) r.set("created_by", a.id);
    r.set("warehouse", L.isSuper(a) ? "" : a.getString("warehouse"));
    tx.save(r);
    const col = tx.findCollectionByNameOrId("request_items");
    clean.forEach((c, i) => {
      const it = new Record(col);
      it.set("request", r.id); it.set("sort", (i + 1) * 10);
      it.set("material", c.material); it.set("supplier", c.supplier); it.set("unit", c.unit);
      it.set("qty_ordered", c.qty); it.set("qty_issued", 0); it.set("rd", c.rd); it.set("supply_doc", c.supply_doc);
      tx.save(it);
    });
    L.log(tx, a, "request_create", "requests", r.id, "Новая заявка № " + number + " (" + clean.length + " поз.)", { items: clean });
    out = { request: r.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Внести выданное количество по позиции ----------
routerAdd("POST", "/api/vs/request/issue", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const raw = String(b.qty_issued === undefined || b.qty_issued === null ? "" : b.qty_issued).replace(",", ".").trim();
  const q = raw === "" ? 0 : Math.round(parseFloat(raw) * 1000) / 1000;
  if (isNaN(q) || q < 0) throw new BadRequestError("Выданное количество должно быть числом 0 или больше.");
  let out = null;
  $app.runInTransaction((tx) => {
    const it = tx.findRecordById("request_items", L.str(b.item));
    const r = tx.findRecordById("requests", it.getString("request"));
    if (r.getString("status") !== "open") throw new BadRequestError("Заявка закрыта — изменения невозможны.");
    const ord = it.getFloat("qty_ordered");
    if (q > ord + 1e-9) throw new BadRequestError("Нельзя выдать больше заказанного: заказано " + String(ord).replace(".", ",") + " " + it.getString("unit") + ".");
    const old = it.getFloat("qty_issued");
    if (Math.abs(old - q) < 1e-9) { out = { qty_issued: q }; return; }
    it.set("qty_issued", q);
    if (L.authId(a)) it.set("issued_by", a.id);
    it.set("issued_at", L.fmt(new Date()));
    tx.save(it);
    L.log(tx, a, "request_issue", "requests", r.id,
      "Заявка № " + r.getString("number") + ": " + it.getString("material") + " — выдано " + q + " из " + ord + " " + it.getString("unit") + " (было " + old + ")", { item: it.id });
    out = { qty_issued: q };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Закрыть / открыть повторно / аннулировать ----------
routerAdd("POST", "/api/vs/request/status", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const b = e.requestInfo().body || {};
  const act = L.str(b.action);
  const a = L.requireRole(e, act === "close" ? L.WRITE_ROLES : ["admin", "manager"]);
  const comment = L.str(b.comment);
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("requests", L.str(b.request));
    const st = r.getString("status");
    const items = tx.findRecordsByFilter("request_items", "request = {:r}", "sort", 0, 0, { r: r.id });
    const short = items.filter((x) => x.getFloat("qty_issued") + 1e-9 < x.getFloat("qty_ordered"));
    let text = "";
    if (act === "close") {
      if (st !== "open") throw new BadRequestError("Заявка уже закрыта.");
      if (short.length && !comment) throw new BadRequestError("Выдано не полностью (" + short.length + " поз.). Укажите комментарий, почему заявка закрывается.");
      const photos = tx.findRecordsByFilter("request_files", "request = {:r} && kind = 'close'", "", 1, 0, { r: r.id });
      if (!photos.length) throw new BadRequestError("Для закрытия нужно фото (подписанная заявка / выданный материал).");
      const transit = tx.findRecordsByFilter("request_shipments", "request = {:r} && (status = 'preparing' || status = 'sent')", "", 0, 0, { r: r.id });
      if (transit.length) throw new BadRequestError("Есть незавершённая отгрузка (" + transit.length + "): отметьте доставку или отмените её.");
      r.set("status", "closed"); r.set("closed_at", L.fmt(new Date()));
      if (L.authId(a)) r.set("closed_by", a.id);
      r.set("close_comment", comment);
      text = "Заявка № " + r.getString("number") + " закрыта" + (short.length ? " (выдано не полностью: " + short.length + " поз.)" : " (выдано полностью)");
    } else if (act === "reopen") {
      if (st !== "closed") throw new BadRequestError("Открыть повторно можно только закрытую заявку.");
      if (!comment) throw new BadRequestError("Укажите причину повторного открытия.");
      r.set("status", "open"); r.set("closed_at", ""); r.set("closed_by", ""); r.set("close_comment", "");
      text = "Заявка № " + r.getString("number") + " открыта повторно: " + comment;
    } else if (act === "cancel") {
      if (st === "cancelled") throw new BadRequestError("Заявка уже аннулирована.");
      if (!comment) throw new BadRequestError("Укажите причину аннулирования.");
      r.set("status", "cancelled"); r.set("closed_at", L.fmt(new Date()));
      if (L.authId(a)) r.set("closed_by", a.id);
      r.set("close_comment", comment);
      text = "Заявка № " + r.getString("number") + " аннулирована: " + comment;
    } else throw new BadRequestError("Неизвестное действие.");
    tx.save(r);
    L.log(tx, a, "request_" + act, "requests", r.id, text, { comment: comment });
    out = { status: r.getString("status") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Подписи бумажной заявки (можно отмечать и после закрытия) ----------
routerAdd("POST", "/api/vs/request/sign", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const key = L.str(b.key);
  const def = X.SIGNS.filter((x) => x[0] === key)[0];
  if (!def) throw new BadRequestError("Неизвестная подпись.");
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("requests", L.str(b.request));
    if (r.getString("status") === "cancelled") throw new BadRequestError("Заявка аннулирована.");
    let sig = {};
    try { sig = JSON.parse(r.getString("signatures") || "{}") || {}; } catch (_) { sig = {}; }
    if (b.value) sig[key] = { by: L.authId(a), name: L.userName(a), at: L.fmt(new Date()), who: L.str(b.who) };
    else delete sig[key];
    const all = X.SIGNS.every((x) => !!sig[x[0]]);
    r.set("signatures", sig); r.set("signed_all", all);
    tx.save(r);
    L.log(tx, a, "request_sign", "requests", r.id, "Заявка № " + r.getString("number") + ": " + (b.value ? "подпись отмечена" : "подпись снята") + " — " + def[1] +
      (L.str(b.who) ? " (" + L.str(b.who) + ")" : "") + (all ? ". Все подписи собраны" : ""), {});
    out = { signed_all: all };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Отгрузка по заявке: подготовка ----------
routerAdd("POST", "/api/vs/request/shipment/create", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const vehicle = L.str(b.vehicle);
  if (!vehicle) throw new BadRequestError("Укажите машину (марка, госномер).");
  const ids = (Array.isArray(b.resources) ? b.resources : []).map((x) => L.str(x)).filter(Boolean);
  let hours = parseFloat(String(b.hours === undefined ? "4" : b.hours).replace(",", "."));
  if (!(hours > 0) || hours > 72) throw new BadRequestError("Укажите время в пути от 0,5 до 72 часов.");
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("requests", L.str(b.request));
    if (r.getString("status") !== "open") throw new BadRequestError("Отгрузка возможна только по открытой заявке.");
    const names = ids.map((id) => tx.findRecordById("resources", id).getString("name"));
    const s = new Record(tx.findCollectionByNameOrId("request_shipments"));
    s.set("request", r.id); s.set("status", "preparing"); s.set("vehicle", vehicle); s.set("driver", L.str(b.driver));
    s.set("resource_ids", ids); s.set("reservation_ids", []); s.set("hours", Math.round(hours * 10) / 10); s.set("note", L.str(b.note));
    if (L.authId(a)) s.set("created_by", a.id);
    tx.save(s);
    L.log(tx, a, "shipment_prepare", "requests", r.id, "Заявка № " + r.getString("number") + ": готовится отгрузка — " + vehicle +
      (L.str(b.driver) ? ", водитель " + L.str(b.driver) : "") + (names.length ? "; с собой: " + names.join(", ") : ""), { shipment: s.id });
    out = { shipment: s.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Отгрузка: отправить / доставлено / отменить ----------
routerAdd("POST", "/api/vs/request/shipment/action", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const act = L.str(b.action);
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("request_shipments", L.str(b.shipment));
    const r = tx.findRecordById("requests", s.getString("request"));
    const st = s.getString("status");
    let ids = [], resv = [];
    try { ids = JSON.parse(s.getString("resource_ids") || "[]") || []; } catch (_) {}
    try { resv = JSON.parse(s.getString("reservation_ids") || "[]") || []; } catch (_) {}
    const head = "Заявка № " + r.getString("number") + " (" + s.getString("vehicle") + "): ";
    if (act === "send") {
      if (st !== "preparing") throw new BadRequestError("Отправить можно только подготовленную отгрузку.");
      const ph = tx.findRecordsByFilter("request_files", "shipment = {:s}", "", 1, 0, { s: s.id });
      if (!ph.length) throw new BadRequestError("Для отправки нужно фото погруженного материала.");
      const now = new Date(), end = new Date(now.getTime() + (s.getFloat("hours") || 4) * 3600000);
      const col = tx.findCollectionByNameOrId("reservations");
      const names = [];
      ids.forEach((id) => {
        const res = tx.findRecordById("resources", id);
        if (res.getBool("unavailable")) throw new ApiError(409, res.getString("name") + " НЕДОСТУПЕН: " + res.getString("unavailable_reason"), {});
        try { L.conflictCheck(tx, res, now, end, ""); }
        catch (err) { throw new ApiError(409, res.getString("name") + ": " + (err.message || err), {}); }
        const v = new Record(col);
        v.set("resource", res.id); v.set("qty", 1); v.set("site", r.getString("object") || "Отгрузка");
        v.set("purpose", "Отгрузка по заявке № " + r.getString("number") + " (" + s.getString("vehicle") + ")");
            v.set("start", L.fmt(now)); v.set("end", L.fmt(end)); v.set("responsible", L.userName(a)); v.set("status", "in_work");
        if (L.authId(a)) v.set("created_by", a.id);
        tx.save(v); resv.push(v.id); names.push(res.getString("name"));
      });
      s.set("status", "sent"); s.set("sent_at", L.fmt(now)); s.set("reservation_ids", resv);
      if (L.authId(a)) s.set("sent_by", a.id);
      tx.save(s);
      L.log(tx, a, "shipment_send", "requests", r.id, head + "ОТПРАВЛЕНО" + (names.length ? "; заняты: " + names.join(", ") : ""), { shipment: s.id });
    } else if (act === "deliver" || act === "cancel") {
      if (act === "deliver" && st !== "sent") throw new BadRequestError("Доставку можно отметить только у отправленной отгрузки.");
      if (act === "cancel" && st !== "preparing") throw new BadRequestError("Отменить можно только подготовку; отправленную — отметьте доставку.");
      resv.forEach((id) => {
        try {
          const v = tx.findRecordById("reservations", id);
          if (v.getString("status") === "reserved" || v.getString("status") === "in_work") {
            v.set("status", "released"); v.set("released_at", L.fmt(new Date())); if (L.authId(a)) v.set("released_by", a.id); tx.save(v);
          }
        } catch (_) {}
      });
      s.set("status", act === "deliver" ? "delivered" : "cancelled");
      if (act === "deliver") { s.set("delivered_at", L.fmt(new Date())); if (L.authId(a)) s.set("delivered_by", a.id); }
      tx.save(s);
      L.log(tx, a, "shipment_" + act, "requests", r.id, head + (act === "deliver" ? "ДОСТАВЛЕНО, техника и люди освобождены" : "отгрузка отменена"), { shipment: s.id });
    } else throw new BadRequestError("Неизвестное действие.");
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Журнал: фото по заявке ----------
onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/lib.js`);
  const sh = e.record.getString("shipment");
  if (sh) {
    const s = $app.findRecordById("request_shipments", sh);
    if (s.getString("request") !== e.record.getString("request")) throw new BadRequestError("Фото не относится к этой заявке.");
    if (s.getString("status") !== "preparing" && s.getString("status") !== "sent") throw new BadRequestError("Отгрузка уже завершена.");
    e.record.set("kind", "shipment");
  }
  e.next();
  const kinds = { shipment: "фото отгрузки", close: "фото при закрытии", signed: "фото подписанной заявки", other: "фото" };
  L.log($app, e.auth, "request_photo", "requests", e.record.getString("request"), "Добавлено " + (kinds[e.record.getString("kind")] || "фото"), {});
}, "request_files");
            
