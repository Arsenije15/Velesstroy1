// VELESSTROY 1.9.52 — «Фактический остаток» склада: позиции и движение
// −  выдача по заявкам (request_items.qty_issued) и выдача невыданного (leftovers.issued)
// +  приход по УПД (upd_docs, когда УПД прочитан и сохранён — статус не «черновик»)
// Сопоставление по названию (без регистра, «х»/«x», «2,5»/«2.5», лишних пробелов) и по запомненным синонимам.
// Не нашлось — движение попадает в «Не сопоставлено», его можно привязать к позиции одним нажатием (и запомнить синоним).
function key(s) {
  return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/x/g, "х").replace(/(\d),(?=\d)/g, "$1.").replace(/[«»"'“”„`]/g, "").replace(/\s+/g, " ").trim().slice(0, 1500);
}
function r3(v) { return Math.round(v * 1000) / 1000; }
function active(app) { try { return app.findRecordsByFilter("fstock", "", "", 1, 0).length > 0; } catch (_) { return false; } }
function find(app, k) {
  if (!k) return null;
  try { return app.findFirstRecordByFilter("fstock", "key = {:k}", { k: k }); } catch (_) {}
  try { return app.findFirstRecordByFilter("fstock", "alias_lc ~ {:a}", { a: "|" + k + "|" }); } catch (_) {}
  return null;
}
function searchText(r) { return key([r.getString("name"), r.getString("code"), r.getString("place"), r.getString("note"), r.getString("alias_lc").replace(/\|/g, " ")].join(" ")).slice(0, 4000); }
function addAlias(r, k) {
  if (!k || k === r.getString("key")) return;
  const a = r.getString("alias_lc") || "|";
  if (a.indexOf("|" + k + "|") >= 0) return;
  const n = (a.endsWith("|") ? a : a + "|") + k + "|";
  if (n.length < 20000) r.set("alias_lc", n);
}
// движение: delta > 0 — приход, < 0 — расход
function move(app, o) {
  const col = app.findCollectionByNameOrId("fstock_moves");
  const m = new Record(col);
  const s = o.stock || null;
  m.set("kind", o.kind); m.set("name", String(o.name || "").slice(0, 1500)); m.set("key", key(o.name)); m.set("unit", String(o.unit || "").slice(0, 30));
  m.set("delta", r3(o.delta)); m.set("src", o.src || ""); m.set("ref", String(o.ref || "").slice(0, 40)); m.set("ref_no", String(o.ref_no || "").slice(0, 300));
  m.set("note", String(o.note || "").slice(0, 1000)); m.set("by_name", String(o.by || "").slice(0, 200));
  if (s) {
    const q = o.kind === "count" || o.kind === "init" ? r3(o.set) : r3(s.getFloat("qty") + o.delta);
    if (o.kind === "count") m.set("delta", r3(q - s.getFloat("qty")));
    s.set("qty", q); app.save(s);
    m.set("stock", s.id); m.set("after", q); m.set("pending", false);
  } else m.set("pending", true);
  app.save(m);
  return m;
}
// расход / приход из документа (заявка, невыданное, УПД)
function apply(app, name, unit, delta, src, ref, refNo, by) {
  if (!delta || !active(app)) return null;
  const s = find(app, key(name));
  return move(app, { stock: s, kind: delta > 0 ? "in" : "out", name: name, unit: unit, delta: delta, src: src, ref: ref, ref_no: refNo, by: by });
}
function onItem(e) {
  try {
    const r = e.record, o = r.original();
    const d = r3(r.getFloat("qty_issued") - (o ? o.getFloat("qty_issued") : 0));
    if (!d) return;
    let no = ""; try { no = "Заявка № " + e.app.findRecordById("requests", r.getString("request")).getString("number"); } catch (_) {}
    apply(e.app, r.getString("material"), r.getString("unit"), -d, "request", r.getString("request"), no, "");
  } catch (err) { console.log("fstock item: " + err); }
}
function onLeft(e) {
  try {
    const r = e.record, o = r.original();
    const d = r3(r.getFloat("issued") - (o ? o.getFloat("issued") : 0));
    if (!d) return;
    apply(e.app, r.getString("material"), r.getString("unit"), -d, "leftover", r.id, "Невыданное по заявке № " + r.getString("number"), "");
  } catch (err) { console.log("fstock leftover: " + err); }
}
function onUpd(e) {
  try {
    const r = e.record;
    if (!r.getString("status") || r.getString("status") === "draft") return;
    if (!active(e.app)) return;
    if (e.app.findRecordsByFilter("fstock_moves", "src = 'upd' && ref = {:r}", "", 1, 0, { r: r.id }).length) return;   // один раз на УПД
    let it = []; try { it = JSON.parse(r.getString("items") || "[]") || []; } catch (_) {}
    if (!Array.isArray(it)) return;
    const no = "УПД № " + r.getString("number") + (r.getString("supplier") ? " · " + r.getString("supplier") : "");
    it.forEach((x) => {
      const q = r3(parseFloat(String((x && x.qty) || "").replace(",", ".")) || 0);
      const nm = String((x && (x.name || x.spec_name)) || "").trim();
      if (!(q > 0) || !nm) return;
      let s = find(e.app, key(nm)); if (!s && x.spec_name) s = find(e.app, key(x.spec_name));
      move(e.app, { stock: s, kind: "in", name: nm, unit: x.unit || x.spec_unit || "", delta: q, src: "upd", ref: r.id, ref_no: no });
    });
  } catch (err) { console.log("fstock upd: " + err); }
}
module.exports = { key, r3, active, find, move, apply, addAlias, searchText, onItem, onLeft, onUpd };
