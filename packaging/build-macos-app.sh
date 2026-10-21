#!/usr/bin/env bash
# Build a friend-installable Mac app (no Docker). Double-click → window.
# Embeds a universal (arm64+x86_64) standalone Python — no system Python needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d)"
OUT="${ROOT}/release"
APP="${OUT}/Yggdrasil.app"
RES="${APP}/Contents/Resources"
APPDIR="${RES}/app"
PYDIR="${RES}/python"          # standalone Python lives here
# NOTE: no venv. A venv symlinks to its build-time absolute path, which breaks as
# soon as the app is installed anywhere else. We install packages straight into
# the relocatable standalone Python instead.
VENV="${PYDIR}"
DMG="${OUT}/Yggdrasil-${STAMP}-mac.dmg"
FRONTEND="${ROOT}/services/assistant/frontend"

# ── Universal Python setup ──────────────────────────────────────────────────
# Downloads python-build-standalone for arm64 + x86_64, creates a universal
# binary via lipo, then builds the venv on top of it.
PY_VER="3.12.5"
PY_DATE="20240814"
PY_ARM64_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PY_DATE}/cpython-${PY_VER}+${PY_DATE}-aarch64-apple-darwin-install_only.tar.gz"
PY_X86_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PY_DATE}/cpython-${PY_VER}+${PY_DATE}-x86_64-apple-darwin-install_only.tar.gz"
PY_CACHE="/tmp/ygg-py-cache"
PY_ARM64_TGZ="${PY_CACHE}/py-arm64.tar.gz"
PY_X86_TGZ="${PY_CACHE}/py-x86.tar.gz"
LIPO_PYTHON="${PY_CACHE}/python-universal/bin/python3.12"

mkdir -p "${PY_CACHE}/py-arm64" "${PY_CACHE}/py-x86_64" "${PY_CACHE}/python-universal/bin"

if [ ! -f "${LIPO_PYTHON}" ]; then
  echo "→ Downloading standalone Python ${PY_VER} (arm64 + x86_64)..."
  [ -f "$PY_ARM64_TGZ" ] || curl -fL "$PY_ARM64_URL" -o "$PY_ARM64_TGZ"
  [ -f "$PY_X86_TGZ"   ] || curl -fL "$PY_X86_URL"   -o "$PY_X86_TGZ"

  echo "→ Extracting..."
  tar -xzf "$PY_ARM64_TGZ" -C "${PY_CACHE}/py-arm64"
  tar -xzf "$PY_X86_TGZ"   -C "${PY_CACHE}/py-x86_64"

  echo "→ Creating universal binary via lipo..."
  lipo -create \
    "${PY_CACHE}/py-arm64/python/bin/python3.12" \
    "${PY_CACHE}/py-x86_64/python/bin/python3.12" \
    -output "${LIPO_PYTHON}"
  chmod +x "${LIPO_PYTHON}"
fi

# ── Frontend ────────────────────────────────────────────────────────────────
echo "→ Building frontend"
cd "$FRONTEND"
if [ ! -d node_modules ]; then
  npm ci
fi
./node_modules/.bin/tsc --noEmit
npm run build

# ── Assemble .app ───────────────────────────────────────────────────────────
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
  <key>CFBundleVersion</key><string>0.2</string>
  <key>CFBundleShortVersionString</key><string>0.2</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Yggdrasil</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key>
  <string>© 2026 Kamil Nadaf. MIT License.</string>
</dict>
</plist>
EOF

# Launcher uses bundled Python directly (no venv symlink)
cat > "${APP}/Contents/MacOS/Yggdrasil" << 'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$DIR/../Resources"
export YGG_RESOURCES="$RES/app"
export YGG_BUNDLE="$RES"
export PYTHONUNBUFFERED=1
# Bundled standalone Python — relocatable, no system Python dependency
exec "$RES/python/bin/python3" "$RES/desktop/launch.py"
EOF
chmod +x "${APP}/Contents/MacOS/Yggdrasil"

cp "${ROOT}/desktop/launch.py"         "${RES}/desktop/launch.py"
cp "${ROOT}/desktop/setup.py"          "${RES}/desktop/setup.py"
cp "${ROOT}/desktop/splash.html"       "${RES}/desktop/splash.html"
cp "${ROOT}/desktop/yggdrasil-logo.png" "${RES}/desktop/yggdrasil-logo.png"
cp "${ROOT}/services/assistant/main.py"          "${APPDIR}/main.py"
cp "${ROOT}/services/assistant/gate.py"          "${APPDIR}/gate.py"
cp "${ROOT}/services/assistant/zotero.py"        "${APPDIR}/zotero.py"
cp "${ROOT}/services/assistant/data_manifest.py" "${APPDIR}/data_manifest.py"
cp "${ROOT}/services/assistant/graph_links.py"   "${APPDIR}/graph_links.py"
cp "${ROOT}/services/assistant/analysis_tags.py" "${APPDIR}/analysis_tags.py"
cp "${ROOT}/services/assistant/arxiv_topics.py"  "${APPDIR}/arxiv_topics.py"
cp "${ROOT}/services/assistant/task_statuses.py" "${APPDIR}/task_statuses.py"
cp "${ROOT}/services/assistant/goals.py"         "${APPDIR}/goals.py"
cp "${ROOT}/services/assistant/mcp_server.py"    "${APPDIR}/mcp_server.py"
rm -rf "${APPDIR}/frontend"
mkdir -p "${APPDIR}/frontend"
cp -R "${FRONTEND}/dist" "${APPDIR}/frontend/dist"
mkdir -p "${RES}/latex" "${RES}/feynman"
cp "${ROOT}/services/latex/latex_service.py"     "${RES}/latex/latex_service.py"
cp -R "${ROOT}/services/latex/aastex"            "${RES}/latex/aastex"
cp -R "${ROOT}/services/latex/posters"           "${RES}/latex/posters"
cp "${ROOT}/services/feynman/terminal_server.py" "${RES}/feynman/terminal_server.py"

# ── Bundled Python venv (universal binary base) ─────────────────────────────
echo "→ Copying standalone Python into bundle (binary + shared libs)..."
# Must copy the full python stdlib/lib tree — the binary links against libpython3.12.dylib
# which lives in python/lib/; copying just the binary causes dyld to abort.
# Strategy: copy full arm64 python dir as base, then lipo-replace just the executables.
rm -rf "$PYDIR"
cp -R "${PY_CACHE}/py-arm64/python" "$PYDIR"

# Replace each Mach-O executable with its universal counterpart via lipo
for ARM_BIN in "${PY_CACHE}/py-arm64/python/bin/"*; do
  BASENAME="$(basename "$ARM_BIN")"
  X86_BIN="${PY_CACHE}/py-x86_64/python/bin/$BASENAME"
  OUT_BIN="${PYDIR}/bin/$BASENAME"
  if [ -f "$ARM_BIN" ] && [ -f "$X86_BIN" ] && [ -x "$ARM_BIN" ]; then
    lipo -create "$ARM_BIN" "$X86_BIN" -output "$OUT_BIN" 2>/dev/null || cp "$ARM_BIN" "$OUT_BIN"
  fi
done

# Also lipo libpython dylib so it runs on Intel Macs too
ARM_LIB="${PY_CACHE}/py-arm64/python/lib/libpython3.12.dylib"
X86_LIB="${PY_CACHE}/py-x86_64/python/lib/libpython3.12.dylib"
if [ -f "$ARM_LIB" ] && [ -f "$X86_LIB" ]; then
  lipo -create "$ARM_LIB" "$X86_LIB" -output "${PYDIR}/lib/libpython3.12.dylib" 2>/dev/null || true
fi

echo "→ Installing Python dependencies..."
"${PYDIR}/bin/python3.12" -m pip install --upgrade pip
"${PYDIR}/bin/python3.12" -m pip install \
  -r "${ROOT}/services/assistant/requirements.txt" \
  pywebview \
  --no-cache-dir

# Verify the venv python is a real binary (not a broken symlink)
VENV_PYTHON="$(readlink -f "${VENV}/bin/python3" 2>/dev/null || echo "${VENV}/bin/python3")"
file "$VENV_PYTHON"
echo "→ Python arch: $(python3 -c 'import platform; print(platform.machine())' 2>/dev/null || lipo -archs "${VENV}/bin/python3.12" 2>/dev/null || echo unknown)"

# ── Ad-hoc sign ─────────────────────────────────────────────────────────────
if command -v codesign >/dev/null 2>&1; then
  echo "→ Ad-hoc signing..."
  codesign --force --deep -s - "$APP" 2>/dev/null || true
fi
xattr -cr "$APP" 2>/dev/null || true

# ── DMG ─────────────────────────────────────────────────────────────────────
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
3. First launch asks where to save your notes, then may install
   LaTeX once (needs internet).

Your notes can live anywhere — change in Settings → Data.
Settings → AI Providers: LM Studio / Claude / DeepSeek etc.
Ollama is optional.
EOF

rm -f "$DMG"
hdiutil create -volname "Yggdrasil" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG"
xattr -c "$DMG" 2>/dev/null || true

# ── PKG ──────────────────────────────────────────────────────────────────────
echo "→ Creating PKG installer"
PKG_ROOT="${OUT}/pkg-root"
PKG_SCRIPTS="${OUT}/pkg-scripts"
rm -rf "$PKG_ROOT" "$PKG_SCRIPTS"
mkdir -p "$PKG_ROOT/Applications" "$PKG_SCRIPTS"
cp -R "$APP" "$PKG_ROOT/Applications/Yggdrasil.app"

cat > "$PKG_SCRIPTS/postinstall" << 'EOF'
#!/bin/bash
xattr -cr "/Applications/Yggdrasil.app" 2>/dev/null || true
exit 0
EOF
chmod +x "$PKG_SCRIPTS/postinstall"

PKG_UNSIGNED="${OUT}/Yggdrasil.pkg"
rm -f "$PKG_UNSIGNED"
pkgbuild \
  --root "$PKG_ROOT" \
  --scripts "$PKG_SCRIPTS" \
  --identifier io.yggdrasil.app \
  --version 0.2 \
  "$PKG_UNSIGNED"

DIST_XML="${OUT}/distribution.xml"
cat > "$DIST_XML" << EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
    <title>Yggdrasil</title>
    <organization>io.yggdrasil</organization>
    <domains enable_localSystem="false"/>
    <options customize="never" require-scripts="true" rootVolumeOnly="true" />
    <choices-outline>
        <line choice="yggdrasil"/>
    </choices-outline>
    <choice id="yggdrasil" title="Yggdrasil" description="Install Yggdrasil to /Applications">
        <pkg-ref id="io.yggdrasil.app">Yggdrasil.pkg</pkg-ref>
    </choice>
    <pkg-ref id="io.yggdrasil.app" version="0.2" onConclusion="none">Yggdrasil.pkg</pkg-ref>
</installer-gui-script>
EOF

PKG="${OUT}/Yggdrasil-${STAMP}-mac.pkg"
rm -f "$PKG"
productbuild \
  --distribution "$DIST_XML" \
  --package-path "$OUT" \
  --resources "$PKG_SCRIPTS" \
  "$PKG"
rm -f "$PKG_UNSIGNED" "$DIST_XML"

echo
echo "✓ Wrote $APP"
echo "✓ Wrote $DMG"
echo "✓ Wrote $PKG"
echo "  DMG size: $(du -h "$DMG" | awk '{print $1}')"
echo "  PKG size: $(du -h "$PKG" | awk '{print $1}')"
echo
echo "Universal binary check:"
lipo -archs "$APP/Contents/MacOS/Yggdrasil" 2>/dev/null || echo "  (launcher is shell script — check venv python)"
lipo -archs "${VENV}/bin/python3.12" 2>/dev/null || true
