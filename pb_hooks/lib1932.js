// VELESSTROY 1.9.32 — общее для «Склад Велесстрой Монтаж»
function lc(s) { return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim(); }
function keyOf(section, name, size) { return (section + "|" + lc(name) + "|" + lc(size)).slice(0, 900); }
function num(v) { const n = parseFloat(String(v === undefined || v === null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? Math.round(n * 1000) / 1000 : NaN; }
function mzUser(e) {
  const a = e.auth;
  if (!a || a.getString("scope") !== "mz" || !a.getBool("active")) throw new ForbiddenError("Только для «Склад Велесстрой Монтаж».");
  return a;
}
function mzWriter(e) { const a = mzUser(e); if (a.getString("role") !== "storekeeper") throw new ForbiddenError("Ссылка только для просмотра."); return a; }
function prep(rec) {
  rec.set("name", String(rec.getString("name")).replace(/\s+/g, " ").trim());
  rec.set("size", String(rec.getString("size")).replace(/\s+/g, " ").trim());
  rec.set("key", keyOf(rec.getString("section"), rec.getString("name"), rec.getString("size")));
  rec.set("search_lc", lc([rec.getString("grp"), rec.getString("name"), rec.getString("size"), rec.getString("code"), rec.getString("place"), rec.getString("note")].join(" ")).slice(0, 2000));
}
module.exports = { lc, keyOf, num, mzUser, mzWriter, prep };
