/// VELESSTROY 1.7 — остатки МПЗ (ведомость из 1С) для поиска. Данные не трогает.
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true';
  app.save(new Collection({
    type: "base", name: "mpz_stock",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "import_id", type: "text", max: 40 },
      { name: "line_no", type: "number" },
      { name: "warehouse", type: "text", max: 300 },
      { name: "account", type: "text", max: 30 },
      { name: "name", type: "text", max: 1500 },
      { name: "code", type: "text", max: 60 },
      { name: "quality", type: "text", max: 100 },
      { name: "unit", type: "text", max: 30 },
      { name: "qty_start", type: "number" }, { name: "sum_start", type: "number" },
      { name: "qty_in", type: "number" }, { name: "sum_in", type: "number" },
      { name: "qty_out", type: "number" }, { name: "sum_out", type: "number" },
      { name: "qty_end", type: "number" }, { name: "sum_end", type: "number" },
      { name: "search_lc", type: "text", max: 3000 },
      { name: "period", type: "text", max: 200 },
      { name: "source", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_mpz_imp ON mpz_stock (import_id)", "CREATE INDEX idx_mpz_code ON mpz_stock (code)", "CREATE INDEX idx_mpz_wh ON mpz_stock (warehouse)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("mpz_stock")); } catch (_) {}
});
                                            
