# Yggdrasil mobile

Mobile companion for Yggdrasil. It is a phone-friendly client of your **running Yggdrasil backend** (the desktop app or
the self-hosted `assistant` service on port 8000), so the phone and the desktop always show the same vault:
dashboard, daily arXiv with search and Zotero-linked saving, library collections, notes, LaTeX and tasks.
A small Node server in one Docker image serves the PWA and proxies `/ygg/api/*` to the backend.

Themes (Settings, gear icon top right): **Dark, Light, Paper, Notebook**. Notebook and Paper copy the desktop app's tokens; Notebook derives its palette from the accent colour (default purple), Paper is fixed black on cream. Fonts are bundled, so they work offline. The app icon is the Yggdrasil logo (`public/icon-*.png`, generated from `desktop/yggdrasil-logo.png`).

Top right: **sync** button (refetches everything from the vault) and settings. Settings → **Check for updates** compares the running build with the server's `/version.json` and reloads into the new version, so after `docker compose up -d --build` you just tap it, no reinstall. Connection page also stores your Zotero user ID and API key on the Yggdrasil backend (same as desktop).

Tabs: **Today · Notes · arXiv · Library · Write**. Tasks and the connection page are reached from Today.

## Run

```bash
docker compose up --build            # http://localhost:8080
SYNC_TOKEN=choose-a-long-secret docker compose up -d --build
```

Image only: `docker build -t yggdrasil-mobile .` then
`docker run -p 8080:8080 -e SYNC_TOKEN=... -v ygg-data:/data yggdrasil-mobile`.

`docker build` runs the typecheck, the production build and the server tests, so a green build is
already a passing build. Behind a TLS-intercepting proxy add `--secret id=ca,src=/path/ca.crt`.

### On your phone

Open the server URL in Chrome on Android, then menu → **Install app**.
Install, offline use and the PDF cache need **HTTPS** (or localhost). Easiest options for a home server:
`tailscale serve --bg 8080` (gives you an https `*.ts.net` URL on your tailnet), or a Cloudflare tunnel.
Set `SYNC_TOKEN` before exposing it anywhere, then paste the same token in the app under Today → settings icon → Connection.

## Android app

`Yggdrasil-*-android.apk` is built by the Release workflow (`.github/workflows/release.yml`, job `android`) with Capacitor. It is a thin shell: on first launch enter the address of your phone server (for example `http://<tailscale-ip>:8080`), and it opens that server full-screen. Because the UI is loaded from the server, `docker compose up -d --build` updates the Android app too (Settings → Check for updates), no new APK needed. Gear → Connection → **Change server** returns to the address screen. The APK is debug-signed (install with "allow from this source"); cleartext http is allowed so Tailscale/LAN addresses work.

## Config

| Env | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `YGG_BACKEND` | `http://host.docker.internal:8000` | Your Yggdrasil backend. Same Mac: the default works with Docker Desktop. Mac mini: `http://<tailscale-name>:8000` |
| `SYNC_TOKEN` | empty | Bearer token for this server. **Empty = open.** Set it before exposing the server. |
| build arg `WITH_LATEX` | `0` | Only for the old stand-alone compile route; compile now runs on the desktop's LaTeX service |

## What each screen does (all data lives in your vault)

- **Today**: Active tasks, Days left (goals + upcoming calendar events), Reading timer (logs to the same reading log as desktop),
  Activity heatmaps (habits, tasks completed), Mental health + lightcurve and today's habit toggles.
- **arXiv**: topic picker (same list as desktop), date picker, Today/Yesterday, search (within the topic), abstract view.
  **Save…** opens a collection picker with sub-collections. The paper is filed into that collection in your Library
  (PDF fetched by the backend). If the collection is linked to Zotero it is also added to that Zotero collection.
- **Library**: nested collections, search, PDF reader with page memory and reading-time logging.
- **Notes**: your `60-Meta/Notes` markdown, autosaved, preview with `[[links]]`, math/code toolbar.
- **Write**: your `70-LaTeX` files, autosaved; Compile uses the desktop's LaTeX service.
- **Tasks**: projects, main tasks, subtasks; tap a subtask to change its status.

## Develop and test

```bash
npm install && npm run dev           # vite on :5173, proxies /api to :8080 (run `npm start` too)
npm test                             # server unit tests
cd e2e && npm i && BASE=http://localhost:8080 SYNC_TOKEN=... npm test   # needs Chrome (CHROME=/path) and a backend at MOCK
```

## Not built yet

- Highlights/annotations in the phone PDF reader, books (EPUB), the Loki assistant, graph view, calendar editing.
- Offline editing: notes and LaTeX need the backend reachable (reading cached PDFs works offline over HTTPS).
- Google Drive sync: the vault is shared through the backend instead, so there is nothing to sync.
