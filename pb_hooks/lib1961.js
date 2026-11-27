/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.61 — «⚡ Пульт» (что открыто и чего не хватает) и пропуск по команде «пропуск 7015»
const ORG = "Велесстрой склад";
const SIGN_RU = { omts: "ОМТС", wh_head: "начальник склада", resp: "ответственный за выдачу", issued: "кладовщик (выдал)", received: "прораб (получил)" };
function rows(app, sql, model, params) { const R = arrayOf(new DynamicModel(model)); const q = app.db().newQuery(sql); if (params) q.bind(params); q.all(R); return JSON.parse(JSON.stringify(R)); }
function jobj(v) { if (v && typeof v === "object") return v; try { return JSON.parse(v || "{}") || {}; } catch (_) { return {}; } }
function jarr(v) { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch (_) { return []; } }
const days = (s) => { const t = Date.parse(String(s || "").replace(" ", "T")); return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 864e5)); };
const nk = (s) => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]/g, "");

// ---------- Пульт: заявки на почте, открытые, долг по подписям, приёмка, черновики пропусков ----------
function pult(app) {
  const RQM = { id: "", number: "", object: "", recipient: "", phone: "", created: "", handed_at: "", closed_at: "", signatures: "", status: "" };
  const RQS = "SELECT id, COALESCE(number,'') AS number, COALESCE(object,'') AS object, COALESCE(recipient,'') AS recipient, COALESCE(phone,'') AS phone, COALESCE(created,'') AS created, " +
    "COALESCE(handed_at,'') AS handed_at, COALESCE(closed_at,'') AS closed_at, COALESCE(signatures,'') AS signatures, COALESCE(status,'') AS status FROM requests ";
  const open = rows(app, RQS + "WHERE status = 'open' ORDER BY created DESC LIMIT 1000", RQM);
  const debt = rows(app, RQS + "WHERE status = 'closed' AND COALESCE(signed_all, 0) IN (0, 'false', '') ORDER BY closed_at DESC LIMIT 500", RQM);
  // по позициям: сколько, выдано ли что-то
  const IT = {}; rows(app, "SELECT i.request AS r, COUNT(*) AS n, SUM(COALESCE(i.qty_issued, 0)) AS iss FROM request_items i JOIN requests q ON q.id = i.request WHERE q.status = 'open' GROUP BY i.request",
    { r: "", n: 0, iss: 0.5 }).forEach((x) => { IT[x.r] = x; });
  // отгрузки открытых заявок без фото груза
  const SH = {}; rows(app, "SELECT s.id AS id, COALESCE(s.request,'') AS r, COALESCE(s.requests,'') AS rs, COALESCE(s.status,'') AS st, COALESCE(s.vehicle,'') AS v, " +
    "(SELECT COUNT(*) FROM request_files f WHERE f.shipment = s.id) AS nph FROM request_shipments s WHERE s.status IN ('preparing','sent','delivered') ORDER BY s.created DESC LIMIT 3000",
    { id: "", r: "", rs: "", st: "", v: "", nph: 0 }).forEach((s) => { const ids = [s.r].concat(jarr(s.rs)).filter(Boolean); ids.forEach((id) => { (SH[id] = SH[id] || []).push(s); }); });
  const sigMiss = (r, all) => { const s = jobj(r.signatures); return (all ? ["omts", "wh_head", "resp", "issued", "received"] : ["omts", "wh_head"]).filter((k) => !s[k]); };
  const reqItem = (r, kind) => {
    const miss = []; const it = IT[r.id] || { n: 0, iss: 0 };
    if (kind === "mail") { const d = days(r.created); miss.push({ k: "mail", t: "не передана на склад" + (d !== null ? " · на почте " + d + " дн." : "") }); }
    if (kind === "open") {
      const d = days(r.handed_at); if (d !== null && d >= 7) miss.push({ k: "late", t: "в работе " + d + " дн. — срок 7 дней вышел" });
      const sm = sigMiss(r, it.iss > 0); if (sm.length) miss.push({ k: "sign", t: "нет подписи: " + sm.map((k) => SIGN_RU[k]).join(", ") });
      (SH[r.id] || []).filter((s) => !s.nph).forEach((s) => miss.push({ k: "photo", t: "нет фото груза — отгрузка " + (s.v || "") + (s.st === "preparing" ? " (готовится)" : "") }));
      if (!it.n) miss.push({ k: "items", t: "нет позиций" });
    }
    if (kind === "debt") { const sm = sigMiss(r, true); miss.push({ k: "sign", t: "нет подписи: " + (sm.length ? sm.map((k) => SIGN_RU[k]).join(", ") : "—") }); }
    if (!String(r.phone || "").trim() && kind !== "debt") miss.push({ k: "phone", t: "нет телефона заявителя" });
    return { id: r.id, href: "#/request/" + r.id, no: r.number, t1: r.object, t2: r.recipient, at: kind === "open" ? r.handed_at : kind === "debt" ? r.closed_at : r.created, miss };
  };
  const mail = open.filter((r) => !r.handed_at).map((r) => reqItem(r, "mail"));
  const op = open.filter((r) => r.handed_at).map((r) => reqItem(r, "open"));
  const dt = debt.map((r) => reqItem(r, "debt"));
  // приёмка: открытые; фото УПД, фото груза, материалы, место выгрузки (флажок на карте)
  const RC = rows(app, "SELECT r.id AS id, COALESCE(r.upd_number,'') AS no, COALESCE(r.supplier,'') AS sup, COALESCE(r.status,'') AS st, COALESCE(r.created,'') AS created, COALESCE(r.upd_items,'') AS it, " +
    "(SELECT COUNT(*) FROM attachments a WHERE a.receipt = r.id AND a.kind = 'document') AS nd, (SELECT COUNT(*) FROM attachments a WHERE a.receipt = r.id AND a.kind = 'material') AS nm " +
    "FROM receipts r WHERE r.status IN ('in_progress','pending_approval','nonconformity') ORDER BY r.created DESC LIMIT 500",
    { id: "", no: "", sup: "", st: "", created: "", it: "", nd: 0, nm: 0 });
  const FL = rows(app, "SELECT COALESCE(material,'') AS m, COALESCE(upd,'') AS u, COALESCE(items,'') AS it FROM smap_flags", { m: "", u: "", it: "" })
    .map((f) => nk([f.m, f.u, jarr(f.it).map((x) => (x && x.d) || "").join(" ")].join(" ")));
  const rc = RC.map((r) => {
    const miss = []; const k = nk(r.no);
    if (r.st === "pending_approval") miss.push({ k: "approve", t: "ждёт согласования" });
    if (r.st === "nonconformity") miss.push({ k: "nc", t: "несоответствие — нужно решение" });
    if (!r.no) miss.push({ k: "upd", t: "нет № УПД" });
    if (!r.sup) miss.push({ k: "sup", t: "нет поставщика" });
    if (!r.nd) miss.push({ k: "photo", t: "нет фото УПД" });
    if (!r.nm) miss.push({ k: "photo", t: "нет фото груза" });
    if (!jarr(r.it).length) miss.push({ k: "items", t: "нет материалов" });
    if (k && !FL.some((f) => f.indexOf(k) >= 0)) miss.push({ k: "place", t: "не отмечено место выгрузки" });
    return { id: r.id, href: "#/receipt/" + r.id, no: r.no, t1: r.sup, t2: "", at: r.created, miss };
  });
  // черновики пропусков
  const PS = rows(app, "SELECT id, COALESCE(no,'') AS no, COALESCE(title,'') AS title, COALESCE(vehicle,'') AS v, COALESCE(head,'') AS h, COALESCE(mol,'') AS m, COALESCE(rows,'') AS rw, COALESCE(created,'') AS created, COALESCE(request,'') AS rq " +
    "FROM passes WHERE status = 'draft' ORDER BY created DESC LIMIT 300", { id: "", no: "", title: "", v: "", h: "", m: "", rw: "", created: "", rq: "" });
  const ps = PS.map((p) => { const miss = [{ k: "conf", t: "не подтверждён" }];
    if (!p.v) miss.push({ k: "veh", t: "нет машины" }); if (!p.h) miss.push({ k: "head", t: "нет руководителя" }); if (!jarr(p.rw).some((x) => x && x.n)) miss.push({ k: "items", t: "нет строк" });
    return { id: p.id, pass: p.id, href: "", no: p.no, t1: p.title, t2: "", at: p.created, miss }; });
  const tile = (L) => ({ n: L.length, bad: L.filter((x) => x.miss.some((m) => m.k !== "conf" && m.k !== "mail")).length, items: L.slice(0, 300) });
  return { mail: tile(mail), open: tile(op), debt: tile(dt), rcp: tile(rc), pass: tile(ps), at: new Date().toISOString() };
}

// ---------- «пропуск 7015 [1,2]»: черновик пропуска по заявке ----------
function findRequest(app, no) {
  const norm = String(no || "").toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
  if (!norm) throw new BadRequestError("Укажите номер заявки: «пропуск 7015».");
  let L = app.findRecordsByFilter("requests", "number_norm = {:n} && status != 'cancelled'", "-created", 5, 0, { n: norm });
  if (!L.length && /^\d{3,}$/.test(norm)) L = app.findRecordsByFilter("requests", "number_norm ~ {:n} && status = 'open'", "-created", 6, 0, { n: norm });
  if (!L.length) throw new NotFoundError("Заявка № " + no + " не найдена.");
  if (L.length > 1 && L[0].getString("number_norm") !== norm) return { many: L.map((r) => ({ id: r.id, number: r.getString("number"), object: r.getString("object") })) };
  return { r: L[0] };
}
function passDraft(app, auth, L, b) {
  const f = b.request ? { r: app.findRecordById("requests", String(b.request)) } : findRequest(app, b.no);
  if (f.many) return { many: f.many };
  const r = f.r; const pos = (Array.isArray(b.pos) ? b.pos : []).map((x) => parseInt(x, 10)).filter((x) => x > 0 && x < 1000);
  const items = app.findRecordsByFilter("request_items", "request = {:r}", "sort,created", 0, 0, { r: r.id });
  const pick = pos.length ? pos.map((i) => items[i - 1]).filter(Boolean) : items;
  if (pos.length && !pick.length) throw new BadRequestError("В заявке № " + r.getString("number") + " нет позиций " + pos.join(", ") + " (всего позиций: " + items.length + ").");
  const fq = (v) => { const n = Math.round(v * 1000) / 1000; return String(n).replace(".", ","); };
  const R = pick.map((i) => { const o = i.getFloat("qty_ordered"), s = i.getFloat("qty_issued"); const q = o - s > 0 ? o - s : o; const u = i.getString("unit");
    return { n: i.getString("material"), q: (u ? u + " " : "") + fq(q), t: "", w: r.getString("recipient"), d: r.getString("object"), item: i.id }; });
  // машина — из последней отгрузки по заявке; руководитель и МОЛ — из прошлого пропуска этого человека
  let veh = ""; try { const s = app.findRecordsByFilter("request_shipments", "request = {:r} || requests ~ {:r}", "-created", 1, 0, { r: r.id }); if (s.length) veh = s[0].getString("vehicle"); } catch (_) {}
  let head = "", mol = ""; try { const p = app.findRecordsByFilter("passes", "created_by = {:u}", "-created", 1, 0, { u: auth.id }); if (p.length) { head = p[0].getString("head"); mol = p[0].getString("mol"); } } catch (_) {}
  const title = ORG + " — заявка № " + r.getString("number");
  let p = null, replaced = false;
  const ex = app.findRecordsByFilter("passes", "request = {:r} && status = 'draft'", "-created", 1, 0, { r: r.id });
  if (ex.length) { p = ex[0]; if (pos.length) { p.set("rows", R); replaced = true; app.save(p); } }
  else {
    p = new Record(app.findCollectionByNameOrId("passes"));
    p.set("title", title); p.set("org", ORG); p.set("no", r.getString("number")); p.set("request", r.id); p.set("request_no", r.getString("number"));
    p.set("date", L.todayLocal()); p.set("vehicle", veh); p.set("rows", R); p.set("head", head); p.set("mol", mol || ORG); p.set("status", "draft");
    p.set("by_name", L.userName(auth)); p.set("created_by", auth.isSuperuser && auth.isSuperuser() ? "" : auth.id);
    app.save(p);
    L.log(app, auth, "pass_draft", "passes", p.id, "Пропуск (черновик): " + title + (pos.length ? ", позиции " + pos.join(", ") : ", все позиции"), {});
  }
  return { pass: JSON.parse(JSON.stringify(p)), existed: ex.length > 0, replaced, items: items.length };
}
module.exports = { pult, passDraft, findRequest, ORG };
