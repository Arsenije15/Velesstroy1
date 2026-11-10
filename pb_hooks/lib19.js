// VELESSTROY 1.9 — общие функции: оперативка, поставщики, «Задачи и согласования».
const OPER_ROLES = ["admin", "manager", "storekeeper", "skk"];
const BOSS_ROLES = ["admin", "manager"];
const STOP = { "для": 1, "по": 1, "от": 1, "или": 1, "без": 1, "гост": 1, "ту": 1, "мм": 1, "шт": 1, "тип": 1, "марка": 1 };
// 1.9.4: «57x3,5» (латинская x) и «57х3,5» — одно и то же; «3,5» — одно число
function toks(s) { return (String(s || "").toLowerCase().replace(/ё/g, "е").replace(/(\d)\s*[xх×*]\s*(?=\d)/g, "$1х").replace(/(\d),(\d)/g, "$1.$2").match(/[a-zа-я0-9.]+/g) || []).map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length >= 2 && !STOP[w]); }
function tokset(s) { const B = toks(s), SB = { n: B.length, w: {} }; B.forEach((w) => { SB.w[w] = 1; SB.w[w.slice(0, 5)] = 1; }); return SB; }
function simT(A, SB) {
  if (!A.length || !SB.n) return 0;
  let hit = 0; A.forEach((w) => { if (SB.w[w] || (w.length > 5 && SB.w[w.slice(0, 5)])) hit++; });
  return hit / Math.max(A.length, Math.min(SB.n, 8));
}
// похожесть названий: доля общих слов (с учётом цифр — диаметры, марки)
function sim(a, b) { return simT(toks(a), tokset(b)); }
function isBoss(L, a) { return L.isSuper(a) || BOSS_ROLES.indexOf(L.role(a)) >= 0; }
function isMember(rec, a) { return rec.getStringSlice("members").indexOf(a.id) >= 0; }
function upsertSupplier(X, tx, name, source, inn) {
  name = String(name || "").replace(/\s+/g, " ").trim(); if (!name || name.length < 2) return null;
  const key = X.supplierKey(name); if (!key) return null;
  let r = null; try { r = tx.findFirstRecordByFilter("suppliers", "key = {:k}", { k: key }); } catch (_) {}
  if (!r) { r = new Record(tx.findCollectionByNameOrId("suppliers")); r.set("name", name.slice(0, 300)); r.set("key", key); r.set("source", String(source || "").slice(0, 200)); r.set("active", true); if (inn) r.set("inn", inn); tx.save(r); return r; }
  if (inn && !r.getString("inn")) { r.set("inn", inn); tx.save(r); }
  return r;
}
function stagesOf(rec) { try { const v = JSON.parse(rec.getString("stages") || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function topicLog(L, tx, a, id, txt) { L.log(tx, a, "topic", "topics", id, txt, {}); }
function subAccess(L, a, s, t) {
  if (isBoss(L, a)) return;
  if (!isMember(s, a)) throw new ForbiddenError("Вы не участник этой подтемы.");
  if (t.getString("status") === "closed") throw new BadRequestError("Тема в архиве.");
}
// 1.9.4: отметка этапа и сообщение — общие для программы и личной ссылки участника (a — пользователь)
function subStage(L, tx, a, subId, uid, done) {
  const s = tx.findRecordById("subtopics", String(subId || "")), t = tx.findRecordById("topics", s.getString("topic"));
  subAccess(L, a, s, t);
  if (s.getString("status") === "closed" && !isBoss(L, a)) throw new BadRequestError("Подтема закрыта.");
  const st = stagesOf(s), x = st.find((y) => y.uid === String(uid || "")); if (!x) throw new BadRequestError("Этап не найден.");
  x.done = !!done; x.done_at = x.done ? L.fmt(new Date()) : ""; x.done_by = x.done ? L.userName(a) : "";
  s.set("stages", st); tx.save(s);
  const msg = new Record(tx.findCollectionByNameOrId("topic_msgs"));
  msg.set("topic", t.id); msg.set("subtopic", s.id); msg.set("user", L.authId(a)); msg.set("user_name", L.userName(a)); msg.set("kind", "stage");
  msg.set("text", (x.done ? "✔ отметил(а) этап «" : "↺ снял(а) отметку с этапа «") + x.name + "»"); tx.save(msg);
  topicLog(L, tx, a, t.id, "«" + t.getString("title") + "» / «" + s.getString("title") + "»: этап «" + x.name + "» " + (x.done ? "выполнен" : "снова не выполнен"));
  return { done: st.filter((y) => y.done).length, total: st.length };
}
function subMsg(L, tx, a, subId, text) {
  text = String(text || "").trim(); if (!text) throw new BadRequestError("Пустое сообщение.");
  const s = tx.findRecordById("subtopics", String(subId || "")), t = tx.findRecordById("topics", s.getString("topic"));
  subAccess(L, a, s, t);
  const msg = new Record(tx.findCollectionByNameOrId("topic_msgs"));
  msg.set("topic", t.id); msg.set("subtopic", s.id); msg.set("user", L.authId(a)); msg.set("user_name", L.userName(a)); msg.set("kind", "msg"); msg.set("text", text.slice(0, 3000)); tx.save(msg);
  t.set("status", t.getString("status")); tx.save(t);   // «обновлено» у темы — для списка
}
module.exports = { subStage, subMsg, topicLog, subAccess, OPER_ROLES, BOSS_ROLES, toks, tokset, simT, sim, isBoss, isMember, upsertSupplier, stagesOf };
