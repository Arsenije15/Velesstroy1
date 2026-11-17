/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.32 — «Склад Велесстрой Монтаж» (по ссылке, scope = "mz"): позиции по разделам, движение с фото и накладными, задачи, темы, примеры таблиц
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const k = app.findCollectionByNameOrId("skk_links"); const f = k.fields.getByName("scope");
  if (f && f.values.indexOf("mz") < 0) { f.values = f.values.concat(["mz"]); app.save(k); }
  const R = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = "mz"';
  const W = R + ' && @request.auth.role = "storekeeper"';
  const IMG = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  const ts = [{ name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true }];
  const items = new Collection({
    type: "base", name: "mz_items",
    listRule: R, viewRule: R,
    createRule: W + ' && @request.body.qty:isset = false',
    updateRule: W + ' && @request.body.qty:isset = false && @request.body.key:isset = false',
    deleteRule: null,
    fields: [
      { name: "section", type: "select", required: true, maxSelect: 1, values: ["arm", "scaf", "tool", "cons", "siz", "mat"] },
      { name: "grp", type: "text", max: 300 }, { name: "name", type: "text", max: 500, required: true }, { name: "size", type: "text", max: 100 },
      { name: "unit", type: "text", max: 30 }, { name: "code", type: "text", max: 100 }, { name: "place", type: "text", max: 200 },
      { name: "min_qty", type: "number", min: 0 }, { name: "qty", type: "number" },
      { name: "photo", type: "file", maxSelect: 1, maxSize: 20 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: IMG },
      { name: "note", type: "text", max: 1000 }, { name: "key", type: "text", max: 900 }, { name: "search_lc", type: "text", max: 2000 },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 }, ...ts,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_mzi_key ON mz_items (key)", "CREATE INDEX idx_mzi_sec ON mz_items (section, name)"],
  });
  app.save(items);
  app.save(new Collection({
    type: "base", name: "mz_moves",
    listRule: R, viewRule: R,
    createRule: W + ' && created_by = @request.auth.id && @request.body.balance:isset = false',
    updateRule: null, deleteRule: null,
    fields: [
      { name: "item", type: "relation", collectionId: items.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["in", "out", "ret", "wo", "count"] },
      { name: "qty", type: "number" }, { name: "balance", type: "number" },
      { name: "who", type: "text", max: 200 }, { name: "doc_no", type: "text", max: 100 }, { name: "note", type: "text", max: 1000 },
      { name: "doc_files", type: "file", maxSelect: 10, maxSize: 30 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: IMG.concat(["application/pdf"]) },
      { name: "photos", type: "file", maxSelect: 10, maxSize: 20 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: IMG },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 }, ...ts,
    ],
    indexes: ["CREATE INDEX idx_mzm_item ON mz_moves (item, created)", "CREATE INDEX idx_mzm_cr ON mz_moves (created)"],
  }));
  const topics = new Collection({
    type: "base", name: "mz_topics",
    listRule: R, viewRule: R, createRule: W + ' && created_by = @request.auth.id', updateRule: W, deleteRule: null,
    fields: [
      { name: "title", type: "text", max: 300, required: true }, { name: "note", type: "text", max: 3000 },
      { name: "status", type: "select", maxSelect: 1, values: ["open", "closed"] },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 }, ...ts,
    ],
  });
  app.save(topics);
  topics.fields.add(new RelationField({ name: "parent", collectionId: topics.id, maxSelect: 1, cascadeDelete: true })); app.save(topics);
  app.save(new Collection({
    type: "base", name: "mz_posts",
    listRule: R, viewRule: R, createRule: W + ' && created_by = @request.auth.id', updateRule: null, deleteRule: null,
    fields: [
      { name: "topic", type: "relation", collectionId: topics.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "text", type: "text", max: 5000 },
      { name: "photos", type: "file", maxSelect: 10, maxSize: 30 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: IMG.concat(["application/pdf"]) },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 }, ...ts,
    ],
    indexes: ["CREATE INDEX idx_mzp_t ON mz_posts (topic, created)"],
  }));
  app.save(new Collection({
    type: "base", name: "mz_tasks",
    listRule: R, viewRule: R, createRule: W + ' && created_by = @request.auth.id', updateRule: W, deleteRule: null,
    fields: [
      { name: "title", type: "text", max: 500, required: true }, { name: "topic", type: "relation", collectionId: topics.id, maxSelect: 1 },
      { name: "people", type: "text", max: 1000 }, { name: "tech", type: "text", max: 500 }, { name: "place", type: "text", max: 200 },
      { name: "due", type: "text", max: 10 }, { name: "status", type: "select", maxSelect: 1, values: ["open", "done"] },
      { name: "note", type: "text", max: 3000 }, { name: "result", type: "text", max: 3000 },
      { name: "photos", type: "file", maxSelect: 10, maxSize: 20 * 1024 * 1024, protected: true, thumbs: ["240x240"], mimeTypes: IMG },
      { name: "done_at", type: "text", max: 40 },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 }, ...ts,
    ],
    indexes: ["CREATE INDEX idx_mzt_st ON mz_tasks (status, due)"],
  }));
  app.save(new Collection({
    type: "base", name: "mz_samples",
    listRule: '@request.auth.id != "" && @request.auth.active = true && (@request.auth.scope = "mz" || (@request.auth.scope = "" && @request.auth.role = "admin"))',
    viewRule: '@request.auth.id != "" && @request.auth.active = true && (@request.auth.scope = "mz" || (@request.auth.scope = "" && @request.auth.role = "admin"))',
    createRule: W + ' && created_by = @request.auth.id', updateRule: null, deleteRule: null,
    fields: [
      { name: "kind", type: "text", max: 60 }, { name: "note", type: "text", max: 1000 },
      { name: "file", type: "file", maxSelect: 1, maxSize: 50 * 1024 * 1024, protected: true, required: true },
      { name: "created_by", type: "relation", collectionId: users.id, maxSelect: 1 }, ...ts,
    ],
  }));
}, (app) => {
  ["mz_samples", "mz_tasks", "mz_posts", "mz_topics", "mz_moves", "mz_items"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
