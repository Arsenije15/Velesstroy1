/// <reference path="../pb_data/types.d.ts" />
// VELESSTROY 1.5 — изменение заявки целиком, заметки, учёт (выдано фактически), архив заявок из Excel.

// ---------- Изменить заявку (шапка и позиции; пока заявка открыта). Всё пишется в журнал: было → стало ----------
routerAdd("POST", "/api/vs/request/update", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const g = X.guard(L, a, b);
  const HEAD = { number: "№ заявки", object: "Объект", recipient: "Получатель / МОЛ", note: "Примечание", planned_date: "Планируемая дата",
    from_wh: "Со склада", to_org: "Для (получатель)", contract_no: "Договор №", contract_date: "Договор от", poa_no: "Доверенность №", poa_date: "Доверенность от", tmc_kind: "Вид ТМЦ" };
  const ITEM = { material: "материал", supplier: "поставщик", unit: "ед.", rd: "РД", supply_doc: "док. поставки", project_name: "проектное наим.",
    name1c: "наим. в 1С", objcode: "код объекта", stock_note: "наличие на складе" };
  const fmtN = (v) => String(v).replace(".", ",");
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("requests", L.str(b.request));
    if (r.getString("status") !== "open") throw new BadRequestError("Заявка закрыта — чтобы изменить, руководитель открывает её повторно.");
    const ch = [];
    Object.keys(HEAD).forEach((f) => {
      if (b[f] === undefined) return;
      const nv = L.str(b[f]), ov = r.getString(f);
      if (nv === ov) return;
      if (f === "number") {
        const norm = nv.toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
        if (!norm) throw new BadRequestError("Укажите номер заявки.");
        const dup = tx.findRecordsByFilter("requests", "number_norm = {:n} && status != 'cancelled' && id != {:id}", "", 1, 0, { n: norm, id: r.id });
        if (dup.length) X.deny(g, "Заявка № " + nv + " уже есть в системе.");
        r.set("number_norm", norm);
      }
      r.set(f, nv); ch.push(HEAD[f] + ": «" + ov + "» → «" + nv + "»");
    });
    if (b.extra !== undefined) {   // 1.9.7: свои поля шапки
      const F = require(`${__hooks}/lib197.js`), oe = F.oldExtra(r), ne = F.clean(tx, "request", b.extra, oe);
      if (JSON.stringify(ne) !== JSON.stringify(oe)) { r.set("extra", ne); ch.push("Свои поля шапки изменены"); }
    }
    if (b.req_date !== undefined) {
      const d = L.parse(b.req_date), ov = r.getString("req_date").slice(0, 10), nv = d ? L.fmt(d).slice(0, 10) : "";
      if (ov !== nv) { r.set("req_date", d ? L.fmt(d) : ""); ch.push("Дата заявки: «" + ov + "» → «" + nv + "»"); }
    }
    const items = Array.isArray(b.items) ? b.items : null;
    const touched = [];
    if (items) {
      const col = tx.findCollectionByNameOrId("request_items");
      const existing = tx.findRecordsByFilter("request_items", "request = {:r}", "sort", 0, 0, { r: r.id });
      const active = tx.findRecordsByFilter("request_shipments", "(request = {:r} || requests.id ?= {:r}) && (status = 'preparing' || status = 'sent')", "", 0, 0, { r: r.id });
      const onTruck = {};
      active.forEach((s) => X.jsonArr(s, "lines").forEach((l) => { onTruck[l.item] = s.getString("vehicle"); }));
      let sort = existing.reduce((m, x) => Math.max(m, x.getInt("sort")), 0);
      items.forEach((x, i) => {
        const id = L.str(x && x.id);
        let rec = null;
        if (id) { rec = existing.filter((q) => q.id === id)[0]; if (!rec) throw new BadRequestError("Позиция не из этой заявки."); }
        const label = "Позиция " + (i + 1) + (rec ? " «" + rec.getString("material") + "»" : "");
        if (x.delete) {
          if (!rec) return;
          if (onTruck[rec.id]) throw new BadRequestError(label + " в отгрузке " + onTruck[rec.id] + " — сначала уберите её из отгрузки (отмените или доставьте).");
          if (rec.getFloat("qty_issued") > 0) X.deny(g, label + ": уже выдано " + fmtN(rec.getFloat("qty_issued")) + " " + rec.getString("unit") + " — удалить позицию с выдачей");
          touched.push({ del: rec, label: label });
          return;
        }
        const material = x.material === undefined && rec ? rec.getString("material") : L.str(x.material);
        const qty = Math.round(parseFloat(String(x.qty_ordered === undefined ? (rec ? rec.getFloat("qty_ordered") : "") : x.qty_ordered).replace(",", ".")) * 1000) / 1000;
        if (!rec && !material && !(qty > 0)) return; // пустая новая строка формы
        if (!material) throw new BadRequestError("Строка " + (i + 1) + ": укажите материал.");
        if (!(qty > 0)) throw new BadRequestError("Строка " + (i + 1) + ": укажите заказанное количество больше нуля.");
        const isNew = !rec;
        if (isNew) { rec = new Record(col); rec.set("request", r.id); sort += 10; rec.set("sort", sort); rec.set("qty_issued", 0); }
        const diff = [];
        Object.keys(ITEM).forEach((f) => {
          if (x[f] === undefined && !isNew) return;
          const nv = L.str(x[f]), ov = isNew ? "" : rec.getString(f);
          if (nv !== ov) { rec.set(f, nv); if (!isNew) diff.push(ITEM[f] + ": «" + ov + "» → «" + nv + "»"); }
        });
        if (x.extra !== undefined) {   // 1.9.7: свои поля позиции
          const F = require(`${__hooks}/lib197.js`), oe = isNew ? {} : F.oldExtra(rec), ne = F.clean(tx, "request_item", x.extra, oe);
          if (JSON.stringify(ne) !== JSON.stringify(oe)) { rec.set("extra", ne); if (!isNew) diff.push("свои поля"); }
        }
        const oq = isNew ? 0 : rec.getFloat("qty_ordered");
        if (isNew || Math.abs(oq - qty) > 1e-9) {
          if (!isNew && qty + 1e-9 < rec.getFloat("qty_issued")) X.deny(g, label + ": заказано " + fmtN(qty) + " меньше уже выданного " + fmtN(rec.getFloat("qty_issued")));
          rec.set("qty_ordered", qty);
          if (!isNew) diff.push("заказано: " + fmtN(oq) + " → " + fmtN(qty));
        }
        // акт несоответствия: если поставщик / УПД новые или изменились
        if ((isNew || x.supplier !== undefined || x.supply_doc !== undefined) && rec.getString("supplier") && rec.getString("supply_doc") &&
            (isNew || diff.some((d) => d.indexOf("поставщик") === 0 || d.indexOf("док. поставки") === 0))) {
          const found = X.findActs(tx, rec.getString("supply_doc"), rec.getString("supplier")).filter((q) => q.open && q.level === "match");
          rec.set("acts", found.map((q) => ({ act_no: q.act_no, act_date: q.act_date, material: q.material, reason: q.reason, torg: q.torg })));
          if (found.length) X.deny(g, "Позиция " + (i + 1) + " «" + rec.getString("material") + "»: по поставщику «" + rec.getString("supplier") + "» и УПД «" +
            rec.getString("supply_doc") + "» есть неустранённый акт № " + found.map((q) => q.act_no).filter((v, k, arr) => arr.indexOf(v) === k).join(", ") + " — нужна служебная записка");
        }
        if (isNew) touched.push({ add: rec, label: "Добавлена позиция «" + material + "» " + fmtN(qty) + " " + rec.getString("unit") });
        else if (diff.length) touched.push({ upd: rec, label: label + ": " + diff.join("; ") });
      });
    }
    X.check(g);
    touched.forEach((t) => {
      if (t.del) { tx.delete(t.del); ch.push("Удалена " + t.label.toLowerCase()); }
      else { tx.save(t.add || t.upd); X.rememberRecord(tx, t.add || t.upd); ch.push(t.label); }
    });
    if (!ch.length) { out = { changed: 0 }; return; }
    if (items && !tx.findRecordsByFilter("request_items", "request = {:r}", "", 1, 0, { r: r.id }).length) throw new BadRequestError("В заявке должна остаться хотя бы одна позиция.");
    tx.save(r); X.rememberRecord(tx, r);
    ["from_wh", "to_org", "contract_no", "poa_no", "tmc_kind"].forEach((f) => X.remember(tx, f, r.getString(f)));
    L.log(tx, a, "request_update", "requests", r.id, "Заявка № " + r.getString("number") + " изменена: " + ch.join("; ").slice(0, 1800), { changes: ch });
    X.ovrSave(L, tx, g, r, "requests", r.id, "заявка № " + r.getString("number") + " изменена");
    out = { changed: ch.length, changes: ch };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Заметки по заявке: добавить / отметить «сделано» ----------
routerAdd("POST", "/api/vs/request/note", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const a = L.requireRole(e, L.WRITE_ROLES);
  const b = e.requestInfo().body || {};
  const text = L.str(b.text).slice(0, 3000);
  let out = null;
  $app.runInTransaction((tx) => {
    if (L.str(b.note)) {
      const n = tx.findRecordById("request_notes", L.str(b.note));
      const r = tx.findRecordById("requests", n.getString("request"));
      n.set("done", !!b.done);
      n.set("done_by", b.done ? L.authId(a) : ""); n.set("done_at", b.done ? L.fmt(new Date()) : "");
      tx.save(n);
      L.log(tx, a, "request_note_done", "requests", r.id, "Заявка № " + r.getString("number") + ": заметка " + (b.done ? "выполнена" : "снова не выполнена") + " — «" + n.getString("text").slice(0, 120) + "»", {});
      out = { note: n.id };
      return;
    }
    if (!text) throw new BadRequestError("Напишите текст заметки.");
    const r = tx.findRecordById("requests", L.str(b.request));
    const n = new Record(tx.findCollectionByNameOrId("request_notes"));
    n.set("request", r.id); n.set("text", text); n.set("done", false);
    if (L.authId(a)) n.set("created_by", a.id);
    n.set("author_name", L.userName(a));
    tx.save(n);
    L.log(tx, a, "request_note", "requests", r.id, "Заявка № " + r.getString("number") + ": заметка — «" + text.slice(0, 150) + "»", {});
    out = { note: n.id };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Учёт: передать закрытую заявку в учёт, заполнить «выдано фактически», завершить ----------
routerAdd("POST", "/api/vs/request/uchet", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const b = e.requestInfo().body || {};
  const act = L.str(b.action);
  const a = L.requireRole(e, act === "reopen" ? ["admin", "manager"] : L.WRITE_ROLES);
  const g = X.guard(L, a, b);
  let out = null;
  $app.runInTransaction((tx) => {
    const r = tx.findRecordById("requests", L.str(b.request));
    const us = r.getString("uchet_status");
    const items = tx.findRecordsByFilter("request_items", "request = {:r}", "sort", 0, 0, { r: r.id });
    const head = "Заявка № " + r.getString("number") + ": ";
    const saveItems = () => {
      const ch = [];
      (Array.isArray(b.items) ? b.items : []).forEach((x) => {
        const it = items.filter((q) => q.id === L.str(x && x.id))[0];
        if (!it) throw new BadRequestError("Позиция не из этой заявки.");
        [["fact_unit", "ед."], ["fact_qty", "кол-во"], ["issue_doc", "расходный документ"]].forEach((f) => {
          if (x[f[0]] === undefined) return;
          let nv = L.str(x[f[0]]);
          if (f[0] === "fact_qty" && nv) { const q = parseFloat(nv.replace(",", ".")); if (isNaN(q) || q < 0) throw new BadRequestError("«" + it.getString("material") + "»: количество фактически — число."); nv = String(Math.round(q * 1000) / 1000).replace(".", ","); }
          if (nv !== it.getString(f[0])) { ch.push("«" + it.getString("material") + "» " + f[1] + ": «" + it.getString(f[0]) + "» → «" + nv + "»"); it.set(f[0], nv); }
        });
      });
      items.forEach((it) => tx.save(it));
      return ch;
    };
    let text = "";
    if (act === "hand") {
      if (r.getString("status") !== "closed") throw new BadRequestError("В учёт передаётся только закрытая заявка.");
      if (us) throw new BadRequestError("Заявка уже в учёте.");
      items.forEach((it) => {
        if (!it.getString("fact_unit")) it.set("fact_unit", it.getString("unit"));
        if (!it.getString("fact_qty")) it.set("fact_qty", String(it.getFloat("qty_issued")).replace(".", ","));
      });
      saveItems();
      r.set("uchet_status", "in_uchet"); r.set("uchet_at", L.fmt(new Date())); if (L.authId(a)) r.set("uchet_by", a.id);
      text = head + "передана в учёт";
    } else if (act === "save" || act === "done") {
      if (us !== "in_uchet") throw new BadRequestError(us === "done" ? "Учёт завершён — изменить может руководитель (открыть учёт)." : "Заявка не передана в учёт.");
      const ch = saveItems();
      if (act === "done") {
        const empty = items.filter((it) => !it.getString("fact_qty"));
        if (empty.length) X.deny(g, "Не заполнено «Количество фактически»: " + empty.map((it) => "«" + it.getString("material") + "»").join(", "));
        const nodoc = items.filter((it) => !it.getString("issue_doc"));
        if (nodoc.length) X.deny(g, "Не указан расходный документ: " + nodoc.length + " поз.");
        X.check(g);
        r.set("uchet_status", "done"); r.set("uchet_done_at", L.fmt(new Date())); if (L.authId(a)) r.set("uchet_done_by", a.id);
        text = head + "УЧЁТ ЗАВЕРШЁН" + (ch.length ? " (" + ch.join("; ") + ")" : "");
      } else {
        if (!ch.length) { out = { changed: 0 }; return; }
        text = head + "учёт: " + ch.join("; ");
      }
    } else if (act === "reopen") {
      if (us !== "done") throw new BadRequestError("Учёт не завершён.");
      r.set("uchet_status", "in_uchet"); r.set("uchet_done_at", ""); r.set("uchet_done_by", "");
      text = head + "учёт открыт повторно" + (L.str(b.comment) ? ": " + L.str(b.comment) : "");
    } else throw new BadRequestError("Неизвестное действие.");
    tx.save(r);
    L.log(tx, a, "request_uchet", "requests", r.id, text.slice(0, 1900), {});
    X.ovrSave(L, tx, g, r, "requests", r.id, "заявка № " + r.getString("number") + ", учёт завершён");
    out = { uchet_status: r.getString("uchet_status") };
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---------- Архив заявок: загрузка из Excel (повторная загрузка обновляет, лишние строки удаляются) ----------
routerAdd("POST", "/api/vs/archive/import", (e) => {
  const L = require(`${__hooks}/lib.js`);
  const X = require(`${__hooks}/lib_ext.js`);
  const a = L.requireRole(e, ["admin", "manager"]);
  const b = e.requestInfo().body || {};
  const imp = L.str(b.import_id);
  if (!/^[a-z0-9]{6,40}$/.test(imp)) throw new BadRequestError("Неверный идентификатор загрузки.");
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length > 1000) throw new BadRequestError("Слишком много строк в одной части.");
  let total = 0, removed = 0;
  $app.runInTransaction((tx) => {
    const col = tx.findCollectionByNameOrId("request_archive");
    rows.forEach((x) => {
      const key = L.str(x.row_key).slice(0, 120);
      if (!key) return;
      let rec = null;
      try { rec = tx.findFirstRecordByFilter("request_archive", "row_key = {:k}", { k: key }); } catch (_) {}
      if (!rec) { rec = new Record(col); rec.set("row_key", key); }
      const s = (k, m) => L.str(x[k]).slice(0, m);
      rec.set("sheet", s("sheet", 120)); rec.set("line_no", parseInt(x.line_no, 10) || 0);
      rec.set("opp_no", s("opp_no", 120)); rec.set("omts_no", s("omts_no", 200));
      const nums = (L.str(x.omts_no).match(/\d{2,}/g) || []).concat((L.str(x.opp_no).match(/\d{2,}/) || []).slice(0, 1)); // ОПП: только порядковый номер, не месяц
      rec.set("nums", nums.length ? "|" + nums.join("|") + "|" : "");
      rec.set("applicant", s("applicant", 300)); rec.set("req_date", s("req_date", 30)); rec.set("recipient", s("recipient", 300));
      rec.set("project_code", s("project_code", 300)); rec.set("material", s("material", 1500)); rec.set("proj_flag", s("proj_flag", 60));
      rec.set("unit", s("unit", 30));
      const q = parseFloat(String(x.qty === undefined || x.qty === null ? "" : x.qty).replace(",", "."));
      rec.set("qty", isNaN(q) ? 0 : Math.round(q * 1000) / 1000);
      rec.set("transfer", s("transfer", 1000)); rec.set("note", s("note", 2000));
      // 1.6: раздел, статус, дата выдачи, выдано, файл-источник
      rec.set("section", s("section", 120)); rec.set("status", s("status", 300)); rec.set("issue_date", s("issue_date", 30)); rec.set("source", s("source", 200));
      const qi = parseFloat(String(x.qty_issued === undefined || x.qty_issued === null ? "" : x.qty_issued).replace(",", "."));
      rec.set("qty_issued", isNaN(qi) ? 0 : Math.round(qi * 1000) / 1000);
      rec.set("search_lc", X.lc([x.opp_no, x.omts_no, x.applicant, x.recipient, x.project_code, x.material, x.transfer, x.note, x.sheet, x.section, x.status].map((v) => L.str(v)).join(" ")).slice(0, 6000));
      rec.set("import_id", imp);
      tx.save(rec);
    });
    if (b.final) {
      // 1.6: несколько файлов — обновляются только листы этого файла, остальные не трогаем
      const sheets = Array.isArray(b.sheets) ? b.sheets.map((v) => L.str(v)).filter(Boolean) : null;
      const old = tx.findRecordsByFilter("request_archive", "import_id != {:i}", "", 0, 0, { i: imp })
        .filter((r) => !sheets || sheets.indexOf(r.getString("sheet")) >= 0);
      old.forEach((r) => tx.delete(r)); removed = old.length;
      total = tx.findRecordsByFilter("request_archive", "import_id = {:i}", "", 0, 0, { i: imp }).length;
      L.log(tx, a, "archive_import", "requests", "", "Загружен архив заявок" + (L.str(b.file_name) ? " «" + L.str(b.file_name) + "»" : "") + ": " + total + " строк" +
        (sheets ? " (листы: " + sheets.join(", ") + ")" : "") + ", удалено устаревших: " + removed, { file: L.str(b.file_name) });
    }
  });
  return e.json(200, { total: total, removed: removed });
}, $apis.requireAuth("users"));
