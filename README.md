# Yggdrasil

A personal research app: paper reading (arXiv / OpenAlex / Europe PMC), notes,
tasks, a knowledge graph, a LaTeX editor, and **Loki** — an AI assistant that
answers only from what you've written. Built around the **CERIC method**:
Claim · Evidence · Reasoning · Implications · Context.

Runs as a native desktop app (Mac / Linux / Windows, no Docker) or as a
self-hosted Docker web app.

## Install

Download the installer for your computer from the
**[latest release](https://github.com/Kamil-Nadaf/Yggdrasil/releases/latest)**
(scroll to **Assets**). No Docker, Python or Node needed.

| Your computer | Download | Then |
|---|---|---|
| **macOS** | `Yggdrasil-…-mac.pkg` (easiest) or `…-mac.dmg` | Double-click → Continue → Install |
| **Windows** | `Yggdrasil-…-windows.zip` | Unzip → double-click `Yggdrasil.bat` |
| **Linux** | `Yggdrasil-…-linux.tar.gz` | Extract → `./install.sh` |

The apps are not code-signed, so your OS may warn you the first time — the
steps below show how to get past it.

### macOS

1. Download the `.pkg` from the release page.
2. Double-click it and click **Continue → Install**. It installs Yggdrasil into
   `/Applications` and clears macOS's quarantine flag for you.
3. Open **Yggdrasil** from Launchpad or Finder.

**Prefer the `.dmg`?** Open it, drag **Yggdrasil** into **Applications**, eject the
disk image, then open the app. If macOS blocks it:

- *"cannot be opened because the developer cannot be verified"* → right-click the
  app → **Open** → **Open**. (Or **System Settings → Privacy & Security → Open Anyway**.)
- *"Yggdrasil is damaged and can't be opened"* → the app is fine; macOS just
  flags unsigned downloads. Open **Terminal** and run:
  ```bash
  xattr -cr /Applications/Yggdrasil.app
  ```

### Windows

1. Download the `.zip` from the release page.
2. Right-click it → **Extract All…** (don't run it from inside the zip).
3. Open the extracted folder and double-click **`Yggdrasil.bat`**.
   If Windows SmartScreen appears: **More info → Run anyway**.
4. *(Only for the LaTeX editor)* install [MiKTeX](https://miktex.org/download)
   and make sure `pdflatex` / `latexmk` are on your PATH. Everything else
   works without it.

### Linux

1. Download the `.tar.gz` from the release page.
2. Install the GTK/WebKit libraries once:
   ```bash
   # Ubuntu / Debian
   sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1 pkg-config
   # Fedora
   sudo dnf install python3-gobject gtk3 webkit2gtk3 pkgconfig
   # Arch
   sudo pacman -S python-gobject gtk3 webkit2gtk pkgconf
   ```
3. Extract and install:
   ```bash
   tar -xzf Yggdrasil-*-linux.tar.gz
   cd Yggdrasil-linux
   ./install.sh          # adds Yggdrasil to your app menu
   ```
   Or run it without installing: `./Yggdrasil`.
   Uninstall anytime with `~/.local/share/Yggdrasil/uninstall.sh`.

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
bash packaging/build-macos-app.sh      # macOS  → release/*.pkg, *.dmg
bash packaging/build-linux.sh          # Linux  → release/*.tar.gz
powershell -File packaging/build-windows.ps1   # Windows → release/*.zip
```

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
