/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.9.35 — карта склада: поиск по флажкам, кто менял, подсказки
onRecordCreateRequest((e) => { require(`${__hooks}/lib1935.js`).smapFlag(e); e.next(); const X = require(`${__hooks}/lib_ext.js`); try { X.remember($app, "map_mat", e.record.getString("material")); X.remember($app, "map_unit", e.record.getString("unit")); } catch (_) {} }, "smap_flags");
onRecordUpdateRequest((e) => { require(`${__hooks}/lib1935.js`).smapFlag(e); e.next(); const X = require(`${__hooks}/lib_ext.js`); try { X.remember($app, "map_mat", e.record.getString("material")); } catch (_) {} }, "smap_flags");
onRecordCreateRequest((e) => {
  try { $app.findFirstRecordByFilter("smap_cfg", "id != ''"); throw new BadRequestError("Карта уже создана — обновите страницу."); } catch (err) { if (String(err).indexOf("Карта уже") >= 0) throw err; }
  if (e.auth) e.record.set("updated_by", e.auth.id); e.next();
}, "smap_cfg");
onRecordUpdateRequest((e) => { if (e.auth) e.record.set("updated_by", e.auth.id); e.next(); }, "smap_cfg");
