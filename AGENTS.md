# Yggdrasil — Agent Build Instructions

You are building a self-hosted web app for reading arXiv papers daily
using the CERIC active-reading method. The app runs entirely in Docker on a Mac mini,
served over Tailscale. No cloud deployment needed. Read this file completely before
writing any code.

---

## What this is

A browser-based reading tool with five views:

| View | Purpose |
|------|---------|
| **Triage** | Morning arXiv feed — read abstracts, write one Claim line, vote Drop/Queue/Read |
| **CERIC Editor** | Fill 5 active-reading slots + Adversarial Question for a single paper |
| **Graph** | D3 force-directed graph of [[wikilink]] connections between notes |
| **Ask** | Search own notes via `/locate` and `/ask`; optional `/examine` after CERIC complete |
| **Scores** | Daily/weekly scoring dashboard from frontmatter |

The vault is a folder of plain `.md` files synced via Syncthing. All state lives in
YAML frontmatter of those files. Docker containers mount the vault as a bind mount.

---

## Repository structure

```
yggdrasil/
├── AGENTS.md                        ← this file
├── docker-compose.yml
├── .env.example
├── .gitignore
├── scripts/
│   └── init-vault.sh                ← creates vault folder structure
├── vault/                           ← gitignored; bind-mounted into containers
└── services/
    ├── arxiv-daily/                 ← cron: fetches arXiv feed, writes Brief.md
    │   ├── Dockerfile
    │   ├── main.py
    │   └── requirements.txt
    ├── indexer/                     ← watchdog: chunks .md files → LanceDB via Ollama
    │   ├── Dockerfile
    │   ├── main.py
    │   └── requirements.txt
    └── assistant/                   ← FastAPI: API + Gate + serves React frontend
        ├── Dockerfile               ← multi-stage: builds React then serves via FastAPI
        ├── main.py                  ← FastAPI app, all routes
        ├── gate.py                  ← Gate logic (CRITICAL — read carefully)
        ├── zotero.py                ← Zotero Web API + Better BibTeX integration
        ├── requirements.txt
        └── frontend/                ← React + Vite + TypeScript
            ├── package.json
            ├── vite.config.ts
            ├── index.html
            └── src/
                ├── main.tsx
                ├── App.tsx
                ├── api/client.ts    ← all fetch calls to FastAPI
                ├── components/
                │   ├── Nav.tsx
                │   └── GateIndicator.tsx
                └── views/
                    ├── Triage.tsx
                    ├── CERICEditor.tsx
                    ├── GraphView.tsx
                    ├── AskView.tsx
                    └── ScoresView.tsx
```

---

## Vault folder structure

The `vault/` directory on the host (set via `VAULT_HOST_PATH` in `.env`) must have
this layout. Run `scripts/init-vault.sh` to create it.

```
vault/
├── 00-Inbox/        ← arxiv-daily writes Brief-YYYY-MM-DD.md here
├── 10-Papers/       ← one note per paper: {citekey}.md
├── 20-Concepts/     ← concept notes: {slug}.md
├── 30-Questions/    ← open question notes
├── 40-Synthesis/    ← weekly synthesis notes
├── 50-Projects/     ← project notes (AstroSentinel, thesis-ch1, etc.)
└── 60-Meta/
    ├── Dashboard.md
    ├── Ledger.md
    └── Confusions.md
```

---

## Note format — YAML frontmatter schema

Every file in `10-Papers/` must have this frontmatter exactly. The Gate reads it.

```yaml
---
citekey: zhang2011internal          # Better BibTeX key — also the filename (no .md)
arxiv: "1009.3338"                  # arXiv ID (string, no version suffix)
title: "Internal shocks in GRBs"
authors: ["Zhang, B.", "Pe'er, A."]
year: 2011
journal: "ApJ"
doi: "10.1088/0004-637X/726/2/90"

read: "2026-09-09"                  # ISO date string
tier: 1                             # 0=triage only, 1=skeleton, 2=deep
confidence: 0                       # 1–5: 1=can't paraphrase, 3=explain in meeting, 5=reproduce
rating: 0                           # 1–5: worth returning to

# CERIC slots — Gate checks all five are non-empty strings
claim: ""
evidence: ""
reasoning: ""
implications: ""
context: ""                         # must name a specific citekey: "Argues against: [X]"

aq_written: false                   # flip to true after writing Adversarial Question
adversarial_question: ""            # the question text itself

verdict: ""                         # drop | queue | read

objects: []                         # e.g. ["GRB 080916C", "GRB 221009A"]
instruments: []                     # e.g. ["Fermi/GBM", "Swift/BAT"]
methods: []                         # e.g. ["spectral fitting", "temporal analysis"]
concepts: []                        # wikilinks e.g. ["[[internal-shock-model]]"]
tags: []                            # e.g. ["prompt-emission", "Amati-relation"]
---
```

Note body format (after frontmatter):

```markdown
## Claim
<!-- written by user, then copied to frontmatter -->

## Evidence
<!-- which figure carries it — what would it look like if false? -->

## Reasoning
<!-- where is the leap — which step requires trust not data? -->

## Implications
<!-- if this holds, what observation would settle it? -->

## Context
<!-- what gap made this necessary — which paper does it argue against? -->
  Argues against: [[citekey]]

## Adversarial Question
<!-- write ONE sharp question a referee would ask -->

## Confusions
<!-- list confusions; chase exactly one, rest stay here -->

> [!ai]
> <!-- AI output only goes in this callout — never outside it -->
```

---

## The Gate — CRITICAL, do not soften

The Gate is a **server-side check** in `gate.py`. The `/api/examine` endpoint returns
`HTTP 423 Locked` unless the note for that citekey has:
1. All five CERIC slots (`claim`, `evidence`, `reasoning`, `implications`, `context`) are non-empty strings (after `.strip()`)
2. `aq_written: true` in frontmatter

This is not a UI warning. It is a hard server rejection. Do not add a bypass flag in
the frontend. Do not add a "skip gate" button. The gate exists to prevent the user from
using AI as a summarizer before doing the active reading themselves.

`gate.py` implementation is already written — do not change its logic.

The frontend `GateIndicator` component shows which slots are filled (green dot) or
empty (grey dot) as the user types. It is informational only; the enforcement is in the server.

---

## API endpoints

All API routes are prefixed with `/api`. FastAPI serves the built React app from
`/static` and mounts it at `/` for all non-API routes.

### Papers

```
GET  /api/brief/today
  → { date, papers: [{arxiv_id, title, authors, abstract, verdict?, claim?}] }
  Reads today's Brief-YYYY-MM-DD.md from 00-Inbox/

GET  /api/papers
  → [{citekey, title, tier, confidence, read, verdict}]
  Lists all .md files in 10-Papers/

GET  /api/papers/{citekey}
  → full note object: frontmatter dict + body string

PUT  /api/papers/{citekey}
  body: { frontmatter: {...}, body: string }
  → { ok: true }
  Writes frontmatter + body back to vault. Creates file if not exists.

POST /api/papers/{citekey}/triage
  body: { claim: string, verdict: "drop"|"queue"|"read" }
  → { ok: true, citekey: string }
  Saves claim + verdict to frontmatter. If verdict=="read", creates note skeleton
  by fetching Zotero metadata (see Zotero section).
```

### AI endpoints

```
POST /api/locate
  body: { query: string, citekey?: string }
  → { results: [{text, note_path, score}] }
  Embeds query via Ollama → ANN search in LanceDB → returns top 5 chunks with source

POST /api/ask
  body: { question: string, citekey?: string }
  → { answer: string, sources: [{note_path, excerpt}] }
  Same as locate but calls Ollama for a short generated answer over retrieved context.
  Uses only vault content — never model knowledge about specific papers.

POST /api/examine
  body: { citekey: string, question: string }
  → { response: string }
  GATE PROTECTED: returns 423 if gate.is_complete(citekey) is False.
  Calls Anthropic API (claude-sonnet-4-5 or env var ANTHROPIC_MODEL).
  System prompt: "You are a rigorous PhD examiner. Quiz the student on their own
  note. Do not summarize. Do not add information not in the note. Ask follow-up
  questions. The note content follows."
  Appends note content to system prompt; student's question is user turn.
```

### Graph

```
GET /api/graph
  → { nodes: [{id, label, type, tier}], edges: [{source, target}] }
  Parses all .md files in 10-Papers/ and 20-Concepts/ for [[wikilinks]].
  type is "paper" | "concept" | "question"
```

### Zotero

```
GET /api/zotero/search?q={query}
  → { found: bool, metadata: {citekey, title, authors, year, journal, arxiv, doi} }
  Tries Better BibTeX local API first (http://localhost:23119/better-bibtex/json-rpc).
  Falls back to Zotero Web API (https://api.zotero.org/users/{ZOTERO_USER_ID}/items).
  Returns empty metadata if not found.

POST /api/zotero/ensure/{arxiv_id}
  → { citekey, metadata }
  Looks up by arXiv ID. If not found returns { found: false }.
```

### Scores

```
GET /api/scores/today
  → { date, points: int, breakdown: [{action, pts}], streak: int }

GET /api/scores/week
  → { week_start, total: int, target: 55, breakdown: [...], streak: int }
```

**Scoring rules (read from frontmatter across vault):**
- triage verdict written: 1 pt (cap 10/day)
- T1 note complete (all 5 slots filled): 5 pts
- `aq_written: true`: 2 pts (separate from above)
- concept note updated (2nd paper linked): 4 pts
- new concept/question note: 5 pts
- `tier: 2` note complete: 15 pts
- weekly synthesis in 40-Synthesis/ (≥300 words): 10 pts (cap 1/week)
- confusion marked resolved in 60-Meta/Confusions.md: 3 pts

Streak: survives if ≥3 pts earned that day. Freeze tokens: tracked in 60-Meta/Ledger.md.

---

## Frontend — React views

### Shared

- Dark theme only. Colors: bg `#0D1117`, surface `#161B27`, border `#2A3447`,
  text `#CDD9E5`, accent `#4FC3F7`, ok `#34D399`, gate/warn `#F59E0B`, crit `#F87171`.
- Font: `IBM Plex Mono` for labels/code, `IBM Plex Sans` for body. Load from Google Fonts.
- Nav: left sidebar (desktop) or bottom bar (mobile). Icons only on mobile.
- No UI framework. Plain CSS modules or vanilla CSS-in-JS. Keep it minimal.

### Triage view

- Header: today's date + paper count from brief
- Paper list: one card per paper. Shows: title, first author, year, abstract (collapsed,
  expand on click), arXiv link.
- Each card has a Claim input (single line, placeholder "What does this assert that
  wasn't known last week?") and three buttons: Drop (red) / Queue (amber) / Read (green).
- On "Read": calls `POST /api/papers/{arxiv_id}/triage`, then calls
  `GET /api/zotero/search?q={arxiv_id}` to show Zotero status (found / not found).
  If not found, shows "Add to Zotero" link using `zotero://select/library` scheme.
- Completed papers (verdict set) show a grey checkmark and collapse.
- Today's point total shown in top-right corner.

### CERIC Editor view

- Left panel: paper metadata (title, authors, journal, year, arXiv link, Zotero status).
- Main area: five labelled textareas, one per CERIC slot. Each label shows the hunting
  prompt:
  - **C — Claim**: "What does this assert that wasn't known last week?"
  - **E — Evidence**: "Which figure carries the claim? What would it look like if false?"
  - **R — Reasoning**: "Where is the leap? Which step requires trust, not data?"
  - **I — Implications**: "If this holds, what observation would settle it?"
  - **C — Context**: "What gap made this necessary? Which paper does it argue against? (cite key)"
- Below slots: Adversarial Question textarea. A toggle "AQ written ✓" flips
  `aq_written: true` in frontmatter via PUT.
- Right panel: `GateIndicator` — 6 dots (5 slots + AQ), green when filled.
  Below indicator: "Gate: LOCKED 🔒" or "Gate: OPEN 🔓".
- Save button: auto-saves on blur (debounced 800ms). Also a manual Save button.
- AI section (below gate indicator, only enabled when gate is OPEN):
  - Ask input + submit → calls `POST /api/examine`
  - Response rendered in a visually distinct callout box (amber border, labelled AI).

### Graph view

- Full-area D3 force-directed graph. Load D3 from npm (`d3` package, not CDN).
- Nodes: paper notes (blue circles, size by tier), concept notes (green diamonds),
  question notes (amber triangles).
- Edges: [[wikilink]] connections (grey lines).
- Click node → opens that note in CERIC Editor (papers) or a simple text view (concepts).
- Search input to highlight/filter nodes by title or tag.
- Zoom and pan enabled.

### Ask view

- Search input at top (full width).
- Mode toggle: Locate (returns excerpts with source) | Ask (returns generated answer).
- Results list: each result shows the source note path (clickable → opens CERIC Editor),
  a relevance score bar, and the matched excerpt.
- Separate panel: Examine (only shown if a paper is selected in CERIC Editor and gate
  is open). Ask field + response callout.

### Scores view

- Today strip: pts earned today, streak days, freeze tokens remaining.
- Progress bar: today's pts toward daily minimum (3 pt streak threshold).
- Weekly bar: total pts toward 55 pt weekly target.
- Breakdown table: action, pts, date — last 14 days.
- All data from `GET /api/scores/today` and `GET /api/scores/week`.

---

## Zotero integration detail

`zotero.py` implements two lookup strategies:

**Strategy 1 — Better BibTeX (preferred, local):**
```python
POST http://localhost:23119/better-bibtex/json-rpc
{
  "jsonrpc": "2.0", "method": "item.search",
  "params": [{"query": arxiv_id}]
}
```
Returns citekey directly. Only works when Zotero desktop is running on Mac mini.
Wrap in try/except — if unreachable, fall through to Strategy 2.

**Strategy 2 — Zotero Web API (fallback, always-on):**
```
GET https://api.zotero.org/users/{ZOTERO_USER_ID}/items
    ?q={arxiv_id}&format=json&include=data
Authorization: Zotero {ZOTERO_API_KEY}
```
Parse response for: title, creators, date, publicationTitle, DOI, extra (contains arXiv ID).
Citekey is not returned by the Web API — construct it as `{first_author_last}{year}{first_title_word}`.

Expose via `zotero.lookup(arxiv_id: str) -> dict | None`.

---

## arxiv-daily service

Runs as a cron at 06:30 CST (TZ: Asia/Shanghai). Uses the `arxiv` Python package.

Query: `cat:astro-ph.HE` filtered by keywords from `KEYWORDS` env var.
Author watch from `AUTHOR_WATCH` env var (comma-separated last names).

Output: writes `vault/00-Inbox/Brief-{YYYY-MM-DD}.md` with this format:

```markdown
---
date: "2026-09-09"
source: arxiv
category: astro-ph.HE
count: 12
---

# arXiv Brief — 2026-09-09

## Keyword matches

### [2609.01234] Title of paper
**Authors:** Zhang, B.; Pe'er, A.
**Abstract:** ...
**arXiv:** https://arxiv.org/abs/2609.01234

---

## Author watch matches
...

## All new papers today
...
```

Weekend handling: if arXiv returns no new papers (announced-date same as previous run),
write a brief note: `# arXiv Brief — {date}\n\nNo new listings today (weekend or holiday).`
Do not write a blank file.

---

## indexer service

Uses `watchdog` to monitor `vault/10-Papers/` and `vault/20-Concepts/` for file changes.

On change:
1. Read the .md file with `python-frontmatter`
2. Split body into chunks (~400 tokens, overlap 50)
3. Embed each chunk via `POST http://ollama:11434/api/embeddings`
   with `{"model": "nomic-embed-text", "prompt": chunk}`
4. Upsert into LanceDB at `/lancedb/vault.lance`
   Schema: `{id: str, citekey: str, chunk: str, embedding: vector(768), note_path: str}`

On delete: remove all chunks for that citekey from LanceDB.

Startup: index all existing files on first run if LanceDB is empty.

---

## Build order — do not skip steps

### Phase 1 (build first — gets the daily habit running)
1. `scripts/init-vault.sh`
2. `services/arxiv-daily/` — cron + Brief.md writer
3. `services/assistant/gate.py` — Gate logic (already written, do not modify logic)
4. `services/assistant/zotero.py` — Zotero lookup
5. `services/assistant/main.py` — all API routes
6. `services/assistant/frontend/` — Triage view + CERIC Editor + Nav

### Phase 2 (adds AI examination)
7. Wire `/api/examine` in main.py to Anthropic SDK
8. Add AI section to CERIC Editor frontend
9. GateIndicator component

### Phase 3 (adds search and graph)
10. `services/indexer/` — watchdog + LanceDB ingest
11. Wire `/api/locate` and `/api/ask` in main.py via LanceDB
12. Graph view frontend (D3)
13. Ask view frontend

### Phase 4 (completes the system)
14. Scores view frontend
15. `/api/scores/today` and `/api/scores/week` endpoints
16. Mobile-responsive layout

---

## Hard constraints — do not violate

1. **Never write into any CERIC slot** from server or AI code. The five slots are written
   ONLY by the user. The server reads them (for the Gate), never sets them.
2. **Never call Anthropic API** from any endpoint except `/api/examine`, and only after
   `gate.is_complete()` returns True.
3. **AI output always goes in a callout block** in the frontend — visually distinct from
   the user's own writing. Label it `AI · /examine` with amber styling.
4. **Never summarize a paper** automatically. The `/api/ask` endpoint searches the user's
   own notes — it does not fetch the paper PDF or abstract and summarize it.
5. **vault/ is read-only for indexer** and **read-only for assistant**. Only `arxiv-daily`
   writes to 00-Inbox. The user writes to 10-Papers via the CERIC Editor PUT endpoint.
6. The Gate check in `gate.py` must not be modified. Do not add `bypass` parameters.
7. All `.md` writes must use `python-frontmatter` to preserve existing frontmatter keys.
   Never overwrite frontmatter by hand-writing YAML strings.

---

## Environment variables (.env)

```
# Vault
VAULT_HOST_PATH=/data/grb-vault        # absolute path on host; bind-mounted into containers

# arXiv
ARXIV_QUERY=cat:astro-ph.HE
KEYWORDS=GRB,gamma-ray burst,prompt emission,internal shock,afterglow,magnetar
AUTHOR_WATCH=Zhang,Burgess,Iyyani,Ravasio,Beniamini,Pe'er
TZ=Asia/Shanghai

# Zotero
ZOTERO_USER_ID=                         # numeric user ID from zotero.org/settings/keys
ZOTERO_API_KEY=                         # personal API key from zotero.org/settings/keys

# AI
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5

# Ollama
OLLAMA_URL=http://ollama:11434
EMBED_MODEL=nomic-embed-text

# Gate
GATE_CHECK=true                         # set to false ONLY during initial development testing
```

---

## First-run checklist (for human, not agent)

1. Copy `.env.example` to `.env` and fill in all values
2. Set `VAULT_HOST_PATH` to an existing directory (or run `scripts/init-vault.sh`)
3. `docker compose up -d ollama`
4. `docker exec grb-ollama ollama pull nomic-embed-text`
5. `docker compose up -d arxiv-daily` — confirm Brief.md appears next morning
6. `docker compose up -d assistant` — open `http://mac-mini-tailscale-ip:8000`
7. `docker compose up -d indexer` — after ~20 notes exist in vault
