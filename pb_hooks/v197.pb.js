/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.7 — конструктор полей форм: администратор сам добавляет, переименовывает, скрывает поля.

routerAdd("GET", "/api/vs/fields", (e) => {
  const F = require(`${__hooks}/lib197.js`);
  return e.json(200, { forms: F.FORMS, types: F.TYPES, photo_ok: F.PHOTO_OK, defs: F.defsOut($app) });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/fields/save", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib197.js`);
  const a = L.requireRole(e, ["admin"]);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const form = L.str(b.form); if (!F.FORMS[form]) throw new BadRequestError("Неизвестная форма.");
    const builtin = !!b.builtin;
    let d = null;
    if (b.id) d = tx.findRecordById("form_fields", L.str(b.id));
    else if (builtin) { try { d = tx.findFirstRecordByFilter("form_fields", "form = {:f} && key = {:k}", { f: form, k: L.str(b.key) }); } catch (_) {} }
    const isNew = !d;
    if (isNew) {
      d = new Record(tx.findCollectionByNameOrId("form_fields"));
      d.set("form", form); d.set("builtin", builtin);
      d.set("key", builtin ? L.str(b.key).replace(/[^a-z0-9_]/gi, "").slice(0, 40) : "f_" + $security.randomStringWithAlphabet(6, "abcdefghijkmnpqrstuvwxyz23456789"));
      const last = tx.findRecordsByFilter("form_fields", "form = {:f}", "-sort", 1, 0, { f: form });
      d.set("sort", last.length ? last[0].getInt("sort") + 10 : 10);
    }
    if (d.getString("form") !== form) throw new BadRequestError("Поле из другой формы.");
    const label = L.str(b.label).replace(/\s+/g, " ").trim().slice(0, 120);
    if (!label && !d.getBool("builtin")) throw new BadRequestError("Напишите название поля.");
    d.set("label", label); d.set("hint", L.str(b.hint).slice(0, 200)); d.set("required", !!b.required);
    d.set("hidden", !!b.hidden && !(d.getBool("builtin") && b.core));   // обязательные для работы программы поля не скрываются
    if (!d.getBool("builtin")) {
      const t = L.str(b.type); if (!F.TYPES[t]) throw new BadRequestError("Выберите тип поля.");
      if (t === "photo" && !F.PHOTO_OK[form]) throw new BadRequestError("Фото можно добавить только в шапку заявки или УПД.");
      if (!isNew && d.getString("type") !== t && d.getString("type")) throw new BadRequestError("Тип поля после создания не меняется — создайте новое поле.");
      d.set("type", t);
      const opts = (Array.isArray(b.options) ? b.options : String(b.options || "").split(/\n|;/)).map((x) => L.str(x).trim().slice(0, 120)).filter(Boolean).filter((v, i, A) => A.indexOf(v) === i).slice(0, 100);
      if (t === "select" && opts.length < 2) throw new BadRequestError("Для списка нужно хотя бы 2 варианта (каждый с новой строки).");
      d.set("options", t === "select" ? opts : []);
    }
    tx.save(d);
    L.log(tx, a, "fields", "form_fields", d.id, (isNew ? "Новое поле" : "Поле изменено") + ": " + F.FORMS[form] + " → «" + (label || d.getString("key")) + "»" + (d.getBool("hidden") ? " (скрыто)" : ""), {});
    out = F.defOut(d);
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/fields/delete", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib197.js`);
  const a = L.requireRole(e, ["admin"]);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const d = tx.findRecordById("form_fields", L.str(b.id));
    // своё поле удаляется из форм; уже введённые значения остаются в записях (вернуть — создать поле заново нельзя, но данные видны в истории)
    tx.delete(d);
    L.log(tx, a, "fields", "form_fields", d.id, (d.getBool("builtin") ? "Сброшены настройки поля: " : "Поле удалено: ") + F.FORMS[d.getString("form")] + " → «" + (d.getString("label") || d.getString("key")) + "»", {});
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/fields/order", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin"]);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    (Array.isArray(b.ids) ? b.ids : []).slice(0, 300).forEach((id, i) => { const d = tx.findRecordById("form_fields", String(id)); d.set("sort", (i + 1) * 10); tx.save(d); });
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Фото / файл в своём поле (шапка заявки, УПД) ----------
routerAdd("POST", "/api/vs/fields/file", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib197.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "skk"]);
  const b = e.requestInfo().body || {};
  const form = L.str(b.form); if (!F.PHOTO_OK[form]) throw new BadRequestError("Неверная форма.");
  const col = form === "request" ? "requests" : "upd_docs";
  $app.findRecordById(col, L.str(b.rec));
  let d = null; try { d = $app.findFirstRecordByFilter("form_fields", "form = {:f} && key = {:k} && type = 'photo'", { f: form, k: L.str(b.key) }); } catch (_) {}
  if (!d) throw new BadRequestError("Нет такого поля.");
  let files = []; try { files = e.findUploadedFiles("file") || []; } catch (_) {}
  if (!files.length) throw new BadRequestError("Нет файла.");
  const out = [];
  $app.runInTransaction((tx) => {
    files.slice(0, 10).forEach((f) => {
      const r = new Record(tx.findCollectionByNameOrId("field_files"));
      r.set("form", form); r.set("rec", L.str(b.rec)); r.set("key", d.getString("key")); r.set("file", f); if (L.authId(a)) r.set("uploaded_by", a.id);
      tx.save(r); out.push(r.id);
    });
    L.log(tx, a, "field_file", col, L.str(b.rec), "Файлы в поле «" + d.getString("label") + "»: " + files.length, {});
  });
  return e.json(200, { ids: out });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/fields/file_delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "skk"]);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => { const r = tx.findRecordById("field_files", L.str(b.id)); tx.delete(r); L.log(tx, a, "field_file", "field_files", r.id, "Удалён файл из своего поля", {}); });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
