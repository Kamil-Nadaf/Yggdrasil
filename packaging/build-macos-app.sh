#!/usr/bin/env bash
# Build a friend-installable Mac app (no Docker). Double-click → window.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d)"
OUT="${ROOT}/release"
APP="${OUT}/Yggdrasil.app"
RES="${APP}/Contents/Resources"
APPDIR="${RES}/app"
VENV="${RES}/venv"
DMG="${OUT}/Yggdrasil-${STAMP}-mac.dmg"
FRONTEND="${ROOT}/services/assistant/frontend"

echo "→ Building frontend"
cd "$FRONTEND"
if [ ! -d node_modules ]; then
  npm ci
fi
./node_modules/.bin/tsc --noEmit
npm run build

echo "→ Assembling Yggdrasil.app"
rm -rf "$APP"
mkdir -p "${APP}/Contents/MacOS" "$APPDIR" "${RES}/desktop"

cat > "${APP}/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Yggdrasil</string>
  <key>CFBundleDisplayName</key><string>Yggdrasil</string>
  <key>CFBundleIdentifier</key><string>io.yggdrasil.app</string>
  <key>CFBundleVersion</key><string>0.1.5</string>
  <key>CFBundleShortVersionString</key><string>0.1.5</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Yggdrasil</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key>
  <string>© 2026 Kamil Nadaf. MIT License.</string>
</dict>
</plist>
EOF

cat > "${APP}/Contents/MacOS/Yggdrasil" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$DIR/../Resources"
export YGG_RESOURCES="$RES/app"
export YGG_BUNDLE="$RES"
export PYTHONUNBUFFERED=1
cd "$RES/desktop"
exec "$RES/venv/bin/python" "$RES/desktop/launch.py"
EOF
chmod +x "${APP}/Contents/MacOS/Yggdrasil"

cp "${ROOT}/desktop/launch.py" "${RES}/desktop/launch.py"
cp "${ROOT}/desktop/setup.py" "${RES}/desktop/setup.py"
cp "${ROOT}/desktop/splash.html" "${RES}/desktop/splash.html"
cp "${ROOT}/services/assistant/main.py" "${APPDIR}/main.py"
cp "${ROOT}/services/assistant/gate.py" "${APPDIR}/gate.py"
cp "${ROOT}/services/assistant/zotero.py" "${APPDIR}/zotero.py"
cp "${ROOT}/services/assistant/data_manifest.py" "${APPDIR}/data_manifest.py"
cp "${ROOT}/services/assistant/graph_links.py" "${APPDIR}/graph_links.py"
cp "${ROOT}/services/assistant/analysis_tags.py" "${APPDIR}/analysis_tags.py"
cp "${ROOT}/services/assistant/arxiv_topics.py" "${APPDIR}/arxiv_topics.py"
cp "${ROOT}/services/assistant/task_statuses.py" "${APPDIR}/task_statuses.py"
cp "${ROOT}/services/assistant/goals.py" "${APPDIR}/goals.py"
rm -rf "${APPDIR}/frontend"
mkdir -p "${APPDIR}/frontend"
cp -R "${FRONTEND}/dist" "${APPDIR}/frontend/dist"
mkdir -p "${RES}/latex" "${RES}/feynman"
cp "${ROOT}/services/latex/latex_service.py" "${RES}/latex/latex_service.py"
cp -R "${ROOT}/services/latex/aastex" "${RES}/latex/aastex"
cp -R "${ROOT}/services/latex/posters" "${RES}/latex/posters"
cp "${ROOT}/services/feynman/terminal_server.py" "${RES}/feynman/terminal_server.py"

echo "→ Creating bundled Python (3.12 — needed for pyarrow/lancedb wheels)"
if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv is required to build the desktop app (pins Python 3.12)."
  echo "Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi
uv venv --python 3.12 "$VENV"
uv pip install --python "$VENV/bin/python" -r "${ROOT}/services/assistant/requirements.txt" pywebview

# Ad-hoc sign so a local double-click is less likely to be blocked.
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep -s - "$APP" 2>/dev/null || true
fi
xattr -cr "$APP" 2>/dev/null || true

echo "→ Creating DMG"
DMG_ROOT="${OUT}/dmg-app-root"
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
cp -R "$APP" "$DMG_ROOT/Yggdrasil.app"
cp "${ROOT}/LICENSE" "$DMG_ROOT/LICENSE"
ln -s /Applications "$DMG_ROOT/Applications"
cat > "$DMG_ROOT/README.txt" << 'EOF'
Yggdrasil

© 2026 Kamil Nadaf  ·  MIT License

1. Drag Yggdrasil into Applications.
2. Open it. If macOS warns, right-click → Open → Open.
3. Open it. First launch asks where to save your notes, then may install
   LaTeX once (needs internet). After that the app opens normally.

Your notes can live anywhere you choose on first launch.
Change the path any time in Settings → Data.

In Settings → AI Providers, pick LM Studio / Claude / DeepSeek etc.
Ollama is optional — not required for Ask when you use an API key.
EOF

rm -f "$DMG"
hdiutil create -volname "Yggdrasil" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG"
xattr -c "$DMG" 2>/dev/null || true

echo
echo "Wrote $APP"
echo "Wrote $DMG"
echo "Size: $(du -h "$DMG" | awk '{print $1}')"
