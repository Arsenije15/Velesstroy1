// VELESSTROY 1.9.64 — помощник отвечает с доказательствами: заявки (кто, когда, сколько выдано), фото (подписанная заявка,
// погрузка, позиция), пропуска, УПД с фото, флажки с фото. И новый инструмент: «сколько и по каким заявкам выдан материал».
const lc = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
// основа слова: «штукатурки» → «штукатурк», «арматуры» → «арматур», «кабеля» → «кабел» (иначе LIKE не находит другую форму)
function stem(w) {
  if (!/^[а-я]+$/.test(w) || w.length < 6) return w;
  const s = w.replace(/(ами|ями|ого|его|ому|ему|ыми|ими|ой|ей|ый|ий|ая|яя|ое|ее|ые|ие|ую|юю|ам|ям|ом|ем|ах|ях|ов|ев|а|я|ы|и|е|о|у|ю|ь|й)$/, "");
  return s.length >= 4 ? s : w;
}
function W(q) { return lc(q).replace(/[^0-9a-zа-я.,\/\-\s×х]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 6).map(stem); }
function rows(app, sql, model, P) { const R = arrayOf(new DynamicModel(model)); const q = app.db().newQuery(sql); if (P) q.bind(P); q.all(R); return JSON.parse(JSON.stringify(R)); }
function like(col, ws, pre) { const P = {}; pre = pre || "w"; const s = ws.map((w, i) => { P[pre + i] = "%" + w + "%"; return col + " LIKE {:" + pre + i + "}"; }).join(" AND "); return { s: s || "1=1", P }; }
function inList(ids, pre) { const P = {}; const s = ids.map((id, i) => { P[pre + i] = id; return "{:" + pre + i + "}"; }).join(","); return { s: s || "''", P }; }
const n3 = (v) => Math.round((+v || 0) * 1000) / 1000;
const dd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? m[3] + "." + m[2] + "." + m[1] : ""; };
const ST = { open: "открыта", closed: "закрыта", cancelled: "отменена" };
const KIND = { signed: "подписанная заявка", close: "при закрытии", shipment: "погрузка", item: "фото позиции", other: "файл" };
const isDoc = (f) => /\.(jpe?g|png|webp|gif|heic|pdf)$/i.test(f || "");
const files = (v) => { const s = String(v || ""); if (!s) return []; if (s[0] === "[") { try { return JSON.parse(s) || []; } catch (_) { return []; } } return [s]; };

// ---------- выдача материала по заявкам ----------
function issues(app, q, days) {
  let ws = W(q); if (!ws.length) return { error: "пустой запрос" };
  days = parseInt(days, 10) || 0;
  const since = days > 0 ? new Date(Date.now() - Math.min(days, 3650) * 864e5).toISOString().replace("T", " ") : "";
  const M = { iid: "", rid: "", no: "", date: "", object: "", applicant: "", status: "", signed: false, material: "", unit: "", ordered: 0.5, issued: 0.5, issued_at: "", place: "", flag: "" };
  const run = (w) => { const L = like("i.search_lc", w); const P = Object.assign({ d: since }, L.P);
    return rows(app, "SELECT i.id AS iid, q.id AS rid, COALESCE(q.number,'') AS no, COALESCE(NULLIF(q.req_date,''), q.created) AS date, COALESCE(q.object,'') AS object, COALESCE(q.recipient,'') AS applicant, q.status AS status, COALESCE(q.signed_all, FALSE) AS signed, " +
      "COALESCE(i.material,'') AS material, COALESCE(i.unit,'') AS unit, COALESCE(i.qty_ordered,0) AS ordered, COALESCE(i.qty_issued,0) AS issued, COALESCE(i.issued_at,'') AS issued_at, COALESCE(i.pick_place,'') AS place, COALESCE(i.flag_mat,'') AS flag " +
      "FROM request_items i JOIN requests q ON q.id = i.request WHERE q.status != 'cancelled' AND " + L.s + (since ? " AND COALESCE(NULLIF(i.issued_at,''), q.created) >= {:d}" : "") + " ORDER BY COALESCE(NULLIF(i.issued_at,''), q.created) DESC LIMIT 500", M, P); };
  let R = run(ws), loose = "";
  if (!R.length && ws.length > 1) { const w1 = ws.slice().sort((a, b) => b.length - a.length)[0]; R = run([w1]); if (R.length) loose = w1; }
  const G = {}, order = [], T = {};
  R.forEach((r) => {
    let g = G[r.rid]; if (!g) { g = G[r.rid] = { id: r.rid, no: r.no, date: String(r.date).slice(0, 10), object: r.object, applicant: r.applicant, status: r.status, signed: !!r.signed, items: [] }; order.push(g); }
    g.items.push({ iid: r.iid, material: r.material, unit: r.unit, ordered: n3(r.ordered), issued: n3(r.issued), issued_at: String(r.issued_at).slice(0, 10), place: r.place, flag: r.flag });
    const u = lc(r.unit || "—"); T[u] = T[u] || { unit: r.unit || "—", issued: 0, ordered: 0 }; T[u].issued = n3(T[u].issued + (+r.issued || 0)); T[u].ordered = n3(T[u].ordered + (+r.ordered || 0));
  });
  const sum = (g, k) => { const s = {}; g.items.forEach((x) => { s[x.unit || "—"] = n3((s[x.unit || "—"] || 0) + x[k]); }); return Object.keys(s).map((u) => s[u] + " " + u).join(", "); };
  const withIssue = order.filter((g) => g.items.some((x) => x.issued > 0));
  return { query: q, words: ws, loose_by_word: loose || undefined, days: days || "всё время", requests_total: order.length, requests_with_issue: withIssue.length,
    totals: Object.keys(T).map((u) => T[u]),
    requests: order.slice(0, 40).map((g) => ({ no: g.no, date: dd(g.date), object: g.object, applicant: g.applicant, status: ST[g.status] || g.status, signed: g.signed,
      issued: sum(g, "issued"), ordered: sum(g, "ordered"), materials: g.items.map((x) => x.material).filter((v, i, A) => A.indexOf(v) === i).slice(0, 3) })),
    _groups: withIssue.concat(order.filter((g) => withIssue.indexOf(g) < 0)) };
}

// ---------- карточки-доказательства ----------
// заявки: позиции, фото (подписанная, закрытие, погрузка, фото найденных позиций), пропуска по заявке
function evReq(app, groups, max) {
  groups = (groups || []).slice(0, max || 10); if (!groups.length) return [];
  const ids = groups.map((g) => g.id), I = inList(ids, "r");
  const F = rows(app, "SELECT id, request, COALESCE(kind,'') AS kind, COALESCE(file,'') AS file, COALESCE(item,'') AS item FROM request_files WHERE request IN (" + I.s + ") ORDER BY created DESC LIMIT 400", { id: "", request: "", kind: "", file: "", item: "" }, I.P);
  const PL = ids.map((id, i) => "COALESCE(requests,'') LIKE {:pl" + i + "}").join(" OR "); const PP = Object.assign({}, I.P); ids.forEach((id, i) => { PP["pl" + i] = "%" + id + "%"; });
  const PS = rows(app, "SELECT id, COALESCE(title,'') AS title, COALESCE(no,'') AS no, COALESCE(status,'') AS status, COALESCE(request,'') AS request, COALESCE(requests,'') AS requests, COALESCE(date,'') AS date, COALESCE(confirmed_by_name,'') AS cby FROM passes WHERE request IN (" + I.s + ") OR " + PL + " ORDER BY created DESC LIMIT 100",
    { id: "", title: "", no: "", status: "", request: "", requests: "", date: "", cby: "" }, PP);
  const rank = { signed: 0, close: 1, shipment: 2, item: 3, other: 4 };
  return groups.map((g) => {
    const its = {}; (g.items || []).forEach((x) => { if (x.iid) its[x.iid] = 1; });
    const ph = F.filter((f) => f.request === g.id && isDoc(f.file) && (f.kind !== "item" || its[f.item]))
      .sort((a, b) => (rank[a.kind] || 9) - (rank[b.kind] || 9)).slice(0, 6).map((f) => ({ c: "request_files", id: f.id, f: f.file, k: KIND[f.kind] || "файл" }));
    const ps = PS.filter((p) => p.request === g.id || p.requests.indexOf(g.id) >= 0).slice(0, 4)
      .map((p) => ({ id: p.id, t: "🧾 " + (p.title || "Пропуск") + (p.date ? " от " + dd(p.date) : "") + " · " + (p.status === "confirmed" ? "подтверждён" + (p.cby ? " (" + p.cby + ")" : "") : "черновик") }));
    const st = ST[g.status] || g.status || "";
    return { t: "📋 Заявка № " + g.no + (g.date ? " · " + dd(g.date) : ""), h: "#/request/" + g.id,
      s: [g.object, g.applicant ? "заявитель: " + g.applicant : "", st, g.status === "closed" ? (g.signed ? "✍ подписи есть" : "⚠ без подписей") : ""].filter(Boolean).join(" · "),
      l: (g.items || []).slice(0, 8).map((x) => x.material + " — выдано " + x.issued + " из " + x.ordered + " " + (x.unit || "") + (x.issued_at ? " · " + dd(x.issued_at) : "") + (x.place ? " · " + x.place : "") + (x.flag ? " · с флажка: " + x.flag : "")),
      ph, ps, none: !ph.length && !ps.length ? "фото и пропусков по заявке нет" : "" };
  });
}
function evReqIds(app, ids, max) {   // по id заявок (поиск, открытые заявки): позиции подтягиваются
  ids = ids.filter((v, i, A) => v && A.indexOf(v) === i).slice(0, max || 6); if (!ids.length) return [];
  const I = inList(ids, "q");
  const R = rows(app, "SELECT id, COALESCE(number,'') AS no, COALESCE(NULLIF(req_date,''), created) AS date, COALESCE(object,'') AS object, COALESCE(recipient,'') AS applicant, status, COALESCE(signed_all, FALSE) AS signed FROM requests WHERE id IN (" + I.s + ")",
    { id: "", no: "", date: "", object: "", applicant: "", status: "", signed: false }, I.P);
  const IT = rows(app, "SELECT id AS iid, request, COALESCE(material,'') AS material, COALESCE(unit,'') AS unit, COALESCE(qty_ordered,0) AS ordered, COALESCE(qty_issued,0) AS issued, COALESCE(issued_at,'') AS issued_at, COALESCE(pick_place,'') AS place, COALESCE(flag_mat,'') AS flag FROM request_items WHERE request IN (" + I.s + ") ORDER BY sort, created",
    { iid: "", request: "", material: "", unit: "", ordered: 0.5, issued: 0.5, issued_at: "", place: "", flag: "" }, I.P);
  const by = {}; R.forEach((r) => { by[r.id] = { id: r.id, no: r.no, date: String(r.date).slice(0, 10), object: r.object, applicant: r.applicant, status: r.status, signed: !!r.signed, items: [] }; });
  IT.forEach((x) => { if (by[x.request]) by[x.request].items.push({ iid: x.iid, material: x.material, unit: x.unit, ordered: n3(x.ordered), issued: n3(x.issued), issued_at: String(x.issued_at).slice(0, 10), place: x.place, flag: x.flag }); });
  return evReq(app, ids.map((id) => by[id]).filter(Boolean), max);
}
// УПД: моя приёмка (фото из приёмки) и УПД СКК (файл УПД + фото)
function evUpd(app, list, max) {
  const seen = {}, out = [];
  (list || []).forEach((x) => { const m = /^#\/(receipt|upd)\/(\w+)/.exec(x.href || ""); if (!m) return; const k = m[1] + m[2];
    if (!seen[k]) { if (out.length >= (max || 8)) return; seen[k] = { kind: m[1], id: m[2], h: x.href, no: x.upd || x.number || "", sup: x.supplier || "", date: x.date || "", src: x.src || "", l: [] }; out.push(seen[k]); }
    if (x.name && seen[k].l.length < 6) seen[k].l.push(x.name + " — " + x.qty + " " + (x.unit || "")); else if (x.materials && !seen[k].l.length) seen[k].l = x.materials.slice(0, 6).map((mm) => typeof mm === "string" ? mm : (mm.name || "") + (mm.qty != null ? " — " + mm.qty + " " + (mm.unit || "") : "")); });
  if (!out.length) return [];
  const rc = out.filter((o) => o.kind === "receipt").map((o) => o.id), up = out.filter((o) => o.kind === "upd").map((o) => o.id);
  const A = rc.length ? (function () { const I = inList(rc, "a"); return rows(app, "SELECT id, receipt, COALESCE(file,'') AS file FROM attachments WHERE receipt IN (" + I.s + ") ORDER BY created LIMIT 200", { id: "", receipt: "", file: "" }, I.P); })() : [];
  const UP = up.length ? (function () { const I = inList(up, "u"); return rows(app, "SELECT id, upd, COALESCE(file,'') AS file FROM upd_photos WHERE upd IN (" + I.s + ") ORDER BY created LIMIT 200", { id: "", upd: "", file: "" }, I.P); })() : [];
  const UF = up.length ? (function () { const I = inList(up, "v"); return rows(app, "SELECT id, COALESCE(file,'') AS file, COALESCE(date,'') AS date FROM upd_docs WHERE id IN (" + I.s + ")", { id: "", file: "", date: "" }, I.P); })() : [];
  return out.map((o) => {
    let ph = [];
    if (o.kind === "receipt") ph = A.filter((a) => a.receipt === o.id && isDoc(a.file)).slice(0, 6).map((a) => ({ c: "attachments", id: a.id, f: a.file, k: "фото приёмки" }));
    else { const d = UF.filter((u) => u.id === o.id)[0]; if (d && isDoc(d.file)) ph.push({ c: "upd_docs", id: d.id, f: d.file, k: "УПД" });
      ph = ph.concat(UP.filter((p) => p.upd === o.id && isDoc(p.file)).slice(0, 5).map((p) => ({ c: "upd_photos", id: p.id, f: p.file, k: "фото" }))); }
    return { t: "📄 УПД № " + o.no + (o.date ? " · " + dd(o.date) : ""), h: o.h, s: [o.sup, o.src].filter(Boolean).join(" · "), l: o.l, ph, ps: [], none: ph.length ? "" : "фото нет" };
  });
}
// флажки на карте склада — с фото
function evFlags(app, q, max) {
  const ws = W(q); if (!ws.length) return [];
  const L = like("search_lc", ws, "f");
  return rows(app, "SELECT id, COALESCE(no,0) AS no, COALESCE(material,'') AS material, COALESCE(qty,'') AS qty, COALESCE(unit,'') AS unit, COALESCE(zone,'') AS zone, COALESCE(upd,'') AS upd, COALESCE(photo,'') AS photo FROM smap_flags WHERE COALESCE(old, FALSE) = FALSE AND " + L.s + " LIMIT " + (max || 4),
    { id: "", no: 0, material: "", qty: "", unit: "", zone: "", upd: "", photo: "" }, L.P)
    .map((f) => ({ t: "🚩 Флажок № " + f.no + (f.zone ? " · " + f.zone : ""), h: "#/map/f=" + f.id, s: f.upd ? "УПД " + f.upd : "", l: [f.material + (f.qty ? " — " + f.qty + " " + f.unit : "")],
      ph: files(f.photo).filter(isDoc).slice(0, 4).map((n) => ({ c: "smap_flags", id: f.id, f: n, k: "флажок" })), ps: [], none: files(f.photo).length ? "" : "фото нет" }));
}
module.exports = { W, stem, issues, evReq, evReqIds, evUpd, evFlags };
