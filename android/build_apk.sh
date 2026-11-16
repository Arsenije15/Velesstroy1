#!/bin/bash
# Сборка APK без Android Studio: aapt2 + D8 + apksig из официального bundletool (Google, GitHub) и android.jar (API 34).
# Использование: TOOLS=/папка/с/bundletool.jar,android.jar,linux/aapt2,Sign.class  bash build_apk.sh <versionCode> <out.apk>
set -e
HERE=$(cd "$(dirname "$0")" && pwd); V=${1:-1}; OUT=${2:-$HERE/velesstroy-zayavki.apk}
T=${TOOLS:-/tmp/apkb/tools}; BT=${BT:-/tmp/dl/bundletool.jar}; AJ=${AJ:-/tmp/dl/android.jar}
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
M=$HERE/app/src/main
# 1) ресурсы и манифест
"$T/linux/aapt2" compile --dir "$M/res" -o "$W/res.zip"
"$T/linux/aapt2" link -I "$AJ" --manifest "$M/AndroidManifest.xml" -o "$W/base.apk" "$W/res.zip" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$V" --version-name "1.0.$V" --rename-manifest-package ru.velesstroy.zay --auto-add-overlay
# 2) Java → class → dex
mkdir -p "$W/src" "$W/cls" "$W/dex"; cp -r "$M/java/." "$W/src/"
sed -i "s/VER = \"[0-9]*\"/VER = \"$V\"/" "$W/src/ru/velesstroy/zay/BuildConfigLite.java"
javac -nowarn -g:none -parameters -source 8 -target 8 -bootclasspath "$AJ" -encoding UTF-8 -d "$W/cls" $(find "$W/src" -name '*.java') 2>&1 | grep -v "JAVA_TOOL\|warning: \[options\]\|^[0-9] warning" || true
java -cp "$BT" com.android.tools.r8.D8 --release --min-api 24 --lib "$AJ" --output "$W/dex" $(find "$W/cls" -name '*.class') 2>&1 | grep -v JAVA_TOOL || true
# 3) упаковка с выравниванием (resources.arsc без сжатия, по 4 байта) и подпись
python3 - "$W/base.apk" "$W/dex/classes.dex" "$W/unsigned.apk" <<'PY'
import sys, zipfile
src, dex, out = sys.argv[1:4]
zin = zipfile.ZipFile(src)
items = [(i.filename, zin.read(i.filename)) for i in zin.infolist()] + [("classes.dex", open(dex, "rb").read())]
with open(out, "wb") as f:
    zo = zipfile.ZipFile(f, "w")
    for name, data in items:
        zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        store = name == "resources.arsc" or name.endswith(".png")
        zi.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
        if store:   # выравнивание данных по 4 байтам (как zipalign)
            hdr = 30 + len(name.encode())
            pad = (-(f.tell() + hdr)) % 4
            zi.extra = b"\x00" * pad
        zo.writestr(zi, data)
    zo.close()
PY
java -cp "$BT:$T" Sign "$HERE/release.jks" vsZay2026 vszay "$W/unsigned.apk" "$OUT" 2>&1 | grep -v JAVA_TOOL
echo "APK: $OUT ($(stat -c %s "$OUT") байт), versionCode $V"
