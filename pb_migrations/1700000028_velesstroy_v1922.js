/// <reference path="../pb_data/types.d.ts" />
// 1.9.22: две фазы новой заявки — «на почте» (заявитель ещё не передал) → «передана мне» (handed_at, от этой даты считается неделя)
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const rq = app.findCollectionByNameOrId("requests");
  rq.fields.add(new DateField({ name: "handed_at" }));
  rq.fields.add(new RelationField({ name: "handed_by", collectionId: users.id, maxSelect: 1 }));
  app.save(rq);
  // старые заявки уже в работе — переданы в день создания
  app.db().newQuery("UPDATE requests SET handed_at = created WHERE handed_at IS NULL OR handed_at = ''").execute();
}, (app) => {
  const rq = app.findCollectionByNameOrId("requests");
  rq.fields.removeByName("handed_at"); rq.fields.removeByName("handed_by"); app.save(rq);
});
