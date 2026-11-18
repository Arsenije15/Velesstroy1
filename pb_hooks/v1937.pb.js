/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.37 — «Монтаж»: нормативы (расход на работы, нормы выдачи); пример — пока нет своих и пример не убран
onRecordCreateRequest((e) => { const N = require(`${__hooks}/lib1937.js`); N.prep(e.record);
  if (!e.record.getString("item")) { const it = N.findItem($app, e.record.getString("name"), e.record.getString("size")); if (it) e.record.set("item", it.id); }
  if (e.record.getString("kind") === "work" && !e.record.getString("work").trim()) throw new BadRequestError("Укажите вид работ.");
  e.next(); const X = require(`${__hooks}/lib_ext.js`); try { X.remember($app, "mz_work", e.record.getString("work")); X.remember($app, "mz_wunit", e.record.getString("work_unit")); } catch (_) {} }, "mz_norms");
onRecordUpdateRequest((e) => { const N = require(`${__hooks}/lib1937.js`); N.prep(e.record); e.next(); }, "mz_norms");
routerAdd("POST", "/api/vs/mz/norms/ensure", (e) => {
  const M = require(`${__hooks}/lib1932.js`), D = require(`${__hooks}/lib1933.js`), N = require(`${__hooks}/lib1937.js`);
  const a = M.mzWriter(e); let n = 0;
  $app.runInTransaction((tx) => {
    const st = D.stateGet(tx).d; if (st.cleared) return;
    if (tx.findRecordsByFilter("mz_norms", "id != ''", "", 1, 0).length) return;
    n = N.seed(tx, a, true);
  });
  return e.json(200, { seeded: n });
}, $apis.requireAuth("users"));
// загрузка таблицы нормативов: строки уже разобраны на телефоне / компьютере
routerAdd("POST", "/api/vs/mz/norms/import", (e) => {
  const M = require(`${__hooks}/lib1932.js`), D = require(`${__hooks}/lib1933.js`), N = require(`${__hooks}/lib1937.js`);
  const a = M.mzWriter(e); const b = e.requestInfo().body || {};
  const kind = b.kind === "issue" ? "issue" : "work"; const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 3000);
  if (!rows.length) throw new BadRequestError("В таблице нет строк с нормами.");
  const out = { created: 0, updated: 0, skipped: 0, demo_cleared: false };
  $app.runInTransaction((tx) => {
    const st = D.stateGet(tx).d; if (st.seeded && !st.cleared) { D.demoClear(tx); out.demo_cleared = true; }
    tx.findRecordsByFilter("mz_norms", "demo = true", "", 0, 0).forEach((r) => tx.delete(r));
    const col = tx.findCollectionByNameOrId("mz_norms");
    rows.forEach((x) => {
      const name = String(x.name || "").replace(/\s+/g, " ").trim(), size = String(x.size || "").replace(/\s+/g, " ").trim(), work = String(x.work || "").replace(/\s+/g, " ").trim();
      const q = parseFloat(String(x.qty == null ? "" : x.qty).replace(",", "."));
      if (!name || !(q >= 0) || (kind === "work" && !work)) { out.skipped++; return; }
      let r = null;
      try { const L = tx.findRecordsByFilter("mz_norms", kind === "work" ? "kind = 'work' && work = {:w} && name = {:n} && size = {:s}" : "kind = 'issue' && name = {:n} && size = {:s} && per = {:p}", "", 1, 0, { w: work, n: name, s: size, p: String(x.per || "").trim() }); r = L.length ? L[0] : null; } catch (_) {}
      if (r) out.updated++; else { r = new Record(col); r.set("kind", kind); r.set("created_by", a.id); out.created++; }
      r.set("work", work); r.set("work_unit", String(x.work_unit || "").trim()); r.set("name", name); r.set("size", size); r.set("unit", String(x.unit || "").trim()); r.set("qty", q);
      r.set("period_days", parseFloat(String(x.period_days || "").replace(",", ".")) || (kind === "issue" ? 30 : 0)); r.set("per", String(x.per || "").trim()); r.set("note", String(x.note || "").trim());
      const it = N.findItem(tx, name, size); r.set("item", it ? it.id : ""); N.prep(r); tx.save(r);
    });
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
