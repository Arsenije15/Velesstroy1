// VELESSTROY 1.9.20 — общие функции ссылки-отчёта для стропальщиков (обработчики JSVM не видят функции верхнего уровня)
function shareGet(tok) {
  const L = require(`${__hooks}/lib.js`);
  if (!/^[A-Za-z0-9]{20,40}$/.test(L.str(tok))) throw new NotFoundError("Ссылка не найдена.");
  let s;
  try { s = $app.findFirstRecordByData("req_shares", "token", tok); } catch (_) { throw new NotFoundError("Ссылка не найдена или удалена."); }
  if (s.getString("expires") && new Date(s.getString("expires").replace(" ", "T")) < new Date()) throw new BadRequestError("Срок ссылки истёк (30 дней). Попросите новую.");
  return s;
}

module.exports = { shareGet };
