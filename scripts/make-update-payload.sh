#!/usr/bin/env bash
# Builds the small in-app update package: Yggdrasil-app-vX.Y.Z.zip (app Python files + built frontend + update.json).
# Run after `npm run build` in services/assistant/frontend. Installed apps download this from the GitHub release
# (Settings -> Updates) instead of a full installer. Output goes to release/ (or $1).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release}"
python3 - "$ROOT" "$OUT" <<'PY'
import json, re, sys, zipfile
from pathlib import Path

root, out = Path(sys.argv[1]), Path(sys.argv[2])
app = root / "services" / "assistant"
dist = app / "frontend" / "dist"
if not (dist / "index.html").exists():
    sys.exit("frontend/dist is missing — run `npm run build` in services/assistant/frontend first")
version = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', (app / "data_manifest.py").read_text()).group(1)
# Bump this (and RUNTIME_LEVEL in desktop/launch.py) when a release adds Python dependencies.
manifest = {"version": version, "requires_runtime": 1}
out.mkdir(parents=True, exist_ok=True)
target = out / f"Yggdrasil-app-v{version}.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("update.json", json.dumps(manifest))
    for f in sorted(app.glob("*.py")):
        if not f.name.startswith("test_"):
            z.write(f, f.name)
    for f in sorted(dist.rglob("*")):
        if f.is_file():
            z.write(f, "frontend/dist/" + f.relative_to(dist).as_posix())
print(f"wrote {target} ({target.stat().st_size // 1024} KiB)")
PY
