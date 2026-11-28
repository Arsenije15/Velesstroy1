/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.4 — «Заполнить со скана»: сервер читает таблицу заявки (PDF / фото) и возвращает позиции.
// Распознавание: pb_hooks/ocr_zayavka.py (tesseract + OpenCV, ставится install.sh). Ничего не уходит в интернет.

routerAdd("POST", "/api/vs/request/ocr", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const rec = $app.findRecordById("request_ocr", L.str(b.upload));
  if (!L.isSuper(a) && rec.getString("uploaded_by") !== a.id) throw new ForbiddenError("Это не ваш файл.");
  const path = $app.dataDir() + "/storage/" + rec.collection().id + "/" + rec.id + "/" + rec.getString("file");
  // 1.9.65: разбор общий с папкой «Заявки» (lib1965.zayOcr): текст PDF / распознавание, известные поставщики, PID → оперативка
  const res = require(`${__hooks}/lib1965.js`).zayOcr($app, path, "");
  rec.set("result", res); $app.save(rec);
  L.log($app, a, "request_ocr", "requests", "", "Заявка прочитана " + (res.items.some((x) => x.src === "text") ? "из PDF (текст)" : "со скана") + ": № " + ((res.header && res.header.number) || "?") + ", позиций " + res.items.length +
    (res.pid_hits ? ", по PID из оперативки: " + res.pid_hits : "") + " (" + Math.round((res.ms || 0) / 1000) + " с)", { upload: rec.id });
  return e.json(200, res);
}, $apis.requireAuth("users"));

// Сканы старше 30 дней удаляются (место на диске)
cronAdd("vs_ocr_cleanup", "30 2 * * *", () => {
  const d = new Date(Date.now() - 30 * 86400000).toISOString().replace("T", " ");
  try { $app.findRecordsByFilter("request_ocr", "created < {:d}", "", 500, 0, { d: d }).forEach((r) => $app.delete(r)); } catch (err) { console.log("ocr cleanup: " + err); }
});
