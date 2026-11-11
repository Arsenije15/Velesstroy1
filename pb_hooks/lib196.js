// VELESSTROY 1.9.6 — общие функции
// Нормализация названия для сравнения: регистр, ё, «x»/«х», пробелы вокруг запятых
function normName(s) {
  return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/x/g, "х").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
}
function toksN(s) { return (normName(s).replace(/(\d),(\d)/g, "$1.$2").match(/[a-zа-я0-9.]+/g) || []).map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length >= 1); }
function simN(a, b) {
  const A = toksN(a), B = toksN(b); if (!A.length || !B.length) return 0;
  const SB = {}; B.forEach((w) => { SB[w] = (SB[w] || 0) + 1; });
  let hit = 0; A.forEach((w) => { if (SB[w]) { hit++; SB[w]--; } });
  return (2 * hit) / (A.length + B.length);
}
// Позиции УПД ↔ строки спецификации. Порядок обычно тот же; одинаковые наименования (разные шифры объекта)
// разводим по количеству и по ближайшей позиции. used — строки, уже занятые другим УПД этого же запроса.
function matchSpec(items, spec, used) {
  let matched = 0, renamed = 0; const missing = [];
  const byName = {}; spec.forEach((s) => { const k = normName(s.name); (byName[k] = byName[k] || []).push(s); });
  let last = -1;
  items.forEach((it, k) => {
    const nk = normName(it.name), q = +it.qty || 0;
    let c = (byName[nk] || []).filter((s) => !used[s.i]);
    let pick = null;
    const near = (L) => L.slice().sort((x, y) => Math.abs(x.i - (last + 1)) - Math.abs(y.i - (last + 1)))[0];
    if (c.length) pick = near(c.filter((s) => Math.abs((s.qty || 0) - q) < 1e-6)) || near(c);
    if (!pick) {   // название прочитано со сканом с ошибкой — похожее (≥ 85 %) с тем же количеством
      let best = null;
      spec.forEach((s) => { if (used[s.i]) return; const v = simN(it.name, s.name) + (Math.abs((s.qty || 0) - q) < 1e-6 ? 0.05 : 0) - Math.min(0.05, Math.abs(s.i - (last + 1)) / 2000);
        if (!best || v > best.v) best = { s: s, v: v }; });
      if (best && best.v >= 0.85) pick = best.s;
    }
    if (!pick) { missing.push(k + 1); return; }
    used[pick.i] = 1; last = pick.i; matched++;
    if (normName(pick.name) !== nk) renamed++;
    it.spec_name = pick.name; it.spec_no = pick.no; if (pick.objcode) it.objcode = pick.objcode;
  });
  return { matched: matched, renamed: renamed, missing: missing };
}
// ---------- «Задачи и согласования»: группы, права, новые участники ----------
const GROUPS = { ruk: "Руководители", sklad: "Склад", ogi: "ОГИ", omts: "ОМТС", skk: "СКК", podr: "Подрядчики" };
function groupOf(u) {
  const g = u.getString("tgroup"); if (GROUPS[g]) return g;
  const r = u.getString("role");
  return r === "admin" || r === "manager" ? "ruk" : r === "storekeeper" ? "sklad" : r === "skk" || r === "skk_view" ? "skk" : r === "coord" ? "podr" : "";
}
// 1.9.6: менять тему, подтемы, участников и раздавать ссылки может любой участник темы (и руководитель)
function canEdit(L, Q, a, t) { return Q.isBoss(L, a) || Q.isMember(t, a); }
function needEdit(L, Q, a, t) { if (!canEdit(L, Q, a, t)) throw new ForbiddenError("Вы не участник этой темы."); if (t.getString("status") === "closed" && !Q.isBoss(L, a)) throw new BadRequestError("Тема в архиве."); }
function directory(app) {
  return app.findRecordsByFilter("users", "active = true", "name", 0, 0).map((u) => ({ id: u.id, name: u.getString("name") || u.getString("username"), group: groupOf(u), role: u.getString("role"), company: u.getString("warehouse") }));
}
function topicSave(L, Q, tx, a, b) {
  const t = b.id ? tx.findRecordById("topics", L.str(b.id)) : new Record(tx.findCollectionByNameOrId("topics"));
  if (b.id) needEdit(L, Q, a, t);
  const title = L.str(b.title).trim(); if (!title) throw new BadRequestError("Напишите название темы.");
  const mem = (Array.isArray(b.members) ? b.members : []).map(String).filter((v, i, A) => A.indexOf(v) === i).slice(0, 200);
  mem.forEach((id) => tx.findRecordById("users", id));
  const old = b.id ? t.getStringSlice("members") : [];
  if (b.id) tx.findRecordsByFilter("subtopics", "topic = {:t}", "", 0, 0, { t: t.id }).forEach((s) => s.getStringSlice("members").forEach((m) => { if (mem.indexOf(m) < 0) mem.push(m); }));
  if (L.authId(a) && mem.indexOf(a.id) < 0) mem.push(a.id);
  t.set("title", title.slice(0, 300)); t.set("description", L.str(b.description).slice(0, 3000)); t.set("members", mem);
  if (!b.id) { t.set("status", "open"); if (L.authId(a)) t.set("created_by", a.id); }
  tx.save(t);
  Q.topicLog(L, tx, a, t.id, (b.id ? "Тема изменена: «" : "Новая тема: «") + title + "», участников " + mem.length + (b.id && mem.length !== old.length ? " (было " + old.length + ")" : ""));
  return { id: t.id };
}
function subSave(L, Q, tx, a, b) {
  const s = b.id ? tx.findRecordById("subtopics", L.str(b.id)) : new Record(tx.findCollectionByNameOrId("subtopics"));
  const t = tx.findRecordById("topics", b.id ? s.getString("topic") : L.str(b.topic));
  if (t.getString("status") === "closed") throw new BadRequestError("Тема в архиве — сначала откройте её снова.");
  needEdit(L, Q, a, t);
  if (b.topic && b.id && L.str(b.topic) !== t.id) throw new BadRequestError("Подтема из другой темы.");
  const title = L.str(b.title).trim(); if (!title) throw new BadRequestError("Напишите название подтемы.");
  const mem = (Array.isArray(b.members) ? b.members : []).map(String).filter((v, i, A) => A.indexOf(v) === i).slice(0, 200); mem.forEach((id) => tx.findRecordById("users", id));
  if (!mem.length) throw new BadRequestError("Выберите участников подтемы.");
  if (L.authId(a) && !Q.isBoss(L, a) && mem.indexOf(a.id) < 0) mem.push(a.id);   // кто открыл подтему — в ней
  const old = b.id ? Q.stagesOf(s) : [];
  const stages = (Array.isArray(b.stages) ? b.stages : []).slice(0, 100).map((x) => {
    const o = old.find((y) => y.uid && y.uid === x.uid) || {};
    return { uid: L.str(x.uid) || $security.randomString(8), name: L.str(x.name).trim().slice(0, 300), deadline: L.str(x.deadline).slice(0, 10), done: !!o.done, done_at: o.done_at || "", done_by: o.done_by || "" };
  }).filter((x) => x.name);
  s.set("topic", t.id); s.set("title", title.slice(0, 300)); s.set("description", L.str(b.description).slice(0, 3000)); s.set("members", mem); s.set("stages", stages);
  if (!b.id) { s.set("status", "open"); s.set("sort", Date.now() / 1000); if (L.authId(a)) s.set("created_by", a.id); }
  tx.save(s);
  const tm = t.getStringSlice("members"); mem.forEach((m) => { if (tm.indexOf(m) < 0) tm.push(m); }); t.set("members", tm); tx.save(t);
  const msg = new Record(tx.findCollectionByNameOrId("topic_msgs"));
  msg.set("topic", t.id); msg.set("subtopic", s.id); msg.set("user", L.authId(a) ? a.id : ""); msg.set("user_name", L.userName(a)); msg.set("kind", "sys");
  msg.set("text", b.id ? "изменил(а) подтему: этапов " + stages.length + ", участников " + mem.length : "открыл(а) подтему: этапов " + stages.length + ", участников " + mem.length); tx.save(msg);
  Q.topicLog(L, tx, a, t.id, "«" + t.getString("title") + "» → подтема «" + title + "»" + (b.id ? " изменена" : " открыта"));
  return { id: s.id };
}
const ALPH = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function linkFor(L, Q, tx, a, t, uid) {
  if (t.getStringSlice("members").indexOf(uid) < 0) throw new BadRequestError("Человек не участвует в этой теме.");
  const u = tx.findRecordById("users", uid);
  let rec = null;
  try { rec = tx.findFirstRecordByFilter("topic_links", "topic = {:t} && user = {:u} && revoked = false", { t: t.id, u: uid }); } catch (_) {}
  if (!rec) {
    rec = new Record(tx.findCollectionByNameOrId("topic_links"));
    rec.set("token", $security.randomStringWithAlphabet(32, ALPH));
    rec.set("topic", t.id); rec.set("user", uid); rec.set("revoked", false); rec.set("views", 0);
    if (L.authId(a)) rec.set("created_by", a.id);
    tx.save(rec);
    Q.topicLog(L, tx, a, t.id, "«" + t.getString("title") + "»: личная ссылка для " + (u.getString("name") || u.getString("username")));
  }
  return { id: rec.id, user: uid, name: u.getString("name") || u.getString("username"), token: rec.getString("token") };
}
function translit(s) {
  const m = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya", ь: "", ъ: "",
    ђ: "dj", ћ: "c", џ: "dz", љ: "lj", њ: "nj", ј: "j", č: "c", ć: "c", š: "s", ž: "z", đ: "dj" };
  return String(s || "").toLowerCase().split("").map((c) => (m[c] !== undefined ? m[c] : c)).join("").replace(/[^a-z0-9]+/g, "");
}
// Новый участник прямо из темы: учётная запись «Участник согласований», вход по личной ссылке (пароль не нужен)
function newUser(L, Q, tx, a, t, b) {
  needEdit(L, Q, a, t);
  const name = L.str(b.name).replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 3) throw new BadRequestError("Напишите ФИО нового участника.");
  const g = GROUPS[L.str(b.group)] ? L.str(b.group) : "podr";
  const base = (translit(name.split(" ")[0]) || "user").slice(0, 16);
  let un = base + "_" + $security.randomStringWithAlphabet(4, "23456789abcdefghjkmnpqrstuvwxyz");
  const u = new Record(tx.findCollectionByNameOrId("users"));
  u.set("username", un); u.set("email", un + "@velesstroy.local"); u.set("name", name); u.set("role", "coord"); u.set("active", true);
  u.set("tgroup", g); u.set("warehouse", L.str(b.company).slice(0, 100)); u.set("phone", L.str(b.phone).slice(0, 40));
  u.setPassword($security.randomStringWithAlphabet(20, ALPH)); u.set("verified", true);
  tx.save(u);
  const tm = t.getStringSlice("members"); tm.push(u.id); t.set("members", tm); tx.save(t);
  L.log(tx, a, "user_create", "users", u.id, "Новый участник «" + name + "» (" + GROUPS[g] + ") добавлен в тему «" + t.getString("title") + "»", {});
  const ln = linkFor(L, Q, tx, a, t, u.id);
  return { id: u.id, name: name, group: g, token: ln.token, link: ln.id };
}
// ---------- Общая доска склада ----------
function siteLink(token) {
  if (!/^[A-Za-z0-9]{16,64}$/.test(token || "")) throw new NotFoundError("Ссылка не найдена.");
  let r = null; try { r = $app.findFirstRecordByFilter("site_links", "token = {:t}", { t: token }); } catch (_) { throw new NotFoundError("Ссылка не найдена."); }
  if (!r.getBool("active")) throw new ApiError(410, "Ссылка отключена — попросите новую.", {});
  return r;
}
const DT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
function boardOut(r) {
  let h = []; try { h = JSON.parse(r.getString("history") || "[]") || []; } catch (_) {}
  return { id: r.id, kind: r.getString("kind"), title: r.getString("title"), who: r.getString("who"), place: r.getString("place"), start: r.getString("start"), end: r.getString("end"),
    status: r.getString("status"), note: r.getString("note"), author: r.getString("author"), edited_by: r.getString("edited_by"), updated: r.getString("updated"),
    photos: r.getStringSlice("photos"), history: h.slice(-15) };
}
function boardSave(L, tx, b, files) {
  const nm = L.str(b.name).replace(/\s+/g, " ").trim().slice(0, 120);
  if (nm.length < 2) throw new BadRequestError("Напишите своё имя — оно будет видно у записи.");
  const r = b.id ? tx.findRecordById("site_board", L.str(b.id)) : new Record(tx.findCollectionByNameOrId("site_board"));
  let h = []; try { h = JSON.parse(r.getString("history") || "[]") || []; } catch (_) {}
  const now = L.fmt(new Date());
  if (b.action === "done") {   // «Закончил»: время окончания — сейчас
    r.set("status", "done"); r.set("end", DT.test(L.str(b.end)) ? L.str(b.end) : now.slice(0, 16).replace(" ", "T"));   // время телефона (местное)
    h.push({ at: now, by: nm, what: "закончил(а)" });
  } else if (b.action === "photo") {
    h.push({ at: now, by: nm, what: "фото: " + files.length });
  } else {
    const title = L.str(b.title).trim().slice(0, 200); if (!title) throw new BadRequestError("Что за техника / какие люди?");
    const st = L.str(b.start), en = L.str(b.end);
    if (st && !DT.test(st)) throw new BadRequestError("Неверное время начала."); if (en && !DT.test(en)) throw new BadRequestError("Неверное время окончания.");
    if (st && en && en < st) throw new BadRequestError("Окончание раньше начала.");
    const kind = ["tech", "people", "other"].indexOf(L.str(b.kind)) >= 0 ? L.str(b.kind) : "tech";
    const status = ["plan", "work", "done", "cancel"].indexOf(L.str(b.status)) >= 0 ? L.str(b.status) : "plan";
    const ch = [];
    [["title", title], ["who", L.str(b.who).slice(0, 200)], ["place", L.str(b.place).slice(0, 300)], ["start", st], ["end", en], ["status", status], ["kind", kind], ["note", L.str(b.note).slice(0, 2000)]].forEach(([k, v]) => {
      if (r.getString(k) !== v) { if (b.id) ch.push(k); r.set(k, v); }
    });
    if (!b.id) { r.set("author", nm); h.push({ at: now, by: nm, what: "добавил(а)" }); } else if (ch.length) h.push({ at: now, by: nm, what: "изменил(а): " + ch.join(", ") });
  }
  if (files && files.length) r.set("photos+", files.slice(0, 12));
  r.set("edited_by", nm); r.set("history", h.slice(-60));
  tx.save(r);
  // пересечения по той же технике/людям — предупреждаем, но не запрещаем (свободная форма)
  let clash = [];
  const st = r.getString("start"), en = r.getString("end");
  if (st && r.getString("status") !== "done" && r.getString("status") !== "cancel") {
    clash = tx.findRecordsByFilter("site_board", "id != {:id} && title = {:t} && status != 'done' && status != 'cancel' && start != ''", "start", 50, 0, { id: r.id, t: r.getString("title") })
      .filter((o) => (!en || o.getString("start") < en) && (!o.getString("end") || o.getString("end") > st))
      .map((o) => ({ who: o.getString("who"), start: o.getString("start"), end: o.getString("end"), place: o.getString("place") }));
  }
  return { id: r.id, clash: clash };
}
module.exports = { siteLink, boardOut, boardSave, normName, simN, matchSpec, GROUPS, groupOf, canEdit, needEdit, directory, topicSave, subSave, linkFor, newUser };
