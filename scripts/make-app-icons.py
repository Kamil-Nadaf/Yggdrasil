#!/usr/bin/env python3
"""Regenerate the Yggdrasil app icon set from desktop/yggdrasil-logo.png.

Outputs (committed, so the macOS/Windows/Linux builds only copy them):
  desktop/icons/yggdrasil-512.png   square transparent master, used by Linux + pywebview
  desktop/icons/Yggdrasil.icns      macOS app icon (Info.plist CFBundleIconFile)
  desktop/icons/yggdrasil.ico       Windows icon (shortcuts, window, notifications)

Needs Pillow:  pip install pillow
Run from anywhere:  python3 scripts/make-app-icons.py

The logo is ~306 px, so sizes above that are upscaled. Replace the source
with a 1024 px PNG and re-run for crisp large icons.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "desktop" / "yggdrasil-logo.png"
OUT = ROOT / "desktop" / "icons"

CANVAS = 512          # square master size
LOGO_FRACTION = 0.84  # logo fills this share of the canvas; rest is transparent margin

ICNS_SIZES = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512)]
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def square_master() -> Image.Image:
    logo = Image.open(SRC).convert("RGBA")
    box = round(CANVAS * LOGO_FRACTION)
    scale = box / max(logo.size)
    fitted = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(fitted, ((CANVAS - fitted.width) // 2, (CANVAS - fitted.height) // 2), fitted)
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = square_master()
    master.save(OUT / "yggdrasil-512.png", format="PNG")
    master.save(OUT / "Yggdrasil.icns", format="ICNS", sizes=ICNS_SIZES)
    master.save(OUT / "yggdrasil.ico", format="ICO", sizes=ICO_SIZES)
    for name in ("yggdrasil-512.png", "Yggdrasil.icns", "yggdrasil.ico"):
        print(f"wrote {OUT / name} ({(OUT / name).stat().st_size} bytes)")


if __name__ == "__main__":
    main()
