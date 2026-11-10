#!/usr/bin/env bash
# Put the Yggdrasil logo into the generated Capacitor Android project. Run from mobile/ after `npx cap add android`.
set -euo pipefail
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --quiet --user pillow || python3 -m pip install --quiet --break-system-packages pillow
python3 - <<'PY'
from PIL import Image
RES = "android/app/src/main/res"
src = Image.open("public/icon-maskable-512.png").convert("RGBA")
for d, legacy, fg in [("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)]:
    for name, size in [("ic_launcher.png", legacy), ("ic_launcher_round.png", legacy), ("ic_launcher_foreground.png", fg)]:
        src.resize((size, size), Image.LANCZOS).save(f"{RES}/mipmap-{d}/{name}")
open(f"{RES}/values/ic_launcher_background.xml", "w").write('<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#F3E5C3</color></resources>\n')
print("icons installed")
PY
