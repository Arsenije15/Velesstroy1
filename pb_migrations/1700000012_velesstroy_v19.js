/// VELESSTROY 1.9 — поставщики, оперативка, фото прихода, «Задачи и согласования», роли «Наблюдатель склада» и «Участник согласований». Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  const BOSS = '(@request.auth.role = "admin" || @request.auth.role = "manager")';
  const users = app.findCollectionByNameOrId("users");
  const rf = users.fields.getByName("role");
  ["skk_view", "coord"].forEach((r) => { if (rf.values.indexOf(r) < 0) rf.values = rf.values.concat([r]); });
  app.save(users);
  // 1.9: фото с телефона не отбрасываются из-за типа файла (image/jpg, HEIC и т. п.)
  const ud0 = app.findCollectionByNameOrId("upd_docs"); const uf = ud0.fields.getByName("file"); uf.mimeTypes = []; app.save(ud0);
  // ---------- Справочник поставщиков ----------
  app.save(new Collection({
    type: "base", name: "suppliers", listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "name", type: "text", required: true, max: 300 }, { name: "key", type: "text", max: 300 },
      { name: "inn", type: "text", max: 12 }, { name: "source", type: "text", max: 200 }, { name: "active", type: "bool" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_sup_key ON suppliers (key)"],
  }));
  // ---------- Оперативка (несколько Excel; повторная загрузка файла заменяет только его строки) ----------
  const T = (n, m) => ({ name: n, type: "text", max: m || 300 });
  app.save(new Collection({
    type: "base", name: "oper_rows", listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      T("source", 200), T("sheet", 120), { name: "line_no", type: "number" }, T("import_id", 40),
      T("pid", 40), T("order_no", 120), T("object", 300), T("subobject", 300), T("svod", 120), T("grp", 120), T("buyer", 200),
      T("code", 300), T("name_proj", 1000), T("name_supp", 1000), T("name_1c", 1000), T("gost", 300), T("nom_group", 200),
      T("unit", 30), { name: "qty", type: "number" }, T("unit_c", 30), { name: "qty_c", type: "number" },
      { name: "qty_shipped", type: "number" }, { name: "qty_delivered", type: "number" },
      T("plan_mount", 30), T("plan_ship", 30), T("plan_delivery", 30),
      T("stage", 200), T("supplier", 300), T("supplier_key", 300), T("contract", 300), T("spec", 300), T("torg", 500), T("torg_date", 200), T("upd_keys", 1000),
      T("note", 1000), T("search_lc", 4000),
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_op_src ON oper_rows (source)", "CREATE INDEX idx_op_pid ON oper_rows (pid)", "CREATE INDEX idx_op_sup ON oper_rows (supplier_key)"],
  }));
  // ---------- Фото материала к приходу (УПД) ----------
  const upd = app.findCollectionByNameOrId("upd_docs");
  app.save(new Collection({
    type: "base", name: "upd_photos", listRule: AUTH, viewRule: AUTH,
    createRule: AUTH + ' && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper" || @request.auth.role = "skk") && uploaded_by = @request.auth.id',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "upd", type: "relation", collectionId: upd.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "file", type: "file", maxSelect: 1, maxSize: 25 * 1024 * 1024, protected: true },
      { name: "uploaded_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
  }));
  // ---------- Задачи и согласования ----------
  const topics = new Collection({
    type: "base", name: "topics",
    listRule: AUTH + " && (" + BOSS + " || members.id ?= @request.auth.id)", viewRule: AUTH + " && (" + BOSS + " || members.id ?= @request.auth.id)",
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      T("title", 300), T("description", 3000), { name: "status", type: "select", maxSelect: 1, values: ["open", "closed"] },
      { name: "members", type: "relation", collectionId: users.id, maxSelect: 200 }, { name: "closed_at", type: "date" },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(topics);
  const subs = new Collection({
    type: "base", name: "subtopics",
    listRule: AUTH + " && (" + BOSS + " || members.id ?= @request.auth.id)", viewRule: AUTH + " && (" + BOSS + " || members.id ?= @request.auth.id)",
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "topic", type: "relation", collectionId: topics.id, maxSelect: 1, required: true, cascadeDelete: true },
      T("title", 300), T("description", 3000), { name: "members", type: "relation", collectionId: users.id, maxSelect: 200 },
      { name: "stages", type: "json", maxSize: 200000 }, { name: "status", type: "select", maxSelect: 1, values: ["open", "closed"] },
      { name: "sort", type: "number" }, { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(subs);
  app.save(new Collection({
    type: "base", name: "topic_msgs",
    listRule: AUTH + " && (" + BOSS + " || subtopic.members.id ?= @request.auth.id)", viewRule: AUTH + " && (" + BOSS + " || subtopic.members.id ?= @request.auth.id)",
    createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "topic", type: "relation", collectionId: topics.id, maxSelect: 1, cascadeDelete: true },
      { name: "subtopic", type: "relation", collectionId: subs.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1 }, T("user_name", 200), T("text", 3000), T("kind", 20),
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_tmsg_sub ON topic_msgs (subtopic)"],
  }));
  // ---------- Участник согласований (coord) не видит ничего, кроме своих тем, МПЗ и оперативки ----------
  const NOC = ' && @request.auth.role != "coord"';
  const OPEN = { suppliers: 1, oper_rows: 1, mpz_stock: 1, topics: 1, subtopics: 1, topic_msgs: 1, users: 1 };
  app.findAllCollections().forEach((c) => {
    if (c.system || c.type === "view" || OPEN[c.name]) return;
    let ch = false;
    ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"].forEach((k) => { const r = c[k]; if (r === null || r === undefined || r === "" || r.indexOf('role != "coord"') >= 0) return; c[k] = "(" + r + ")" + NOC; ch = true; });
    if (ch) app.save(c);
  });
  const uu = app.findCollectionByNameOrId("users");
  ["listRule", "viewRule"].forEach((k) => { const r = uu[k]; if (r && r.indexOf('role != "coord"') < 0) uu[k] = "(" + r + ') && (@request.auth.role != "coord" || id = @request.auth.id)'; });
  app.save(uu);
}, (app) => {
  app.findAllCollections().forEach((c) => { let ch = false;
    ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"].forEach((k) => { const r = c[k]; if (!r) return;
      const m = r.match(/^\((.*)\) && (@request\.auth\.role != "coord"|\(@request\.auth\.role != "coord" \|\| id = @request\.auth\.id\))$/); if (m) { c[k] = m[1]; ch = true; } });
    if (ch) app.save(c); });

  ["topic_msgs", "subtopics", "topics", "upd_photos", "oper_rows", "suppliers"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
        
