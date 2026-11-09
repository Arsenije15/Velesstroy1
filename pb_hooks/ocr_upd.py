#!/usr/bin/env python3
# VELESSTROY 1.8 — чтение УПД (счёт-фактура / универсальный передаточный документ) со скана или фото.
# Шапка: номер, дата, продавец, ИНН/КПП, основание (договор/спецификация), итог. Таблица: код, наименование, ед., кол-во, цена, суммы.
import sys, os, re, json, subprocess, tempfile, time, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ocr_zayavka import out, tess, osd_rotation, deskew, rotate, masks, peaks, lc, words, quality, num, fix_codes, find_table
import cv2, numpy as np

MONTHS = {"январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6, "июл": 7, "август": 8, "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12}
def month_of(w):
    w = lc(w)
    for k in sorted(MONTHS, key=len, reverse=True):
        if w.startswith(k): return MONTHS[k]
    return None

def fix_digits(s):
    return (s or "").translate(str.maketrans({"O": "0", "О": "0", "o": "0", "о": "0", "З": "3", "з": "3", "l": "1", "I": "1", "|": "1", "S": "5", "Б": "6", "B": "8"}))

def inn_ok(inn):
    d = [int(c) for c in inn]
    if len(d) == 10:
        return (sum(a * b for a, b in zip([2, 4, 10, 3, 5, 9, 4, 6, 8], d)) % 11) % 10 == d[9]
    if len(d) == 12:
        c1 = (sum(a * b for a, b in zip([7, 2, 4, 10, 3, 5, 9, 4, 6, 8], d)) % 11) % 10
        c2 = (sum(a * b for a, b in zip([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8], d)) % 11) % 10
        return c1 == d[10] and c2 == d[11]
    return False

def clean_org(v):
    v = re.sub(r"(^|\s)(000|0OO|O0O|OOO|ООО|ОО0|0О0)(?=\s|[\"«“„])", r"\1ООО", v or "")
    v = v.replace("“", "\"").replace("”", "\"").replace("„", "\"").replace("«", "\"").replace("»", "\"").replace("''", "\"")
    v = re.sub(r"\s+", " ", v).strip(" .,:;|_-")
    m = re.match(r"(.*?\"[^\"]{2,80}\")", v)
    return m.group(1) if m else v[:120]

def money(s):
    # денежные суммы в УПД всегда с копейками: «70 09171» (запятая потерялась) → 70091.71
    t = re.sub(r"[^0-9.,]", "", (s or "").replace(" ", ""))
    if not t: return None
    if "," not in t and "." not in t and len(t) >= 3: t = t[:-2] + "." + t[-2:]
    return num(t)

def header_fields(t):
    t = re.sub(r"[ \t]+", " ", t)
    h, votes = {}, {}
    # № и дата: «Счет-фактура № ЦБ-2572 от 6 ноября 2026 г.», «Универсальный передаточный документ № 16460 от 03.11.2026»
    pat = r"№\s*([A-Za-zА-Яа-я]{0,4}[\-–—]?\s?\d[\w\-/]{0,15})\s*(?:о[тг]|oт|ot|ст|c[тt]|or)\s*[\"«“]?(\d{1,2})[\"»”]?\s*[.\s]?\s*([А-Яа-яё]{3,9}|\d{1,2})[.\s]+(\d{4})"
    for ctx in re.finditer(r"(Сч[её]т[\s\-]*фактур\S*|передаточн\S*\s+документ\S*|Документ\s+об\s+отгруз\S*)[^№]{0,60}" + pat, t, re.I):
        no = re.sub(r"\s", "", ctx.group(2)).replace("–", "-").replace("—", "-")
        no = re.sub(r"^([A-Za-zА-Яа-я]+)(\d)", r"\1-\2", no) if re.match(r"^[А-ЯA-Z]{1,4}\d", no) else no
        mo = month_of(ctx.group(4)) if not ctx.group(4).isdigit() else int(ctx.group(4))
        d, y = int(ctx.group(3)), int(fix_digits(ctx.group(5)))
        if not mo or not (1 <= d <= 31) or not (2015 <= y <= 2040): continue
        key = (no.upper(), "%04d-%02d-%02d" % (y, mo, d))
        votes[key] = votes.get(key, 0) + (2 if ctx.group(1).lower().startswith("сч") else 1)
    if votes:
        (no, dt), _ = max(votes.items(), key=lambda kv: kv[1])
        h["number"], h["date"] = no, dt
    else:
        # плохое фото: номер и дату ищем отдельно
        nv = {}
        for m in re.finditer(r"(?:фактур\S*|документ\S*)[\s.,]*№\s*['\"«]?\s*([A-Za-zА-Яа-я]{0,4}\s?[\-–—]?\s?\d{2,8})", t, re.I):
            no = re.sub(r"\s", "", m.group(1)).replace("–", "-").replace("—", "-")
            if re.match(r"^[А-ЯA-Zа-яa-z]{1,4}\d", no): no = re.sub(r"^([^\d]+)", r"\1-", no)
            nv[no.upper()] = nv.get(no.upper(), 0) + 1
        if nv: h["number"] = max(nv.items(), key=lambda kv: (kv[1], len(kv[0])))[0]; h["number_unsure"] = True
        dv = {}
        for m in re.finditer(r"[\"«“]?(\d{1,2})[\"»”]?\s+([А-Яа-яё]{3,9})\s+(20\d{2})", t):
            mo = month_of(m.group(2)); d = int(m.group(1)); y = int(m.group(3))
            if mo and 1 <= d <= 31 and 2015 <= y <= 2040: k = "%04d-%02d-%02d" % (y, mo, d); dv[k] = dv.get(k, 0) + 1
        if dv: h["date"] = max(dv.items(), key=lambda kv: kv[1])[0]; h["date_unsure"] = True
    m = re.search(r"(?:Пр|Р)?[оo]?дав?[еeао]ц:?\s*(.{3,160}?)\s*(?:\(2\)|\[2\]|0?2\}|Адрес|Покупател)", t, re.I)
    if m: h["seller"] = clean_org(m.group(1))
    m = re.search(r"ИНН\s*/?\s*КПП\s*(?:продавца|прод\S*)\s*:?\s*([0-9OОЗзoо ]{10,14})\s*/\s*([0-9OОЗзoо ]{9,10})", t, re.I)
    if m:
        inn = re.sub(r"\D", "", fix_digits(m.group(1))); kpp = re.sub(r"\D", "", fix_digits(m.group(2)))[:9]
        if len(inn) in (10, 12): h["seller_inn"] = inn; h["seller_kpp"] = kpp; h["inn_ok"] = inn_ok(inn)
    m = re.search(r"Покупател\S*:?\s*(.{3,160}?)\s*(?:\(6\)|\[6\]|Адрес)", t, re.I)
    if m: h["buyer"] = clean_org(m.group(1))
    h["buyer_ok"] = bool(re.search(r"велесстр", lc(t)))
    m = re.search(r"Основание\s+передачи[^\n]{0,60}?(?:при[её]мки\)?|\))\s*:?\s*(.{5,240}?)\s*(?:\[8\]|\(8\)|\(договор|Данные о транспорт|$)", t, re.I)
    if m:
        b = re.sub(r"\s+", " ", m.group(1)).strip(" .,:;|_-")
        if len(b) > 4: h["basis"] = b
    sp = re.findall(r"Спецификац\S*\s*№\s*(\d{1,6})", t, re.I)
    if sp: h["spec"] = sp[0]
    m = re.search(r"Всего\s+к\s+оплат\S*(.{0,160})", t, re.I)
    if m:
        vals = [num(x) for x in re.findall(r"\d{1,3}(?:[ \u00a0]\d{3})*[.,]\d{2}", m.group(1))]
        vals = [v for v in vals if v]
        if vals: h["total_nt"] = vals[0]; h["total"] = vals[-1] if len(vals) >= 2 else None
    return h

KEYS = [("name", ["наименование товара", "наименован", "описание выполн"]), ("code", ["код товара", "работ, услуг", "товара/"]),
        ("unit", ["условное", "обозна", "нацио"]), ("qty", ["коли", "(объем)", "объем"]), ("price", ["цена", "тариф"]),
        ("total", ["с налогом"]), ("sum", ["без налога", "без нало"]), ("rate", ["ставка", "налоговая"]), ("tax", ["предъяв", "сумма налога"])]
NUMROW = {"А": "code", "A": "code", "1а": "name", "1a": "name", "2а": "unit", "2a": "unit", "3": "qty", "4": "price", "5": "sum", "7": "rate", "8": "tax", "9": "total"}

def map_cols(clean, xs, top, y_to):
    heads = []
    for j in range(len(xs) - 1):
        c = clean[max(0, top):y_to, xs[j] + 3:xs[j + 1] - 3]
        heads.append(lc(tess(c, 6)) if c.size and c.shape[1] > 12 else "")
    col = {}
    for key, ws in KEYS:
        for j, h in enumerate(heads):
            if j in col.values(): continue
            if any(w in h for w in ws): col[key] = j; break
    return col, heads

def table_rows(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    tb = find_table(g)
    if not tb: return None
    hor, ver = tb["hor"], tb["ver"]
    lines = cv2.dilate(cv2.bitwise_or(hor, ver), np.ones((5, 5), np.uint8))
    clean = g.copy(); clean[lines > 0] = 255
    ys, xs = tb["ys"], tb["xs"]
    if len(xs) < 8: return None
    bands = [(ys[i], ys[i + 1]) for i in range(len(ys) - 1) if ys[i + 1] - ys[i] >= 25]
    # строка с номерами колонок «А 1 1а … 9» — тонкая; шапка — над ней
    numrow = None
    for i, (a, b) in enumerate(bands[:30]):
        if b - a > 90: continue
        txt = [tess(cv2.copyMakeBorder(cv2.resize(clean[a + 3:b - 3, xs[j] + 3:xs[j + 1] - 3], None, fx=2, fy=2), 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255), 7)
               if (b - a) > 10 and xs[j + 1] - xs[j] > 10 else "" for j in range(len(xs) - 1)]
        hits = sum(1 for x in txt if x.strip() in NUMROW or x.strip() in ("1", "2", "6", "10", "11", "1б", "1b", "10а"))
        if hits >= 6: numrow = (i, txt); break
    head_to = bands[numrow[0]][0] if numrow else (bands[0][1] if bands else tb["top"] + 100)
    col, heads = map_cols(clean, xs, max(tb["top"], head_to - 560), head_to)   # шапка таблицы — не выше ~4,5 см над строкой номеров
    if numrow:
        for j, x in enumerate(numrow[1]):
            k = NUMROW.get(x.strip())
            if k and k not in col and j not in col.values(): col[k] = j
    if not ("name" in col and "qty" in col): return {"cols": col, "heads": heads, "items": []}
    start = numrow[0] + 1 if numrow else 1
    items, totals = [], {}
    for a, b in bands[start:]:
        if b - a < 30: continue
        def cell(key, psm=6, extra=None, zoom=1):
            j = col.get(key)
            if j is None or j >= len(xs) - 1: return ""
            c = clean[a + 4:b - 4, xs[j] + 4:xs[j + 1] - 4]
            if not c.size: return ""
            if zoom > 1: c = cv2.copyMakeBorder(cv2.resize(c, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC), 25, 25, 25, 25, cv2.BORDER_CONSTANT, value=255)
            return tess(c, psm, extra)
        name = fix_codes(cell("name")).strip(" |_:;")
        if re.search(r"всего|к\s*оплат|итого", lc(name)) or re.search(r"всего|к\s*оплат", lc(cell("code"))):
            totals = {"total_nt": money(cell("sum", 7)), "total": money(cell("total", 7))}; break
        qraw = cell("qty")
        q = num(qraw)
        if q is None: qraw = cell("qty", 7, ["-c", "tessedit_char_whitelist=0123456789,. "], 2); q = num(qraw)
        name = re.sub(r"^\d{1,3}\s+(?=\D)", "", name)   # № п/п иногда попадает в колонку наименования
        if len(words(name)) < 1 or (q is None and len(name) < 6): continue
        UM = {"wt": "шт", "uit": "шт", "lut": "шт", "шг": "шт", "ш": "шт", "kr": "кг", "m": "м", "m2": "м2", "м?": "м2", "mm": "м", "n": "м", "nm": "м"}
        unit = ""
        for psm, z in ((7, 2), (10, 3), (8, 3)):
            u = re.sub(r"[^A-Za-zА-Яа-я0-9²³.]", "", cell("unit", psm, None, z)).lower()[:8].replace("м²", "м2").replace("м³", "м3").strip(".")
            u = UM.get(u, u)
            if u and re.search(r"[a-zа-я]", u): unit = u; break
        if col.get("unit", 0) > 0 and (not unit or unit not in OKEI.values()):
            # код ОКЕИ в соседней колонке «код»: 796 — шт, 006 — м …
            j0 = col["unit"] - 1
            if j0 not in col.values():
                c = clean[a + 4:b - 4, xs[j0] + 4:xs[j0 + 1] - 4]
                if c.size:
                    k = re.sub(r"\D", "", tess(cv2.copyMakeBorder(cv2.resize(c, None, fx=2, fy=2), 25, 25, 25, 25, cv2.BORDER_CONSTANT, value=255), 7, ["-c", "tessedit_char_whitelist=0123456789"]))
                    if k in OKEI: unit = OKEI[k]
        it = {"code": re.sub(r"\s", "", cell("code", 7)).strip("|_.,"), "name": re.sub(r"\s+", " ", name), "unit": unit, "qty": q, "qty_raw": qraw,
              "price": money(cell("price", 7)), "sum": money(cell("sum", 7)), "rate": cell("rate", 7).replace(" ", "")[:12], "total": money(cell("total", 7))}
        warn = []
        if q is None: warn.append("qty")
        if not unit: warn.append("unit")
        if it["price"] and q and it["sum"] and abs(it["price"] * q - it["sum"]) > max(1.0, it["sum"] * 0.02): warn.append("sum")
        it["warn"] = warn
        items.append(it)
    return {"cols": col, "heads": heads, "items": items, "totals": totals}

OKEI = {"796": "шт", "006": "м", "055": "м2", "113": "м3", "168": "т", "166": "кг", "112": "л", "839": "компл", "778": "упак", "715": "пар", "736": "рул", "163": "г", "625": "лист", "018": "пог.м", "704": "набор", "006": "м"}
KEYW = re.compile(r"передаточн|сч[её]т.{0,3}фактур|продавец|покупател|наименование|основание", re.I)
def main(path):
    t0 = time.time(); tmp = tempfile.mkdtemp(prefix="vsupd")
    try:
        with open(path, "rb") as f: magic = f.read(5)
        if magic.startswith(b"%PDF"):
            subprocess.run(["pdftoppm", "-r", "300", "-png", "-l", "6", path, os.path.join(tmp, "p")], check=True, timeout=120)
            pages = sorted(os.path.join(tmp, x) for x in os.listdir(tmp) if x.endswith(".png"))
        else: pages = [path]
        text_all, items, dbg, rot_prev, tbl_tot = "", [], [], None, {}
        for i, p in enumerate(pages):
            img = cv2.imread(p)
            if img is None: continue
            if max(img.shape[:2]) < 2400:
                k = 3000 / max(img.shape[:2]); img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
            img, skew = deskew(img)
            rot = osd_rotation(img)
            tries = ([rot_prev] if rot_prev is not None else []) + [rot] + [r for r in (0, 90, 270, 180) if r not in (rot, rot_prev)]
            best = None
            for r in tries:
                im = rotate(img, r)
                g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
                small = cv2.resize(g, None, fx=0.6, fy=0.6) if max(g.shape) > 3600 else g
                txt = tess(small, 6)
                score = len(KEYW.findall(txt)) * 10 + quality(txt) / 200
                if best is None or score > best[0]: best = (score, r, im, txt)
                if len(KEYW.findall(txt)) >= 2: break
            _, rot, im, _ = best; rot_prev = rot
              g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
            if not magic.startswith(b"%PDF"): g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)   # фото: выровнять освещение
            full = tess(g, 6, ["-c", "preserve_interword_spaces=1"])
            if os.environ.get("VS_OCR_DEBUG"): sys.stderr.write("PAGE %d rot %d\n%s\n" % (i + 1, rot, full[:3000]))
            text_all += "\n" + full
            tr = table_rows(im)
            if tr:
                for it in tr["items"]: it["page"] = i + 1; items.append(it)
                if tr.get("totals"): tbl_tot = tr["totals"]
            dbg.append({"rot": rot, "skew": skew, "cols": tr and tr["cols"], "heads": tr and [h[:40] for h in tr["heads"]]})
        h = header_fields(text_all)
        for k, v in tbl_tot.items():
            if v and not h.get(k): h[k] = v
        if items and h.get("total_nt") and sum((x.get("sum") or 0) for x in items):
            s = round(sum((x.get("sum") or 0) for x in items), 2); h["items_sum"] = s; h["sum_ok"] = abs(s - h["total_nt"]) < 1
        out({"header": h, "items": items, "pages": len(pages), "ms": int((time.time() - t0) * 1000), "debug": dbg})
    except Exception as e:
        out({"error": "Не удалось прочитать УПД: " + str(e)[:200]})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main(sys.argv[1])
          
