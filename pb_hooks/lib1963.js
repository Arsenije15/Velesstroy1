/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.63 — заявка со скана: по PID — оперативка (поставщик, № УПД, наименование, сколько всего по PID и сколько уже заявлено)
function rows(app, sql, model, P) { const R = arrayOf(new DynamicModel(model)); const q = app.db().newQuery(sql); if (P) q.bind(P); q.all(R); return JSON.parse(JSON.stringify(R)); }
const nk = (s) => String(s || "").toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
const NORM = (c) => "REPLACE(REPLACE(REPLACE(REPLACE(UPPER(" + c + "),'-',''),' ',''),'.',''),'/','')";
const r3 = (v) => Math.round((+v || 0) * 1000) / 1000;
function docs(torg, date) {
  // «УПД 6225 от 20.10.2026; ТОРГ-12 №15» → варианты для поля «Документ поставки»
  const L = String(torg || "").split(/[;\n]+|,\s*(?=(?:УПД|ТОРГ|М-15|№|\d))/i).map((x) => x.replace(/^\s*(УПД|упд)\s*№?\s*/, "").trim()).filter((x) => x && /\d/.test(x));
  const out = []; L.forEach((x) => { const v = (/\sот\s/.test(x) || !date || L.length > 1 ? x : x + " от " + date).slice(0, 120); if (out.indexOf(v) < 0) out.push(v); });
  return out.slice(0, 8);
}
const nu = (u) => String(u || "").toLowerCase().replace(/[.\s]/g, "").replace("²", "2").replace("³", "3");
function pidEnrich(app, items, number) {
  const pids = []; (items || []).forEach((x) => { const k = nk(x.rd); if (k.length >= 4 && pids.indexOf(k) < 0) pids.push(k); });
  if (!pids.length) return 0;
  const P = {}; const ph = pids.map((p, i) => { P["p" + i] = p; return "{:p" + i + "}"; }).join(",");
  const O = rows(app, "SELECT " + NORM("pid") + " AS k, COALESCE(pid,'') AS pid, COALESCE(NULLIF(name_1c,''), NULLIF(name_proj,''), name_supp, '') AS name, COALESCE(unit,'') AS unit, " +
    "COALESCE(qty,0) AS qty, COALESCE(qty_delivered,0) AS dlv, COALESCE(supplier,'') AS supplier, COALESCE(torg,'') AS torg, COALESCE(torg_date,'') AS td FROM oper_rows WHERE " + NORM("pid") + " IN (" + ph + ")",
    { k: "", pid: "", name: "", unit: "", qty: 0.5, dlv: 0.5, supplier: "", torg: "", td: "" }, P);
  const U = {}; rows(app, "SELECT " + NORM("i.rd") + " AS k, SUM(COALESCE(i.qty_ordered,0)) AS q FROM request_items i JOIN requests r ON r.id = i.request WHERE r.status != 'cancelled' AND COALESCE(r.number,'') != {:num} AND " + NORM("i.rd") + " IN (" + ph + ") GROUP BY k",
    { k: "", q: 0.5 }, Object.assign({ num: String(number || "-").trim() || "-" }, P)).forEach((x) => { U[x.k] = x.q; });
  const G = {}; O.forEach((o) => { const g = G[o.k] = G[o.k] || { pid: o.pid, name: o.name, unit: o.unit, max: 0, dlv: 0, sup: [], docs: [] };
    g.max += o.qty; g.dlv += o.dlv; if (o.supplier && g.sup.indexOf(o.supplier) < 0) g.sup.push(o.supplier); docs(o.torg, o.td).forEach((d) => { if (g.docs.indexOf(d) < 0) g.docs.push(d); }); });
  let n = 0;
  items.forEach((it) => {
    const g = G[nk(it.rd)]; if (!g) { if (nk(it.rd).length >= 4) it.pid_miss = true; return; }
    n++; const used = r3(U[nk(it.rd)] || 0), max = r3(g.max), left = r3(max - used);
    it.oper = { pid: g.pid, name: g.name, unit: g.unit, max, delivered: r3(g.dlv), used, left, suppliers: g.sup.slice(0, 5), docs: g.docs };
    it.from_oper = [];
    if (!String(it.supplier || "").trim() && g.sup.length) { it.supplier = g.sup[0]; it.from_oper.push("supplier"); }
    if (!String(it.supply_doc || "").trim() && g.docs.length) { it.supply_doc = g.docs[0]; it.from_oper.push("supply_doc"); }
    if (!String(it.material || "").trim() && g.name) { it.material = g.name; it.from_oper.push("material"); }
    if (!String(it.unit || "").trim() && g.unit) { it.unit = g.unit; it.from_oper.push("unit"); }
    // лимит — только в одной единице (в оперативке «т», в заявке «кг» — не сравниваем, единица видна в подсказке)
    if (g.unit && it.unit && nu(g.unit) !== nu(it.unit)) it.oper.unit_diff = true;
    else if (max > 0 && it.qty != null && +it.qty > left + 1e-9) { it.warn = (it.warn || []).concat(["pid_limit"]); }
  });
  return n;
}
module.exports = { pidEnrich, docs };
