#!/usr/bin/env bash
# Install the latest Yggdrasil without opening the Releases page.
#   curl -fsSL https://raw.githubusercontent.com/Kamil-Nadaf/Yggdrasil/main/scripts/install.sh | bash
# macOS: copies Yggdrasil.app to /Applications.  Linux: runs the bundled installer (~/.local/share/Yggdrasil).
# Pick a version:  ... | bash -s -- v0.4.36
set -euo pipefail

REPO="Kamil-Nadaf/Yggdrasil"
TAG="${1:-latest}"
API="https://api.github.com/repos/${REPO}/releases/${TAG}"
[ "$TAG" = "latest" ] || API="https://api.github.com/repos/${REPO}/releases/tags/${TAG}"

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in
  Darwin) case "$ARCH" in arm64) PAT="mac-arm64.dmg" ;; x86_64) PAT="mac-intel.dmg" ;; *) echo "Unsupported Mac: $ARCH"; exit 1 ;; esac ;;
  Linux)  case "$ARCH" in x86_64|aarch64|arm64) PAT="linux.tar.gz" ;; *) echo "Unsupported CPU: $ARCH"; exit 1 ;; esac ;;
  *) echo "This script supports macOS and Linux. On Windows use scripts/install.ps1 (see INSTALL.md)."; exit 1 ;;
esac

echo "→ Finding the ${TAG} release"
URL="$(curl -fsSL "$API" | grep -o "https://[^\"]*${PAT}" | head -n1 || true)"
[ -n "$URL" ] || { echo "No ${PAT} file in that release."; exit 1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "→ Downloading $(basename "$URL")"
curl -fL --progress-bar -o "$TMP/pkg" "$URL"

if [ "$OS" = "Darwin" ]; then
  MNT="$TMP/mnt"; mkdir -p "$MNT"
  hdiutil attach "$TMP/pkg" -nobrowse -quiet -mountpoint "$MNT"
  rm -rf /Applications/Yggdrasil.app
  cp -R "$MNT/Yggdrasil.app" /Applications/
  hdiutil detach "$MNT" -quiet || true
  xattr -dr com.apple.quarantine /Applications/Yggdrasil.app 2>/dev/null || true
  echo "✓ Installed to /Applications/Yggdrasil.app"
else
  tar -xzf "$TMP/pkg" -C "$TMP"
  (cd "$TMP/Yggdrasil-linux" && ./install.sh)
fi
