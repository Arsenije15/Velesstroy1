/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY — серверная логика: проверка УПД, согласование, чек-лист, бронирование, журнал.
// Все важные действия выполняются только здесь (прямая запись в эти таблицы запрещена правилами базы).

// ---------- 1. Проверка УПД (создаёт запись приёмки) ----------
routerAdd("POST", "/api/vs/upd/check", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const upd = L.str(b.upd);
  if (!L.normUpd(upd)) throw new BadRequestError("Введите номер УПД.");
  const warehouse = L.isSuper(a) ? "" : a.getString("warehouse");
  let out = null;
  $app.runInTransaction((tx) => {
    const norm = L.normUpd(upd);
    // Открытая приёмка по этому УПД уже есть — продолжаем её, а не создаём дубль
    const open = tx.findRecordsByFilter("receipts",
      "upd_norm = {:u} && (status = 'pending_approval' || status = 'in_progress' || status = 'nonconformity')", "-created", 1, 0, { u: norm });
    if (open.length) { out = { receipt: open[0].id, existing: true, result: open[0].getString("check_result") }; return; }
    const ev = L.evaluate(tx, { upd: upd, supplier: b.supplier, sender: b.sender }, warehouse);
    const prev = tx.findRecordsByFilter("receipts", "upd_norm = {:u} && (status = 'completed' || status = 'completed_remarks')", "-created", 1, 0, { u: norm });
    const r = new Record(tx.findCollectionByNameOrId("receipts"));
    r.set("upd_number", upd); r.set("upd_norm", norm);
    r.set("supplier", L.str(b.supplier)); r.set("sender", L.str(b.sender)); r.set("vehicle", L.str(b.vehicle));
    r.set("check_result", ev.result);
    r.set("rule_ids", ev.rules);
    r.set("instruction", ev.instruction);
    r.set("approver_role", ev.approver);
    r.set("warehouse", warehouse);
    if (L.authId(a)) r.set("storekeeper", a.id);
    const st = { green: "in_progress", red: "denied", yellow: "pending_approval", notfound: "pending_approval" }[ev.result];
    r.set("status", st);
    if (st === "denied") r.set("finished_at", L.fmt(new Date()));
    tx.save(r);
    if (st === "in_progress") L.createChecklist(tx, r);
    const label = { green: "РАЗРЕШЕНА", red: "ЗАПРЕЩЕНА", yellow: "ТРЕБУЕТСЯ СОГЛАСОВАНИЕ", notfound: "УПД НЕ НАЙДЕН" }[ev.result];
    L.log(tx, a, "upd_check", "receipts", r.id, "Проверка УПД № " + upd + ": " + label, { result: ev.result, rules: ev.rules });
    out = { receipt: r.id, existing: false, result: ev.result,
      warning: prev.length ? "Внимание: УПД № " + upd + " уже был принят ранее (" + prev[0].getString("finished_at").slice(0, 16) + " UTC)." : "" };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- 2. Запрос на согласование ----------
routerAdd("POST", "/api/vs/approval/request", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("receipts", L.str(b.receipt));
    if (r.getString("status") !== "pending_approval") throw new BadRequestError("Для этой приёмки согласование не требуется.");
    const pend = tx.findRecordsByFilter("approvals", "receipt = {:r} && status = 'pending'", "", 1, 0, { r: r.id });
    if (pend.length) throw new ApiError(409, "Запрос на согласование уже отправлен и ожидает решения.", {});
    const ap = new Record(tx.findCollectionByNameOrId("approvals"));
    ap.set("receipt", r.id);
    ap.set("kind", r.getString("check_result") === "notfound" ? "notfound" : "approval");
    if (L.authId(a)) ap.set("requested_by", a.id);
    ap.set("request_comment", L.str(b.comment));
    ap.set("approver_role", r.getString("approver_role") || "manager");
    ap.set("status", "pending");
    tx.save(ap);
    L.log(tx, a, "approval_request", "receipts", r.id, "Запрос на согласование приёмки УПД № " + r.getString("upd_number"), { comment: L.str(b.comment) });
    out = { approval: ap.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- 3. Решение по согласованию (руководитель / администратор) ----------
routerAdd("POST", "/api/vs/approval/decide", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  const b = e.requestInfo().body || {};
  const decision = L.str(b.decision);
  const comment = L.str(b.comment);
  if (decision !== "approve" && decision !== "reject") throw new BadRequestError("Неизвестное решение.");
  if (!comment) throw new BadRequestError("Укажите обоснование решения.");
  let out = null;
  $app.runInTransaction((tx) => {
    const ap = tx.findRecordById("approvals", L.str(b.approval));
    if (ap.getString("status") !== "pending") throw new ApiError(409, "Решение по этому запросу уже принято.", {});
    if (ap.getString("approver_role") === "admin" && !L.isSuper(a) && L.role(a) !== "admin")
      throw new ForbiddenError("Это согласование может дать только администратор.");
    const r = tx.findRecordById("receipts", ap.getString("receipt"));
    const kind = ap.getString("kind");
    if (decision === "approve" && kind !== "nonconformity") {
      // Повторная проверка по актуальной базе: если правило успело стать запретом — согласовать нельзя
      const ev = L.evaluate(tx, { upd: r.getString("upd_number"), supplier: r.getString("supplier"), sender: r.getString("sender") }, r.getString("warehouse"));
      if (ev.result === "red") throw new ApiError(409, "Согласование невозможно: по актуальной базе приёмка ЗАПРЕЩЕНА. " + ev.instruction, {});
    }
    ap.set("status", decision === "approve" ? "approved" : "rejected");
    if (L.authId(a)) ap.set("decided_by", a.id);
    ap.set("decided_at", L.fmt(new Date()));
    ap.set("decision_comment", comment);
    tx.save(ap);
    if (kind === "nonconformity") {
      if (r.getString("status") !== "nonconformity") throw new BadRequestError("Приёмка не в статусе несоответствия.");
      r.set("status", decision === "approve" ? "in_progress" : "rejected");
      r.set("nc_decision", (decision === "approve" ? "Разрешено принять с замечаниями: " : "В приёмке отказано: ") + comment);
    } else {
      if (r.getString("status") !== "pending_approval") throw new BadRequestError("Приёмка не ожидает согласования.");
      r.set("status", decision === "approve" ? "in_progress" : "rejected");
    }
    if (decision === "reject") r.set("finished_at", L.fmt(new Date()));
    tx.save(r);
    if (decision === "approve") L.createChecklist(tx, r);
    L.log(tx, a, decision === "approve" ? "approval_approved" : "approval_rejected", "receipts", r.id,
      (decision === "approve" ? "Согласовано" : "Отказано") + ": УПД № " + r.getString("upd_number") + " — " + comment, { kind: kind });
    out = { status: r.getString("status") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- 4. Пункт чек-листа ----------
routerAdd("POST", "/api/vs/checklist/set", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const it = tx.findRecordById("checklist_items", L.str(b.item));
    const r = tx.findRecordById("receipts", it.getString("receipt"));
    if (r.getString("status") !== "in_progress") throw new BadRequestError("Чек-лист можно заполнять только в приёмке со статусом «В работе».");
    const done = !!b.done;
    it.set("done", done);
    if (b.comment !== undefined) it.set("comment", L.str(b.comment));
    if (done) { it.set("done_at", L.fmt(new Date())); if (L.authId(a)) it.set("done_by", a.id); }
    else { it.set("done_at", ""); it.set("done_by", ""); }
    tx.save(it);
    L.log(tx, a, done ? "check_done" : "check_undone", "receipts", r.id,
      (done ? "Выполнено: " : "Отменено: ") + it.getString("title") + " (УПД № " + r.getString("upd_number") + ")", { item: it.id, comment: it.getString("comment") });
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- 5. Данные приёмки (количество, повреждения, примечание) ----------
routerAdd("POST", "/api/vs/receipt/update", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("receipts", L.str(b.receipt));
    const st = r.getString("status");
    if (st !== "in_progress" && st !== "pending_approval") throw new BadRequestError("Приёмка закрыта или остановлена — изменения невозможны.");
    const ch = {};
    ["qty_doc", "qty_fact", "damage", "notes"].forEach((k) => {
      if (b[k] !== undefined && L.str(b[k]) !== r.getString(k)) { ch[k] = L.str(b[k]); r.set(k, L.str(b[k])); }
    });
    if (!Object.keys(ch).length) return;
    tx.save(r);
    L.log(tx, a, "receipt_update", "receipts", r.id, "Изменены данные приёмки УПД № " + r.getString("upd_number"), ch);
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- 6. Обнаружено несоответствие ----------
routerAdd("POST", "/api/vs/receipt/nonconformity", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const d = L.str(b.description);
  if (!d) throw new BadRequestError("Опишите несоответствие.");
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("receipts", L.str(b.receipt));
    if (r.getString("status") !== "in_progress") throw new BadRequestError("Несоответствие можно отметить только в приёмке «В работе».");
    r.set("status", "nonconformity"); r.set("nc_flag", true);
    r.set("nc_description", (r.getString("nc_description") ? r.getString("nc_description") + "\n" : "") + d);
    ["qty_doc", "qty_fact", "damage"].forEach((k) => { if (b[k] !== undefined && L.str(b[k])) r.set(k, L.str(b[k])); });
    tx.save(r);
    const ap = new Record(tx.findCollectionByNameOrId("approvals"));
    ap.set("receipt", r.id); ap.set("kind", "nonconformity");
    if (L.authId(a)) ap.set("requested_by", a.id);
    ap.set("request_comment", d); ap.set("approver_role", "manager"); ap.set("status", "pending");
    tx.save(ap);
    L.log(tx, a, "nonconformity", "receipts", r.id, "ОБНАРУЖЕНО НЕСООТВЕТСТВИЕ: УПД № " + r.getString("upd_number") + " — " + d,
      { qty_doc: r.getString("qty_doc"), qty_fact: r.getString("qty_fact"), damage: r.getString("damage") });
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- 7. Завершить приёмку ----------
routerAdd("POST", "/api/vs/receipt/complete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("receipts", L.str(b.receipt));
    const st = r.getString("status");
    if (st === "nonconformity") throw new BadRequestError("Приёмку нельзя завершить: обнаружено несоответствие, ожидается решение руководителя.");
    if (st !== "in_progress") throw new BadRequestError("Приёмку в этом статусе завершить нельзя.");
    const open = tx.findRecordsByFilter("checklist_items", "receipt = {:r} && required = true && done = false", "sort", 0, 0, { r: r.id });
    if (open.length) throw new BadRequestError("Не выполнены обязательные пункты чек-листа: " + open.map((x) => "«" + x.getString("title") + "»").join(", "));
    const total = tx.findRecordsByFilter("checklist_items", "receipt = {:r}", "", 0, 0, { r: r.id });
    if (!total.length) throw new BadRequestError("Чек-лист пуст — завершение невозможно.");
    r.set("status", r.getBool("nc_flag") ? "completed_remarks" : "completed");
    r.set("finished_at", L.fmt(new Date()));
    if (L.authId(a)) r.set("storekeeper", a.id);
    tx.save(r);
    L.log(tx, a, "receipt_complete", "receipts", r.id,
      "Приёмка завершена: УПД № " + r.getString("upd_number") + (r.getBool("nc_flag") ? " (с замечаниями)" : ""), {});
    out = { status: r.getString("status") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- 8. Бронирование ресурса ----------
routerAdd("POST", "/api/vs/reserve", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const s = L.parse(b.start), en = L.parse(b.end);
  if (!s || !en) throw new BadRequestError("Укажите дату и время начала и окончания.");
  if (en <= s) throw new BadRequestError("Время окончания должно быть позже начала.");
  if (en <= new Date()) throw new BadRequestError("Время окончания уже прошло.");
  if (!L.str(b.purpose)) throw new BadRequestError("Укажите назначение работ.");
  if (!L.str(b.site)) throw new BadRequestError("Укажите объект / место работ.");
  let out = null;
  $app.runInTransaction((tx) => {
    const res = tx.findRecordById("resources", L.str(b.resource));
    if (res.getBool("archived")) throw new BadRequestError("Ресурс списан.");
    if (res.getBool("unavailable")) throw new ApiError(409, "Ресурс НЕДОСТУПЕН: " + (res.getString("unavailable_reason") || "без указания причины"), {});
    const qty = 1;
    L.conflictCheck(tx, res, s, en, "");
    const r = new Record(tx.findCollectionByNameOrId("reservations"));
    r.set("resource", res.id); r.set("qty", qty);
    r.set("site", L.str(b.site)); r.set("purpose", L.str(b.purpose));
    r.set("start", L.fmt(s)); r.set("end", L.fmt(en));
    r.set("responsible", L.str(b.responsible) || L.userName(a)); r.set("comment", L.str(b.comment));
    r.set("status", b.start_now ? "in_work" : "reserved");
    if (L.authId(a)) r.set("created_by", a.id);
    tx.save(r);
    L.log(tx, a, "reserve", "resources", res.id,
      "Бронь: " + res.getString("name") + " — " + r.getString("purpose") + " (" + r.getString("site") + ")",
      { reservation: r.id, start: r.getString("start"), end: r.getString("end") });
    out = { reservation: r.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- 9. Действия с бронью: выдать в работу, освободить, отменить, изменить время ----------
routerAdd("POST", "/api/vs/reservation/action", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const act = L.str(b.action);
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("reservations", L.str(b.reservation));
    const res = tx.findRecordById("resources", r.getString("resource"));
    const st = r.getString("status");
    if (st !== "reserved" && st !== "in_work") throw new BadRequestError("Бронь уже закрыта.");
    let text = "";
    if (act === "start") {
      if (st !== "reserved") throw new BadRequestError("Ресурс уже в работе.");
      if (res.getBool("unavailable")) throw new ApiError(409, "Ресурс НЕДОСТУПЕН — выдача невозможна.", {});
      r.set("status", "in_work"); text = "Выдано в работу";
    } else if (act === "release") {
      r.set("status", "released"); r.set("released_at", L.fmt(new Date()));
      if (L.authId(a)) r.set("released_by", a.id);
      text = "Освобождено";
    } else if (act === "cancel") {
      if (st !== "reserved") throw new BadRequestError("Ресурс в работе — его нужно освободить, а не отменять бронь.");
      r.set("status", "cancelled"); r.set("released_at", L.fmt(new Date()));
      if (L.authId(a)) r.set("released_by", a.id);
      text = "Бронь отменена";
    } else if (act === "extend") {
      const en = L.parse(b.end);
      const s = L.parse(r.getString("start"));
      if (!en || en <= s || en <= new Date()) throw new BadRequestError("Неверное новое время окончания.");
      L.conflictCheck(tx, res, s, en, r.id);
      text = "Время изменено: до " + L.fmt(en).slice(0, 16) + " UTC (было до " + r.getString("end").slice(0, 16) + " UTC)";
      r.set("end", L.fmt(en));
    } else throw new BadRequestError("Неизвестное действие.");
    tx.save(r);
    L.log(tx, a, "reservation_" + act, "resources", res.id, text + ": " + res.getString("name") + " — " + r.getString("purpose"), { reservation: r.id });
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- 10. Статус ресурса (доступен / недоступен) ----------
routerAdd("POST", "/api/vs/resource/status", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const res = tx.findRecordById("resources", L.str(b.resource));
    const un = !!b.unavailable;
    if (un) {
      const work = L.activeReservations(tx, res.id, "").filter((x) => x.getString("status") === "in_work");
      if (work.length) throw new ApiError(409, "Ресурс сейчас в работе — сначала освободите его.", {});
      if (!L.str(b.reason)) throw new BadRequestError("Укажите причину недоступности.");
    }
    res.set("unavailable", un); res.set("unavailable_reason", un ? L.str(b.reason) : "");
    tx.save(res);
    L.log(tx, a, "resource_status", "resources", res.id,
      res.getString("name") + ": " + (un ? "НЕДОСТУПЕН — " + L.str(b.reason) : "снова доступен"), {});
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- 11. Тестовые данные (только администратор) ----------
routerAdd("POST", "/api/vs/demo", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin"]);
  const b = e.requestInfo().body || {};
  const act = L.str(b.action);
  let out = {};
  $app.runInTransaction((tx) => {
    if (act === "create") {
      if (tx.findRecordsByFilter("resources", "demo = true", "", 1, 0).length) throw new ApiError(409, "Тестовые данные уже созданы.", {});
      const uc = tx.findCollectionByNameOrId("users");
      const pw = "Test12345";
      [["sklad1", "Кладовщик Иванов", "storekeeper"], ["sklad2", "Кладовщик Петров", "storekeeper"],
       ["ruk1", "Руководитель Сидоров", "manager"], ["view1", "Наблюдатель Орлов", "viewer"]].forEach((u) => {
        let rec = null;
        try { rec = tx.findFirstRecordByFilter("users", "username = {:u}", { u: u[0] }); } catch (_) {}
        if (!rec) { rec = new Record(uc); rec.set("username", u[0]); rec.set("email", u[0] + "@velesstroy.test"); }
        rec.set("name", u[1]); rec.set("role", u[2]); rec.set("active", true); rec.set("demo", true);
        rec.setPassword(pw);
        tx.save(rec);
      });
      const rc = tx.findCollectionByNameOrId("rules");
      [["12345", "ООО Пример", "", "Приёмка запрещена. Отсутствует необходимая документация.", "Нет сертификатов", "deny"],
       ["", "ООО Стройматериалы", "", "Приёмка возможна только после согласования с руководством компании.", "Претензии по прошлым поставкам", "approval"],
       ["67890", "", "", "Приёмка разрешена.", "", "allow"]].forEach((x) => {
        const r = new Record(rc);
        r.set("upd_number", x[0]); r.set("supplier", x[1]); r.set("sender", x[2]); r.set("description", x[3]); r.set("reason", x[4]);
        r.set("action", x[5]); r.set("approver_role", "manager"); r.set("active", true); r.set("version", 1); r.set("demo", true);
        if (L.authId(a)) r.set("created_by", a.id);
        tx.save(r);
      });
      const res = tx.findCollectionByNameOrId("resources");
      [["crane", "Кран № 1 (гусеничный)", "КР-001", 1, "шт"], ["crane", "Кран № 2 (автокран 25 т)", "КР-002", 1, "шт"],
       ["crane", "Погрузчик № 1", "ПГ-001", 1, "шт"], ["crane", "Манипулятор КМУ 7 т", "КМ-001", 1, "шт"],
       ["crane", "Телескопический погрузчик", "ТП-001", 1, "шт"],
       ["worker", "Алексеев Сергей", "ТН-101", 1, ""], ["worker", "Борисов Дмитрий", "ТН-102", 1, ""],
       ["worker", "Васильев Олег", "ТН-103", 1, ""], ["worker", "Григорьев Иван", "ТН-104", 1, ""]].forEach((x) => {
        const r = new Record(res);
        r.set("category", x[0]); r.set("name", x[1]); r.set("inv_number", x[2]); r.set("qty_total", x[3]); r.set("unit", x[4]); r.set("demo", true);
        tx.save(r);
      });
      L.log(tx, a, "demo_create", "system", "", "Созданы тестовые данные и учётные записи (пароль " + pw + ")", {});
      out = { password: pw };
    } else if (act === "remove") {
      tx.findRecordsByFilter("resources", "demo = true", "", 0, 0).forEach((r) => tx.delete(r));
      tx.findRecordsByFilter("rules", "demo = true", "", 0, 0).forEach((r) => { r.set("active", false); tx.save(r); });
      tx.findRecordsByFilter("users", "demo = true", "", 0, 0).forEach((r) => { r.set("active", false); tx.save(r); });
      L.log(tx, a, "demo_remove", "system", "", "Тестовые ресурсы удалены, тестовые правила и учётные записи отключены", {});
      out = { ok: true };
    } else throw new BadRequestError("Неизвестное действие.");
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Журнал для изменений через стандартный API (правила, ресурсы, пользователи, чек-лист, фото) ----------
onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/lib.js`);
  const c = e.collection.name;
  if (c === "rules") {
    if (L.authId(e.auth)) { e.record.set("created_by", e.auth.id); e.record.set("updated_by", e.auth.id); }
    e.record.set("version", 1);
    if (!e.record.getString("upd_number") && !e.record.getString("supplier") && !e.record.getString("sender"))
      throw new BadRequestError("Укажите хотя бы одно: номер УПД, поставщика или отправителя.");
  }
  if (c === "rules" || c === "resources" || c === "users") e.record.set("demo", false);
  e.next();
  const name = e.record.getString("name") || e.record.getString("title") || e.record.getString("upd_number") || e.record.getString("supplier") || e.record.id;
  const ru = { rules: "Новое правило", resources: "Новый ресурс", users: "Новый пользователь", checklist_templates: "Новый пункт чек-листа", attachments: "Добавлено фото/документ" }[c] || c;
  L.log($app, e.auth, "create", c === "attachments" ? "receipts" : c, c === "attachments" ? e.record.getString("receipt") : e.record.id,
    ru + ": " + name + (c === "users" ? " (" + (L.ROLE_RU[e.record.getString("role")] || "") + ")" : ""), {});
}, "rules", "resources", "users", "checklist_templates", "attachments");

onRecordUpdateRequest((e) => {
  const L = require(`${__hooks}/lib.js`);
  const c = e.collection.name;
  const old = e.record.original();
  if (c === "users" && L.authId(e.auth) && L.authId(e.auth) === e.record.id) {
    if (!e.record.getBool("active") || e.record.getString("role") !== "admin")
      throw new BadRequestError("Нельзя отключить себя или снять с себя роль администратора.");
  }
  if (c === "rules") {
    e.record.set("version", (old.getInt("version") || 1) + 1);
    if (L.authId(e.auth)) e.record.set("updated_by", e.auth.id);
    e.record.set("created_by", old.getString("created_by"));
  }
  if (c === "rules" || c === "resources" || c === "users") e.record.set("demo", old.getBool("demo"));
  e.next();
  const changes = {};
  e.collection.fields.forEach((f) => {
    const n = f.name;
    if (["updated", "password", "tokenKey", "version", "updated_by"].indexOf(n) >= 0) return;
    const ov = old.getString(n), nv = e.record.getString(n);
    if (ov !== nv) changes[n] = { "было": ov, "стало": nv };
  });
  if (!Object.keys(changes).length) return;
  const name = e.record.getString("name") || e.record.getString("title") || e.record.getString("upd_number") || e.record.getString("supplier");
  const ru = { rules: "Изменено правило", resources: "Изменён ресурс", users: "Изменён пользователь", checklist_templates: "Изменён пункт чек-листа" }[c] || c;
  L.log($app, e.auth, "update", c, e.record.id, ru + ": " + name + (c === "rules" ? " (версия " + e.record.getInt("version") + ")" : ""), changes);
}, "rules", "resources", "users", "checklist_templates");
      
