/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.62 — 🤖 помощник (Yandex AI Studio), приход материала за период, пропуск по нескольким заявкам, ссылка «ОМТС»
routerAdd("GET", "/api/vs/ai/status", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const s = require(`${__hooks}/lib1962.js`).status($app);
  return e.json(200, L.isSuper(a) || a.getString("role") === "admin" ? s : { on: s.on });
}, $apis.requireAuth("users"));
// ключ: только администратор; пустой ключ — оставить прежний; ключ в ответ не возвращается
routerAdd("POST", "/api/vs/ai/config", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, ["admin"]);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Только администратор.");
  const X = require(`${__hooks}/lib1962.js`); const b = e.requestInfo().body || {}; const c = X.readCfg($app);
  if (b.off) { X.writeCfg($app, {}); L.log($app, a, "ai_config", "", "", "🤖 Помощник отключён (ключ удалён с сервера)", {}); return e.json(200, X.status($app)); }
  const folder = L.str(b.folder).trim(), key = L.str(b.key).trim(), model = L.str(b.model).trim();
  if (folder) { if (!/^[a-z0-9]{10,40}$/.test(folder)) throw new BadRequestError("ID папки — латинские буквы и цифры (обычно начинается с b1g)."); c.YC_FOLDER = folder; }
  if (key) { if (!/^[A-Za-z0-9_\-.]{20,200}$/.test(key)) throw new BadRequestError("Ключ не похож на секретный ключ Yandex — скопируйте его целиком."); c.YC_KEY = key; delete c.YC_BASE; delete c.YC_AUTH; }
  if (model) { if (!/^[a-z0-9.\-_]+\/[a-z0-9.\-_]+$/i.test(model)) throw new BadRequestError("Модель — вида yandexgpt/latest."); c.YC_MODEL = model; }
  const base = L.str(b.base).trim(); if (base && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(base)) c.YC_BASE = base;   // для проверки программы
  if (!c.YC_FOLDER || !c.YC_KEY) throw new BadRequestError("Нужны ID папки и секретный ключ.");
  X.writeCfg($app, c);
  L.log($app, a, "ai_config", "", "", "🤖 Помощник Yandex: настройки сохранены (папка " + c.YC_FOLDER + ", модель " + (c.YC_MODEL || "yandexgpt/latest") + ")", {});
  return e.json(200, X.status($app));
}, $apis.requireAuth("users"));
// проверка связи: список моделей + короткий ответ модели
routerAdd("POST", "/api/vs/ai/test", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin"]);
  const X = require(`${__hooks}/lib1962.js`); const st = X.status($app); let models = [];
  try { const m = X.call($app, null, "/models"); models = ((m && m.data) || []).map((x) => String(x.id || "")).filter(Boolean).slice(0, 60); } catch (_) {}
  const j = X.call($app, { model: "gpt://" + X.readCfg($app).YC_FOLDER + "/" + st.model, messages: [{ role: "user", content: "Ответь одним словом: работает?" }], max_tokens: 20, temperature: 0 });
  const t = j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
  return e.json(200, { ok: true, reply: t.slice(0, 200), models, model: st.model, usage: j.usage || null });
}, $apis.requireAuth("users"));
// вопрос помощнику: {text, history:[{role,content}]}
routerAdd("POST", "/api/vs/ai/ask", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  if (a.getString && a.getString("scope")) throw new ForbiddenError("Помощник — только в основной программе.");
  const b = e.requestInfo().body || {}; const text = L.str(b.text).trim();
  if (!text) throw new BadRequestError("Напишите, что нужно.");
  const t0 = Date.now(); const r = require(`${__hooks}/lib1962.js`).ask($app, a, L, b.history, text);
  r.ms = Date.now() - t0;
  try { L.log($app, a, "ai_ask", "", "", "🤖 " + text.slice(0, 200) + (r.used.length ? " → " + r.used.join(", ") : ""), {}); } catch (_) {}
  return e.json(200, r);
}, $apis.requireAuth("users"));
// приход материала за период (и без помощника: команда «пришло арматура 3 месяца»)
routerAdd("GET", "/api/vs/arrivals", (e) => {
  const L = require(`${__hooks}/lib.js`); L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const g = (k) => String(e.request.url.query().get(k) || "").trim();
  if (!g("q")) throw new BadRequestError("Какой материал?");
  return e.json(200, require(`${__hooks}/lib1962.js`).arrivals($app, g("q").slice(0, 100), g("days") || 90));
}, $apis.requireAuth("users"));
// добавить заявку в черновик пропуска
routerAdd("POST", "/api/vs/pass/add", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  return e.json(200, require(`${__hooks}/lib1961.js`).passAddRequest($app, a, L, e.requestInfo().body || {}));
}, $apis.requireAuth("users"));
// ---------- ОМТС: специалист по ссылке видит заявки и ставит подпись «Согласовано ОМТС» ----------
routerAdd("GET", "/api/vs/omts/list", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = e.auth;
  const sc = a && a.getString ? a.getString("scope") : "";
  if (sc !== "omts") L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const q = String(e.request.url.query().get("q") || "").toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(Boolean);
  const R = $app.findRecordsByFilter("requests", "status = 'open'", "-created", 400, 0);
  const out = [];
  R.forEach((r) => {
    let sig = {}; try { sig = JSON.parse(r.getString("signatures") || "{}") || {}; } catch (_) {}
    const its = $app.findRecordsByFilter("request_items", "request = {:r}", "sort,created", 200, 0, { r: r.id }).map((i) => ({ material: i.getString("material"), qty: i.getFloat("qty_ordered"), unit: i.getString("unit"), pid: i.getString("rd"), supplier: i.getString("supplier"), upd: i.getString("supply_doc") }));
    const txt = [r.getString("number"), r.getString("object"), r.getString("recipient")].concat(its.map((x) => x.material)).join(" ").toLowerCase().replace(/ё/g, "е");
    if (q.length && !q.every((w) => txt.indexOf(w) >= 0)) return;
    out.push({ id: r.id, number: r.getString("number"), object: r.getString("object"), applicant: r.getString("recipient"), created: r.getString("created"), in_mail: !r.getString("handed_at"), omts: sig.omts || null, items: its });
  });
  out.sort((x, y) => (!!x.omts - !!y.omts) || (x.created < y.created ? 1 : -1));
  return e.json(200, { items: out, me: L.userName(a) });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/omts/sign", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = e.auth;
  const sc = a && a.getString ? a.getString("scope") : "";
  if (sc !== "omts") L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {}; let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("requests", L.str(b.request));
    if (r.getString("status") !== "open") throw new BadRequestError("Заявка уже не открыта.");
    let sig = {}; try { sig = JSON.parse(r.getString("signatures") || "{}") || {}; } catch (_) {}
    if (b.value) sig.omts = { by: L.authId(a), name: L.userName(a), at: L.fmt(new Date()), who: sc === "omts" ? "специалист ОМТС (по ссылке)" : L.str(b.who) };
    else delete sig.omts;
    r.set("signatures", sig); r.set("signed_all", ["omts", "wh_head", "resp", "issued", "received"].every((k) => !!sig[k])); tx.save(r);
    L.log(tx, a, "request_sign", "requests", r.id, (b.value ? "Согласовано ОМТС" : "Снята подпись ОМТС") + ": заявка № " + r.getString("number") + " — " + L.userName(a), {});
    out = { ok: true, omts: sig.omts || null };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));
// человек по ссылке «ОМТС» — только своя страница
routerUse((e) => {
  const a = e.auth; const sc = a && a.getString ? a.getString("scope") : "";
  if (sc === "omts") {
    const p = e.request.url.path; let okp = true;
    if (p.indexOf("/api/vs/") === 0) okp = /^\/api\/vs\/(omts|pub)(\/|$)/.test(p);
    else if (p.indexOf("/api/collections/") === 0) okp = /^\/api\/collections\/(users|broadcasts|suggestions)\//.test(p);
    if (!okp) throw new ForbiddenError("По этой ссылке доступно только «ОМТС: согласование заявок».");
  }
  return e.next();
});
