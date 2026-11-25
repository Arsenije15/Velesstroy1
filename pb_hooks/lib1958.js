// VELESSTROY 1.9.58 — флажок ↔ заявка: выдача по позиции, взятой «с флажка №», уменьшает количество материала на флажке
const key = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/x/g, "х").replace(/(\d),(?=\d)/g, "$1.").replace(/\s+/g, " ").trim();
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (s) => { const v = parseFloat(String(s == null ? "" : s).replace(/\s/g, "").replace(",", ".")); return isNaN(v) ? null : v; };
const fmt = (v) => String(r3(v)).replace(".", ",");
function mats(f) {
  let it = []; try { it = JSON.parse(f.getString("items") || "[]") || []; } catch (_) {}
  return [{ m: f.getString("material"), q: f.getString("qty"), u: f.getString("unit") }].concat(Array.isArray(it) ? it : []);
}
// какой материал флажка: точное название → то, что указано при выборе; иначе — похожий на материал заявки; один материал — он
function pick(f, flagMat, itemMat) {
  const L = mats(f);
  let i = L.findIndex((x) => key(x.m) === key(flagMat));
  if (i < 0 && itemMat) { const w = key(itemMat).split(" ").filter((x) => x.length >= 3); i = L.findIndex((x) => w.length && w.every((y) => key(x.m).indexOf(y) >= 0)); }
  if (i < 0 && L.length === 1) i = 0;
  return i;
}
function nextNo(app) {
  try { const r = app.findRecordsByFilter("smap_flags", "no > 0", "-no", 1, 0)[0]; return r ? r.getInt("no") + 1 : 1; } catch (_) { return 1; }
}
// снять (qty > 0) или вернуть (qty < 0) количество с материала флажка, записать в историю
function take(app, item, qty, by, note) {
  const fid = item.getString("flag"); if (!fid || !qty) return null;
  let f; try { f = app.findRecordById("smap_flags", fid); } catch (_) { return null; }
  const i = pick(f, item.getString("flag_mat"), item.getString("material"));
  const L = mats(f), x = i >= 0 ? L[i] : { m: item.getString("flag_mat") || item.getString("material"), q: "", u: item.getString("unit") };
  const before = x.q, b = num(before);
  let after = before;
  if (i >= 0 && b !== null) {
    after = fmt(b - qty);
    if (i === 0) f.set("qty", after);
    else { const it = L.slice(1); it[i - 1] = Object.assign({}, it[i - 1], { q: after }); f.set("items", it); }
    app.save(f);
  }
  let no = ""; try { no = app.findRecordById("requests", item.getString("request")).getString("number"); } catch (_) {}
  const t = new Record(app.findCollectionByNameOrId("smap_takes"));
  t.set("flag", f.id); t.set("mat", String(x.m || "").slice(0, 300)); t.set("unit", x.u || item.getString("unit"));
  t.set("qty", r3(qty)); t.set("before", String(before || "")); t.set("after", String(after || ""));
  t.set("request", item.getString("request")); t.set("request_item", item.id); t.set("number", no);
  t.set("by_name", String(by || "").slice(0, 200)); t.set("note", String(note || (i < 0 ? "материал на флажке не найден — количество не изменено" : b === null ? "на флажке нет числа — количество не изменено" : "")).slice(0, 300));
  app.save(t);
  return t;
}
function onItem(e) {
  try {
    const r = e.record, o = r.original();
    if (!r.getString("flag")) return;
    const d = r3(r.getFloat("qty_issued") - (o ? o.getFloat("qty_issued") : 0));
    if (d) take(e.app, r, d, "");
  } catch (err) { console.log("flag take: " + err); }
}
function takenBy(app, itemId) {
  let s = 0; try { app.findRecordsByFilter("smap_takes", "request_item = {:i}", "", 0, 0, { i: itemId }).forEach((t) => { s += t.getFloat("qty"); }); } catch (_) {}
  return r3(s);
}
module.exports = { key, mats, pick, nextNo, take, onItem, takenBy };
