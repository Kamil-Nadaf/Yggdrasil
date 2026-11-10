#!/usr/bin/env bash
# Put the Yggdrasil logo into the generated Capacitor Android project. Run from mobile/ after `npx cap add android`.
# Light phone theme: dark logo on cream. Dark phone theme: white logo on near-black. Android 13+ themed icons get a monochrome layer.
set -euo pipefail
python3 -c "import PIL" 2>/dev/null || python3 -m pip install --quiet --user pillow || python3 -m pip install --quiet --break-system-packages pillow
python3 - <<'PY'
import os
from PIL import Image
RES = "android/app/src/main/res"
mask = Image.open("public/logo-mask-512.png").convert("RGBA").split()[3]
LIGHT_BG, DARK_BG, INK, WHITE = (246, 238, 218), (17, 17, 17), (30, 27, 22), (255, 255, 255)

def glyph(color, size, scale=0.62):
    """Logo silhouette centred in a transparent square (adaptive-icon safe zone)."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    g = int(size * scale)
    solid = Image.new("RGBA", (g, g), color + (255,))
    solid.putalpha(mask.resize((g, g), Image.LANCZOS))
    canvas.alpha_composite(solid, ((size - g) // 2, (size - g) // 2))
    return canvas

def flat(bg, color, size):
    c = Image.new("RGBA", (size, size), bg + (255,))
    c.alpha_composite(glyph(color, size, 0.78))
    return c

for d, legacy, fg in [("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)]:
    for night, bg, color in [(False, LIGHT_BG, INK), (True, DARK_BG, WHITE)]:
        base = f"{RES}/mipmap-{'night-' if night else ''}{d}"
        os.makedirs(base, exist_ok=True)
        flat(bg, color, legacy).save(f"{base}/ic_launcher.png")
        flat(bg, color, legacy).save(f"{base}/ic_launcher_round.png")
        glyph(color, fg).save(f"{base}/ic_launcher_foreground.png")
    glyph((0, 0, 0), fg).save(f"{RES}/mipmap-{d}/ic_launcher_monochrome.png")

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(text)
hexc = lambda c: "#%02X%02X%02X" % c
write(f"{RES}/values/ic_launcher_background.xml", f'<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">{hexc(LIGHT_BG)}</color></resources>\n')
write(f"{RES}/values-night/ic_launcher_background.xml", f'<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">{hexc(DARK_BG)}</color></resources>\n')
adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@color/ic_launcher_background"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n'
write(f"{RES}/mipmap-anydpi-v26/ic_launcher.xml", adaptive)
write(f"{RES}/mipmap-anydpi-v26/ic_launcher_round.xml", adaptive)
print("icons installed")
PY
