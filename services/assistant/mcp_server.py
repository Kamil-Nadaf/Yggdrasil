"""MCP server exposing your Yggdrasil vault — notes, papers, tasks — to any
MCP client (Claude Code, Cursor, Kimi Code, etc.) so your coding agent has
context from what you've read and written.

This proxies the already-running Yggdrasil app's REST API rather than
touching the vault directly, so it always reflects whichever data path the
running app (desktop or docker) actually has open, and needs no separate
embedding/DB setup.

Requires Yggdrasil to be running. Desktop app default port is 47285.

Run directly for local testing:
    YGG_API_URL=http://127.0.0.1:47285 python mcp_server.py

Example Claude Code .mcp.json entry:
    {
      "mcpServers": {
        "yggdrasil": {
          "command": "/path/to/Yggdrasil/services/assistant/venv/bin/python",
          "args": ["/path/to/Yggdrasil/services/assistant/mcp_server.py"],
          "env": { "YGG_API_URL": "http://127.0.0.1:47285" }
        }
      }
    }
See packaging/MCP.md for Cursor / other clients.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from mcp.server.fastmcp import FastMCP

API_URL = os.environ.get("YGG_API_URL", "http://127.0.0.1:47285").rstrip("/")
TIMEOUT = 20.0

mcp = FastMCP("yggdrasil")


def _unreachable(e: httpx.HTTPError) -> str:
    return f"Could not reach Yggdrasil at {API_URL} — is the app running? ({e})"


async def _get(path: str, params: Optional[dict[str, Any]] = None) -> Any:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.get(f"{API_URL}{path}", params=params)
        resp.raise_for_status()
        return resp.json()


async def _post(path: str, json: Optional[dict[str, Any]] = None) -> Any:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(f"{API_URL}{path}", json=json or {})
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
async def search_notes(query: str, limit: int = 20) -> str:
    """Full-text search across the user's entire Yggdrasil vault — papers, notes,
    tasks, everything. Returns a path + snippet per match. Use this first to find
    what's relevant, then read_note (or get_paper for a paper's citekey) for the
    full content."""
    try:
        data = await _get("/api/search", {"q": query, "limit": limit})
    except httpx.HTTPError as e:
        return _unreachable(e)
    results = data.get("results", [])
    if not results:
        return f"No matches for '{query}'."
    lines = [f"{len(results)} match(es) for '{query}':"]
    for r in results:
        lines.append(f"- [{r['folder']}] {r['title']} — path: {r['path']}\n  …{r['snippet']}…")
    return "\n".join(lines)


@mcp.tool()
async def read_note(path: str) -> str:
    """Read the full raw content (frontmatter + body) of any vault file by its
    relative path, exactly as returned by search_notes' `path` field."""
    try:
        data = await _get("/api/vault/file", {"path": path})
    except httpx.HTTPStatusError as e:
        return f"Could not read '{path}': {e.response.status_code} {e.response.text}"
    except httpx.HTTPError as e:
        return _unreachable(e)
    return data["content"]


@mcp.tool()
async def list_papers(limit: int = 50) -> str:
    """List papers in the vault with citekey, title, tier/rating — a quick index
    before reading a specific one with get_paper."""
    try:
        papers = await _get("/api/papers")
    except httpx.HTTPError as e:
        return _unreachable(e)
    papers = papers[:limit]
    if not papers:
        return "No papers in the vault yet."
    lines = []
    for p in papers:
        fm = p.get("frontmatter", {})
        lines.append(
            f"- {p['citekey']}: {fm.get('title', '(untitled)')} "
            f"(tier={fm.get('tier')}, rating={fm.get('rating')})"
        )
    return "\n".join(lines)


@mcp.tool()
async def get_paper(citekey: str) -> str:
    """Full raw markdown (frontmatter + CERIC analysis + body) for one paper by
    citekey, as listed by list_papers or search_notes."""
    try:
        data = await _get(f"/api/papers/{citekey}/raw")
    except httpx.HTTPStatusError as e:
        return f"Paper '{citekey}' not found." if e.response.status_code == 404 else str(e)
    except httpx.HTTPError as e:
        return _unreachable(e)
    return data["raw"]


@mcp.tool()
async def list_active_tasks() -> str:
    """The user's currently active tasks across all projects — useful context
    for what they're working on right now."""
    try:
        data = await _get("/api/tasks/active-summary")
    except httpx.HTTPError as e:
        return _unreachable(e)
    active = data.get("active", [])
    if not active:
        return "No active tasks."
    lines = []
    for t in active:
        lines.append(
            f"- [{t['project_name']}] {t['main_task_name']} "
            f"({t['subtask_done']}/{t['subtask_total']} subtasks done"
            f"{', due ' + t['deadline'] if t.get('deadline') else ''})"
        )
    return "\n".join(lines)


@mcp.tool()
async def related_notes(citekey: str) -> str:
    """Notes/papers linked to or similar to the given citekey — wikilinks,
    citations, and content-similarity neighbors from the knowledge graph."""
    try:
        data = await _post("/api/graph/neighbors", {"note": citekey, "limit": 20})
    except httpx.HTTPError as e:
        return _unreachable(e)
    neighbors = data.get("neighbors", [])
    if not neighbors:
        return f"No related notes found for '{citekey}'."
    lines = [f"Related to '{citekey}':"]
    for n in neighbors:
        lines.append(f"- {n['note']} ({n.get('type', 'related')}: {n.get('reason_text', '')})")
    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run(transport="stdio")
