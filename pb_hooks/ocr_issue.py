#!/usr/bin/env python3
# VELESSTROY 1.9.66 — текст со снимка выдачи (скриншот переписки: «Заявка 7112: Геотекстиль500-1800м2 …» + фото машины).
# 1) Yandex Vision OCR, если подключён помощник (ключ читается из файла на сервере, никуда не уходит);
# 2) иначе tesseract: находим, где начинается текст («Заявка …»), и читаем 4 варианта (×2/×3, серый/ч-б) — потом
#    количество выбирается голосованием (перечёркнутый ноль «Ø» tesseract читает то как 0, то как 6 или 9).
# Вывод: JSON {src, texts:[...], ms}. Разбор строк и сопоставление с заявками — на сервере (lib1966.js).
import sys, os, json, time, subprocess, tempfile, base64, re, urllib.request
sys.dont_write_bytecode = True
from PIL import Image, ImageOps

def env(path):
    o = {}
    try:
        for l in open(path, encoding="utf-8"):
            m = re.match(r"^([A-Z0-9_]+)='([^']*)'$", l.strip())
            if m: o[m.group(1)] = m.group(2)
    except Exception: pass
    return o

def to_image(path):
    if path.lower().endswith(".pdf") or open(path, "rb").read(5) == b"%PDF-":
        d = tempfile.mkdtemp()
        subprocess.run(["pdftoppm", "-r", "200", "-f", "1", "-l", "1", "-png", path, d + "/p"], check=True, timeout=60)
        f = sorted(os.listdir(d))[0]; return Image.open(os.path.join(d, f))
    im = Image.open(path); im = ImageOps.exif_transpose(im); return im

def yandex(im, cfg):
    key, folder = cfg.get("YC_KEY"), cfg.get("YC_FOLDER")
    if not key or not folder: return None, "не подключён"
    b = tempfile.mktemp(suffix=".jpg"); im.convert("RGB").save(b, "JPEG", quality=92)
    body = json.dumps({"mimeType": "JPEG", "languageCodes": ["ru", "en"], "model": "page", "content": base64.b64encode(open(b, "rb").read()).decode()}).encode()
    base = cfg.get("YC_OCR_BASE") or "https://ocr.api.cloud.yandex.net"
    err = ""
    for auth in ("Api-Key " + key, "Bearer " + key):
        try:
            rq = urllib.request.Request(base + "/ocr/v1/recognizeText", data=body, method="POST",
                headers={"Content-Type": "application/json", "Authorization": auth, "x-folder-id": folder, "x-data-logging-enabled": "false"})
            j = json.loads(urllib.request.urlopen(rq, timeout=40).read().decode())
            t = ((j.get("result") or {}).get("textAnnotation") or {}).get("fullText") or ""
            if t.strip(): return t, ""
            return None, "пустой ответ"
        except urllib.error.HTTPError as e: err = "HTTP %s" % e.code
        except Exception as e: err = str(e)[:120]
    return None, err

def tess(im, psm="6"):
    f = tempfile.mktemp(suffix=".png"); im.save(f)
    r = subprocess.run(["tesseract", f, "-", "-l", "rus+eng", "--psm", psm], capture_output=True, text=True, timeout=90)
    os.remove(f); return r.stdout

def text_top(g):
    # где начинается текст выдачи: первая строка «Заявка …» / «7156: …» (выше — фото, их не читаем)
    f = tempfile.mktemp(suffix=".png"); g.save(f)
    r = subprocess.run(["tesseract", f, "-", "-l", "rus+eng", "--psm", "11", "tsv"], capture_output=True, text=True, timeout=90); os.remove(f)
    top = None
    for l in r.stdout.splitlines()[1:]:
        c = l.split("\t")
        if len(c) < 12: continue
        w = c[11].strip().lower()
        if re.match(r"^(заявк|zajavk)", w) or re.match(r"^\d{3,6}[:;]", w):
            y = int(c[7]); top = y if top is None else min(top, y)
    return top

def main():
    path = sys.argv[1]; cfg = env(sys.argv[2]) if len(sys.argv) > 2 else {}
    t0 = time.time(); im = to_image(path)
    if max(im.size) > 4000: im.thumbnail((4000, 4000))
    t, why = yandex(im, cfg)
    if t: print(json.dumps({"src": "yandex", "texts": [t], "ms": int((time.time() - t0) * 1000)}, ensure_ascii=False)); return
    g = ImageOps.grayscale(im)
    g2 = g.resize((g.width * 2, g.height * 2), Image.LANCZOS)
    top = text_top(g2)
    if top is not None: g = g.crop((0, max(0, top // 2 - 25), g.width, g.height))
    texts = []
    for sc in (2, 3):
        x = g.resize((g.width * sc, g.height * sc), Image.LANCZOS)
        texts.append(tess(x)); texts.append(tess(x.point(lambda p: 255 if p > 150 else 0)))
    print(json.dumps({"src": "tesseract", "texts": texts, "yandex": why, "cropped": top is not None, "ms": int((time.time() - t0) * 1000)}, ensure_ascii=False))

if __name__ == "__main__":
    try: main()
    except Exception as e: print(json.dumps({"error": "Не удалось прочитать снимок: " + str(e)[:200]}, ensure_ascii=False))
