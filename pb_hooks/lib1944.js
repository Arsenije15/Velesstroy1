// VELESSTROY 1.9.44 — слияние заметок: по id, побеждает более поздняя правка (u); удалённые помечены del и через 60 дней забываются
function clean(x) {
  if (!x || typeof x !== "object" || !x.id) return null;
  const s = (v, n) => String(v == null ? "" : v).slice(0, n);
  return { id: s(x.id, 40), text: s(x.text, 4000), at: s(x.at, 40), done: !!x.done, done_at: s(x.done_at, 40), remind: s(x.remind, 40), fired: !!x.fired,
    edited: s(x.edited, 40), u: Number(x.u) || 0, del: !!x.del };
}
function merge(a, b) {
  const m = {};
  [a || [], b || []].forEach((L) => L.forEach((x0) => { const x = clean(x0); if (!x) return; const o = m[x.id]; if (!o || x.u > o.u || (x.u === o.u && x.del && !o.del)) m[x.id] = x; }));
  const lim = Date.now() - 60 * 864e5;
  return Object.keys(m).map((k) => m[k]).filter((x) => !(x.del && x.u && x.u < lim)).slice(0, 3000);
}
function rec(app, uid) {
  try { return app.findFirstRecordByFilter("zametki", "user = {:u}", { u: uid }); } catch (_) { return null; }
}
function get(app, uid) { const r = rec(app, uid); if (!r) return []; try { const v = JSON.parse(r.getString("items") || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function sync(app, uid, items) {
  const out = merge(get(app, uid), items);
  let r = rec(app, uid);
  if (!r) { r = new Record(app.findCollectionByNameOrId("zametki")); r.set("user", uid); }
  r.set("items", out); app.save(r);
  return out;
}
module.exports = { merge, get, sync, clean };
