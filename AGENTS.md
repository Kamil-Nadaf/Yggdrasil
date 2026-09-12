# Yggdrasil — Agent Build Instructions

You are building a self-hosted web app for reading arXiv papers daily
using the CERIC active-reading method. The app runs entirely in Docker on a Mac mini,
served over Tailscale. No cloud deployment needed. Read this file completely before
writing any code.

---

## ⚠️ Known issue — read this before touching the vault

`.env`'s `VAULT_HOST_PATH` currently points at `/Users/kamil/Projects/Yggdrasil/data`,
**not** the original `/Users/kamil/Projects/Yggdrasil/vault`. `data/` only contains a
couple of test files; the real vault — 33+ paper notes in `10-Papers/`, daily Briefs in
`00-Inbox/`, templates in `60-Meta/` — is still sitting in `vault/`, untouched but
**orphaned from every running container**. This happened via the Settings drawer's
"Data Path" field (`services/assistant/frontend/src/components/SettingsDrawer.tsx`),
which currently defaults to a host path instead of the in-container `/vault` mount.

Before doing any further work: decide whether to point `VAULT_HOST_PATH` back at
`vault/` (recommended — that's where all real data lives) or deliberately migrate to
`data/`. Do not silently pick one — confirm with the user first, since either direction
discards/orphans real content from someone's perspective.

The Settings drawer's Data Path field should probably be constrained or removed —
right now it lets the UI write an arbitrary host-side path into `.env`-adjacent state
with no validation that it matches an actual container mount.

---

## arXiv ID matching (new + old style)

`ARXIV_ID_RE` in `services/assistant/main.py` (`/api/arxiv/search`) matches both
post-2007 IDs (`YYMM.NNNNN`, e.g. `2401.12345`) and pre-2007 archive-prefixed IDs
(`physics/0306138`, `hep-th/9901001`, `math.GT/0309136`, optional `vN` suffix).
Bare IDs and arxiv.org URLs containing either form resolve via `id_list`.

---

## What this is

A browser-based reading tool with **eight views**, navigated via a horizontal top bar
(not a sidebar — see Frontend section):

| View (nav label) | Internal id | Purpose |
|---|---|---|
| **Dashboard** | `scores` | Habit check-in + GitHub-style heatmap + weekly points (default landing view) |
| **Daily ArXiv** | `search` | 3-panel Overleaf-style workflow: Daily Papers → Shortlisted → My List (reading pane), resizable via `react-resizable-panels` |
| **Search** | `browse` | Direct arXiv search (keyword / author / title / arXiv ID-URL fields, paginated) without leaving the app; supports the same select-text→CERIC toolbar as Daily ArXiv |
| **Notes** | `editor` | Fill 5 active-reading slots + Adversarial Question for a single paper; has an internal **Collection** tab listing all papers with filters + progress bars |
| **Tasks** | `tasks` | ClickUp-style List (nested parent/sub-tasks) + Kanban (To Do / In Progress / Done) via `@dnd-kit/core`; vault `80-Tasks/` |
| **Graph** | `graph` | D3 force-directed graph of [[wikilink]] connections between notes |
| **Ask** | `ask` | Search own notes via `/locate` and `/ask`; optional `/examine` after CERIC complete |
| **LaTeX** | `latex` | Overleaf-style LaTeX editor: write → live PDF preview → save to vault, 3-pane resizable (file tree / editor / preview) |

A gear icon in the top nav opens a **Settings drawer** (theme, editor prefs, data path,
system info — see Settings section below).

The vault is a folder of plain `.md` (and `.tex`, for LaTeX) files synced via Syncthing.
All paper state lives in YAML frontmatter of `.md` files. Docker containers mount the
vault as a bind mount.

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
│                                       (see "Known issue" above — currently NOT
│                                        the active mount; .env points elsewhere)
└── services/
    ├── arxiv-daily/                 ← cron: fetches arXiv feed, writes Brief.md
    │   ├── Dockerfile
    │   ├── main.py
    │   └── requirements.txt
    ├── indexer/                     ← watchdog: chunks .md files → LanceDB via Ollama
    │   ├── Dockerfile
    │   ├── main.py
    │   └── requirements.txt
    ├── latex/                       ← FastAPI + full TeX Live: compile/save/list .tex
    │   ├── Dockerfile               ← texlive/texlive:latest base, apt-installs python3-pip first
    │   └── latex_service.py         ← internal-only (port 9000, no host port published)
    └── assistant/                   ← FastAPI: API + Gate + serves React frontend
        ├── Dockerfile               ← multi-stage: builds React then serves via FastAPI
        ├── main.py                  ← FastAPI app, all routes (proxies /api/latex/* to `latex`)
        ├── gate.py                  ← Gate logic (CRITICAL — read carefully, do not modify)
        ├── zotero.py                ← Zotero Web API + Better BibTeX integration
        ├── requirements.txt
        └── frontend/                ← React + Vite + TypeScript
            ├── package.json         ← react, d3, codemirror (+ @codemirror/*), react-resizable-panels
            ├── vite.config.ts       ← dev proxy: /api → http://localhost:8000
            ├── index.html
            └── src/
                ├── main.tsx
                ├── App.tsx           ← view routing, default view = "scores" (Dashboard)
                ├── api/client.ts     ← all fetch calls to FastAPI (single `api` object)
                ├── components/
                │   ├── Nav.tsx           ← horizontal top bar, not a sidebar
                │   ├── GateIndicator.tsx
                │   ├── CericToolbar.tsx  ← shared select-text→CERIC-slot logic
                │   │                        (CERIC_SLOTS, SlotIndicator, useCericAppend
                │   │                        hook, CericSelectionToolbar) — consumed by
                │   │                        both ArxivSearch.tsx and ArxivBrowser.tsx;
                │   │                        any new CERIC-slot UI should reuse this,
                │   │                        not reimplement it
                │   └── SettingsDrawer.tsx    ← theme/editor prefs + Data Sync (Git)
                │                                and Data Sync (Cloud/WebDAV) sections
                └── views/
                    ├── ScoresView.tsx     (Dashboard)
                    ├── ArxivSearch.tsx    (Daily ArXiv — 3-panel)
                    ├── ArxivBrowser.tsx   (Search)
                    ├── Triage.tsx
                    ├── CERICEditor.tsx    (Editor + Collection tab)
                    ├── GraphView.tsx
                    ├── AskView.tsx
                    └── LaTeXEditor.tsx
```

---

## Vault folder structure

The `vault/` directory on the host (set via `VAULT_HOST_PATH` in `.env`) must have
this layout. Run `scripts/init-vault.sh` to create it.

```
vault/
├── 00-Inbox/        ← arxiv-daily writes Brief-YYYY-MM-DD.md here
├── 10-Papers/       ← one note per paper: {citekey}.md
│                       citekey is either a Better BibTeX / Zotero-derived key
│                       (e.g. "zhang2011internal"), OR — for papers captured
│                       straight from arXiv Search before any Zotero lookup —
│                       the bare arXiv id (e.g. "2609.10384v1.md"). Both are
│                       valid citekeys; Gate/Scores/Graph don't care about format.
├── 20-Concepts/     ← concept notes: {slug}.md
├── 30-Questions/    ← open question notes
├── 40-Synthesis/    ← weekly synthesis notes
├── 50-Projects/     ← project notes (AstroSentinel, thesis-ch1, etc.)
├── 60-Meta/
│   ├── Dashboard.md
│   ├── Ledger.md
│   └── Confusions.md
└── 70-LaTeX/ ← .tex documents written in the LaTeX Editor view
 │   └── _template.tex ← starter template, excluded from the file list UI
 └── 80-Tasks/ ← one note per task: {task-id}.md (title, status, tags, parent, due, recurring)

---

## Note format — YAML frontmatter schema

Every file in `10-Papers/` must have this frontmatter exactly. The Gate reads it.

```yaml
---
citekey: zhang2011internal          # Better BibTeX key, OR bare arXiv id — also the filename (no .md)
arxiv: "1009.3338"                  # arXiv ID (string, no version suffix)
title: "Internal shocks in GRBs"
authors: ["Zhang, B.", "Pe'er, A."]
year: 2011
journal: "ApJ"
doi: "10.1088/0004-637X/726/2/90"

read: "2026-09-09"                  # ISO date string
tier: 0                             # 0=triage only, 1=skeleton, 2=deep
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

Notes created via the "append a slot" flow (see below) get a full frontmatter skeleton
written by `_ensure_paper_skeleton()` in `main.py` the first time text is appended —
same schema as above, empty body, `python-frontmatter` writes it (never hand-rolled YAML).

---

## The Gate — CRITICAL, do not soften

The Gate is a **server-side check** in `gate.py`. The `/api/examine` endpoint returns
`HTTP 423 Locked` unless the note for that citekey has:
1. All five CERIC slots (`claim`, `evidence`, `reasoning`, `implications`, `context`) are non-empty strings (after `.strip()`)
2. `aq_written: true` in frontmatter

This is not a UI warning. It is a hard server rejection. Do not add a bypass flag in
the frontend. Do not add a "skip gate" button. The gate exists to prevent the user from
using AI as a summarizer before doing the active reading themselves.

`gate.py` implementation is already written — do not change its logic. It has not been
touched since the original build; every feature added since (LaTeX, arXiv Search,
CERIC append-slot, Settings) was built around it, never through it.

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
  → [{citekey, frontmatter}]
  Lists all .md files in 10-Papers/

GET  /api/papers/{citekey}
  → { citekey, frontmatter, body, gate: {passed, missing, aq_missing?} }

PUT  /api/papers/{citekey}
  body: { frontmatter: {...}, body?: string }
  → { ok: true, citekey }
  Writes frontmatter + body back to vault. Creates file if not exists.

DELETE /api/papers/{citekey}
  → { ok: true, citekey }
  Permanently deletes `10-Papers/{citekey}.md`. Rejects path traversal.

POST /api/papers/{citekey}/triage
  body: { verdict: "read"|"skip"|"later", claim?: string }
  → { ok: true }

POST /api/papers/{citekey}/append-slot
  body: { slot: "claim"|"evidence"|"reasoning"|"implications"|"context", text: string,
          title?, authors?, arxiv?, year? }
  → { ok, citekey, slot, value }
  Creates a skeleton note if this citekey has none yet (used when a paper reaches
  CERIC via arXiv Search, before any Zotero lookup — citekey = bare arXiv id in that
  case). NEVER overwrites existing slot content — always appends with a newline
  separator. Always writes via python-frontmatter. This is the backend for the
  "select text in arXiv Search's My List → push into a CERIC slot" toolbar.

GET  /api/papers/{citekey}/raw
  → { raw: string }
  Read-only raw .md text (frontmatter + body), serialized by python-frontmatter's own
  dumper. Used by the CERIC Collection tab's "Copy MD" button.
```

### AI endpoints

```
POST /api/locate
  body: { query: string, limit?: int }
  → { results: [{citekey, chunk}] }
  Embeds query via Ollama → ANN search in LanceDB → returns top chunks with source

POST /api/ask
  body: { question: string, limit?: int }
  → { answer: string, sources: [{citekey, excerpt}] }
  Same retrieval as locate, then calls Ollama for a short generated answer.
  Uses only vault content — never model knowledge about specific papers.

POST /api/examine
  body: { citekey: string }
  → { ok: true, response: string }
  GATE PROTECTED: returns 423 if gate.is_complete(citekey) is False.
  Calls Anthropic API (claude-sonnet-4-5 or env var ANTHROPIC_MODEL).
  Appends AI output as a `> [!ai]` callout in the note body — never into CERIC slots.
```

### Graph

```
GET /api/graph
  → { nodes: [{id, label, folder, path}], edges: [{source, target}] }
  Parses all .md files under the vault for [[wikilinks]].
```

### Zotero

```
GET /api/zotero/search?q={query}
  → metadata dict, or 404 if not found
  Tries Better BibTeX local API first (http://localhost:23119/better-bibtex/json-rpc).
  Falls back to Zotero Web API. 404 if not found in either.

POST /api/zotero/ensure/{arxiv_id}
  → metadata dict, or 404
  Looks up by arXiv ID; if not found, tries to add it via Zotero Web API, then re-searches.

POST /api/zotero/add-paper
  body: { arxiv_id, title, authors: string[], pdf_url }
  → { status: "ok"|"error", message?, item? }
  Directly creates a Zotero preprint item from metadata already in hand (no search
  round-trip — used by arXiv Search/Browser "+ Add to Zotero" buttons). NEVER throws
  an HTTP error to the caller: missing ZOTERO_API_KEY or a Zotero-side failure both
  come back as a normal 200 JSON body with status:"error".
```

### arXiv (public API, no key required)

```
GET /api/arxiv/daily?max=200
  → ArxivPaper[]
  Latest astro-ph.HE papers, sorted by submission date.

GET /api/arxiv/search?q=&field=all|author|title|id&start=0&max_results=50
  → { papers: ArxivPaper[], total: int, start: int }
  field="author" / "title" use exact arXiv field prefixes (au:/ti:) so an author
  search returns EVERY paper by that person (paginated via start/max_results), not
  just whatever a fuzzy all: match ranks in the first page. field="id" (or a bare
  arXiv ID / arxiv.org URL in `q` regardless of `field`) is resolved as an exact
  id_list lookup — both new-style (`2401.12345`) and old-style (`physics/0306138`)
  IDs are matched. total comes from arXiv's own opensearch:totalResults — the frontend uses
  it to drive a "Load more" button (see ArxivBrowser.tsx). `_fetch_arxiv()` retries
  once with backoff on a 429 from arXiv's rate limiter, then raises a 503 with a
  human-readable message rather than crashing; `/api/arxiv/daily` responses are
  cached in-memory for 180s per `max` value to reduce how often that limit is hit.

  ArxivPaper = { id, title, authors: string[], abstract, arxiv_url, pdf_url,
                 categories: string[], submitted }
```

### Vault sync (backup to your own remote, alongside/instead of Syncthing)

```
GET  /api/vault/git/status
  → { is_repo, remote?, branch?, last_commit?, dirty_files? }

POST /api/vault/git/init
  body: { remote_url }
  → { ok, message }
  git init (if needed) + git remote add/set-url origin. Credentials are the user's
  responsibility (embed a token in an HTTPS URL, or mount an SSH key into the
  assistant container) — nothing is stored server-side beyond the remote URL itself.

POST /api/vault/git/sync
  → { ok, message, pushed? }
  git add -A && commit (if dirty) && push. Never raises to the caller — every
  failure mode (no repo, no remote, push rejected, network error) comes back as a
  normal {ok: false, message} body. Built around a _run_git() subprocess helper.

GET  /api/vault/webdav/status
  → { configured, url?, username?, remote_dir?, last_sync? }

POST /api/vault/webdav/config
  body: { url, username, password, remote_dir }
  → { ok, message }
  Saved to vault/.ygg-config/webdav.json (git-ignored automatically — see below).
  For Nextcloud/ownCloud/Koofr/etc. — anything exposing a WebDAV endpoint. There is
  no OAuth-based Google Drive / iCloud account linking (would need an app
  registration + consent screen per provider); WebDAV is the practical alternative
  that needs no OAuth.

POST /api/vault/webdav/sync
  → { ok, message, pushed? }
  Mirrors every vault file to the WebDAV remote via PUT (MKCOL for directories as
  needed), skipping .git/ and .ygg-config/. Same never-raises-to-caller pattern.
```

Both sync features are independent of each other and of Syncthing — a user can run
any combination. `_webdav_ensure_gitignore()` appends `.ygg-config/` to
`vault/.gitignore` the first time a WebDAV remote is saved, so the WebDAV password
never ends up in a git-synced commit.

### LaTeX (thin proxy to the internal `latex` service)

The `latex` container is `expose`d, not `ports`-published — only the `assistant`
container can reach it (`LATEX_URL=http://latex:9000`), keeping a single published
port (8000) for Tailscale access, same as every other view.

```
POST   /api/latex/compile
  body: { source: string, filename: string }
  → 200 { pdf_b64, log, errors: [] }  or  422 { log, errors: [string] }
  Runs latexmk in a scratch /tmp dir inside the latex container. Never touches the vault.

POST   /api/latex/save
  body: { filename: string, source: string }
  → { path: "70-LaTeX/{filename}.tex" }

GET    /api/latex/files
  → { files: [{name, modified, size}], folders?: string[] }

POST   /api/latex/folders
  body: { path: string }  → creates a folder under 70-LaTeX/

GET    /api/latex/files/{filename:path}
  → { source: string }

DELETE /api/latex/files/{filename:path}
  → { ok: true }
```

Filenames are validated against a strict `[A-Za-z0-9._-]+` regex in
`services/latex/latex_service.py` to block path traversal.


### Habits & Tasks

```
GET  /api/habits/{date}
  → { date, habits: { [key]: bool|number } }
  Keys are dynamic — whatever exists in frontmatter.

POST /api/habits/{date}
  body: { habits: {...} }
  → { ok, date, habits }
  Creates `60-Meta/Daily-YYYY-MM-DD.md` on first write (python-frontmatter).

GET  /api/habits/range?start=&end=
  → { days: [{ date, habits }] }
  Feeds the Dashboard heatmap.

GET  /api/tasks
  → { tasks: Task[] }

POST /api/tasks
  body: { title, status?, tags?, parent?, due?, recurring?, body? }
  → { ok, task }

GET / PUT / DELETE /api/tasks/{id}
  Task frontmatter: title, status (todo|in_progress|done), tags[], parent, due,
  completed_date, recurring. Files live in `80-Tasks/{id}.md`.
```

### Scores

```
GET /api/scores/today
  → { date, points: int, detail: [{action, citekey?, pts}] }

GET /api/scores/week
  → { days: ScoreDay[], week_total: int, week_target: 55 }
```

**Scoring rules (read from frontmatter across vault):**
- triage verdict written: 1 pt (cap 10/day)
- T1 note complete (all 5 slots filled): 5 pts
- `aq_written: true`: 2 pts (separate from above)
- concept note updated (`updated` == today): 4 pts
- weekly synthesis (`created` == today, cap 1/day in current implementation): 10 pts
- task completed (`80-Tasks/`, `status=done` and `completed_date` == today): 2 pts each (cap 15 pts/day)
- habit checked (`60-Meta/Daily-YYYY-MM-DD.md`, each truthy habit key): 1 pt each

### System info & settings

```
GET  /api/info
  → { texVersion, vaultPath, diskFree, availablePaths: string[] }
  availablePaths lists every subdirectory under VAULT — feeds the Settings drawer's
  Data Path dropdown. See the "Known issue" callout at the top of this file.

POST /api/settings
  body: { latexDir?, userAccount? }
  → { ok: true, message: "Settings received (not persisted yet)" }
  NOT ACTUALLY PERSISTED SERVER-SIDE — currently a no-op acknowledgement. The
  Settings drawer's real persistence is client-side localStorage
  (theme, fontSize, tabWidth, lineWrap, autoCompile, userAccount, latexDir).
```

---

## Frontend — React views

### Shared

- Dark theme only was the original spec; **now three themes**: Dark (default),
  Light, and Paper (e-ink/grayscale, serif fonts, squared corners, no shadows).
  Theme tokens redefined per-theme in `index.css` under `:root[data-theme="..."]`;
  persisted to `localStorage("theme")`, applied via a `data-theme` attribute on
  `<html>` in `App.tsx` on mount.
- Base tokens: bg `#0D1117`, surface `#161B27`, border `#2A3447`, text `#CDD9E5`,
  accent `#4FC3F7`, ok `#34D399`, gate/warn `#F59E0B`, crit `#F87171`.
- Font: `IBM Plex Mono` for labels/code, `IBM Plex Sans` for body. Load from Google Fonts.
- **Nav is a horizontal top bar** (`Nav.tsx` / `.app-nav`), not a left sidebar as
  originally spec'd — `.app-shell` is `flex-direction: column`, nav is a fixed-height
  row with the logo, nav tabs, and a settings gear button, all left-to-right.
- No UI framework. Plain CSS in `index.css`. Keep it minimal.
- Settings drawer (`SettingsDrawer.tsx`): 360px right-side drawer, sections for
  Appearance (theme), Account, Editor (font size/tab width/line wrap/auto-compile),
  Data (path), **Data Sync (Git)** (remote URL, Init/Update Remote, Sync Now, live
  status — `api.vault.git*`), **Data Sync (Cloud/WebDAV)** (URL/username/password/
  remote folder, Sync Now — `api.vault.webdav*`), About (system info from `/api/info`).

### Dashboard view (`ScoresView.tsx`, nav id `scores`)

Default landing view. Today strip (pts, streak), weekly progress bar toward the 55pt
target, daily breakdown tiles, scoring rules legend. Data from `/api/scores/today`
and `/api/scores/week`.

### Daily ArXiv view (`ArxivSearch.tsx`, nav id `search`)

3-panel resizable layout (`react-resizable-panels`, sizes persisted to
`localStorage("yggdrasil:panel-sizes")`):
- **Panel 1 — Daily Papers**: live client-side keyword filter over up to 200
  astro-ph.HE papers (`/api/arxiv/daily?max=200`); `➕ Shortlist` per row.
- **Panel 2 — Shortlisted**: persisted to `localStorage("yggdrasil:shortlist")`;
  `→ Read` loads into Panel 3, `✕ Remove`.
- **Panel 3 — My List**: full reading pane for the active paper — persisted to
  `localStorage("yggdrasil:my-list")`. `↗ Open PDF`, `↗ Open arXiv`,
  `+ Add to Zotero` (the *only* place Zotero appears in this view). Below: compact
  "Saved" cards for every paper ever loaded here, click to re-select as active.
  **Select any text in the title/abstract → a `[C][E][R][I][C]` toolbar appears →
  clicking a letter appends the selection to that CERIC slot** via
  `POST /api/papers/{citekey}/append-slot` (citekey = arXiv id if the paper has no
  Zotero citekey yet). Shows a toast (`Added to Evidence ✓`), a brief accent flash,
  and a `[C✓][E✓][R·][I·][C·]` fill indicator next to the title and on every saved
  card. This selection→slot behavior lives in `components/CericToolbar.tsx`
  (`useCericAppend` hook + `CericSelectionToolbar`/`SlotIndicator` components), shared
  with the Search view below — don't reimplement it per-view.

### Search view (`ArxivBrowser.tsx`, nav id `browse`)

Single-query arXiv search with field tabs — **Keyword** (`all:`, fuzzy, relevance-sorted),
**Author** (`au:"..."`, exact field match, date-sorted), **Title** (`ti:"..."`),
**arXiv ID / URL** (`field=id`, exact single-paper lookup, no pagination — new- and
old-style IDs). Author/Title exist specifically so "show me
every paper by Bin-Bin Zhang" actually works, instead of a fuzzy 50-result cap. Shows
`Showing N of TOTAL results` with a `Load more` button that pages via
`start`/`max_results` (hidden for the `id` field, since it's always exactly one
result). Each result: category badge, title, up to 3 authors + "+N more" toggle,
a 2-line clamped abstract preview with a "show full abstract" expand, and — same as
Daily ArXiv — select any text to get the `[C][E][R][I][C]` toolbar via the shared
`CericToolbar.tsx` hook. Actions: `↗ Open PDF` / `↗ Open arXiv` / `+ Add to Zotero`.
Header (title, field tabs, search bar, result count) is centered; results render in
a responsive CSS grid that fills the full window width, not a fixed-width column.

### Triage view (`Triage.tsx`)

- Header: today's date + paper count from brief
- Paper list: one card per paper. Shows: title, first author, year, abstract (collapsed,
  expand on click), arXiv link.
- Each card has a Claim input (single line) and three buttons: Drop (red) / Queue (amber) / Read (green).
- On "Read": calls `POST /api/papers/{citekey}/triage`, then Zotero status shown via
  `GET /api/zotero/search?q={arxiv_id}`.
- Completed papers (verdict set) show a grey checkmark and collapse.

### Notes view (`CERICEditor.tsx`, nav label **Notes**)

Two internal tabs, toggled by buttons at the top of the view (not a separate nav item):

- **Editor tab**: left panel paper metadata; five labelled textareas (one per CERIC
  slot, with hunting-prompt placeholders); Adversarial Question textarea + `aq_written`
  toggle; `GateIndicator` (6 dots); auto-save-on-blur + manual Save; `/examine` button
  (disabled until gate conditions met), AI response in an amber `.ai-callout`.
- **Collection tab**: lists every paper in `10-Papers/` (`GET /api/papers`). Filter bar
  — date, keyword (title + tags), status (draft/complete, derived client-side from
  slot-fill + `aq_written`). Each row: title, arXiv id/citekey, date, 5-slot progress
  bar, `Copy MD` (via `GET /api/papers/{citekey}/raw`, clipboard), `Open in LaTeX`
  (builds a `\subsection{title}` + `\paragraph{slot}` snippet client-side, clipboard),
  `Delete` (confirm → `DELETE /api/papers/{citekey}`, removes the vault note).
  Clicking a row opens it in the Editor tab.

`onSelectPaper` prop (wired to `App.tsx`'s `openEditor`) lets the Collection tab jump
straight into editing a paper without going through Triage.

### Graph view (`GraphView.tsx`)

Full-area D3 force-directed graph (npm `d3`, not CDN). Nodes: paper/concept/question
notes. Edges: `[[wikilink]]` connections. Click node → opens CERIC Editor (papers) or
a text view (concepts). Search input to highlight/filter. Zoom/pan enabled.

### Ask view (`AskView.tsx`)

Search input, mode toggle (Locate | Ask), results with source path + relevance +
excerpt. Examine panel shown only when a gate-open paper is selected.

### LaTeX view (`LaTeXEditor.tsx`)

3-pane resizable layout (file tree / CodeMirror editor / PDF preview), same
`react-resizable-panels` pattern as Daily ArXiv. CodeMirror 6 with
`@codemirror/legacy-modes`' `stex` mode via `StreamLanguage` for LaTeX syntax
highlighting. Toolbar: file picker, filename input, Save, Compile, Delete. Editor
shows a `Line N, Col N` status bar. Preview pane shows the compiled PDF (base64 →
`data:` URL in an `<iframe>`) or a scrollable compile-error log on 422. All requests
go through `/api/latex/*` on the assistant — the `latex` service itself is never
reached directly by the browser.

---

## Zotero integration detail

`zotero.py` implements three functions:

**`search_zotero(query)`** — two-strategy fallback:
1. Better BibTeX local JSON-RPC (`http://localhost:23119/better-bibtex/json-rpc`,
   `item.search` method) — only works when Zotero desktop is running locally.
2. Zotero Web API (`GET https://api.zotero.org/users/{id}/items?q=...`) — needs
   `ZOTERO_USER_ID` + `ZOTERO_API_KEY`. Citekey constructed as
   `{first_author_last}{year}{first_title_word}` since the Web API doesn't return one.

**`ensure_arxiv_in_zotero(arxiv_id)`** — searches first; if not found, POSTs a
preprint item by URL, then re-searches.

**`add_paper_to_zotero(arxiv_id, title, authors, pdf_url)`** — direct item creation
from metadata already known (no search round-trip); used by the arXiv Search/Browser
"+ Add to Zotero" buttons. Raises on transport/API errors (caller in `main.py` catches
and returns `{status:"error"}`), returns `None` only when credentials are missing.

---

## arxiv-daily service

Unchanged from original spec. Runs as a cron at 06:30 CST (TZ: Asia/Shanghai). Uses the
`arxiv` Python package. Query: `cat:astro-ph.HE` filtered by `KEYWORDS` env var, author
watch from `AUTHOR_WATCH`. Writes `vault/00-Inbox/Brief-{YYYY-MM-DD}.md`. Weekend/no-op
handling: writes a short "No new listings today" note rather than a blank file.

Note: this is a *separate* code path from `/api/arxiv/daily` and `/api/arxiv/search`
in `main.py` — those hit the live arXiv API directly on each request (used by Daily
ArXiv / Search views); arxiv-daily is the once-a-day cron that seeds the Triage brief.
Both independently call `export.arxiv.org` (now `https://`, following redirects —
the API 301s HTTP→HTTPS as of the underlying arxiv package's requests too).

---

## indexer service

Unchanged from original spec. Uses `watchdog` to monitor `10-Papers/` and
`20-Concepts/`. Chunks (~400 tokens, 50 overlap), embeds via Ollama
(`nomic-embed-text`), upserts into LanceDB at `/data/lancedb/vault.lance`. Startup
indexes all existing files if LanceDB is empty; delete removes all chunks for that citekey.

---

## Recently added: search, digest, citation graph, sync automation

```
GET  /api/search?q=&limit=30
  → { results: [{citekey, title, folder, path, snippet}], query }
  Plain substring search (case-insensitive) across title/tags/authors/CERIC
  slots/body of every .md in the vault. Not vector search — that's /api/locate
  and /api/ask. Surfaced in AskView.tsx as a "Search (exact match)" mode
  alongside the existing AI "Ask Your Notes" mode.

GET  /api/digest?period=week|month
  → { markdown, count, start, end }
  Builds a Markdown reading digest from every 10-Papers/ note whose `read`
  date falls in the period (title, meta, all 5 CERIC slots, AQ). Reused by
  both the Dashboard's "Export Digest" button (browser download) and the
  weekly webhook message below — see _build_digest_markdown() in main.py.

GET  /api/graph/citations
  → { edges: [{source, target, type: "citation"}] }
  Real citation links via Semantic Scholar's public API, but ONLY between
  papers already in your vault (matched by arXiv id) — never creates new
  external nodes. Best-effort: a Semantic Scholar failure for one paper
  doesn't block the others.

GET  /api/graph/suggested?limit_per_paper=3
  → { edges: [{source, target, type: "suggested"}], warning? }
  "Papers that might be related" via nearest-neighbor search over the SAME
  LanceDB embeddings the indexer already builds for /api/ask — local content
  similarity, not an LLM call. Purely a suggestion layer for the Graph view;
  never writes a wikilink or any vault content. Returns a warning if the
  indexer hasn't embedded anything yet.
  GraphView.tsx merges wikilink + citation + suggested edges, styled
  differently (solid / dashed-blue / dotted-purple), with a checkbox to hide
  suggested edges.

GET  /api/zotero/audit
  → { missing: [...], found: [...], total }
  Checks every paper in 10-Papers/ against Zotero in one pass instead of one
  at a time. Surfaced as a "Check Zotero" button in the Notes → Collection
  tab, with a ● in Zotero / ○ not in Zotero badge per row.

GET/POST /api/vault/autosync/status|config
  Runs the existing git/webdav sync automatically on a timer (off by
  default). Config: {enabled, interval_minutes, target: git|webdav|both},
  stored at vault/.ygg-config/autosync.json. A background asyncio loop
  (started in the `startup` event) checks every 5 minutes whether the
  configured interval has elapsed.

GET/POST /api/webhook/status|config, POST /api/webhook/test
  Posts a weekly score + reading digest to a Slack/Discord-compatible
  incoming webhook URL. Config stored at vault/.ygg-config/webhook.json
  (day_of_week, hour, enabled). A second background asyncio loop checks
  hourly and sends once per calendar day when the scheduled day/hour hits,
  guarded by `last_sent` so it can't double-send.
```

Both `.ygg-config/*.json` files (webdav, autosync, webhook) are auto-added to
`vault/.gitignore` by `_webdav_ensure_gitignore()` the first time any of them
is written, so none of them — including the WebDAV password — end up in the
git-sync feature's commit history.

---

## Hard constraints — do not violate

1. **Never write into any CERIC slot** from server or AI code, *except* the explicit,
   user-triggered `POST /api/papers/{citekey}/append-slot` endpoint — and even that
   only appends verbatim text the user selected themselves; it never generates or
   summarizes. The five slots are otherwise written ONLY by the user via direct
   textarea edits. The server reads them (for the Gate), never auto-populates them.
2. **Never call Anthropic API** from any endpoint except `/api/examine`, and only after
   `gate.is_complete()` returns True.
3. **AI output always goes in a callout block** in the frontend — visually distinct from
   the user's own writing. Label it `AI · /examine` with amber styling.
4. **Never summarize a paper automatically.** `/api/ask` searches the user's own notes
   only. `/api/arxiv/daily` and `/api/arxiv/search` return raw arXiv metadata
   (title/authors/abstract as arXiv wrote them) — fine, since that's not an AI summary,
   it's just relaying the paper's own listed abstract.
5. **vault/ is read-only for indexer.** Only `arxiv-daily` writes to `00-Inbox`. The
   user writes to `10-Papers` via CERIC Editor / append-slot; the `latex` service
   writes only to `70-LaTeX`.
6. **The Gate check in `gate.py` must not be modified.** Do not add `bypass` parameters.
7. **All `.md` writes must use `python-frontmatter`**, never hand-written YAML strings.
   (Client-side "Copy MD"/"Open in LaTeX" clipboard actions in the Collection tab are
   read-only display formatting, not file writes, and don't need to go through this —
   but they still source the frontmatter from `GET /api/papers/{citekey}/raw`, which
   itself uses `frontmatter.dumps()`.)
8. **The `latex` service never touches anything outside `70-LaTeX/`.** No cross-talk
   with `10-Papers` or any other vault folder.
9. **Zotero errors never crash a view.** Every Zotero-touching endpoint
   (`/api/zotero/*`) returns a normal JSON body on failure (404 or
   `{status:"error", message}`), never lets an unhandled exception surface as a 500
   in a place the frontend can't gracefully show.

---

## Environment variables (.env)

```
# Vault
VAULT_HOST_PATH=/data/grb-vault        # absolute path on host; bind-mounted into containers
                                        # ⚠️ see "Known issue" at top of this file —
                                        # verify this actually points at your real vault

# arXiv
ARXIV_QUERY=cat:astro-ph.HE
KEYWORDS=GRB,gamma-ray burst,prompt emission,internal shock,afterglow,magnetar
AUTHOR_WATCH=Zhang,Burgess,Iyyani,Ravasio,Beniamini,Pe'er
TZ=Asia/Shanghai
CRON_TIME=06:30
MAX_RESULTS=40

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

# LaTeX (internal docker-network URL; only override if you moved the service)
LATEX_URL=http://latex:9000
```

Note: `ollama` itself is **not** defined in `docker-compose.yml` — it's expected to run
as a separate container/compose stack on the same Docker network (that's why
`OLLAMA_URL` defaults to the DNS name `http://ollama:11434` rather than `localhost`).

---

## First-run checklist (for human, not agent)

1. Copy `.env.example` to `.env` and fill in all values — **and confirm
   `VAULT_HOST_PATH` points at the directory with your real vault content** (see
   "Known issue" at top).
2. Run `scripts/init-vault.sh` if the vault directory doesn't exist yet.
3. `docker compose up -d ollama` (from whatever compose file/stack defines it)
4. `docker exec <ollama-container> ollama pull nomic-embed-text`
5. `docker compose up -d arxiv-daily` — confirm Brief.md appears next morning
6. `docker compose up -d assistant latex` — open `http://mac-mini-tailscale-ip:8000`
   (the `latex` container has no published port; only `assistant` needs one)
7. `docker compose up -d indexer` — after ~20 notes exist in vault

---

## Working with Cursor / other tools on this repo

- The frontend build is **not** hot-reloaded into the running container — after any
  change under `services/assistant/frontend/src/`, you must:
  ```
  cd services/assistant/frontend && npm run build
  cd ../../.. && docker compose build assistant && docker compose up -d assistant
  ```
  (`vite.config.ts` does proxy `/api` → `localhost:8000` for local `npm run dev`,
  which is faster for iteration if you don't need the full container loop.)
- Same rebuild-and-restart pattern applies to `services/latex/` after editing
  `latex_service.py` — rebuild the `latex` image, not `assistant`.
- `services/latex/Dockerfile` installs `python3-pip` via `apt-get` before `pip3
  install` — `texlive/texlive:latest`'s Debian base does not ship pip by default.
  Don't remove that step.
- The frontend has no test suite yet. Verify changes with `npx tsc --noEmit`, `npm
  run build`, and a manual `curl` smoke-test of any touched `/api/*` route before
  considering a change done.
