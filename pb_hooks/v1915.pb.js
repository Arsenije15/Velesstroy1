/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.15 — проверка «есть ли акт на материал», невыданное по заявкам, правка отгрузки

// ---------- Есть ли акт несоответствия на этот материал (журнал актов + открытые акты СКК) ----------
routerAdd("POST", "/api/vs/actcheck", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const Z = require(`${__hooks}/lib19.js`);
  const a = L.requireRole(e, ["admin", "manager", "storekeeper", "viewer", "skk", "skk_view"]);
  const b = e.requestInfo().body || {};
  const names = (Array.isArray(b.names) ? b.names : []).map((x) => L.str(x).slice(0, 500)).slice(0, 300);
  const pool = [];
  $app.findRecordsByFilter("acts", "open = true", "-act_date", 5000, 0).forEach((x) => pool.push({ no: x.getString("act_no"), date: x.getString("act_date").slice(0, 10), supplier: x.getString("supplier"),
    material: x.getString("material"), reason: x.getString("reason"), status: x.getString("doc_status") || "не устранено", src: "журнал" }));
  $app.findRecordsByFilter("skk_acts", "status = 'open'", "-date", 2000, 0).forEach((x) => {
    let rows = []; try { rows = JSON.parse(x.getString("rows") || "[]") || []; } catch (_) {}
    rows.forEach((r) => { if (!r.fixed && !r.whole && r.material) pool.push({ no: x.getString("number"), date: x.getString("date").slice(0, 10), supplier: x.getString("supplier"), material: r.material, reason: r.issue || "", status: "не устранено", src: "СКК", id: x.id }); });
  });
  pool.forEach((p) => { p.T = Z.toks(p.material); p.S = Z.tokset(p.material); });
  const out = names.map((n) => {
    const A = Z.toks(n), SA = Z.tokset(n); if (A.length < 2) return [];
    const hits = [];
    pool.forEach((p) => { const s = (Z.simT(A, p.S) + Z.simT(p.T, SA)) / 2; if (s >= 0.72) hits.push({ s: Math.round(s * 100) / 100, no: p.no, date: p.date, supplier: p.supplier, material: p.material, reason: p.reason, status: p.status, src: p.src, id: p.id || "" }); });
    hits.sort((x, y) => y.s - x.s);
    const seen = {}; return hits.filter((h) => { const k = h.src + h.no; if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 5);
  });
  return e.json(200, { results: out });
}, $apis.requireAuth("users"));

// ---------- Невыданное по заявкам: выдать без заявки / убрать из списка ----------
routerAdd("POST", "/api/vs/leftover/issue", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const v = tx.findRecordById("leftovers", L.str(b.id));
    if (v.getString("status") !== "open") throw new BadRequestError("Эта позиция уже закрыта.");
    const left = Math.round((v.getFloat("qty") - v.getFloat("issued")) * 1000) / 1000;
    const act = L.str(b.action) || "issue";
    let log = []; try { log = JSON.parse(v.getString("log") || "[]") || []; } catch (_) {}
    if (act === "issue") {
      const q = Math.round(parseFloat(String(b.qty).replace(",", ".")) * 1000) / 1000;
      if (!(q > 0)) throw new BadRequestError("Укажите количество больше нуля.");
      if (q > left + 1e-9) throw new BadRequestError("Осталось только " + String(left).replace(".", ",") + " " + v.getString("unit") + ".");
      const to = L.str(b.to).slice(0, 200); if (!to) throw new BadRequestError("Укажите, кому выдано (бригада / получатель).");
      v.set("issued", Math.round((v.getFloat("issued") + q) * 1000) / 1000);
      log.push({ at: L.fmt(new Date()), qty: q, to: to, note: L.str(b.note).slice(0, 300), by: L.userName(a) });
      if (v.getFloat("issued") + 1e-9 >= v.getFloat("qty")) v.set("status", "done");
      L.log(tx, a, "leftover_issue", "requests", v.getString("request"), "Невыданное по заявке № " + v.getString("number") + ": «" + v.getString("material").slice(0, 80) + "» выдано " + q + " " + v.getString("unit") + " — " + to, {});
    } else if (act === "close") {
      const why = L.str(b.note); if (!why) throw new BadRequestError("Напишите, почему позиция убирается из списка.");
      log.push({ at: L.fmt(new Date()), qty: 0, to: "", note: "Убрано из списка: " + why, by: L.userName(a) }); v.set("status", "done");
      L.log(tx, a, "leftover_close", "requests", v.getString("request"), "Невыданное по заявке № " + v.getString("number") + ": «" + v.getString("material").slice(0, 80) + "» убрано из списка — " + why, {});
    } else throw new BadRequestError("Неизвестное действие.");
    v.set("log", log); tx.save(v);
    out = { status: v.getString("status"), issued: v.getFloat("issued") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Изменить отгрузку (машина, водитель, позиции) — и когда она уже отправлена или доставлена ----------
routerAdd("POST", "/api/vs/shipment/update", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("request_shipments", L.str(b.shipment));
    const st = s.getString("status");
    if (st === "cancelled") throw new BadRequestError("Отгрузка отменена — изменить нельзя.");
    if (st === "delivered" && ["admin", "manager"].indexOf(L.role(a)) < 0 && !L.isSuper(a)) throw new ForbiddenError("Доставленную отгрузку меняет руководитель или администратор.");
    const ch = [];
    const vehicle = L.str(b.vehicle); if (!vehicle) throw new BadRequestError("Укажите машину.");
    if (vehicle !== s.getString("vehicle")) { ch.push("машина: " + s.getString("vehicle") + " → " + vehicle); s.set("vehicle", vehicle); }
    if (L.str(b.driver) !== s.getString("driver")) { ch.push("водитель: " + (L.str(b.driver) || "—")); s.set("driver", L.str(b.driver)); }
    if (b.note !== undefined && L.str(b.note) !== s.getString("note")) { ch.push("примечание"); s.set("note", L.str(b.note)); }
    if (b.hours !== undefined && b.hours !== "") { const h = parseFloat(String(b.hours).replace(",", ".")); if (!(h > 0) || h > 72) throw new BadRequestError("Время в пути — от 0,5 до 72 ч."); if (h !== s.getFloat("hours")) { ch.push("в пути " + h + " ч"); s.set("hours", h); } }
    if (Array.isArray(b.lines)) {
      const old = X.jsonArr(s, "lines"), nl = [];
      old.forEach((l) => {
        const x = b.lines.filter((y) => L.str(y && y.item) === l.item)[0];
        let q = x ? Math.round(parseFloat(String(x.qty).replace(",", ".")) * 1000) / 1000 : 0; if (isNaN(q) || q < 0) q = 0;
        if (q === l.qty) { nl.push(l); return; }
        // доставленная и выдача записана в заявку — меняем и выданное в заявке на разницу
        if (st === "delivered" && s.getBool("issue_done")) {
          const it = tx.findRecordById("request_items", l.item), rq = tx.findRecordById("requests", it.getString("request"));
          if (rq.getString("status") !== "open") throw new BadRequestError("Заявка № " + rq.getString("number") + " закрыта — сначала откройте её повторно, чтобы поправить выданное по «" + l.material + "».");
          const nv = Math.round((it.getFloat("qty_issued") + q - l.qty) * 1000) / 1000;
          if (nv < 0) throw new BadRequestError("«" + l.material + "»: выданное станет меньше нуля.");
          it.set("qty_issued", nv); tx.save(it);
        }
        ch.push("«" + String(l.material).slice(0, 60) + "»: " + l.qty + " → " + (q || "снято") + " " + l.unit);
        if (q > 0) { l.qty = q; nl.push(l); }
      });
      if (!nl.length) throw new BadRequestError("В отгрузке должна остаться хотя бы одна позиция (или отмените отгрузку).");
      s.set("lines", nl);
    }
    if (!ch.length) { out = { changed: 0 }; return; }
    tx.save(s);
    L.log(tx, a, "shipment_edit", "requests", s.getString("request"), "Отгрузка " + s.getString("vehicle") + " изменена: " + ch.join("; ") + (L.str(b.reason) ? " — " + L.str(b.reason) : ""), { shipment: s.id });
    out = { changed: ch.length };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
