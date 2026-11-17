/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.29 — «Убрать пользователя»: без следов в базе — удалить; иначе — отключить и скрыть (заявки, акты, журнал сохраняют автора)
routerAdd("POST", "/api/vs/user/remove", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin"]);
  const b = e.requestInfo().body || {};
  const id = L.str(b.id);
  if (!id) throw new BadRequestError("Не указан пользователь.");
  if (a && a.id === id) throw new BadRequestError("Нельзя убрать самого себя.");
  const u = $app.findRecordById("users", id);
  if (u.getString("role") === "admin") {
    const r = new DynamicModel({ n: 0 });
    $app.db().newQuery("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != {:id}").bind({ id: id }).one(r);
    if (!r.n) throw new BadRequestError("Это единственный активный администратор — убрать нельзя.");
  }
  if (b.restore) { u.set("hidden", false); $app.save(u); L.log($app, a, "user_restore", "users", id, "Возвращён в список: " + u.getString("name")); return e.json(200, { restored: true }); }
  // где пользователь упоминается: все поля-связи на users во всех коллекциях
  const usersCol = $app.findCollectionByNameOrId("users");
  let refs = 0; const where = [];
  $app.findAllCollections().forEach((c) => {
    if (c.name === "users" || c.system) return;
    c.fields.forEach((f) => {
      if (f.type() !== "relation" || f.collectionId !== usersCol.id) return;
      const r = new DynamicModel({ n: 0 });
      try {
        $app.db().newQuery(`SELECT COUNT(*) AS n FROM \`${c.name}\` WHERE \`${f.name}\` = {:id} OR \`${f.name}\` LIKE {:j}`).bind({ id: id, j: '%"' + id + '"%' }).one(r);
      } catch (_) { return; }
      if (r.n) { refs += r.n; where.push(c.name); }
    });
  });
  const name = u.getString("name");
  if (!refs && !b.hideOnly) {
    $app.delete(u);
    L.log($app, a, "user_delete", "users", id, "Удалён пользователь: " + name);
    return e.json(200, { deleted: true });
  }
  u.set("active", false); u.set("hidden", true); $app.save(u);
  L.log($app, a, "user_hide", "users", id, "Скрыт и отключён: " + name + " (записей в истории: " + refs + ")");
  return e.json(200, { hidden: true, refs: refs, where: where });
}, $apis.requireAuth("users"));
