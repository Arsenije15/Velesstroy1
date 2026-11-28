// VELESSTROY 1.9.66 — выдача по фото / тексту: «Заявка 7112: Геотекстиль500-1800м2 / Мембрана ПВХ 2мм-645м2 / 7156: Пена-50шт»
// → заявка, позиция, сколько выдать (в единице заявки). Только предложение: выдаёт пользователь после проверки.
const lc = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
const LAT = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", r: "г", t: "т", x: "х", y: "у", w: "ш", u: "и", n: "п" };
function rows(app, sql, model, P) { const R = arrayOf(new DynamicModel(model)); const q = app.db().newQuery(sql); if (P) q.bind(P); q.all(R); return JSON.parse(JSON.stringify(R)); }
const n3 = (v) => Math.round((+v || 0) * 1000) / 1000;
// единицы: «м2», «КГ», «рулона», «упак»; OCR путает буквы с латиницей: «WT»/«LUT» = «шт», «Kr» = «кг»
function unitOf(raw) {
  if (/^\s*(мм|mm|см|cm)\s*$/i.test(raw)) return "";   // размер, не количество
  let u = lc(raw).replace(/lu|iu|ll/g, "ш").replace(/[a-z]/g, (ch) => LAT[ch] || ch).replace(/(.)\1+/g, "$1").replace(/[.\s]/g, "");
  if (/^(м2|м²|кв\.?м|квм)$/.test(u)) return "м2";
  if (/^(м3|м³|куб\S*)$/.test(u)) return "м3";
  if (/^(кг|килограм\S*)$/.test(u)) return "кг";
  if (/^(т|тн|тон\S*)$/.test(u)) return "т";
  if (/^(шт|штук\S*|ш)$/.test(u)) return "шт";
  if (/^(рул\S*)$/.test(u)) return "рул";
  if (/^(упак\S*|уп)$/.test(u)) return "упак";
  if (/^(компл\S*|кт|к-т)$/.test(u)) return "компл";
  if (/^(меш\S*)$/.test(u)) return "меш";
  if (/^(пм|погм|мп|пог\S*)$/.test(u)) return "м";
  if (/^(м|метр\S*)$/.test(u)) return "м";
  if (/^(л|литр\S*)$/.test(u)) return "л";
  if (/^(пач\S*|лист\S*|бал\S*|ящ\S*|бух\S*|кор\S*|пал\S*)$/.test(u)) return u.slice(0, 4);
  return "";
}
const normU = (u) => unitOf(u) || lc(u).replace(/[.\s]/g, "");
// одна позиция: название и количество(а): «труба 40х40х2-(21 шт) 294 кг» → {name:"труба 40х40х2", q:[{q:21,u:"шт"},{q:294,u:"кг"}]}
function parseItem(t) {
  t = String(t || "").replace(/\s+/g, " ").trim().replace(/\s+\d{1,2}[:\-]\d{2}(\s+\S{1,3})?\s*$/, "");   // время сообщения «17:59» / «17-59»
  let cut = -1; const re = /[-–—]\s*\(?\s*\d/g; let m; while ((m = re.exec(t))) cut = m.index;
  let name = t, rest = "";
  if (cut > 0) { name = t.slice(0, cut); rest = t.slice(cut + 1); }
  else {   // без тире: «Мембрана ПВХ 2мм 645 м2» — количество = последнее «число единица»
    const re2 = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*([A-Za-zА-Яа-яЁё]{1,10}[23²³]?)\.?(?=\s|$|\))/g; let at = -1, mm;
    while ((mm = re2.exec(t))) if (unitOf(mm[2])) at = mm.index;
    if (at > 0) { name = t.slice(0, at); rest = t.slice(at); }
  }
  rest = rest.replace(/(\d)[OoОоØø](?=\d|\b)/g, "$10").replace(/[OoОоØø](?=\d)/g, "0").replace(/\s\d{1,2}[:\-]\d{2}\s*$/, " ");   // время сообщения «17:59»
  const q = []; const rq = /(\d+(?:[.,]\d+)?)(?![\d.,])\s*([A-Za-zА-Яа-яЁё]{0,10}[23²³]?)\.?/g;
  while ((m = rq.exec(rest))) { const raw = m[1]; if (rest.slice(m.index + raw.length).trim().startsWith(":")) continue;
    q.push({ raw, q: parseFloat(raw.replace(",", ".")), u: unitOf(m[2]) }); }
  return { name: name.replace(/[-–—(\s]+$/, "").trim(), q, text: t };
}
// текст → [{no, items:[…]}]: «Заявка 7112: …», «7156: …»; строка без количества — продолжение предыдущей
function parseText(text) {
  const out = []; let cur = null, last = null;
  text = String(text || "").replace(/\s*(заявк\S*\s*№?\s*\d{3,6}\s*[:;])/gi, "\n$1").replace(/(^|\s)(\d{3,6}\s*:)(?!\d)/g, "\n$2")
    .replace(/(\d(?:[.,]\d+)?\s*(?:м2|м²|м3|кг|тн|т|шт|рул\S*|упак\S*|компл\S*|меш\S*|пач\S*|л|м)\.?\)?)[ \t]+(?=[А-ЯЁA-Z])/g, "$1\n");
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => {
    const h = l.match(/^(?:заявк\S*|zajavk\S*|з-|z-)?\s*№?\s*(\d{3,6})\s*[:;]\s*(.*)$/i) || l.match(/^(?:заявк\S*|zajavk\S*)\s*№?\s*(\d{3,6})\s*[.,-]?\s*(.*)$/i);
    if (h) { cur = { no: h[1], items: [] }; out.push(cur); last = null; l = h[2]; if (!l) return; }
    if (!cur) return;   // до первой «Заявка …» — подписи фото, время и т. п.
    if (last && (!/[-–—]\s*\(?\s*\d/.test(last.raw) || /^(кг|kr|т|тн|шт|wt|м2|м²|м3|рул\S*|упак\S*|компл\S*|меш\S*)\.?\s*$/i.test(l) || /^[а-яёa-z(]/.test(l) && !parseItem(last.raw).q.length)) {
      last.raw += " " + l; return; }
    last = { raw: l }; cur.items.push(last);
  });
  out.forEach((g) => { g.items = g.items.map((x) => parseItem(x.raw)).filter((x) => x.name.replace(/[^A-Za-zА-Яа-яЁё]/g, "").length >= 3 && x.q.length); });
  return out.filter((g) => g.items.length);
}
// слова для сравнения: основа русских слов, размеры («40х40х2», «1,5мм») отдельно
const TR = [["dž", "дж"], ["lj", "ль"], ["nj", "нь"], ["đ", "дж"], ["ž", "ж"], ["č", "ч"], ["ć", "ч"], ["š", "ш"], ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"], ["e", "е"], ["z", "з"], ["i", "и"], ["j", "й"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["f", "ф"], ["h", "х"], ["c", "ц"], ["w", "в"], ["y", "ы"], ["q", "к"]];
const translit = (w) => { let x = w; TR.forEach(([a, b]) => { x = x.split(a).join(b); }); return x; };
function toks(s) {
  s = lc(s).replace(/[a-zčćšžđ]{3,}/g, (w) => w + " " + translit(w));   // «geotekstil» ↔ «геотекстиль», «kronbuild» — как есть
  const t = lc(s).replace(/[a-z]/g, (ch) => ch).replace(/(\d),(\d)/g, "$1.$2").replace(/x|×|\*/g, "х");
  const words = [], nums = [];
  t.split(/[^0-9a-zа-я.х]+/).forEach((w) => { if (!w) return;
    if (/\d/.test(w)) { let n = w.replace(/[^0-9.х]/g, "").replace(/^\.+|\.+$/g, ""); if (/^\d+(\.\d+)?$/.test(n)) n = String(parseFloat(n)); if (n) nums.push(n); const wl = w.replace(/[0-9.х]+/g, " ").trim(); if (wl.length >= 3) words.push(wl.slice(0, 6)); }
    else if (w.length >= 3) words.push(w.replace(/(ами|ями|ого|его|ой|ей|ый|ий|ая|яя|ое|ее|ые|ие|ую|ам|ям|ом|ем|ах|ях|ов|ев|а|я|ы|и|е|о|у|ю|ь|й)$/, "").slice(0, 6)); });
  return { words, nums };
}
function score(a, b) {
  const A = toks(a), B = toks(b); let s = 0;
  A.words.forEach((w) => { if (B.words.some((x) => x === w || (w.length >= 4 && x.length >= 4 && (x.indexOf(w) === 0 || w.indexOf(x) === 0)))) s += 1; });
  A.nums.forEach((n) => { if (B.nums.indexOf(n) >= 0) s += 1.5; });
  return s;
}
function sim(a, b) { const A = toks(a).words, B = toks(b).words; if (!A.length || !B.length) return 0; return A.filter((w) => B.indexOf(w) >= 0).length / Math.max(A.length, B.length); }
// количество в единице позиции заявки: 294 кг → 0,294 т; из нескольких («21 шт», «294 кг») — та, что в единице заявки
function qtyFor(q, unit) {
  const u = normU(unit); const hit = q.find((x) => x.u && x.u === u); if (hit) return { v: hit.q, raw: hit, conv: "" };
  const kg = q.find((x) => x.u === "кг"), t = q.find((x) => x.u === "т");
  if (u === "т" && kg) return { v: n3(kg.q / 1000), raw: kg, conv: kg.q + " кг → " + n3(kg.q / 1000) + " т" };
  if (u === "кг" && t) return { v: n3(t.q * 1000), raw: t, conv: t.q + " т → " + n3(t.q * 1000) + " кг" };
  const any = q.find((x) => !x.u) || q[0]; return { v: any.q, raw: any, conv: any.u && u && any.u !== u ? "в тексте " + any.u + ", в заявке " + unit : "" };
}
// перечёркнутый ноль «Ø»: tesseract читает 6/9/лишнюю цифру — варианты замены
function digitVariants(raw) {
  const s = String(raw).replace(",", "."); const set = {}; set[s] = 1;
  const pos = []; for (let i = 0; i < s.length; i++) if (s[i] === "6" || s[i] === "9") pos.push(i);
  const P = pos.slice(0, 6); for (let m = 1; m < (1 << P.length); m++) { let a = s.split(""); P.forEach((p, k) => { if (m & (1 << k)) a[p] = "0"; }); set[a.join("")] = 1; }
  Object.keys(set).forEach((v) => { for (let i = 0; i < v.length; i++) set[v.slice(0, i) + v.slice(i + 1)] = 1; });
  return Object.keys(set).filter((v) => /^\d+(\.\d+)?$/.test(v)).map(parseFloat);
}
// ---------- предложение выдачи ----------
function proposal(app, texts, src) {
  texts = (texts || []).map(String).filter((t) => t.trim());
  const P = texts.map(parseText); let pi = 0; P.forEach((p, i) => { const n = p.reduce((s, g) => s + g.items.length, 0); if (n > P[pi].reduce((s, g) => s + g.items.length, 0)) pi = i; });
  const prim = P[pi] || [];
  const reqCache = {};
  const findReq = (no) => { const n = String(no).toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, ""); if (reqCache[n] !== undefined) return reqCache[n];
    const R = app.findRecordsByFilter("requests", "number_norm = {:n} && status != 'cancelled'", "-created", 1, 0, { n }); reqCache[n] = R.length ? R[0] : null; return reqCache[n]; };
  const groups = prim.map((g, gi) => {
    // № заявки: голосование по вариантам + существует ли такая; «71156» → «7156»
    const nos = [g.no].concat(P.filter((p, i) => i !== pi).map((p) => (p[gi] || {}).no).filter(Boolean));
    let r = null, no = g.no;
    const cand = nos.slice().sort((a, b) => nos.filter((x) => x === b).length - nos.filter((x) => x === a).length);
    for (const c of cand) { if ((r = findReq(c))) { no = c; break; } }
    if (!r) for (const c of cand) { for (let i = 0; i < c.length && !r; i++) { const d = c.slice(0, i) + c.slice(i + 1); if (d.length >= 3 && (r = findReq(d))) no = d; } if (r) break; }
    const items = r ? app.findRecordsByFilter("request_items", "request = {:r}", "sort,created", 0, 0, { r: r.id }).map((it) => ({ id: it.id, material: it.getString("material"), unit: it.getString("unit"),
      ordered: n3(it.getFloat("qty_ordered")), issued: n3(it.getFloat("qty_issued")), text: [it.getString("material"), it.getString("name1c"), it.getString("project_name")].join(" ") })) : [];
    const used = {};
    const rowsOut = g.items.map((x, xi) => {
      // то же место в других вариантах распознавания — для голосования по количеству
      const others = P.filter((p, i) => i !== pi).map((p) => { const og = p.find((y) => y.no === g.no) || p[gi]; if (!og) return null;
        let best = null, bs = -1; og.items.forEach((y, yi) => { const s = sim(x.name, y.name) + (yi === xi ? 0.2 : 0); if (s > bs) { bs = s; best = y; } }); return bs >= 0.3 ? best : null; }).filter(Boolean);
      let best = null, bs = 0, second = 0;
      items.forEach((it) => { const s = score(x.name, it.text) - (used[it.id] ? 0.5 : 0); if (s > bs) { second = bs; bs = s; best = it; } else if (s > second) second = s; });
      const warn = [];
      if (!r) warn.push("заявка не найдена");
      else if (r.getString("status") !== "open") warn.push("заявка закрыта");
      if (r && !best) warn.push("позиция не найдена — выберите");
      if (best && second >= bs - 0.01 && second > 0) warn.push("похожих позиций несколько — проверьте");
      let qty = null, conv = "", fixed = "";
      if (best) {
        used[best.id] = 1; const qf = qtyFor(x.q, best.unit); qty = qf.v; conv = qf.conv;
        const left = n3(best.ordered - best.issued);
        const raws = [qf.raw.raw].concat(others.map((o) => { const z = o.q.find((y) => y.u === qf.raw.u) || o.q[0]; return z ? z.raw : null; }).filter(Boolean));
        const k = (qf.v === qf.raw.q) ? 1 : qf.v / qf.raw.q;   // пересчёт кг → т
        const votes = {}; raws.forEach((v) => { votes[v] = (votes[v] || 0) + 1; });
        const top = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
        if (raws.length > 1 && votes[top] >= 2 && top !== String(qf.raw.raw)) { qty = n3(parseFloat(top.replace(",", ".")) * k); fixed = "по нескольким прочтениям"; }
        const allSame = Object.keys(votes).length === 1;
        if (qty > left + 1e-9 && left > 0) {   // больше остатка — возможно, «Ø» прочитан как 6/9: вариант, равный остатку
          const V = []; raws.forEach((v) => digitVariants(v).forEach((d) => V.push(n3(d * k))));
          if (V.some((v) => Math.abs(v - left) < 1e-9)) { fixed = "прочитано " + qty + " — по остатку заявки " + left + " (перечёркнутый ноль на снимке)"; qty = left; }
        }
        if (!allSame && src !== "text") warn.push("цифры прочитаны неуверенно: " + Object.keys(votes).join(" / "));
        if (qty > left + 1e-9) warn.push("больше остатка по заявке (" + left + " " + best.unit + ")");
      }
      return { text: x.text, name: x.name, read: x.q.map((y) => y.raw + (y.u ? " " + y.u : "")).join(", "), item: best ? best.id : "", qty, conv, fixed, warn };
    });
    return { no, read_no: g.no, req: r ? { id: r.id, number: r.getString("number"), object: r.getString("object"), applicant: r.getString("recipient"), status: r.getString("status"), handed: !!r.getString("handed_at") } : null,
      items: items.map((it) => ({ id: it.id, material: it.material, unit: it.unit, ordered: it.ordered, issued: it.issued })), rows: rowsOut };
  });
  return { src, groups, rows: groups.reduce((s, g) => s + g.rows.length, 0), text: texts[pi] || "" };
}
// снимок → текст (python: Yandex Vision OCR, иначе tesseract в нескольких вариантах)
function ocr(app, path) {
  const envp = require(`${__hooks}/lib1946.js`).paths(app).state + "/ai.env";
  let txt = "";
  try { txt = toString($os.cmd("timeout", "180", "nice", "-n", "10", "python3", `${__hooks}/ocr_issue.py`, path, envp).output()); }
  catch (err) { throw new BadRequestError("Распознавание не запустилось на сервере: " + String(err).slice(0, 200)); }
  let j = null; try { j = JSON.parse(txt); } catch (_) { throw new BadRequestError("Не удалось прочитать снимок."); }
  if (j.error) throw new BadRequestError(j.error);
  return j;
}
module.exports = { parseText, parseItem, proposal, ocr, unitOf, digitVariants };
