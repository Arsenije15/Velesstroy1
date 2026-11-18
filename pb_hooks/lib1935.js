// VELESSTROY 1.9.35 — общее для карты склада (обработчики JSVM не видят функций верхнего уровня)
function smapFlag(e) {
  const X = require(`${__hooks}/lib_ext.js`);
  const r = e.record;
  r.set("search_lc", X.lc([r.getString("material"), r.getString("zone"), r.getString("note"), r.getString("qty"), r.getString("unit")].join(" ")).slice(0, 2000));
  if (e.auth) r.set("updated_by", e.auth.id);
  if (!(r.getFloat("x") >= 0 && r.getFloat("x") <= 1 && r.getFloat("y") >= 0 && r.getFloat("y") <= 1)) throw new BadRequestError("Флажок — вне карты.");
}
module.exports = { smapFlag };
