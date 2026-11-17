/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.30 — удаление акта СКК (с причиной; копия акта остаётся в журнале действий)
routerAdd("POST", "/api/vs/skk/act/delete", (e) => {
  const L = require(`${__hooks}/lib.js`), K = require(`${__hooks}/lib18.js`);
  const a = L.requireRole(e, K.SKK_ROLES);
  const b = e.requestInfo().body || {};
  const why = L.str(b.reason).slice(0, 500);
  if (!why) throw new BadRequestError("Напишите причину удаления.");
  let out = null;
  $app.runInTransaction((tx) => {
    const act = tx.findRecordById("skk_acts", L.str(b.id));
    const no = act.getString("number"), sup = act.getString("supplier"), upds = act.getStringSlice("upds");
    const copy = {}; ["number", "date", "object", "supplier", "upd_line", "rows", "conclusion", "appendix", "verdict", "status", "closed_at", "created_by", "created", "rep_osk", "rep_sklad", "rep_omts"].forEach((f) => { copy[f] = act.get(f); });
    copy.upds = upds;
    if (JSON.stringify(copy).length > 900000) copy.rows = "(слишком много строк для журнала)";
    // строки журнала актов (acts), которые акт СКК туда записал
    tx.findRecordsByFilter("acts", "import_id = 'skk' && row_key ~ {:k}", "", 0, 0, { k: "skk:" + act.id + ":" }).forEach((r) => tx.delete(r));
    tx.delete(act);   // фото акта удаляются вместе с ним
    // УПД акта: если на них есть другие акты — по ним, иначе снова «без акта»
    upds.forEach((id) => {
      let u = null; try { u = tx.findRecordById("upd_docs", id); } catch (_) { return; }
      if (u.getString("status") === "draft") return;
      const other = tx.findRecordsByFilter("skk_acts", "upds ~ {:i}", "", 0, 0, { i: id });
      u.set("status", !other.length ? "new" : other.some((x) => x.getString("status") === "open") ? "act" : "ok");
      tx.saveNoValidate(u);
    });
    L.log(tx, a, "skk_act_delete", "skk_acts", act.id, "Удалён акт СКК № " + no + " — " + sup + ". Причина: " + why, { act: copy });
    out = { deleted: true, number: no };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
