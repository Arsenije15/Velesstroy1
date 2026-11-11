// VELESSTROY 1.9.7 — конструктор полей форм (Настройки → Поля форм)
const FORMS = { request: "Заявка — шапка", request_item: "Заявка — позиция", act_row: "Акт СКК — строка", upd: "УПД — шапка", subtopic: "Подтема (задачи)", board: "Доска склада" };
const TYPES = { text: "Текст", number: "Число", date: "Дата", select: "Список", bool: "Да / нет", photo: "Фото / файл" };
const PHOTO_OK = { request: 1, upd: 1 };   // фото — только у записей с собственной страницей (заявка, УПД)
function defs(app, form) {
  try { return app.findRecordsByFilter("form_fields", "form = {:f} && builtin = false", "sort,created", 0, 0, { f: form }); } catch (_) { return []; }
}
function defsOut(app, forms) {
  const out = {};
  (forms || Object.keys(FORMS)).forEach((f) => { out[f] = app.findRecordsByFilter("form_fields", "form = {:f}", "sort,created", 0, 0, { f: f }).map(defOut); });
  return out;
}
function defOut(d) {
  let o = []; try { o = JSON.parse(d.getString("options") || "[]") || []; } catch (_) {}
  return { id: d.id, form: d.getString("form"), key: d.getString("key"), label: d.getString("label"), type: d.getString("type"), options: o,
    required: d.getBool("required"), hidden: d.getBool("hidden"), builtin: d.getBool("builtin"), sort: d.getInt("sort"), hint: d.getString("hint") };
}
// Значения своих полей: только известные ключи, тип проверяется; ключи, которых нет во входе, сохраняют старое значение
// (поле скрыли или удалили — данные остаются). Обязательность — только у видимых полей и только если клиент прислал extra.
function clean(app, form, input, old) {
  const out = {};
  if (old && typeof old === "object") Object.keys(old).forEach((k) => { const v = old[k]; if (/^f_[a-z0-9]{6}$/.test(k) && (typeof v !== "object" || v === null)) out[k] = typeof v === "string" ? v.slice(0, 2000) : v; });
  if (!input || typeof input !== "object") return out;
  defs(app, form).forEach((d) => {
    const k = d.getString("key"), t = d.getString("type"), lab = d.getString("label") || k;
    if (t === "photo") return;
    if (d.getBool("hidden")) return;
    let v = input[k];
    if (v === undefined) { if (d.getBool("required") && (out[k] === undefined || out[k] === "")) throw new BadRequestError("Заполните поле «" + lab + "»."); return; }
    if (t === "bool") v = v === true || v === "true" || v === "1" || v === 1 || v === "on";
    else if (t === "number") { const s = String(v == null ? "" : v).replace(/\s/g, "").replace(",", "."); v = s === "" ? "" : parseFloat(s); if (v !== "" && !isFinite(v)) throw new BadRequestError("«" + lab + "»: нужно число."); }
    else if (t === "date") { v = String(v || "").slice(0, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestError("«" + lab + "»: неверная дата."); }
    else if (t === "select") { let o = []; try { o = JSON.parse(d.getString("options") || "[]") || []; } catch (_) {} v = String(v || ""); if (v && o.indexOf(v) < 0) throw new BadRequestError("«" + lab + "»: такого варианта нет в списке."); }
    else v = String(v == null ? "" : v).slice(0, 2000);
    if (d.getBool("required") && (t === "bool" ? !v : v === "")) throw new BadRequestError("Заполните поле «" + lab + "».");
    out[k] = v;
  });
  return out;
}
function oldExtra(rec) { try { const v = JSON.parse(rec.getString("extra") || "{}"); return v && typeof v === "object" ? v : {}; } catch (_) { return {}; } }
function text(app, form, extra) {
  const D = {}; defs(app, form).forEach((d) => { D[d.getString("key")] = d; });
  return Object.keys(extra || {}).filter((k) => D[k] && typeof extra[k] !== "boolean").map((k) => String(extra[k])).join(" ");
}
module.exports = { FORMS, TYPES, PHOTO_OK, defs, defsOut, defOut, clean, oldExtra, text };
