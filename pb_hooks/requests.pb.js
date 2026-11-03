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
    r.set("status", "open");
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
    it.set("qty_issued", q);if (L.authId(a)) it.set("issued_by", a.id);
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
