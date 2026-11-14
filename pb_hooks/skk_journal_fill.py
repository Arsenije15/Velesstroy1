#!/usr/bin/env python3
# VELESSTROY 1.9.19 — акты СКК → файл «Журнал Актов несоответствия» (.xlsx).
# Строка акта ищется по № в колонке A (заготовка «П-1373» с пустыми B…S) и заполняется; если в акте несколько позиций —
# под ней вставляются строки (объединения, условное форматирование, формулы, высоты строк сдвигаются).
# Акта нет в журнале — дописывается после последней заполненной строки. Уже заполненные акты не трогаем.
# Колонки T/U/V (вспомогательные «П-1349-1» для листа «АКТ») — формулами, как в журнале.
# argv: in.b64  acts.json  out.b64   → stdout JSON
import sys, json, base64, io, re, math, copy, datetime

try:
    import openpyxl
    from openpyxl.formula.translate import Translator
    from openpyxl.formatting.formatting import ConditionalFormattingList
    from openpyxl.worksheet.cell_range import CellRange
    from openpyxl.styles import PatternFill, Alignment, Border, Side
except Exception:
    print(json.dumps({"error": "На сервере нет openpyxl — выполните на сервере: bash install.sh"})); sys.exit(0)

NC = 19  # A…S
MERGE_COLS = (1, 2, 3, 4, 10, 11)  # A B C D J K — как в журнале
DATE_COLS = (2, 15)  # B (дата выдачи), O (дата закрытия)


def norm(v):
    return re.sub(r"\s+", "", str(v or "")).upper()


def find_sheet(wb):
    for ws in wb.worksheets:
        a = " ".join(str(ws.cell(r, 1).value or "") for r in range(1, 4)).lower()
        if "акт" in a and ws.max_column >= 12: return ws
    return wb.worksheets[0]


def head_row(ws):
    for r in range(1, 8):
        if re.search(r"№\s*акта", str(ws.cell(r, 1).value or ""), re.I): return r
    return 1


def used(ws, r):
    return any(ws.cell(r, c).value not in (None, "") for c in range(1, NC + 1))


def filled(ws, r):
    return any(ws.cell(r, c).value not in (None, "") for c in range(2, NC + 1))


def shift_rng(rng, idx, k):
    """CellRange: целиком ниже idx → сдвиг; пересекает idx → растянуть"""
    M = 1048576
    if rng.min_row >= idx:
        if rng.max_row + k <= M: rng.shift(row_shift=k)
        else: rng.min_row = min(rng.min_row + k, M)
    elif rng.max_row >= idx: rng.expand(down=min(k, M - rng.max_row))
    return rng


def insert_rows(ws, idx, k):
    if k <= 0: return
    maxr = ws.max_row
    heights = {r: ws.row_dimensions[r].height for r in range(idx, maxr + 1) if r in ws.row_dimensions and ws.row_dimensions[r].height is not None}
    links = {(c.row, c.column): c.hyperlink for row in ws.iter_rows(min_row=idx, max_row=maxr) for c in row if c.hyperlink}
    merged = [CellRange(str(m)) for m in ws.merged_cells.ranges]
    for m in list(ws.merged_cells.ranges): ws.merged_cells.remove(m)
    ws.insert_rows(idx, k)
    # формулы сдвинутых ячеек — пересчитать ссылки
    for row in ws.iter_rows(min_row=idx + k, max_row=ws.max_row):
        for c in row:
            v = c.value
            if isinstance(v, str) and v.startswith("="):
                try: c.value = Translator(v, origin="%s%d" % (c.column_letter, c.row - k)).translate_formula(c.coordinate)
                except Exception: pass
    # высоты строк
    for r in range(idx, maxr + k + 1):
        ws.row_dimensions[r].height = None
    for r, h in heights.items(): ws.row_dimensions[r + k].height = h
    # гиперссылки
    for (r, cc), hl in links.items():
        cell = ws.cell(r + k, cc); hl.ref = cell.coordinate; cell.hyperlink = hl
    # объединения
    for m in merged:
        shift_rng(m, idx, k); ws.merge_cells(m.coord)
    # условное форматирование
    old = ws.conditional_formatting; new = ConditionalFormattingList()
    for cf in old:
        rs = [shift_rng(CellRange(str(x)), idx, k).coord for x in cf.sqref.ranges]
        for rule in cf.rules: new.add(" ".join(rs), rule)
    ws.conditional_formatting = new
    # автофильтр
    if ws.auto_filter.ref:
        try: ws.auto_filter.ref = shift_rng(CellRange(ws.auto_filter.ref), idx, k).coord
        except Exception: pass
    try:
        if ws.print_area:
            pa = ws.print_area if isinstance(ws.print_area, str) else ws.print_area[0]
            m = re.search(r"\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)", pa)
            if m and int(m.group(4)) >= idx: ws.print_area = "%s%s:%s%d" % (m.group(1), m.group(2), m.group(3), int(m.group(4)) + k)
    except Exception: pass


def est_height(ws, vals):
    lines = 1
    for c, v in enumerate(vals, start=1):
        if v in (None, ""): continue
        w = ws.column_dimensions[openpyxl.utils.get_column_letter(c)].width or 9
        cpl = max(3, int(w * 1.1))
        lines = max(lines, sum(max(1, math.ceil(len(seg) / cpl)) for seg in str(v).split("\n")))
    return max(30, min(400, round(lines * 15 + 6, 2)))


def conv(c, v):
    if v in (None, ""): return None
    if c in DATE_COLS and isinstance(v, str):
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", v) or None
        if m: return datetime.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", v)
        if m: return datetime.datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    return v


def main():
    data = base64.b64decode(open(sys.argv[1]).read().split(",")[-1])
    acts = json.load(open(sys.argv[2], encoding="utf-8"))
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data))
    except Exception as e:
        print(json.dumps({"error": "Файл не открывается как .xlsx: %s" % str(e)[:150]}, ensure_ascii=False)); return
    ws = find_sheet(wb)
    h = head_row(ws)
    if not re.search(r"акт", str(ws.cell(h, 1).value or ""), re.I):
        print(json.dumps({"error": "Не найден лист журнала (в A1 должно быть «№ акта»)."}, ensure_ascii=False)); return
    helper = isinstance(ws.cell(h + 1, 20).value, str) and str(ws.cell(h + 1, 20).value).startswith("=")
    if not helper:
        for r in range(h + 1, min(ws.max_row, h + 200) + 1):
            v = ws.cell(r, 20).value
            if isinstance(v, str) and v.startswith("=IF(OR(A"): helper = True; break
    st = {"filled": [], "appended": [], "skipped": [], "inserted_rows": 0}
    for a in acts:
        no, rows = str(a.get("number") or "").strip(), a.get("rows") or []
        if not no or not rows: continue
        key = norm(no)
        r = None
        for rr in range(h + 1, ws.max_row + 1):
            if norm(ws.cell(rr, 1).value) == key: r = rr; break
        n = len(rows)
        if r and filled(ws, r):
            st["skipped"].append(no); continue
        if r:
            tmpl = r
            if n > 1: insert_rows(ws, r + 1, n - 1); st["inserted_rows"] += n - 1
            st["filled"].append(no)
        else:
            last = h
            for rr in range(ws.max_row, h, -1):
                if used(ws, rr): last = rr; break
            r = last + 1; tmpl = last if last > h else h + 1
            st["appended"].append(no)
        # оформление — как у последней заполненной строки выше (у заготовки оно бывает другим)
        src = next((x for x in range(r - 1, h, -1) if filled(ws, x)), tmpl)
        styles = [copy.copy(ws.cell(src, c)._style) for c in range(1, 23)]
        for i, vals in enumerate(rows):
            rr = r + i
            for c in range(1, NC + 1):
                cell = ws.cell(rr, c)
                cell._style = copy.copy(styles[c - 1])
                v = vals[c - 1] if c - 1 < len(vals) else None
                if i > 0 and c in MERGE_COLS and n > 1: v = None
                cell.value = conv(c, v)
                # как в журнале СКК: всё по центру с переносом, тонкая рамка; код акта и «Не устранено» — красная заливка
                cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
                if not (cell.border and cell.border.left and cell.border.left.style):
                    sd = Side(style="thin"); cell.border = Border(left=sd, right=sd, top=sd, bottom=sd)
                if c == 10: cell.fill = PatternFill("solid", fgColor="FFFF0000")
                if c == 12: cell.fill = PatternFill("solid", fgColor="FFFF0000") if str(v or "").lower().startswith("не") else (PatternFill("solid", fgColor="FF92D050") if v else PatternFill(fill_type=None))
                if c in DATE_COLS and isinstance(cell.value, datetime.datetime): cell.number_format = "dd.mm.yyyy"
            if helper:
                for c in (20, 21, 22):
                    ws.cell(rr, c)._style = copy.copy(styles[c - 1])
                ws.cell(rr, 20).value = '=IF(OR(A{0}="",A{0}=0),T{1},A{0})'.format(rr, rr - 1)
                ws.cell(rr, 21).value = '=COUNTIF($T${0}:T{1},T{1})'.format(h + 1, rr)
                ws.cell(rr, 22).value = '=_xlfn.CONCAT(T{0},"-",U{0})'.format(rr)
            ws.row_dimensions[rr].height = est_height(ws, [vals[c - 1] if c - 1 < len(vals) else None for c in range(1, NC + 1)])
        if n > 1:
            for c in MERGE_COLS:
                rng = "%s%d:%s%d" % (openpyxl.utils.get_column_letter(c), r, openpyxl.utils.get_column_letter(c), r + n - 1)
                for m in list(ws.merged_cells.ranges):
                    if CellRange(rng).isdisjoint(m) is False: ws.merged_cells.remove(m)
                ws.merge_cells(rng)
    if ws.auto_filter.ref:
        try:
            fr = CellRange(ws.auto_filter.ref); last = max(rr for rr in range(h, ws.max_row + 1) if used(ws, rr))
            if fr.max_row < last: fr.expand(down=last - fr.max_row); ws.auto_filter.ref = fr.coord
        except Exception: pass
    buf = io.BytesIO(); wb.save(buf)
    open(sys.argv[3], "w").write(base64.b64encode(buf.getvalue()).decode())
    st["ok"] = True
    print(json.dumps(st, ensure_ascii=False))


if __name__ == "__main__":
    main()
