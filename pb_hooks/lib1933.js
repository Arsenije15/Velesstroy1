// VELESSTROY 1.9.33 — документы и пример данных «Склад Велесстрой Монтаж»
const M = require(`${__hooks}/lib1932.js`);
function fmt(d) { return d.toISOString().replace("T", " ").slice(0, 19) + ".000Z"; }
function nextNo(tx, kind) {
  const pfx = kind === "issue" ? "ВН-" : "ЗЗ-";
  const r = new DynamicModel({ n: 0 });
  tx.db().newQuery("SELECT COALESCE(MAX(CAST(SUBSTR(number, 4) AS INTEGER)), 0) AS n FROM mz_docs WHERE kind = {:k}").bind({ k: kind }).one(r);
  return pfx + String(r.n + 1).padStart(4, "0");
}
function stateGet(tx) { try { const r = tx.findFirstRecordByFilter("org_settings", "key = 'mz_demo'"); let d = {}; try { d = JSON.parse(r.getString("data") || "{}") || {}; } catch (_) {} return { rec: r, d: d }; } catch (_) { return { rec: null, d: {} }; } }
function stateSet(tx, d) {
  let { rec } = stateGet(tx);
  if (!rec) { rec = new Record(tx.findCollectionByNameOrId("org_settings")); rec.set("key", "mz_demo"); }
  rec.set("data", d); tx.save(rec);
}
// выдача по накладной: проверка остатков, движение по каждой строке, документ
function issue(tx, a, b, opt) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).filter((l) => l && l.item && M.num(l.qty) > 0);
  if (!lines.length) throw new BadRequestError("Добавьте хотя бы одну позицию с количеством.");
  const who = String(b.who || "").trim().slice(0, 200); if (!who) throw new BadRequestError("Укажите, кому выдано.");
  const doc = new Record(tx.findCollectionByNameOrId("mz_docs"));
  doc.set("kind", "issue"); doc.set("number", nextNo(tx, "issue")); doc.set("doc_date", String(b.doc_date || new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)).slice(0, 10));
  doc.set("who", who); doc.set("basis", String(b.basis || "").slice(0, 300)); doc.set("org", String(b.org || "").slice(0, 200)); doc.set("note", String(b.note || "").slice(0, 2000));
  doc.set("status", "done"); doc.set("created_by", a.id); doc.set("demo", !!(opt && opt.demo));
  const snap = [], seen = {};
  lines.forEach((l) => {
    const it = tx.findRecordById("mz_items", String(l.item));
    const q = M.num(l.qty); const cur = it.getFloat("qty") - (seen[it.id] || 0);
    if (q > cur + 1e-9) throw new BadRequestError(it.getString("name") + (it.getString("size") ? " " + it.getString("size") : "") + ": на складе только " + String(Math.round(cur * 1000) / 1000).replace(".", ",") + " " + it.getString("unit") + ".");
    seen[it.id] = (seen[it.id] || 0) + q;
    snap.push({ item: it.id, section: it.getString("section"), name: it.getString("name"), size: it.getString("size"), unit: it.getString("unit"), code: it.getString("code"), qty: q, note: String(l.note || "").slice(0, 300) });
  });
  doc.set("lines", snap);
  doc.set("search_lc", M.lc([doc.getString("number"), who, doc.getString("basis"), doc.getString("note")].concat(snap.map((s) => s.name + " " + s.size)).join(" ")).slice(0, 5000));
  tx.save(doc);
  const mc = tx.findCollectionByNameOrId("mz_moves");
  snap.forEach((s) => {
    const it = tx.findRecordById("mz_items", s.item);
    const nq = Math.round((it.getFloat("qty") - s.qty) * 1000) / 1000;
    const m = new Record(mc); m.set("item", it.id); m.set("kind", "out"); m.set("qty", s.qty); m.set("balance", nq); m.set("who", who);
    m.set("note", (doc.getString("number") + (s.note ? " · " + s.note : "") + (doc.getString("basis") ? " · " + doc.getString("basis") : "")).slice(0, 1000));
    m.set("doc", doc.id); m.set("created_by", a.id); m.set("demo", !!(opt && opt.demo)); tx.save(m);
    it.set("qty", nq); tx.saveNoValidate(it);
  });
  return doc;
}
// 1.9.34: закупает Монтаж только расходники, инструмент и непроектный материал; арматура, проектный материал, СИЗ, леса/опалубка — по заявкам Велесстроя
const BUY = ["cons", "tool"];
function canBuy(it) { const s = it.getString("section"); return BUY.indexOf(s) >= 0 || (s === "mat" && it.getBool("nonproj")); }
function purchase(tx, a, b, opt) {
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ item: String(l.item || ""), name: String(l.name || "").trim().slice(0, 500), size: String(l.size || "").slice(0, 100), unit: String(l.unit || "").slice(0, 30), qty: M.num(l.qty), stock: M.num(l.stock), note: String(l.note || "").slice(0, 300) })).filter((l) => l.name && l.qty > 0);
  if (!lines.length) throw new BadRequestError("Добавьте хотя бы одну строку: наименование и количество.");
  lines.forEach((l) => { if (!(l.stock >= 0)) l.stock = "";
    if (l.item) { let it = null; try { it = tx.findRecordById("mz_items", l.item); } catch (_) {}
      if (it && !canBuy(it)) throw new BadRequestError("«" + it.getString("name") + (it.getString("size") ? " " + it.getString("size") : "") + "» — проектный материал / не закупается Монтажом: он приходит по заявкам со склада Велесстроя. В заявку на закупку — только расходники, инструмент и непроектный материал."); } });
  const doc = new Record(tx.findCollectionByNameOrId("mz_docs"));
  doc.set("kind", "purchase"); doc.set("number", nextNo(tx, "purchase")); doc.set("doc_date", String(b.doc_date || new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)).slice(0, 10));
  doc.set("need_by", String(b.need_by || "").slice(0, 10)); doc.set("basis", String(b.basis || "").slice(0, 300)); doc.set("org", String(b.org || "").slice(0, 200)); doc.set("note", String(b.note || "").slice(0, 2000));
  doc.set("status", "draft"); doc.set("lines", lines); doc.set("created_by", a.id); doc.set("demo", !!(opt && opt.demo));
  doc.set("search_lc", M.lc([doc.getString("number"), doc.getString("basis"), doc.getString("note")].concat(lines.map((s) => s.name + " " + s.size)).join(" ")).slice(0, 5000));
  tx.save(doc); return doc;
}
function demoClear(tx) {
  const st = stateGet(tx).d;
  tx.findRecordsByFilter("mz_moves", "demo = true", "", 0, 0).forEach((r) => tx.delete(r));
  tx.findRecordsByFilter("mz_docs", "demo = true", "", 0, 0).forEach((r) => tx.delete(r));
  tx.findRecordsByFilter("mz_items", "demo = true", "", 0, 0).forEach((r) => tx.delete(r));
  st.cleared = new Date().toISOString(); stateSet(tx, st);
}
const DEMO = {
  arm: [["Арматура А500С", "Арматура А500С", "d10", "т", 3, 6.8, "Площадка 1"], ["Арматура А500С", "Арматура А500С", "d12", "т", 8, 21.4, "Площадка 1"], ["Арматура А500С", "Арматура А500С", "d16", "т", 6, 4.2, "Площадка 1"],
    ["Арматура А500С", "Арматура А500С", "d20", "т", 4, 11.0, "Площадка 2"], ["Арматура А500С", "Арматура А500С", "d25", "т", 2, 7.5, "Площадка 2"], ["Арматура А240", "Арматура А240", "d8", "т", 1, 2.9, "Площадка 2"]],
  scaf: [["Опалубка стеновая", "Щит опалубки", "3000×1200", "шт", 40, 126, "Площадка 3"], ["Опалубка стеновая", "Щит опалубки", "3000×600", "шт", 20, 48, "Площадка 3"], ["Опалубка стеновая", "Щит опалубки", "1200×600", "шт", 20, 14, "Площадка 3"],
    ["Опалубка стеновая", "Угол внутренний", "3000", "шт", 8, 22, "Площадка 3"], ["Опалубка стеновая", "Замок клиновой", "", "шт", 200, 160, "Контейнер 3"], ["Опалубка стеновая", "Винт стяжной", "1,0 м", "шт", 150, 420, "Контейнер 3"],
    ["Опалубка стеновая", "Гайка-барашек", "D15", "шт", 300, 640, "Контейнер 3"], ["Опалубка перекрытий", "Стойка телескопическая", "3,1 м", "шт", 100, 280, "Площадка 4"], ["Опалубка перекрытий", "Тренога", "", "шт", 60, 95, "Площадка 4"],
    ["Опалубка перекрытий", "Унивилка", "", "шт", 100, 240, "Контейнер 4"], ["Опалубка перекрытий", "Балка деревянная", "3,3 м", "шт", 80, 210, "Площадка 4"], ["Леса рамные", "Рама с лестницей", "2000×1000", "шт", 30, 64, "Площадка 5"],
    ["Леса рамные", "Рама проходная", "2000×1000", "шт", 60, 150, "Площадка 5"], ["Леса рамные", "Связь диагональная", "3,0 м", "шт", 80, 190, "Площадка 5"], ["Леса рамные", "Ригель", "3,0 м", "шт", 60, 38, "Площадка 5"], ["Леса рамные", "Башмак", "", "шт", 40, 120, "Контейнер 5"]],
  tool: [["Электроинструмент", "Перфоратор Makita HR2470", "", "шт", 2, 6, "Контейнер 1", "ИНВ-0123"], ["Электроинструмент", "УШМ (болгарка)", "230 мм", "шт", 2, 5, "Контейнер 1", "ИНВ-0130"], ["Электроинструмент", "УШМ (болгарка)", "125 мм", "шт", 3, 9, "Контейнер 1", "ИНВ-0131"],
    ["Электроинструмент", "Шуруповёрт аккумуляторный", "18 В", "шт", 2, 7, "Контейнер 1", "ИНВ-0140"], ["Сварка", "Сварочный инвертор", "250 А", "шт", 1, 3, "Контейнер 1", "ИНВ-0150"], ["Бетонные работы", "Вибратор глубинный", "", "шт", 1, 2, "Контейнер 1", "ИНВ-0160"],
    ["Измерительный", "Нивелир лазерный", "", "шт", 1, 2, "Прорабская", "ИНВ-0170"], ["Измерительный", "Рулетка", "8 м", "шт", 5, 4, "Контейнер 1"], ["Ручной инструмент", "Кувалда", "5 кг", "шт", 3, 8, "Контейнер 1"], ["Ручной инструмент", "Лом", "", "шт", 3, 10, "Контейнер 1"]],
  cons: [["Сварка", "Электроды УОНИ 13/55", "d3", "кг", 20, 14, "Контейнер 2"], ["Сварка", "Электроды УОНИ 13/55", "d4", "кг", 20, 55, "Контейнер 2"], ["Абразив", "Круг отрезной", "230×2,5", "шт", 50, 180, "Контейнер 2"],
    ["Абразив", "Круг отрезной", "125×1,2", "шт", 100, 420, "Контейнер 2"], ["Вязка", "Проволока вязальная", "1,2 мм", "кг", 50, 36, "Контейнер 2"], ["Фиксаторы", "Фиксатор «стульчик»", "30 мм", "шт", 2000, 10500, "Контейнер 2"],
    ["Фиксаторы", "Фиксатор «звёздочка»", "25 мм", "шт", 2000, 4800, "Контейнер 2"], ["Крепёж", "Анкер-болт", "12×100", "шт", 200, 640, "Контейнер 2"], ["Химия", "Пена монтажная", "750 мл", "шт", 24, 30, "Контейнер 2"], ["Химия", "Смазка для опалубки (эмульсол)", "", "л", 100, 60, "Контейнер 2"]],
  mat: [["Нерудные", "Песок строительный", "", "т", 10, 26, "Площадка 6"], ["Нерудные", "Щебень", "20-40", "т", 15, 40, "Площадка 6"], ["Вяжущие", "Цемент М500", "мешок 50 кг", "шт", 40, 32, "Склад 1"],
    ["Стеновые", "Кирпич М150", "", "шт", 2000, 5600, "Площадка 6"], ["Утеплитель", "Пеноплэкс", "50 мм", "м3", 5, 12, "Склад 1"], ["Гидроизоляция", "Техноэласт ЭПП", "рулон 10 м2", "шт", 20, 26, "Склад 1"],
    ["Временные работы (непроектный)", "Плёнка укрывная", "200 мкм, рулон 3×100 м", "рул", 4, 2, "Склад 1", "", true], ["Временные работы (непроектный)", "Доска обрезная (ограждения, настилы)", "50×150×6000", "м3", 2, 3.5, "Площадка 6", "", true]],
};
const WHO = ["Бригада Иванова (монолит, секция 2)", "Бригада Ахмедова (опалубка)", "Бригада Петрова (арматурщики)", "Участок №3 — кладка", "ООО «СтройМонолит» (субподряд)"];
function demoSeed(tx, a) {
  const st = stateGet(tx).d;
  if (st.seeded) return { skipped: true };
  const ic = tx.findCollectionByNameOrId("mz_items"), mc = tx.findCollectionByNameOrId("mz_moves");
  const now = Date.now(); const ids = {}; let k = 0;
  const setCreated = (col, id, ms) => tx.db().newQuery("UPDATE " + col + " SET created = {:c}, updated = {:c} WHERE id = {:id}").bind({ c: fmt(new Date(ms)), id: id }).execute();
  Object.keys(DEMO).forEach((sec) => DEMO[sec].forEach((r) => {
    const [grp, name, size, unit, mn, q0, place, code, nonproj] = r;
    const it = new Record(ic); it.set("section", sec); it.set("grp", grp); it.set("name", name); it.set("size", size); it.set("unit", unit); it.set("min_qty", mn); it.set("place", place); it.set("code", code || ""); it.set("nonproj", !!nonproj);
    it.set("qty", 0); it.set("demo", true); it.set("created_by", a.id); M.prep(it);
    try { tx.findFirstRecordByFilter("mz_items", "key = {:k}", { k: it.getString("key") }); return; } catch (_) {}
    tx.save(it);
    // приход 14 дней назад (по накладной поставщика), остаток по итогу = q0 + выдачи
    const outQ = sec === "mat" || sec === "cons" || sec === "arm" ? Math.round(q0 * 0.35 * 1000) / 1000 : sec === "scaf" ? Math.round(q0 * 0.25) : 1;
    const inQ = Math.round((q0 + outQ) * 1000) / 1000;
    const m = new Record(mc); m.set("item", it.id); m.set("kind", sec === "tool" || sec === "scaf" ? "count" : "in"); m.set("qty", inQ); m.set("balance", inQ);
    if (sec !== "tool" && sec !== "scaf") { m.set("doc_no", "ТН-" + (1100 + k)); m.set("who", ""); m.set("note", "Поставщик: " + (sec === "arm" ? "ООО «МеталлСервис-Юг»" : sec === "mat" ? "ООО «КубаньСтройРесурс»" : "ООО «КрепёжОпт»")); }
    else m.set("note", "Начальный остаток (инвентаризация)");
    m.set("created_by", a.id); m.set("demo", true); tx.save(m); setCreated("mz_moves", m.id, now - (14 - (k % 5)) * 86400000);
    it.set("qty", inQ); tx.saveNoValidate(it); ids[sec + "|" + name + "|" + size] = it.id; k++;
  }));
  // выдачи по накладным (за последние дни) — как будто кладовщики работали
  const L = (sec, name, size, qty) => ({ item: ids[sec + "|" + name + "|" + size], qty: qty });
  const plan = [
    [WHO[2], "Армирование стен, секция 2", [L("arm", "Арматура А500С", "d12", 4.2), L("arm", "Арматура А500С", "d16", 2.3), L("cons", "Проволока вязальная", "1,2 мм", 12), L("cons", "Фиксатор «стульчик»", "30 мм", 3000)], 9],
    [WHO[1], "Опалубка стен, секция 2", [L("scaf", "Щит опалубки", "3000×1200", 30), L("scaf", "Замок клиновой", "", 40), L("scaf", "Винт стяжной", "1,0 м", 80), L("scaf", "Гайка-барашек", "D15", 160)], 7],
    [WHO[0], "Бетонирование стен, секция 1", [L("mat", "Цемент М500", "мешок 50 кг", 12), L("tool", "Вибратор глубинный", "", 1), L("cons", "Смазка для опалубки (эмульсол)", "", 20)], 5],
    [WHO[3], "Кладка перегородок, 2 этаж", [L("mat", "Кирпич М150", "", 2400), L("mat", "Песок строительный", "", 8), L("tool", "Кувалда", "5 кг", 1)], 3],
    [WHO[4], "Монтаж лесов, ось А–В", [L("scaf", "Рама проходная", "2000×1000", 40), L("scaf", "Ригель", "3,0 м", 12), L("scaf", "Связь диагональная", "3,0 м", 30), L("tool", "Перфоратор Makita HR2470", "", 1)], 2],
    [WHO[2], "Армирование перекрытия, 3 этаж", [L("arm", "Арматура А500С", "d10", 2.4), L("arm", "Арматура А500С", "d20", 3.6), L("cons", "Электроды УОНИ 13/55", "d3", 6), L("cons", "Круг отрезной", "230×2,5", 25)], 1],
  ];
  plan.forEach((p, i) => {
    if (!p[2].some((x) => x.item)) return;
    const d = issue(tx, a, { who: p[0], basis: p[1], lines: p[2].filter((x) => x.item) }, { demo: true });
    const ms = now - p[3] * 86400000 + i * 3600000;
    setCreated("mz_docs", d.id, ms); tx.db().newQuery("UPDATE mz_docs SET doc_date = {:d} WHERE id = {:id}").bind({ d: new Date(ms + 3 * 3600000).toISOString().slice(0, 10), id: d.id }).execute();
    tx.findRecordsByFilter("mz_moves", "doc = {:d}", "", 0, 0, { d: d.id }).forEach((m) => setCreated("mz_moves", m.id, ms));
  });
  // возврат лесов и списание — для примера
  const ret = (sec, name, size, kind, q, who, note, dAgo) => { const id0 = ids[sec + "|" + name + "|" + size]; if (!id0) return; const it = tx.findRecordById("mz_items", id0); const nq = kind === "wo" ? it.getFloat("qty") - q : it.getFloat("qty") + q;
    const m = new Record(mc); m.set("item", it.id); m.set("kind", kind); m.set("qty", q); m.set("balance", nq); m.set("who", who); m.set("note", note); m.set("created_by", a.id); m.set("demo", true); tx.save(m); setCreated("mz_moves", m.id, now - dAgo * 86400000); it.set("qty", nq); tx.saveNoValidate(it); };
  ret("scaf", "Щит опалубки", "3000×1200", "ret", 8, WHO[1], "Вернули после распалубки секции 1", 4);
  ret("tool", "Вибратор глубинный", "", "ret", 1, WHO[0], "Вернули после бетонирования", 4);
  ret("cons", "Круг отрезной", "125×1,2", "wo", 20, "", "Брак партии — круги крошатся", 6);
  // заявка на закупку — то, что ниже минимума
  const low = tx.findRecordsByFilter("mz_items", "demo = true && min_qty > 0", "section,name", 0, 0).filter((x) => x.getFloat("qty") < x.getFloat("min_qty") && canBuy(x)).slice(0, 8);
  if (low.length) { const pd = purchase(tx, a, { basis: "Пополнение до минимума — секции 2–3", need_by: new Date(now + 5 * 86400000 + 3 * 3600000).toISOString().slice(0, 10),
    lines: low.map((x) => ({ item: x.id, name: x.getString("name"), size: x.getString("size"), unit: x.getString("unit"), stock: x.getFloat("qty"), qty: Math.ceil((x.getFloat("min_qty") * 2 - x.getFloat("qty")) * 10) / 10, note: "ниже минимума" })) }, { demo: true });
  setCreated("mz_docs", pd.id, now - 3600000); }
  st.seeded = new Date().toISOString(); stateSet(tx, st);
  return { items: Object.keys(ids).length };
}
// 1.9.34: снабжение проектного материала — остаток МПЗ Велесстроя и сколько Монтаж взял по заявкам
const SUP_DEF = "онтаж";   // получатель в заявке содержит «…онтаж» (Монтаж / монтаж; без первой буквы — фильтр БД чувствителен к регистру кириллицы)
function supPattern(tx) { try { const r = tx.findFirstRecordByFilter("org_settings", "key = 'mz_supply'"); const d = JSON.parse(r.getString("data") || "{}"); return String(d.recipient || SUP_DEF); } catch (_) { return SUP_DEF; } }
const LAT = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", k: "к", m: "м", t: "т", b: "в", h: "н", y: "у" };
function nrm(s) { return M.lc(s).replace(/[acekmhoptxyb]/g, (ch) => LAT[ch]); }   // А500С латиницей и кириллицей — одно и то же
function toks(name, size) {
  const t = nrm(name).replace(/[«»"'(),.;:]/g, " ").split(/\s+/).filter((w) => w.length >= 3).slice(0, 4);
  const z = nrm(size).replace(/^(d|ф|ø|д)\s*/, "").replace(/[\s]+/g, " ").trim();
  return { words: t, size: z };
}
function hit(text, k) {
  const s = nrm(text);
  if (!k.words.every((w) => s.indexOf(w.length > 5 ? w.slice(0, w.length - 2) : w) >= 0)) return false;   // окончания: «арматура / арматуры»
  if (!k.size) return true;
  if (!/^\d+([.,]\d+)?$/.test(k.size)) return true;   // «мешок 50 кг», «3000×1200» — в 1С пишут по-разному, не отсекаем
  return new RegExp("(^|[^\\d.,])(d|ф|ø|д|диам\\.?\\s*)?\\s*" + k.size.replace(/[.,]/, "[.,]") + "(?![\\d]|[.,]\\d)").test(s);
}
function supply(tx, it) {
  const k = toks(it.getString("name"), it.getString("size")); const out = { mpz: [], req: [], mpz_qty: 0, ordered: 0, issued: 0, pattern: supPattern(tx) };
  if (!k.words.length) return out;
  const cyr = k.words.filter((w) => /^[а-я]+$/.test(w)); const w0 = (cyr.length ? cyr : k.words).slice().sort((a, b) => b.length - a.length)[0]; const w0s = w0.length > 5 ? w0.slice(0, w0.length - 2) : w0;
  tx.findRecordsByFilter("mpz_stock", "search_lc ~ {:w}", "name", 300, 0, { w: w0s }).forEach((r) => {
    if (!hit(r.getString("name") + " " + r.getString("quality"), k)) return;
    out.mpz.push({ name: r.getString("name"), code: r.getString("code"), warehouse: r.getString("warehouse"), unit: r.getString("unit"), qty: r.getFloat("qty_end"), period: r.getString("period") });
    out.mpz_qty += r.getFloat("qty_end");
  });
  const pat = out.pattern;
  const reqs = tx.findRecordsByFilter("requests", "recipient ~ {:p} && status != 'cancelled'", "-req_date", 2000, 0, { p: pat });
  const byId = {}; reqs.forEach((r) => byId[r.id] = r);
  const ids = Object.keys(byId);
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50); const f = part.map((_, j) => "request = {:r" + j + "}").join(" || "); const pr = {}; part.forEach((id, j) => pr["r" + j] = id);
    tx.findRecordsByFilter("request_items", f, "", 0, 0, pr).forEach((x) => {
      if (!hit(x.getString("material"), k)) return;
      const r = byId[x.getString("request")];
      out.req.push({ number: r.getString("number"), date: r.getString("req_date").slice(0, 10), object: r.getString("object"), recipient: r.getString("recipient"), status: r.getString("status"),
        material: x.getString("material"), unit: x.getString("unit"), ordered: x.getFloat("qty_ordered"), issued: x.getFloat("qty_issued"), issued_at: x.getString("issued_at").slice(0, 10) });
      out.ordered += x.getFloat("qty_ordered"); out.issued += x.getFloat("qty_issued");
    });
  }
  out.req.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  ["mpz_qty", "ordered", "issued"].forEach((n) => out[n] = Math.round(out[n] * 1000) / 1000);
  out.mpz = out.mpz.slice(0, 100); out.req = out.req.slice(0, 300);
  return out;
}
module.exports = { canBuy, supply, nextNo, issue, purchase, demoClear, demoSeed, stateGet };
