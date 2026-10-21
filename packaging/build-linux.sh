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
mkdir -p "$DIST/app" "$DIST/desktop" "$DIST/latex" "$DIST/feynman"

cp "${ROOT}/desktop/launch.py" "$DIST/desktop/"
cp "${ROOT}/desktop/setup.py" "$DIST/desktop/"
cp "${ROOT}/desktop/splash.html" "$DIST/desktop/"
cp "${ROOT}/desktop/yggdrasil-logo.png" "$DIST/desktop/"
for f in main.py gate.py zotero.py data_manifest.py graph_links.py analysis_tags.py arxiv_topics.py task_statuses.py goals.py mcp_server.py; do
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

# ── Bundled Python (python-build-standalone) ─────────────────────────────
PY_VER="3.12.5"
PY_DATE="20240814"
ARCH="$(uname -m)"
if [ "$ARCH" = "x86_64" ]; then
  PY_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PY_DATE}/cpython-${PY_VER}+${PY_DATE}-x86_64-unknown-linux-gnu-install_only.tar.gz"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  PY_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PY_DATE}/cpython-${PY_VER}+${PY_DATE}-aarch64-unknown-linux-gnu-install_only.tar.gz"
else
  echo "ERROR: Unsupported arch: $ARCH"; exit 1
fi

PY_CACHE="/tmp/ygg-py-linux-cache-${ARCH}"
PY_TGZ="${PY_CACHE}/python.tar.gz"
STANDALONE_PYTHON="${PY_CACHE}/python/bin/python3.12"

mkdir -p "$PY_CACHE"
# Validate cached binary is actually executable on this arch (wipe if stale/wrong)
if [ -f "$STANDALONE_PYTHON" ] && ! "$STANDALONE_PYTHON" --version >/dev/null 2>&1; then
  echo "→ Cached Python not executable on this arch — clearing cache..."
  rm -rf "$PY_CACHE"
  mkdir -p "$PY_CACHE"
fi
if [ ! -f "$STANDALONE_PYTHON" ]; then
  echo "→ Downloading standalone Python ${PY_VER} for ${ARCH}..."
  curl -fL "$PY_URL" -o "$PY_TGZ"
  tar -xzf "$PY_TGZ" -C "$PY_CACHE"
fi

echo "→ Copying standalone Python into the bundle (relocatable; no venv)..."
rm -rf "$DIST/python"
cp -R "${PY_CACHE}/python" "$DIST/python"
BPY="$DIST/python/bin/python3.12"

echo "→ Installing Python dependencies..."
"$BPY" -m pip install --upgrade pip --quiet

if [ "$(uname -s)" = "Linux" ]; then
  "$BPY" -m pip install -r "$DIST/requirements.txt" pywebview "PyGObject<3.50" --quiet
else
  echo "→ Not Linux: skipping PyGObject. Run on Linux for real build."
  "$BPY" -m pip install -r "$DIST/requirements.txt" pywebview --quiet
fi

cat > "$DIST/Yggdrasil" << 'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export YGG_RESOURCES="$DIR/app"
export YGG_BUNDLE="$DIR"
export PYTHONUNBUFFERED=1
cd "$DIR/desktop"
exec "$DIR/python/bin/python3" "$DIR/desktop/launch.py"
EOF
chmod +x "$DIST/Yggdrasil"

# --- .desktop file for app-menu integration ---
mkdir -p "$DIST/share"
cat > "$DIST/share/yggdrasil.desktop" << 'EOF'
[Desktop Entry]
Name=Yggdrasil
Comment=Personal research app (papers, notes, tasks, graph, LaTeX)
Exec="""HOME/.local/share/Yggdrasil/Yggdrasil"""
Icon=yggdrasil
Type=Application
Categories=Office;Education;Science;
Terminal=false
StartupNotify=true
EOF

# --- install script ---
cat > "$DIST/install.sh" << 'EOF'
#!/usr/bin/env bash
# Install Yggdrasil to ~/.local/share/ and add it to the app menu
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.local/share/Yggdrasil"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"

echo "→ Checking system dependencies …"
MISSING=()

# Try importing the key GTK/GI modules that pywebview needs
if ! python3 -c "import gi; gi.require_version('Gtk','3.0'); from gi.repository import Gtk, WebKit2" 2>/dev/null; then
  MISSING+=("GTK / WebKit GI bindings")
fi

if ! command -v pkg-config >/dev/null 2>&1; then
  MISSING+=("pkg-config")
fi

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  echo "⚠️  Some system libraries appear to be missing:"
  printf '   - %s\n' "${MISSING[@]}"
  echo ""
  echo "Install them first, then run this script again."
  echo ""
  echo "  Ubuntu / Debian:"
  echo "    sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1 pkg-config"
  echo ""
  echo "  Fedora:"
  echo "    sudo dnf install python3-gobject gtk3 webkit2gtk3 pkgconfig"
  echo ""
  echo "  Arch:"
  echo "    sudo pacman -S python-gobject gtk3 webkit2gtk pkgconf"
  echo ""
  read -rp "Continue anyway? [y/N] " ANSWER
  if [[ ! "$ANSWER" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "→ Installing to $INSTALL_DIR …"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
cp -R "$SCRIPT_DIR"/* "$INSTALL_DIR/"

echo "→ Adding app-menu entry …"
mkdir -p "$DESKTOP_DIR" "$ICON_DIR"
sed "s|\"\"\"HOME\"\"\"|$HOME|g" "$SCRIPT_DIR/share/yggdrasil.desktop" > "$DESKTOP_DIR/yggdrasil.desktop"
chmod +x "$DESKTOP_DIR/yggdrasil.desktop"
cp "$SCRIPT_DIR/desktop/yggdrasil-logo.png" "$ICON_DIR/yggdrasil.png"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

echo ""
echo "✓ Yggdrasil installed."
echo "  Launch from your app menu, or run:  ~/.local/share/Yggdrasil/Yggdrasil"
echo "  Uninstall anytime with:             ~/.local/share/Yggdrasil/uninstall.sh"
EOF
chmod +x "$DIST/install.sh"

# --- uninstall script ---
cat > "$DIST/uninstall.sh" << 'EOF'
#!/usr/bin/env bash
# Remove Yggdrasil from ~/.local/share/ and the app menu
set -euo pipefail

INSTALL_DIR="$HOME/.local/share/Yggdrasil"
DESKTOP_FILE="$HOME/.local/share/applications/yggdrasil.desktop"
ICON_FILE="$HOME/.local/share/icons/hicolor/256x256/apps/yggdrasil.png"

echo "→ Removing Yggdrasil …"
rm -rf "$INSTALL_DIR"
rm -f "$DESKTOP_FILE"
rm -f "$ICON_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

echo "✓ Yggdrasil uninstalled."
EOF
chmod +x "$DIST/uninstall.sh"

cat > "$DIST/README.txt" << 'EOF'
Yggdrasil (Linux)

© 2026 Kamil Nadaf — MIT License (see LICENSE)

Quick start
-----------
1. Run the installer (adds Yggdrasil to your app menu):

     ./install.sh

   Then launch it from your app menu like any other program.

2. Or run it portably (no install, no app-menu entry):

     ./Yggdrasil

First launch
------------
- You will be asked where to save your notes (vault).
- TinyTeX (LaTeX) installs automatically on first launch if not already
  present — needs internet on that first run.

System dependencies
-------------------
Yggdrasil needs GTK/WebKit system libraries for its window. The installer
warns you if they are missing. Install them first:

  Ubuntu / Debian:
    sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1 pkg-config

  Fedora:
    sudo dnf install python3-gobject gtk3 webkit2gtk3 pkgconfig

  Arch:
    sudo pacman -S python-gobject gtk3 webkit2gtk pkgconf

AI: set your API key in Settings (LM Studio / Claude / …). Ollama optional.
EOF

TAR="${OUT}/Yggdrasil-${STAMP}-linux.tar.gz"
tar -C "$OUT" -czf "$TAR" Yggdrasil-linux
echo "Wrote $DIST"
echo "Wrote $TAR"
