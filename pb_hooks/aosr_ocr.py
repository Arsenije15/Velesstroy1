#!/usr/bin/env python3
# VELESSTROY 1.9.18 — чтение АОСР (PDF с текстом или скан / фото) → поля для Общего журнала работ (Раздел 3 и Раздел 6)
import sys, os, re, json, subprocess, tempfile, glob

MONTHS = {"январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6, "июл": 7, "август": 8, "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12}
KINDS = [  # (что написано после «АКТ», сокращение)
    (r"скрыт\w*\s+работ", "АОСР"),
    (r"ответствен\w*\s+конструкц", "АООК"),
    (r"участк\w*\s+сет", "АОУСИТО"),
    (r"промежуточн\w*\s+при[её]мк", "АПП"),
    (r"антикоррозийн|антикоррозионн", "АОСР"),
]
HINT = re.compile(r"(\(?должность|фамилия, имя|фамилия, инициалы|инициалы, подпись|реквизиты распорядительного|подтверждающего полномочи|наименование, ОГРН|ОГРНИП|"
                  r"места нахождения юридического|место нахождения юридического|адрес места жительства|идентификационный номер в национальном|"
                  r"с указанием наименования|членом которой|телефон/факс|дата составления|наименование скрытых|номер, другие реквизиты|сведения о лицах|"
                  r"наименование строительных|исполнительные схемы|наименования и структурные|наименование работ, конструкций|наименование лица, выполнившего|"
                  r"нормативных правовых|саморегулируемой организации, членом|почтовый или строительный адрес|наименование проектной документации)", re.I)
FIO = r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?"


def run(cmd, **kw):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=kw.get("timeout", 300)).stdout.decode("utf-8", "replace")


def get_text(path):
    low = path.lower()
    if low.endswith(".txt"):
        return open(path, encoding="utf-8").read(), "text"
    if low.endswith(".pdf"):
        t = run(["pdftotext", "-l", "6", path, "-"])
        if len(re.sub(r"\s", "", t)) > 600 and re.search(r"освидетельствован|АКТ", t, re.I):
            return t, "text"
        d = tempfile.mkdtemp(prefix="aosr")
        run(["pdftoppm", "-r", "300", "-l", "4", "-png", path, d + "/p"])
        imgs = sorted(glob.glob(d + "/p*.png"))
    else:
        imgs = [path]
    out = []
    for i, im in enumerate(imgs):
        if os.environ.get("VS_OCR_PROGRESS"):
            try: open(os.environ["VS_OCR_PROGRESS"], "w").write("%d/%d" % (i + 1, len(imgs)))
            except Exception: pass
        # поворот: tesseract сам определяет (osd), если страница боком
        rot = 0
        try:
            o = run(["tesseract", im, "-", "--psm", "0"], timeout=60)
            m = re.search(r"Rotate:\s*(\d+)", o)
            if m: rot = int(m.group(1))
        except Exception: pass
        src = im
        if rot in (90, 180, 270):
            try:
                import cv2
                a = cv2.imread(im)
                a = cv2.rotate(a, {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rot])
                src = im + ".r.png"; cv2.imwrite(src, a)
            except Exception: pass
        out.append(run(["tesseract", src, "-", "-l", "rus", "--psm", "4"], timeout=240))
    return "\n".join(out), "ocr"


def clean_lines(t):
    L = []
    for ln in t.replace("\r", "").split("\n"):
        s = re.sub(r"[ \t\u00a0]+", " ", ln).strip()
        s = re.sub(r"^[\s.‚,|`'’‘_°:;]+", "", s).strip()
        if not s: continue
        if HINT.search(s) and not re.search(r"\d{2}\.\d{2}\.\d{2,4}|приказ|№", s): continue
        if re.fullmatch(r"[\W_\d]{0,6}", s): continue
        L.append(s)
    return L


def fixnum(no):
    # «ПК-300-310-03.2-КЖ2-ОЗ» → «…-03»: в частях из цифр буквы О/З — это 0/3
    parts = re.split(r"([-/.])", no)
    out = []
    for p in parts:
        if p and re.fullmatch(r"[0-9ОоOЗз]+", p) and not re.fullmatch(r"[ОоOЗз]", p) or (p and re.fullmatch(r"[ОоO][0-9]+|[0-9]+[ОоOЗз]+|[ОоO][ЗзОоO]", p)):
            p = p.translate(str.maketrans("ОоOЗз", "00033"))
        out.append(p)
    return "".join(out).strip(".,;:")


def mkdate(d, mon, y):
    try:
        d = int(re.sub(r"\D", "", d)); y = re.sub(r"\D", "", y)
        if len(y) == 2: y = "20" + y
        y = int(y)
        m = None
        if re.fullmatch(r"\d{1,2}", mon or ""): m = int(mon)
        else:
            ml = (mon or "").lower()
            for k, v in MONTHS.items():
                if ml.startswith(k) and (k != "ма" or ml.startswith("мая") or ml == "май"): m = v; break
        if not m or not (1 <= d <= 31) or not (2000 <= y <= 2100): return ""
        return "%04d-%02d-%02d" % (y, m, d)
    except Exception:
        return ""


DATE_RE = r"[\"«“„]?\s*_*\s*(\d{1,2})\s*_*\s*[\"»”]?\s*_*\s*([А-Яа-яЁё]{3,}|\d{1,2})\s*_*\s*((?:20)?\s*_*\s*\d{2})\b"


def find_date(s):
    m = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{2,4})", s)
    m2 = re.search(DATE_RE, s)
    if m2 and (not m or m2.start() < m.start()):
        r = mkdate(m2.group(1), m2.group(2), m2.group(3))
        if r: return r
    if m: return mkdate(m.group(1), m.group(2), m.group(3))
    return ""


def section(txt, start, ends):
    m = re.search(start, txt, re.I | re.S)
    if not m: return ""
    rest = txt[m.end():]
    cut = len(rest)
    for e in ends:
        x = re.search(e, rest, re.I | re.S)
        if x and x.start() < cut: cut = x.start()
    return rest[:cut].strip(" :;,.\n")


def short_rep(s):
    s = re.sub(r"\s+", " ", s).strip(" :;,.—-")
    s = re.sub(r"^\(?специалист по организации строительства\)\s*[—-]?\s*", "", s, flags=re.I)
    s = re.sub(r"^\s*[—-]\s*", "", s)
    # всё после ФИО (ИНРС, приказ, ОГРН, адрес) — не нужно
    m = re.search(r"(,?\s*(ИНРС|идентификационн|приказ|распоряжени|доверенност|ОГРН|ИНН|почтовый|протокол|№\s*\d))", s, re.I)
    if m: s = s[:m.start()]
    s = re.sub(r",\s*(" + FIO + r")", r" \1", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;:.")
    if re.search(FIO + r"$", s) and not s.endswith("."): s += "."
    return s


def fix_text(s):
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"(?<![А-Яа-яA-Za-z])[ТтУуVv]\s*=\s*(\d)", r"V=\1", s)
    s = re.sub(r"(\d)\s*(мз|м3|м³|м\s?З)(?![а-яё])", r"\1 м³", s)
    s = re.sub(r"(\d)\s*(м2|м²)(?![а-яё])", r"\1 м²", s)
    s = s.replace("НЗНИ", "НЗНП").replace("НИПИ ПГ", "НИПИ НГ").replace("НЗНП, Инжиниринг", "НЗНП Инжиниринг").replace("«НЗНП Инжиниринг», ", "«НЗНП Инжиниринг» ")
    return s.strip(" .,;:") + ("." if not re.search(r"[.»\"³²)]$", s.strip(" ,;:")) else "")


def parse(raw):
    L = clean_lines(raw)
    txt = "\n".join(L)
    flat = re.sub(r"\s+", " ", txt)
    res = {"kind": "", "number": "", "date": "", "work_full": "", "code": "", "work_short": "", "d_start": "", "d_end": "", "reps": [], "performer": ""}
    # --- вид акта, номер, дата ---
    m = re.search(r"\bАКТ\b\s*(.{0,160})", flat)
    head = m.group(1) if m else flat[:2000]
    for rx, k in KINDS:
        if re.search(rx, head, re.I): res["kind"] = k; break
    if not res["kind"]:
        for rx, k in KINDS:
            if re.search("освидетельствования\\s+" + rx, flat, re.I): res["kind"] = k; break
    mn = re.search(r"№\s*([A-ZА-ЯЁ0-9][A-Za-zА-Яа-яЁё0-9.\-/_]{3,60})", flat[m.start():] if m else flat)
    if mn:
        res["number"] = fixnum(mn.group(1))
        res["date"] = find_date((flat[m.start():] if m else flat)[mn.end() - 0: mn.end() + 80])
    # --- представители (стр. 1, до «произвели осмотр») ---
    top = flat
    po = re.search(r"произвели осмотр", flat, re.I)
    if po: top = flat[:po.start()]
    H = [("z", r"Представитель застройщика.{0,160}?строительного контроля"),
         ("ss", r"Представитель лица, осуществляющего строительство, по вопросам строительного контроля(\s*\(специалист по организации строительства\))?"),
         ("s", r"Представитель лица, осуществляющего строительство(?!,)"),
         ("p", r"Представитель лица, осуществляющего подготовку проектной документации"),
         ("v", r"Представитель лица, выполнившего работы,? подлежащие освидетельствованию:?"),
         ("i", r"а также иные представители лиц, участвующих в освидетельствовании:?")]
    pos = []
    for k, rx in H:
        x = re.search(rx, top, re.I)
        if x: pos.append((x.start(), x.end(), k))
    pos.sort()
    R = {}
    for i, (a, b, k) in enumerate(pos):
        e = pos[i + 1][0] if i + 1 < len(pos) else len(top)
        R[k] = short_rep(top[b:e])
    for k in R: R[k] = fix_text(R[k]).rstrip(".") + "." if R[k] else ""
    # порядок как в журнале: застройщик, строитель, стройконтроль, проектировщик, иные (СКК), выполнивший работы
    res["reps"] = [R.get(k, "") for k in ("z", "s", "ss", "p", "i", "v")]
    res["performer"] = R.get("v", "")
    # --- п. 1 работы ---
    w = section(flat, r"1\.\s*К освидетельствованию предъявлены следующие работы:?", [r"\(наименование скрытых", r"\b2\.\s*Работы выполнены", r"Работы выполнены по проектной"])
    res["work_full"] = fix_text(w) if w else ""
    p2 = section(flat, r"Работы выполнены по проектной документации:?", [r"\b3\.\s*При выполнении", r"При выполнении работ применены"])
    mc = re.search(r"(\d{2,}(?:[-.]\d+[A-Za-zА-Яа-я]?)*-[A-ZА-ЯЁ]{1,5}\d*(?:[.\-/][0-9A-ZА-ЯЁ]+)*)", p2 or res["work_full"])
    if mc: res["code"] = fixnum(mc.group(1))
    # работы для Раздела 3: без шифра и без названия объекта (то, что повторяет п. 2: «Комбинированная установка… Сектор… Этажерка…»)
    ws = res["work_full"]
    if res["code"]: ws = re.sub(r"^\s*(ПК-)?" + re.escape(res["code"]) + r"\s*", "", ws)
    ws = re.sub(r"^[\"«“]([^\"»”]{10,300})[\"»”]\.?\s*", lambda q: "" if q.group(1) else "", ws)
    p2f = re.sub(r"\s+", " ", (p2 or "")).lower()
    sents = re.split(r"(?<=[.»\"])\s+(?=[«\"А-ЯЁA-Z])", ws)
    TITLE = re.compile(r"^[«\"]?(Комбинированная установка|Установка|Секция|Сектор|Этажерка|Корпус|Здание|Сооружение|Блок|Открытая|Объект|Титул|Площадка|Эстакада)\b", re.I)
    i = 0
    while i < len(sents) - 1 and (TITLE.match(sents[i]) or (len(sents[i]) > 4 and sents[i].lower().strip(" .«»\"") in p2f)):
        i += 1
    res["work_short"] = " ".join(sents[i:]).strip(" «»\"").strip()
    if res["work_short"] and not res["work_short"].endswith((".", "³", "²")): res["work_short"] += "."
    # --- п. 5 даты ---
    d5 = section(flat, r"\b5\.\s*Даты:?", [r"\b6\.\s*Работы выполнены", r"Работы выполнены в соответствии"]) or flat
    a = re.search(r"начала работ\s*(.{0,60})", d5, re.I); b = re.search(r"окончания работ\s*(.{0,60})", d5, re.I)
    if a: res["d_start"] = find_date(a.group(1))
    if b: res["d_end"] = find_date(b.group(1))
    if res["d_start"] and res["d_end"] and res["d_end"] < res["d_start"]: res["d_end"] = res["d_start"]
    return res


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Не указан файл"})); return
    try:
        raw, mode = get_text(sys.argv[1])
    except Exception as e:
        print(json.dumps({"error": "Файл не читается: %s" % str(e)[:200]}, ensure_ascii=False)); return
    if len(re.sub(r"\s", "", raw)) < 100:
        print(json.dumps({"error": "Текст не распознан — загрузите PDF или более чёткое фото."}, ensure_ascii=False)); return
    r = parse(raw); r["mode"] = mode; r["text"] = raw[:20000]
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
