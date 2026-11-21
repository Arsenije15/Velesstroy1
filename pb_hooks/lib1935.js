// VELESSTROY 1.9.35 — общее для карты склада (обработчики JSVM не видят функций верхнего уровня)
function smapFlag(e) {
  const X = require(`${__hooks}/lib_ext.js`);
  const r = e.record;
  r.set("search_lc", X.lc([r.getString("material"), r.getString("zone"), r.getString("note"), r.getString("qty"), r.getString("unit")].join(" ")).slice(0, 2000));
  if (e.auth) r.set("updated_by", e.auth.id);
  // 1.9.47: поле карты можно расширить за края снимка (до 3 снимков в каждую сторону) — координаты считаются от снимка
  if (!(r.getFloat("x") >= -3 && r.getFloat("x") <= 4 && r.getFloat("y") >= -3 && r.getFloat("y") <= 4)) throw new BadRequestError("Флажок — вне карты.");
}
module.exports = { smapFlag };
