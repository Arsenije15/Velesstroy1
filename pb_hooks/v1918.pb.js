/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.18 — АОСР (PDF / скан / фото) → Общий журнал работ: Раздел 3 (строка на каждый день работ) и Раздел 6 (строка на акт)

// ---------- Прочитать акт (файл уже загружен черновиком) — в фоне, как УПД ----------
routerAdd("POST", "/api/vs/aosr/ocr", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const rec = $app.findRecordById("aosr", L.str((e.requestInfo().body || {}).id));
  if (!L.isSuper(a) && rec.getString("uploaded_by") !== a.id) throw new ForbiddenError("Это не ваш файл.");
  if (!rec.getString("file")) throw new BadRequestError("Файл не загружен.");
  const path = $app.dataDir() + "/storage/" + rec.collection().id + "/" + rec.id + "/" + rec.getString("file");
  const job = $app.dataDir() + "/ocr_jobs/aosr_" + rec.id.replace(/[^a-z0-9]/g, "") + ".txt";
  try { $os.cmd("sh", "-c", 'mkdir -p "$(dirname "$3")"; rm -f "$3" "$3.tmp" "$3.prog"; date +%s > "$3.start"; ( VS_OCR_PROGRESS="$3.prog" timeout 400 nice -n 10 python3 "$1" "$2" > "$3.tmp" 2>&1; echo; echo "__EXIT__$?" >> "$3.tmp"; mv "$3.tmp" "$3" ) </dev/null >/dev/null 2>&1 &', "sh", `${__hooks}/aosr_ocr.py`, path, job).run(); }
  catch (err) { throw new BadRequestError("Распознавание не запустилось на сервере: " + String(err).slice(0, 200)); }
  return e.json(200, { started: true });
}, $apis.requireAuth("users"));

routerAdd("GET", "/api/vs/aosr/ocr_status/{id}", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "skk"]);
  const rec = $app.findRecordById("aosr", e.request.pathValue("id"));
  const job = $app.dataDir() + "/ocr_jobs/aosr_" + rec.id.replace(/[^a-z0-9]/g, "") + ".txt";
  let txt = null; try { txt = toString($os.readFile(job)); } catch (_) {}
  if (txt === null) {
    let st = 0; try { st = parseInt(toString($os.readFile(job + ".start")), 10) || 0; } catch (_) {}
    if (!st) return e.json(200, { status: "none" });
    const sec = Math.round(Date.now() / 1000 - st);
    if (sec > 450) { try { $os.remove(job + ".start"); } catch (_) {} return e.json(200, { status: "error", message: "Чтение не закончилось — заполните акт вручную." }); }
    let prog = ""; try { prog = toString($os.readFile(job + ".prog")).trim(); } catch (_) {}
    const pm = prog.match(/^(\d+)\/(\d+)$/);
    return e.json(200, { status: "running", sec: sec, page: pm ? parseInt(pm[1], 10) : 0, pages: pm ? parseInt(pm[2], 10) : 0 });
  }
  [job, job + ".start", job + ".prog"].forEach((f) => { try { $os.remove(f); } catch (_) {} });
  const body = txt.replace(/\n?__EXIT__\d+\s*$/, "").trim();
  let res = null;
  try { res = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)); }
  catch (_) { return e.json(200, { status: "error", message: "Ошибка распознавания на сервере: " + body.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300) }); }
  if (res.error) return e.json(200, { status: "error", message: res.error });
  const fresh = $app.findRecordById("aosr", rec.id); fresh.set("ocr", res); $app.saveNoValidate(fresh);
  res.status = "done"; delete res.text;
  return e.json(200, res);
}, $apis.requireAuth("users"));

// ---------- Сохранить акт (новый — без файла, или черновик после чтения) ----------
routerAdd("POST", "/api/vs/aosr/save", (e) => {
  const L = require(`${__hooks}/lib.js`), X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const b = e.requestInfo().body || {};
  const D = (v) => { const s = L.str(v).slice(0, 10); if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestError("Неверная дата: " + s); return s; };
  const no = L.str(b.number).replace(/\s+/g, " ").trim().replace(/\.$/, "").slice(0, 120);
  if (!no) throw new BadRequestError("Укажите номер акта.");
  const date = D(b.date); if (!date) throw new BadRequestError("Укажите дату акта.");
  const ds = D(b.d_start), de = D(b.d_end);
  if (ds && de && de < ds) throw new BadRequestError("Дата окончания работ раньше даты начала.");
  const kind = (L.str(b.kind).trim() || "АОСР").slice(0, 30);
  const reps = (Array.isArray(b.reps) ? b.reps : []).slice(0, 12).map((x) => L.str(x).replace(/\s+/g, " ").trim().slice(0, 600));
  let out = null;
  $app.runInTransaction((tx) => {
    let rec;
    if (L.str(b.id)) {
      rec = tx.findRecordById("aosr", L.str(b.id));
      if (rec.getString("status") === "draft" && !L.isSuper(a) && rec.getString("uploaded_by") && rec.getString("uploaded_by") !== a.id && L.role(a) !== "admin") throw new ForbiddenError("Это не ваш файл.");
    } else { rec = new Record(tx.findCollectionByNameOrId("aosr")); if (L.authId(a)) rec.set("uploaded_by", a.id); }
    const dup = tx.findRecordsByFilter("aosr", "status = 'ok' && number = {:n} && kind = {:k}" + (rec.id ? " && id != {:i}" : ""), "", 1, 0, { n: no, k: kind, i: rec.id || "" });
    if (dup.length) throw new BadRequestError(kind + " № " + no + " уже есть (от " + dup[0].getString("date").split("-").reverse().join(".") + ").");
    rec.set("status", "ok"); rec.set("kind", kind); rec.set("number", no); rec.set("date", date);
    rec.set("work_full", L.str(b.work_full).trim().slice(0, 6000)); rec.set("code", L.str(b.code).trim().slice(0, 200)); rec.set("work_short", L.str(b.work_short).trim().slice(0, 6000));
    rec.set("d_start", ds); rec.set("d_end", de); rec.set("reps", reps); rec.set("performer", L.str(b.performer).replace(/\s+/g, " ").trim().slice(0, 600));
    rec.set("search_lc", X.lc([kind, no, date.split("-").reverse().join("."), rec.getString("code"), rec.getString("work_full"), rec.getString("work_short"), reps.join(" ")].join(" ")).slice(0, 8000));
    tx.save(rec); out = rec.id;
  });
  reps.forEach((r) => X.remember($app, "aosr_rep", r));
  X.remember($app, "aosr_kind", kind);
  if (L.str(b.performer)) X.remember($app, "aosr_perf", L.str(b.performer));
  return e.json(200, { id: out });
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/aosr/delete", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const rec = $app.findRecordById("aosr", L.str((e.requestInfo().body || {}).id));
  if (rec.getString("status") === "ok" && L.role(a) !== "admin" && !L.isSuper(a) && rec.getString("uploaded_by") !== a.id) throw new ForbiddenError("Удалить может тот, кто загрузил, или администратор.");
  $app.delete(rec);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Дописать выбранные акты в файл журнала (.xlsx) — по датам, с пересчётом № п/п ----------
routerAdd("POST", "/api/vs/aosr/journal", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager", "skk"]);
  const b = e.requestInfo().body || {};
  const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => L.str(x)).filter(Boolean).slice(0, 500);
  if (!ids.length) throw new BadRequestError("Не выбраны акты.");
  const b64 = L.str(b.b64);
  if (b64.length < 100) throw new BadRequestError("Загрузите файл журнала (.xlsx).");
  const acts = ids.map((id) => $app.findRecordById("aosr", id)).filter((r) => r.getString("status") === "ok").map((r) => {
    let reps = []; try { reps = JSON.parse(r.getString("reps") || "[]"); } catch (_) {}
    return { kind: r.getString("kind"), number: r.getString("number"), date: r.getString("date"), work_full: r.getString("work_full"), code: r.getString("code"),
      work_short: r.getString("work_short"), d_start: r.getString("d_start"), d_end: r.getString("d_end"), reps: reps, performer: r.getString("performer") };
  });
  if (!acts.length) throw new BadRequestError("Выбранные акты ещё не проверены (черновики).");
  const dir = $app.dataDir() + "/journal_tmp/" + $security.randomString(12);
  const run = (cmd) => toString($os.cmd("sh", "-c", cmd).output());
  let res = null;
  try {
    $os.mkdirAll(dir, 0o700);
    $os.writeFile(dir + "/in.b64", b64, 0o600);
    $os.writeFile(dir + "/acts.json", JSON.stringify(acts), 0o600);
    const txt = toString($os.cmd("sh", "-c", 'timeout 120 python3 "$1" "$2/in.b64" "$2/acts.json" "$2/out.b64" 2>&1', "sh", `${__hooks}/journal_fill.py`, dir).output()).trim();
    try { res = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1)); } catch (_) { throw new BadRequestError("Ошибка при записи журнала: " + txt.split("\n").slice(-2).join(" | ").slice(0, 300)); }
    if (res.error) throw new BadRequestError(res.error);
    res.b64 = toString($os.readFile(dir + "/out.b64"));
  } finally { try { $os.removeAll(dir); } catch (_) {} }
  const now = new Date().toISOString().replace("T", " ");
  ids.forEach((id) => { try { const r = $app.findRecordById("aosr", id); r.set("journal_at", now); $app.saveNoValidate(r); } catch (_) {} });
  return e.json(200, res);
}, $apis.requireAuth("users"));
