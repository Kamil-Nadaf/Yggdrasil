#!/usr/bin/env bash
# Build a cross-platform share archive. Does not modify application source.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d)"
NAME="Yggdrasil-share-${STAMP}"
OUT="${ROOT}/release"
STAGE="${OUT}/${NAME}"

rm -rf "$STAGE"
mkdir -p "$STAGE"

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
  "${ROOT}/" "${STAGE}/"

chmod +x \
  "${STAGE}/packaging/start.sh" \
  "${STAGE}/packaging/Start Yggdrasil.command" \
  "${STAGE}/scripts/init-vault.sh" \
  "${STAGE}/packaging/build-share.sh" \
  "${STAGE}/packaging/build-macos-dmg.sh" 2>/dev/null || true

# Friendly copies at the archive root so testers see them immediately.
cp "${STAGE}/packaging/README.md" "${STAGE}/HOW-TO-RUN.txt"
cp "${STAGE}/packaging/Start Yggdrasil.command" "${STAGE}/Start Yggdrasil.command"
cp "${STAGE}/packaging/Start Yggdrasil.bat" "${STAGE}/Start Yggdrasil.bat"
chmod +x "${STAGE}/Start Yggdrasil.command"

mkdir -p "$OUT"
tar -C "$OUT" -czf "${OUT}/${NAME}.tar.gz" "$NAME"
echo "Wrote ${OUT}/${NAME}.tar.gz"
echo "Size: $(du -h "${OUT}/${NAME}.tar.gz" | awk '{print $1}')"
