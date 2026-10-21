# Connecting your coding agent to your Yggdrasil vault (MCP)

`services/assistant/mcp_server.py` exposes your notes, papers, and tasks as an
[MCP](https://modelcontextprotocol.io) server, so Claude Code, Cursor, Kimi
Code, or any other MCP-aware IDE/agent can search and read them for context
while you're writing code.

It works by calling the already-running Yggdrasil app's own REST API — it
doesn't touch the vault directly, needs no separate database/embedding setup,
and always reflects whatever data path the running app has open. **Yggdrasil
must be running** for it to answer anything.

## Tools it exposes

| Tool | What it does |
|---|---|
| `search_notes(query, limit?)` | Full-text search across the whole vault — papers, notes, tasks |
| `read_note(path)` | Full content of any vault file, by the `path` a search result gave you |
| `list_papers(limit?)` | Index of papers: citekey, title, tier, rating |
| `get_paper(citekey)` | Full raw markdown (frontmatter + CERIC analysis + body) for one paper |
| `list_active_tasks()` | What's currently active, across all task projects |
| `related_notes(citekey)` | Wikilinks / citations / similarity neighbors for one note |

## Config per client

The `command` is the **Python bundled inside the app**, not your
system Python — that's where `mcp` and the app's other dependencies live.

| Platform | Python | Script |
|---|---|---|
| macOS (`Yggdrasil.app`) | `.../Yggdrasil.app/Contents/Resources/python/bin/python3` | `.../Yggdrasil.app/Contents/Resources/app/mcp_server.py` |
| Linux (`Yggdrasil-linux/`) | `.../Yggdrasil-linux/python/bin/python3` | `.../Yggdrasil-linux/app/mcp_server.py` |
| Windows (`Yggdrasil-windows\`) | `...\Yggdrasil-windows\python\python.exe` | `...\Yggdrasil-windows\app\mcp_server.py` |
| Local dev (repo checkout) | your `services/assistant` venv's `python` | `services/assistant/mcp_server.py` |

`YGG_API_URL` defaults to `http://127.0.0.1:47285` (the desktop app's fixed
port). Only set it if you're pointing at something else, e.g. the Docker
compose setup on port 8000.

### Claude Code (`.mcp.json`, project or `~/.claude/`)

```json
{
  "mcpServers": {
    "yggdrasil": {
      "command": "/Applications/Yggdrasil.app/Contents/Resources/python/bin/python3",
      "args": ["/Applications/Yggdrasil.app/Contents/Resources/app/mcp_server.py"]
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

Same shape as Claude Code's `.mcp.json` — copy the block above.

### Any other MCP-aware client (Kimi Code, etc.)

If it supports the standard MCP stdio transport, it takes the same
`command`/`args` (and optional `env`) shape — check that client's docs for
exactly where the config file lives.

## Local dev / testing

```bash
cd services/assistant
YGG_API_URL=http://127.0.0.1:8000 python mcp_server.py
```

Runs on stdio — it's meant to be launched by an MCP client, not used
interactively from a terminal.
