/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.51 — удаление приёмки (админ и руководитель, с причиной). Вместе с ней удаляются её фото/документы,
// чек-лист и согласования. В журнал действий пишется, что было удалено и почему (журнал не удаляется).
routerAdd("POST", "/api/vs/receipt/delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Удалять приёмки может только администратор или руководитель.");
  const b = e.requestInfo().body || {};
  const reason = L.str(b.reason).trim();
  if (reason.length < 3) throw new BadRequestError("Укажите причину удаления.");
  let info = {};
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("receipts", L.str(b.receipt));
    const cnt = (col) => { try { return tx.findRecordsByFilter(col, "receipt = {:r}", "", 0, 0, { r: r.id }).length; } catch (_) { return 0; } };
    info = { upd: r.getString("upd_number"), supplier: r.getString("supplier"), sender: r.getString("sender"), status: r.getString("status"),
      created: r.getString("created"), qty_doc: r.getString("qty_doc"), qty_fact: r.getString("qty_fact"),
      files: cnt("attachments"), checklist: cnt("checklist_items"), approvals: cnt("approvals"), reason };
    L.log(tx, a, "receipt_delete", "receipts", r.id, "Удалена приёмка УПД № " + info.upd + (info.supplier ? " (" + info.supplier + ")" : "") + " — причина: " + reason, info);
    tx.delete(r);
  });
  return e.json(200, { ok: true, deleted: info });
}, $apis.requireAuth("users"));
