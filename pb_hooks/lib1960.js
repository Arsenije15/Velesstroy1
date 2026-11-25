/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.60 — сверка номеров УПД (моя приёмка / склад ↔ СКК), «Приход склада», кэш уведомлений, диагностика сервера
const LAT = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };
// номер для сравнения: без регистра, «УПД», «№», пробелов и знаков; латиница, похожая на кириллицу, — как кириллица
function nk(s) {
  let t = String(s || "").toLowerCase().replace(/ё/g, "е").replace(/^\s*(упд|№|n)\s*/, "").replace(/[^0-9a-zа-я]/g, "");
  t = t.replace(/^упд/, "").replace(/[abcehkmopxty]/g, (c) => LAT[c] || c);
  return t;
}
// главная группа цифр: «СТ-83464/1» → 83464 (самая длинная; от 3 цифр)
function core(s) { const m = String(s || "").match(/\d+/g) || []; let b = ""; m.forEach((x) => { if (x.length > b.length) b = x; }); return b.length >= 3 ? b.replace(/^0+(?=\d{3})/, "") : ""; }
function org(s) { return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\b(ооо|оао|зао|пао|ао|ип|тд|пкф|ук|нпо|нпп|гк)\b/g, " ").replace(/[^0-9a-zа-я]/g, ""); }
function sameOrg(a, b) { const x = org(a), y = org(b); if (!x || !y) return true; return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0; }
function rows(app, sql, model, params) { const R = arrayOf(new DynamicModel(model)); const q = app.db().newQuery(sql); if (params) q.bind(params); q.all(R); return JSON.parse(JSON.stringify(R)); }
function jarr(v) { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch (_) { return []; } }
// все УПД СКК (без черновиков) — индекс по номеру и по главной группе цифр
function skkIndex(app) {
  const L = rows(app, "SELECT id, COALESCE(number,'') AS number, COALESCE(supplier,'') AS supplier, COALESCE(status,'') AS status, COALESCE(date,'') AS date, COALESCE(created,'') AS created FROM upd_docs WHERE status != 'draft'",
    { id: "", number: "", supplier: "", status: "", date: "", created: "" });
  const byN = {}, byC = {};
  L.forEach((u) => { const k = nk(u.number); if (k) (byN[k] = byN[k] || []).push(u); const c = core(u.number); if (c) (byC[c] = byC[c] || []).push(u); });
  return { byN, byC, all: L };
}
// найти УПД у СКК: точно по номеру; иначе — та же главная группа цифр и тот же поставщик («83464» ↔ «СТ-83464/1»)
function findSkk(ix, number, supplier) {
  const k = nk(number); if (!k) return null;
  const ex = ix.byN[k]; if (ex && ex.length) { const s = ex.find((u) => sameOrg(u.supplier, supplier)) || ex[0]; return { u: s, how: "номер" }; }
  const c = core(number); if (!c) return null;
  const cand = (ix.byC[c] || []).filter((u) => org(u.supplier) && org(supplier) && sameOrg(u.supplier, supplier));
  return cand.length ? { u: cand[0], how: "похожий номер, тот же поставщик" } : null;
}
function words(q) { return String(q || "").toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(Boolean).slice(0, 8); }
function hitAll(W, text) { const t = String(text || "").toLowerCase().replace(/ё/g, "е"); const tn = nk(text); return W.every((w) => t.indexOf(w) >= 0 || (nk(w) && tn.indexOf(nk(w)) >= 0)); }
const RC_MODEL = { id: "", upd_number: "", supplier: "", status: "", created: "", finished_at: "", upd_items: "" };
const RC_SQL = "SELECT id, COALESCE(upd_number,'') AS upd_number, COALESCE(supplier,'') AS supplier, COALESCE(status,'') AS status, COALESCE(created,'') AS created, COALESCE(finished_at,'') AS finished_at, COALESCE(upd_items,'') AS upd_items FROM receipts ORDER BY created DESC LIMIT 5000";
const mats = (it) => it.map((x) => ({ name: String((x && (x.name || x.m)) || ""), qty: x && x.qty !== undefined ? x.qty : (x && x.q) || "", unit: String((x && (x.unit || x.u)) || "") })).filter((x) => x.name);
// «Приёмка материалов»: без поиска — мои УПД, которых нет у СКК; с поиском — все мои УПД и УПД СКК (с пометкой «СКК»), с материалами
function notInSkk(app, q) {
  const ix = skkIndex(app), W = words(q);
  const R = rows(app, RC_SQL, RC_MODEL).map((r) => { const it = mats(jarr(r.upd_items)); const f = findSkk(ix, r.upd_number, r.supplier);
    return { src: "rcp", id: r.id, upd_number: r.upd_number, supplier: r.supplier, status: r.status, created: r.created, finished_at: r.finished_at, n: it.length, mats: it.slice(0, 60), in_skk: !!f, skk: f ? { id: f.u.id, number: f.u.number, status: f.u.status, how: f.how } : null }; });
  if (!W.length) { const out = R.filter((r) => !r.in_skk); return { items: out.slice(0, 300), total: out.length }; }
  let out = R.filter((r) => hitAll(W, [r.upd_number, r.supplier, r.mats.map((x) => x.name).join(" ")].join(" ")));
  // УПД СКК: номер / поставщик / материал; уже показанные в моей приёмке — не дублируем
  const shown = {}; out.forEach((r) => { if (r.skk) shown[r.skk.id] = 1; });
  const like = W.map((w) => "search_lc LIKE {:w" + W.indexOf(w) + "}").join(" AND "), P = {}; W.forEach((w, i) => { P["w" + i] = "%" + w + "%"; });
  let S = rows(app, "SELECT id, COALESCE(number,'') AS number, COALESCE(supplier,'') AS supplier, COALESCE(status,'') AS status, COALESCE(date,'') AS date, COALESCE(created,'') AS created, COALESCE(items,'') AS items FROM upd_docs WHERE status != 'draft' AND (" + like + ") ORDER BY created DESC LIMIT 60",
    { id: "", number: "", supplier: "", status: "", date: "", created: "", items: "" }, P);
  // номер без знаков: «83464» находит «СТ-83464/1» и наоборот
  if (W.length === 1 && core(W[0])) { const extra = (ix.byC[core(W[0])] || []).filter((u) => !S.some((x) => x.id === u.id)).map((u) => u.id);
    if (extra.length) S = S.concat(rows(app, "SELECT id, COALESCE(number,'') AS number, COALESCE(supplier,'') AS supplier, COALESCE(status,'') AS status, COALESCE(date,'') AS date, COALESCE(created,'') AS created, COALESCE(items,'') AS items FROM upd_docs WHERE id IN (" + extra.slice(0, 40).map((x, i) => "{:e" + i + "}").join(",") + ")",
      { id: "", number: "", supplier: "", status: "", date: "", created: "", items: "" }, extra.slice(0, 40).reduce((o, x, i) => { o["e" + i] = x; return o; }, {}))); }
  S.filter((u) => !shown[u.id]).forEach((u) => { const it = mats(jarr(u.items)); out.push({ src: "skk", id: u.id, upd_number: u.number, supplier: u.supplier, status: u.status, created: u.created, date: u.date, n: it.length, mats: it.slice(0, 60), in_skk: true }); });
  return { items: out.slice(0, 300), total: out.length };
}
// «Приход склада»: вписанные УПД + мои приёмки; у каждого — есть ли у СКК
function whinList(app, q, mode) {
  const ix = skkIndex(app), W = words(q);
  const E = rows(app, "SELECT id, COALESCE(number,'') AS number, COALESCE(date,'') AS date, COALESCE(supplier,'') AS supplier, COALESCE(note,'') AS note, COALESCE(by_name,'') AS by_name, COALESCE(created_by,'') AS created_by, COALESCE(created,'') AS created FROM wh_upds ORDER BY created DESC LIMIT 5000",
    { id: "", number: "", date: "", supplier: "", note: "", by_name: "", created_by: "", created: "" });
  const R = rows(app, RC_SQL, RC_MODEL);
  // один УПД — одна строка: склад + приёмка сливаются, если это тот же УПД у СКК, или тот же номер у того же поставщика
  const out = [], bySkk = {}, byN = {};
  const put = (o) => {
    const f = findSkk(ix, o.number, o.supplier); o.skk = f ? { id: f.u.id, number: f.u.number, status: f.u.status, how: f.how } : null;
    let ex = f ? bySkk[f.u.id] : null; if (!ex) ex = (byN[nk(o.number)] || []).find((x) => sameOrg(x.supplier, o.supplier) && (!x.skk || !o.skk || x.skk.id === o.skk.id));
    if (ex) { o.src.forEach((s) => { if (ex.src.indexOf(s) < 0) ex.src.push(s); }); ["rcp", "wid", "note", "by", "created_by"].forEach((k) => { if (!ex[k] && o[k]) ex[k] = o[k]; }); if (!ex.skk && o.skk) { ex.skk = o.skk; bySkk[o.skk.id] = ex; } return; }
    out.push(o); if (o.skk) bySkk[o.skk.id] = o; (byN[nk(o.number)] = byN[nk(o.number)] || []).push(o);
  };
  E.forEach((e) => put({ src: ["склад"], wid: e.id, number: e.number, date: e.date || e.created.slice(0, 10), supplier: e.supplier, note: e.note, by: e.by_name, created_by: e.created_by, created: e.created }));
  R.filter((r) => r.upd_number).forEach((r) => put({ src: ["приёмка"], rcp: r.id, number: r.upd_number, date: (r.finished_at || r.created).slice(0, 10), supplier: r.supplier, note: "", by: "", created: r.created }));
  let L = out; if (W.length) L = L.filter((o) => hitAll(W, [o.number, o.supplier, o.note, o.skk ? o.skk.number : ""].join(" ")));
  const miss = L.filter((o) => !o.skk).length;
  if (mode === "miss") L = L.filter((o) => !o.skk); else if (mode === "ok") L = L.filter((o) => !!o.skk);
  L.sort((a, b) => (b.date + b.created > a.date + a.created ? 1 : -1));
  return { items: L.slice(0, 1000), total: L.length, miss, all: out.length };
}
// уведомления «акт по моей заявке»: раньше — полный пересчёт каждую минуту с каждого устройства; теперь — только когда что-то изменилось
function sig(app, uid) {
  const one = (sql, p) => { const r = rows(app, sql, { v: "" }, p); return r.length ? r[0].v : ""; };
  return [one("SELECT COALESCE(MAX(updated),'') || ':' || COUNT(*) AS v FROM acts"), one("SELECT COALESCE(MAX(updated),'') || ':' || COUNT(*) AS v FROM skk_acts"),
    one("SELECT COALESCE(MAX(updated),'') || ':' || COUNT(*) AS v FROM requests WHERE created_by = {:u}", { u: uid }), one("SELECT COALESCE(MAX(updated),'') || ':' || COUNT(*) AS v FROM request_items")].join("|");
}
function actAlertsCached(app, uid) {
  const k = "vs_actalerts_" + uid, s = sig(app, uid), st = app.store();
  const c = st.get(k); if (c && c.s === s && Date.now() - c.t < 6 * 3600 * 1000) return c.v;
  const v = require(`${__hooks}/lib1940.js`).actAlerts(app, uid); st.set(k, { s, t: Date.now(), v }); return v;
}
module.exports = { nk, core, org, sameOrg, skkIndex, findSkk, notInSkk, whinList, actAlertsCached, words };
