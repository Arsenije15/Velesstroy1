#!/usr/bin/env python3
# VELESSTROY 1.9.4 — чтение УПД (счёт-фактура / универсальный передаточный документ) со скана или фото.
# Читаем только нужное: № УПД, дату, продавца (поставщика), наименование и количество (+ ед. изм.).
# Все страницы документа (до 80): листы-продолжения без шапки таблицы читаются по колонкам первого листа.
# Проверки точности: сквозная нумерация «№ п/п» (нет пропусков и повторов), цена × кол-во = стоимость
# (цена и стоимость читаются только для проверки и в программу не передаются).
import sys, os, re, json, subprocess, tempfile, time, shutil
def out(o):
    sys.stdout.write(json.dumps(o, ensure_ascii=False)); sys.stdout.flush()
try:
    import cv2, numpy as np
except Exception as e:   # нет OpenCV на сервере — понятная ошибка вместо «exit status 1»
    out({"error": "На сервере не установлен OpenCV для распознавания (" + str(e)[:120] + "). Запустите install.sh ещё раз."}); sys.exit(0)
if not shutil.which("tesseract"):
    out({"error": "На сервере не установлен tesseract. Запустите install.sh ещё раз."}); sys.exit(0)
LANG = "rus+eng"
MAX_PAGES = 80
os.environ.setdefault("OMP_THREAD_LIMIT", "1")   # tesseract: один поток — на сервере с 1 ядром быстрее
PROG = os.environ.get("VS_OCR_PROGRESS", "")
def progress(i, n):
    if not PROG: return
    try:
        with open(PROG, "w") as f: f.write("%d/%d" % (i, n))
    except Exception: pass
DIG = ["-c", "tessedit_char_whitelist=0123456789,.- "]

# ---------- tesseract ----------
def _png(img):
    ok, buf = cv2.imencode(".png", img); return buf.tobytes()

def tess(img, psm=6, extra=None):
    cmd = ["tesseract", "stdin", "stdout", "-l", LANG, "--psm", str(psm)] + (extra or [])
    try:
        r = subprocess.run(cmd, input=_png(img), capture_output=True, timeout=60)
        return " ".join(r.stdout.decode("utf-8", "ignore").split())
    except Exception:
        return ""

def tess_words(img, psm=6, extra=None, lang=LANG):
    # слова с координатами (TSV): [(x, y, w, h, text, conf)]
    cmd = ["tesseract", "stdin", "stdout", "-l", lang, "--psm", str(psm)] + (extra or []) + ["tsv"]
    try:
        r = subprocess.run(cmd, input=_png(img), capture_output=True, timeout=90)
    except Exception:
        return []
    res = []
    for ln in r.stdout.decode("utf-8", "ignore").splitlines()[1:]:
        p = ln.split("\t")
        if len(p) < 12 or not p[11].strip(): continue
        try: res.append((int(p[6]), int(p[7]), int(p[8]), int(p[9]), p[11].strip(), float(p[10])))
        except Exception: pass
    return res

def osd_rotation(img):
    small = cv2.resize(img, None, fx=0.5, fy=0.5)
    try:
        r = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "0"], input=_png(small), capture_output=True, timeout=40)
        m = re.search(r"Rotate:\s*(\d+)", r.stdout.decode("utf-8", "ignore"))
        return int(m.group(1)) if m else 0
    except Exception:
        return 0

def deskew(img):
    # выровнять небольшой наклон (до ±7°) по длинным линиям таблицы
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
    if abs(a) < 0.3: return img, 0.0
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), a, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)), round(a, 2)

def rotate(img, deg):
    return {0: img, 90: cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE), 180: cv2.rotate(img, cv2.ROTATE_180),
            270: cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)}.get(deg, img)

# ---------- текст ----------
def lc(s): return (s or "").lower().replace("ё", "е")
def words(s): return re.findall(r"[A-Za-zА-Яа-яЁё]{3,}", s or "")
def quality(s):
    w = words(s); return sum(len(x) for x in w) - 3 * len(re.findall(r"[=_|~“”‘’`^<>]", s or ""))

def num(s):
    t = (s or "").replace(" ", "").replace(" ", "")
    t = re.sub(r"[^0-9.,]", "", t)
    if not t: return None
    if "," in t and "." in t: t = t.replace(".", "").replace(",", ".") if t.rfind(",") > t.rfind(".") else t.replace(",", "")
    elif "," in t:
        if t.count(",") > 1: t = t.replace(",", "", t.count(",") - 1)
        t = t.replace(",", ".")
    elif t.count(".") > 1: t = t.replace(".", "", t.count(".") - 1)
    try: return round(float(t), 3)
    except Exception: return None

def money(s):
    # денежные суммы в УПД всегда с копейками: «1 07370» (запятая потерялась) → 1073.70
    t = re.sub(r"[^0-9.,]", "", (s or "").replace(" ", "").replace(" ", ""))
    if not t: return None
    if "," not in t and "." not in t and len(t) >= 3: t = t[:-2] + "." + t[-2:]
    return num(t)

def fix_codes(s):
    s = re.sub(r"(?<=[A-Za-zА-Яа-я\-])З(?=\d)", "3", s or "")
    return re.sub(r"(?<=\d)З", "3", s)

def fix_name(s):
    s = fix_codes(s)
    s = re.sub(r"(?<=\d)\s*[xх×X]\s*(?=\d)", "х", s)              # 57x3,5 / 57 х 3,5 → 57х3,5 (русская «х», как в ГОСТ)
    # размеры по ГОСТ: после запятой одна цифра. «26, 9х3» / «х3, 2-21» / «-33, 7х3» — пробел лишний (скан), «90, 57х3» — нет
    s = re.sub(r"(?<=\d),\s(\d)(?=[х\-])", r",\1", s)
    s = re.sub(r"(?<=[х\-])(\d+),\s(\d)(?=\D)", r"\1,\2", s)
    s = re.sub(r"(?<![\d,])(\d{1,3},\d)(\d{1,2},\d)(?=[\-\s,]|$)", r"\1х\2", s)   # «26,93,2» — потерялась «х»: 26,9х3,2
    s = re.sub(r"(?<=\d),(?=\d{2,}х)", ", ", s)          # «Отвод 45,57х3,5» (фото) — после запятой 2+ цифры: это не дробь, а следующий размер
    s = re.sub(r"(?<![A-Za-zА-Яа-я])cr\.(?=\s*\d)", "ст.", s)   # «cr. 20» (латиница на фото) → «ст. 20»
    s = re.sub(r"\s+([,.;:)])", r"\1", s)
    s = re.sub(r"([(])\s+", r"\1", s)
    s = re.sub(r"\s{2,}", " ", s)
    if s.count("(") > s.count(")") and re.search(r"[\\|\]1l]$", s): s = s[:-1] + ")"   # «(нерж.сталь\» → «(нерж.сталь)»
    return s.strip(" |_:;—-")

MONTHS = {"январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6, "июл": 7, "август": 8, "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12}
def month_of(w):
    w = lc(w)
    for k in sorted(MONTHS, key=len, reverse=True):
        if w.startswith(k): return MONTHS[k]
    return None

def fix_digits(s):
    return (s or "").translate(str.maketrans({"O": "0", "О": "0", "o": "0", "о": "0", "З": "3", "з": "3", "l": "1", "I": "1", "|": "1", "S": "5", "Б": "6", "B": "8"}))

def clean_org(v):
    v = re.sub(r"(^|\s)[0OО]{3}(?=\s|[\"«“„])", r"\1ООО", v or "")
    v = v.replace("“", "\"").replace("”", "\"").replace("„", "\"").replace("«", "\"").replace("»", "\"").replace("''", "\"")
    v = re.sub(r"\s+", " ", v).strip(" .,:;|_-")
    m = re.match(r"(.*?\"[^\"]{2,80}\")", v)
    v = m.group(1) if m else v[:120]
    # 1.9.6: название в кавычках прочитано латиницей («KPENTOHH») — это русские буквы-двойники
    def cyr(mm):
        w = mm.group(1)
        if re.search(r"[А-Яа-я]", w) or not re.search(r"[A-Z]{3}", w): return mm.group(0)
        t = w.translate(str.maketrans("ABCEHKMOPTXYN", "АВСЕНКМОРТХУП"))
        return mm.group(0) if re.search(r"[A-Za-z]", t) else '"' + t + '"'
    return re.sub(r'"([^"]{3,80})"', cyr, v)

def header_fields(t):
    t = re.sub(r"[ \t]+", " ", t)
    h, votes = {}, {}
    # «Счет-фактура № 6232 от 2 ноября 2026 г.», «Универсальный передаточный документ, № 6232 от 02.11.2026»
    pat = r"№\s*([A-Za-zА-Яа-я]{0,4}[\-–—]?\s?\d[\w\-/]{0,15})\s*(?:о[тг]|oт|ot|ст|c[тt]|or)\s*[\"«“]?(\d{1,2})[\"»”]?\s*[.\s]?\s*([А-Яа-яё]{3,9}|\d{1,2})[.\s]+(\d{4})"
    for ctx in re.finditer(r"(Сч[её]т[\s\-]*фактур\S*|передаточн\S*\s+документ\S*|Документ\s+об\s+отгруз\S*)[^№]{0,60}" + pat, t, re.I):
        no = re.sub(r"\s", "", ctx.group(2)).replace("–", "-").replace("—", "-")
        no = re.sub(r"^([A-Za-zА-Яа-я]+)(\d)", r"\1-\2", no) if re.match(r"^[А-ЯA-Z]{1,4}\d", no) else no
        mo = month_of(ctx.group(4)) if not ctx.group(4).isdigit() else int(ctx.group(4))
        try: d, y = int(ctx.group(3)), int(fix_digits(ctx.group(5)))
        except Exception: continue
        if not mo or not (1 <= mo <= 12) or not (1 <= d <= 31) or not (2015 <= y <= 2040): continue
        key = (no.upper(), "%04d-%02d-%02d" % (y, mo, d))
        votes[key] = votes.get(key, 0) + (2 if ctx.group(1).lower().startswith("сч") else 1)
    if votes:
        (no, dt), _ = max(votes.items(), key=lambda kv: kv[1])
        h["number"], h["date"] = no, dt
    else:
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
    h["buyer_ok"] = bool(re.search(r"велесстр", lc(t)))
    return h

# ---------- таблица ----------
def masks(g):
    bw = cv2.adaptiveThreshold(~g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -10)
    H, W = bw.shape
    hk = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, W // 30), 1))
    vk = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, H // 60)))
    return cv2.dilate(cv2.erode(bw, hk), hk), cv2.dilate(cv2.erode(bw, vk), vk)

def peaks(proj, minlen, gap=8):
    idx = np.where(proj > minlen)[0]; grp = []
    for i in idx:
        if grp and i - grp[-1][-1] <= gap: grp[-1].append(i)
        else: grp.append([i])
    return [int(np.mean(p)) for p in grp]

def find_table(g):
    for th in (0.35, 0.2):   # 1.9.6: скан с бледными/рваными линиями (УПД № 925) — второй проход с мягким порогом
        t = _find_table(g, th)
        if t: return t
    return None

def _find_table(g, th):
    hor, ver = masks(g)
    H, W = g.shape
    if th < 0.3:   # сшиваем разрывы в линиях скана
        hor = cv2.morphologyEx(hor, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (max(15, W // 50), 1)))
        ver = cv2.morphologyEx(ver, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(15, H // 80))))
    # вертикальные линии: на листе-продолжении таблица низкая (3 строки) — порог от высоты самой таблицы
    hp = hor.sum(1) / 255
    ys_all = peaks(hp, W * th)
    if len(ys_all) < 2: return None
    # 1.9.5: таблица — самый высокий участок между горизонтальными линиями, где ≥6 вертикальных линий.
    # На последнем листе под короткой таблицей идут линии подписей — раньше из-за них лист не читался (терялась строка 301).
    best = None
    cs = np.vstack([np.zeros((1, W), np.int32), np.cumsum((ver > 0).astype(np.int32), axis=0)])   # суммы по столбцам — быстро для любой пары линий
    for i0 in range(len(ys_all) - 1):
        for i1 in range(len(ys_all) - 1, i0, -1):
            top0, bot0 = ys_all[i0], ys_all[i1]
            if bot0 - top0 < 40: break
            vp = (cs[bot0 + 1] - cs[top0]).astype(np.float64)
            xs = [x for x in peaks(vp, (bot0 - top0) * 0.5) if 12 < x < W - 12]
            # больше вертикальных линий важнее высоты: под таблицей линии подписей «съедают» внутренние колонки
            if len(xs) >= 6 and (best is None or (len(xs), bot0 - top0) > (len(best[2]), best[1] - best[0])): best = (top0, bot0, xs)
    if not best: return None
    top0, bot0, xs = best
    x0, x1 = xs[0], xs[-1]
    ys = peaks(hor[:, x0:x1].sum(1) / 255, (x1 - x0) * (0.35 if th >= 0.3 else 0.3))
    ys = [y for y in ys if top0 - 5 <= y <= bot0 + 5]
    # нижняя линия «Всего к оплате» часто короче (объединённые ячейки) — край таблицы берём по вертикальным линиям
    if ys and bot0 > ys[-1] + 15: ys.append(bot0)
    for y in ys_all:   # строка «Всего к оплате» под таблицей: линия ниже на 1 строку, хотя бы на 20 % ширины
        if ys and ys[-1] + 15 < y <= ys[-1] + 90 and (hor[max(0, y - 3):y + 4, x0:x1].max(0) > 0).mean() >= 0.2: ys.append(y)
    if ys and top0 < ys[0] - 15: ys.insert(0, top0)
    if len(ys) < 2: return None
    return {"xs": xs, "ys": ys, "top": ys[0], "bot": ys[-1], "hor": hor, "ver": ver, "W": W}

KEYS = [("name", ["наименование товара", "наименован", "описание выполн"]), ("code", ["код товара", "работ, услуг"]),
        ("unit", ["условное", "обозна", "нацио"]), ("qty", ["коли", "(объем)"]), ("price", ["цена", "тариф"]),
        ("sum", ["без налога", "без нало"]), ("no", ["п/п", "n/n", "п/n", "n/п"])]
NUMROW = {"А": "code", "A": "code", "1а": "name", "1a": "name", "2а": "unit", "2a": "unit", "3": "qty", "4": "price", "5": "sum"}

def cell_img(clean, a, b, x0, x1, zoom=1):
    c = clean[a + 3:b - 2, x0 + 4:x1 - 3]
    if not c.size: return c
    if zoom > 1: c = cv2.resize(c, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC)
    return cv2.copyMakeBorder(c, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)

def map_header(clean, xs, bands):
    # строка номеров колонок «А 1 1а 1б 2 2а 3 4 5 …» — узкая; над ней шапка с названиями
    numrow = None
    for i, (a, b) in enumerate(bands[:12]):
        if b - a > 90 or b - a < 15: continue
        txt = [tess(cell_img(clean, a, b, xs[j], xs[j + 1], 2), 7) if xs[j + 1] - xs[j] > 10 else "" for j in range(len(xs) - 1)]
        hits = sum(1 for x in txt if x.strip() in NUMROW or x.strip() in ("1", "2", "6", "7", "8", "9", "10", "11", "1б", "1b", "10а"))
        if hits >= 6: numrow = (i, [x.strip() for x in txt]); break
    if numrow is None: return None, None
    hb = [k for k in range(numrow[0]) if bands[k][1] - bands[k][0] > 40]
    a = bands[hb[0]][0] if hb else max(0, bands[numrow[0]][0] - 500)
    b = bands[numrow[0]][0]
    heads = []
    for j in range(len(xs) - 1):
        c = clean[a + 3:b - 3, xs[j] + 3:xs[j + 1] - 3]
        heads.append(lc(tess(c, 6)) if c.size and c.shape[1] > 12 else "")
    col = {}
    for j, x in enumerate(numrow[1]):
        k = NUMROW.get(x)
        if k and k not in col: col[k] = j
    for key, ws in KEYS:
        if key in col: continue
        for j, h in enumerate(heads):
            if j in col.values(): continue
            if any(w in h for w in ws): col[key] = j; break
    if "name" in col and "no" not in col and col["name"] > 0:
        j = col["name"] - 1   # «№ п/п» — узкая колонка сразу слева от наименования
        if j not in col.values() and (xs[j + 1] - xs[j]) < 0.05 * (xs[-1] - xs[0]): col["no"] = j
    return col, numrow[0]

def words_in(ws, x0, x1, y0, y1):
    return [w for w in ws if x0 <= w[0] + w[2] / 2 <= x1 and y0 <= w[1] + w[3] / 2 <= y1]

def join_words(ws):
    # слова ячейки → строки → текст; «57х3,» + «5» с маленьким зазором — одно слово
    if not ws: return ""
    ws = sorted(ws, key=lambda w: (w[1] + w[3] / 2))
    lines = []
    for w in ws:
        cy = w[1] + w[3] / 2
        if lines and abs(cy - lines[-1][0]) < max(10, w[3] * 0.6): lines[-1][1].append(w)
        else: lines.append([cy, [w]])
    out = []
    for _, L in lines:
        L.sort(key=lambda w: w[0]); s = ""
        for i, w in enumerate(L):
            if i:
                p = L[i - 1]; gap = w[0] - (p[0] + p[2]); hgt = max(p[3], w[3], 10)
                glue = gap < hgt * 0.3 and re.search(r"\d[,.]$", p[4]) and re.match(r"^\d", w[4])
                s += "" if glue else " "
            s += w[4]
        out.append(s)
    return " ".join(out)

def strip_words(clean, x0, x1, y0, y1, extra=None, psm=6, zoom=1):
    c = clean[y0:y1, x0 + 4:x1 - 3]
    if not c.size: return []
    if zoom > 1: c = cv2.resize(c, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC)
    c = cv2.copyMakeBorder(c, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
    ws = tess_words(c, psm, extra)
    return [((w[0] - 20) / zoom + x0 + 4, (w[1] - 20) / zoom + y0, w[2] / zoom, w[3] / zoom, w[4], w[5]) for w in ws]

UM = {"wt": "шт", "uit": "шт", "lut": "шт", "шг": "шт", "ш": "шт", "шт.": "шт", "kr": "кг", "m": "м", "m2": "м2", "м?": "м2", "mm": "м", "n": "м", "nm": "м", "t": "т", "kг": "кг"}
OKEI = {"796": "шт", "006": "м", "055": "м2", "113": "м3", "168": "т", "166": "кг", "112": "л", "839": "компл", "778": "упак", "715": "пар", "736": "рул", "163": "г", "625": "лист", "018": "пог.м", "704": "набор"}

def table_rows(g, tb, tpl):
    # tpl — колонки первого листа: следующие листы (с шапкой и без) читаются по ним, шапку заново не распознаём
    if not tb: return None
    xs, ys = tb["xs"], tb["ys"]
    lines = cv2.dilate(cv2.bitwise_or(tb["hor"], tb["ver"]), np.ones((5, 5), np.uint8))
    clean = g.copy(); clean[lines > 0] = 255
    bands = [(ys[i], ys[i + 1]) for i in range(len(ys) - 1) if ys[i + 1] - ys[i] >= 15]
    if not bands: return None
    col, hdr = (None, None) if tpl and len(xs) == tpl["n"] else map_header(clean, xs, bands)
    if col and "name" in col and "qty" in col:
        width = float(xs[-1] - xs[0])
        tpl_new = {"col": col, "rel": [(x - xs[0]) / width for x in xs], "n": len(xs)}
        start = hdr + 1
    elif tpl:
        tpl_new = tpl; start = 0
        if len(xs) == tpl["n"]: col = dict(tpl["col"])
        else:   # линий другое число — колонки по положению относительно ширины таблицы
            width = float(xs[-1] - xs[0]); rel = [(x - xs[0]) / width for x in xs]; col = {}
            for k, j in tpl["col"].items():
                c0 = (tpl["rel"][j] + tpl["rel"][j + 1]) / 2
                jj = min(range(len(xs) - 1), key=lambda q: abs((rel[q] + rel[q + 1]) / 2 - c0))
                col[k] = jj
    else:
        return {"items": [], "tpl": None, "cols": col}
    data = bands[start:]
    if not data: return {"items": [], "tpl": tpl_new, "cols": col}
    y0, y1 = data[0][0], data[-1][1]
    W = {}
    W["name"] = strip_words(clean, xs[col["name"]], xs[col["name"] + 1], y0, y1)
    W["qty"] = strip_words(clean, xs[col["qty"]], xs[col["qty"] + 1], y0, y1, DIG)
    for k in ("no", "price", "sum"):
        if k in col: W[k] = strip_words(clean, xs[col[k]], xs[col[k] + 1], y0, y1, DIG)
    if "unit" in col: W["unit"] = strip_words(clean, xs[col["unit"]], xs[col["unit"] + 1], y0, y1)
    jk = col["unit"] - 1 if "unit" in col and col["unit"] > 0 and (col["unit"] - 1) not in col.values() else None
    if jk is not None: W["okei"] = strip_words(clean, xs[jk], xs[jk + 1], y0, y1, ["-c", "tessedit_char_whitelist=0123456789"])
    items, totals = [], None
    for (a, b) in data:
        T = {k: join_words(words_in(v, -1e9, 1e9, a, b)) for k, v in W.items()}
        name = fix_name(T.get("name", ""))
        if re.search(r"всего|к\s*оплат|итого", lc(name)) or re.search(r"всего\s*к\s*оплат", lc(T.get("name", ""))):
            totals = {"sum": money(T.get("sum"))}; break
        if re.search(r"наименование\s+товара|описание\s+выполн|работ,\s*услуг", lc(name)): continue   # шапка таблицы на следующих листах
        qraw = T.get("qty", ""); q = num(qraw)
        no = re.sub(r"\D", "", T.get("no", ""))
        if (q is None or not name) and b - a > 14:
            # строка плохо прочиталась целиком — повторяем по ячейке крупнее
            if q is None:
                qraw = tess(cell_img(clean, a, b, xs[col["qty"]], xs[col["qty"] + 1], 2), 7, DIG); q = num(qraw)
            if not name:
                name = fix_name(tess(cell_img(clean, a, b, xs[col["name"]], xs[col["name"] + 1], 2), 6))
        if not name and q is None: continue
        if len(words(name)) < 1: continue   # строка номеров колонок «А 1 1а 1б 2 …»
        price, ssum = money(T.get("price")), money(T.get("sum"))
        unit = re.sub(r"[^A-Za-zА-Яа-я0-9²³.]", "", T.get("unit", "")).lower()[:8].replace("м²", "м2").replace("м³", "м3").strip(".")
        unit = UM.get(unit, unit)
        ok = re.sub(r"\D", "", T.get("okei", ""))
        if ok in OKEI and (not unit or unit not in OKEI.values()): unit = OKEI[ok]
        it = {"no": int(no) if no and len(no) <= 4 else None, "name": name, "unit": unit, "qty": q, "qty_raw": qraw, "_sum": ssum}
        warn = []
        if q is None: warn.append("qty")
        elif price and ssum:
            if abs(price * q - ssum) > max(0.05, ssum * 0.002):
                # кол-во не сходится с ценой и стоимостью: пересчитать из стоимости, если получается «круглое»
                alt = round(ssum / price, 3) if price else None
                if alt and abs(alt - round(alt)) < 0.002 and abs(price * round(alt) - ssum) <= max(0.05, ssum * 0.002):
                    it["qty_ocr"] = q; it["qty"] = float(round(alt)); warn.append("qty_fixed")
                else:
                    q2 = num(tess(cell_img(clean, a, b, xs[col["qty"]], xs[col["qty"] + 1], 3), 7, DIG))
                    if q2 is not None and abs(price * q2 - ssum) <= max(0.05, ssum * 0.002): it["qty_ocr"] = q; it["qty"] = q2
                    else: warn.append("qty")
            else: it["checked"] = True
        if not unit: warn.append("unit")
        it["warn"] = warn
        items.append(it)
    return {"items": items, "tpl": tpl_new, "cols": col, "totals": totals}

KEYW = re.compile(r"передаточн|сч[её]т.{0,3}фактур|продавец|покупател|наименование|основание|гост|шт", re.I)

def main(path):
    t0 = time.time(); tmp = tempfile.mkdtemp(prefix="vsupd")
    try:
        with open(path, "rb") as f: magic = f.read(5)
        is_pdf = magic.startswith(b"%PDF")
        if is_pdf:
            n = MAX_PAGES
            try:
                info = subprocess.run(["pdfinfo", path], capture_output=True, timeout=30).stdout.decode("utf-8", "ignore")
                m = re.search(r"Pages:\s*(\d+)", info); n = min(MAX_PAGES, int(m.group(1))) if m else MAX_PAGES
            except Exception: pass
            pages = [(i, None) for i in range(1, n + 1)]
        else:
            pages = [(1, path)]
        text_all, items, dbg, rot_prev, tpl, tot = "", [], [], None, None, None
        for pi, p in pages:
            progress(pi, len(pages))
            if is_pdf:
                pre = os.path.join(tmp, "p%03d" % pi)
                subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", "-f", str(pi), "-l", str(pi), "-singlefile", path, pre], check=True, timeout=120)
                p = pre + ".png"
            img = cv2.imread(p)
            if img is None: continue
            if max(img.shape[:2]) < 2400:
                k = 3000 / max(img.shape[:2]); img = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
            img, skew = deskew(img)
            # поворот: для листов PDF берём поворот предыдущего листа, если таблица находится
            im = None
            if rot_prev is not None:
                cand = rotate(img, rot_prev)
                if find_table(cv2.cvtColor(cand, cv2.COLOR_BGR2GRAY)): im, rot = cand, rot_prev
            if im is None:
                r0 = osd_rotation(img)
                tries = [r0] + [r for r in (0, 90, 270, 180) if r != r0]
                best = None
                for r in tries:
                    c = rotate(img, r); gg = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)
                    small = cv2.resize(gg, None, fx=0.6, fy=0.6) if max(gg.shape) > 3600 else gg
                    txt = tess(small, 6)
                    score = len(KEYW.findall(txt)) * 10 + quality(txt) / 200
                    if best is None or score > best[0]: best = (score, r, c)
                    if len(KEYW.findall(txt)) >= 2: break
                _, rot, im = best
            rot_prev = rot
            g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
            if not is_pdf: g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)
            tb = find_table(g)
            if pi == 1 or not re.search(r"фактур|передаточн", text_all, re.I):
                # шапка документа (номер, дата, продавец) — над таблицей; если таблицы нет — весь лист
                top = tb["top"] if tb and tb["top"] > g.shape[0] * 0.12 else g.shape[0]
                full = tess(g[:top], 6, ["-c", "preserve_interword_spaces=1"])
                text_all += "\n" + full
            tr = table_rows(g, tb, tpl)
            if tr:
                if tr.get("tpl"): tpl = tr["tpl"]
                for it in tr["items"]: it["page"] = pi; items.append(it)
                if tr.get("totals"): tot = tr["totals"]
            dbg.append({"page": pi, "rot": rot, "skew": skew, "cols": tr and tr.get("cols"), "n": tr and len(tr["items"])})
            try: os.remove(p) if is_pdf else None
            except Exception: pass
            if time.time() - t0 > 250: dbg.append({"stopped": "time"}); break
        h = header_fields(text_all)
        for k, it in enumerate(items):   # № не прочитан, а соседи идут подряд — восстанавливаем
            if it.get("no") is None and 0 < k < len(items) - 1:
                a_, b_ = items[k - 1].get("no"), items[k + 1].get("no")
                if a_ and b_ and b_ - a_ == 2: it["no"] = a_ + 1
            elif it.get("no") is None and k == len(items) - 1 and k and items[k - 1].get("no"): it["no"] = items[k - 1]["no"] + 1
            elif it.get("no") is None and k == 0 and len(items) > 1 and items[1].get("no") == 2: it["no"] = 1
        chk = {"rows": len(items), "checked": sum(1 for it in items if it.get("checked")), "warn": sum(1 for it in items if "qty" in it["warn"])}
        # 1.9.5: сверка «Всего к оплате» (стоимость без налога) с суммой строк — если строки потерялись, суммы не сойдутся
        isum = round(sum(it.get("_sum") or 0 for it in items), 2)
        for it in items: it.pop("_sum", None)
        chk["totals_found"] = bool(tot and tot.get("sum"))
        if chk["totals_found"]:
            chk["total_sum"] = tot["sum"]; chk["items_sum"] = isum
            chk["sum_ok"] = abs(isum - tot["sum"]) <= max(1.0, tot["sum"] * 0.0005)
        # 1.9.6: сумма строк = «Всего к оплате» — значит, все строки на месте; неразборчивый «№ п/п» нумеруем по порядку
        if chk.get("sum_ok") and items and [it.get("no") for it in items] != list(range(1, len(items) + 1)):
            for k, it in enumerate(items): it["no"] = k + 1
            chk["renumbered"] = True
        # сквозная нумерация: пропуски и повторы «№ п/п»
        nos = [it["no"] for it in items if it.get("no")]
        if nos:
            mx = max(nos); seen = {}
            for v in nos: seen[v] = seen.get(v, 0) + 1
            chk["no_max"] = mx
            chk["missing"] = [v for v in range(1, mx + 1) if v not in seen][:50]
            chk["dup"] = [v for v, c in seen.items() if c > 1][:50]
            chk["no_ok"] = not chk["missing"] and not chk["dup"] and mx == len(items)
        out({"header": h, "items": items, "check": chk, "pages": len(pages), "pages_read": len(dbg), "ms": int((time.time() - t0) * 1000), "debug": dbg})
    except Exception as e:
        out({"error": "Не удалось прочитать УПД: " + str(e)[:200]})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main(sys.argv[1])
