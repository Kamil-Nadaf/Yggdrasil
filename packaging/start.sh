#!/usr/bin/env bash
# Launch Yggdrasil via Docker Compose. Safe to double-click via the .command wrapper.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Desktop, then run this again:"
  echo "  https://www.docker.com/products/docker-desktop/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Open Docker Desktop and wait until it is ready."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  # Point the vault at this copy of the project, not the original author's path.
  if [[ "$OSTYPE" == darwin* ]] || [[ "$OSTYPE" == linux* ]]; then
    sed -i.bak "s|^VAULT_HOST_PATH=.*|VAULT_HOST_PATH=${ROOT}/vault|" .env
    rm -f .env.bak
  fi
  echo "Created .env (vault → ${ROOT}/vault)"
fi

# shellcheck disable=SC1091
set -a
# Load VAULT_HOST_PATH without treating the rest of .env as required
VAULT_HOST_PATH="${VAULT_HOST_PATH:-}"
if [ -f .env ]; then
  VAULT_HOST_PATH="$(grep -E '^VAULT_HOST_PATH=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
set +a
VAULT_HOST_PATH="${VAULT_HOST_PATH:-${ROOT}/vault}"
export VAULT_HOST_PATH
mkdir -p "$VAULT_HOST_PATH"
bash scripts/init-vault.sh

echo "Starting Yggdrasil (first run builds images — this can take a while)…"
docker compose up -d --build

echo "Waiting for http://localhost:8000 …"
for i in $(seq 1 90); do
  if curl -sf http://localhost:8000 >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if command -v open >/dev/null 2>&1; then
  open "http://localhost:8000"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:8000"
fi

echo "Yggdrasil is running at http://localhost:8000"
echo "Stop with:  cd \"$ROOT\" && docker compose down"
