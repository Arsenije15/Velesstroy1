/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.66 — выдача по снимку / тексту: «Заявка 7112: Геотекстиль500-1800м2 …» → предложение (заявка, позиция, сколько);
// выдаёт пользователь после проверки (обычная выдача /api/vs/request/issue), снимок прикладывается к заявкам как фото погрузки.
routerAdd("POST", "/api/vs/issue/parse", (e) => {
  const L = require(`${__hooks}/lib.js`); const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {}; const X = require(`${__hooks}/lib1966.js`); const t0 = Date.now();
  let texts = [], src = "text", info = {};
  if (b.upload) {
    const rec = $app.findRecordById("request_ocr", L.str(b.upload));
    if (!L.isSuper(a) && rec.getString("uploaded_by") !== a.id) throw new ForbiddenError("Это не ваш файл.");
    const j = X.ocr($app, $app.dataDir() + "/storage/" + rec.collection().id + "/" + rec.id + "/" + rec.getString("file"));
    texts = j.texts || []; src = j.src; info = { yandex: j.yandex || "", cropped: !!j.cropped };
  } else texts = [L.str(b.text).slice(0, 20000)];
  const p = X.proposal($app, texts, src);
  if (!p.rows) throw new BadRequestError(src === "text" ? "Не нашёл строк вида «Заявка 7112: материал - 1800 м2»." : "На снимке не нашёл строк вида «Заявка 7112: материал - количество». Текст должен быть на снимке целиком.");
  p.ms = Date.now() - t0; p.info = info;
  try { L.log($app, a, "issue_parse", "requests", "", "📷 Выдача " + (src === "text" ? "по тексту" : "по снимку (" + src + ")") + ": заявки " + p.groups.map((g) => g.no).join(", ") + ", строк " + p.rows, {}); } catch (_) {}
  return e.json(200, p);
}, $apis.requireAuth("users"));
