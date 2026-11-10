// VELESSTROY — общие функции серверной логики (подключаются через require)

const WRITE_ROLES = ["admin", "manager", "storekeeper"];
const ROLE_RU = { admin: "Администратор", manager: "Руководитель", storekeeper: "Кладовщик", viewer: "Просмотр", skk: "СКК (контроль качества)", skk_view: "Наблюдатель склада", coord: "Участник согласований" };

function tzOffsetMin() {
  const v = parseInt($os.getenv("VS_TZ_OFFSET_MIN") || "180", 10); // по умолчанию МСК (UTC+3)
  return isNaN(v) ? 180 : v;
}
function todayLocal() {
  return new Date(Date.now() + tzOffsetMin() * 60000).toISOString().slice(0, 10);
}
function fmt(d) { return d.toISOString().replace("T", " "); }
function parse(s) {
  if (!s) return null;
  const d = new Date(String(s).trim().replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}
function str(v) { return v === undefined || v === null ? "" : String(v).trim(); }

// Номер УПД: регистр, пробелы, «№», дефисы не важны. Кириллица обрабатывается явно (\w её не видит).
function normUpd(s) {
  return str(s).toUpperCase().replace(/^УПД/, "").replace(/[^0-9A-ZА-ЯЁ]/g, "");
}
// Название организации: без кавычек, лишних пробелов и регистра
function normOrg(s) {
  return str(s).toLowerCase().replace(/ё/g, "е").replace(/[«»"'“”„`]/g, "").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

function role(auth) { return auth ? auth.getString("role") : ""; }
function isSuper(auth) { return !!auth && auth.isSuperuser && auth.isSuperuser(); }
function userName(auth) {
  if (!auth) return "система";
  if (isSuper(auth)) return "Суперпользователь";
  return auth.getString("name") || auth.getString("username") || auth.getString("email");
}
function requireRole(e, roles) {
  const a = e.auth;
  if (!a) throw new UnauthorizedError("Требуется вход в систему.");
  if (isSuper(a)) return a;
  if (!a.getBool("active")) throw new ForbiddenError("Учётная запись отключена.");
  if (roles.indexOf(role(a)) < 0) throw new ForbiddenError("Недостаточно прав для этого действия.");
  return a;
}
function authId(a) { return a && !isSuper(a) ? a.id : ""; }

function log(app, auth, action, entity, entityId, summary, details) {
  const r = new Record(app.findCollectionByNameOrId("activity_log"));
  if (authId(auth)) r.set("user", auth.id);
  r.set("user_name", userName(auth));
  r.set("action", action);
  r.set("entity", entity);
  r.set("entity_id", entityId || "");
  r.set("summary", summary || "");
  r.set("details", details || {});
  app.save(r);
}

// ---------- Проверка УПД по базе ограничений ----------
function ruleActiveToday(r) {
  if (!r.getBool("active")) return false;
  const t = todayLocal();
  const f = r.getString("valid_from").slice(0, 10);
  const to = r.getString("valid_to").slice(0, 10);
  if (f && f > t) return false;
  if (to && to < t) return false;
  return true;
}
function evaluate(app, input, warehouse) {
  const upd = normUpd(input.upd);
  const sup = normOrg(input.supplier);
  const snd = normOrg(input.sender);
  const all = app.findRecordsByFilter("rules", "active = true", "", 0, 0);
  const matched = [];
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (!ruleActiveToday(r)) continue;
    const wh = r.getString("warehouse");
    if (wh && warehouse && normOrg(wh) !== normOrg(warehouse)) continue;
    const ru = normUpd(r.getString("upd_number"));
    const rs = normOrg(r.getString("supplier"));
    const rn = normOrg(r.getString("sender"));
    let hit = false, by = "";
    if (ru) { if (upd && ru === upd) { hit = true; by = "upd"; } }
    else {
      if (rs && sup && rs === sup) { hit = true; by = "supplier"; }
      if (rn && (rn === snd || rn === sup) && (snd || sup)) { hit = true; by = by || "sender"; }
    }
    if (hit) matched.push({ r: r, by: by });
  }
  let result = "notfound";
  if (matched.length) {
    const acts = matched.map((m) => m.r.getString("action"));
    result = acts.indexOf("deny") >= 0 ? "red" : acts.indexOf("approval") >= 0 ? "yellow" : "green";
  }
  let approver = "manager";
  matched.forEach((m) => { if (m.r.getString("action") === "approval" && m.r.getString("approver_role") === "admin") approver = "admin"; });
  const order = { deny: 0, approval: 1, allow: 2 };
  matched.sort((a, b) => order[a.r.getString("action")] - order[b.r.getString("action")]);
  const instruction = matched.map((m) => {
    const r = m.r;
    let t = r.getString("description");
    if (r.getString("reason")) t += " Причина: " + r.getString("reason");
    return t;
  }).join("\n");
  return {
    result: result, approver: approver, instruction: instruction,
    rules: matched.map((m) => ({ id: m.r.id, action: m.r.getString("action"), by: m.by, version: m.r.getInt("version"),
      description: m.r.getString("description"), reason: m.r.getString("reason"), supplier: m.r.getString("supplier") })),
  };
}

function createChecklist(app, receipt) {
  const existing = app.findRecordsByFilter("checklist_items", "receipt = {:r}", "", 1, 0, { r: receipt.id });
  if (existing.length) return;
  const tpls = app.findRecordsByFilter("checklist_templates", "active = true", "sort", 0, 0);
  const col = app.findCollectionByNameOrId("checklist_items");
  tpls.forEach((t) => {
    const it = new Record(col);
    it.set("receipt", receipt.id); it.set("template", t.id); it.set("title", t.getString("title"));
    it.set("sort", t.getInt("sort")); it.set("required", t.getBool("required")); it.set("done", false);
    app.save(it);
  });
}

// ---------- Ресурсы и бронирования ----------
const ACTIVE_RES = ["reserved", "in_work"];
function effEnd(res, now) {
  const e = parse(res.getString("end"));
  if (res.getString("status") === "in_work" && e < now) return now; // выдано и не возвращено — ресурс всё ещё занят
  return e;
}
function activeReservations(app, resourceId, excludeId) {
  return app.findRecordsByFilter("reservations", "resource = {:r} && (status = 'reserved' || status = 'in_work')", "start", 0, 0, { r: resourceId })
    .filter((x) => x.id !== excludeId);
}
function conflictCheck(app, resource, s, e, excludeId) {
  const now = new Date();
  const list = activeReservations(app, resource.id, excludeId);
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    const xs = parse(x.getString("start")), xe = effEnd(x, now);
    if (xs < e && xe > s) {
      let who = "";
      try { who = app.findRecordById("users", x.getString("created_by")).getString("name"); } catch (_) {}
      throw new ApiError(409, "Ресурс уже забронирован на это время: " + x.getString("purpose") + " (" + (x.getString("responsible") || who) + ").", { reservation: x.id });
    }
  }
}

module.exports = {
  WRITE_ROLES, ROLE_RU, todayLocal, fmt, parse, str, normUpd, normOrg, role, isSuper, userName,
  requireRole, authId, log, evaluate, createChecklist, conflictCheck, activeReservations, effEnd,
};
