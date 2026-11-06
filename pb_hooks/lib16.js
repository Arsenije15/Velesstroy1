// VELESSTROY 1.6 — общие функции (подключаются через require)
function shareLink(token) {
  if (!/^[A-Za-z0-9]{20,64}$/.test(token || "")) throw new NotFoundError("Ссылка не найдена.");
  let rec = null;
  try { rec = $app.findFirstRecordByFilter("share_links", "token = {:t}", { t: token }); } catch (_) { throw new NotFoundError("Ссылка не найдена."); }
  const exp = new Date(rec.getString("expires_at").replace(" ", "T"));
  if (rec.getBool("revoked") || !(exp.getTime() > Date.now())) throw new ApiError(410, "Ссылка больше не действует.", {});
  return rec;
}
module.exports = { shareLink };
