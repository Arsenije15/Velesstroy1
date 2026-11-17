/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.32 — «Склад Велесстрой Монтаж»: позиции, движение (остаток считает сервер), импорт таблиц
onRecordCreateRequest((e) => {
  const M = require(`${__hooks}/lib1932.js`);
  e.record.set("qty", 0);
  if (!e.record.getString("name").trim()) throw new BadRequestError("Укажите наименование.");
  M.prep(e.record);
  try { $app.findFirstRecordByFilter("mz_items", "key = {:k}", { k: e.record.getString("key") }); throw new BadRequestError("Такая позиция уже есть в этом разделе (то же наименование и размер)."); } catch (err) { if (err instanceof BadRequestError) throw err; }
  return e.next();
}, "mz_items");
onRecordUpdateRequest((e) => {
  const M = require(`${__hooks}/lib1932.js`);
  M.prep(e.record);
  try { const d = $app.findFirstRecordByFilter("mz_items", "key = {:k} && id != {:i}", { k: e.record.getString("key"), i: e.record.id }); if (d) throw new BadRequestError("Такая позиция уже есть в этом разделе."); } catch (err) { if (err instanceof BadRequestError) throw err; }
  return e.next();
}, "mz_items");
// движение: приход / выдача / возврат / списание / пересчёт (инвентаризация) — остаток считает сервер
onRecordCreateRequest((e) => {
  const M = require(`${__hooks}/lib1932.js`);
  const it = $app.findRecordById("mz_items", e.record.getString("item"));
  const kind = e.record.getString("kind");
  const q = M.num(e.record.get("qty"));
  if (kind === "count") { if (!(q >= 0)) throw new BadRequestError("Укажите фактическое количество (0 или больше)."); }
  else if (!(q > 0)) throw new BadRequestError("Укажите количество больше нуля.");
  const cur = it.getFloat("qty");
  if ((kind === "out" || kind === "wo") && q > cur + 1e-9) throw new BadRequestError("На складе только " + String(cur).replace(".", ",") + " " + it.getString("unit") + ".");
  if (kind === "out" && !e.record.getString("who").trim()) throw new BadRequestError("Укажите, кому выдано (бригада / ФИО).");
  if (kind === "wo" && !e.record.getString("note").trim()) throw new BadRequestError("Укажите причину списания.");
  if (it.getString("section") === "arm" && kind === "in") {
    const ph = e.record.getUnsavedFiles("photos").length, dc = e.record.getUnsavedFiles("doc_files").length;
    if (!ph || !dc) throw new BadRequestError("Арматура: приход сохраняется только с фото груза и фото/сканом накладной.");
    if (!e.record.getString("doc_no").trim()) throw new BadRequestError("Арматура: укажите № накладной.");
  }
  const nq = Math.round((kind === "count" ? q : kind === "in" || kind === "ret" ? cur + q : cur - q) * 1000) / 1000;
  e.record.set("qty", q); e.record.set("balance", nq);
  e.next();
  const fresh = $app.findRecordById("mz_items", it.id); fresh.set("qty", nq); $app.saveNoValidate(fresh);
}, "mz_moves");
routerAdd("POST", "/api/vs/mz/import", (e) => {
  const M = require(`${__hooks}/lib1932.js`);
  const a = M.mzWriter(e);
  const b = e.requestInfo().body || {};
  const SEC = ["arm", "scaf", "tool", "cons", "siz", "mat"];
  const sec = SEC.indexOf(String(b.section)) >= 0 ? String(b.section) : "";
  if (!sec) throw new BadRequestError("Не указан раздел.");
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000);
  const out = { created: 0, updated: 0, counted: 0 };
  $app.runInTransaction((tx) => {
    const col = tx.findCollectionByNameOrId("mz_items"), mc = tx.findCollectionByNameOrId("mz_moves");
    rows.forEach((r) => {
      const name = String(r.name || "").replace(/\s+/g, " ").trim().slice(0, 500); if (!name) return;
      const size = String(r.size || "").replace(/\s+/g, " ").trim().slice(0, 100);
      const key = M.keyOf(sec, name, size);
      let it = null; try { it = tx.findFirstRecordByFilter("mz_items", "key = {:k}", { k: key }); } catch (_) {}
      const isNew = !it;
      if (isNew) { it = new Record(col); it.set("section", sec); it.set("name", name); it.set("size", size); it.set("qty", 0); it.set("created_by", a.id); }
      if (r.grp) it.set("grp", String(r.grp).slice(0, 300)); if (r.unit) it.set("unit", String(r.unit).slice(0, 30));
      if (r.code) it.set("code", String(r.code).slice(0, 100)); if (r.place) it.set("place", String(r.place).slice(0, 200));
      const mn = M.num(r.min); if (mn >= 0) it.set("min_qty", mn);
      M.prep(it); tx.save(it); if (isNew) out.created++; else out.updated++;
      const q = M.num(r.qty);
      if (q >= 0 && Math.abs(q - it.getFloat("qty")) > 1e-9) {
        const m = new Record(mc); m.set("item", it.id); m.set("kind", "count"); m.set("qty", q); m.set("balance", q);
        m.set("note", ("Таблица: " + String(b.file_name || "")).slice(0, 1000)); m.set("created_by", a.id); tx.save(m);
        it.set("qty", q); tx.saveNoValidate(it); out.counted++;
      }
    });
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/mz/item/remove", (e) => {
  const M = require(`${__hooks}/lib1932.js`);
  M.mzWriter(e);
  const b = e.requestInfo().body || {};
  const it = $app.findRecordById("mz_items", String(b.id || ""));
  if (Math.abs(it.getFloat("qty")) > 1e-9) throw new BadRequestError("Сначала остаток должен быть 0 (спишите или пересчитайте).");
  $app.delete(it);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
