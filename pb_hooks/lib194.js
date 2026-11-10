// VELESSTROY 1.9.4 — личная ссылка участника темы: проверка (не отключена, человек активен и всё ещё в теме)
function topicLink(token) {
  if (!/^[A-Za-z0-9]{20,64}$/.test(token || "")) throw new NotFoundError("Ссылка не найдена.");
  let link = null;
  try { link = $app.findFirstRecordByFilter("topic_links", "token = {:t}", { t: token }); } catch (_) { throw new NotFoundError("Ссылка не найдена."); }
  if (link.getBool("revoked")) throw new ApiError(410, "Ссылка отключена.", {});
  let topic = null, user = null;
  try { topic = $app.findRecordById("topics", link.getString("topic")); user = $app.findRecordById("users", link.getString("user")); }
  catch (_) { throw new ApiError(410, "Ссылка больше не действует.", {}); }
  if (!user.getBool("active")) throw new ApiError(410, "Учётная запись участника отключена.", {});
  const boss = ["admin", "manager"].indexOf(user.getString("role")) >= 0;
  if (!boss && topic.getStringSlice("members").indexOf(user.id) < 0) throw new ApiError(410, "Вы больше не участник этой темы.", {});
  return { link: link, topic: topic, user: user };
}
function sameTopic(tx, subId, topicId) {
  let s = null; try { s = tx.findRecordById("subtopics", String(subId || "")); } catch (_) {}
  if (!s || s.getString("topic") !== topicId) throw new NotFoundError("Подтема не найдена.");
}
module.exports = { topicLink, sameTopic };
