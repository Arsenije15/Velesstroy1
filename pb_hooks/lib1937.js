// VELESSTROY 1.9.37 — нормативы «Монтажа»
const NDEMO = {
  work: [
    ["Армирование стен и колонн", "т", "Проволока вязальная", "1,2 мм", "кг", 10], ["Армирование стен и колонн", "т", "Фиксатор «стульчик»", "30 мм", "шт", 120],
    ["Армирование стен и колонн", "т", "Фиксатор «звёздочка»", "25 мм", "шт", 160],
    ["Монтаж стеновой опалубки", "м2", "Смазка для опалубки (эмульсол)", "", "л", 0.3], ["Монтаж стеновой опалубки", "м2", "Винт стяжной", "1,0 м", "шт", 0.05],
    ["Сварка закладных деталей", "шт", "Электроды УОНИ 13/55", "d4", "кг", 0.4], ["Сварка закладных деталей", "шт", "Круг отрезной", "125×1,2", "шт", 0.25],
    ["Кладка перегородок (1/2 кирпича)", "м2", "Кирпич М150", "", "шт", 52], ["Кладка перегородок (1/2 кирпича)", "м2", "Цемент М500", "мешок 50 кг", "шт", 0.2],
  ],
  issue: [
    ["Круг отрезной", "125×1,2", "шт", 40, 30, "бригада"], ["Круг отрезной", "230×2,5", "шт", 20, 30, "бригада"], ["Электроды УОНИ 13/55", "d4", "кг", 30, 30, "бригада"],
    ["Проволока вязальная", "1,2 мм", "кг", 25, 30, "бригада"], ["Пена монтажная", "750 мл", "шт", 6, 30, "бригада"], ["Смазка для опалубки (эмульсол)", "", "л", 40, 30, "бригада"],
  ],
};
function lc(s) { return String(s || "").toLowerCase().replace(/ё/g, "е"); }
function findItem(tx, name, size) {
  try { const L = tx.findRecordsByFilter("mz_items", "name = {:n} && size = {:s}", "", 1, 0, { n: name, s: size || "" }); return L.length ? L[0] : null; } catch (_) { return null; }
}
function prep(rec) {
  rec.set("name", String(rec.getString("name")).replace(/\s+/g, " ").trim()); rec.set("size", String(rec.getString("size")).replace(/\s+/g, " ").trim());
  rec.set("search_lc", lc([rec.getString("work"), rec.getString("name"), rec.getString("size"), rec.getString("per"), rec.getString("note")].join(" ")).slice(0, 2000));
}
function seed(tx, a, demo) {
  const col = tx.findCollectionByNameOrId("mz_norms"); let n = 0;
  NDEMO.work.forEach((w) => { const r = new Record(col); r.set("kind", "work"); r.set("work", w[0]); r.set("work_unit", w[1]); r.set("name", w[2]); r.set("size", w[3]); r.set("unit", w[4]); r.set("qty", w[5]);
    const it = findItem(tx, w[2], w[3]); if (it) r.set("item", it.id); r.set("demo", !!demo); r.set("created_by", a.id); prep(r); tx.save(r); n++; });
  NDEMO.issue.forEach((w) => { const r = new Record(col); r.set("kind", "issue"); r.set("name", w[0]); r.set("size", w[1]); r.set("unit", w[2]); r.set("qty", w[3]); r.set("period_days", w[4]); r.set("per", w[5]);
    const it = findItem(tx, w[0], w[1]); if (it) r.set("item", it.id); r.set("demo", !!demo); r.set("created_by", a.id); prep(r); tx.save(r); n++; });
  return n;
}
module.exports = { prep, seed, findItem, lc };
