# Yggdrasil — share / test pack

This folder is **not** a rewrite of the app. It wraps the existing Docker Compose
stack so you can copy the project to another Mac, Windows, or Linux machine.

Yggdrasil is a local web app (browser at `http://localhost:8000`), not a
standalone native binary. A real `.exe` / App Store `.dmg` would mean wrapping
it in Electron or Tauri and changing the product. This pack does not do that.

## What a friend needs

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac / Windows)
   or Docker Engine + Compose (Linux)
2. This folder (the `.tar.gz` you send them)
3. About 8–12 GB disk for the first image build (LaTeX image is large)

Ollama is **optional**. Without it, Daily ArXiv / Search / Notes / Tasks / Graph /
LaTeX still work. Ask (embeddings) and the indexer need a reachable Ollama.

## Start

**Mac (DMG)** — open `Yggdrasil-*-mac.dmg`, drag **Yggdrasil** into Applications,
then double-click it (or right-click → Open if macOS blocks it). First launch
copies files to `~/Yggdrasil` because a DMG is read-only. Docker Desktop must
already be running.

**Mac / Linux (folder / tar.gz)** — double-click `Start Yggdrasil.command`, or:

```bash
bash packaging/start.sh
```

**Windows** — double-click `Start Yggdrasil.bat`, or in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File packaging\start.ps1
```

The first run builds images (`docker compose up --build`). Later runs are faster.
When the assistant container is up, the script opens `http://localhost:8000`.

## Stop

```bash
docker compose down
```

## What gets created on their machine

- `.env` from `.env.example` if missing
- `VAULT_HOST_PATH` pointed at `./vault` in this folder (empty starter vault)
- Vault folders via `scripts/init-vault.sh`

They should **not** point `VAULT_HOST_PATH` at your research vault if you are
only collecting UI feedback.
