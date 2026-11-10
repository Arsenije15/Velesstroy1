// VELESSTROY 1.8 — общие функции СКК: строки актов в общий журнал актов (блокировка заявок по УПД + поставщику).
const SKK_ROLES = ["admin", "skk"];
const UPD_ROLES = ["admin", "manager", "storekeeper", "skk"];
function num(v) { const q = parseFloat(String(v === undefined || v === null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(q) ? 0 : Math.round(q * 1000) / 1000; }
function ddmmyyyy(iso) { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "." + m[2] + "." + m[1] : String(iso || ""); }
// Акт СКК → строки в коллекции acts (import_id = "skk"), чтобы работали проверки при заявке и приёмке
function syncActs(L, X, tx, act, author) {
  tx.findRecordsByFilter("acts", "import_id = 'skk' && row_key ~ {:k}", "", 0, 0, { k: "skk:" + act.id + ":" }).forEach((r) => tx.delete(r));
  let rows = []; try { rows = JSON.parse(act.getString("rows") || "[]") || []; } catch (_) {}
  const col = tx.findCollectionByNameOrId("acts");
  const updNums = [];
  act.getStringSlice("upds").forEach((id) => { try { updNums.push(tx.findRecordById("upd_docs", id).getString("number")); } catch (_) {} });
  const torg = updNums.length ? "УПД " + updNums.join(", ") : act.getString("upd_line");
  rows.forEach((x, i) => {
    const r = new Record(col);
    r.set("row_key", ("skk:" + act.id + ":" + i).slice(0, 120)); r.set("import_id", "skk");
    r.set("act_no", act.getString("number")); r.set("act_date", ddmmyyyy(act.getString("date")));
    r.set("supplier", act.getString("supplier")); r.set("supplier_key", act.getString("supplier_key"));
    // строка относится к своему УПД («УПД 16460» или поле upd) — иначе ко всем УПД акта
    const own = L.str(x.upd) || ((L.str(x.material).match(/^УПД\s*№?\s*(\S+)/i) || [])[1] || "");
    const keysSrc = own || updNums.join(", ") || act.getString("upd_line");
    r.set("torg", (own ? "УПД " + own : torg).slice(0, 500)); r.set("upd_keys", X.updKeysField(keysSrc).slice(0, 1000));
    r.set("project", L.str(x.code).slice(0, 500)); r.set("material", L.str(x.material).slice(0, 1000)); r.set("qty", L.str(x.volume).slice(0, 40));
    r.set("reason", (L.str(x.issue) + (x.decision ? " — " + L.str(x.decision) : "")).slice(0, 3000));
    r.set("author", author.slice(0, 200)); r.set("open", !x.fixed);
    r.set("act_status", x.fixed ? "Устранено" : "Не устранено"); r.set("closed_date", x.fixed ? ddmmyyyy(String(x.fixed_at || "").slice(0, 10)) : "");
    r.set("note", L.str(x.fix_note).slice(0, 3000)); r.set("place", "СКК");
    tx.save(r);
  });
}
function ocrJob(id) { return $app.dataDir() + "/ocr_jobs/" + String(id).replace(/[^a-z0-9]/g, "") + ".txt"; }
// разбор ответа ocr_upd.py → сохранить в черновик; ошибки — понятным текстом
function ocrFinish(L, rec, txt) {
  const code = (txt.match(/__EXIT__(\d+)/) || [])[1];
  const body = txt.replace(/\n?__EXIT__\d+\s*$/, "").trim();
  let res = null;
  const js = body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1);
  try { res = JSON.parse(js); } catch (_) {
    if (code === "124") throw new BadRequestError("Чтение заняло больше 4 минут — загрузите файл меньше (до 6 страниц) или фото без лишнего фона.");
    throw new BadRequestError("Ошибка распознавания на сервере (код " + code + "): " + body.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400));
  }
  if (res.error) throw new BadRequestError(res.error);
  delete res.debug;
  const known = [];
  try {
    const rows = arrayOf(new DynamicModel({ supplier: "" }));
    $app.db().newQuery("SELECT DISTINCT supplier FROM acts WHERE supplier != '' LIMIT 800").all(rows); rows.forEach((r) => known.push(r.supplier));
    $app.findRecordsByFilter("upd_docs", "status != 'draft' && supplier != ''", "-created", 300, 0).forEach((r) => known.push(r.getString("supplier")));
    $app.findRecordsByFilter("suggestions", "field = 'supplier'", "-last", 300, 0).forEach((r) => known.push(r.getString("value")));
    $app.findRecordsByFilter("suppliers", "active = true", "name", 3000, 0).forEach((r) => known.push(r.getString("name")));
  } catch (_) {}
  res.known_suppliers = known;
  const fresh = $app.findRecordById("upd_docs", rec.id); fresh.set("ocr", res); $app.saveNoValidate(fresh);
  return res;
}
module.exports = { ocrJob, ocrFinish, num, SKK_ROLES, UPD_ROLES, ddmmyyyy, syncActs };
