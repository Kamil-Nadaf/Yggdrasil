# Yggdrasil

A personal research app: paper reading (arXiv / OpenAlex / Europe PMC), notes,
tasks, a knowledge graph, a LaTeX editor, and **Loki** — an AI assistant that
answers only from what you've written. Built around the **CERIC method**:
Claim · Evidence · Reasoning · Implications · Context.

Runs as a native desktop app (Mac / Linux / Windows, no Docker) or as a
self-hosted Docker web app.

## Install

**Package manager** (no download needed):

```bash
# macOS
brew tap Kamil-Nadaf/yggdrasil https://github.com/Kamil-Nadaf/Yggdrasil
brew trust --cask kamil-nadaf/yggdrasil/yggdrasil   # Homebrew 6+ ignores third-party taps until trusted
brew install --cask kamil-nadaf/yggdrasil/yggdrasil   # use the full name: plain `yggdrasil` is another app
# Windows (PowerShell)
scoop bucket add yggdrasil https://github.com/Kamil-Nadaf/Yggdrasil; scoop install yggdrasil/yggdrasil
# Linux (and macOS without Homebrew)
curl -fsSL https://raw.githubusercontent.com/Kamil-Nadaf/Yggdrasil/main/scripts/install.sh | bash
```

**Or download** the file for your computer from the
**[latest release](https://github.com/Kamil-Nadaf/Yggdrasil/releases/latest)**:
macOS `.pkg`/`.dmg` (arm64 = Apple Silicon, intel = Intel), Windows `.zip`, Linux `.tar.gz`.
The apps are not code-signed, so your OS may warn on first launch.

Step-by-step help for every OS, warnings, updating and uninstalling: **[Documentation → INSTALL.md](INSTALL.md)**
(a full documentation site on GitHub Pages is planned).

### First launch (all platforms)

1. Choose a folder for your notes (your "vault") — anywhere you like; change it
   later in **Settings → Data**. Everything is stored as plain files there.
2. On macOS/Linux the first launch installs **TinyTeX** (LaTeX) automatically —
   needs internet, a few minutes, one time only.
3. To use Loki and paper analysis, click the **gear icon → AI Providers**, pick a
   provider (Claude, LM Studio, DeepSeek…), paste your API key and **Save**.

## How to use Yggdrasil

The top bar has one tab per area:

| Tab | What you do there |
|---|---|
| **Dashboard** | Today's overview: habits, active tasks, goals, reading score |
| **Daily Archive** | Browse the day's new papers (arXiv / OpenAlex / Europe PMC) and triage each as **Read / Skip / Later** |
| **Search** | Search across all your papers, notes and tasks |
| **Notes** | Papers, collection, books and Markdown notes (see below) |
| **Tasks** | A task board with statuses, dates and a completion history |
| **Graph** | A map of how your papers, concepts and questions link together |
| **Loki** | AI assistant that answers only from what you've written |
| **LaTeX** | Overleaf-style editor for papers, letters and theses |

### Reading a paper (the CERIC method)

1. In **Daily Archive**, mark interesting papers **Read**.
2. Open the paper in the **Notes → Editor** and fill the five slots:
   **C**laim · **E**vidence · **R**easoning · **I**mplications · **C**ontext.
3. Write an **Adversarial Question** — the strongest objection to the paper — and tick it.
4. When all five slots and the question are done, the **Gate** opens and the AI
   analysis button becomes available. It is deliberately locked until you have
   thought it through yourself.

### Collection (papers + books, Zotero-style)

The **Collection** tab is your reference library. Add papers from arXiv (**+ Collection** on any result), books (PDF/EPUB), DOIs, URLs, BibTeX/RIS files or your Zotero library, then organise them into collections and sub-collections, tags, saved searches (`tag:nlp year:2017 is:fav`) and related items. Each item has an info pane with citation export (APA, MLA, Chicago, IEEE, BibTeX, RIS), duplicate merging, and automatic metadata from PDFs and web pages. In the LaTeX editor, **Cite** picks references and keeps `references.bib` up to date.

### Syncing annotations with Zotero

**Collection → Tools → Sync with Zotero** matches highlights, underlines, notes, text and drawings on items linked to Zotero, both ways, so you can mark up a PDF in Zotero on your iPad and keep reading on your Mac (and the reverse). Items need a Zotero link (use *Import from Zotero*). Open a PDF once after updating so the app can record its page sizes; after that, sync as often as you like. Zotero’s version wins if you changed the same annotation on both sides; area boxes stay in the app.

### Highlighting and annotating PDFs

Select text in any paper or book and a palette appears beside it: pick a colour to **highlight** or **underline**, add a note, or (papers) send it to a **CERIC** slot, which highlights in that slot's soft colour so CERIC highlights stand out from plain ones. Yellow is the default; add custom colours and change opacity or slot colours with the gear. The tool strip above the PDF also has **note, text, area and draw** tools, which work with touch and Apple Pencil.

### Markdown notes

- **Notes → Quick Notes / Documentation / Meeting Minutes** — create files and
  folders in the left panel; **Editor / Split / View / Present** switch the layout.
- **Add images:** paste a screenshot (Ctrl/Cmd+V), drag a file in, or click the
  picture button in the toolbar. Images are stored in an `assets` folder next to
  the note.
- **Save** writes the note; **Share** lets you share it.

### LaTeX

- **New file / folder** from the Files panel, or **File → Upload file or .zip
  project…** to import an Overleaf project directly (a `.zip`, or a whole folder).
- Write on the left, press **Recompile** for the PDF on the right.
  **Editor / Split / PDF** change the layout.
- **Add a figure:** click the picture button → tick images from your project
  folders (sub-folders are included) → **Insert**. You can also paste or drop an
  image straight into the editor. Insert it inside the document body; the
  `graphicx` package is added for you.
- **Click any file** in the sidebar (image, PDF, `.bib`, …) to preview it, then
  **Insert in document** or **Download**.
- **Tip:** use PDF or high-resolution PNG plots (`plt.savefig("fig.pdf", bbox_inches="tight")`)
  rather than screenshots, so the figure has no window frame and stays sharp.

### Loki

Ask a question and Loki answers from your own notes, papers and tasks. Add an AI provider key first (see *First launch*).

### Keep your notes safe

**Settings → Data Sync** backs up your notes folder to a private GitHub repo or
a WebDAV server. See [`GETTING-STARTED.md`](GETTING-STARTED.md) for every setting.

## Build from source (optional)

Only needed if you want to modify the app or build it yourself. Requirements:
[`uv`](https://docs.astral.sh/uv/) and Node 20+ (see
[`packaging/DESKTOP.md`](packaging/DESKTOP.md)). Build on the OS you are targeting:

```bash
bash packaging/build-macos-app.sh      # macOS  → release/*-mac-arm64.* or *-mac-intel.* (matches your Mac)
bash packaging/build-linux.sh          # Linux  → release/*.tar.gz
powershell -File packaging/build-windows.ps1   # Windows → release/*.zip
```

### Updating

Open **Settings → Updates → Check for updates**. If a newer release exists you'll see its notes; **Install** downloads a small package (the app's code, a few MB), then **Restart now** applies it — no new download of the full app. Releases that add new bundled libraries say so and link to the full installer instead. Docker users update with `git pull && docker compose up -d --build`. If an update ever fails to start, the app falls back to the bundled version automatically.

### Publishing a release (maintainers)

Installers are built for all three OSes by GitHub Actions
(`.github/workflows/release.yml`). To publish:

```bash
git tag v0.3.0
git push origin v0.3.0
```

Watch the **Actions** tab; when it's green the files appear under **Releases**.
You can also run the workflow manually from the Actions tab to test the builds.

## Connect it to your coding agent

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

### Book notes and papers
In **Collection**, papers (anything with an arXiv ID, or saved as a paper) open with the CERIC row when you select text. Books don't: select text and choose **→ Notes** to collect quotes (with page numbers) in the *Book notes* panel, add your own comments, then in the **LaTeX** editor click **notes** to insert them as quoted text with `\cite` entries (the book is added to the project's `references.bib`).
