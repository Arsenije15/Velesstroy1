// VELESSTROY 1.9.48 — копия базы делается САМИМ сервером (VACUUM INTO), безопасно для работающей базы.
// Внешние программы (Litestream, sqlite3, python) к рабочей базе не прикасаются: эта сборка PocketBase не ставит
// блокировки файлов, и чужое соединение может удалить служебные файлы базы (-wal/-shm) → «disk I/O error».
function stamp(d) { const p = (n) => (n < 10 ? "0" : "") + n; return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()); }
function sigOf(P) {
  const st = (f) => { try { const i = $os.stat(f); return i.size() + ":" + i.modTime().unixNano(); } catch (_) { return "-"; } };
  return st(P.data + "/data.db") + "|" + st(P.data + "/data.db-wal");
}
function snapshot(app, force) {
  const B = require(`${__hooks}/lib1946.js`); const P = B.paths(app); const E = B.readEnv(P.state + "/backup.env");
  if (!(E.S3_KEY && E.S3_SECRET && E.S3_BUCKET)) return { skipped: "noconf" };
  const sig = sigOf(P);   // размер и время (нс) файлов базы + отметка «были записи» от сервера
  let last = ""; try { last = toString($os.readFile(P.state + "/snap.sig")); } catch (_) {}
  let dirty = false; try { dirty = !!app.store().get("vs_db_dirty"); } catch (_) {}
  if (!force && !dirty && sig === last) return { skipped: "same" };
  try { app.store().set("vs_db_dirty", false); } catch (_) {}
  const dir = P.state + "/snap"; try { $os.mkdirAll(dir, 0o700); } catch (_) {}
  const name = "data-" + stamp(new Date()) + ".db";
  app.db().newQuery("VACUUM INTO {:p}").bind({ p: dir + "/" + name }).execute();
  const tabs = arrayOf(new DynamicModel({ name: "" }));
  app.db().newQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(tabs);
  const counts = {}; let rows = 0;
  tabs.forEach((t) => { const r = new DynamicModel({ n: 0 }); try { app.db().newQuery('SELECT count(*) AS n FROM "' + String(t.name).replace(/"/g, '""') + '"').one(r); } catch (_) {} counts[t.name] = r.n; rows += r.n; });
  $os.writeFile(dir + "/" + name + ".json", JSON.stringify({ name, at: new Date().toISOString(), tables: tabs.length, rows, counts }), 0o600);
  $os.writeFile(P.state + "/snap.sig", sig, 0o600);
  B.run(app, "push");
  return { name, rows, tables: tabs.length };
}
module.exports = { snapshot, sigOf };
