#!/usr/bin/env bash
# Build a Linux AppImage-style folder (no Docker). Run on Linux.
# Produces: release/Yggdrasil-linux/ with a Yggdrasil launcher.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d)"
OUT="${ROOT}/release"
DIST="${OUT}/Yggdrasil-linux"
FRONTEND="${ROOT}/services/assistant/frontend"

echo "→ Building frontend"
cd "$FRONTEND"
if [ ! -d node_modules ]; then npm ci; fi
./node_modules/.bin/tsc --noEmit
npm run build

echo "→ Assembling $DIST"
rm -rf "$DIST"
mkdir -p "$DIST/app" "$DIST/desktop" "$DIST/latex" "$DIST/feynman" "$DIST/venv"

cp "${ROOT}/desktop/launch.py" "$DIST/desktop/"
cp "${ROOT}/desktop/setup.py" "$DIST/desktop/"
cp "${ROOT}/desktop/splash.html" "$DIST/desktop/"
for f in main.py gate.py zotero.py data_manifest.py graph_links.py analysis_tags.py arxiv_topics.py task_statuses.py goals.py; do
  cp "${ROOT}/services/assistant/$f" "$DIST/app/"
done
mkdir -p "$DIST/app/frontend"
cp -R "${FRONTEND}/dist" "$DIST/app/frontend/dist"
cp "${ROOT}/services/latex/latex_service.py" "$DIST/latex/"
cp -R "${ROOT}/services/latex/aastex" "$DIST/latex/aastex" 2>/dev/null || true
cp -R "${ROOT}/services/latex/posters" "$DIST/latex/posters" 2>/dev/null || true
cp "${ROOT}/services/feynman/terminal_server.py" "$DIST/feynman/" 2>/dev/null || true
cp "${ROOT}/services/assistant/requirements.txt" "$DIST/"
cp "${ROOT}/LICENSE" "$DIST/LICENSE"

echo "→ Creating bundled Python (3.12 — needed for pyarrow/lancedb wheels)"
if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv is required to build the desktop app (pins Python 3.12)."
  echo "Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi
uv venv --python 3.12 "$DIST/venv"

if [ "$(uname -s)" = "Linux" ]; then
  uv pip install --python "$DIST/venv/bin/python" -r "$DIST/requirements.txt" pywebview PyGObject
else
  echo "→ Not running on Linux: this is a local sanity check only (paths/assembly/imports),"
  echo "  not a real Linux build. Skipping PyGObject (pywebview's Linux GTK backend) since"
  echo "  it needs Linux system libraries (pkg-config, cairo, gobject-introspection) that"
  echo "  don't exist on this OS. Run this script on an actual Linux machine to produce the"
  echo "  real distributable with a working app window."
  uv pip install --python "$DIST/venv/bin/python" -r "$DIST/requirements.txt" pywebview
fi

cat > "$DIST/Yggdrasil" << 'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export YGG_RESOURCES="$DIR/app"
export YGG_BUNDLE="$DIR"
export PYTHONUNBUFFERED=1
cd "$DIR/desktop"
exec "$DIR/venv/bin/python" "$DIR/desktop/launch.py"
EOF
chmod +x "$DIST/Yggdrasil"

cat > "$DIST/README.txt" << 'EOF'
Yggdrasil (Linux)

© 2026 Kamil Nadaf — MIT License (see LICENSE)

Double-click or run: ./Yggdrasil

First launch asks where to save your notes.
Needs GTK/WebKit for the window (pywebview). On Ubuntu:
  sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1

AI: set your API key in Settings (LM Studio / Claude / …). Ollama optional.

LaTeX (TinyTeX) installs automatically on first launch if not already
present (needs internet on that first run).
EOF

TAR="${OUT}/Yggdrasil-${STAMP}-linux.tar.gz"
tar -C "$OUT" -czf "$TAR" Yggdrasil-linux
echo "Wrote $DIST"
echo "Wrote $TAR"
