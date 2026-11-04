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

module.exports = { SEARCH, lc, searchText, SIGNS, cyr, keyOf, updKeys, updSearchKeys, updKeysField, supplierKey, supplierMatch, isOpenStatus, findActs };
