// VELESSTROY 1.9 — общие функции: оперативка, поставщики, «Задачи и согласования».
const OPER_ROLES = ["admin", "manager", "storekeeper", "skk"];
const BOSS_ROLES = ["admin", "manager"];
const STOP = { "для": 1, "по": 1, "от": 1, "или": 1, "без": 1, "гост": 1, "ту": 1, "мм": 1, "шт": 1, "тип": 1, "марка": 1 };
function toks(s) { return (String(s || "").toLowerCase().replace(/ё/g, "е").match(/[a-zа-я0-9]+/g) || []).filter((w) => w.length >= 2 && !STOP[w]); }
// похожесть названий: доля общих слов (с учётом цифр — диаметры, марки)
function sim(a, b) {
  const A = toks(a), B = toks(b); if (!A.length || !B.length) return 0;
  const SB = {}; B.forEach((w) => { SB[w] = 1; SB[w.slice(0, 5)] = 1; });
  let hit = 0; A.forEach((w) => { if (SB[w] || (w.length > 5 && SB[w.slice(0, 5)])) hit++; });
  return hit / Math.max(A.length, Math.min(B.length, 8));
}
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
module.exports = { topicLog, subAccess, OPER_ROLES, BOSS_ROLES, toks, sim, isBoss, isMember, upsertSupplier, stagesOf };
                                                                  
