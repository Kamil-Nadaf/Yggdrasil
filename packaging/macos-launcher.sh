#!/bin/bash
# Yggdrasil.app entry point: copy the bundled project to a writable folder,
# then start Docker Compose. The DMG volume is read-only, so we never run
# from /Volumes/Yggdrasil.
set -euo pipefail

INSTALL="${YGGDRASIL_INSTALL_DIR:-$HOME/Yggdrasil}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_APP="$(cd "$HERE/../Resources/app" && pwd)"
LOG="$HOME/Library/Logs/Yggdrasil-launcher.log"
mkdir -p "$(dirname "$LOG")"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" | tee -a "$LOG"; }

die() {
  log "ERROR: $*"
  osascript -e "display dialog \"$*\" with title \"Yggdrasil\" buttons {\"OK\"} default button \"OK\" with icon stop" >/dev/null || true
  exit 1
}

if [ ! -f "$BUNDLE_APP/docker-compose.yml" ]; then
  die "This copy of Yggdrasil.app is incomplete (missing docker-compose.yml). Re-download the DMG."
fi

if ! command -v docker >/dev/null 2>&1; then
  die "Docker Desktop is required.

Install it from https://www.docker.com/products/docker-desktop/
Then open Docker Desktop and wait until it says it is running, and open Yggdrasil again."
fi

if ! docker info >/dev/null 2>&1; then
  die "Docker is installed but not running.

Open Docker Desktop from Applications and wait until the whale icon is idle, then open Yggdrasil again."
fi

log "Installing / updating files → $INSTALL"
mkdir -p "$INSTALL"
# Do not clobber a tester's .env or vault on later launches.
rsync -a --delete \
  --exclude '.env' \
  --exclude 'vault/' \
  --exclude 'release/' \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  "$BUNDLE_APP/" "$INSTALL/"

chmod +x "$INSTALL/packaging/start.sh" \
  "$INSTALL/packaging/Start Yggdrasil.command" \
  "$INSTALL/scripts/init-vault.sh" 2>/dev/null || true

# A double-clickable command in the install folder (writable).
cat > "$INSTALL/Start Yggdrasil.command" << 'CMD'
#!/bin/bash
cd "$(dirname "$0")"
exec bash packaging/start.sh
CMD
chmod +x "$INSTALL/Start Yggdrasil.command"

if [ "${YGGDRASIL_INSTALL_ONLY:-}" = "1" ]; then
  log "Install-only mode — skipped Docker start"
  exit 0
fi

log "Launching start.sh from $INSTALL"
osascript <<EOF
tell application "Terminal"
  activate
  do script "clear; echo 'Yggdrasil — first start can take several minutes while Docker builds images.'; echo; cd $(printf %q "$INSTALL") && bash packaging/start.sh; echo; echo 'This window can stay open. To stop: docker compose down'; echo"
end tell
EOF
