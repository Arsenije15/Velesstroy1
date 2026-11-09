/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.2 — журнал актов несоответствия: загрузка из Excel, поиск по УПД и поставщику,
// автоматическое предупреждение на приёмке «нужна служебная записка».

// ---------- Загрузка (частями). Повторная загрузка того же файла обновляет записи, лишние удаляются в конце ----------
routerAdd("POST", "/api/vs/acts/import", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  const b = e.requestInfo().body || {};
  const imp = L.str(b.import_id);
  if (!/^[a-z0-9]{6,40}$/.test(imp)) throw new BadRequestError("Неверный идентификатор загрузки.");
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length > 1000) throw new BadRequestError("Слишком много строк в одной части.");
  let created = 0, updated = 0, removed = 0, total = 0;
  $app.runInTransaction((tx) => {
    const col = tx.findCollectionByNameOrId("acts");
    rows.forEach((r) => {
      const key = L.str(r.row_key);
      if (!key) return;
      let rec = null;
      try { rec = tx.findFirstRecordByFilter("acts", "row_key = {:k}", { k: key }); } catch (_) {}
      if (!rec) { rec = new Record(col); rec.set("row_key", key); created++; } else updated++;
      const s = (k, max) => L.str(r[k]).slice(0, max || 1000);
      rec.set("act_no", s("act_no", 60)); rec.set("act_date", s("act_date", 30));
      rec.set("supplier", s("supplier", 300)); rec.set("supplier_key", X.supplierKey(r.supplier).slice(0, 300));
      rec.set("torg", s("torg", 500)); rec.set("upd_keys", X.updKeysField(r.torg).slice(0, 1000));
      rec.set("project", s("project", 500)); rec.set("material", s("material", 1000));
      rec.set("unit", s("unit", 30)); rec.set("qty", s("qty", 40)); rec.set("reason", s("reason", 3000));
      rec.set("act_code", s("act_code", 20)); rec.set("author", s("author", 200));
      rec.set("doc_status", s("doc_status", 100)); rec.set("open", X.isOpenStatus(r.doc_status));
      rec.set("act_status", s("act_status", 100)); rec.set("closed_date", s("closed_date", 30));
      rec.set("note", s("note", 3000)); rec.set("place", s("place", 100));
      rec.set("import_id", imp);
      try { tx.save(rec); } catch (err) {
        throw new BadRequestError("Ошибка в строке акта № " + L.str(r.act_no) + " (" + key + "): " + String(err).replace(/^.*?\(/, "(").slice(0, 300));
      }
    });
    if (b.final) {
      const old = tx.findRecordsByFilter("acts", "import_id != {:i} && import_id != 'skk'", "", 0, 0, { i: imp });  // акты СКК из приложения журнал не стирает
      old.forEach((r) => tx.delete(r));
      removed = old.length;
      total = tx.findRecordsByFilter("acts", "import_id = {:i}", "", 0, 0, { i: imp }).length;
      const openN = tx.findRecordsByFilter("acts", "import_id = {:i} && open = true", "", 0, 0, { i: imp }).length;
      L.log(tx, a, "acts_import", "acts", "", "Загружен журнал актов: " + total + " строк (не устранено: " + openN + "), удалено устаревших: " + removed,
        { file: L.str(b.file_name), total: total, open: openN, removed: removed });
    }
  });
  return e.json(200, { created: created, updated: updated, removed: removed, total: total });
}, $apis.requireAuth("users"));

// ---------- Проверка УПД + поставщика по актам (подсказка в форме приёмки) ----------
routerAdd("POST", "/api/vs/acts/match", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const b = e.requestInfo().body || {};
  const acts = X.findActs($app, L.str(b.upd), L.str(b.supplier));
  return e.json(200, { acts: acts, memo_required: acts.some((x) => x.open) });
}, $apis.requireAuth("users"));

// ---------- Служебная записка по приёмке написана ----------
routerAdd("POST", "/api/vs/receipt/memo", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("receipts", L.str(b.receipt));
    if (!r.getBool("memo_required")) throw new BadRequestError("Для этой приёмки служебная записка не требуется.");
    if (r.getString("memo_done_at")) throw new BadRequestError("Служебная записка уже отмечена.");
    if (L.authId(a)) r.set("memo_done_by", a.id);
    r.set("memo_done_at", L.fmt(new Date()));
    r.set("memo_comment", L.str(b.comment));
    tx.save(r);
    L.log(tx, a, "receipt_memo", "receipts", r.id, "Служебная записка написана: УПД № " + r.getString("upd_number") + (L.str(b.comment) ? " — " + L.str(b.comment) : ""), {});
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- При создании приёмки — автоматически найти акты по УПД и поставщику ----------
onRecordCreate((e) => {
  const X = require(`${__hooks}/lib_ext.js`);
  try {
    const acts = X.findActs(e.app, e.record.getString("upd_number"), e.record.getString("supplier"));
    e.record.set("acts_found", acts);
    e.record.set("memo_required", acts.some((x) => x.open));
  } catch (err) { console.log("acts lookup failed: " + err); }
  e.next();
}, "receipts");

// ---------- Поле поиска в нижнем регистре: заполняется при каждом сохранении ----------
onRecordCreate((e) => {
  const X = require(`${__hooks}/lib_ext.js`);
  e.record.set("search_lc", X.searchText(e.record.collection().name, e.record));
  e.next();
}, "requests", "request_items", "acts", "receipts", "activity_log");
onRecordUpdate((e) => {
  const X = require(`${__hooks}/lib_ext.js`);
  e.record.set("search_lc", X.searchText(e.record.collection().name, e.record));
  e.next();
}, "requests", "request_items", "acts", "receipts");
        
