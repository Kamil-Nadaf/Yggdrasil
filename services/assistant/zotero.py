"""
zotero.py — Zotero lookup with two-strategy fallback.

Strategy 1: Better BibTeX local HTTP API (http://localhost:23119/better-bibtex/json-rpc)
  → Requires Zotero desktop to be running with Better BibTeX plugin installed.
  → Fast, offline, no API key needed.

Strategy 2: Zotero Web API (https://api.zotero.org/users/{id}/items)
  → Requires ZOTERO_USER_ID and ZOTERO_API_KEY in environment.
  → Works when Zotero desktop is not running (server context).

Both strategies return a dict with keys:
  citekey, title, authors, year, journal, doi, arxiv (if available)

The citekey returned by BBT is used as the note filename stem.
"""

import os
import re
import httpx
from typing import Optional


BBT_URL = "http://localhost:23119/better-bibtex/json-rpc"
ZOTERO_API = "https://api.zotero.org"


def _bbt_search(query: str) -> Optional[dict]:
    """Try Better BibTeX local JSON-RPC search."""
    try:
        resp = httpx.post(
            BBT_URL,
            json={
                "jsonrpc": "2.0",
                "method": "item.search",
                "params": [query],
                "id": 1,
            },
            timeout=3.0,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("result", [])
        if not items:
            return None
        item = items[0]
        return {
            "citekey": item.get("citekey", ""),
            "title": item.get("title", ""),
            "authors": _parse_bbt_authors(item.get("author", [])),
            "year": str(item.get("issued", {}).get("date-parts", [[""]])[0][0]),
            "journal": item.get("container-title", item.get("publisher", "")),
            "doi": item.get("DOI", ""),
            "arxiv": _extract_arxiv_id(item),
        }
    except Exception:
        return None


def _web_api_search(query: str) -> Optional[dict]:
    """Try Zotero Web API search."""
    user_id = os.environ.get("ZOTERO_USER_ID", "")
    api_key = os.environ.get("ZOTERO_API_KEY", "")
    if not user_id or not api_key:
        return None
    try:
        resp = httpx.get(
            f"{ZOTERO_API}/users/{user_id}/items",
            params={"q": query, "format": "json", "limit": 5},
            headers={"Zotero-API-Key": api_key},
            timeout=5.0,
        )
        resp.raise_for_status()
        items = resp.json()
        if not items:
            return None
        data = items[0].get("data", {})
        creators = data.get("creators", [])
        authors = [
            f"{c.get('lastName', '')}, {c.get('firstName', '')}"
            for c in creators
            if c.get("creatorType") == "author"
        ]
        # Derive a citekey: firstAuthorLastNameYearFirstTitleWord
        last = creators[0].get("lastName", "unknown") if creators else "unknown"
        year = data.get("date", "")[:4] or "0000"
        title_word = re.split(r"\W+", data.get("title", "unknown"))[0].lower()
        citekey = f"{last.lower()}{year}{title_word}"
        return {
            "citekey": citekey,
            "title": data.get("title", ""),
            "authors": authors,
            "year": year,
            "journal": data.get("publicationTitle", data.get("bookTitle", "")),
            "doi": data.get("DOI", ""),
            "arxiv": _extract_arxiv_id_from_url(data.get("url", "")),
        }
    except Exception:
        return None


def search_zotero(query: str) -> Optional[dict]:
    """
    Search Zotero for a paper. Tries BBT first, falls back to Web API.
    Returns metadata dict or None if not found.
    """
    result = _bbt_search(query)
    if result:
        return result
    return _web_api_search(query)


def ensure_arxiv_in_zotero(arxiv_id: str) -> Optional[dict]:
    """
    Ensure an arXiv paper exists in Zotero. Searches first; if not found,
    adds it via Zotero Web API using the arXiv identifier URL.
    Returns metadata dict or None on failure.
    """
    # First try searching by arXiv ID
    result = search_zotero(arxiv_id)
    if result:
        return result

    # Try adding via Web API
    user_id = os.environ.get("ZOTERO_USER_ID", "")
    api_key = os.environ.get("ZOTERO_API_KEY", "")
    if not user_id or not api_key:
        return None

    try:
        # Use Zotero's web translation server approach: add by URL
        add_resp = httpx.post(
            f"{ZOTERO_API}/users/{user_id}/items",
            headers={
                "Zotero-API-Key": api_key,
                "Content-Type": "application/json",
            },
            json=[
                {
                    "itemType": "preprint",
                    "title": "",
                    "url": f"https://arxiv.org/abs/{arxiv_id}",
                    "archiveID": f"arXiv:{arxiv_id}",
                    "repository": "arXiv",
                }
            ],
            timeout=8.0,
        )
        add_resp.raise_for_status()
        # Search again after adding
        return search_zotero(arxiv_id)
    except Exception:
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_bbt_authors(author_list: list) -> list[str]:
    out = []
    for a in author_list:
        if isinstance(a, dict):
            family = a.get("family", "")
            given = a.get("given", "")
            out.append(f"{family}, {given}" if given else family)
    return out


def _extract_arxiv_id(item: dict) -> str:
    """Try to extract arXiv ID from BBT item."""
    for field in ["archiveID", "eprint", "url"]:
        val = item.get(field, "")
        if val:
            m = re.search(r"(\d{4}\.\d{4,5})", val)
            if m:
                return m.group(1)
    return ""


def _extract_arxiv_id_from_url(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"arxiv\.org/abs/(\d{4}\.\d{4,5})", url)
    return m.group(1) if m else ""
