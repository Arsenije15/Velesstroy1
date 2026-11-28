/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.62 — 🤖 помощник на Yandex AI Studio: свободные слова → инструменты программы (поиск, приход, заявки, пропуск…)
// Ключ хранится в backup_state/ai.env (права 600, не в базе, не в git, не в копиях); в браузер не уходит никогда.
const BASES = ["https://ai.api.cloud.yandex.net/v1", "https://llm.api.cloud.yandex.net/v1"];
function envPath(app) { return require(`${__hooks}/lib1946.js`).paths(app).state + "/ai.env"; }
function readCfg(app) { return require(`${__hooks}/lib1946.js`).readEnv(envPath(app)); }
function writeCfg(app, o) {
  const P = require(`${__hooks}/lib1946.js`).paths(app); try { $os.mkdirAll(P.state, 0o700); } catch (_) {}
  const txt = "# ВЕЛЕССТРОЙ — ключ Yandex AI Studio (записано программой " + new Date().toISOString() + ")\n" +
    Object.keys(o).filter((k) => o[k]).map((k) => k + "='" + String(o[k]).replace(/'/g, "") + "'").join("\n") + "\n";
  $os.writeFile(envPath(app), txt, 0o600);
}
function status(app) { const c = readCfg(app); return { on: !!(c.YC_KEY && c.YC_FOLDER), folder: c.YC_FOLDER || "", model: c.YC_MODEL || "yandexgpt/latest", key: c.YC_KEY ? "•••" + c.YC_KEY.slice(-4) : "", base: c.YC_BASE || "" }; }
// один запрос к модели (OpenAI-совместимый API Yandex AI Studio)
function call(app, body, path) {
  const c = readCfg(app); if (!c.YC_KEY || !c.YC_FOLDER) throw new BadRequestError("🤖 Помощник не подключён: «Инструменты» → «AI-помощник (Yandex)».");
  const bases = c.YC_BASE ? [c.YC_BASE] : BASES; let last = "";
  for (let i = 0; i < bases.length; i++) {
    for (const auth of ["Bearer " + c.YC_KEY, "Api-Key " + c.YC_KEY]) {
      let r; try {
        r = $http.send({ url: bases[i].replace(/\/+$/, "") + (path || "/chat/completions"), method: body ? "POST" : "GET", timeout: 60,
          headers: { "Authorization": auth, "OpenAI-Project": c.YC_FOLDER, "x-folder-id": c.YC_FOLDER, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "" });
      } catch (err) { last = "нет связи с " + bases[i] + ": " + String(err).slice(0, 160); break; }
      let j = null; try { j = r.json; if (!j || typeof j !== "object") j = JSON.parse(toString(r.body)); } catch (_) { j = null; }
      if (r.statusCode === 401 || r.statusCode === 403) { last = "ключ не подошёл (" + r.statusCode + "): " + ((j && j.error && (j.error.message || j.error)) || "").toString().slice(0, 200); continue; }
      if (r.statusCode === 404) { last = "адрес не найден: " + bases[i]; break; }
      if (r.statusCode >= 400) throw new BadRequestError("🤖 Yandex ответил ошибкой " + r.statusCode + ": " + ((j && j.error && (j.error.message || JSON.stringify(j.error))) || toString(r.body)).toString().slice(0, 300));
      if (!c.YC_BASE || c.YC_AUTH !== auth.split(" ")[0]) { c.YC_BASE = bases[i]; c.YC_AUTH = auth.split(" ")[0]; try { writeCfg(app, c); } catch (_) {} }
      return j || {};
    }
  }
  throw new BadRequestError("🤖 Не получилось связаться с Yandex: " + last);
}
// ---------- данные программы для помощника ----------
const lc = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
function W(q) { return require(`${__hooks}/lib1964.js`).W(q); }   // 1.9.64: с основой слова («штукатурки» → «штукатурк»)
function rows(app, sql, model, P) { const R = arrayOf(new DynamicModel(model)); const q = app.db().newQuery(sql); if (P) q.bind(P); q.all(R); return JSON.parse(JSON.stringify(R)); }
function like(col, ws) { const P = {}; const s = ws.map((w, i) => { P["w" + i] = "%" + w + "%"; return col + " LIKE {:w" + i + "}"; }).join(" AND "); return { s: s || "1=1", P }; }
const jarr = (v) => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch (_) { return []; } };
const hit = (ws, t) => { const x = lc(t); return ws.every((w) => x.indexOf(w) >= 0); };
const n3 = (v) => Math.round((+v || 0) * 1000) / 1000;
function searchMaterial(app, q) {
  const ws = W(q); if (!ws.length) return { error: "пустой запрос" };
  const L = like("search_lc", ws), out = { query: q };
  out.fact_stock = rows(app, "SELECT name, qty, COALESCE(unit,'') AS unit, COALESCE(place,'') AS place FROM fstock WHERE " + L.s + " ORDER BY qty DESC LIMIT 8", { name: "", qty: 0.5, unit: "", place: "" }, L.P);
  out.map_flags = rows(app, "SELECT COALESCE(no,0) AS no, COALESCE(material,'') AS material, COALESCE(qty,'') AS qty, COALESCE(unit,'') AS unit, COALESCE(zone,'') AS zone, COALESCE(upd,'') AS upd FROM smap_flags WHERE " + L.s + " LIMIT 8", { no: 0, material: "", qty: "", unit: "", zone: "", upd: "" }, L.P);
  out.operativka = rows(app, "SELECT COALESCE(pid,'') AS pid, COALESCE(NULLIF(name_1c,''), NULLIF(name_proj,''), name_supp) AS name, COALESCE(unit,'') AS unit, COALESCE(qty,0) AS qty, COALESCE(qty_delivered,0) AS delivered, COALESCE(supplier,'') AS supplier, COALESCE(upd_keys,'') AS upd, COALESCE(object,'') AS object, COALESCE(stage,'') AS stage FROM oper_rows WHERE " + L.s + " LIMIT 10",
    { pid: "", name: "", unit: "", qty: 0.5, delivered: 0.5, supplier: "", upd: "", object: "", stage: "" }, L.P);
  out.mpz = rows(app, "SELECT name, COALESCE(unit,'') AS unit, COALESCE(qty_end,0) AS qty, COALESCE(warehouse,'') AS warehouse, COALESCE(period,'') AS period FROM mpz_stock WHERE " + L.s + " ORDER BY qty_end DESC LIMIT 8", { name: "", unit: "", qty: 0.5, warehouse: "", period: "" }, L.P);
  out.open_requests = rows(app, "SELECT q.id AS rid, q.number AS no, q.object AS object, q.recipient AS applicant, i.material AS material, COALESCE(i.unit,'') AS unit, COALESCE(i.qty_ordered,0) AS ordered, COALESCE(i.qty_issued,0) AS issued FROM request_items i JOIN requests q ON q.id = i.request WHERE q.status = 'open' AND " + like("i.search_lc", ws).s + " ORDER BY q.created DESC LIMIT 10",
    { rid: "", no: "", object: "", applicant: "", material: "", unit: "", ordered: 0.5, issued: 0.5 }, like("i.search_lc", ws).P);
  out.open_acts = rows(app, "SELECT COALESCE(act_no,'') AS act, COALESCE(act_date,'') AS date, COALESCE(supplier,'') AS supplier, COALESCE(material,'') AS material, COALESCE(reason,'') AS reason FROM acts WHERE open = TRUE AND " + L.s + " LIMIT 6", { act: "", date: "", supplier: "", material: "", reason: "" }, L.P);
  out.leftovers_to_issue = rows(app, "SELECT COALESCE(number,'') AS request, COALESCE(material,'') AS material, COALESCE(qty,0) AS qty, COALESCE(unit,'') AS unit, COALESCE(recipient,'') AS recipient FROM leftovers WHERE status != 'done' AND " + L.s + " LIMIT 6", { request: "", material: "", qty: 0.5, unit: "", recipient: "" }, L.P);
  out.arrivals_90d = arrivals(app, q, 90).totals;
  return out;
}
// приход материала за N дней: моя приёмка + УПД СКК (один УПД не считается дважды)
function arrivals(app, q, days) {
  const ws = W(q); days = Math.max(1, Math.min(3650, parseInt(days, 10) || 90));
  const since = new Date(Date.now() - days * 864e5).toISOString().replace("T", " ");
  const X = require(`${__hooks}/lib1960.js`); const ix = X.skkIndex(app); const used = {}; const L = [];
  rows(app, "SELECT id, COALESCE(upd_number,'') AS no, COALESCE(supplier,'') AS sup, created, COALESCE(upd_items,'') AS it FROM receipts WHERE created >= {:d} ORDER BY created DESC LIMIT 3000", { id: "", no: "", sup: "", created: "", it: "" }, { d: since })
    .forEach((r) => { const f = X.findSkk(ix, r.no, r.sup); if (f) used[f.u.id] = 1;
      jarr(r.it).forEach((x) => { if (x && x.name && hit(ws, x.name)) L.push({ date: r.created.slice(0, 10), src: "приёмка", upd: r.no, supplier: r.sup, name: x.name, qty: n3(x.qty), unit: x.unit || "", href: "#/receipt/" + r.id }); }); });
  rows(app, "SELECT id, COALESCE(number,'') AS no, COALESCE(supplier,'') AS sup, COALESCE(date,'') AS date, created, COALESCE(items,'') AS it FROM upd_docs WHERE status != 'draft' AND created >= {:d} ORDER BY created DESC LIMIT 3000", { id: "", no: "", sup: "", date: "", created: "", it: "" }, { d: since })
    .forEach((u) => { if (used[u.id]) return; jarr(u.it).forEach((x) => { const nm = x && (x.spec_name || x.name); if (nm && hit(ws, nm + " " + (x.name || ""))) L.push({ date: (u.date || u.created).slice(0, 10), src: "СКК", upd: u.no, supplier: u.sup, name: nm, qty: n3(x.qty), unit: x.unit || "", href: "#/upd/" + u.id }); }); });
  L.sort((a, b) => (a.date < b.date ? 1 : -1));
  const T = {}; L.forEach((x) => { const u = lc(x.unit || "—"); T[u] = n3((T[u] || 0) + x.qty); });
  return { query: q, days, lines: L.slice(0, 300), count: L.length, totals: Object.keys(T).map((u) => ({ unit: u, qty: T[u] })) };
}
function requestDetails(app, no) {
  const n = String(no || "").toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
  const R = app.findRecordsByFilter("requests", "number_norm = {:n}", "-created", 1, 0, { n }); if (!R.length) return { error: "заявка № " + no + " не найдена" };
  const r = R[0]; let sig = {}; try { sig = JSON.parse(r.getString("signatures") || "{}") || {}; } catch (_) {}
  const its = app.findRecordsByFilter("request_items", "request = {:r}", "sort,created", 0, 0, { r: r.id }).map((i, k) => ({ pos: k + 1, material: i.getString("material"), unit: i.getString("unit"), ordered: i.getFloat("qty_ordered"), issued: i.getFloat("qty_issued"), pid: i.getString("rd"), supplier: i.getString("supplier"), upd: i.getString("supply_doc"), place: i.getString("pick_place") }));
  return { id: r.id, href: "#/request/" + r.id, number: r.getString("number"), status: r.getString("status"), in_mail: !r.getString("handed_at"), object: r.getString("object"), applicant: r.getString("recipient"), phone: r.getString("phone"), created: r.getString("created"), handed_at: r.getString("handed_at"), signatures: Object.keys(sig), items: its };
}
function listRequests(app, kind, q) {
  const P = require(`${__hooks}/lib1961.js`).pult(app); const k = { mail: "mail", open: "open", debt: "debt", receipts: "rcp", passes: "pass" }[kind] || "open";
  let L = P[k].items; if (q) { const ws = W(q); L = L.filter((x) => hit(ws, [x.no, x.t1, x.t2].join(" "))); }
  return { kind, total: P[k].n, items: L.slice(0, 25).map((x) => ({ no: x.no, object: x.t1, who: x.t2, since: x.at, missing: x.miss.map((m) => m.t), href: x.href })) };
}
function findUpd(app, no) {
  const X = require(`${__hooks}/lib1960.js`); const j = X.notInSkk(app, no);
  return { results: j.items.slice(0, 8).map((x) => ({ src: x.src === "skk" ? "СКК" : "моя приёмка", number: x.upd_number, supplier: x.supplier, status: x.status, in_skk: x.in_skk, materials: (x.mats || []).slice(0, 25), href: x.src === "skk" ? "#/upd/" + x.id : "#/receipt/" + x.id })) };
}
const SCREENS = { home: "#/home", pult: "#/pult", requests: "#/requests", receive: "#/receive", skk: "#/skk", map: "#/map", mpz: "#/mpz", history: "#/history", tools: "#/tools", resources: "#/resources", report: "#/report", topics: "#/topics", inbox: "#/inbox/zay", inbox_upd: "#/inbox/upd" };
const TOOLS = [
  { name: "material_issues", d: "Выдача материала по заявкам: сколько выдано всего (по единицам), по каким заявкам, кому (заявитель), на какой объект, когда, подписаны ли. Для вопросов «сколько выдано», «по каким заявкам», «кому выдавали», «куда ушло». Учитывает все заявки — открытые и закрытые.", p: { query: ["string", "материал (основа слова: штукатурк основит, арматур 12)"], days: ["integer", "за сколько дней (пусто — за всё время)"] }, req: ["query"] },
  { name: "search_material", d: "Умный поиск материала везде: фактический остаток, флажки на карте склада, оперативка (PID, заказано/поставлено, поставщик, УПД), МПЗ, открытые заявки, открытые акты, остатки к выдаче, приход за 90 дней. Где лежит и сколько есть. Для «сколько выдано / по каким заявкам» — material_issues.", p: { query: ["string", "что искать"] }, req: ["query"] },
  { name: "material_arrivals", d: "Сколько материала пришло за период (приёмка + УПД СКК), по датам и УПД, итог по единицам.", p: { query: ["string", "материал"], days: ["integer", "за сколько дней (3 месяца = 90)"] }, req: ["query"] },
  { name: "request_details", d: "Заявка по номеру: объект, заявитель, позиции (заказано/выдано, PID, поставщик, УПД), подписи.", p: { number: ["string", "номер заявки как написан"] }, req: ["number"] },
  { name: "list_requests", d: "Только списки пульта (НЕ поиск по материалу): mail — заявки на почте, open — открытые, debt — закрытые без подписей, receipts — незаконченная приёмка, passes — пропуска.", p: { kind: ["string", "mail|open|debt|receipts|passes"], query: ["string", "фильтр: номер, объект, заявитель (необязательно)"] }, req: ["kind"] },
  { name: "find_upd", d: "УПД по номеру: у СКК и в моей приёмке, статус, материалы.", p: { number: ["string", "номер УПД"] }, req: ["number"] },
  { name: "make_pass", d: "Сделать черновик материального пропуска по одной или нескольким заявкам. Пользователь потом проверит и подтвердит.", p: { requests: ["array", "номера заявок"], positions: ["array", "номера позиций (только если одна заявка; пусто — все)"] }, req: ["requests"] },
  { name: "inbox_queue", d: "Папки «Заявки» (файлы З-7137.pdf) и «Поставки» (УПД, файлы П-83464.pdf): прочитать файлы по номерам и положить в «Ждут подтверждения». Пользователь сам проверит и подтвердит: заявка — «на почту», УПД — в приёмку. Несколько номеров — по очереди. Для «ubaci/внеси/занеси заявку 7137 в почту» и «ubaci UPD 83464 / поставку в приёмку».", p: { kind: ["string", "zay — заявки (в почту) | upd — УПД, поставка (в приёмку)"], numbers: ["array", "номера из имени файла (7137, 83464)"], all: ["boolean", "все новые файлы папки"] }, req: ["kind"] },
  { name: "inbox_list", d: "Что лежит в папке «Заявки» или «Поставки (УПД)»: новые файлы, в очереди, ждут подтверждения, ошибки.", p: { kind: ["string", "zay | upd"] }, req: ["kind"] },
  { name: "issue_from_text", d: "Выдача (списание) по заявкам из текста: «Заявка 7112: Геотекстиль - 1800 м2; Мембрана 2мм - 645 м2; 7156: Пена - 50 шт». Перепиши то, что сказал пользователь, строками «№заявки: материал - количество единица». Программа найдёт позиции и покажет пользователю на проверку — сама ничего не выдаёт.", p: { text: ["string", "строки «№заявки: материал - количество единица», каждая позиция с новой строки"] }, req: ["text"] },
  { name: "open_screen", d: "Открыть экран программы.", p: { screen: ["string", Object.keys(SCREENS).join("|")] }, req: ["screen"] },
];
function toolsSpec() {
  return TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.d, parameters: { type: "object", required: t.req,
    properties: Object.keys(t.p).reduce((o, k) => { const [ty, ds] = t.p[k]; o[k] = ty === "array" ? { type: "array", items: { type: k === "positions" ? "integer" : "string" }, description: ds } : { type: ty, description: ds }; return o; }, {}) } } }));
}
function runTool(app, auth, L, name, a, acts, ev) {
  a = a || {}; ev = ev || []; const E = require(`${__hooks}/lib1964.js`);
  const evAdd = (f) => { try { f().forEach((c) => { if (ev.length < 12 && !ev.some((x) => x.h === c.h)) ev.push(c); }); } catch (err) { console.log("ai ev:", err); } };
  if (name === "material_issues") { const r = E.issues(app, a.query, a.days); evAdd(() => E.evReq(app, r._groups || [], 10)); delete r._groups; return r; }
  if (name === "search_material") { const r = searchMaterial(app, a.query); evAdd(() => E.evFlags(app, a.query, 4)); evAdd(() => E.evReqIds(app, (r.open_requests || []).map((x) => x.rid), 5));
    (r.open_requests || []).forEach((x) => { delete x.rid; }); return r; }
  if (name === "material_arrivals") { const r = arrivals(app, a.query, a.days); acts.push({ type: "arrivals", query: a.query, days: r.days }); evAdd(() => E.evUpd(app, r.lines, 8)); return { days: r.days, count: r.count, totals: r.totals, lines: r.lines.slice(0, 20) }; }
  if (name === "request_details") { const r = requestDetails(app, a.number); if (r.href) { acts.push({ type: "nav", hash: r.href, label: "Открыть заявку № " + r.number }); evAdd(() => E.evReqIds(app, [r.id], 1)); } return r; }
  if (name === "list_requests") { const r = listRequests(app, a.kind, a.query); acts.push({ type: "nav", hash: "#/pult/" + ({ mail: "mail", open: "open", debt: "debt", receipts: "rcp", passes: "pass" }[a.kind] || "open"), label: "Открыть на пульте" }); return r; }
  if (name === "find_upd") { const r = findUpd(app, a.number); evAdd(() => E.evUpd(app, r.results, 6)); return r; }
  if (name === "inbox_queue" || name === "inbox_list") {
    const X = require(`${__hooks}/lib1965.js`); const kind = String(a.kind || "").toLowerCase().indexOf("upd") >= 0 || /упд|постав|при[её]мк/i.test(String(a.kind || "")) ? "upd" : "zay";
    if (name === "inbox_list") { acts.push({ type: "nav", hash: "#/inbox/" + kind, label: "Открыть папку" });
      return { kind, items: X.list(app, kind).slice(0, 40).map((x) => ({ no: x.number, file: x.name, status: { new: "в папке", queued: "в очереди", reading: "читается", ready: "ждёт подтверждения", done: "сделано", error: "ошибка" }[x.status] || x.status, error: x.error || undefined })) }; }
    if (L.WRITE_ROLES.indexOf(auth.getString ? auth.getString("role") : "") < 0 && !L.isSuper(auth)) return { error: "нет прав" };
    const r = X.queue(app, auth, L, { kind, numbers: a.numbers, all: !!a.all });
    acts.push({ type: "nav", hash: "#/inbox/" + kind, label: "Открыть папку — ждут подтверждения", auto: r.queued.length > 0 });
    return Object.assign(r, { note: "Файлы читаются по одному; каждый прочитанный — в «Ждут подтверждения». Без подтверждения пользователя ничего не создаётся." });
  }
  if (name === "issue_from_text") {
    if (L.WRITE_ROLES.indexOf(auth.getString ? auth.getString("role") : "") < 0 && !L.isSuper(auth)) return { error: "нет прав" };
    const p = require(`${__hooks}/lib1966.js`).proposal(app, [String(a.text || "")], "text");
    if (!p.rows) return { error: "не нашёл строк «№заявки: материал - количество»" };
    acts.push({ type: "issue", prop: p, label: "Проверить и выдать", auto: true });
    return { requests: p.groups.map((g) => ({ no: g.no, found: !!g.req, rows: g.rows.map((r) => ({ text: r.text, matched: !!r.item, qty: r.qty, warn: r.warn })) })), note: "Показано пользователю на проверку; выдаст он сам." };
  }
  if (name === "open_screen") { const h = SCREENS[a.screen] || "#/home"; acts.push({ type: "nav", hash: h, label: "Открыть", auto: true }); return { ok: true, opened: h }; }
  if (name === "make_pass") {
    if (L.WRITE_ROLES.indexOf(auth.getString ? auth.getString("role") : "") < 0 && !L.isSuper(auth)) return { error: "нет прав делать пропуск" };
    const nos = (Array.isArray(a.requests) ? a.requests : [a.requests]).map(String).filter(Boolean).slice(0, 10);
    const r = require(`${__hooks}/lib1961.js`).passDraft(app, auth, L, { nos, pos: nos.length === 1 ? a.positions : [] });
    if (r.many) return { error: "по номеру нашлось несколько заявок", options: r.many };
    acts.push({ type: "pass", id: r.pass.id, label: "Открыть пропуск" });
    return { ok: true, title: r.pass.title, rows: (r.pass.rows || []).length, existed: r.existed };
  }
  return { error: "нет такого инструмента" };
}
const SYS = "Ты — помощник склада ВЕЛЕССТРОЙ (стройка, Россия) внутри складской программы. Пользователь пишет свободными словами по-русски или по-сербски (латиницей). " +
  "Всегда пользуйся инструментами, чтобы узнать данные программы, — не выдумывай цифры, номера и названия. Если для ответа нужен инструмент — вызови его сразу, без вопросов. " +
  "Пропуск = make_pass: «первые две» — позиции [1,2], «без шестой» — все кроме 6 (сначала узнай число позиций через request_details). Несколько заявок — один пропуск. " +
  "Вопросы «сколько выдано», «по каким заявкам», «кому выдали», «куда ушёл» материал — material_issues (все заявки, открытые и закрытые), не list_requests. " +
  "Короткий уточняющий вопрос («по каким заявкам?», «а кому?», «а в октябре?») относится к материалу из предыдущего вопроса — повтори поиск по нему. " +
  "Отвечай с доказательствами: номера заявок, даты, кто получил, сколько; программа сама покажет под ответом карточки — заявки с фото (подписанная, погрузка), пропуска, УПД с фото, флажки. Ссылок не пиши. " +
  "Выдача по тексту («skini/выдай/списать по заявке 7112 геотекстиль 1800 м2…») — issue_from_text. Снимок выдачи пользователь прикладывает кнопкой 📎. " +
  "Папки: «ubaci/внеси заявку 7137 (и 7140…) в почту» — inbox_queue kind=zay; «ubaci UPD 83464 / поставку в приёмку» — inbox_queue kind=upd. Сам ничего не создаёшь — файлы идут в «Ждут подтверждения». " +
  "3 месяца = 90 дней, полгода = 180, неделя = 7. Отвечай коротко и по делу, на языке пользователя; числа с единицами; для списков — короткие строки. Если данных нет — так и скажи.";
function ask(app, auth, L, history, text) {
  const st = status(app);
  const msgs = [{ role: "system", content: SYS + " Сегодня " + new Date().toISOString().slice(0, 10) + "." }];
  (Array.isArray(history) ? history : []).slice(-6).forEach((m) => { if (m && (m.role === "user" || m.role === "assistant") && m.content) msgs.push({ role: m.role, content: String(m.content).slice(0, 2000) }); });
  // 1.9.64: вопрос о выдаче — подсказка модели (иначе путает с «открытыми заявками»); короткий уточняющий — материал из прошлого вопроса
  let ut = String(text || "").slice(0, 1000);
  if (/(выда|выдал|получил|по как\S* заявк|кому|куда уш|izda|po koj\S* zajavk|kome)/i.test(ut)) {
    const pu = (Array.isArray(history) ? history : []).filter((m) => m && m.role === "user" && m.content).map((m) => String(m.content)).pop() || "";
    ut += "\n\n[подсказка программы: это вопрос о выдаче материала — вызови material_issues" + (ut.split(/\s+/).length <= 4 && pu ? "; материал — из прошлого вопроса: «" + pu.slice(0, 200) + "»" : "") + "]";
  }
  msgs.push({ role: "user", content: ut });
  const acts = [], used = [], ev = [];
  for (let step = 0; step < 4; step++) {
    const j = call(app, { model: "gpt://" + readCfg(app).YC_FOLDER + "/" + st.model, messages: msgs, tools: toolsSpec(), tool_choice: "auto", temperature: 0.1, max_tokens: 1200 });
    const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const tc = Array.isArray(m.tool_calls) ? m.tool_calls.slice(0, 4) : [];
    if (!tc.length) return { answer: String(m.content || "").trim() || "Не понял — скажите иначе.", actions: acts, used, ev };
    msgs.push({ role: "assistant", content: m.content || "", tool_calls: tc });
    tc.forEach((c) => {
      const fn = (c.function && c.function.name) || ""; let args = (c.function && c.function.arguments) || {};
      if (typeof args === "string") { try { args = JSON.parse(args || "{}"); } catch (_) { args = {}; } }
      let res; try { res = runTool(app, auth, L, fn, args, acts, ev); } catch (err) { res = { error: String((err && err.message) || err).slice(0, 300) }; }
      used.push(fn); msgs.push({ role: "tool", tool_call_id: c.id || fn, name: fn, content: JSON.stringify(res).slice(0, 7000) });
    });
  }
  return { answer: "Готово.", actions: acts, used, ev };
}
module.exports = { readCfg, writeCfg, status, call, ask, arrivals, searchMaterial, requestDetails, TOOLS };
