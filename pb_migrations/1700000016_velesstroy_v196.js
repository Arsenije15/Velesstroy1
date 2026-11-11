/// VELESSTROY 1.9.6 — группы участников, список файлов поставщиков (без самих файлов), общая доска склада. Данные не трогает.
migrate((app) => {
  const BOSS = '@request.auth.id != "" && @request.auth.active = true && (@request.auth.role = "admin" || @request.auth.role = "manager")';
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("tgroup")) users.fields.add(new SelectField({ name: "tgroup", maxSelect: 1, values: ["ruk", "sklad", "ogi", "omts", "skk", "podr"] }));
  if (!users.fields.getByName("phone")) users.fields.add(new TextField({ name: "phone", max: 40 }));
  app.save(users);
  const IN = '@request.auth.id != "" && @request.auth.active = true && @request.auth.role != "coord"';
  app.save(new Collection({
    type: "base", name: "supplier_files",
    listRule: IN, viewRule: IN, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "supplier", type: "text", max: 300 }, { name: "path", type: "text", max: 1000 }, { name: "name", type: "text", max: 300 },
      { name: "ext", type: "text", max: 12 }, { name: "size", type: "number" }, { name: "mtime", type: "text", max: 25 },
      { name: "is_upd", type: "bool" }, { name: "uchet", type: "text", max: 120 }, { name: "import_id", type: "text", max: 30 },
      { name: "search_lc", type: "text", max: 1400 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_sf_sup ON supplier_files (supplier)", "CREATE INDEX idx_sf_upd ON supplier_files (is_upd, mtime)"],
  }));
  const users2 = app.findCollectionByNameOrId("users");
  app.save(new Collection({
    type: "base", name: "site_links",
    listRule: BOSS, viewRule: BOSS, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "token", type: "text", required: true, max: 64 }, { name: "title", type: "text", max: 200 }, { name: "active", type: "bool" },
      { name: "views", type: "number" }, { name: "created_by", type: "relation", collectionId: users2.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_sitelink_token ON site_links (token)"],
  }));
  app.save(new Collection({
    type: "base", name: "site_board",
    // просмотр записи по id нужен для фотографий на общей странице (id случайный); список — только сотрудникам
    listRule: IN, viewRule: "", createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "kind", type: "select", maxSelect: 1, values: ["tech", "people", "other"] },
      { name: "title", type: "text", max: 200 }, { name: "who", type: "text", max: 200 }, { name: "place", type: "text", max: 300 },
      { name: "start", type: "text", max: 16 }, { name: "end", type: "text", max: 16 },
      { name: "status", type: "select", maxSelect: 1, values: ["plan", "work", "done", "cancel"] },
      { name: "note", type: "text", max: 2000 }, { name: "author", type: "text", max: 120 }, { name: "edited_by", type: "text", max: 120 },
      { name: "history", type: "json", maxSize: 60000 },
      { name: "photos", type: "file", maxSelect: 12, maxSize: 15000000, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"], thumbs: ["480x0"] },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_board_title ON site_board (title)", "CREATE INDEX idx_board_start ON site_board (start)"],
  }));
}, (app) => {
  ["site_board", "site_links", "supplier_files"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
