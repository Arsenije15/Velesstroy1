#!/usr/bin/env python3
# VELESSTROY 1.9.24 — сертификат соответствия / паспорт качества / декларация: вид, №, дата, срок действия, партия + весь текст (для сверки с УПД)
import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from aosr_ocr import get_text, find_date  # тот же способ чтения: текст из PDF или распознавание скана / фото

KINDS = [(r"паспорт\w*\s+качеств", "Паспорт качества"), (r"сертификат\w*\s+соответстви", "Сертификат соответствия"),
         (r"декларац\w*\s+о\s+соответстви", "Декларация о соответствии"), (r"сертификат\w*\s+качеств", "Сертификат качества"),
         (r"документ\w*\s+о\s+качеств", "Документ о качестве"), (r"протокол\w*\s+испытани", "Протокол испытаний"), (r"паспорт\b", "Паспорт")]


def parse(t):
    flat = re.sub(r"[ \t ]+", " ", t)
    one = re.sub(r"\s+", " ", flat)
    r = {"kind": "", "number": "", "date": "", "valid_to": "", "batch": ""}
    pos = 0
    for rx, k in KINDS:
        m = re.search(rx, one, re.I)
        if m: r["kind"] = k; pos = m.start(); break
    # № — ближайший после названия документа (регистрационный номер ЕАЭС тоже подходит)
    m = re.search(r"(?:№|N[оo°]?|номер)\s*[:.]?\s*((?:ЕАЭС|RU|РОСС|ТС)?[\s\-]*[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9.\-/_ ]{1,60}?)(?=\s+(?:от|дата|срок|выдан|действ|изготов|партия|\()|[,;]|$)", one[pos:pos + 600], re.I)
    if not m: m = re.search(r"(?:№|N[оo°]?)\s*[:.]?\s*([A-Za-zА-Яа-яЁё0-9][\w.\-/]{1,50})", one, re.I)
    if m: r["number"] = re.sub(r"\s+", " ", m.group(1)).strip(" .,;")[:120]
    m = re.search(r"(?:от|дата\s+(?:выдачи|регистрации|изготовления|составления)?)\s*[:.]?\s*(.{0,40})", one[pos:pos + 900], re.I)
    if m: r["date"] = find_date(m.group(1))
    if not r["date"]: r["date"] = find_date(one[pos:pos + 600])
    m = re.search(r"(?:действителен|срок\s+действия|действует)\s*(?:по|до|с\s+.{0,20}?\s+по)?\s*[:.]?\s*(.{0,40})", one, re.I)
    if m:
        d = re.findall(r"\d{1,2}\.\d{1,2}\.\d{2,4}", m.group(1))
        if d: r["valid_to"] = find_date(d[-1])
    m = re.search(r"парти[яию]\w*\s*(?:№|N|номер)?\s*[:.]?\s*([A-Za-zА-Яа-яЁё0-9][\w\-/.]{0,40})", one, re.I)
    if m: r["batch"] = m.group(1).strip(" .,;")
    return r


def main():
    try:
        raw, mode = get_text(sys.argv[1])
    except Exception as e:
        print(json.dumps({"error": "Файл не читается: %s" % str(e)[:200]}, ensure_ascii=False)); return
    if len(re.sub(r"\s", "", raw)) < 40:
        print(json.dumps({"error": "Текст не распознан — загрузите PDF или более чёткое фото."}, ensure_ascii=False)); return
    r = parse(raw); r["mode"] = mode; r["text"] = raw[:30000]
    print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    main()
