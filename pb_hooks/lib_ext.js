// VELESSTROY 1.2 — общие функции: акты несоответствия (разбор ТОРГ/УПД, поставщиков), подписи заявок.

// Подписи бумажной заявки на выдачу ТМЦ
const SIGNS = [
  ["omts", "Согласовано ОМТС"],
  ["wh_head", "Принято в работу — начальник склада"],
  ["resp", "Ответственный за выдачу ТМЦ"],
  ["issued", "Выдал (кладовщик)"],
  ["received", "Получил (прораб)"],
];

// Латинские буквы, похожие на кириллицу (в УПД их часто путают)
const LAT = { A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У" };
function cyr(s) { return String(s || "").toUpperCase().replace(/[ABCEHKMOPTXY]/g, (c) => LAT[c]).replace(/Ё/g, "Е"); }
function keyOf(token) { return cyr(token).replace(/[^0-9A-ZА-Я]/g, ""); }

// Из текста «М-15 №ЦБ-3722 от 15.11.2024», «УПД 9, 10 от 17.07.2026», «ЦБ-1748» → ["ЦБ3722"], ["9","10"], ["ЦБ1748"]
function updKeys(text) {
  let s = cyr(text).replace(/\s+/g, " ");
  s = s.replace(/(ОТ\s*)?\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\s*(Г\.?|ГОДА)?/g, " ");   // даты
  s = s.replace(/М\s*-?\s*15/g, " ").replace(/ТОРГ\s*-?\s*12/g, " ").replace(/УПД/g, " ").replace(/№/g, " ").replace(/(^|\s)ОТ(?=\s|$)/g, " ");
  const out = [];
  s.split(/[,;]|\sИ\s/).forEach((t) => {
    const k = keyOf(t);
    if (!k || !/\d/.test(k)) return;
    if (out.indexOf(k) < 0) out.push(k);
  });
  return out;
}
// Ключи для поиска: полный номер и (если есть буквенный префикс) только цифры
function updSearchKeys(text) {
  const keys = [];
  updKeys(text).forEach((k) => {
    if (keys.indexOf(k) < 0) keys.push(k);
    const d = k.replace(/^[А-Я]+/, "");
    if (d && d !== k && keys.indexOf("#" + d) < 0) keys.push("#" + d);
  });
  return keys;
}
function updKeysField(text) { const k = updSearchKeys(text); return k.length ? "|" + k.join("|") + "|" : ""; }

// Поставщик: без ООО/АО/ИП, кавычек, регистра, пробелов
const FORMS = ["ООО", "АО", "ПАО", "ЗАО", "ОАО", "ИП", "ПКФ", "НПО", "ТД", "ГК", "ПК"];
function supplierKey(s) {
  let t = cyr(s).replace(/[«»"'“”„`]/g, " ").replace(/[^0-9А-Я]+/g, " ").trim();
  t = t.split(" ").filter((w) => w && FORMS.indexOf(w) < 0).join("");
  return t.toLowerCase();
}
function supplierMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
  return s.length >= 4 && l.indexOf(s) >= 0;
}
function isOpenStatus(s) { const t = String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); return !t || t.indexOf("не устран") >= 0; }

// Поиск актов по УПД и поставщику (для приёмки)
function findActs(app, upd, supplier) {
  const sk = supplierKey(supplier);
  const keys = updKeys(upd);
  if (!keys.length) return [];
  const conds = [], params = {};
  keys.forEach((k, i) => {
    params["k" + i] = "|" + k + "|";
    conds.push("upd_keys ~ {:k" + i + "}");
    const d = k.replace(/^[А-Я]+/, "");
    if (sk && d) { params["d" + i] = "|#" + d + "|"; conds.push("upd_keys ~ {:d" + i + "}"); if (d !== k) { params["e" + i] = "|" + d + "|"; conds.push("upd_keys ~ {:e" + i + "}"); } }
  });
  const rows = app.findRecordsByFilter("acts", "(" + conds.join(" || ") + ")", "act_no", 200, 0, params);
  const out = [];
  rows.forEach((r) => {
    const rsk = r.getString("supplier_key");
    let level = "";
    if (sk && supplierMatch(sk, rsk)) level = "match";            // УПД + поставщик совпали
    else if (!sk) {                                               // поставщик не указан — только точный номер
      const exact = keys.some((k) => r.getString("upd_keys").indexOf("|" + k + "|") >= 0);
      if (exact) level = "upd_only";
    }
    if (!level) return;
    out.push({ id: r.id, act_no: r.getString("act_no"), act_date: r.getString("act_date"), supplier: r.getString("supplier"),
      torg: r.getString("torg"), material: r.getString("material"), qty: r.getString("qty"), unit: r.getString("unit"),
      reason: r.getString("reason"), doc_status: r.getString("doc_status"), act_status: r.getString("act_status"),
      open: r.getBool("open"), note: r.getString("note"), level: level });
  });
  return out;
}

// Текст для поиска без учёта регистра
const SEARCH = {
  requests: ["number", "object", "recipient", "note"],
  request_items: ["material", "supplier", "rd", "supply_doc"],
  acts: ["act_no", "supplier", "torg", "material", "reason", "project", "note"],
  receipts: ["upd_number", "supplier", "sender", "vehicle"],
  activity_log: ["summary", "user_name"],
};
function lc(s) { return String(s || "").toLowerCase().replace(/ё/g, "е"); }
function searchText(col, rec) { return lc((SEARCH[col] || []).map((f) => rec.getString(f)).join(" ")).slice(0, 6000); }

// ---------- 1.3: обход запрета (override) с объяснением — только администратор и руководитель ----------
// Все запреты собираются; если объяснение не дано или прав нет — ошибка «⛔ …» (клиент предлагает обход).
const OVR_ROLES = ["admin", "manager"];
function guard(L, a, b) {
  const can = L.isSuper(a) || OVR_ROLES.indexOf(L.role(a)) >= 0;
  return { a: a, reason: L.str(b && b.override).slice(0, 1000), can: can, msgs: [] };
}
function deny(g, msg) { if (g.msgs.indexOf(msg) < 0) g.msgs.push(msg); }
function check(g) {
  if (!g.msgs.length) return false;
  if (g.reason && g.can) return true;
  throw new ApiError(409, "⛔ " + g.msgs.join("\n⛔ ") + (g.can ? "" : "\nРазрешить может руководитель или администратор (с объяснением)."), {});
}
// Записать обход: в запись (поле overrides) и в журнал с пометкой «⚠ ОБХОД ЗАПРЕТА»
function ovrSave(L, tx, g, rec, entity, entityId, head) {
  if (!g.msgs.length) return;
  const n = { at: L.fmt(new Date()), by: L.authId(g.a), name: L.userName(g.a), what: head, rules: g.msgs.slice(), reason: g.reason };
  if (rec) {
    let arr = [];
    try { arr = JSON.parse(rec.getString("overrides") || "[]") || []; } catch (_) { arr = []; }
    arr.push(n); rec.set("overrides", arr); tx.save(rec);
  }
  L.log(tx, g.a, "override", entity, entityId, "⚠ ОБХОД ЗАПРЕТА — " + head + ": " + g.msgs.join("; ") + ". Объяснение: " + g.reason, n);
  remember(tx, "reason", g.reason);
}
// Конфликт брони: текст или "" (без исключения)
function conflictText(L, tx, res, s, e, excludeId) {
  if (res.getBool("unavailable")) return res.getString("name") + " НЕДОСТУПЕН: " + (res.getString("unavailable_reason") || "без указания причины");
  try { L.conflictCheck(tx, res, s, e, excludeId || ""); return ""; }
  catch (err) { return res.getString("name") + ": " + String((err && err.message) || err).replace(/^Error:\s*/, ""); }
}

// ---------- 1.3: память ручного ввода (подсказки для всех) ----------
function remember(app, field, value) {
  const v = String(value === undefined || value === null ? "" : value).replace(/[ \t\r]+/g, " ").replace(/ *\n */g, "\n").trim();
  if (!field || !v || v.length > 500) return;
  const key = (field + "|" + lc(v)).slice(0, 600);
  try {
    let r = null;
    try { r = app.findFirstRecordByFilter("suggestions", "key = {:k}", { k: key }); } catch (_) {}
    if (r) { r.set("uses", r.getInt("uses") + 1); r.set("value", v); }
    else { r = new Record(app.findCollectionByNameOrId("suggestions")); r.set("field", field); r.set("value", v); r.set("key", key); r.set("uses", 1); }
    r.set("last", new Date().toISOString().replace("T", " "));
    app.save(r);
  } catch (err) { console.log("remember failed: " + err); }
}
// Какие поля запоминать при сохранении записи
const REMEMBER = {
  requests: { object: "object", recipient: "recipient" },
  request_items: { material: "material", supplier: "supplier", unit: "unit", rd: "rd" },
  request_shipments: { vehicle: "vehicle", driver: "driver" },
  receipts: { supplier: "supplier", sender: "sender", vehicle: "vehicle" },
  reservations: { site: "site", purpose: "purpose", responsible: "responsible" },
};
function rememberRecord(app, rec) {
  const m = REMEMBER[rec.collection().name];
  if (!m) return;
  Object.keys(m).forEach((f) => remember(app, m[f], rec.getString(f)));
}

// ---------- 1.3: отгрузка (одна машина — позиции из нескольких заявок, свои этапы) ----------
function jsonArr(rec, f) { try { const v = JSON.parse(rec.getString(f) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function shipRequests(s) { const a = (s.getStringSlice("requests") || []).slice(); const p = s.getString("request"); if (p && a.indexOf(p) < 0) a.unshift(p); return a; }
function createShipment(L, tx, a, b) {
  const vehicle = L.str(b.vehicle);
  if (!vehicle) throw new BadRequestError("Укажите машину (марка, госномер).");
  const ids = (Array.isArray(b.resources) ? b.resources : []).map((x) => L.str(x)).filter(Boolean);
  const hours = parseFloat(String(b.hours === undefined || b.hours === "" ? "4" : b.hours).replace(",", "."));
  if (!(hours > 0) || hours > 72) throw new BadRequestError("Укажите время в пути от 0,5 до 72 часов.");
  const steps = (Array.isArray(b.steps) ? b.steps : []).map((x) => L.str(x).slice(0, 100)).filter(Boolean).slice(0, 20);
  const reqs = [], lines = [];
  const addReq = (r) => {
    if (r.getString("status") !== "open") throw new BadRequestError("Заявка № " + r.getString("number") + " не открыта — отгрузка по ней невозможна.");
    if (reqs.indexOf(r.id) < 0) reqs.push(r.id);
  };
  if (L.str(b.request)) addReq(tx.findRecordById("requests", L.str(b.request)));
  (Array.isArray(b.lines) ? b.lines : []).forEach((ln) => {
    const it = tx.findRecordById("request_items", L.str(ln && ln.item));
    const r = tx.findRecordById("requests", it.getString("request"));
    addReq(r);
    let q = Math.round(parseFloat(String(ln.qty === undefined || ln.qty === null || ln.qty === "" ? "" : ln.qty).replace(",", ".")) * 1000) / 1000;
    if (isNaN(q)) q = Math.max(0, Math.round((it.getFloat("qty_ordered") - it.getFloat("qty_issued")) * 1000) / 1000);
    if (!(q > 0)) throw new BadRequestError("Заявка № " + r.getString("number") + ", «" + it.getString("material") + "»: укажите количество больше нуля.");
    const ex = lines.filter((x) => x.item === it.id)[0];
    if (ex) { ex.qty = Math.round((ex.qty + q) * 1000) / 1000; return; }
    lines.push({ item: it.id, request: r.id, number: r.getString("number"), material: it.getString("material"), unit: it.getString("unit"), qty: q });
  });
  if (!reqs.length) throw new BadRequestError("Добавьте хотя бы одну позицию из заявки.");
  const names = ids.map((id) => tx.findRecordById("resources", id).getString("name"));
  const s = new Record(tx.findCollectionByNameOrId("request_shipments"));
  s.set("request", reqs[0]); s.set("requests", reqs); s.set("lines", lines);
  s.set("steps", steps.map((n) => ({ name: n, at: "", by: "", by_name: "" })));
  s.set("status", "preparing"); s.set("vehicle", vehicle); s.set("driver", L.str(b.driver));
  s.set("resource_ids", ids); s.set("reservation_ids", []); s.set("hours", Math.round(hours * 10) / 10); s.set("note", L.str(b.note));
  s.set("issue_done", false);
  if (L.authId(a)) s.set("created_by", a.id);
  tx.save(s);
  steps.forEach((n) => remember(tx, "step", n));
  if (steps.length) remember(tx, "steps_tpl", steps.join("\n"));
  remember(tx, "hours", String(Math.round(hours * 10) / 10).replace(".", ","));
  const nums = reqs.map((id) => tx.findRecordById("requests", id).getString("number"));
  L.log(tx, a, "shipment_prepare", "requests", reqs[0], "Готовится отгрузка — " + vehicle + (L.str(b.driver) ? ", водитель " + L.str(b.driver) : "") +
    "; заявки № " + nums.join(", ") + (lines.length ? " (" + lines.length + " поз.)" : "") + (names.length ? "; с собой: " + names.join(", ") : "") +
    (steps.length ? "; этапы: " + steps.join(" → ") : ""), { shipment: s.id, requests: reqs });
  return s;
}

module.exports = { OVR_ROLES, guard, deny, check, ovrSave, conflictText, remember, REMEMBER, rememberRecord, jsonArr, shipRequests, createShipment, SEARCH, lc, searchText, SIGNS, cyr, keyOf, updKeys, updSearchKeys, updKeysField, supplierKey, supplierMatch, isOpenStatus, findActs };
    
