#!/usr/bin/env bash
# Build a macOS .dmg that is actually installable:
#   - volume contains only Yggdrasil.app + Applications shortcut + a short readme
#   - the full project lives inside the app (Contents/Resources/app)
#   - first launch copies to ~/Yggdrasil (writable) then starts Docker
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d)"
OUT="${ROOT}/release"
DMG_ROOT="${OUT}/dmg-root"
APP="${DMG_ROOT}/Yggdrasil.app"
PAYLOAD="${APP}/Contents/Resources/app"
DMG="${OUT}/Yggdrasil-${STAMP}-mac.dmg"

rm -rf "$DMG_ROOT"
mkdir -p "${APP}/Contents/MacOS" "${PAYLOAD}"

cat > "${APP}/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Yggdrasil</string>
  <key>CFBundleDisplayName</key><string>Yggdrasil</string>
  <key>CFBundleIdentifier</key><string>local.yggdrasil.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Yggdrasil</string>
  <key>CFBundleIconFile</key><string>Yggdrasil</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

cp "${ROOT}/packaging/macos-launcher.sh" "${APP}/Contents/MacOS/Yggdrasil"
cp "${ROOT}/desktop/icons/Yggdrasil.icns" "${APP}/Contents/Resources/Yggdrasil.icns"
chmod +x "${APP}/Contents/MacOS/Yggdrasil"

rsync -a \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude 'vault' \
  --exclude 'data' \
  --exclude 'release' \
  --exclude 'services/assistant/frontend/dist' \
  --exclude 'services/assistant/frontend/.vite' \
  --exclude '__pycache__' \
  --exclude '.DS_Store' \
  --exclude '*.pyc' \
  --exclude '.claude' \
  "${ROOT}/" "${PAYLOAD}/"

ln -s /Applications "${DMG_ROOT}/Applications"

cat > "${DMG_ROOT}/README.txt" << 'EOF'
Yggdrasil for Mac

1. Install Docker Desktop and wait until it is running:
   https://www.docker.com/products/docker-desktop/

2. Drag Yggdrasil into Applications (or just double-click it).

3. If macOS says the app cannot be opened, right-click Yggdrasil
   → Open → Open.

4. First launch copies the app to ~/Yggdrasil and builds Docker
   images. That can take several minutes. A Terminal window shows
   progress, then http://localhost:8000 opens.

Stop later with:  cd ~/Yggdrasil && docker compose down
EOF

# Ad-hoc signature so local Gatekeeper is less likely to refuse the app.
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep -s - "$APP" 2>/dev/null || true
fi
xattr -cr "$APP" 2>/dev/null || true

rm -f "$DMG"
hdiutil create -volname "Yggdrasil" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG"
xattr -c "$DMG" 2>/dev/null || true

echo "Wrote $DMG"
echo "Size: $(du -h "$DMG" | awk '{print $1}')"
echo
echo "To test: open the DMG, drag Yggdrasil to Applications (or double-click)."
echo "Files are installed to ~/Yggdrasil so the read-only disk image can stay ejected."
