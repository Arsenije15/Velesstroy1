/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.20 — фото и видео к позиции заявки; отчёт с фото для стропальщиков: ссылка без входа (печать / телефон)

// фото / видео позиции: позиция должна быть из этой заявки
onRecordCreateRequest((e) => {
  const it = e.record.getString("item");
  if (it) {
    const i = $app.findRecordById("request_items", it);
    if (i.getString("request") !== e.record.getString("request")) throw new BadRequestError("Позиция не из этой заявки.");
    e.record.set("kind", "item");
    e.record.set("shipment", "");
  }
  e.next();
}, "request_files");

// ---------- Создать ссылку-отчёт (на 30 дней) ----------
routerAdd("POST", "/api/vs/req/share", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES.concat(["viewer"]));
  const b = e.requestInfo().body || {};
  const ids = (Array.isArray(b.requests) ? b.requests : []).map((x) => L.str(x)).filter(Boolean).slice(0, 200);
  if (!ids.length) throw new BadRequestError("Выберите заявки.");
  ids.forEach((id) => $app.findRecordById("requests", id));
  const col = $app.findCollectionByNameOrId("req_shares");
  const r = new Record(col);
  const tok = $security.randomString(24);
  r.set("token", tok); r.set("requests", ids); r.set("title", L.str(b.title).slice(0, 300));
  r.set("expires", new Date(Date.now() + 30 * 86400000).toISOString().replace("T", " "));
  if (L.authId(a)) r.set("created_by", a.id);
  $app.save(r);
  L.log($app, a, "req_share", "requests", ids[0], "Ссылка-отчёт с фото для стропальщиков: заявок " + ids.length);
  return e.json(200, { token: tok, url: "/r.html?t=" + tok, expires: r.getString("expires") });
}, $apis.requireAuth("users"));

// ---------- Отчёт по ссылке (без входа) ----------
routerAdd("GET", "/api/vs/pub/req/{token}", (e) => {
  const { shareGet } = require(`${__hooks}/lib1920.js`);
  const s = shareGet(e.request.pathValue("token"));
  try { s.set("views", s.getInt("views") + 1); $app.saveNoValidate(s); } catch (_) {}
  const num = (v) => { const n = parseFloat(String(v || "").replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const out = [];
  (s.get("requests") || []).forEach((rid) => {
    let r; try { r = $app.findRecordById("requests", rid); } catch (_) { return; }
    const files = $app.findRecordsByFilter("request_files", "request = {:r} && item != ''", "created", 0, 0, { r: rid });
    const its = $app.findRecordsByFilter("request_items", "request = {:r}", "sort", 0, 0, { r: rid }).map((i, k) => ({
      n: k + 1, id: i.id, material: i.getString("material"), unit: i.getString("unit"), ordered: i.getString("qty_ordered"), issued: i.getString("qty_issued"),
      rest: Math.max(0, num(i.getString("qty_ordered")) - num(i.getString("qty_issued"))), status: i.getString("status"),
      pick_place: i.getString("pick_place"), pick_tool: i.getString("pick_tool"), rd: i.getString("rd"),
      media: files.filter((f) => f.getString("item") === i.id).map((f) => ({ id: f.id, name: f.getString("file"), video: /\.(mp4|mov|webm|3gp|mkv|avi)$/i.test(f.getString("file")), comment: f.getString("comment") })),
    }));
    out.push({ id: r.id, number: r.getString("number"), object: r.getString("object"), recipient: r.getString("recipient"), status: r.getString("status"),
      date: r.getString("req_date") || r.getString("created"), note: r.getString("note"), items: its });
  });
  return e.json(200, { title: s.getString("title"), created: s.getString("created"), expires: s.getString("expires"), requests: out });
});

routerAdd("GET", "/api/vs/pub/req/{token}/f/{fid}", (e) => {
  const { shareGet } = require(`${__hooks}/lib1920.js`);
  const s = shareGet(e.request.pathValue("token"));
  const f = $app.findRecordById("request_files", e.request.pathValue("fid"));
  if ((s.get("requests") || []).indexOf(f.getString("request")) < 0 || !f.getString("item")) throw new NotFoundError("Файл не найден.");
  const dir = $app.dataDir() + "/storage/" + f.collection().id + "/" + f.id;
  e.response.header().set("Cache-Control", "private, max-age=86400");
  return e.fileFS($os.dirFS(dir), f.getString("file"));
});
