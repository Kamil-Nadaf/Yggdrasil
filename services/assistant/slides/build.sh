#!/usr/bin/env bash
# Build the PPTist slides module into <this dir>/dist (served by FastAPI at /slides).
# Usage: slides/build.sh [outdir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/dist}"
REPO="$(sed -n 1p "$HERE/PPTIST_REF")"
REF="$(sed -n 2p "$HERE/PPTIST_REF")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --filter=blob:none --no-checkout "$REPO" "$WORK/pptist"
git -C "$WORK/pptist" checkout --quiet "$REF"
cp -R "$HERE/overlay/." "$WORK/pptist/"
cp "$WORK/pptist/LICENSE" "$HERE/LICENSE" 2>/dev/null || true

# The speaker-notes placeholder is set inside the editor (ProseMirror resets any runtime translation), so patch the source.
for f in src/views/Editor/Remark/Editor.vue src/views/Mobile/MobileEditor/SlideToolbar.vue; do
  sed -i.bak "s/点击输入演讲者备注/Click to add speaker notes/" "$WORK/pptist/$f" && rm -f "$WORK/pptist/$f.bak"
done

cd "$WORK/pptist"
npm ci --no-audit --no-fund
npm install --no-save --no-audit --no-fund @fontsource/ibm-plex-sans @fontsource/ibm-plex-serif @fontsource/ibm-plex-mono
npx vite build --base=/slides/
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R dist/. "$OUT/"
cp "$HERE/NOTICE.md" "$OUT/NOTICE.md"
cp "$WORK/pptist/LICENSE" "$OUT/LICENSE"
echo "slides module built in $OUT"
