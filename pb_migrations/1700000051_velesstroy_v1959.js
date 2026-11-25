/// <reference path="../pb_data/types.d.ts" />
// 1.9.59: фото и документы можно добавить и в закрытую приёмку
migrate((app) => {
  const c = app.findCollectionByNameOrId("attachments");
  const r = String(c.createRule || "");
  if (r.indexOf('receipt.status = "pending_approval")') >= 0 && r.indexOf('"completed"') < 0) {
    c.createRule = r.replace('receipt.status = "pending_approval")', 'receipt.status = "pending_approval" || receipt.status = "completed" || receipt.status = "completed_remarks")');
    app.save(c);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("attachments");
  c.createRule = String(c.createRule || "").replace(' || receipt.status = "completed" || receipt.status = "completed_remarks")', ")"); app.save(c);
});
