# Yggdrasil

A personal research app: paper reading (arXiv / OpenAlex / Europe PMC), notes,
tasks, a knowledge graph, a LaTeX editor, and **Loki** — an AI assistant that
answers only from what you've written. Built around the **CERIC method**:
Claim · Evidence · Reasoning · Implications · Context.

Runs as a native desktop app (Mac / Linux / Windows, no Docker) or as a
self-hosted Docker web app.

## Install

Pick your OS. Each app is a local build — there's no download link, you build
it once on your own machine (`uv` and Node 20+ are the only requirements; see
[`packaging/DESKTOP.md`](packaging/DESKTOP.md) for details).

### macOS

```bash
bash packaging/build-macos-app.sh
```

1. Open `release/Yggdrasil-*-mac.dmg`, drag **Yggdrasil** into Applications
2. Open it. If macOS warns it's from an unidentified developer: right-click → Open → Open
3. First launch installs LaTeX (TinyTeX) once — needs internet, one-time only

### Linux

```bash
bash packaging/build-linux.sh
```

1. Extract `release/Yggdrasil-*-linux.tar.gz`
2. Run `./Yggdrasil` from inside the extracted folder
3. First launch installs LaTeX (TinyTeX) once — needs internet, one-time only

### Windows

Build on an actual Windows machine (cross-compiling isn't supported):

```powershell
powershell -File packaging/build-windows.ps1
```

1. Extract `release/Yggdrasil-*-windows.zip`
2. Double-click `Yggdrasil.bat`
3. LaTeX doesn't auto-install on Windows yet — install [MiKTeX](https://miktex.org/download)
   yourself and make sure `pdflatex`/`latexmk` are on your PATH. Everything else
   (Dashboard, Notes, Tasks, Search, Daily Archive, Graph, Loki) works without it.

### First launch (all platforms)

1. Choose a folder for your notes — anywhere you like, changeable later in
   Settings → Data
2. In Settings → AI Providers, add an API key (Claude / LM Studio / DeepSeek /
   etc.) to use Loki and paper analysis — Ollama is optional, not required

### Connect it to your coding agent

Loki's notes/papers/tasks are also reachable from Claude Code, Cursor, or any
MCP-aware IDE — see [`packaging/MCP.md`](packaging/MCP.md).

---

## Self-hosted (Docker)

For a shared, always-on server instead of a local app on one machine.

### 1. Prerequisites

- Docker + Docker Compose
- Tailscale (for remote access from other devices)

### 2. Configure

```bash
cp .env.example .env
# Edit .env — at minimum set:
#   VAULT_HOST_PATH
#   ANTHROPIC_API_KEY
#   ZOTERO_USER_ID + ZOTERO_API_KEY (optional)
```

### 3. Start

```bash
docker compose up -d
```

First run pulls the Ollama embedding model (~270 MB):

```bash
docker exec yggdrasil-ollama ollama pull nomic-embed-text
```

### 4. Access

- **Browser (any device)**: `http://<host-tailscale-ip>:8000`

---

## Daily Workflow

```
Daily Archive: browse today's papers (arXiv / OpenAlex / Europe PMC)
     ↓
Triage: Read / Skip / Later each paper
     ↓ (verdict = Read)
CERIC Editor: fill Claim, Evidence, Reasoning, Implications, Context
              write Adversarial Question → check aq_written
     ↓ (all slots filled + aq_written = true)
Gate opens → /examine button active
     ↓
AI analysis appended as > [!ai] callout
     ↓
Update Concept notes; open new Questions
     ↓ (weekly)
Write a Synthesis
```

---

## The Gate

`/api/examine` (AI analysis) is blocked until:
1. All 5 CERIC slots are non-empty
2. `aq_written: true` in frontmatter

This is enforced server-side in `gate.py`. There is no bypass.
The Gate is the integrity mechanism — it forces you to think before AI assists.

---

## Scoring

| Action | Points |
|--------|--------|
| Triage a paper | 1 pt (cap 10/day) |
| T1 CERIC complete | 5 pts |
| AQ written | 2 pts |
| Concept note updated | 4 pts |
| New concept/question | 5 pts |
| T2 reproduced result | 15 pts |
| Weekly synthesis | 10 pts (cap 1) |
| **Weekly target** | **55 pts** |

---

## For Agents (Cursor / Copilot / Claude Code)

See **AGENTS.md** for the full build specification.
