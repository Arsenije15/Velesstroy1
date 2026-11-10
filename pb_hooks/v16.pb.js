/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.6 — ссылка для получателей материала (только одна отгрузка, вживую, со сроком), архив из нескольких Excel.

// ---------- Создать / погасить ссылку ----------
routerAdd("POST", "/api/vs/share/create", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const hours = parseFloat(String(b.hours === undefined ? "24" : b.hours).replace(",", "."));
  if (!(hours > 0) || hours > 24 * 14) throw new BadRequestError("Срок ссылки — от 1 часа до 14 дней.");
  let out = null;
  $app.runInTransaction((tx) => {
    const s = tx.findRecordById("request_shipments", L.str(b.shipment));
    if (s.getString("status") === "cancelled") throw new BadRequestError("Отгрузка отменена.");
    const r = tx.findRecordById("requests", s.getString("request"));
    const rec = new Record(tx.findCollectionByNameOrId("share_links"));
    const token = $security.randomStringWithAlphabet(28, "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    const exp = new Date(Date.now() + hours * 3600000);
    rec.set("token", token); rec.set("shipment", s.id); rec.set("expires_at", L.fmt(exp)); rec.set("revoked", false);
    rec.set("note", L.str(b.note).slice(0, 300)); rec.set("views", 0);
    if (L.authId(a)) rec.set("created_by", a.id);
    tx.save(rec);
    L.log(tx, a, "share_create", "requests", r.id, "Ссылка для получателя: отгрузка " + s.getString("vehicle") + " (заявка № " + r.getString("number") + "), действует до " + L.fmt(exp).slice(0, 16) +
      (L.str(b.note) ? " — " + L.str(b.note) : ""), { link: rec.id });
    out = { id: rec.id, token: token, expires_at: L.fmt(exp) };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/vs/share/revoke", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  $app.runInTransaction((tx) => {
    const rec = tx.findRecordById("share_links", L.str(b.link));
    rec.set("revoked", true); tx.save(rec);
    const s = tx.findRecordById("request_shipments", rec.getString("shipment"));
    L.log(tx, a, "share_revoke", "requests", s.getString("request"), "Ссылка для получателя погашена: отгрузка " + s.getString("vehicle"), { link: rec.id });
  });
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));

// ---------- Публично (без входа): данные одной отгрузки по ссылке ----------
routerAdd("GET", "/api/vs/pub/ship/{token}", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const link = require(`${__hooks}/lib16.js`).shareLink(e.request.pathValue("token"));
  const s = $app.findRecordById("request_shipments", link.getString("shipment"));
  const reqs = X.shipRequests(s).map((id) => { try { return $app.findRecordById("requests", id); } catch (_) { return null; } }).filter(Boolean);
  const nm = (id) => { if (!id) return ""; try { const u = $app.findRecordById("users", id); return u.getString("name") || u.getString("username"); } catch (_) { return ""; } };
  const res = X.jsonArr(s, "resource_ids").map((id) => { try { const r = $app.findRecordById("resources", id); return { name: r.getString("name"), category: r.getString("category") }; } catch (_) { return null; } }).filter(Boolean);
  const photos = $app.findRecordsByFilter("request_files", "shipment = {:s}", "created", 50, 0, { s: s.id })
    .filter((f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f.getString("file"))).map((f) => ({ id: f.id, at: f.getString("created") }));
  link.set("views", link.getInt("views") + 1); link.set("last_view", L.fmt(new Date()));
  try { $app.saveNoValidate(link); } catch (_) {}
  e.response.header().set("Cache-Control", "no-store");
  return e.json(200, {
    requests: reqs.map((r) => ({ number: r.getString("number"), object: r.getString("object"), recipient: r.getString("recipient") })),
    vehicle: s.getString("vehicle"), driver: s.getString("driver"), status: s.getString("status"), hours: s.getFloat("hours"),
    created: s.getString("created"), sent_at: s.getString("sent_at"), delivered_at: s.getString("delivered_at"),
    prepared_by: nm(s.getString("created_by")), sent_by: nm(s.getString("sent_by")),
    lines: X.jsonArr(s, "lines").map((l) => ({ number: l.number, material: l.material, qty: l.qty, unit: l.unit })),
    steps: X.jsonArr(s, "steps").map((x) => ({ name: x.name, at: x.at })),
    resources: res, photos: photos, note: s.getString("note"),
    link: { expires_at: link.getString("expires_at"), note: link.getString("note") },
    now: L.fmt(new Date()),
  });
});
routerAdd("GET", "/api/vs/pub/ship/{token}/photo/{id}", (e) => {
  const link = require(`${__hooks}/lib16.js`).shareLink(e.request.pathValue("token"));
  const f = $app.findRecordById("request_files", e.request.pathValue("id"));
  if (f.getString("shipment") !== link.getString("shipment")) throw new NotFoundError("Фото не найдено.");
  const key = f.baseFilesPath() + "/" + f.getString("file");
  const fsys = $app.newFilesystem();
  try { e.response.header().set("Cache-Control", "private, max-age=600"); return fsys.serve(e.response, e.request, key, f.getString("file")); }
  finally { fsys.close(); }
});

// ---------- Архив: какие листы загружены; удалить лист ----------
routerAdd("GET", "/api/vs/archive/sheets", (e) => {
  const L = require(`${__hooks}/lib.js`);
  L.requireRole(e, ["admin", "manager", "storekeeper", "viewer"]);
  const rows = arrayOf(new DynamicModel({ sheet: "", source: "", n: 0, last: "" }));
  $app.db().newQuery("SELECT sheet, MAX(source) AS source, COUNT(*) AS n, MAX(updated) AS last FROM request_archive GROUP BY sheet ORDER BY sheet").all(rows);
  return e.json(200, { sheets: rows.map((r) => ({ sheet: r.sheet, source: r.source, n: r.n, last: r.last })) });
}, $apis.requireAuth("users"));
routerAdd("POST", "/api/vs/archive/delete_sheet", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  const sheet = L.str((e.requestInfo().body || {}).sheet);
  let n = 0;
  $app.runInTransaction((tx) => {
    const rows = tx.findRecordsByFilter("request_archive", "sheet = {:s}", "", 0, 0, { s: sheet });
    rows.forEach((r) => tx.delete(r)); n = rows.length;
    L.log(tx, a, "archive_delete", "requests", "", "Архив: удалён лист «" + sheet + "» (" + n + " строк)", {});
  });
  return e.json(200, { removed: n });
}, $apis.requireAuth("users"));
