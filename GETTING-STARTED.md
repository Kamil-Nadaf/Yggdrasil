# Yggdrasil — Getting Started

Welcome! Someone sent you a `.dmg` (Mac), `.zip` (Windows), or `.tar.gz`
(Linux) file. This is a short guide to installing it and setting up the
handful of things worth configuring.

## 1. Install

**Mac** — open the `.dmg`, drag **Yggdrasil** into Applications, open it. If
macOS says it's from an unidentified developer: right-click the app → **Open**
→ **Open** (only needed the first time).

**Windows** — extract the `.zip` anywhere, double-click `Yggdrasil.bat` inside
the extracted folder.

**Linux** — extract the `.tar.gz`, run `./Yggdrasil` inside the extracted
folder.

## 2. First launch

- You'll be asked to **choose a folder** for your notes — this is where all
  your papers, notes, and tasks actually live as plain files. Pick anywhere
  you like (you can change it later). You can move/sync this folder yourself
  (Dropbox, iCloud Drive, an external drive) since it's just files.
- On Mac/Linux, LaTeX (TinyTeX) installs itself the first time — needs
  internet, only happens once. On Windows, install
  [MiKTeX](https://miktex.org/download) yourself if you want the LaTeX
  editor; everything else works without it.

## 3. Turn on the AI assistant (Loki)

Nothing AI-related works until you add a key. Click the **gear icon** (top
right) → **AI Providers**:

1. Pick a provider from the dropdown — most people use **Claude** or a local
   model via **LM Studio**.
2. Paste your **API key** (get one from that provider's website — this app
   doesn't include one).
3. Click **Save AI settings**.

Your key stays in this app on your own computer — it's sent only when you
actually ask Loki something or run paper analysis.

## 4. Everything else in Settings (optional)

Open the gear icon → these sections, roughly most → least useful:

| Section | What it's for |
|---|---|
| **Appearance** | Theme, colours, and fonts — including uploading your own custom font files |
| **Data** | Where your notes folder lives — change it here if you move it |
| **Data Sync (Git)** | Back up your notes folder to a private GitHub repo. Paste a remote URL like `https://<token>@github.com/you/your-vault.git`, click **Init + Set Remote**, then **Sync Now**. (You'll need a [GitHub personal access token](https://github.com/settings/tokens) with repo access — treat it like a password.) |
| **Data Sync (Cloud / WebDAV)** | Same idea, but to a WebDAV server (Nextcloud, etc.) instead of GitHub |
| **Auto-Sync** | Run the Git/WebDAV sync above automatically on a timer instead of clicking Sync Now yourself |
| **Weekly Score Digest** | Posts a weekly reading-progress summary to a Slack or Discord webhook URL |
| **Connections** | Endpoint slots for MCP tools (Zotero, GitHub, etc.) you run yourself. Saving one here just stores the address — it doesn't set up or verify the connection, so treat this as a bookmark, not a live integration yet |
| **Analysis Tags / Task Statuses** | Rename the CERIC reading slots or task-status labels if you want different words than Claim/Evidence/Reasoning/… |

None of these are required to use the app day-to-day — Appearance and AI
Providers are the two worth touching first.

## 5. Using it with your coding agent (optional)

If you use Claude Code, Cursor, or another MCP-aware tool and want it to see
your notes/papers/tasks while you code, Yggdrasil must be **running** first,
then add this to that tool's MCP config (e.g. Claude Code's `.mcp.json`):

**Mac:**
```json
{
  "mcpServers": {
    "yggdrasil": {
      "command": "/Applications/Yggdrasil.app/Contents/Resources/venv/bin/python",
      "args": ["/Applications/Yggdrasil.app/Contents/Resources/app/mcp_server.py"]
    }
  }
}
```

**Windows/Linux:** same shape, but `command` points at
`venv\Scripts\python.exe` (Windows) or `venv/bin/python` (Linux) and `args`
at `mcp_server.py`, both inside wherever you extracted the app.

This gives your agent tools to search your notes, read papers, and see your
active tasks — nothing more.

## Where's my data?

Everything is plain Markdown files in the folder you chose in step 2 —
nothing is locked into this app. You can open, edit, back up, or delete those
files with any text editor at any time.
