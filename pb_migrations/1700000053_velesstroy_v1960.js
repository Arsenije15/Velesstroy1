/// <reference path="../pb_data/types.d.ts" />
// 1.9.60: «Склад / СКК → Приход склада» — УПД, которые склад передал (вписывает администратор); СКК видит каждый приход и что пропущено
migrate((app) => {
  app.save(new Collection({
    type: "base", name: "wh_upds", listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "number", type: "text", max: 120, required: true }, { name: "number_norm", type: "text", max: 120 },
      { name: "date", type: "text", max: 10 }, { name: "supplier", type: "text", max: 300 }, { name: "note", type: "text", max: 500 },
      { name: "by_name", type: "text", max: 200 }, { name: "created_by", type: "text", max: 20 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false }, { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_whu_norm ON wh_upds (number_norm)", "CREATE INDEX idx_whu_created ON wh_upds (created)"],
  }));
}, (app) => { try { app.delete(app.findCollectionByNameOrId("wh_upds")); } catch (_) {} });
