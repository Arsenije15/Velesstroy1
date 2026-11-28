// VELESSTROY 1.9.65 — папки «Заявки» и «Поставки (УПД)».
// Файлы называются З-7137.pdf / Z-7137.pdf (заявка) и П-83464.pdf / УПД-83464.pdf (поставка). Помощник или команда
// ставит их в очередь; сервер читает по одному (заявка — сразу, УПД — в фоне) → «Ждут подтверждения». Пользователь
// проверяет и подтверждает: заявка — «на почте», УПД — приёмка. Ничего не создаётся без подтверждения.
const KINDS = { zay: "заявки", upd: "УПД" };
const normNo = (s) => String(s || "").toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
const nowIso = () => new Date().toISOString().replace("T", " ");
function rows(app, sql, model, P) { const R = arrayOf(new DynamicModel(model)); const q = app.db().newQuery(sql); if (P) q.bind(P); q.all(R); return JSON.parse(JSON.stringify(R)); }
// «З-7137.pdf», «Z_7137 Нефтехим.pdf», «7137_____.pdf», «П-83464.pdf», «УПД №83464.pdf» → номер
function parseName(kind, name) {
  let b = String(name || "").replace(/\.[A-Za-z0-9]{2,5}$/, "").trim();
  b = b.replace(kind === "upd" ? /^\s*(?:упд|upd|поставка|postavka|[PpПпUuУу](?![A-Za-zА-Яа-яЁё]))\s*[-_.№#\s]*/i : /^\s*(?:заявка|zajavka|[ZzЗз](?![A-Za-zА-Яа-яЁё]))\s*[-_.№#\s]*/i, "");
  const m = b.match(/^№?\s*([^\s,;()]+)/); return (m ? m[1] : b).replace(/[_\-.]+$/, "").slice(0, 120);
}
// чтение заявки (тот же разбор, что «Заполнить со скана»): PDF из Excel — из текста, скан — распознавание; PID → оперативка
function zayOcr(app, path, number) {
  let txt = "";
  try { txt = toString($os.cmd("timeout", "240", "nice", "-n", "15", "python3", `${__hooks}/ocr_zayavka.py`, path).output()); }
  catch (err) { throw new BadRequestError("Распознавание не запустилось на сервере (запустите install.sh ещё раз): " + String(err).slice(0, 200)); }
  let res = null;
  try { res = JSON.parse(txt); } catch (_) { throw new BadRequestError("Не удалось прочитать файл — попробуйте другой скан или фото ровнее."); }
  if (res.error) throw new BadRequestError(res.error);
  delete res.debug;
  if (!res.items || !res.items.length) throw new BadRequestError("В файле не найдена таблица заявки. Сфотографируйте лист целиком, ровно и при хорошем свете.");
  const known = [];
  try { rows(app, "SELECT DISTINCT supplier FROM acts WHERE supplier != '' LIMIT 600", { supplier: "" }).forEach((r) => known.push(r.supplier)); } catch (_) {}
  try { app.findRecordsByFilter("suggestions", "field = 'supplier'", "-last", 300, 0).forEach((r) => known.push(r.getString("value"))); } catch (_) {}
  res.known_suppliers = known;
  try { res.pid_hits = require(`${__hooks}/lib1963.js`).pidEnrich(app, res.items, (res.header && res.header.number) || number); } catch (err) { res.pid_error = String(err).slice(0, 200); }
  return res;
}
function updJobStart(app, path, id) {
  const job = require(`${__hooks}/lib18.js`).ocrJob(id);
  $os.cmd("sh", "-c", 'mkdir -p "$(dirname "$3")"; rm -f "$3" "$3.tmp" "$3.prog"; date +%s > "$3.start"; ( VS_OCR_PROGRESS="$3.prog" timeout 540 nice -n 15 python3 "$1" "$2" > "$3.tmp" 2>&1; echo; echo "__EXIT__$?" >> "$3.tmp"; mv "$3.tmp" "$3" ) </dev/null >/dev/null 2>&1 &', "sh", `${__hooks}/ocr_upd.py`, path, job).run();
}
const fpath = (app, rec, f) => app.dataDir() + "/storage/" + rec.collection().id + "/" + rec.id + "/" + rec.getString(f || "file");
function setSt(app, id, st, extra) { const r = app.findRecordById("inbox_files", id); r.set("status", st); Object.keys(extra || {}).forEach((k) => r.set(k, extra[k])); app.saveNoValidate(r); return r; }
// дубли: заявка с таким номером уже есть / приёмка по этому УПД уже есть
function dupZay(app, no) { const n = normNo(no); if (!n) return null; const d = app.findRecordsByFilter("requests", "number_norm = {:n} && status != 'cancelled'", "-created", 1, 0, { n }); return d.length ? { id: d[0].id, number: d[0].getString("number"), status: d[0].getString("status"), handed: !!d[0].getString("handed_at") } : null; }
function dupUpd(app, no) { const n = normNo(no); if (!n) return null;
  const d = rows(app, "SELECT id, COALESCE(upd_number,'') AS no, COALESCE(status,'') AS st FROM receipts WHERE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(upd_number,''),'-',''),' ',''),'/',''),'.','')) = {:n} ORDER BY created DESC LIMIT 1", { id: "", no: "", st: "" }, { n });
  return d.length ? { id: d[0].id, number: d[0].no, status: d[0].st } : null; }

// ---------- один шаг очереди: проверить фоновые УПД, взять следующий файл ----------
function processNext(app, L) {
  const K = require(`${__hooks}/lib18.js`); const out = { did: null };
  // 1) УПД, которые читаются в фоне
  app.findRecordsByFilter("inbox_files", "kind = 'upd' && status = 'reading'", "read_at", 20, 0).forEach((it) => {
    const uid = it.getString("upd_doc"); if (!uid) { setSt(app, it.id, "error", { error: "чтение прервалось — нажмите «Прочитать заново»" }); return; }
    const job = K.ocrJob(uid); let txt = null; try { txt = toString($os.readFile(job)); } catch (_) {}
    if (txt === null) {
      let st = 0; try { st = parseInt(toString($os.readFile(job + ".start")), 10) || 0; } catch (_) {}
      const age = st ? Date.now() / 1000 - st : (Date.now() - new Date(String(it.getString("read_at")).replace(" ", "T")).getTime()) / 1000;
      if (age > 620) { [job + ".start", job + ".prog"].forEach((f) => { try { $os.remove(f); } catch (_) {} }); setSt(app, it.id, "error", { error: "УПД не прочитался за 10 минут — откройте и впишите вручную" }); }
      return;
    }
    [job, job + ".start", job + ".prog"].forEach((f) => { try { $os.remove(f); } catch (_) {} });
    try {
      const u = app.findRecordById("upd_docs", uid); const res = K.ocrFinish(L, u, txt); const h = res.header || {};
      const r = { upd_doc: uid, number: h.number || "", date: h.date || "", seller: h.seller || "", n: (res.items || []).length, check: res.check || {} };
      r.name_no = it.getString("number"); r.dup = dupUpd(app, h.number || it.getString("number"));
      setSt(app, it.id, "ready", { result: r, error: "", ms: Math.round(Date.now() - new Date(String(it.getString("read_at")).replace(" ", "T")).getTime()) });
      out.did = out.did || { id: it.id, kind: "upd", number: it.getString("number"), status: "ready" };
    } catch (err) { setSt(app, it.id, "error", { error: String((err && err.message) || err).replace(/^.*?Error: /, "").slice(0, 500) }); }
  });
  // 2) заявка, которая «читается» дольше 6 минут — сервер перезапускался; не крутить по кругу
  const stale = new Date(Date.now() - 6 * 60000).toISOString().replace("T", " ");
  app.findRecordsByFilter("inbox_files", "kind = 'zay' && status = 'reading' && read_at < {:d}", "", 20, 0, { d: stale }).forEach((it) => setSt(app, it.id, "error", { error: "чтение прервалось — нажмите «Прочитать заново»" }));
  // 3) следующий из очереди (по порядку постановки); захват атомарный — два обработчика не возьмут один файл
  const nx = rows(app, "SELECT id FROM inbox_files WHERE status = 'queued' ORDER BY queued_at, created LIMIT 3", { id: "" });
  let it = null;
  for (let i = 0; i < nx.length && !it; i++) {
    let n = 0; try { const rr = app.db().newQuery("UPDATE inbox_files SET status = 'reading', read_at = {:t}, error = '' WHERE id = {:id} AND status = 'queued'").bind({ t: nowIso(), id: nx[i].id }).execute(); n = rr.rowsAffected(); } catch (err) { n = 0; }
    if (n) it = app.findRecordById("inbox_files", nx[i].id);
  }
  if (it) {
    const path = fpath(app, it);
    if (it.getString("kind") === "zay") {
      const t0 = Date.now();
      try { const res = zayOcr(app, path, it.getString("number")); const h = res.header || {};
        res.name_no = it.getString("number"); res.dup = dupZay(app, h.number || it.getString("number"));
        setSt(app, it.id, "ready", { result: res, error: "", ms: Date.now() - t0 });
        out.did = { id: it.id, kind: "zay", number: it.getString("number"), status: "ready" };
      } catch (err) { setSt(app, it.id, "error", { error: String((err && err.message) || err).replace(/^.*?Error: /, "").slice(0, 500), ms: Date.now() - t0 }); out.did = { id: it.id, kind: "zay", number: it.getString("number"), status: "error" }; }
    } else {
      try {   // УПД — черновик в upd_docs (как «Новая приёмка» → «Прочитать УПД»), чтение в фоне
        const u = new Record(app.findCollectionByNameOrId("upd_docs")); u.set("status", "draft"); u.set("uploaded_by", it.getString("uploaded_by"));
        u.set("file", $filesystem.fileFromPath(path)); app.save(u);
        updJobStart(app, fpath(app, u), u.id);
        setSt(app, it.id, "reading", { upd_doc: u.id });
        out.did = { id: it.id, kind: "upd", number: it.getString("number"), status: "reading" };
      } catch (err) { setSt(app, it.id, "error", { error: "Чтение УПД не запустилось: " + String((err && err.message) || err).slice(0, 300) }); }
    }
  }
  const c = rows(app, "SELECT status, COUNT(*) AS n FROM inbox_files WHERE status IN ('queued','reading','ready') GROUP BY status", { status: "", n: 0 });
  c.forEach((x) => { out[x.status] = x.n; });
  return out;
}

// ---------- поставить в очередь: по номерам (как в имени файла), по id или «все новые» ----------
function queue(app, auth, L, b) {
  const kind = b.kind === "upd" ? "upd" : "zay"; const who = L.userName(auth);
  const res = { kind, queued: [], missing: [], already: [] };
  let list = [];
  if (Array.isArray(b.ids) && b.ids.length) list = b.ids.slice(0, 50).map((id) => { try { return app.findRecordById("inbox_files", L.str(id)); } catch (_) { return null; } }).filter(Boolean);
  else if (b.all) list = app.findRecordsByFilter("inbox_files", "kind = {:k} && status = 'new'", "created", 50, 0, { k: kind });
  else {
    const nos = (Array.isArray(b.numbers) ? b.numbers : String(b.numbers || "").split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
    nos.forEach((no) => {
      const n = normNo(String(no).replace(kind === "upd" ? /^\s*(?:упд|upd|[PpПпUuУу](?=[-_\s№]))\s*[-_№\s]*/i : /^\s*(?:[ZzЗз](?=[-_\s№]))\s*[-_№\s]*/i, ""));
      if (!n) return;
      const f = app.findRecordsByFilter("inbox_files", "kind = {:k} && number_norm = {:n}", "-created", 1, 0, { k: kind, n });
      if (!f.length) { res.missing.push(no); return; }
      list.push(f[0]);
    });
  }
  const t = Date.now();
  list.forEach((r, i) => {
    const st = r.getString("status"), no = r.getString("number");
    if (r.getString("kind") !== kind && !(Array.isArray(b.ids) && b.ids.length)) return;
    if (st === "queued" || st === "reading") { res.already.push({ no, status: "уже читается" }); return; }
    if (st === "ready" && !b.again) { res.already.push({ no, status: "уже прочитан — ждёт подтверждения" }); return; }
    if (st === "done" && !b.again) { res.already.push({ no, status: "уже сделано" + (r.getString("ref_no") ? " (№ " + r.getString("ref_no") + ")" : "") }); return; }
    r.set("status", "queued"); r.set("queued_at", new Date(t + i).toISOString().replace("T", " ")); r.set("queued_by", who); r.set("error", ""); r.set("result", null);
    if (st === "done") { r.set("ref", ""); r.set("ref_no", ""); }
    app.saveNoValidate(r); res.queued.push(no);
  });
  if (res.queued.length) try { L.log(app, auth, "inbox_queue", "inbox_files", "", "📥 В очередь (" + KINDS[kind] + "): " + res.queued.join(", ") + (res.missing.length ? " · нет в папке: " + res.missing.join(", ") : ""), {}); } catch (_) {}
  return res;
}
// краткая карточка файла — для списка, пульта и помощника
function brief(r) {
  const o = typeof r.get === "function" ? { id: r.id, kind: r.getString("kind"), name: r.getString("name"), number: r.getString("number"), status: r.getString("status"), error: r.getString("error"), file: r.getString("file"),
    by_name: r.getString("by_name"), queued_by: r.getString("queued_by"), created: r.getString("created"), read_at: r.getString("read_at"), done_at: r.getString("done_at"), ref: r.getString("ref"), ref_no: r.getString("ref_no"), ms: r.getFloat("ms"), res: (() => { try { return JSON.parse(r.getString("result") || "null"); } catch (_) { return null; } })() } : r;
  const x = o.res || {}; delete o.res;
  if (o.kind === "zay" && x.header) { const h = x.header; o.sum = { number: h.number || "", date: h.date || "", object: h.object || "", recipient: h.recipient || "", n: (x.items || []).length, pages: x.pages || 1,
      text: (x.items || []).some((i) => i.src === "text"), pid: x.pid_hits || 0, over: (x.items || []).filter((i) => (i.warn || []).indexOf("pid_limit") >= 0).length,
      doubt: (x.items || []).filter((i) => (i.warn || []).some((w) => w !== "pid_limit")).length, dup: x.dup || null, name_no: x.name_no || "" }; }
  if (o.kind === "upd" && x.upd_doc) o.sum = { number: x.number, date: x.date, seller: x.seller, n: x.n, sum_ok: !!(x.check && x.check.sum_ok), dup: x.dup || null, upd_doc: x.upd_doc, name_no: x.name_no || "" };
  return o;
}
function list(app, kind) {
  const R = rows(app, "SELECT id FROM inbox_files WHERE kind = {:k} AND (status != 'done' OR done_at >= {:d}) ORDER BY created DESC LIMIT 300", { id: "" }, { k: kind, d: new Date(Date.now() - 30 * 864e5).toISOString().replace("T", " ") });
  return R.map((x) => brief(app.findRecordById("inbox_files", x.id)));
}
// плитка «Папки» на пульте: что ждёт подтверждения, что читается, ошибки, файлы, которые ещё не отправлены
function pultItems(app) {
  const T = { new: { k: "mail", t: "в папке — не отправлен" }, queued: { k: "ok", t: "в очереди" }, reading: { k: "ok", t: "читается…" }, ready: { k: "conf", t: "ждёт подтверждения" } };
  return rows(app, "SELECT id, kind, COALESCE(number,'') AS no, status, COALESCE(error,'') AS err, created FROM inbox_files WHERE status != 'done' ORDER BY (status = 'ready') DESC, created DESC LIMIT 300",
    { id: "", kind: "", no: "", status: "", err: "", created: "" })
    .map((r) => ({ id: r.id, href: "#/inbox/" + r.kind, no: (r.kind === "upd" ? "УПД " : "З-") + r.no, t1: r.kind === "upd" ? "Поставка (УПД)" : "Заявка", t2: "", at: r.created,
      miss: [r.status === "error" ? { k: "err", t: "ошибка: " + r.err.slice(0, 80) } : T[r.status] || { k: "ok", t: r.status }] }));
}
module.exports = { parseName, normNo, zayOcr, processNext, queue, brief, list, pultItems, dupZay, dupUpd, KINDS };
