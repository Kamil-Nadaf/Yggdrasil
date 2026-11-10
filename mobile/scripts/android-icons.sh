#!/usr/bin/env bash
# Put the Yggdrasil logo into the generated Capacitor Android project. Run from mobile/ after `npx cap add android`.
set -euo pipefail
RES=android/app/src/main/res
SRC=public/icon-maskable-512.png
command -v convert >/dev/null || { echo "ImageMagick convert not found"; exit 1; }
for d in "mdpi 48 108" "hdpi 72 162" "xhdpi 96 216" "xxhdpi 144 324" "xxxhdpi 192 432"; do
  set -- $d
  convert "$SRC" -resize "${2}x${2}" "$RES/mipmap-$1/ic_launcher.png"
  convert "$SRC" -resize "${2}x${2}" "$RES/mipmap-$1/ic_launcher_round.png"
  convert "$SRC" -resize "${3}x${3}" "$RES/mipmap-$1/ic_launcher_foreground.png"
done
cat > "$RES/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#F3E5C3</color></resources>
XML
echo "icons installed"
