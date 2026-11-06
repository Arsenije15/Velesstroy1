#!/usr/bin/env python3
# VELESSTROY 1.4 — чтение «Заявки на выдачу ТМЦ» со скана (PDF / фото).
# Работает на сервере, без интернета: pdftoppm (poppler) + tesseract (rus) + OpenCV.
# Вывод: JSON {header:{number,date,object,recipient}, items:[...], pages, ms}
import sys, os, re, json, subprocess, tempfile, time, shutil

def out(o):
    sys.stdout.write(json.dumps(o, ensure_ascii=False)); sys.stdout.flush()

try:
    import cv2, numpy as np
except Exception as e:
    out({"error": "На сервере не установлено распознавание (OpenCV). Запустите install.sh ещё раз."}); sys.exit(0)
if not shutil.which("tesseract"):
    out({"error": "На сервере не установлен tesseract. Запустите install.sh ещё раз."}); sys.exit(0)

LANG = "rus+eng"

def tess(img, psm=6, extra=None):
    ok, buf = cv2.imencode(".png", img)
    cmd = ["tesseract", "stdin", "stdout", "-l", LANG, "--psm", str(psm)] + (extra or [])
    try:
        r = subprocess.run(cmd, input=buf.tobytes(), capture_output=True, timeout=40)
        return " ".join(r.stdout.decode("utf-8", "ignore").split())
    except Exception:
        return ""

def osd_rotation(img):
    # сколько градусов повернуть по часовой стрелке, чтобы текст встал прямо
    small = cv2.resize(img, None, fx=0.5, fy=0.5)
    ok, buf = cv2.imencode(".png", small)
    try:
        r = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "0"], input=buf.tobytes(), capture_output=True, timeout=40)
        m = re.search(r"Rotate:\s*(\d+)", r.stdout.decode("utf-8", "ignore"))
        return int(m.group(1)) if m else 0
    except Exception:
        return 0

def deskew(img):
    # фото с телефона: выровнять небольшой наклон (до ±7°) по длинным линиям таблицы
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    small = cv2.resize(g, None, fx=0.5, fy=0.5)
    ed = cv2.Canny(small, 50, 150)
    ls = cv2.HoughLinesP(ed, 1, np.pi / 720, threshold=200, minLineLength=small.shape[1] // 3, maxLineGap=20)
    if ls is None: return img, 0.0
    ang = []
    for x1, y1, x2, y2 in np.asarray(ls).reshape(-1, 4):
        a = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(a) < 7: ang.append(a)
    if len(ang) < 3: return img, 0.0
    a = float(np.median(ang))
    if abs(a) < 0.5: return img, 0.0
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), a, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)), round(a, 2)

def fix_codes(s):
    # «БП-ГЗ5» → «БП-Г35»: буква З рядом с цифрами — это тройка
    s = re.sub(r"(?<=[A-Za-zА-Яа-я\-])З(?=\d)", "3", s or "")
    return re.sub(r"(?<=\d)З", "3", s)

def rotate(img, deg):
    return {0: img, 90: cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE), 180: cv2.rotate(img, cv2.ROTATE_180),
            270: cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)}.get(deg, img)

def masks(g):
    bw = cv2.adaptiveThreshold(~g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -10)
    H, W = bw.shape
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, W // 30), 1))
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, H // 40)))
    return cv2.dilate(cv2.erode(bw, hk), hk), cv2.dilate(cv2.erode(bw, vk), vk)

def peaks(proj, minlen, gap=8):
    idx = np.where(proj > minlen)[0]; grp = []
    for i in idx:
        if grp and i - grp[-1][-1] <= gap: grp[-1].append(i)
        else: grp.append([i])
    return [int(np.mean(p)) for p in grp]

def lc(s): return (s or "").lower().replace("ё", "е")
def words(s): return re.findall(r"[A-Za-zА-Яа-яЁё]{3,}", s or "")
def quality(s):  # сколько «настоящих» слов — шум со скана даёт обрывки
    w = words(s); return sum(len(x) for x in w) - 3 * len(re.findall(r"[=_|~“”‘’`^<>]", s or ""))

def find_table(g):
    hor, ver = masks(g)
    H, W = g.shape
    xs = [x for x in peaks(ver.sum(0) / 255, H * 0.10) if 12 < x < W - 12]   # края кадра — не линии
    if len(xs) < 6: return None
    x0, x1 = xs[0], xs[-1]
    # горизонтальные линии внутри ширины таблицы
    band = hor[:, x0:x1]
    ys = peaks(band.sum(1) / 255, (x1 - x0) * 0.25)
    # вертикальные линии: где по высоте они есть (граница таблицы)
    vv = ver[:, x0:x1].sum(1) / 255
    rows_with_v = np.where(vv > 255 * 0 + 3)[0]
    if not len(rows_with_v) or len(ys) < 4: return None
    top, bot = int(rows_with_v.min()), int(rows_with_v.max())
    ys = [y for y in ys if top - 15 <= y <= bot + 15]
    return {"xs": xs, "ys": ys, "top": top, "bot": bot, "hor": hor, "ver": ver}

KEYS = [("n", ["п/п", "n/п", "№ п", "№п"]), ("rd", ["закупк", "pid", "рид"]), ("project", ["проектн"]),
        ("name1c", ["1с", "1c", "складск"]), ("objcode", ["подобъект", "объект"]),
        ("unit", ["единиц"]), ("qty", ["количеств"]), ("supplier", ["контраг", "котраг", "контрагент"]),
        ("docdate", ["дата"]), ("docno", [])]
TEMPLATE = ["n", "rd", "project", "name1c", "objcode", "unit", "qty", "supplier", "docno", "docdate"]

def map_columns(clean, xs, y_from, y_to):
    heads = []
    for j in range(len(xs) - 1):
        c = clean[max(0, y_from):y_to, xs[j] + 4:xs[j + 1] - 4]
        heads.append(lc(tess(c, 6)) if c.size and c.shape[1] > 15 else "")
    col = {}
    for j, h in enumerate(heads):
        for key, words in KEYS:
            if key in col or not words: continue
            if key in ("unit", "qty") and "qty" in col and key == "unit": continue
            if any(w in h for w in words):
                # «единица/количество» второй раз — это «выдано фактически», не берём
                col[key] = j; break
    # № документа — колонка между контрагентом и датой
    if "supplier" in col and "docdate" in col and col["docdate"] - col["supplier"] == 2: col["docno"] = col["supplier"] + 1
    # запасной вариант: стандартный порядок формы
    ok = all(k in col for k in ("project", "unit", "qty"))
    if not ok:
        n = len(xs) - 1
        start = 1 if n >= 14 and len(heads[0]) == 0 else 0
        col = {k: start + i for i, k in enumerate(TEMPLATE) if start + i < n}
    return col, heads

def num(s):
    t = (s or "").replace(" ", "").replace(" ", "")
    t = re.sub(r"[^0-9.,]", "", t)
    if not t: return None
    if "," in t and "." in t: t = t.replace(",", "") if t.rfind(".") > t.rfind(",") else t.replace(".", "").replace(",", ".")
    elif "," in t: t = t.replace(",", ".")
    try:
        v = float(t)
        return round(v, 3)
    except Exception:
        return None

def split_supply(t):
    t = re.sub(r"\s+", " ", (t or "")).strip(" |_—-")
    toks = t.split(" "); sup = []
    for i, w in enumerate(toks):
        if re.fullmatch(r"(000|ООО|OOO|0О0)[,.]?", w): sup.append("ООО"); continue
        if re.search(r"\d", w): return " ".join(sup).strip(" ,.|"), " ".join(toks[i:]).strip(" |")
        sup.append(w)
    return " ".join(sup).strip(" ,.|"), ""

def clean_doc(d):
    d = re.sub(r"\s*[|\]\[)(]\s*", "", d or "")
    d = re.sub(r"^\d{1,2}\s+(?=[A-Za-zА-Яа-я])", "", d.strip())
    d = re.sub(r"[\s.,:;'_\-]+$", "", d)
    d = re.sub(r"\b[oо][тt]\b", "от", d, flags=re.I)
    m = re.search(r"(\d{1,2})[.,](\d{1,2})[.,](20\d{2}|\d{2})", d)
    if m and " от " not in d and not d.startswith("от"):
        d = d[:m.start()].strip() + " от " + d[m.start():]
    return re.sub(r"\s+", " ", d).strip()

def header_fields(text):
    t = re.sub(r"[ \t]+", " ", text)
    h = {}
    m = re.search(r"заявк[аи]\s+на\s+выдачу\s+тмц\D{0,20}?(\d{3,7})", t, re.I)
    if m: h["number"] = m.group(1)
    for m in re.finditer(r"\b(\d{2})[.,](\d{2})[.,](20\d{2})", t):
        if "приказ" in t[max(0, m.start() - 40):m.start()].lower(): continue
        h["date"] = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1)); break
    m = re.search(r"\b(ОП\s*[\"«“][^\"»”\n]{3,60}[\"»”])", t)
    if m: h["object"] = m.group(1).replace("«", "\"").replace("»", "\"").replace("“", "\"").replace("”", "\"")
    m = re.search(r"\bМОЛ\b\s*(.{5,200})", t)
    if m:
        r = re.split(r"Должност|по договору|\d{2}[.,]\d{2}[.,]\d{4}", m.group(1))[0]
        r = " ".join(w for w in r.split() if re.fullmatch(r"[«»\"A-Za-zА-Яа-яЁё.\-]{2,}", w))
        if len(r) >= 5: h["recipient"] = r.strip(" .")
    # «Со склада … для …»
    LATC = {"A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "T": "Т", "X": "Х", "Y": "У"}
    def fixo(v):
        v = re.sub(r"\b(OOO|000|0OO|O0O)\b", "ООО", v).replace("Велссстрой", "Велесстрой")
        w = [x for x in v.split() if re.search(r"[А-Яа-яA-Za-z0-9]{2,}", x) or x in ("«", "»", "\"")]
        while w and len(re.sub(r"[^А-Яа-яA-Za-z]", "", w[0])) < 2: w.pop(0)
        return " ".join(w).strip(" =.,:;_|«-")
    m = re.search(r"склада\s+(.{4,80}?)\s+для\s+(.{3,80}?)\s+Наименование склада", t, re.I)
    if m:
        fw = fixo(re.sub(r"^[^А-Яа-яA-Za-z\"«]+", "", m.group(1)).strip())
        to = fixo(re.sub(r"^[^А-Яа-яA-Za-z\"«]+", "", m.group(2)).strip())
        if len(fw) >= 4: h["from_wh"] = fw
        if len(to) >= 3 and re.search(r"[А-Яа-я]{3}", to): h["to_org"] = to
    m = re.search(r"договору\s*№\s*[,.]?\s*([^\s,]{2,40})", t)
    if m and re.search(r"\d", m.group(1)): h["contract_no"] = re.sub(r"[ABCEHKMOPTXY]", lambda c: LATC[c.group(0)], m.group(1).strip(" ,."))
    m = re.search(r"договору\s*№.{0,45}?[оo][тtr]\s*[\"“«]?\s*(\d{1,2})\s*[\"”»]?\s*([А-Яа-я]{3,9}|\d{2})\s*(20\d{2})", t)
    if m: h["contract_date"] = "«%s» %s %s" % (m.group(1).zfill(2), m.group(2), m.group(3))
    m = re.search(r"доверенности\s*№\s*(\d{1,10})\s*[оo][тt]\s*[\"“«]?\s*(\d{1,2})\s*[\"”»]?\s*([А-Яа-я]{3,9}|\d{2})\s*(20\d{2})", t)
    if m: h["poa_no"] = m.group(1); h["poa_date"] = "«%s» %s %s" % (m.group(2).zfill(2), m.group(3).replace("апоеля", "апреля"), m.group(4))
    m = re.search(r"вида\s+ТМЦ:?\s*_?\s*([А-Яа-я]{4,12})", t, re.I)
    if m:
        k = m.group(1).lower()
        h["tmc_kind"] = "непроектные" if k.startswith("непро") else "проектные" if k.startswith("про") else k
    return h

def page_rows(img, first, prev=None):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    tb = find_table(g)
    if not tb: return None, [], {}
    hor, ver = tb["hor"], tb["ver"]
    lines = cv2.dilate(cv2.bitwise_or(hor, ver), np.ones((5, 5), np.uint8))
    clean = g.copy(); clean[lines > 0] = 255
    ys, xs = tb["ys"], tb["xs"]
    bands = [(ys[i], ys[i + 1]) for i in range(len(ys) - 1)]
    start = None
    for i, (a, b) in enumerate(bands):
        if b - a >= 80 and i > 0 and bands[i - 1][1] - bands[i - 1][0] < 65:
            start = i; break
    if start is None: start = 0
    head_from = max(tb["top"], bands[start][0] - 420)
    head_to = bands[start - 1][0] if start > 0 else bands[start][0]
    # «Заявитель / ОМТС / Склад» и строка номеров — тонкие, их пропускаем
    while start > 1 and bands[start - 1][1] - bands[start - 1][0] < 65 and head_to > head_from + 60 and bands[start - 2][1] - bands[start - 2][0] < 65:
        head_to = bands[start - 2][0]; break
    col, heads = map_columns(clean, xs, head_from, head_to)
    found = sum(1 for k in ("project", "unit", "qty", "supplier") if any(w in " ".join(heads) for w in dict(KEYS)[k]))
    x0, x1 = xs[0], xs[-1]
    centers = [((xs[j] + xs[j + 1]) / 2 - x0) / max(1, x1 - x0) for j in range(len(xs) - 1)]
    cont = False
    if found < 2:
        # продолжение таблицы на следующей странице (без шапки): колонки — как на прошлой странице
        if not prev or abs(len(xs) - prev["n"]) > 1: return None, [], {"heads": heads, "nohead": True}
        col = {}
        for k, rc in prev["ratios"].items():
            j = min(range(len(centers)), key=lambda q: abs(centers[q] - rc))
            if abs(centers[j] - rc) > 0.035: return None, [], {"heads": heads, "nohead": True}
            col[k] = j
        cont = True; start = 0
        while start < len(bands) and bands[start][1] - bands[start][0] < 65: start += 1  # строка номеров колонок, если повторена
    header = {}
    if first and not cont:
        top_area = clean[:max(50, tb["top"] - 5), :]
        header = header_fields(tess(top_area, 6, ["-c", "preserve_interword_spaces=1"]))
    items = []
    for a, b in bands[start:]:
        if b - a < 50: continue
        def cell(key, psm=6, extra=None, zoom=1):
            j = col.get(key)
            if j is None or j >= len(xs) - 1: return ""
            c = clean[a + 5:b - 5, xs[j] + 5:xs[j + 1] - 5]
            if not c.size: return ""
            if zoom > 1:  # короткий текст (ед. изм.) — увеличить и добавить поля
                c = cv2.copyMakeBorder(cv2.resize(c, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC), 30, 30, 30, 30, cv2.BORDER_CONSTANT, value=255)
            return tess(c, psm, extra)
        it = {"project": cell("project"), "name1c": cell("name1c"), "rd": cell("rd"), "unit": cell("unit"),
              "objcode": cell("objcode")}
        if not re.search(r"[A-Za-zА-Яа-я]", it["unit"]): it["unit"] = cell("unit", 7, None, 2) or cell("unit", 10, None, 2) or cell("unit", 8)
        qraw = cell("qty")
        if num(qraw) is None: qraw = cell("qty", 7) or cell("qty", 8, ["-c", "tessedit_char_whitelist=0123456789,. "])
        it["qty_raw"] = qraw; it["qty"] = num(qraw)
        # поставщик + № + дата — одной полосой (печатный текст часто заходит на линию)
        js = [col[k] for k in ("supplier", "docno", "docdate") if k in col]
        sup_txt = ""
        if js:
            x_a, x_b = xs[min(js)] + 5, xs[min(max(js) + 1, len(xs) - 1)] - 5
            sup_txt = tess(clean[a + 5:b - 5, x_a:x_b], 6)
        it["supplier"], doc = split_supply(sup_txt)
        it["supplier"] = re.sub(r"[^A-Za-zА-Яа-яЁё0-9\"«» ]+$", "", it["supplier"]).strip()
        it["supply_doc"] = clean_doc(doc)
        m = re.search(r"\d{2}\s*-\s*\d{3,}[0-9A-Za-zА-Яа-я]?", it["rd"])
        it["rd"] = re.sub(r"\s", "", m.group(0)) if m else ""
        it["unit"] = re.sub(r"[^A-Za-zА-Яа-я0-9²³.]", "", it["unit"]).lower()[:8]
        q1, qp = quality(it["name1c"]), quality(it["project"])
        use1c = len(words(it["name1c"])) >= 2 and q1 >= 8
        mat = it["name1c"] if use1c else it["project"]
        if use1c and len(words(it["project"])) >= 2 and qp >= 8 and it["project"] != it["name1c"]: it["alt"] = it["project"]
        if not use1c and len(words(it["project"])) < 2: mat = it["name1c"] if q1 > qp else it["project"]
        # шум со скана в пустых колонках не переносим
        if not (len(words(it["name1c"])) >= 2 and q1 >= 8): it["name1c"] = ""
        if not (len(words(it["project"])) >= 2 and qp >= 8): it["project"] = ""
        it["name1c"], it["project"] = fix_codes(it["name1c"].strip(" |_:;")), fix_codes(it["project"].strip(" |_:;"))
        if not re.search(r"\d", it["objcode"]) or len(it["objcode"]) < 5: it["objcode"] = ""
        it["material"] = fix_codes(re.sub(r"\s*[|:;]\s*$", "", mat).strip(" |_:;"))
        if it.get("alt"): it["alt"] = fix_codes(it["alt"])
        # пустая строка / подписи под таблицей
        if len(it["material"]) < 3 and it["qty"] is None: continue
        if re.search(r"пто|оот|подпис|должност", lc(it["material"])) and it["qty"] is None: continue
        warn = []
        if it["qty"] is None: warn.append("qty")
        if len(it["material"]) < 5: warn.append("material")
        if not it["unit"]: warn.append("unit")
        if it["supply_doc"] and len(re.sub(r"\D", "", it["supply_doc"])) < 6: warn.append("supply_doc")
        it["warn"] = warn
        items.append(it)
    ratios = {k: centers[j] for k, j in col.items() if j < len(centers)}
    return header, items, {"cols": col, "heads": heads, "cont": cont, "n": len(xs), "ratios": ratios}

UNITS = ["т", "кг", "м", "м2", "м3", "шт", "л", "компл", "упак", "пог.м", "рул", "меш", "лист", "пара", "уп"]
def fix_units(items):
    seen = [i["unit"] for i in items if i["unit"] in UNITS]
    for it in items:
        u = it["unit"].replace("м²", "м2").replace("м³", "м3").strip(".")
        if u in UNITS: it["unit"] = u; continue
        cand = [x for x in UNITS if u and x.startswith(u)]
        best = sorted(cand, key=lambda x: -seen.count(x))
        if best and (seen.count(best[0]) > 0 or (len(cand) == 1 and len(u) >= 2)):
            it["unit"] = best[0]; it["warn"].append("unit")
        else:
            # не прочиталось — берём единицу, которая преобладает в этой заявке (и подсвечиваем)
            top = max(set(seen), key=seen.count) if seen else ""
            it["unit"] = top if top and seen.count(top) >= 0.6 * len(items) else ""
            it["warn"] = [w for w in it["warn"] if w != "unit"] + ["unit"]
def check_doc(it):
    for m in re.finditer(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", it["supply_doc"] or ""):
        if not (1 <= int(m.group(1)) <= 31 and 1 <= int(m.group(2)) <= 12): it["warn"].append("supply_doc")
    it["supplier"] = re.sub(r"(\s+\S{1,2})+$", lambda m: m.group(0) if re.fullmatch(r"\s+(ООО|АО|ИП)", m.group(0)) else "", it["supplier"]).strip(" +-=")

def main(path):
    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix="vsocr")
    try:
        pages = []
        low = path.lower()
        with open(path, "rb") as f: magic = f.read(5)
        if magic.startswith(b"%PDF"):
            subprocess.run(["pdftoppm", "-r", "300", "-png", "-l", "6", path, os.path.join(tmp, "p")], check=True, timeout=120)
            pages = sorted(os.path.join(tmp, x) for x in os.listdir(tmp) if x.endswith(".png"))
        else:
            pages = [path]
        header, items, dbg = {}, [], []
        prev, prev_rot = None, None
        for i, p in enumerate(pages):
            img = cv2.imread(p)
            if img is None: continue
            if max(img.shape[:2]) < 2400:  # маленькое фото — увеличим
                k = 3000 / max(img.shape[:2]); img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
            img, skew = deskew(img)
            rot = osd_rotation(img)
            tries = ([prev_rot] if prev_rot is not None else []) + [rot] + [r for r in (0, 90, 270, 180) if r != rot and r != prev_rot]
            for r in tries:
                h, its, d = page_rows(rotate(img, r), not header, prev)
                if not d.get("nohead") and d.get("cols"): rot = r; break
            else:
                h, its, d = {}, [], {}
            if d.get("cols") and not d.get("cont"): prev, prev_rot = {"n": d["n"], "ratios": d["ratios"]}, rot
            elif d.get("cols"): prev_rot = rot
            for it in its: it["page"] = i + 1
            if h: header = h
            for it in its: items.append(it)
            d["rot"] = rot; d["skew"] = skew; d.pop("ratios", None); dbg.append(d)
        fix_units(items)
        for it in items: check_doc(it)
        out({"header": header, "items": items, "pages": len(pages), "ms": int((time.time() - t0) * 1000), "debug": dbg})
    except Exception as e:
        out({"error": "Не удалось прочитать файл: " + str(e)[:200]})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main(sys.argv[1])
      
