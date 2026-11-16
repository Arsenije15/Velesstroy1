/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.25 — «Единый сводный отчёт» прихода (реестр приёма-передачи первичных документов): УПД — кто из кладовщиков принял, когда, статус в 1С
migrate((app) => {
  const AUTH = '@request.auth.id != "" && @request.auth.active = true && @request.auth.scope = "" && (@request.auth.role = "admin" || @request.auth.role = "manager" || @request.auth.role = "storekeeper" || @request.auth.role = "viewer" || @request.auth.role = "skk")';
  const T = (name, max) => ({ name, type: "text", max });
  app.save(new Collection({
    type: "base", name: "ureg",
    listRule: AUTH, viewRule: AUTH, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      T("gm_no", 40), T("date_in", 10), T("kind", 60), T("short", 300), T("supplier", 300), T("contract", 120), T("contract_date", 10),
      T("spec", 120), T("doc1c_ship", 60), T("doc_kind", 40), T("number", 80), T("number_n", 80), T("num_d", 40), T("doc_date", 10),
      { name: "amount", type: "number" }, T("doc_form", 60), T("keeper", 200), T("recv_date", 10),
      T("nc_has", 120), T("nc_no", 200), T("nc_date", 10), T("status", 120), T("doc1c", 60), T("orig_date", 10),
      T("buh_no", 60), T("buh_date", 10), T("note", 1000), { name: "row_no", type: "number" }, T("search_lc", 3000),
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_ureg_n ON ureg (number_n)", "CREATE INDEX idx_ureg_d ON ureg (num_d)", "CREATE INDEX idx_ureg_k ON ureg (keeper, recv_date)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("ureg")); } catch (_) {}
});
