#!/usr/bin/env python3
# VELESSTROY 1.9.18 — дописать АОСР в Общий журнал работ (.xlsx): Раздел 3 (строка на каждый день) и Раздел 6 (строка на акт).
# Строки встают по датам (а не в конец), нумерация №№ п/п пересчитывается, оформление строк журнала сохраняется.
# argv: in.xlsx.b64  acts.json  out.xlsx.b64     → stdout: JSON со статистикой
import sys, json, base64, re, math, io, datetime, copy

try:
    import openpyxl
except Exception:
    print(json.dumps({"error": "На сервере нет openpyxl — выполните на сервере: bash install.sh"})); sys.exit(0)


def find_sheet(wb, n):
    for ws in wb.worksheets:
        t = re.sub(r"\s+", " ", ws.title.lower()).strip()
        if re.fullmatch(r"(раздел|разд\.?)\s*%d" % n, t): return ws
    for ws in wb.worksheets:
        v = " ".join(str(ws.cell(r, c).value or "") for r in range(1, 4) for c in range(1, 5)).lower()
        if re.search(r"раздел\s*%d\b" % n, v): return ws
    return None


def head_row(ws, ncols):
    # строка с номерами граф «1 2 3 (4)» — данные идут сразу за ней
    for r in range(1, 15):
        vals = [str(ws.cell(r, c).value or "").strip() for c in range(1, ncols + 1)]
        if vals == [str(i) for i in range(1, ncols + 1)]: return r
    return None


def last_row(ws, start, cols):
    last = start - 1
    for r in range(start, ws.max_row + 1):
        if any(ws.cell(r, c).value not in (None, "") for c in cols): last = r
    return last


def as_date(v):
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, datetime.date): return v
    m = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{2,4})", str(v or ""))
    if m:
        y = int(m.group(3)); y = y + 2000 if y < 100 else y
        try: return datetime.date(y, int(m.group(2)), int(m.group(1)))
        except Exception: return None
    return None


def iso(s):
    try: return datetime.date.fromisoformat(str(s)[:10])
    except Exception: return None


def est_height(ws, vals, cols, font_pt=10.5):
    lines = 1
    for c, v in zip(cols, vals):
        if v in (None, ""): continue
        w = ws.column_dimensions[openpyxl.utils.get_column_letter(c)].width or 9
        cpl = max(4, int(w * 1.15))
        n = sum(max(1, math.ceil(len(seg) / cpl)) for seg in str(v).split("\n"))
        lines = max(lines, n)
    return max(15, round(lines * font_pt * 1.32 + 4, 2))


def rewrite(ws, start, ncols, rows, old_last):
    """rows: [{"vals":[...], "h":height or None, "new":bool}] — записать подряд с start, пересчитать №, стиль новых — как у первой строки данных"""
    tmpl = [copy.copy(ws.cell(start, c)._style) for c in range(1, ncols + 1)]
    for i, r in enumerate(rows):
        rr = start + i
        for c in range(1, ncols + 1):
            cell = ws.cell(rr, c)
            if r["new"] or rr > old_last: cell._style = copy.copy(tmpl[c - 1])
            cell.value = r["vals"][c - 1]
        ws.cell(rr, 1).value = i + 1
        ws.row_dimensions[rr].height = r["h"]
    end = start + len(rows) - 1
    if ws.print_area and end > old_last:
        try:
            pa = ws.print_area if isinstance(ws.print_area, str) else ws.print_area[0]
            m = re.search(r"\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)", pa)
            if m and int(m.group(4)) < end: ws.print_area = "%s%s:%s%d" % (m.group(1), m.group(2), m.group(3), end)
        except Exception: pass
    return end


def main():
    src, acts_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
    data = base64.b64decode(open(src).read().split(",")[-1])
    acts = json.load(open(acts_p, encoding="utf-8"))
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data))
    except Exception as e:
        print(json.dumps({"error": "Файл журнала не открывается как .xlsx: %s" % str(e)[:150]}, ensure_ascii=False)); return
    s3, s6 = find_sheet(wb, 3), find_sheet(wb, 6)
    if not s3 or not s6:
        print(json.dumps({"error": "В файле нет листов «Раздел 3» и «Раздел 6»."}, ensure_ascii=False)); return
    st = {"r3_added": 0, "r3_skip": 0, "r6_added": 0, "r6_skip": 0}
    # ---------- Раздел 6: № п/п | документ | дата и подписавшие ----------
    h6 = head_row(s6, 3) or 5; a6 = h6 + 1; l6 = last_row(s6, a6, (2, 3))
    old6 = []
    for r in range(a6, l6 + 1):
        vals = [s6.cell(r, c).value for c in range(1, 4)]
        old6.append({"vals": vals, "h": s6.row_dimensions[r].height, "new": False, "d": as_date(vals[2])})
    have6 = set(re.sub(r"\s", "", str(x["vals"][1] or "").split("\n")[0]).lower().rstrip(".") for x in old6)
    # ---------- Раздел 3: № п/п | дата | работы | представитель ----------
    h3 = head_row(s3, 4) or 3; a3 = h3 + 1; l3 = last_row(s3, a3, (2, 3, 4))
    old3 = []
    for r in range(a3, l3 + 1):
        vals = [s3.cell(r, c).value for c in range(1, 5)]
        old3.append({"vals": vals, "h": s3.row_dimensions[r].height, "new": False, "d": as_date(vals[1])})
    have3 = set((x["d"], re.sub(r"\s+", " ", str(x["vals"][2] or "")).strip().lower()) for x in old3)
    new6, new3 = [], []
    for a in acts:
        head = ("%s №%s" % (a.get("kind") or "АОСР", (a.get("number") or "").strip().rstrip("."))).strip()
        key = re.sub(r"\s", "", head).lower().rstrip(".")
        d = iso(a.get("date"))
        c2 = head + ".\n" + (a.get("work_full") or "").strip()
        c3 = ((d.strftime("%d.%m.%Yг.") if d else "") + "\n" + "\n".join(x.strip() for x in (a.get("reps") or []) if x and x.strip())).strip()
        if key in have6: st["r6_skip"] += 1
        else:
            have6.add(key); vals = [None, c2, c3]
            new6.append({"vals": vals, "h": est_height(s6, vals[1:], (2, 3), 10), "new": True, "d": d})
        d1, d2 = iso(a.get("d_start")) or d, iso(a.get("d_end"))
        if not d1: continue
        if not d2 or d2 < d1: d2 = d1
        if (d2 - d1).days > 366: d2 = d1
        txt = ((a.get("code") or "").strip() + "\n" + (a.get("work_short") or "").strip()).strip()
        k = 0
        while d1 + datetime.timedelta(days=k) <= d2:
            dd = d1 + datetime.timedelta(days=k); k += 1
            kk = (dd, re.sub(r"\s+", " ", txt).strip().lower())
            if kk in have3: st["r3_skip"] += 1; continue
            have3.add(kk)
            vals = [None, datetime.datetime(dd.year, dd.month, dd.day), txt, (a.get("performer") or "").strip()]
            new3.append({"vals": vals, "h": est_height(s3, vals[2:], (3, 4), 11), "new": True, "d": dd})

    def merge(old, new):
        # старые строки — в своём порядке; новая встаёт после последней строки с датой ≤ её даты
        out = list(old)
        for n in sorted(new, key=lambda x: x["d"] or datetime.date.max):
            pos = len(out)
            if n["d"]:
                last_le = -1
                for i, o in enumerate(out):
                    if o["d"] and o["d"] <= n["d"]: last_le = i
                first_gt = next((i for i, o in enumerate(out) if o["d"] and o["d"] > n["d"]), None)
                pos = last_le + 1 if last_le >= 0 else (first_gt if first_gt is not None else len(out))
            out.insert(pos, n)
        return out

    if new6:
        rows = merge(old6, new6); rewrite(s6, a6, 3, rows, l6); st["r6_added"] = len(new6)
        st["r6_first"] = a6 + rows.index(new6[0]) if new6 else None
    if new3:
        rows = merge(old3, new3); rewrite(s3, a3, 4, rows, l3); st["r3_added"] = len(new3)
    buf = io.BytesIO(); wb.save(buf)
    open(out_p, "w").write(base64.b64encode(buf.getvalue()).decode())
    st["ok"] = True
    print(json.dumps(st, ensure_ascii=False))


if __name__ == "__main__":
    main()
