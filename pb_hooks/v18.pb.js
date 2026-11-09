/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.8 — Склад / СКК: УПД со скана (номер, дата, поставщик, позиции), акты СКК с отметкой «устранено», отчёт.

// ---------- Прочитать УПД (файл уже загружен черновиком в upd_docs) ----------
routerAdd("POST", "/api/vs/upd/ocr", (e) => {
  const L = require(`${__hooks}/lib.js`), K = require(`${__hooks}/lib18.js`);
  const a = L.requireRole(e, K.UPD_ROLES);
  const rec = $app.findRecordById("upd_docs", L.str((e.requestInfo().body || {}).id));
  if (!L.isSuper(a) && rec.getString("uploaded_by") !== a.id) throw new ForbiddenError("Это не ваш файл.");
  if (!rec.getString("file")) throw new BadRequestError("Файл не загружен.");
  const path = $app.dataDir() + "/storage/" + rec.collection().id + "/" + rec.id + "/" + rec.getString("file");
  let txt = "";
  try { txt = toString($os.cmd("timeout", "280", "python3", `${__hooks}/ocr_upd.py`, path).output()); }
  catch (err) { throw new BadRequestError("Распознавание не запустилось на сервере (запустите install.sh ещё раз): " + String(err).slice(0, 200)); }
  let res = null;
  try { res = JSON.parse(txt); } catch (_) { throw new BadRequestError("Не удалось прочитать файл — попробуйте скан PDF или фото ровнее и крупнее."); }
  if (res.error) throw new BadRequestError(res.error);
  delete res.debug;
  const known = [];
  try {
    const rows = arrayOf(new DynamicModel({ supplier: "" }));
    $app.db().newQuery("SELECT DISTINCT supplier FROM acts WHERE supplier != '' LIMIT 800").all(rows); rows.forEach((r) => known.push(r.supplier));
    $app.findRecordsByFilter("upd_docs", "status != 'draft' && supplier != ''", "-created", 300, 0).forEach((r) => known.push(r.getString("supplier")));
    $app.findRecordsByFilter("suggestions", "field = 'supplier'", "-last", 300, 0).forEach((r) => known.push(r.getString("value")));
  } catch (_) {}
  res.known_suppliers = known;
  rec.set("ocr", res); $app.saveNoValidate(rec);
  return e.json(200, res);
}, $apis.requireAuth("users"));

// ---------- Сохранить УПД ----------
routerAdd("POST", "/api/vs/upd/save", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`), K = require(`${__hooks}/lib18.js`);
  const a = L.requireRole(e, K.UPD_ROLES);
  const b = e.requestInfo().body || {};
  const g = X.guard(L, a, b);
  let out = null;
  $app.runInTransaction((tx) => {
    const rec = tx.findRecordById("upd_docs", L.str(b.id));
    const isNew = rec.getString("status") === "draft";
    if (isNew && !L.isSuper(a) && rec.getString("uploaded_by") !== a.id) throw new ForbiddenError("Это не ваш файл.");
    const no = L.str(b.number).replace(/\s+/g, "").slice(0, 60), sup = L.str(b.supplier).slice(0, 300);
    if (!no) throw new BadRequestError("Укажите номер УПД.");
    if (!sup) throw new BadRequestError("Укажите поставщика.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(L.str(b.date))) throw new BadRequestError("Укажите дату УПД.");
    const sk = X.supplierKey(sup);
    const dup = tx.findRecordsByFilter("upd_docs", "status != 'draft' && id != {:i} && number = {:n}", "", 0, 0, { i: rec.id, n: no })
      .filter((r) => X.supplierMatch(sk, r.getString("supplier_key")));
    if (dup.length) X.deny(g, "УПД № " + no + " от «" + dup[0].getString("supplier") + "» уже загружен (" + dup[0].getString("date") + ").");
    X.check(g);
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((x) => ({
      code: L.str(x.code).slice(0, 60), name: L.str(x.name).slice(0, 1000), unit: L.str(x.unit).slice(0, 20),
      qty: K.num(x.qty), price: K.num(x.price), sum: K.num(x.sum), total: K.num(x.total),
      pid: L.str(x.pid).slice(0, 60), objcode: L.str(x.objcode).slice(0, 120), section: L.str(x.section).slice(0, 120) })).filter((x) => x.name);
    rec.set("number", no); rec.set("date", L.str(b.date)); rec.set("supplier", sup); rec.set("supplier_key", sk);
    rec.set("inn", L.str(b.inn).replace(/\D/g, "").slice(0, 12)); rec.set("kpp", L.str(b.kpp).replace(/\D/g, "").slice(0, 9));
    rec.set("basis", L.str(b.basis).slice(0, 500)); rec.set("spec", L.str(b.spec).slice(0, 40));
    rec.set("total_nt", K.num(b.total_nt)); rec.set("total", K.num(b.total)); rec.set("items", items); rec.set("note", L.str(b.note).slice(0, 2000));
    if (isNew) rec.set("status", "new");
    rec.set("search_lc", X.lc([no, sup, L.str(b.inn), L.str(b.basis)].concat(items.map((x) => x.name + " " + x.code)).join(" ")).slice(0, 3000));
    tx.save(rec);
    X.remember(tx, "supplier", sup);
    if (g.msgs.length) X.ovrSave(L, tx, g, rec, "upd_docs", rec.id, "УПД № " + no);
    L.log(tx, a, isNew ? "upd_create" : "upd_update", "upd_docs", rec.id, (isNew ? "Загружен УПД № " : "Изменён УПД № ") + no + " от " + K.ddmmyyyy(L.str(b.date)) + ", " + sup + ": позиций " + items.length +
      (K.num(b.total) ? ", сумма " + K.num(b.total) : ""), {});
    out = { id: rec.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/upd/delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const rec = tx.findRecordById("upd_docs", L.str(b.id));
    const acts = tx.findRecordsByFilter("skk_acts", "upds ~ {:i}", "", 0, 0, { i: rec.id });
    if (acts.length) throw new BadRequestError("По этому УПД есть акт № " + acts[0].getString("number") + " — сначала уберите УПД из акта.");
    L.log(tx, a, "upd_delete", "upd_docs", rec.id, "Удалён УПД № " + rec.getString("number") + " (" + rec.getString("supplier") + ")" + (L.str(b.reason) ? " — " + L.str(b.reason) : ""), {});
    tx.delete(rec);
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Акт СКК: создать / изменить (только СКК и администратор) ----------
routerAdd("POST", "/api/vs/skk/act/save", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`), K = require(`${__hooks}/lib18.js`);
  const a = L.requireRole(e, K.SKK_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    let act = null, old = [];
    if (b.id) { act = tx.findRecordById("skk_acts", L.str(b.id)); try { old = JSON.parse(act.getString("rows") || "[]") || []; } catch (_) {} }
    else act = new Record(tx.findCollectionByNameOrId("skk_acts"));
    const no = L.str(b.number).trim().slice(0, 60);
    if (!no) throw new BadRequestError("Укажите номер акта.");
    const same = tx.findRecordsByFilter("skk_acts", "number = {:n} && id != {:i}", "", 1, 0, { n: no, i: act.id || "" });
    if (same.length) throw new BadRequestError("Акт № " + no + " уже есть (" + same[0].getString("supplier") + ").");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(L.str(b.date))) throw new BadRequestError("Укажите дату акта.");
    const upds = (Array.isArray(b.upds) ? b.upds : []).map(String).slice(0, 50);
    const ud = upds.map((id) => tx.findRecordById("upd_docs", id));
    let sup = L.str(b.supplier) || (ud[0] ? ud[0].getString("supplier") : "");
    if (!sup) throw new BadRequestError("Укажите поставщика.");
    const rowsIn = Array.isArray(b.rows) ? b.rows : [];
    if (!rowsIn.length) throw new BadRequestError("Добавьте хотя бы одну строку несоответствия.");
    const now = L.fmt(new Date());
    const rows = rowsIn.slice(0, 200).map((x, i) => {
      const o = old.find((y) => y.uid && y.uid === x.uid) || {};
      const fixed = !!x.fixed;
      return { uid: L.str(x.uid) || ($security.randomString(8)), material: L.str(x.material).slice(0, 1000), volume: L.str(x.volume).slice(0, 60), code: L.str(x.code).slice(0, 300),
        issue: L.str(x.issue).slice(0, 1000), decision: L.str(x.decision).slice(0, 1000), upd: L.str(x.upd).slice(0, 30),
        fixed: fixed, fix_note: L.str(x.fix_note).slice(0, 1000),
        fixed_at: fixed ? (o.fixed ? o.fixed_at : (L.str(x.fixed_at) || now)) : "", fixed_by: fixed ? (o.fixed ? o.fixed_by : L.userName(a)) : "" };
    }).filter((x) => x.material || x.issue);
    const allFixed = rows.length && rows.every((x) => x.fixed);
    act.set("number", no); act.set("date", L.str(b.date)); act.set("object", L.str(b.object).slice(0, 500));
    ["rep_osk", "rep_sklad", "rep_omts"].forEach((k) => act.set(k, L.str(b[k]).slice(0, 300)));
    act.set("upds", upds); act.set("supplier", sup.slice(0, 300)); act.set("supplier_key", X.supplierKey(sup));
    act.set("upd_line", L.str(b.upd_line).slice(0, 1000)); act.set("rows", rows);
    act.set("conclusion", L.str(b.conclusion).slice(0, 3000)); act.set("verdict", L.str(b.verdict).slice(0, 1000));
    const wasClosed = act.getString("status") === "closed";
    act.set("status", allFixed ? "closed" : "open"); act.set("closed_at", allFixed ? (wasClosed ? act.getString("closed_at") : now) : "");
    if (!b.id) act.set("created_by", a.id);
    act.set("search_lc", X.lc([no, sup, L.str(b.upd_line)].concat(rows.map((x) => x.material + " " + x.issue + " " + x.code)).join(" ")).slice(0, 5000));
    tx.save(act);
    ud.forEach((u) => { if (u.getString("status") !== "draft") { u.set("status", allFixed ? "ok" : "act"); tx.saveNoValidate(u); } });
    // УПД, убранные из акта, — снова «без акта»
    if (b.id) tx.findRecordsByFilter("upd_docs", "status = 'act'", "", 0, 0).forEach((u) => {
      if (upds.indexOf(u.id) < 0 && !tx.findRecordsByFilter("skk_acts", "upds ~ {:i} && status = 'open'", "", 1, 0, { i: u.id }).length) { u.set("status", "new"); tx.saveNoValidate(u); }
    });
    K.syncActs(L, X, tx, act, L.userName(a));
    ["skk_osk", "skk_sklad", "skk_omts"].forEach((f, i) => X.remember(tx, f, L.str(b[["rep_osk", "rep_sklad", "rep_omts"][i]])));
    rows.forEach((x) => { X.remember(tx, "skk_issue", x.issue); X.remember(tx, "skk_decision", x.decision); });
    const nf = rows.filter((x) => x.fixed).length;
    L.log(tx, a, b.id ? "skk_act_update" : "skk_act_create", "skk_acts", act.id, (b.id ? "Изменён акт СКК № " : "Составлен акт СКК № ") + no + " — " + sup + ": строк " + rows.length + ", устранено " + nf +
      (allFixed ? " (акт закрыт)" : ""), {});
    out = { id: act.id, status: act.getString("status") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
// Отметить «устранено» по одной строке
routerAdd("POST", "/api/vs/skk/act/fix", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`), K = require(`${__hooks}/lib18.js`);
  const a = L.requireRole(e, K.SKK_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const act = tx.findRecordById("skk_acts", L.str(b.act));
    let rows = []; try { rows = JSON.parse(act.getString("rows") || "[]") || []; } catch (_) {}
    const x = rows.find((r) => r.uid === L.str(b.uid));
    if (!x) throw new BadRequestError("Строка акта не найдена.");
    const fixed = !!b.fixed;
    if (fixed && !L.str(b.note).trim() && !x.fix_note) throw new BadRequestError("Напишите, как устранено (причина закрытия).");
    x.fixed = fixed; x.fix_note = L.str(b.note).trim() || x.fix_note || "";
    x.fixed_at = fixed ? (L.str(b.date) ? L.str(b.date) + " 12:00:00.000Z" : L.fmt(new Date())) : ""; x.fixed_by = fixed ? L.userName(a) : "";
    const allFixed = rows.every((r) => r.fixed);
    act.set("rows", rows); act.set("status", allFixed ? "closed" : "open"); act.set("closed_at", allFixed ? L.fmt(new Date()) : "");
    tx.save(act);
    act.getStringSlice("upds").forEach((id) => { try { const u = tx.findRecordById("upd_docs", id); u.set("status", allFixed ? "ok" : "act"); tx.saveNoValidate(u); } catch (_) {} });
    K.syncActs(L, X, tx, act, L.userName(a));
    L.log(tx, a, "skk_act_fix", "skk_acts", act.id, "Акт СКК № " + act.getString("number") + ": «" + String(x.material).slice(0, 80) + "» — " + (fixed ? "устранено: " + x.fix_note : "снова не устранено") +
      (allFixed ? ". Все замечания устранены — акт закрыт" : ""), {});
    out = { status: act.getString("status") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Отчёт СКК за период ----------
routerAdd("GET", "/api/vs/skk/report", (e) => {
  const L = require(`${__hooks}/lib.js`), K = require(`${__hooks}/lib18.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk"]);
  const q = e.request.url.query();
  const from = L.str(q.get("from")), to = L.str(q.get("to"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new BadRequestError("Укажите период.");
  const upds = $app.findRecordsByFilter("upd_docs", "status != 'draft' && date >= {:f} && date <= {:t}", "date", 0, 0, { f: from, t: to });
  const acts = $app.findRecordsByFilter("skk_acts", "date >= {:f} && date <= {:t}", "date", 0, 0, { f: from, t: to });
  const openAll = $app.findRecordsByFilter("skk_acts", "status = 'open'", "date", 0, 0);
  const rowsOf = (a) => { try { return JSON.parse(a.getString("rows") || "[]") || []; } catch (_) { return []; } };
  const sup = {};
  const X = require(`${__hooks}/lib_ext.js`);
            const S = (name) => { const k = X.supplierKey(name) || name; return sup[k] || (sup[k] = { supplier: name, upd: 0, upd_act: 0, acts: 0, rows: 0, fixed: 0, open_acts: 0, sum: 0 }); };
  upds.forEach((u) => { const s = S(u.getString("supplier")); s.upd++; s.sum += u.getFloat("total"); if (u.getString("status") === "act" || u.getString("status") === "ok") s.upd_act++; });
  acts.forEach((a) => { const s = S(a.getString("supplier")); const r = rowsOf(a); s.acts++; s.rows += r.length; s.fixed += r.filter((x) => x.fixed).length; if (a.getString("status") === "open") s.open_acts++; });
  const now = Date.now();
  const actOut = (a) => { const r = rowsOf(a); return { id: a.id, number: a.getString("number"), date: a.getString("date"), supplier: a.getString("supplier"), upd_line: a.getString("upd_line"),
    status: a.getString("status"), rows: r.length, fixed: r.filter((x) => x.fixed).length, days: Math.floor((now - (L.parse(a.getString("date") + " 00:00:00.000Z") || new Date()).getTime()) / 86400000),
    issues: r.filter((x) => !x.fixed).map((x) => x.material + ": " + x.issue).slice(0, 10) }; };
  return e.json(200, {
    from: from, to: to,
    counts: { upd: upds.length, upd_noact: upds.filter((u) => u.getString("status") === "new").length, acts: acts.length, acts_closed: acts.filter((a) => a.getString("status") === "closed").length,
      rows: acts.reduce((s, a) => s + rowsOf(a).length, 0), fixed: acts.reduce((s, a) => s + rowsOf(a).filter((x) => x.fixed).length, 0), open_all: openAll.length },
    suppliers: Object.keys(sup).map((k) => sup[k]).sort((x, y) => y.acts - x.acts || y.upd - x.upd),
    acts: acts.map(actOut), open_all: openAll.map(actOut),
    upds: upds.map((u) => ({ id: u.id, number: u.getString("number"), date: u.getString("date"), supplier: u.getString("supplier"), total: u.getFloat("total"), status: u.getString("status"), items: (function () { try { return (JSON.parse(u.getString("items") || "[]") || []).length; } catch (_) { return 0; } })() })),
  });
}, $apis.requireAuth("users"));

// черновики УПД (загружен файл, но не сохранили) — удалить через 2 дня
cronAdd("vs_upd_drafts", "40 2 * * *", () => {
  const d = new Date(Date.now() - 2 * 86400000).toISOString().replace("T", " ");
  try { $app.findRecordsByFilter("upd_docs", "status = 'draft' && created < {:d}", "", 500, 0, { d: d }).forEach((r) => $app.delete(r)); } catch (err) { console.log("upd cleanup: " + err); }
});
