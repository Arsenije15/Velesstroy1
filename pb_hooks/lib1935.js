// VELESSTROY 1.9.35 — общее для карты склада (обработчики JSVM не видят функций верхнего уровня)
function smapFlag(e) {
  const X = require(`${__hooks}/lib_ext.js`);
  const r = e.record;
  // 1.9.50: несколько материалов на флажке — чистим список и добавляем их в поиск
  let it = []; try { it = JSON.parse(r.getString("items") || "[]"); } catch (_) {}
  if (!Array.isArray(it)) it = [];
  it = it.map((x) => ({ m: String((x && x.m) || "").trim().slice(0, 300), q: String((x && x.q) || "").trim().slice(0, 40), u: String((x && x.u) || "").trim().slice(0, 20), d: String((x && x.d) || "").trim().slice(0, 120) })).filter((x) => x.m).slice(0, 60).map((x) => { if (!x.d) delete x.d; return x; });
  r.set("items", it);
  // 1.9.58: номер флажка — новый получает следующий, у существующего не меняется
  if (r.isNew()) r.set("no", require(`${__hooks}/lib1958.js`).nextNo($app));
  else { const o = r.original(); if (o) r.set("no", o.getInt("no")); }
  r.set("search_lc", X.lc([r.getInt("no") ? "№" + r.getInt("no") : "", r.getString("material"), r.getString("zone"), r.getString("note"), r.getString("qty"), r.getString("unit"), r.getString("upd")].concat(it.map((x) => x.m + (x.d ? " " + x.d : ""))).join(" ")).slice(0, 8000));
  if (e.auth) r.set("updated_by", e.auth.id);
  // 1.9.47: поле карты можно расширить за края снимка — флажок проверяется по настроенному полю (координаты — от снимка 1600×1000)
  let ex = { l: 0, r: 0, t: 0, b: 0 };
  try { const c = $app.findRecordsByFilter("smap_cfg", "", "created", 1, 0)[0]; if (c) { const v = JSON.parse(c.getString("ext") || "{}") || {}; ex = { l: +v.l || 0, r: +v.r || 0, t: +v.t || 0, b: +v.b || 0 }; } } catch (_) {}
  const x = r.getFloat("x"), y = r.getFloat("y"), m = 0.02;
  if (!(x >= -ex.l / 1600 - m && x <= 1 + ex.r / 1600 + m && y >= -ex.t / 1000 - m && y <= 1 + ex.b / 1000 + m)) throw new BadRequestError("Флажок — вне карты.");
}
module.exports = { smapFlag };
