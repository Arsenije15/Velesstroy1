// VELESSTROY 1.9.40 — сверка по шифрам (заявки ↔ оперативка ↔ сводный отчёт ↔ МПЗ) и новые акты по моим заявкам
const LAT = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };
function codeN(s) {
  return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[abcehkmoptxy]/g, (ch) => LAT[ch]).replace(/о/g, "0")
    .replace(/[‐-―−]/g, "-").replace(/\s+/g, "").replace(/[.,;:-]+$/, "");
}
// в ячейке бывает несколько шифров через перенос строки / «;»
function codesOf(s) { return String(s || "").split(/[\n;]+|\s{2,}|,\s*(?=[A-Za-zА-Яа-я]{2})/).map((x) => x.trim()).filter((x) => x.length >= 4); }
function q(app, sql, proto) { const rows = arrayOf(new DynamicModel(proto)); app.db().newQuery(sql).all(rows); return JSON.parse(JSON.stringify(rows)); }   // обычные объекты — к ним можно добавлять поля
// 1.9.45: has — только строки нужных шифров: сначала разные шифры (их сотни), потом строки только этих шифров
function q2(app, sql, proto, vals, col) {
  if (!vals) return q(app, sql.replace("{IN}", "1=1"), proto);
  const out = [];
  for (let i = 0; i < vals.length; i += 200) {
    const part = vals.slice(i, i + 200), P = {}; part.forEach((v, j) => { P["p" + j] = v; });
    const rows = arrayOf(new DynamicModel(proto)); app.db().newQuery(sql.replace("{IN}", col + " IN (" + part.map((_, j) => "{:p" + j + "}").join(",") + ")")).bind(P).all(rows);
    JSON.parse(JSON.stringify(rows)).forEach((r) => out.push(r));
  }
  return out;
}
function load(app, has) {
  const pick = (sql) => has ? q(app, sql, { c: "" }).map((r) => r.c).filter(has) : null;
  const run = (sql, col, proto, vals) => (vals && !vals.length) ? [] : q2(app, sql, proto, vals, col);
  const ar = run("SELECT id, project_code, material, unit, qty, qty_issued, opp_no, omts_no, req_date, recipient, status FROM request_archive WHERE project_code != '' AND {IN}", "project_code",
    { id: "", project_code: "", material: "", unit: "", qty: 0.1, qty_issued: 0.1, opp_no: "", omts_no: "", req_date: "", recipient: "", status: "" }, pick("SELECT DISTINCT project_code AS c FROM request_archive WHERE project_code != ''"));
  const it = run("SELECT ri.id AS id, r.id AS rid, ri.objcode AS code, ri.material AS material, ri.unit AS unit, ri.qty_ordered AS qty, ri.qty_issued AS qty_issued, r.number AS number, r.status AS status, r.req_date AS req_date, r.recipient AS recipient FROM request_items ri JOIN requests r ON r.id = ri.request WHERE ri.objcode != '' AND {IN}", "ri.objcode",
    { id: "", rid: "", code: "", material: "", unit: "", qty: 0.1, qty_issued: 0.1, number: "", status: "", req_date: "", recipient: "" }, pick("SELECT DISTINCT objcode AS c FROM request_items WHERE objcode != ''"));
  const op = run("SELECT id, code, pid, name_proj, name_supp, name_1c, unit, qty, qty_delivered, torg, upd_keys, supplier, object, subobject FROM oper_rows WHERE code != '' AND {IN}", "code",
    { id: "", code: "", pid: "", name_proj: "", name_supp: "", name_1c: "", unit: "", qty: 0.1, qty_delivered: 0.1, torg: "", upd_keys: "", supplier: "", object: "", subobject: "" }, pick("SELECT DISTINCT code AS c FROM oper_rows WHERE code != ''"));
  return { ar, it, op };
}
// 1.9.45: подпись данных — если таблицы не менялись, список шифров берётся из памяти сервера (не пересчитывается)
function sig(app) {
  const one = (sql) => { const r = new DynamicModel({ n: 0, m: "" }); try { app.db().newQuery(sql).one(r); } catch (_) {} return r.n + "/" + r.m; };
  return [one("SELECT count(*) AS n, COALESCE(max(updated),'') AS m FROM request_archive"), one("SELECT count(*) AS n, COALESCE(max(updated),'') AS m FROM request_items"), one("SELECT count(*) AS n, COALESCE(max(updated),'') AS m FROM oper_rows")].join("|");
}
function codesList(app) {
  const sg = sig(app), st = app.store();
  try { const c = st.get("vs_codes_list"); if (c && c.sig === sg) return JSON.parse(c.json); } catch (_) {}
  const out = codesListCalc(app);
  try { st.set("vs_codes_list", { sig: sg, json: JSON.stringify(out) }); } catch (_) {}
  return out;
}
function codesListCalc(app) {
  const D = load(app); const M = {}, CO = {};
  const add = (raw, src) => (CO[raw] || (CO[raw] = codesOf(raw))).forEach((c) => { const n = codeN(c); if (n.length < 5) return; const o = M[n] = M[n] || { code: c, n, req: 0, app: 0, oper: 0 }; o[src]++; });
  D.ar.forEach((r) => add(r.project_code, "req")); D.it.forEach((r) => add(r.code, "app")); D.op.forEach((r) => add(r.code, "oper"));
  return Object.keys(M).map((k) => M[k]).sort((a, b) => (b.req + b.app + b.oper) - (a.req + a.app + a.oper)).slice(0, 3000);
}
function codeReport(app, code) {
  const Z = require(`${__hooks}/lib19.js`);
  const qn = codeN(code); if (qn.length < 3) throw new BadRequestError("Укажите шифр (не меньше 3 знаков).");
  const HC = {};   // 1.9.45: шифров немного, строк много — проверяем каждый разный шифр один раз
  const has = (raw) => { let v = HC[raw]; if (v === undefined) v = HC[raw] = codesOf(raw).some((c) => codeN(c).indexOf(qn) >= 0) || codeN(raw).indexOf(qn) >= 0; return v; };
  const D = load(app, has);
  const G = {};   // группы по материалу из заявок
  const key = (m, u) => Z.toks(m).join(" ") + "|" + String(u || "").toLowerCase().trim();
  const addReq = (m, u, ord, iss, ref) => { const k = key(m, u); const g = G[k] = G[k] || { material: m, unit: u || "", ordered: 0, issued: 0, reqs: [] }; g.ordered += ord || 0; g.issued += iss || 0; if (g.reqs.length < 40) g.reqs.push(ref); };
  D.ar.forEach((r) => { if (has(r.project_code)) addReq(r.material, r.unit, r.qty, r.qty_issued, { no: r.omts_no || r.opp_no, date: r.req_date, who: r.recipient, code: r.project_code, src: "архив", qty: r.qty, iss: r.qty_issued, status: r.status }); });
  D.it.forEach((r) => { if (has(r.code)) addReq(r.material, r.unit, r.qty, r.qty_issued, { no: r.number, date: String(r.req_date).slice(0, 10), who: r.recipient, code: r.code, src: "заявка", id: r.rid, qty: r.qty, iss: r.qty_issued, status: r.status }); });
  const OP0 = D.op.filter((r) => has(r.code));
  // 1.9.45: слишком общий шифр («ВС.24») — тысячи материалов, сервер считал бы минутами и всё «висло». Просим уточнить.
  const nG = Object.keys(G).length;
  if (nG > 250 || OP0.length > 3000) {
    const ok = Object.keys(HC).filter((k) => HC[k]); const cnt = {};
    D.ar.forEach((r) => { cnt[r.project_code] = (cnt[r.project_code] || 0) + 1; }); D.it.forEach((r) => { cnt[r.code] = (cnt[r.code] || 0) + 1; }); OP0.forEach((r) => { cnt[r.code] = (cnt[r.code] || 0) + 1; });
    const top = ok.sort((x, y) => (cnt[y] || 0) - (cnt[x] || 0)).slice(0, 5);
    throw new BadRequestError("Шифр «" + code + "» слишком общий: под него подходит " + ok.length + " шифров (" + nG + " материалов в заявках, " + OP0.length + " строк оперативки). Укажите шифр точнее, например: " + top.join(" · "));
  }
  const OP = OP0.map((r) => { const nm = [r.name_proj, r.name_supp, r.name_1c].filter(Boolean); const TA = nm.map((n) => Z.toks(n)); return Object.assign(r, { T: nm.map((n) => Z.tokset(n)), TA, TN: TA.map((A) => { const N = {}; A.forEach((w) => { if (/\d/.test(w)) N[w] = 1; }); return N; }) }); });
  // МПЗ (текущая выгрузка) и сводный отчёт прихода
  const MP = q(app, "SELECT name, code, unit, qty_end, warehouse FROM mpz_stock ORDER BY rowid", { name: "", code: "", unit: "", qty_end: 0.1, warehouse: "" });
  // 1.9.45: слова названий МПЗ разбираются один раз на выгрузку и хранятся в памяти сервера
  let TOK = null; let hsh = 0; MP.forEach((m) => { const n = m.name; for (let i = 0; i < n.length; i++) hsh = (hsh * 31 + n.charCodeAt(i)) | 0; }); const msg = MP.length + "/" + hsh;
  try { const c = app.store().get("vs_mpz_tok"); if (c && c.sig === msg) TOK = JSON.parse(c.json); } catch (_) {}
  if (!TOK || TOK.length !== MP.length) { TOK = MP.map((m) => Z.toks(m.name)); try { app.store().set("vs_mpz_tok", { sig: msg, json: JSON.stringify(TOK) }); } catch (_) {} }
  const nums = (A) => A.filter((w) => /\d/.test(w));
  const IDX = {};   // слово (первые 5 букв) → строки МПЗ: сравниваем только с теми, где есть общее редкое слово
  // 1.9.45: разбираем на слова только строки МПЗ, где есть хоть одно слово из искомых названий
  const NEED = {}; const needOf = (n) => Z.toks(n).forEach((w) => { NEED[w.slice(0, 5)] = 1; });
  Object.keys(G).forEach((k) => needOf(G[k].material)); OP.forEach((r) => [r.name_proj, r.name_supp, r.name_1c].forEach((n) => { if (n) needOf(n); }));
  const quick = (A) => A.some((w) => NEED[w.slice(0, 5)]);
  MP.forEach((m, i) => { if (!quick(TOK[i])) { m.skip = 1; return; } m.A = TOK[i]; m.S = { n: m.A.length, w: {} }; m.A.forEach((w) => { m.S.w[w] = 1; m.S.w[w.slice(0, 5)] = 1; }); m.N = {}; nums(m.A).forEach((w) => m.N[w] = 1);
    const seen = {}; m.A.forEach((w) => { const k = w.slice(0, 5); if (seen[k]) return; seen[k] = 1; (IDX[k] = IDX[k] || []).push(i); }); });
  const UR = q(app, "SELECT number_n, supplier, keeper, recv_date, status, doc_date, gm_no FROM ureg", { number_n: "", supplier: "", keeper: "", recv_date: "", status: "", doc_date: "", gm_no: "" });
  const urBy = {}; UR.forEach((u) => { const k = u.number_n.replace(/[^0-9a-zа-я]/g, ""); if (k) (urBy[k] = urBy[k] || []).push(u); });
  const eso = (keys) => { const out = []; String(keys || "").split("|").filter(Boolean).forEach((k) => { const kk = k.toLowerCase().replace(/^#/, ""); (urBy[kk] || []).forEach((u) => { if (out.length < 6) out.push({ no: u.number_n, gm: u.gm_no, keeper: u.keeper, date: String(u.recv_date).slice(0, 10), status: u.status, supplier: u.supplier }); }); }); return out; };
  // размеры и марки (всё, где есть цифры) должны совпасть полностью: «D 6 L 40» ≠ «D 8 L 60»
  const numOk = (An, N) => An.every((w) => N[w]);
  // все слова заявки есть в названии 1С (там ещё «25 кг», ГОСТ…) — тоже совпадение
  const mpzOf = (names) => { const best = {}, near = {};
    names.forEach((n) => { const A = Z.toks(n); if (A.length < 2) return; const SA = Z.tokset(n), An = nums(A);
      let cand = null; A.forEach((w) => { const L = IDX[w.slice(0, 5)]; if (L && (!cand || L.length < cand.length)) cand = L; }); if (!cand) return;
      cand.forEach((i) => { const m = MP[i]; const c1 = A.filter((w) => m.S.w[w] || (w.length > 5 && m.S.w[w.slice(0, 5)])).length / A.length, v = Math.max((Z.simT(A, m.S) + Z.simT(m.A, SA)) / 2, c1 >= 0.99 ? 0.85 : 0); if (!numOk(An, m.N)) { if (v >= 0.75 && (!near[i] || near[i] < v)) near[i] = v; return; } if (v >= 0.7 && (!best[i] || best[i] < v)) best[i] = v; }); });
    const mk = (o) => Object.keys(o).map((i) => { const m = MP[i]; return { name: m.name, code: m.code, unit: m.unit, qty: m.qty_end, wh: m.warehouse, s: Math.round(o[i] * 100) / 100 }; }).sort((a, b) => b.s - a.s);
    const r = mk(best).slice(0, 8); r.near = mk(near).filter((x) => !best[x.name]).slice(0, 4); return r; };
  const used = {};
  const groups = Object.keys(G).map((k) => {
    const g = G[k]; const A = Z.toks(g.material), SA = Z.tokset(g.material), An = nums(A);
    const op = []; OP.forEach((r) => { let s = 0; r.T.forEach((T, i) => { if (!numOk(An, r.TN[i])) return; const v = (Z.simT(A, T) + Z.simT(r.TA[i], SA)) / 2; if (v > s) s = v; }); if (s >= 0.6) { used[r.id] = 1; op.push({ name: r.name_1c || r.name_supp || r.name_proj, unit: r.unit, qty: r.qty, delivered: r.qty_delivered, torg: r.torg, supplier: r.supplier, pid: r.pid, eso: eso(r.upd_keys), s: Math.round(s * 100) / 100 }); } });
    op.sort((a, b) => b.s - a.s);
    const mp = mpzOf([g.material].concat(op.slice(0, 3).map((o) => o.name)));
    const stock = mp.filter((m) => m.s >= 0.75).reduce((a, m) => a + m.qty, 0);
    const need = Math.max(0, Math.round((g.ordered - g.issued) * 1000) / 1000);
    const st = need <= 0 ? "issued" : stock >= need ? "stock" : stock > 0 ? "part" : op.some((o) => o.delivered > 0) ? "gone" : "none";
    return { near: mp.near || [], material: g.material, unit: g.unit, ordered: Math.round(g.ordered * 1000) / 1000, issued: Math.round(g.issued * 1000) / 1000, need, stock: Math.round(stock * 1000) / 1000, st, reqs: g.reqs, oper: op.slice(0, 8), mpz: mp };
  });
  const ORD = { stock: 0, part: 1, gone: 2, none: 3, issued: 4 };
  groups.sort((a, b) => ORD[a.st] - ORD[b.st] || a.material.localeCompare(b.material));
  // поставлено под шифр, а заявок на это нет — тоже «есть на складе по шифру»
  const extra = OP.filter((r) => !used[r.id] && r.qty_delivered > 0).slice(0, 300).map((r) => { const mp = mpzOf([r.name_1c || r.name_supp || r.name_proj]); return { name: r.name_1c || r.name_supp || r.name_proj, unit: r.unit, qty: r.qty, delivered: r.qty_delivered, torg: r.torg, supplier: r.supplier, pid: r.pid, eso: eso(r.upd_keys), stock: Math.round(mp.filter((m) => m.s >= 0.75).reduce((a, m) => a + m.qty, 0) * 1000) / 1000, mpz: mp.slice(0, 3) }; });
  const codes = {}; const seenC = {}; D.ar.concat(D.it.map((x) => ({ project_code: x.code }))).concat(OP.map((x) => ({ project_code: x.code }))).forEach((r) => { if (seenC[r.project_code]) return; seenC[r.project_code] = 1; codesOf(r.project_code).forEach((c) => { if (codeN(c).indexOf(qn) >= 0) codes[c] = 1; }); });
  return { code, codes: Object.keys(codes).slice(0, 30), groups, extra, oper_rows: OP.length, mpz_rows: MP.length, eso_rows: UR.length };
}
// новые акты (журнал актов и акты СКК), появившиеся ПОСЛЕ создания моей открытой заявки и подходящие к её позиции
function actAlerts(app, uid) {
  const Z = require(`${__hooks}/lib19.js`), X = require(`${__hooks}/lib_ext.js`);
  const reqs = app.findRecordsByFilter("requests", "status = 'open' && created_by = {:u}", "-created", 200, 0, { u: uid });
  if (!reqs.length) return [];
  const oldest = reqs.map((r) => r.getString("created")).sort()[0];
  const pool = [];
  app.findRecordsByFilter("acts", "open = true && created >= {:d}", "-created", 3000, 0, { d: oldest }).forEach((x) => pool.push({ id: x.id, src: "журнал", t: x.getString("created"), no: x.getString("act_no"), date: x.getString("act_date").slice(0, 10), supplier: x.getString("supplier"), material: x.getString("material"), reason: x.getString("reason") }));
  app.findRecordsByFilter("skk_acts", "status = 'open' && created >= {:d}", "-created", 1000, 0, { d: oldest }).forEach((x) => {
    let rows = []; try { rows = JSON.parse(x.getString("rows") || "[]") || []; } catch (_) {}
    rows.forEach((r) => { if (r.material && !r.fixed) pool.push({ id: x.id, src: "СКК", t: x.getString("created"), no: x.getString("number"), date: x.getString("date").slice(0, 10), supplier: x.getString("supplier"), material: r.material, reason: r.issue || "" }); });
  });
  if (!pool.length) return [];
  pool.forEach((p) => { p.T = Z.toks(p.material); p.S = Z.tokset(p.material); });
  const byId = {}; pool.forEach((p) => { if (p.src === "журнал") byId[p.id] = p; });
  const out = [], seen = {};
  reqs.forEach((r) => {
    const rc = r.getString("created");
    app.findRecordsByFilter("request_items", "request = {:r}", "sort", 300, 0, { r: r.id }).forEach((it) => {
      const m = it.getString("material"), A = Z.toks(m), SA = Z.tokset(m);
      const push = (p, why) => { if (p.t < rc) return; const k = r.id + "|" + p.src + p.no + "|" + it.id; if (seen[k]) return; seen[k] = 1;
        out.push({ request: r.id, number: r.getString("number"), item: it.id, material: m, act_no: p.no, act_date: p.date, act_src: p.src, act_id: p.id, supplier: p.supplier, act_material: p.material, reason: p.reason, why, t: p.t }); };
      if (it.getString("supply_doc")) X.findActs(app, it.getString("supply_doc"), it.getString("supplier")).forEach((a) => { const p = byId[a.id]; if (p) push(p, "УПД и поставщик"); });
      if (A.length >= 2) pool.forEach((p) => { const s = (Z.simT(A, p.S) + Z.simT(p.T, SA)) / 2; if (s >= 0.72) push(p, "материал"); });
    });
  });
  out.sort((a, b) => (b.t > a.t ? 1 : -1));
  return out.slice(0, 50);
}
module.exports = { codeN, codesOf, codesList, codeReport, actAlerts };
