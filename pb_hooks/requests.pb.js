/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.3 — заявки на выдачу ТМЦ. Заказанное количество фиксируется при создании,
// выданное вносит склад, закрытая заявка изменений не принимает. Всё пишется в журнал.

// ---------- Создать заявку ----------
routerAdd("POST", "/api/vs/request/create", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const g = X.guard(L, a, b);
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
    clean.push({ material: material, qty: qty, supplier: L.str(it.supplier), unit: L.str(it.unit), rd: L.str(it.rd), supply_doc: L.str(it.supply_doc),
      project_name: L.str(it.project_name).slice(0, 1000), name1c: L.str(it.name1c).slice(0, 1000), objcode: L.str(it.objcode).slice(0, 300), stock_note: L.str(it.stock_note).slice(0, 500) });
  });
  if (!clean.length) throw new BadRequestError("Добавьте хотя бы одну позицию.");
  let out = null;
  $app.runInTransaction((tx) => {
    const dup = tx.findRecordsByFilter("requests", "number_norm = {:n} && status != 'cancelled'", "", 1, 0, { n: norm });
    if (dup.length) X.deny(g, "Заявка № " + number + " уже есть в системе.");
    // Акты несоответствия: поставщик + УПД (док. поставки) → неустранённый акт = запрет
    clean.forEach((c, i) => {
      c.acts = [];
      if (!c.supplier || !c.supply_doc) return;
      const found = X.findActs(tx, c.supply_doc, c.supplier).filter((x) => x.open && x.level === "match");
      if (!found.length) return;
      c.acts = found.map((x) => ({ act_no: x.act_no, act_date: x.act_date, material: x.material, reason: x.reason, torg: x.torg }));
      X.deny(g, "Позиция " + (i + 1) + " «" + c.material + "»: по поставщику «" + c.supplier + "» и УПД «" + c.supply_doc + "» есть неустранённый акт № " +
        found.map((x) => x.act_no).filter((v, k, arr) => arr.indexOf(v) === k).join(", ") + " — нужна служебная записка");
    });
    X.check(g);
    const r = new Record(tx.findCollectionByNameOrId("requests"));
    r.set("number", number); r.set("number_norm", norm);
    const d = L.parse(b.req_date);
    if (d) r.set("req_date", L.fmt(d));
    r.set("object", L.str(b.object)); r.set("recipient", L.str(b.recipient)); r.set("note", L.str(b.note));
    // 1.5: шапка печатной формы
    [["planned_date", 40], ["from_wh", 300], ["to_org", 300], ["contract_no", 100], ["contract_date", 60], ["poa_no", 100], ["poa_date", 60], ["tmc_kind", 60]]
      .forEach((f) => { r.set(f[0], L.str(b[f[0]]).slice(0, f[1])); if (["from_wh", "to_org", "contract_no", "poa_no", "tmc_kind"].indexOf(f[0]) >= 0) X.remember(tx, f[0], L.str(b[f[0]])); });
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
      it.set("acts", c.acts);
      it.set("project_name", c.project_name); it.set("name1c", c.name1c); it.set("objcode", c.objcode); it.set("stock_note", c.stock_note);
      tx.save(it);
    });
    L.log(tx, a, "request_create", "requests", r.id, "Новая заявка № " + number + " (" + clean.length + " поз.)", { items: clean });
    X.ovrSave(L, tx, g, r, "requests", r.id, "заявка № " + number + " создана");
    out = { request: r.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Внести выданное количество по позиции ----------
routerAdd("POST", "/api/vs/request/issue", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const g = X.guard(L, a, b);
  const raw = String(b.qty_issued === undefined || b.qty_issued === null ? "" : b.qty_issued).replace(",", ".").trim();
  const q = raw === "" ? 0 : Math.round(parseFloat(raw) * 1000) / 1000;
  if (isNaN(q) || q < 0) throw new BadRequestError("Выданное количество должно быть числом 0 или больше.");
  let out = null;
  $app.runInTransaction((tx) => {
    const it = tx.findRecordById("request_items", L.str(b.item));
    const r = tx.findRecordById("requests", it.getString("request"));
    if (r.getString("status") !== "open") throw new BadRequestError("Заявка закрыта — изменения невозможны.");
    const ord = it.getFloat("qty_ordered");
    const old = it.getFloat("qty_issued");
    if (Math.abs(old - q) < 1e-9) { out = { qty_issued: q }; return; }
    if (q > ord + 1e-9) X.deny(g, "Нельзя выдать больше заказанного: «" + it.getString("material") + "» заказано " + String(ord).replace(".", ",") + " " + it.getString("unit") + ", вносится " + String(q).replace(".", ","));
    X.check(g);
    it.set("qty_issued", q);
    if (L.authId(a)) it.set("issued_by", a.id);
    it.set("issued_at", L.fmt(new Date()));
    tx.save(it);
    L.log(tx, a, "request_issue", "requests", r.id,
      "Заявка № " + r.getString("number") + ": " + it.getString("material") + " — выдано " + q + " из " + ord + " " + it.getString("unit") + " (было " + old + ")", { item: it.id });
    X.ovrSave(L, tx, g, r, "requests", r.id, "заявка № " + r.getString("number") + ", выдача сверх заказа");
    out = { qty_issued: q };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Закрыть / открыть повторно / аннулировать ----------
routerAdd("POST", "/api/vs/request/status", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const b = e.requestInfo().body || {};
  const act = L.str(b.action);
  const a = L.requireRole(e, act === "close" ? L.WRITE_ROLES : ["admin", "manager"]);
  const g = X.guard(L, a, b);
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
      if (!photos.length) X.deny(g, "Для закрытия нужно фото (подписанная заявка / выданный материал).");
      const transit = tx.findRecordsByFilter("request_shipments", "(request = {:r} || requests.id ?= {:r}) && (status = 'preparing' || status = 'sent')", "", 0, 0, { r: r.id });
      if (transit.length) X.deny(g, "Есть незавершённая отгрузка (" + transit.length + "): отметьте доставку или отмените её.");
      X.check(g);
      r.set("status", "closed"); r.set("closed_at", L.fmt(new Date()));
      if (L.authId(a)) r.set("closed_by", a.id);
      r.set("close_comment", comment);
      text = "Заявка № " + r.getString("number") + " закрыта" + (short.length ? " (выдано не полностью: " + short.length + " поз.)" : " (выдано полностью)");
    } else if (act === "reopen") {
      if (st !== "closed") throw new BadRequestError("Открыть повторно можно только закрытую заявку.");
      if (!comment) throw new BadRequestError("Укажите причину повторного открытия.");
      r.set("status", "open"); r.set("closed_at", ""); r.set("closed_by", ""); r.set("close_comment", "");
      const wasUchet = r.getString("uchet_status");
      if (wasUchet) { r.set("uchet_status", ""); r.set("uchet_done_at", ""); r.set("uchet_done_by", ""); }
      text = "Заявка № " + r.getString("number") + " открыта повторно: " + comment + (wasUchet ? " (учёт сброшен)" : "");
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
    X.ovrSave(L, tx, g, r, "requests", r.id, "заявка № " + r.getString("number") + " закрыта");
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
    if (b.value && L.str(b.who)) X.remember(tx, "sign_" + key, L.str(b.who));
    L.log(tx, a, "request_sign", "requests", r.id, "Заявка № " + r.getString("number") + ": " + (b.value ? "подпись отмечена" : "подпись снята") + " — " + def[1] +
      (L.str(b.who) ? " (" + L.str(b.who) + ")" : "") + (all ? ". Все подписи собраны" : ""), {});
    out = { signed_all: all };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Отгрузка: подготовка (позиции из одной или нескольких заявок, свои этапы) ----------
const shipCreate = (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => { out = { shipment: X.createShipment(L, tx, a, b).id }; });
  return e.json(200, out);
};
routerAdd("POST", "/api/vs/request/shipment/create", shipCreate, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/shipment/create", shipCreate, $apis.requireAuth("users"));

// ---------- Отгрузка: этап выполнен / снят / добавить этап ----------
routerAdd("POST", "/api/vs/shipment/step", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("request_shipments", L.str(b.shipment));
    const st = s.getString("status");
    if (st !== "preparing" && st !== "sent") throw new BadRequestError("Отгрузка завершена — этапы изменить нельзя.");
    const steps = X.jsonArr(s, "steps");
    let text = "";
    if (L.str(b.add)) {
                if (steps.length >= 20) throw new BadRequestError("Не больше 20 этапов.");
      steps.push({ name: L.str(b.add).slice(0, 100), at: "", by: "", by_name: "" });
      X.remember(tx, "step", L.str(b.add));
      text = "добавлен этап «" + L.str(b.add) + "»";
    } else {
      const i = parseInt(b.index, 10);
      if (!(i >= 0 && i < steps.length)) throw new BadRequestError("Неизвестный этап.");
      if (b.done) { steps[i].at = L.fmt(new Date()); steps[i].by = L.authId(a); steps[i].by_name = L.userName(a); text = "этап «" + steps[i].name + "» выполнен"; }
      else { steps[i].at = ""; steps[i].by = ""; steps[i].by_name = ""; text = "этап «" + steps[i].name + "» снят"; }
    }
    s.set("steps", steps); tx.save(s);
    L.log(tx, a, "shipment_step", "requests", s.getString("request"), "Отгрузка " + s.getString("vehicle") + ": " + text, { shipment: s.id });
    out = { steps: steps };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Отгрузка: отправить / доставлено (с записью выдачи в заявки) / отменить ----------
routerAdd("POST", "/api/vs/request/shipment/action", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const g = X.guard(L, a, b);
  const act = L.str(b.action);
  let out = { ok: true };
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("request_shipments", L.str(b.shipment));
    const reqIds = X.shipRequests(s);
    const reqs = reqIds.map((id) => tx.findRecordById("requests", id));
    const r = reqs[0];
    const nums = reqs.map((x) => x.getString("number")).join(", ");
    const st = s.getString("status");
    const ids = X.jsonArr(s, "resource_ids"), resv = X.jsonArr(s, "reservation_ids");
    const head = "Отгрузка " + s.getString("vehicle") + " (заявки № " + nums + "): ";
    if (act === "send") {
      if (st !== "preparing") throw new BadRequestError("Отправить можно только подготовленную отгрузку.");
      const ph = tx.findRecordsByFilter("request_files", "shipment = {:s}", "", 1, 0, { s: s.id });
      if (!ph.length) X.deny(g, "Для отправки нужно фото погруженного материала.");
      const now = new Date(), end = new Date(now.getTime() + (s.getFloat("hours") || 4) * 3600000);
      const list = ids.map((id) => tx.findRecordById("resources", id));
      list.forEach((res) => { const c = X.conflictText(L, tx, res, now, end, ""); if (c) X.deny(g, c); });
      X.check(g);
      const col = tx.findCollectionByNameOrId("reservations");
      const names = [];
      list.forEach((res) => {
        const v = new Record(col);
        v.set("resource", res.id); v.set("qty", 1); v.set("site", r.getString("object") || "Отгрузка");
        v.set("purpose", "Отгрузка по заявке № " + nums + " (" + s.getString("vehicle") + ")");
        v.set("start", L.fmt(now)); v.set("end", L.fmt(end)); v.set("responsible", L.userName(a)); v.set("status", "in_work");
        if (L.authId(a)) v.set("created_by", a.id);
        tx.save(v); resv.push(v.id); names.push(res.getString("name"));
      });
      s.set("status", "sent"); s.set("sent_at", L.fmt(now)); s.set("reservation_ids", resv);
      if (L.authId(a)) s.set("sent_by", a.id);
      tx.save(s);
      L.log(tx, a, "shipment_send", "requests", r.id, head + "ОТПРАВЛЕНО" + (names.length ? "; заняты: " + names.join(", ") : ""), { shipment: s.id, requests: reqIds });
      X.ovrSave(L, tx, g, s, "requests", r.id, "отгрузка " + s.getString("vehicle") + " отправлена");
    } else if (act === "deliver" || act === "cancel") {
      if (act === "deliver" && st !== "sent") throw new BadRequestError("Доставку можно отметить только у отправленной отгрузки.");
      if (act === "cancel" && st !== "preparing") throw new BadRequestError("Отменить можно только подготовку; отправленную — отметьте доставку.");
      // Запись выдачи по позициям отгрузки (по подтверждению)
      const issue = act === "deliver" && Array.isArray(b.issue) ? b.issue : [];
      const lines = X.jsonArr(s, "lines");
      const todo = [];
      issue.forEach((x) => {
        const ln = lines.filter((l) => l.item === L.str(x && x.item))[0];
        if (!ln) throw new BadRequestError("Позиция не входит в эту отгрузку.");
        const q = Math.round(parseFloat(String(x.qty).replace(",", ".")) * 1000) / 1000;
        if (!(q > 0)) return;
        const it = tx.findRecordById("request_items", ln.item);
        const rq = tx.findRecordById("requests", it.getString("request"));
        if (rq.getString("status") !== "open") throw new BadRequestError("Заявка № " + rq.getString("number") + " уже не открыта — выдачу по ней записать нельзя. Снимите эту позицию.");
        const nv = Math.round((it.getFloat("qty_issued") + q) * 1000) / 1000;
        if (nv > it.getFloat("qty_ordered") + 1e-9) X.deny(g, "Заявка № " + rq.getString("number") + ", «" + it.getString("material") + "»: будет выдано " + String(nv).replace(".", ",") + " при заказе " + String(it.getFloat("qty_ordered")).replace(".", ",") + " " + it.getString("unit"));
        todo.push({ it: it, rq: rq, q: q, nv: nv });
      });
      X.check(g);
      todo.forEach((t) => {
        const old = t.it.getFloat("qty_issued");
        t.it.set("qty_issued", t.nv); if (L.authId(a)) t.it.set("issued_by", a.id); t.it.set("issued_at", L.fmt(new Date()));
        tx.save(t.it);
        L.log(tx, a, "request_issue", "requests", t.rq.id, "Заявка № " + t.rq.getString("number") + ": " + t.it.getString("material") + " — выдано " + t.nv + " из " +
          t.it.getFloat("qty_ordered") + " " + t.it.getString("unit") + " (было " + old + ", по отгрузке " + s.getString("vehicle") + ")", { item: t.it.id, shipment: s.id });
      });
      resv.forEach((id) => {
        try {
          const v = tx.findRecordById("reservations", id);
          if (v.getString("status") === "reserved" || v.getString("status") === "in_work") {
            v.set("status", "released"); v.set("released_at", L.fmt(new Date())); if (L.authId(a)) v.set("released_by", a.id); tx.save(v);
          }
        } catch (_) {}
      });
      s.set("status", act === "deliver" ? "delivered" : "cancelled");
      if (act === "deliver") { s.set("delivered_at", L.fmt(new Date())); if (L.authId(a)) s.set("delivered_by", a.id); if (todo.length) s.set("issue_done", true); }
      tx.save(s);
      L.log(tx, a, "shipment_" + act, "requests", r.id, head + (act === "deliver" ? "ДОСТАВЛЕНО, техника и люди освобождены" + (todo.length ? "; выдача записана по " + todo.length + " поз." : "") : "отгрузка отменена"), { shipment: s.id, requests: reqIds });
      X.ovrSave(L, tx, g, s, "requests", r.id, "отгрузка " + s.getString("vehicle") + " доставлена, выдача сверх заказа");
      out = { ok: true, issued: todo.length };
    } else throw new BadRequestError("Неизвестное действие.");
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Журнал: фото по заявке ----------
onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/lib.js`);
  const sh = e.record.getString("shipment");
  if (sh) {
    const s = $app.findRecordById("request_shipments", sh);
    const X = require(`${__hooks}/lib_ext.js`);
    if (X.shipRequests(s).indexOf(e.record.getString("request")) < 0) throw new BadRequestError("Фото не относится к этой заявке.");
    if (s.getString("status") !== "preparing" && s.getString("status") !== "sent") throw new BadRequestError("Отгрузка уже завершена.");
    e.record.set("kind", "shipment");
  }
  e.next();
  const kinds = { shipment: "фото отгрузки", close: "фото при закрытии", signed: "фото подписанной заявки", other: "фото" };
  L.log($app, e.auth, "request_photo", "requests", e.record.getString("request"), "Добавлено " + (kinds[e.record.getString("kind")] || "фото"), {});
}, "request_files");

// ---------- 1.3: запомнить ручной ввод (подсказки) ----------
onRecordAfterCreateSuccess((e) => { const X = require(`${__hooks}/lib_ext.js`); X.rememberRecord(e.app, e.record); e.next(); },
  "requests", "request_items", "request_shipments", "receipts", "reservations");
          
