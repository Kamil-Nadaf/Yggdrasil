# Yggdrasil — CERIC Reading System

A self-hosted Docker web app for daily paper reading and active knowledge building.
Built around the **CERIC method**: Claim · Evidence · Reasoning · Implications · Context.

## Quick Start

### 1. Prerequisites

- Docker + Docker Compose
- Syncthing (already installed on all devices)
- Tailscale (for remote access from iPad / other devices)

### 2. Initialise the vault

```bash
VAULT_HOST_PATH=/data/grb-vault bash scripts/init-vault.sh
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env — at minimum set:
#   VAULT_HOST_PATH
#   ANTHROPIC_API_KEY
#   ZOTERO_USER_ID + ZOTERO_API_KEY (optional)
```

### 4. Start

```bash
docker compose up -d
```

First run pulls the Ollama embedding model (~270 MB):

```bash
docker exec yggdrasil-ollama ollama pull nomic-embed-text
```

### 5. Access

- **Browser (any device)**: `http://<mac-mini-tailscale-ip>:8000`
- **Syncthing** syncs the vault folder to your Mac, Ubuntu, iPad

---

## Daily Workflow

```
06:30 CST: arXiv cron → Brief-YYYY-MM-DD.md + paper notes in 00-Inbox / 10-Papers
     ↓
Triage view: Read / Skip / Later each paper
     ↓ (verdict = Read)
CERIC Editor: fill Claim, Evidence, Reasoning, Implications, Context
              write Adversarial Question → check aq_written
     ↓ (all slots filled + aq_written = true)
Gate opens → /examine button active
     ↓
AI analysis appended as > [!ai] callout
     ↓
Update Concept notes in 20-Concepts/
Open new Questions in 30-Questions/
     ↓ (weekly)
Write Synthesis in 50-Syntheses/
```

---

## Services

| Container | Role |
|-----------|------|
| `yggdrasil-ollama` | nomic-embed-text embeddings |
| `yggdrasil-arxiv-daily` | 06:30 CST arXiv fetch + Brief writer |
| `yggdrasil-indexer` | Watchdog → chunk → embed → LanceDB |
| `yggdrasil-assistant` | FastAPI API + React frontend |

---

## The Gate

`/api/examine` (AI analysis) is blocked until:
1. All 5 CERIC slots are non-empty
2. `aq_written: true` in frontmatter

This is enforced server-side in `gate.py`. There is no bypass.
The Gate is the integrity mechanism — it forces you to think before AI assists.

---

## Environment Variables

See `.env.example` for all variables with comments.

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

## For Agents (Cursor / Copilot)

See **AGENTS.md** for the full build specification.
