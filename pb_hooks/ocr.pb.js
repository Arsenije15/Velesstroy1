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
  let txt = "";
  try { txt = toString($os.cmd("timeout", "240", "python3", `${__hooks}/ocr_zayavka.py`, path).output()); }
  catch (err) { throw new BadRequestError("Распознавание не запустилось на сервере (запустите install.sh ещё раз): " + String(err).slice(0, 200)); }
  let res = null;
  try { res = JSON.parse(txt); } catch (_) { throw new BadRequestError("Не удалось прочитать файл — попробуйте другой скан или фото ровнее."); }
  if (res.error) throw new BadRequestError(res.error);
  delete res.debug;
  if (!res.items || !res.items.length) throw new BadRequestError("В файле не найдена таблица заявки. Сфотографируйте лист целиком, ровно и при хорошем свете.");
  // известные поставщики — для исправления опечаток распознавания на телефоне
  const known = [];
  try {
    const rows = arrayOf(new DynamicModel({ supplier: "" }));
    $app.db().newQuery("SELECT DISTINCT supplier FROM acts WHERE supplier != '' LIMIT 600").all(rows);
    rows.forEach((r) => known.push(r.supplier));
  } catch (_) {}
  try {
    $app.findRecordsByFilter("suggestions", "field = 'supplier'", "-last", 300, 0).forEach((r) => known.push(r.getString("value")));
  } catch (_) {}
  res.known_suppliers = known;
  rec.set("result", res); $app.save(rec);
  L.log($app, a, "request_ocr", "requests", "", "Заявка прочитана со скана: № " + ((res.header && res.header.number) || "?") + ", позиций " + res.items.length +
    " (" + Math.round((res.ms || 0) / 1000) + " с)", { upload: rec.id });
  return e.json(200, res);
}, $apis.requireAuth("users"));

// Сканы старше 30 дней удаляются (место на диске)
cronAdd("vs_ocr_cleanup", "30 2 * * *", () => {
  const d = new Date(Date.now() - 30 * 86400000).toISOString().replace("T", " ");
  try { $app.findRecordsByFilter("request_ocr", "created < {:d}", "", 500, 0, { d: d }).forEach((r) => $app.delete(r)); } catch (err) { console.log("ocr cleanup: " + err); }
});
