/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.58 — номер флажка; позиция заявки «взято с флажка №»; выдача сама уменьшает количество на флажке
onRecordAfterUpdateSuccess((e) => { require(`${__hooks}/lib1958.js`).onItem(e); e.next(); }, "request_items");

routerAdd("POST", "/api/vs/item/flag", (e) => {
  const L = require(`${__hooks}/lib.js`), F = require(`${__hooks}/lib1958.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Нет доступа.");
  const b = e.requestInfo().body || {};
  let out = null;
  $app.runInTransaction((tx) => {
    const it = tx.findRecordById("request_items", L.str(b.item));
    const rq = tx.findRecordById("requests", it.getString("request"));
    const no = parseInt(String(b.no == null ? "" : b.no).replace(/\D/g, ""), 10);
    if (!no) {   // отвязать
      it.set("flag", ""); it.set("flag_mat", ""); tx.save(it);
      L.log(tx, a, "item_flag", "requests", rq.id, "Заявка № " + rq.getString("number") + ": «" + it.getString("material").slice(0, 60) + "» — флажок убран", {});
      out = { ok: true, flag: "" }; return;
    }
    let f; try { f = tx.findFirstRecordByFilter("smap_flags", "no = {:n}", { n: no }); } catch (_) { throw new BadRequestError("Флажка № " + no + " нет на карте."); }
    const i = F.pick(f, L.str(b.mat), it.getString("material"));
    if (i < 0) throw new BadRequestError("Выберите, какой материал на флажке № " + no + ".");
    const m = F.mats(f)[i];
    it.set("flag", f.id); it.set("flag_mat", String(m.m).slice(0, 300)); tx.save(it);
    let d = 0;
    if (b.apply) { d = Math.round((it.getFloat("qty_issued") - F.takenBy(tx, it.id)) * 1000) / 1000; if (d > 0) F.take(tx, it, d, L.userName(a), "уже выданное — при выборе флажка"); }
    L.log(tx, a, "item_flag", "requests", rq.id, "Заявка № " + rq.getString("number") + ": «" + it.getString("material").slice(0, 60) + "» — взято с флажка № " + no + " («" + String(m.m).slice(0, 60) + "»)" + (d > 0 ? ", списано уже выданное " + d + " " + it.getString("unit") : ""), {});
    const f2 = tx.findRecordById("smap_flags", f.id);
    out = { ok: true, flag: f.id, no: no, mat: m.m, left: F.mats(f2)[i].q, applied: d > 0 ? d : 0 };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
