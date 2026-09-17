"""
main.py — CERIC Reading System API (FastAPI)

Routes:
  GET  /api/brief/today
  GET  /api/papers
  GET  /api/papers/{citekey}
  PUT  /api/papers/{citekey}
  DELETE /api/papers/{citekey}
  POST /api/papers/{citekey}/triage
  POST /api/papers/{citekey}/append-slot
  GET  /api/papers/{citekey}/raw
  GET  /api/books
  POST /api/books
  GET  /api/books/{slug}/sections
  GET  /api/books/{slug}/sections/{id}
  PUT  /api/books/{slug}/sections/{id}
  DELETE /api/books/{slug}/sections/{id}
  GET  /api/books/{slug}/sections/{id}/raw
  POST /api/locate
  POST /api/ask
  POST /api/examine          ← GATE PROTECTED; AI call (provider from request, not stored)
  GET  /api/habits/range
  GET  /api/habits/{date}
  POST /api/habits/{date}
  GET  /api/task-projects
  POST /api/task-projects
  DELETE /api/task-projects/{slug}
  GET  /api/task-projects/{slug}/main-tasks
  POST /api/task-projects/{slug}/main-tasks
  PUT  /api/task-projects/{slug}/main-tasks/{id}
  DELETE /api/task-projects/{slug}/main-tasks/{id}
  GET  /api/task-projects/{slug}/main-tasks/{id}/subtasks
  POST /api/task-projects/{slug}/main-tasks/{id}/subtasks
  PUT  /api/task-projects/{slug}/main-tasks/{id}/subtasks/{sid}
  DELETE /api/task-projects/{slug}/main-tasks/{id}/subtasks/{sid}
  GET  /api/tasks/active-summary
  GET  /api/tasks/completed-by-day
  GET  /api/graph
  GET  /api/zotero/search
  POST /api/zotero/ensure/{arxiv_id}
  POST /api/zotero/add-paper
  GET  /api/arxiv/daily
  GET  /api/arxiv/search
  POST /api/latex/compile    ← proxied to the internal `latex` service
  POST /api/latex/save
  GET  /api/latex/files
  GET  /api/latex/files/{filename}
  DELETE /api/latex/files/{filename}
  GET  /api/vault/git/status
  POST /api/vault/git/init
  POST /api/vault/git/sync
  GET  /api/vault/webdav/status
  POST /api/vault/webdav/config
  POST /api/vault/webdav/sync

Static frontend served from /app/frontend/dist at /
"""

import os
import re
import glob
import json
import time
import uuid
import shutil
import asyncio
import subprocess
import xml.etree.ElementTree as ET
from datetime import date, timedelta, datetime
from pathlib import Path
from typing import Optional, Any

import frontmatter
import httpx
import lancedb
import pyarrow as pa
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from gate import check_gate, GateError
from zotero import search_zotero, ensure_arxiv_in_zotero, add_paper_to_zotero
from data_manifest import (
    APP_VERSION as MANIFEST_APP_VERSION,
    count_tex_files,
    ensure_layout_safe,
    inspect_data_dir,
    load_manifest,
    write_manifest,
)
from analysis_tags import (
    DEFAULT_ANALYSIS_TAGS,
    analysis_keys,
    load_app_settings,
    migrate_frontmatter_keys,
    normalize_analysis_tags,
    save_app_settings,
    scan_frontmatter_keys,
    tag_to_key,
)
from task_statuses import (
    DEFAULT_TASK_STATUSES,
    normalize_task_statuses,
    load_task_statuses,
)
from goals import load_goals, normalize_goals
from arxiv_topics import (
    ARXIV_TOPICS,
    is_valid_category,
    normalize_category,
    search_query_for,
    is_openalex_topic,
    get_topic_search_query,
)
from graph_links import (
    DEFAULT_SIMILARITY_THRESHOLD,
    cosine,
    delete_auto_edges_for,
    delete_manual_edges_for,
    embed_text,
    extract_note_features,
    get_edges_table,
    load_features_from_vault,
    manual_edges_from_wikilinks,
    neighbors_from_rows,
    overlap_edges,
    upsert_edges,
)

# ── Config ────────────────────────────────────────────────────────────────────

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
DESKTOP_MODE = os.environ.get("YGG_DESKTOP", "").lower() in ("1", "true", "yes")
CONFIG_PATH = Path(os.environ["YGG_CONFIG_PATH"]) if os.environ.get("YGG_CONFIG_PATH") else None
VAULT_FOLDERS = (
    "00-Inbox",
    "10-Papers",
    "15-Books",
    "20-Concepts",
    "30-Questions",
    "40-Synthesis",
    "50-Projects",
    "60-Meta",
    "70-LaTeX",
    "80-Tasks",
)
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
GATE_CHECK = os.environ.get("GATE_CHECK", "true").lower() != "false"
LATEX_URL = os.environ.get("LATEX_URL", "http://latex:9000")
FEYNMAN_URL = os.environ.get("FEYNMAN_URL", "http://feynman:6174").rstrip("/")
FEYNMAN_HOST_PORT = os.environ.get("FEYNMAN_HOST_PORT", "6174")
LANCEDB_PATH = os.environ.get("LANCEDB_PATH", "/data/lancedb")
APP_VERSION = os.environ.get("YGG_APP_VERSION", MANIFEST_APP_VERSION)
EXISTING_DATA = os.environ.get("YGG_EXISTING_DATA", "").lower() in ("1", "true", "yes")
PREVIOUS_APP_VERSION = os.environ.get("YGG_PREVIOUS_VERSION", "")

def _desktop_config() -> dict:
    if not CONFIG_PATH or not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text())
    except Exception:
        return {}


def _write_desktop_config(data: dict) -> None:
    if not CONFIG_PATH:
        return
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(data, indent=2))


def ensure_vault_layout(root: Path) -> None:
    ensure_layout_safe(root)


def set_vault(path: Path) -> Path:
    """Point the running app at a new notes folder (desktop only)."""
    global VAULT
    resolved = path.expanduser().resolve()
    if not str(resolved) or resolved == Path("/"):
        raise ValueError("Choose a folder, not the disk root.")
    ensure_layout_safe(resolved)
    VAULT = resolved
    os.environ["VAULT_PATH"] = str(resolved)
    if DESKTOP_MODE:
        cfg = _desktop_config()
        cfg["vault_path"] = str(resolved)
        cfg["data_path_chosen"] = True
        _write_desktop_config(cfg)
        try:
            write_manifest(resolved)
        except Exception:
            pass
    return VAULT


if DESKTOP_MODE:
    saved = _desktop_config().get("vault_path")
    if saved:
        VAULT = Path(saved).expanduser()
    manifest = load_manifest(VAULT)
    if manifest and manifest.get("vault_path"):
        VAULT = Path(manifest["vault_path"]).expanduser()
    ensure_layout_safe(VAULT)

app = FastAPI(title="CERIC Reading System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── LanceDB helpers ───────────────────────────────────────────────────────────

def get_table():
    db = lancedb.connect(LANCEDB_PATH)
    try:
        return db.open_table("notes")
    except Exception:
        return None


async def embed(text: str, cfg: Optional["ProviderConfig"] = None) -> list[float]:
    """
    Embed text for LanceDB search.
    Prefer Ollama when available; fall back to OpenAI-compatible embeddings
    (LM Studio /v1/embeddings) so Ask works without Ollama.
    """
    errors: list[str] = []
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text},
                timeout=30.0,
            )
            if resp.status_code < 400:
                return resp.json()["embedding"]
            errors.append(f"ollama:{resp.status_code}")
        except Exception as e:
            errors.append(f"ollama:{e}")

        # OpenAI-compatible embeddings (LM Studio, etc.)
        base = None
        model = "text-embedding-nomic-embed-text-v1.5"
        api_key = "lm-studio"
        if cfg and cfg.provider in ("lmstudio", "ollama") and cfg.base_url:
            base = cfg.base_url
            api_key = cfg.api_key or api_key
        elif cfg and cfg.base_url and "1234" in (cfg.base_url or ""):
            base = cfg.base_url
            api_key = cfg.api_key or api_key
        if not base:
            # Common local LM Studio default when Ollama is down
            base = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234")
        base = _resolve_llm_base_url(base).rstrip("/")
        try:
            resp = await client.post(
                f"{base}/v1/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "input": text[:8000]},
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json().get("data") or []
            if data and data[0].get("embedding"):
                return list(data[0]["embedding"])
            errors.append("openai-embed:empty")
        except Exception as e:
            errors.append(f"openai-embed:{e}")

    raise HTTPException(
        status_code=503,
        detail="Embedding failed (need Ollama or LM Studio embeddings). " + "; ".join(errors[:2]),
    )


def _resolve_llm_base_url(url: str) -> str:
    """From Docker, localhost is the container — rewrite to the host gateway."""
    u = (url or "").strip().rstrip("/")
    if not u:
        return u
    if DESKTOP_MODE:
        return u
    # Docker Desktop (Mac/Windows) + compose on Linux with extra_hosts
    gateway = os.environ.get("HOST_LLM_GATEWAY", "host.docker.internal")
    for loopback in ("127.0.0.1", "localhost"):
        if f"://{loopback}" in u or u.startswith(loopback):
            return u.replace(loopback, gateway, 1)
    return u


def _message_text(msg: dict) -> str:
    """OpenAI-compatible message → text (handles reasoning-only models)."""
    content = msg.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
            elif isinstance(block, str):
                parts.append(block)
        joined = "\n".join(p for p in parts if p).strip()
        if joined:
            return joined
    for key in ("reasoning_content", "reasoning"):
        val = msg.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


# ── Vault helpers ─────────────────────────────────────────────────────────────

def paper_path(citekey: str) -> Path:
    return VAULT / "10-Papers" / f"{citekey}.md"


def load_paper(citekey: str) -> dict:
    path = paper_path(citekey)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Paper not found: {citekey}")
    post = frontmatter.load(str(path))
    return {"citekey": citekey, "frontmatter": dict(post.metadata), "body": post.content}


def all_papers() -> list[dict]:
    papers = []
    for p in sorted((VAULT / "10-Papers").glob("*.md")):
        post = frontmatter.load(str(p))
        papers.append({"citekey": p.stem, "frontmatter": dict(post.metadata)})
    return papers


def current_analysis_tags() -> list[str]:
    return list(load_app_settings(VAULT).get("analysis_tags") or DEFAULT_ANALYSIS_TAGS)


def current_analysis_keys() -> list[str]:
    return analysis_keys(current_analysis_tags())


def current_task_statuses() -> list[dict]:
    return load_task_statuses(load_app_settings(VAULT))


def current_goals() -> list[dict]:
    return load_goals(load_app_settings(VAULT))


def gate_status(citekey: str) -> dict:
    """Return gate pass/fail and which slots are missing."""
    path = paper_path(citekey)
    if not path.exists():
        return {"passed": False, "missing": ["note does not exist"]}
    try:
        check_gate(path, slots=current_analysis_keys())
        return {"passed": True, "missing": []}
    except GateError as e:
        return {
            "passed": False,
            "missing": e.missing_slots,
            "aq_missing": e.aq_missing,
        }


def _gate_passed(path: Path) -> bool:
    try:
        check_gate(path, slots=current_analysis_keys())
        return True
    except (GateError, FileNotFoundError, OSError):
        return False


async def _refresh_graph_edges_for(citekey: str, fm: dict, body: str = "") -> None:
    """Recompute manual + auto edges for one note. Never mutates note content."""
    try:
        table = get_edges_table(LANCEDB_PATH)
    except Exception:
        return
    keys = current_analysis_keys()
    delete_manual_edges_for(table, citekey)
    delete_auto_edges_for(table, citekey)
    wiki_text = (body or "") + "\n" + " ".join(str(fm.get(k) or "") for k in keys)
    upsert_edges(table, manual_edges_from_wikilinks(citekey, wiki_text))

    source = extract_note_features(citekey, fm, body or "", analysis_keys=keys)
    # Representative embedding from claim + title (local Ollama only)
    claim_key = keys[0] if keys else "claim"
    seed = f"{fm.get('title', '')}\n{fm.get(claim_key, '')}\n{body or ''}"
    try:
        src_vec = await embed_text(OLLAMA_URL, EMBED_MODEL, seed)
    except Exception:
        src_vec = None

    others = load_features_from_vault(VAULT, analysis_keys=keys)
    notes_table = get_table()
    auto: list[dict] = []
    for other_key, other_feat in others.items():
        if other_key == citekey:
            continue
        sim = None
        if src_vec is not None and notes_table is not None:
            try:
                hits = (
                    notes_table.search(src_vec)
                    .where(f"citekey = '{other_key}'", prefilter=True)
                    .limit(1)
                    .select(["citekey", "embedding"])
                    .to_list()
                )
                if hits and hits[0].get("embedding"):
                    sim = cosine(src_vec, list(hits[0]["embedding"]))
                else:
                    # Fall back: search then filter
                    neigh = notes_table.search(src_vec).limit(40).select(["citekey", "embedding"]).to_list()
                    for n in neigh:
                        if n.get("citekey") == other_key and n.get("embedding"):
                            sim = cosine(src_vec, list(n["embedding"]))
                            break
            except Exception:
                sim = None
        if sim is None:
            # Without an embedding match, still allow hard overlaps at high confidence
            sim = 0.8 if (
                set(source["methods"]) & set(other_feat["methods"])
                or set(source["entities"]) & set(other_feat["entities"])
                or set(source["citations"]) & set(other_feat["citations"])
            ) else 0.0
        auto.extend(
            overlap_edges(source, other_feat, similarity=sim, threshold=DEFAULT_SIMILARITY_THRESHOLD)
        )
    upsert_edges(table, auto)


# ── Brief ─────────────────────────────────────────────────────────────────────

@app.get("/api/brief/today")
async def brief_today():
    today = date.today().strftime("%Y-%m-%d")
    brief_path = VAULT / "00-Inbox" / f"Brief-{today}.md"
    if not brief_path.exists():
        # Try yesterday as fallback
        yesterday = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")
        brief_path = VAULT / "00-Inbox" / f"Brief-{yesterday}.md"
        if not brief_path.exists():
            return {"date": today, "papers": [], "raw": ""}
    text = brief_path.read_text()
    return {"date": today, "raw": text, "path": str(brief_path)}


# ── Papers ────────────────────────────────────────────────────────────────────

@app.get("/api/papers")
async def list_papers():
    return all_papers()


@app.get("/api/papers/{citekey}")
async def get_paper(citekey: str):
    paper = load_paper(citekey)
    paper["gate"] = gate_status(citekey)
    return paper


class PaperUpdate(BaseModel):
    frontmatter: dict[str, Any]
    body: Optional[str] = None


@app.put("/api/papers/{citekey}")
async def update_paper(citekey: str, payload: PaperUpdate):
    """
    Write frontmatter + optional body to a paper note.
    CONSTRAINT: Never write into CERIC slots from AI code — this endpoint
    is called by the browser (user input only). The server does not
    auto-populate claim/evidence/reasoning/implications/context/aq_written.
    """
    path = paper_path(citekey)
    if path.exists():
        post = frontmatter.load(str(path))
    else:
        post = frontmatter.Post("")

    # Merge frontmatter
    for k, v in payload.frontmatter.items():
        post.metadata[k] = v

    if payload.body is not None:
        post.content = payload.body

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter.dumps(post))

    try:
        await _refresh_graph_edges_for(citekey, dict(post.metadata), post.content or "")
    except Exception:
        pass

    return {"ok": True, "citekey": citekey}


@app.delete("/api/papers/{citekey}")
async def delete_paper(citekey: str):
    """
    Permanently delete a paper note from 10-Papers/.
    Only touches a single .md file under that folder — no path traversal.
    """
    if not citekey or "/" in citekey or "\\" in citekey or citekey in (".", "..") or ".." in citekey:
        raise HTTPException(status_code=400, detail="Invalid citekey")
    path = paper_path(citekey).resolve()
    papers_dir = (VAULT / "10-Papers").resolve()
    if path.parent != papers_dir:
        raise HTTPException(status_code=400, detail="Invalid citekey")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Paper not found: {citekey}")
    path.unlink()
    return {"ok": True, "citekey": citekey}


class TriagePayload(BaseModel):
    verdict: str  # "read" | "skip" | "later"
    claim: Optional[str] = None


@app.post("/api/papers/{citekey}/triage")
async def triage_paper(citekey: str, payload: TriagePayload):
    """Save triage verdict (and optional initial claim) to frontmatter."""
    path = paper_path(citekey)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Paper not found: {citekey}")
    post = frontmatter.load(str(path))
    post.metadata["verdict"] = payload.verdict
    if payload.claim:
        first_key = (_slot_keys() or ["claim"])[0]
        post.metadata[first_key] = payload.claim
    path.write_text(frontmatter.dumps(post))
    return {"ok": True}


CERIC_SLOT_KEYS = ["claim", "evidence", "reasoning", "implications", "context"]


def _slot_keys() -> list[str]:
    """Configured analysis frontmatter keys (defaults to classic CERIC)."""
    return current_analysis_keys() or list(CERIC_SLOT_KEYS)


def _ensure_paper_skeleton(citekey: str, meta: dict) -> "frontmatter.Post":
    """
    Load an existing paper note, or build a fresh skeleton with the standard
    CERIC frontmatter schema. Never touches an existing file's content — only
    used as the starting point when a paper reaches the CERIC system for the
    first time (e.g. captured straight from arXiv Search, before any Zotero
    lookup — citekey is the arXiv id in that case).
    """
    path = paper_path(citekey)
    if path.exists():
        return frontmatter.load(str(path))
    post = frontmatter.Post("")
    post.metadata.update(
        {
            "citekey": citekey,
            "arxiv": meta.get("arxiv") or citekey,
            "title": meta.get("title") or "",
            "authors": meta.get("authors") or [],
            "year": meta.get("year") or "",
            "journal": "",
            "doi": "",
            "read": date.today().strftime("%Y-%m-%d"),
            "tier": 0,
            "confidence": 0,
            "rating": 0,
            "aq_written": False,
            "adversarial_question": "",
            "verdict": "",
            "objects": [],
            "instruments": [],
            "methods": [],
            "concepts": [],
            "tags": [],
        }
    )
    for key in _slot_keys():
        post.metadata.setdefault(key, "")
    return post


class AppendSlotPayload(BaseModel):
    slot: str
    text: str
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    arxiv: Optional[str] = None
    year: Optional[str] = None


@app.post("/api/papers/{citekey}/append-slot")
async def append_slot(citekey: str, payload: AppendSlotPayload):
    """
    Append text to one analysis slot, creating a skeleton note first if this paper
    has no note yet. Never overwrites existing slot content — always appends
    with a newline separator; the user reviews/edits the result afterward in
    the CERIC Editor. Uses python-frontmatter for the write, never hand-rolled YAML.
    """
    if payload.slot not in _slot_keys():
        raise HTTPException(status_code=400, detail=f"Invalid slot: {payload.slot}")

    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")

    post = _ensure_paper_skeleton(
        citekey,
        {"title": payload.title, "authors": payload.authors, "arxiv": payload.arxiv, "year": payload.year},
    )

    current = post.metadata.get(payload.slot, "") or ""
    post.metadata[payload.slot] = f"{current}\n{text}".strip() if current.strip() else text

    path = paper_path(citekey)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter.dumps(post))

    try:
        await _refresh_graph_edges_for(citekey, dict(post.metadata), post.content or "")
    except Exception:
        pass

    return {"ok": True, "citekey": citekey, "slot": payload.slot, "value": post.metadata[payload.slot]}


@app.get("/api/papers/{citekey}/raw")
async def get_paper_raw(citekey: str):
    """Raw .md text for clipboard/export — read-only; serialized by python-frontmatter."""
    path = paper_path(citekey)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Paper not found: {citekey}")
    post = frontmatter.load(str(path))
    return {"raw": frontmatter.dumps(post)}


# ── Books (15-Books/{slug}/) ──────────────────────────────────────────────────

BOOK_SLUG_RE = re.compile(r"^[a-z0-9-]+$")
BOOK_SECTION_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
BOOK_SECTION_BODY = """## Preview
<!-- 2–3 sentences: what question does this section answer? -->

## Explain Cold
<!-- Book closed. Explain this in your own words to a smart undergrad. -->

## Sanity Check
<!-- Plug in a real number. Does the order of magnitude make sense? -->

## Confusions
<!-- List what you don't understand yet. Chase one; leave the rest here. -->
"""


def books_root() -> Path:
    return VAULT / "15-Books"


def _validate_book_slug(slug: str) -> str:
    if not slug or not BOOK_SLUG_RE.fullmatch(slug):
        raise HTTPException(status_code=400, detail="Invalid book slug")
    return slug


def _validate_section_id(section_id: str) -> str:
    if not section_id or section_id.startswith("_") or not BOOK_SECTION_ID_RE.fullmatch(section_id):
        raise HTTPException(status_code=400, detail="Invalid section id")
    return section_id


def book_dir(slug: str) -> Path:
    slug = _validate_book_slug(slug)
    root = books_root().resolve()
    path = (root / slug).resolve()
    if path.parent != root:
        raise HTTPException(status_code=400, detail="Invalid book slug")
    return path


def book_md_path(slug: str) -> Path:
    return book_dir(slug) / "_book.md"


def section_path(slug: str, section_id: str) -> Path:
    section_id = _validate_section_id(section_id)
    folder = book_dir(slug)
    path = (folder / f"{section_id}.md").resolve()
    if path.parent != folder.resolve():
        raise HTTPException(status_code=400, detail="Invalid section id")
    return path


def _ensure_book_section_skeleton(slug: str, section_id: str, meta: dict) -> "frontmatter.Post":
    """Load an existing section note, or build the standard book-section skeleton."""
    path = section_path(slug, section_id)
    if path.exists():
        return frontmatter.load(str(path))
    post = frontmatter.Post(BOOK_SECTION_BODY)
    post.metadata.update(
        {
            "type": "book-section",
            "book": slug,
            "chapter": meta.get("chapter") if meta.get("chapter") is not None else 0,
            "section": meta.get("section") if meta.get("section") is not None else "",
            "title": meta.get("title") or "",
            "track": meta.get("track"),
            "read": meta.get("read") or date.today().strftime("%Y-%m-%d"),
            "tier": meta.get("tier") if meta.get("tier") is not None else 0,
            "confidence": meta.get("confidence") if meta.get("confidence") is not None else 0,
            "concepts": meta.get("concepts") or [],
            "tags": meta.get("tags") or [],
            "explain_cold": meta.get("explain_cold") or "",
            "sanity_check": meta.get("sanity_check") or "",
            "confusions": meta.get("confusions") or "",
        }
    )
    return post


class BookCreate(BaseModel):
    slug: str
    title: str
    authors: list[str] = []
    year: Optional[int] = None
    has_tracks: bool = False


class BookSectionUpdate(BaseModel):
    frontmatter: dict[str, Any]
    body: Optional[str] = None


@app.get("/api/books")
async def list_books():
    root = books_root()
    books = []
    if not root.exists():
        return {"books": books}
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        md = d / "_book.md"
        if not md.is_file():
            continue
        post = frontmatter.load(str(md))
        fm = dict(post.metadata)
        section_count = sum(1 for p in d.glob("*.md") if p.name != "_book.md")
        books.append(
            {
                "slug": fm.get("slug") or d.name,
                "title": fm.get("title") or d.name,
                "authors": fm.get("authors") or [],
                "year": fm.get("year"),
                "has_tracks": bool(fm.get("has_tracks")),
                "started": fm.get("started"),
                "section_count": section_count,
            }
        )
    return {"books": books}


@app.post("/api/books")
async def create_book(payload: BookCreate):
    slug = _validate_book_slug(payload.slug)
    path = book_md_path(slug)
    if path.exists():
        raise HTTPException(status_code=409, detail="Book already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post("")
    post.metadata.update(
        {
            "type": "book",
            "slug": slug,
            "title": payload.title,
            "authors": payload.authors or [],
            "year": payload.year,
            "has_tracks": bool(payload.has_tracks),
            "total_sections": None,
            "started": date.today().strftime("%Y-%m-%d"),
        }
    )
    path.write_text(frontmatter.dumps(post))
    return {"ok": True, "slug": slug}


@app.delete("/api/books/{slug}")
async def delete_book(slug: str):
    folder = book_dir(slug)
    book_path = folder / "_book.md"
    if not book_path.is_file():
        raise HTTPException(status_code=404, detail="Book not found")
    shutil.rmtree(folder)
    return {"ok": True, "slug": slug}


@app.get("/api/books/{slug}/sections")
async def list_book_sections(slug: str):
    path = book_md_path(slug)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Book not found")
    post = frontmatter.load(str(path))
    sections = []
    for p in sorted(path.parent.glob("*.md")):
        if p.name == "_book.md":
            continue
        sp = frontmatter.load(str(p))
        sections.append({"id": p.stem, "frontmatter": dict(sp.metadata)})
    return {"book": dict(post.metadata), "sections": sections}


@app.get("/api/books/{slug}/sections/{id}/raw")
async def get_book_section_raw(slug: str, id: str):
    path = section_path(slug, id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Section not found")
    post = frontmatter.load(str(path))
    return {"raw": frontmatter.dumps(post)}


@app.get("/api/books/{slug}/sections/{id}")
async def get_book_section(slug: str, id: str):
    path = section_path(slug, id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Section not found")
    post = frontmatter.load(str(path))
    return {"id": id, "frontmatter": dict(post.metadata), "body": post.content}


@app.put("/api/books/{slug}/sections/{id}")
async def update_book_section(slug: str, id: str, payload: BookSectionUpdate):
    if not book_md_path(slug).exists():
        raise HTTPException(status_code=404, detail="Book not found")
    path = section_path(slug, id)
    created = not path.exists()
    post = _ensure_book_section_skeleton(slug, id, payload.frontmatter)
    for k, v in payload.frontmatter.items():
        post.metadata[k] = v
    post.metadata["type"] = "book-section"
    post.metadata["book"] = slug
    if payload.body is not None:
        post.content = payload.body
    elif created:
        post.content = BOOK_SECTION_BODY
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter.dumps(post))
    try:
        await _refresh_graph_edges_for(f"{slug}/{id}", dict(post.metadata), post.content or "")
    except Exception:
        pass
    return {"ok": True, "id": id}


@app.delete("/api/books/{slug}/sections/{id}")
async def delete_book_section(slug: str, id: str):
    path = section_path(slug, id)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Section not found")
    path.unlink()
    return {"ok": True}


LATEX_TARGET_RE = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$")


def _valid_latex_target(target: str) -> bool:
    if not target or any(part in ("", ".", "..") for part in target.split("/")):
        return False
    return bool(LATEX_TARGET_RE.fullmatch(target))


def _parse_md_heading_sections(body: str) -> dict[str, str]:
    headings = ("Preview", "Explain Cold", "Sanity Check", "Confusions")
    out = {h: "" for h in headings}
    matches = list(re.finditer(r"^## (Preview|Explain Cold|Sanity Check|Confusions)\s*$", body or "", re.M))
    for i, match in enumerate(matches):
        heading = match.group(1)
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body or "")
        text = re.sub(r"<!--.*?-->", "", (body or "")[start:end], flags=re.S).strip()
        out[heading] = text
    return out


def _latex_escape(text: str) -> str:
    return re.sub(r"([%$&#_{}])", r"\\\1", text)


def _build_book_latex_snippet(book_title: str, slug: str, fm: dict, body: str) -> str:
    parsed = _parse_md_heading_sections(body)
    def field(heading: str, key: str) -> str:
        return (parsed.get(heading) or str(fm.get(key) or "")).strip()

    preview = field("Preview", "preview")
    explain = field("Explain Cold", "explain_cold")
    sanity = field("Sanity Check", "sanity_check")
    confusions = field("Confusions", "confusions")
    chapter = fm.get("chapter", "")
    section = fm.get("section", "")
    title = str(fm.get("title") or "")
    rule = "─" * 33
    lines = [
        f"% ── {_latex_escape(str(book_title))} · Ch.{chapter} §{section} {rule}",
        f"\\subsection*{{{_latex_escape(title)}}}",
        f"\\label{{sec:{slug}-ch{chapter}-s{section}}}",
        "",
    ]
    for heading, text in (
        ("Preview", preview),
        ("Explain Cold", explain),
        ("Sanity Check", sanity),
        ("Confusions", confusions),
    ):
        if text:
            lines.append(f"\\paragraph{{{heading}}}")
            lines.append(_latex_escape(text))
            lines.append("")
    return "\n".join(lines) + "\n"


class LatexExportPayload(BaseModel):
    target_file: str
    mode: str  # append | create


@app.post("/api/books/{slug}/sections/{id}/export-latex")
async def export_book_section_latex(slug: str, id: str, payload: LatexExportPayload):
    target = (payload.target_file or "").strip()
    if not _valid_latex_target(target):
        raise HTTPException(status_code=400, detail="Invalid target_file")
    if payload.mode not in ("append", "create"):
        raise HTTPException(status_code=400, detail="mode must be append or create")
    path = section_path(slug, id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Section not found")
    post = frontmatter.load(str(path))
    book_title = slug
    book_path = book_md_path(slug)
    if book_path.exists():
        book_title = frontmatter.load(str(book_path)).metadata.get("title") or slug
    snippet = _build_book_latex_snippet(str(book_title), slug, dict(post.metadata), post.content or "")
    filename = target if target.endswith(".tex") else f"{target}.tex"

    if payload.mode == "create":
        status, _body = await _latex_json("GET", f"/files/{filename}")
        if status == 200:
            raise HTTPException(status_code=409, detail="File already exists")
        status, body = await _latex_json("POST", "/save", json={"filename": filename, "source": snippet})
    else:
        status, body = await _latex_json("GET", f"/files/{filename}")
        if status != 200:
            raise HTTPException(status_code=status if status >= 400 else 404, detail=body.get("detail") or "File not found")
        existing = str(body.get("source") or "")
        if existing and not existing.endswith("\n"):
            existing += "\n"
        status, body = await _latex_json("POST", "/save", json={"filename": filename, "source": existing + snippet})

    if status >= 400:
        raise HTTPException(status_code=status, detail=body.get("detail") or "LaTeX save failed")
    return {"ok": True, "path": f"70-LaTeX/{filename}"}


# ── Locate (vector search, returns excerpts) ──────────────────────────────────

class LocateQuery(BaseModel):
    query: str
    limit: int = 5


@app.post("/api/locate")
async def locate(payload: LocateQuery):
    table = get_table()
    if table is None:
        return {"results": [], "warning": "Index not ready yet"}
    vec = await embed(payload.query)
    results = (
        table.search(vec)
        .limit(payload.limit)
        .select(["id", "citekey", "chunk", "note_path"])
        .to_list()
    )
    return {"results": results}


# ── Ask (RAG over user's notes only) ─────────────────────────────────────────

class ProviderConfig(BaseModel):
    """Client-supplied AI config — used for this request only, never persisted."""
    provider: str = "ollama"  # ollama | lmstudio | claude | deepseek | kimi | huggingface
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None


class AskQuery(BaseModel):
    question: str
    limit: int = 6
    provider: Optional[ProviderConfig] = None


async def _llm_generate(prompt: str, cfg: Optional[ProviderConfig]) -> str:
    """Call the client-selected provider. Keys come from the request body only."""
    provider = (cfg.provider if cfg else "ollama") or "ollama"
    model = (cfg.model if cfg and cfg.model else None)
    api_key = (cfg.api_key if cfg else None) or ""
    base_url = (cfg.base_url if cfg and cfg.base_url else None)

    if provider == "lmstudio":
        url = _resolve_llm_base_url(base_url or "http://127.0.0.1:1234")
        gen_model = model or "spark-x2.5-4b"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key or 'lm-studio'}"},
                json={
                    "model": gen_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 2048,
                },
                timeout=120.0,
            )
            resp.raise_for_status()
            msg = (resp.json().get("choices") or [{}])[0].get("message") or {}
            text = _message_text(msg)
            if not text:
                raise HTTPException(status_code=502, detail="LM Studio returned an empty response")
            return text

    if provider == "ollama":
        url = _resolve_llm_base_url(base_url or OLLAMA_URL)
        gen_model = model or "llama3.2"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{url}/api/generate",
                json={"model": gen_model, "prompt": prompt, "stream": False},
                timeout=90.0,
            )
            if resp.status_code >= 400:
                resp = await client.post(
                    f"{url}/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key or 'ollama'}"},
                    json={
                        "model": gen_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 2048,
                    },
                    timeout=90.0,
                )
                resp.raise_for_status()
                msg = (resp.json().get("choices") or [{}])[0].get("message") or {}
                return _message_text(msg) or ""
            resp.raise_for_status()
            return resp.json().get("response", "")

    if provider == "claude":
        key = api_key or ANTHROPIC_API_KEY
        if not key:
            raise HTTPException(status_code=400, detail="Claude API key required (set it in Settings)")
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model or ANTHROPIC_MODEL,
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=90.0,
            )
            resp.raise_for_status()
            return resp.json()["content"][0]["text"]

    defaults = {
        "deepseek": ("https://api.deepseek.com", "deepseek-chat"),
        "kimi": ("https://api.moonshot.cn/v1", "moonshot-v1-8k"),
        "huggingface": ("https://router.huggingface.co/v1", "meta-llama/Meta-Llama-3-8B-Instruct"),
    }
    default_base, default_model = defaults.get(provider, ("", "gpt-4o-mini"))
    url = _resolve_llm_base_url(base_url or default_base)
    if not url:
        raise HTTPException(status_code=400, detail=f"base_url required for provider {provider}")
    if not api_key:
        raise HTTPException(status_code=400, detail=f"API key required for {provider} (set it in Settings)")
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "content-type": "application/json"},
            json={
                "model": model or default_model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2048,
            },
            timeout=90.0,
        )
        resp.raise_for_status()
        msg = (resp.json().get("choices") or [{}])[0].get("message") or {}
        return _message_text(msg) or resp.json()["choices"][0]["message"]["content"]


@app.post("/api/ask")
async def ask(payload: AskQuery):
    """
    Search user's notes via LanceDB and generate an answer.
    Provider/API key come from the request (browser localStorage) — never stored server-side.
    """
    table = get_table()
    results: list[dict] = []
    if table is not None:
        try:
            vec = await embed(payload.question, payload.provider)
            results = (
                table.search(vec)
                .limit(payload.limit)
                .select(["citekey", "chunk"])
                .to_list()
            )
        except HTTPException:
            raise
        except Exception:
            results = []

    # Fallback when index/embeddings unavailable: plain substring over vault notes
    if not results:
        q_norm = payload.question.strip().lower()
        hits = []
        for md in sorted((VAULT / "10-Papers").glob("*.md"))[:80]:
            try:
                post = frontmatter.load(str(md))
            except Exception:
                continue
            fm = post.metadata
            blob = " ".join(
                [
                    str(fm.get("title", "")),
                    str(fm.get("abstract", "")),
                    *[str(fm.get(k, "")) for k in current_analysis_keys()],
                    post.content or "",
                ]
            )
            if q_norm and q_norm in blob.lower():
                hits.append({"citekey": md.stem, "chunk": blob[:500]})
            elif not q_norm:
                hits.append({"citekey": md.stem, "chunk": blob[:500]})
            if len(hits) >= payload.limit:
                break
        if not hits:
            # Still call the model with an honest empty context so API-key testing works
            results = [{"citekey": "(none)", "chunk": "No notes indexed yet."}]
        else:
            results = hits

    paper_abstracts = {
        paper["citekey"]: str(paper["frontmatter"].get("abstract") or "").strip()
        for paper in all_papers()
    }
    for result in results:
        abstract = paper_abstracts.get(result.get("citekey", ""))
        if abstract and abstract.lower() not in result["chunk"].lower():
            result["chunk"] = f"{result['chunk']}\n\nPaper abstract:\n{abstract}"

    context = "\n\n---\n\n".join(
        f"[{r['citekey']}]: {r['chunk']}" for r in results
    )
    prompt = (
        "You are a research assistant. Answer the question using ONLY the "
        "provided excerpts from the researcher's own reading notes and the "
        "papers' abstracts. "
        "Cite the citekey when quoting. If the excerpts don't contain the "
        "answer, say so — do not use outside knowledge.\n\n"
        f"QUESTION: {payload.question}\n\n"
        f"EXCERPTS:\n{context}\n\nANSWER:"
    )

    try:
        answer = await _llm_generate(prompt, payload.provider)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}") from e

    sources = [{"citekey": r["citekey"], "excerpt": r["chunk"][:200]} for r in results if r["citekey"] != "(none)"]
    return {"answer": answer, "sources": sources}


class LokiKeywordQuery(BaseModel):
    query: str = ""
    limit: int = 40


@app.post("/api/loki/keywords")
async def loki_keywords(payload: LokiKeywordQuery):
    """List tags / objects / instruments / methods from notes. No LLM."""
    needle = payload.query.strip().lower()
    counts: dict[str, dict] = {}
    fields = ("tags", "concepts", "objects", "instruments", "methods")
    for paper in all_papers():
        fm = paper["frontmatter"]
        slot_bits = [str(fm.get(k, "")) for k in current_analysis_keys()]
        hay = " ".join(
            [
                str(fm.get("title", "")),
                " ".join(str(x) for x in (fm.get("authors") or [])),
                " ".join(str(x) for x in (fm.get("tags") or [])),
                " ".join(str(x) for x in (fm.get("concepts") or [])),
                " ".join(str(x) for x in (fm.get("objects") or [])),
                " ".join(str(x) for x in (fm.get("instruments") or [])),
                " ".join(str(x) for x in (fm.get("methods") or [])),
                *slot_bits,
            ]
        ).lower()
        if needle and needle not in hay:
            continue
        for field in fields:
            values = fm.get(field) or []
            if isinstance(values, str):
                values = [values]
            for raw in values:
                term = str(raw).strip().strip("[]")
                if not term:
                    continue
                key = term.lower()
                slot = counts.setdefault(key, {"term": term, "count": 0, "citekeys": []})
                slot["count"] += 1
                if paper["citekey"] not in slot["citekeys"]:
                    slot["citekeys"].append(paper["citekey"])
    ranked = sorted(counts.values(), key=lambda row: (-row["count"], row["term"].lower()))
    return {"keywords": ranked[: payload.limit], "query": payload.query}


# ── Examine (GATE PROTECTED) ───────────────────────────────────────────────────

class ExaminePayload(BaseModel):
    citekey: str
    provider: Optional[ProviderConfig] = None


@app.post("/api/examine")
async def examine(payload: ExaminePayload):
    """
    Run deep AI analysis on a paper. GATE PROTECTED.
    Provider/API key from the request body only — never persisted.
    CERIC slots are NEVER written by this endpoint.
    """
    path = paper_path(payload.citekey)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Paper not found")

    tags = current_analysis_tags()
    keys = current_analysis_keys()
    if GATE_CHECK:
        try:
            check_gate(path, slots=keys)
        except GateError as e:
            return JSONResponse(
                status_code=423,
                content={
                    "error": "Gate check failed",
                    "detail": str(e),
                    "missing_slots": e.missing_slots,
                    "aq_missing": e.aq_missing,
                },
            )

    post = frontmatter.load(str(path))
    fm = post.metadata

    seed_key = keys[0] if keys else "claim"
    vec = await embed(
        str(fm.get(seed_key, "")) + " " + str(fm.get("adversarial_question", "")),
        payload.provider,
    )
    table = get_table()
    context_chunks = []
    if table is not None:
        rows = (
            table.search(vec)
            .limit(5)
            .select(["citekey", "chunk"])
            .to_list()
        )
        context_chunks = [f"[{r['citekey']}]: {r['chunk']}" for r in rows if r["citekey"] != payload.citekey]

    context_str = "\n\n".join(context_chunks) if context_chunks else "No prior notes indexed yet."

    slot_lines = "\n".join(
        f"- {label}: {fm.get(key, '')}" for label, key in zip(tags, keys)
    )

    user_prompt = f"""You are reviewing a GRB astrophysics paper based on a researcher's active reading notes.

Paper: {fm.get('title', '')} ({fm.get('year', '')})
Authors: {', '.join(fm.get('authors', []))}
ArXiv: {fm.get('arxiv', '')}

Analysis notes (written by the researcher):
{slot_lines}

Adversarial Question posed: {fm.get('adversarial_question', '')}

Relevant excerpts from the researcher's prior notes:
{context_str}

Your task:
1. Evaluate whether the analysis slots are internally consistent.
2. Address the adversarial question directly — steelman the best counter-argument.
3. Identify 2-3 concepts in the researcher's existing notes that connect to this paper.
4. Suggest 1-2 follow-up questions for the 30-Questions vault.
5. Be concise and precise — this is a physics researcher, not a general audience.

Do NOT summarize the paper. Do NOT restate the analysis slots. Add value beyond what the researcher wrote."""

    try:
        cfg = payload.provider or ProviderConfig(
            provider="claude", api_key=ANTHROPIC_API_KEY or None, model=ANTHROPIC_MODEL
        )
        ai_text = await _llm_generate(user_prompt, cfg)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}") from e

    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    callout = f"\n\n> [!ai] AI · /examine · {ts}\n"
    for line in ai_text.splitlines():
        callout += f"> {line}\n"

    post.content = (post.content or "") + callout
    path.write_text(frontmatter.dumps(post))

    return {"ok": True, "response": ai_text}


# ── Graph ─────────────────────────────────────────────────────────────────────

def _graph_node_for(md: Path) -> Optional[dict]:
    """Identify a graph node. Book sections live under 15-Books/{slug}/."""
    try:
        rel = md.relative_to(VAULT)
    except ValueError:
        return None
    if not rel.parts:
        return None
    top = rel.parts[0]
    if top == "15-Books":
        if md.name.startswith("_"):
            return None
        slug = rel.parts[1] if len(rel.parts) > 2 else ""
        node_id = f"{slug}/{md.stem}" if slug else md.stem
        return {"id": node_id, "label": md.stem, "folder": "15-Books", "path": str(rel)}
    return {"id": md.stem, "label": md.stem, "folder": top, "path": str(rel)}


@app.get("/api/graph")
async def graph():
    """Nodes from vault .md + edges from [[wikilinks]] and LanceDB graph_edges."""
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    wikilink_re = re.compile(r"\[\[([^\]|#]+)(?:[|\#][^\]]*)?\]\]")

    all_md = list(VAULT.rglob("*.md"))
    for md in all_md:
        node = _graph_node_for(md)
        if node:
            nodes[node["id"]] = node

    for md in all_md:
        node = _graph_node_for(md)
        if not node:
            continue
        src = node["id"]
        text = md.read_text(errors="replace")
        for m in wikilink_re.finditer(text):
            target = m.group(1).strip()
            if target and target != src:
                if target not in nodes:
                    nodes[target] = {"id": target, "label": target, "folder": "external", "path": ""}
                key = (src, target, "manual_link")
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    edges.append(
                        {
                            "source": src,
                            "target": target,
                            "type": "manual_link",
                            "reason_text": f"manual [[wikilink]] → {target}",
                            "confidence_score": 1.0,
                        }
                    )

    # Persisted typed edges (manual + auto) from LanceDB
    try:
        et = get_edges_table(LANCEDB_PATH)
        rows = et.to_pandas().to_dict(orient="records") if et is not None else []
    except Exception:
        rows = []
    for row in rows:
        src = str(row.get("source_note") or "")
        tgt = str(row.get("target_note") or "")
        etype = str(row.get("type") or "manual_link")
        if not src or not tgt:
            continue
        for nid in (src, tgt):
            if nid not in nodes:
                nodes[nid] = {"id": nid, "label": nid, "folder": "external", "path": ""}
        key = (src, tgt, etype)
        rev = (tgt, src, etype)
        if key in seen_pairs or rev in seen_pairs:
            continue
        seen_pairs.add(key)
        edges.append(
            {
                "source": src,
                "target": tgt,
                "type": etype,
                "reason_text": str(row.get("reason_text") or ""),
                "confidence_score": float(row.get("confidence_score") or 0),
            }
        )

    return {"nodes": list(nodes.values()), "edges": edges}


class GraphNeighborsPayload(BaseModel):
    note: str
    limit: int = 20


@app.post("/api/graph/neighbors")
async def graph_neighbors(payload: GraphNeighborsPayload):
    """Ranked neighbors with reason_text — for Graph local view + Loki."""
    note = (payload.note or "").strip()
    if not note:
        return {"neighbors": [], "note": note}
    try:
        et = get_edges_table(LANCEDB_PATH)
        rows = et.to_pandas().to_dict(orient="records")
    except Exception:
        rows = []
    # Also include live wikilink scan for the note if edges table is empty
    if not rows:
        path = paper_path(note)
        if path.exists():
            post = frontmatter.load(str(path))
            wiki = manual_edges_from_wikilinks(note, post.content or "")
            rows = [
                {
                    "source_note": e["source_note"],
                    "target_note": e["target_note"],
                    "type": e["type"],
                    "reason_text": e["reason_text"],
                    "confidence_score": e["confidence_score"],
                }
                for e in wiki
            ]
    neighbors = neighbors_from_rows(rows, note, limit=max(1, min(payload.limit, 100)))
    return {"note": note, "neighbors": neighbors}


@app.post("/api/graph/rebuild")
async def graph_rebuild():
    """Recompute all typed edges from vault features. Best-effort; can be slow."""
    keys = current_analysis_keys()
    features = load_features_from_vault(VAULT, analysis_keys=keys)
    try:
        et = get_edges_table(LANCEDB_PATH)
    except Exception as exc:
        return {"ok": False, "message": f"LanceDB unavailable: {exc}", "count": 0}
    count = 0
    citekeys = list(features.keys())
    for i, ck in enumerate(citekeys):
        feat = features[ck]
        delete_manual_edges_for(et, ck)
        delete_auto_edges_for(et, ck)
        wiki_text = str(feat.get("_wikilink_text") or "")
        count += upsert_edges(et, manual_edges_from_wikilinks(ck, wiki_text))
        # Pairwise with later notes only to avoid double work
        for other_ck in citekeys[i + 1 :]:
            other = features[other_ck]
            sim = 0.8 if (
                set(feat["methods"]) & set(other["methods"])
                or set(feat["entities"]) & set(other["entities"])
                or set(feat["citations"]) & set(other["citations"])
            ) else 0.0
            count += upsert_edges(
                et,
                overlap_edges(feat, other, similarity=sim, threshold=DEFAULT_SIMILARITY_THRESHOLD),
            )
    return {"ok": True, "notes": len(citekeys), "edges_written": count}


# ── Zotero ────────────────────────────────────────────────────────────────────

@app.get("/api/zotero/search")
async def zotero_search(q: str):
    result = search_zotero(q)
    if not result:
        raise HTTPException(status_code=404, detail="Not found in Zotero")
    return result


@app.post("/api/zotero/ensure/{arxiv_id}")
async def zotero_ensure(arxiv_id: str):
    result = ensure_arxiv_in_zotero(arxiv_id)
    if not result:
        raise HTTPException(status_code=404, detail="Could not add to Zotero")
    return result


class AddPaperPayload(BaseModel):
    arxiv_id: str
    title: str
    authors: list[str] = []
    pdf_url: str = ""


@app.post("/api/zotero/add-paper")
async def zotero_add_paper(payload: AddPaperPayload):
    """
    Add a paper (already known to us via the arXiv API — title/authors in hand)
    straight to Zotero. Never crashes the caller: missing credentials or a
    Zotero-side failure both come back as a normal {status: "error"} JSON body.
    """
    if not os.environ.get("ZOTERO_API_KEY"):
        return {"status": "error", "message": "Set ZOTERO_API_KEY in .env"}
    try:
        result = add_paper_to_zotero(payload.arxiv_id, payload.title, payload.authors, payload.pdf_url)
    except Exception as e:
        return {"status": "error", "message": str(e)}
    if not result:
        return {"status": "error", "message": "Set ZOTERO_API_KEY and ZOTERO_USER_ID in .env"}
    return {"status": "ok", "item": result}


# ── arXiv (public API, no key required) ─────────────────────────────────────────

ARXIV_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
}


def _arxiv_id_from_atom_url(atom_id: str) -> str:
    """Extract arXiv id from atom entry id — preserves archive/YYMMNNN for old papers."""
    m = re.search(r"arxiv\.org/abs/(.+)$", atom_id, re.IGNORECASE)
    if m:
        return m.group(1)
    return atom_id.rsplit("/", 1)[-1] if atom_id else ""


def _parse_arxiv_atom(xml_text: str) -> tuple[list[dict], int]:
    root = ET.fromstring(xml_text)

    total = 0
    total_el = root.find("opensearch:totalResults", ARXIV_NS)
    if total_el is not None and total_el.text:
        try:
            total = int(total_el.text)
        except ValueError:
            total = 0

    papers = []
    for entry in root.findall("atom:entry", ARXIV_NS):
        arxiv_url = (entry.findtext("atom:id", default="", namespaces=ARXIV_NS) or "").strip()
        arxiv_id = _arxiv_id_from_atom_url(arxiv_url)
        title = re.sub(r"\s+", " ", (entry.findtext("atom:title", default="", namespaces=ARXIV_NS) or "")).strip()
        abstract = re.sub(r"\s+", " ", (entry.findtext("atom:summary", default="", namespaces=ARXIV_NS) or "")).strip()
        authors = [
            (a.findtext("atom:name", default="", namespaces=ARXIV_NS) or "").strip()
            for a in entry.findall("atom:author", ARXIV_NS)
        ]
        categories = [c.get("term", "") for c in entry.findall("atom:category", ARXIV_NS)]
        submitted = entry.findtext("atom:published", default="", namespaces=ARXIV_NS) or ""
        pdf_url = ""
        for link in entry.findall("atom:link", ARXIV_NS):
            if link.get("title") == "pdf" or link.get("type") == "application/pdf":
                pdf_url = link.get("href", "")
                break
        if not pdf_url and arxiv_id:
            pdf_url = f"https://arxiv.org/pdf/{arxiv_id}"
        papers.append(
            {
                "id": arxiv_id,
                "title": title,
                "authors": authors,
                "abstract": abstract,
                "arxiv_url": arxiv_url,
                "pdf_url": pdf_url,
                "categories": categories,
                "submitted": submitted,
            }
        )
    return papers, total


DC_NS = {"dc": "http://purl.org/dc/elements/1.1/"}
ARXIV_RSS_NS = {"arxiv": "http://arxiv.org/schemas/atom"}


def _clean_arxiv_abstract(raw: str) -> str:
    text = re.sub(r"\s+", " ", raw or "").strip()
    text = re.sub(r"^arXiv:[^\s]+\s+Announce Type:\s*\w+\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^Abstract:\s*", "", text, flags=re.IGNORECASE)
    return text.strip()


def _invert_openalex_abstract(inverted_index: dict | None) -> str:
    if not inverted_index or not isinstance(inverted_index, dict):
        return ""
    try:
        max_idx = max((pos for positions in inverted_index.values() for pos in positions), default=-1)
        if max_idx < 0:
            return ""
        words = [""] * (max_idx + 1)
        for word, positions in inverted_index.items():
            for p in positions:
                if 0 <= p <= max_idx:
                    words[p] = word
        return " ".join(words).strip()
    except Exception:
        return ""


def _openalex_work_to_paper(work: dict) -> dict:
    raw_id = (work.get("id") or "").replace("https://openalex.org/", "")
    doi = (work.get("doi") or "").replace("https://doi.org/", "")

    authors = []
    for authorship in work.get("authorships") or []:
        author_name = (authorship.get("author") or {}).get("display_name")
        if author_name:
            authors.append(author_name)

    abstract = _invert_openalex_abstract(work.get("abstract_inverted_index"))

    categories = []
    for concept in work.get("concepts") or []:
        cname = concept.get("display_name")
        if cname and cname not in categories:
            categories.append(cname)

    best_oa = work.get("best_oa_location") or {}
    primary_loc = work.get("primary_location") or {}
    open_access = work.get("open_access") or {}

    pdf_url = best_oa.get("pdf_url") or primary_loc.get("pdf_url") or open_access.get("oa_url") or ""
    landing_url = work.get("doi") or best_oa.get("landing_page_url") or primary_loc.get("landing_page_url") or work.get("id") or ""

    paper_id = doi if doi else raw_id
    submitted = work.get("publication_date") or str(work.get("publication_year") or "")

    return {
        "id": paper_id,
        "title": re.sub(r"\s+", " ", work.get("title") or "").strip(),
        "authors": authors,
        "abstract": abstract,
        "arxiv_url": landing_url,
        "pdf_url": pdf_url,
        "categories": categories[:6],
        "submitted": submitted,
        "source": "openalex",
        "doi": doi,
    }


async def _fetch_openalex_daily(topic_query: str, max_results: int = 50, target_date: Optional[str] = None) -> list[dict]:
    headers = {"User-Agent": "Yggdrasil/1.0 (mailto:academic-reader@yggdrasil.local)"}
    filters = ["open_access.is_oa:true"]
    if target_date:
        filters.append(f"from_publication_date:{target_date}")
        filters.append(f"to_publication_date:{target_date}")
    params = {
        "search": topic_query,
        "filter": ",".join(filters),
        "sort": "publication_date:desc",
        "per_page": min(max_results, 100),
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as client:
        try:
            resp = await client.get("https://api.openalex.org/works", params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results") or []
                return [_openalex_work_to_paper(w) for w in results if w.get("title")]
        except Exception as e:
            logger.warning(f"OpenAlex daily fetch error: {e}")
    return []


async def _fetch_openalex_search(query: str, field: str = "all", start: int = 0, max_results: int = 50) -> tuple[list[dict], int]:
    headers = {"User-Agent": "Yggdrasil/1.0 (mailto:academic-reader@yggdrasil.local)"}
    page = (start // max_results) + 1 if max_results > 0 else 1
    per_page = min(max_results, 100)

    q = query.strip()
    params: dict[str, Any] = {
        "per_page": per_page,
        "page": page,
        "sort": "relevance_score:desc",
    }
    if field == "author":
        params["filter"] = f"raw_author_name.search:{q}"
    elif field == "title":
        params["filter"] = f"title.search:{q}"
    elif field == "id" or "/" in q or q.startswith("10."):
        doi_clean = q.replace("https://doi.org/", "").replace("http://doi.org/", "")
        params["filter"] = f"doi:{doi_clean}"
    else:
        params["search"] = q

    async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as client:
        try:
            resp = await client.get("https://api.openalex.org/works", params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                meta = data.get("meta") or {}
                total = meta.get("count", 0)
                results = data.get("results") or []
                papers = [_openalex_work_to_paper(w) for w in results if w.get("title")]
                return papers, total
        except Exception as e:
            logger.warning(f"OpenAlex search error: {e}")
    return [], 0


async def _fetch_europepmc_search(query: str, start: int = 0, max_results: int = 50) -> tuple[list[dict], int]:
    page = (start // max_results) + 1 if max_results > 0 else 1
    params = {
        "query": f"{query} (OPEN_ACCESS:Y)",
        "format": "json",
        "pageSize": min(max_results, 100),
        "page": page,
        "sort": "P_PD_D desc",
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as client:
        try:
            resp = await client.get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", params=params)
            if resp.status_code == 200:
                data = resp.json()
                total = data.get("hitCount", 0)
                result_list = data.get("resultList", {}).get("result", [])
                papers = []
                for item in result_list:
                    doi = item.get("doi", "")
                    title = item.get("title", "").rstrip(".")
                    abstract = item.get("abstractText", "")
                    author_str = item.get("authorString", "")
                    authors = [a.strip() for a in author_str.split(",") if a.strip()]
                    pmcid = item.get("pmcid", "")
                    pdf_url = f"https://europepmc.org/backend/ptpmcrender.fcgi?accid={pmcid}&blobtype=pdf" if pmcid else ""
                    landing_url = f"https://europepmc.org/article/MED/{item.get('id')}" if item.get("id") else (f"https://doi.org/{doi}" if doi else "")
                    papers.append({
                        "id": doi or item.get("id") or item.get("pmcid") or "",
                        "title": re.sub(r"\s+", " ", title).strip(),
                        "authors": authors,
                        "abstract": re.sub(r"\s+", " ", abstract).strip(),
                        "arxiv_url": landing_url,
                        "pdf_url": pdf_url,
                        "categories": ["Europe PMC", "Open Access"],
                        "submitted": str(item.get("pubYear", "")),
                        "source": "europepmc",
                        "doi": doi,
                    })
                return papers, total
        except Exception as e:
            logger.warning(f"Europe PMC search error: {e}")
    return [], 0


def _paper_from_ids(arxiv_id: str, title: str, authors: list[str], abstract: str, categories: list[str], submitted: str) -> dict:
    aid = (arxiv_id or "").split("v")[0] if arxiv_id else ""
    # keep version in id if present — frontend uses paper.id as citekey
    full_id = arxiv_id or aid
    return {
        "id": full_id,
        "title": re.sub(r"\s+", " ", title or "").strip(),
        "authors": [a for a in authors if a],
        "abstract": _clean_arxiv_abstract(abstract),
        "arxiv_url": f"https://arxiv.org/abs/{full_id}" if full_id else "",
        "pdf_url": f"https://arxiv.org/pdf/{full_id}" if full_id else "",
        "categories": categories,
        "submitted": submitted or "",
        "source": "arxiv",
        "doi": "",
    }


def _parse_arxiv_rss(xml_text: str) -> list[dict]:
    """Parse arXiv RSS 2.0 or Atom listing feeds (not the query API)."""
    root = ET.fromstring(xml_text)
    papers: list[dict] = []
    tag = root.tag.lower()
    if tag.endswith("rss") or root.find("channel") is not None:
        channel = root.find("channel")
        items = channel.findall("item") if channel is not None else []
        for item in items:
            link = (item.findtext("link") or "").strip()
            guid = (item.findtext("guid") or "").strip()
            arxiv_id = _arxiv_id_from_atom_url(link) or _arxiv_id_from_atom_url(guid)
            if not arxiv_id and guid.startswith("oai:arXiv.org:"):
                arxiv_id = guid.split(":", 2)[-1]
            creator = item.findtext("dc:creator", default="", namespaces=DC_NS) or ""
            authors = [a.strip() for a in creator.split(",") if a.strip()]
            cat_el = item.find("category")
            categories = [cat_el.text.strip()] if cat_el is not None and cat_el.text else []
            papers.append(
                _paper_from_ids(
                    arxiv_id,
                    item.findtext("title") or "",
                    authors,
                    item.findtext("description") or "",
                    categories,
                    item.findtext("pubDate") or "",
                )
            )
        return papers

    # Atom feed (rss.arxiv.org/atom/...)
    for entry in root.findall("{http://www.w3.org/2005/Atom}entry"):
        link_el = entry.find("{http://www.w3.org/2005/Atom}link")
        href = link_el.get("href", "") if link_el is not None else ""
        eid = (entry.findtext("{http://www.w3.org/2005/Atom}id") or "").strip()
        arxiv_id = _arxiv_id_from_atom_url(href)
        if not arxiv_id and "arXiv.org:" in eid:
            arxiv_id = eid.split("arXiv.org:")[-1]
        authors = []
        creator = entry.findtext("{http://purl.org/dc/elements/1.1/}creator") or ""
        if creator:
            authors = [a.strip() for a in creator.split(",") if a.strip()]
        cat_el = entry.find("{http://www.w3.org/2005/Atom}category")
        categories = [cat_el.get("term", "")] if cat_el is not None else []
        papers.append(
            _paper_from_ids(
                arxiv_id,
                entry.findtext("{http://www.w3.org/2005/Atom}title") or "",
                authors,
                entry.findtext("{http://www.w3.org/2005/Atom}summary") or "",
                [c for c in categories if c],
                entry.findtext("{http://www.w3.org/2005/Atom}updated") or "",
            )
        )
    return papers


ALL_FIELD_FEEDS = (
    "physics",
    "math",
    "cs",
    "astro-ph",
    "cond-mat",
    "q-bio",
    "q-fin",
    "stat",
    "eess",
    "econ",
    "hep-th",
    "hep-ph",
    "quant-ph",
    "gr-qc",
)


async def _fetch_arxiv_rss(cat: str) -> list[dict]:
    """Today's listings via rss.arxiv.org — not rate-limited like the query API."""
    urls = [
        f"https://rss.arxiv.org/rss/{cat}",
        f"https://rss.arxiv.org/atom/{cat}",
    ]
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for url in urls:
            try:
                resp = await client.get(url, timeout=25.0)
                if resp.status_code >= 400:
                    continue
                body = resp.text.lstrip("\ufeff").strip()
                if "<item>" not in body and "<entry>" not in body:
                    continue
                papers = _parse_arxiv_rss(body)
                if papers:
                    return papers
            except httpx.HTTPError:
                continue
    return []


ALL_FIELD_ARXIV_CATS = (
    "physics.*", "math.*", "cs.*", "astro-ph.*", "cond-mat.*", "q-bio.*",
    "q-fin.*", "stat.*", "eess.*", "econ.*", "hep-th", "hep-ph", "quant-ph", "gr-qc",
)


def _arxiv_date_range(target_date: str) -> str:
    """arXiv submittedDate range for one calendar day, e.g. [20260917000000 TO 20260917235959]."""
    d = target_date.replace("-", "")
    return f"[{d}000000 TO {d}235959]"


async def _fetch_daily_papers(category: str, max_results: int, target_date: Optional[str] = None) -> list[dict]:
    if is_openalex_topic(category):
        topic_query = get_topic_search_query(category)
        papers = await _fetch_openalex_daily(topic_query, max_results, target_date)
        if papers:
            return papers

    if target_date:
        # A specific date is authoritative only via the search API — the RSS feed only
        # ever reflects arXiv's latest "recent" announcement batch, not an arbitrary day.
        if category == "all":
            cat_query = "(" + " OR ".join(f"cat:{c}" for c in ALL_FIELD_ARXIV_CATS) + ")"
        else:
            cat_query = search_query_for(category)
        papers, _total = await _fetch_arxiv(
            {
                "search_query": f"{cat_query} AND submittedDate:{_arxiv_date_range(target_date)}",
                "sortBy": "submittedDate",
                "sortOrder": "descending",
                "max_results": max_results,
            }
        )
        return papers

    if category == "all":
        chunks = await asyncio.gather(*[_fetch_arxiv_rss(c) for c in ALL_FIELD_FEEDS], return_exceptions=True)
        merged: list[dict] = []
        seen: set[str] = set()
        for chunk in chunks:
            if isinstance(chunk, Exception) or not chunk:
                continue
            for p in chunk:
                pid = p.get("id") or ""
                if not pid or pid in seen:
                    continue
                seen.add(pid)
                merged.append(p)
        return merged[:max_results]

    papers = await _fetch_arxiv_rss(category)
    if papers:
        return papers[:max_results]
    # Fallback: query API (can 429)
    papers, _total = await _fetch_arxiv(
        {
            "search_query": search_query_for(category),
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "max_results": max_results,
        }
    )
    return papers


async def _fetch_arxiv(params: dict) -> tuple[list[dict], int]:
    """
    arXiv's public API is often slow and 429s if hit more than ~1x/3s.
    Retry with backoff; distinguish timeout vs rate-limit vs other errors.
    """
    last_exc: Exception | None = None
    last_kind = "network"
    # Bounded to ~35s worst case (2 attempts × 15s timeout + backoff) — this is an
    # interactive request from the UI, so a fast, clear failure beats a long hang.
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for attempt in range(2):
            try:
                resp = await client.get(
                    "https://export.arxiv.org/api/query",
                    params=params,
                    timeout=15.0,
                )
                if resp.status_code == 429:
                    last_kind = "rate_limit"
                    last_exc = httpx.HTTPStatusError("429", request=resp.request, response=resp)
                    await asyncio.sleep(3.0 * (attempt + 1))
                    continue
                resp.raise_for_status()
                return _parse_arxiv_atom(resp.text)
            except httpx.TimeoutException as e:
                last_kind = "timeout"
                last_exc = e
                await asyncio.sleep(1.0)
            except httpx.HTTPStatusError as e:
                last_kind = "rate_limit" if getattr(e.response, "status_code", None) == 429 else "http"
                last_exc = e
                if getattr(e.response, "status_code", None) == 429:
                    await asyncio.sleep(3.0 * (attempt + 1))
                    continue
                break
            except httpx.HTTPError as e:
                last_kind = "network"
                last_exc = e
                await asyncio.sleep(2.0)
    if last_kind == "rate_limit":
        msg = "arXiv is rate-limiting requests right now — wait ~30s and try Update from web again."
    elif last_kind == "timeout":
        msg = "arXiv took too long to respond. Try Update from web again in a moment."
    else:
        msg = "Could not reach arXiv. Check your internet connection and try again."
    raise HTTPException(status_code=503, detail=msg) from last_exc


_DAILY_CACHE: dict[str, tuple[float, list[dict]]] = {}
_DAILY_CACHE_TTL = 180.0


@app.get("/api/arxiv/topics")
async def arxiv_topics():
    return {"topics": ARXIV_TOPICS}


@app.get("/api/arxiv/daily")
async def arxiv_daily(max: int = 200, cat: str = "astro-ph.HE", refresh: bool = False, date: Optional[str] = None):
    """
    Papers for an academic discipline or arXiv category, for a given calendar day.
    `date` (YYYY-MM-DD) defaults to today; `refresh=true` bypasses the short in-memory cache.
    """
    max_results = min(max, 200)
    category = normalize_category(cat)
    if not is_valid_category(category):
        raise HTTPException(status_code=400, detail=f"Invalid topic/category: {cat}")
    parsed_date = _parse_iso_date(date) if date else None
    # "Today" keeps using the fast RSS/sorted-feed path (same as before date support was
    # added) — the slow, rate-limit-prone arXiv search API is only worth paying for when
    # the user deliberately picks a genuinely past date.
    target_date = parsed_date if parsed_date and parsed_date != datetime.now().strftime("%Y-%m-%d") else None
    cache_key = f"{category}:{max_results}:{target_date or 'latest'}"
    cached = _DAILY_CACHE.get(cache_key)
    if not refresh and cached and (time.time() - cached[0]) < _DAILY_CACHE_TTL:
        return {"papers": cached[1], "cat": category, "date": target_date, "cached": True, "warning": None}
    try:
        papers = await _fetch_daily_papers(category, max_results, target_date)
    except HTTPException as exc:
        if cached:
            return {
                "papers": cached[1],
                "cat": category,
                "date": target_date,
                "cached": True,
                "warning": str(exc.detail),
            }
        raise
    _DAILY_CACHE[cache_key] = (time.time(), papers)
    return {"papers": papers, "cat": category, "date": target_date, "cached": False, "warning": None}


# New-style (Apr 2007+): 0704.0001 / 1501.00001 / 2401.12345v2
# Old-style (1991–Mar 2007): hep-th/9901001, math.GT/0309136, physics/0306138v1
ARXIV_ID_RE = re.compile(
    r"(?:"
    r"[a-z-]+(?:\.[a-z]{2})?/\d{7}"   # old: archive[/] or archive.CC/
    r"|"
    r"\d{4}\.\d{4,5}"                 # new: YYMM.NNNNN
    r")"
    r"(?:v\d+)?",
    re.IGNORECASE,
)

ARXIV_FIELD_PREFIX = {"author": "au", "title": "ti", "all": "all"}


@app.get("/api/arxiv/search")
async def arxiv_search(
    q: str,
    field: str = "all",
    source: str = "all",
    start: int = 0,
    max_results: int = 50,
):
    """
    Universal academic search across OpenAlex, arXiv, and Europe PMC.
    """
    q = q.strip()
    m = ARXIV_ID_RE.search(q)
    max_results = max(1, min(max_results, 200))

    if field == "id" or (m and (ARXIV_ID_RE.fullmatch(q) or "arxiv.org" in q)):
        if m:
            papers, total = await _fetch_arxiv({"id_list": m.group(0), "max_results": 1})
            return {"papers": papers, "total": total, "start": 0}

    # Explicit single source
    if source == "openalex":
        papers, total = await _fetch_openalex_search(q, field, start, max_results)
        return {"papers": papers, "total": total, "start": start}
    if source == "europepmc":
        papers, total = await _fetch_europepmc_search(q, start, max_results)
        return {"papers": papers, "total": total, "start": start}
    if source == "arxiv":
        prefix = ARXIV_FIELD_PREFIX.get(field, "all")
        search_query = f'{prefix}:"{q}"' if prefix != "all" else f"all:{q}"
        papers, total = await _fetch_arxiv(
            {
                "search_query": search_query,
                "sortBy": "relevance" if prefix == "all" else "submittedDate",
                "sortOrder": "descending",
                "start": max(0, start),
                "max_results": max_results,
            }
        )
        return {"papers": papers, "total": total, "start": start}

    # "all" source: query OpenAlex (covers international, humanities, social sciences, Chinese papers, medicine, crossref DOIs) and arXiv
    openalex_coro = _fetch_openalex_search(q, field, start, max_results)
    prefix = ARXIV_FIELD_PREFIX.get(field, "all")
    search_query = f'{prefix}:"{q}"' if prefix != "all" else f"all:{q}"
    arxiv_coro = _fetch_arxiv(
        {
            "search_query": search_query,
            "sortBy": "relevance" if prefix == "all" else "submittedDate",
            "sortOrder": "descending",
            "start": max(0, start),
            "max_results": min(max_results, 25),
        }
    )

    results = await asyncio.gather(openalex_coro, arxiv_coro, return_exceptions=True)

    oa_papers, oa_total = ([], 0)
    ar_papers, ar_total = ([], 0)

    if not isinstance(results[0], Exception) and results[0]:
        oa_papers, oa_total = results[0]
    if not isinstance(results[1], Exception) and results[1]:
        ar_papers, ar_total = results[1]

    # Combine and deduplicate
    combined: list[dict] = []
    seen_titles: set[str] = set()

    for p in oa_papers + ar_papers:
        title_key = re.sub(r"[^a-z0-9]", "", (p.get("title") or "").lower())
        if title_key and title_key in seen_titles:
            continue
        if title_key:
            seen_titles.add(title_key)
        combined.append(p)

    return {
        "papers": combined[:max_results],
        "total": max(oa_total + ar_total, len(combined)),
        "start": start,
    }


# ── LaTeX (thin proxy to the internal `latex` container) ───────────────────────
# The latex service is not published to the host — only `expose`d on the docker
# network — so the assistant is the only thing that can reach it. This keeps a
# single published port (8000) for Tailscale access, same as every other view.

class LatexCompileRequest(BaseModel):
    source: str
    filename: str = "draft"


class LatexSaveRequest(BaseModel):
    filename: str
    source: str


async def _proxy_latex(method: str, path: str, *, json: Optional[dict] = None, timeout: float = 15.0):
    status, payload = await _latex_json(method, path, json=json, timeout=timeout)
    return JSONResponse(status_code=status, content=payload)


async def _latex_json(method: str, path: str, json: Optional[dict] = None, timeout: float = 15.0) -> tuple[int, dict]:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.request(method, f"{LATEX_URL}{path}", json=json, timeout=timeout)
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="LaTeX service unavailable")

    try:
        payload = resp.json()
    except Exception:
        payload = {"detail": resp.text or f"Unexpected LaTeX service response ({resp.status_code})"}
    if not isinstance(payload, dict):
        payload = {"detail": payload}
    return resp.status_code, payload


@app.post("/api/latex/compile")
async def latex_compile(payload: LatexCompileRequest):
    return await _proxy_latex("POST", "/compile", json=payload.model_dump(), timeout=130.0)


@app.post("/api/latex/save")
async def latex_save(payload: LatexSaveRequest):
    return await _proxy_latex("POST", "/save", json=payload.model_dump())


@app.get("/api/latex/files")
async def latex_list_files():
    return await _proxy_latex("GET", "/files")


@app.post("/api/latex/folders")
async def latex_create_folder(payload: dict):
    return await _proxy_latex("POST", "/folders", json=payload)


@app.delete("/api/latex/folders/{folder_path:path}")
async def latex_delete_folder(folder_path: str):
    return await _proxy_latex("DELETE", f"/folders/{folder_path}")


@app.get("/api/latex/files/{filename:path}")
async def latex_get_file(filename: str):
    return await _proxy_latex("GET", f"/files/{filename}")


@app.delete("/api/latex/files/{filename:path}")
async def latex_delete_file(filename: str):
    return await _proxy_latex("DELETE", f"/files/{filename}")


@app.post("/api/latex/assets")
async def latex_upload_asset(payload: dict):
    return await _proxy_latex("POST", "/assets", json=payload)


@app.delete("/api/latex/assets/{asset_path:path}")
async def latex_delete_asset(asset_path: str):
    return await _proxy_latex("DELETE", f"/assets/{asset_path}")


@app.get("/api/latex/zip/{rel:path}")
async def latex_zip(rel: str):
    return await _proxy_latex("GET", f"/zip/{rel}", timeout=60.0)


@app.post("/api/latex/rename")
async def latex_rename(payload: dict):
    return await _proxy_latex("POST", "/rename", json=payload)


# ── Notes workspace (user-authored Markdown pages) ──────────────────────────

NOTES_WORKSPACE = "60-Meta/Notes"
NOTES_NAME_RE = re.compile(r"^[A-Za-z0-9._ -]+$")


def notes_rel_path(value: str, *, extension: bool = False) -> str:
    name = (value or "").strip().strip("/")
    if not name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid Notes path")
    parts = name.split("/")
    if any(part in ("", ".", "..") or not NOTES_NAME_RE.fullmatch(part) for part in parts):
        raise HTTPException(status_code=400, detail="Invalid Notes path")
    if extension and not name.lower().endswith(".md"):
        name += ".md"
    return name


def notes_root() -> Path:
    root = VAULT / NOTES_WORKSPACE
    root.mkdir(parents=True, exist_ok=True)
    return root


def notes_path(value: str, *, extension: bool = False) -> Path:
    rel = notes_rel_path(value, extension=extension)
    path = (notes_root() / rel).resolve()
    if notes_root().resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="Invalid Notes path")
    return path


@app.get("/api/notes/files")
async def notes_list_files():
    root = notes_root()
    folders = [
        str(p.relative_to(root)).replace("\\", "/")
        for p in sorted(root.rglob("*"))
        if p.is_dir() and not any(part.startswith(".") for part in p.relative_to(root).parts)
    ]
    files = []
    for path in sorted(root.rglob("*.md")):
        if any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        stat = path.stat()
        files.append({
            "name": str(path.relative_to(root)).replace("\\", "/"),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "size": stat.st_size,
        })
    return {"root": NOTES_WORKSPACE, "folders": folders, "files": files}


class NotesFilePayload(BaseModel):
    filename: str
    source: str = ""


@app.get("/api/notes/files/{filename:path}")
async def notes_get_file(filename: str):
    path = notes_path(filename, extension=True)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Note not found")
    return {"name": str(path.relative_to(notes_root())).replace("\\", "/"), "source": path.read_text()}


@app.post("/api/notes/files")
async def notes_save_file(payload: NotesFilePayload):
    path = notes_path(payload.filename, extension=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    source = payload.source
    if not source.lstrip().startswith("---"):
        source = frontmatter.dumps(frontmatter.Post(source))
    else:
        source = frontmatter.dumps(frontmatter.loads(source))
    path.write_text(source)
    return {"ok": True, "name": str(path.relative_to(notes_root())).replace("\\", "/")}


@app.post("/api/notes/folders")
async def notes_create_folder(payload: dict):
    path = notes_path(str(payload.get("path", "")))
    path.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": str(path.relative_to(notes_root())).replace("\\", "/")}


@app.delete("/api/notes/folders/{folder_path:path}")
async def notes_delete_folder(folder_path: str):
    path = notes_path(folder_path)
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")
    shutil.rmtree(path)
    return {"ok": True}


@app.delete("/api/notes/files/{filename:path}")
async def notes_delete_file(filename: str):
    path = notes_path(filename, extension=True)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Note not found")
    path.unlink()
    return {"ok": True}


class NotesRenamePayload(BaseModel):
    src: str
    dest: str


@app.post("/api/notes/rename")
async def notes_rename(payload: NotesRenamePayload):
    src = notes_path(payload.src)
    dest = notes_path(payload.dest)
    if not src.exists():
        raise HTTPException(status_code=404, detail="Source not found")
    if dest.exists():
        raise HTTPException(status_code=409, detail="Destination already exists")
    dest.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dest)
    return {"ok": True}


NOTES_ASSET_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".csv", ".txt"}


class NotesAssetPayload(BaseModel):
    path: str
    content_b64: str


@app.post("/api/notes/assets")
async def notes_upload_asset(payload: NotesAssetPayload):
    path = notes_path(payload.path)
    if path.suffix.lower() not in NOTES_ASSET_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported Notes asset type")
    try:
        import base64
        content = base64.b64decode(payload.content_b64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid asset data: {exc}") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"ok": True, "path": str(path.relative_to(notes_root())).replace("\\", "/")}


@app.get("/api/notes/assets/{asset_path:path}")
async def notes_get_asset(asset_path: str):
    path = notes_path(asset_path)
    if not path.exists() or not path.is_file() or path.suffix.lower() not in NOTES_ASSET_EXTS:
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(path)


# ── Habits (60-Meta/Daily-YYYY-MM-DD.md) ───────────────────────────────────────

DEFAULT_HABIT_KEYS = {
    "rise": False,
    "arxiv": False,
    "reading": False,
    "research": False,
    "extra_read": False,
    "exercise": False,
    "mental": False,
}


def _parse_iso_date(s: str) -> str:
    try:
        return date.fromisoformat(s).strftime("%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {s}")


def habit_path(day: str) -> Path:
    return VAULT / "60-Meta" / f"Daily-{day}.md"


def _load_habits(day: str) -> dict:
    path = habit_path(day)
    if not path.exists():
        return {"date": day, "habits": {}}
    post = frontmatter.load(str(path))
    habits = post.metadata.get("habits")
    if not isinstance(habits, dict):
        habits = {}
    return {"date": post.metadata.get("date") or day, "habits": habits}


def _write_habits(day: str, habits: dict) -> dict:
    path = habit_path(day)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        post = frontmatter.load(str(path))
    else:
        post = frontmatter.Post("")
        post.metadata["date"] = day
        # Seed defaults only on first create; later writes keep whatever keys the client sends.
        post.metadata["habits"] = dict(DEFAULT_HABIT_KEYS)
    # Merge: client may send a partial dict; preserve unknown keys unless overwritten.
    existing = post.metadata.get("habits") if isinstance(post.metadata.get("habits"), dict) else {}
    merged = {**existing, **habits}
    post.metadata["date"] = day
    post.metadata["habits"] = merged
    path.write_text(frontmatter.dumps(post))
    return {"date": day, "habits": merged}


@app.get("/api/habits/range")
async def habits_range(start: str, end: str):
    start_d = date.fromisoformat(_parse_iso_date(start))
    end_d = date.fromisoformat(_parse_iso_date(end))
    if end_d < start_d:
        raise HTTPException(status_code=400, detail="end must be >= start")
    if (end_d - start_d).days > 400:
        raise HTTPException(status_code=400, detail="range too large (max 400 days)")
    days = []
    cur = start_d
    while cur <= end_d:
        days.append(_load_habits(cur.strftime("%Y-%m-%d")))
        cur += timedelta(days=1)
    return {"days": days}


@app.get("/api/habits/{day}")
async def get_habits(day: str):
    day = _parse_iso_date(day)
    return _load_habits(day)


class HabitsPayload(BaseModel):
    habits: dict[str, Any]


@app.post("/api/habits/{day}")
async def post_habits(day: str, payload: HabitsPayload):
    day = _parse_iso_date(day)
    return {"ok": True, **_write_habits(day, payload.habits)}


# ── Tasks: project → main task → subtask (80-Tasks/{project-slug}/*.md) ───────

PINNED_PROJECT_SLUG = "_daily-habits"


def tasks_dir() -> Path:
    d = VAULT / "80-Tasks"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _slugify_project_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "project"


def project_dir(slug: str) -> Path:
    if not slug or "/" in slug or "\\" in slug or slug in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid project")
    return tasks_dir() / slug


def _ensure_pinned_project() -> None:
    d = project_dir(PINNED_PROJECT_SLUG)
    meta = d / "_project.md"
    if meta.exists():
        return
    d.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post("")
    post.metadata.update({"type": "project", "name": "Daily Habits", "created_at": _now_iso()})
    meta.write_text(frontmatter.dumps(post))


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _project_from_dir(d: Path) -> Optional[dict]:
    meta = d / "_project.md"
    if not meta.exists():
        return None
    post = frontmatter.load(str(meta))
    main_tasks = list(d.glob("mt-*.md"))
    return {
        "slug": d.name,
        "name": post.metadata.get("name") or d.name,
        "pinned": d.name == PINNED_PROJECT_SLUG,
        "created_at": post.metadata.get("created_at") or "",
        "main_task_count": len(main_tasks),
    }


def _status_id_of(fm: dict) -> str:
    """Read `status_id`, falling back to the pre-customization `status` key
    (same literal ids as the seeded defaults, so old notes need no migration)."""
    return str(fm.get("status_id") or fm.get("status") or "")


def _normalize_status_id(value: object, statuses: Optional[list[dict]] = None) -> str:
    statuses = statuses if statuses is not None else current_task_statuses()
    valid_ids = {s["id"] for s in statuses}
    v = str(value or "")
    if v in valid_ids:
        return v
    return statuses[0]["id"] if statuses else "todo"


def _subtask_counts(d: Path, main_task_id: str) -> tuple[int, int]:
    total = 0
    done = 0
    for p in d.glob(f"st-*.md"):
        post = frontmatter.load(str(p))
        if post.metadata.get("main_task_id") != main_task_id:
            continue
        total += 1
        if _status_id_of(post.metadata) == "done":
            done += 1
    return done, total


def _main_task_from_post(d: Path, task_id: str, post) -> dict:
    fm = post.metadata
    done, total = _subtask_counts(d, task_id)
    return {
        "id": task_id,
        "project_slug": d.name,
        "name": fm.get("name") or task_id,
        "deadline": fm.get("deadline") or None,
        "is_active": bool(fm.get("is_active")),
        "status_id": _normalize_status_id(_status_id_of(fm)),
        "created_at": fm.get("created_at") or "",
        "subtask_done": done,
        "subtask_total": total,
    }


def _subtask_from_post(d: Path, subtask_id: str, post) -> dict:
    fm = post.metadata
    status_id = _normalize_status_id(_status_id_of(fm))
    return {
        "id": subtask_id,
        "main_task_id": fm.get("main_task_id"),
        "project_slug": d.name,
        "name": fm.get("name") or subtask_id,
        "deadline": fm.get("deadline") or None,
        "status_id": status_id,
        "done": status_id == "done",
        "completed_at": fm.get("completed_at") or None,
        "created_at": fm.get("created_at") or "",
    }


def _main_task_path(slug: str, task_id: str) -> Path:
    if not task_id or not re.fullmatch(r"mt-[a-f0-9]{12}", task_id):
        raise HTTPException(status_code=400, detail="Invalid main task id")
    return project_dir(slug) / f"{task_id}.md"


def _subtask_path(slug: str, subtask_id: str) -> Path:
    if not subtask_id or not re.fullmatch(r"st-[a-f0-9]{12}", subtask_id):
        raise HTTPException(status_code=400, detail="Invalid subtask id")
    return project_dir(slug) / f"{subtask_id}.md"


@app.get("/api/task-projects")
async def list_task_projects():
    _ensure_pinned_project()
    root = tasks_dir()
    out = []
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        project = _project_from_dir(d)
        if project:
            out.append(project)
    out.sort(key=lambda p: (not p["pinned"], p["name"].lower()))
    return {"projects": out}


class ProjectCreate(BaseModel):
    name: str


@app.post("/api/task-projects")
async def create_task_project(payload: ProjectCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    slug = _slugify_project_name(name)
    d = project_dir(slug)
    if (d / "_project.md").exists():
        raise HTTPException(status_code=409, detail="A project with this name already exists")
    d.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post("")
    post.metadata.update({"type": "project", "name": name, "created_at": _now_iso()})
    (d / "_project.md").write_text(frontmatter.dumps(post))
    return {"ok": True, "project": _project_from_dir(d)}


@app.delete("/api/task-projects/{slug}")
async def delete_task_project(slug: str):
    if slug == PINNED_PROJECT_SLUG:
        raise HTTPException(status_code=400, detail="Daily Habits can't be deleted")
    d = project_dir(slug)
    if not (d / "_project.md").exists():
        raise HTTPException(status_code=404, detail="Project not found")
    shutil.rmtree(d)
    return {"ok": True, "slug": slug}


@app.get("/api/task-projects/{slug}/main-tasks")
async def list_main_tasks(slug: str):
    d = project_dir(slug)
    if not (d / "_project.md").exists():
        raise HTTPException(status_code=404, detail="Project not found")
    out = []
    for p in sorted(d.glob("mt-*.md")):
        post = frontmatter.load(str(p))
        out.append(_main_task_from_post(d, p.stem, post))
    return {"main_tasks": out}


class MainTaskCreate(BaseModel):
    name: str
    deadline: Optional[str] = None
    status_id: Optional[str] = None


@app.post("/api/task-projects/{slug}/main-tasks")
async def create_main_task(slug: str, payload: MainTaskCreate):
    d = project_dir(slug)
    if not (d / "_project.md").exists():
        raise HTTPException(status_code=404, detail="Project not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    task_id = "mt-" + uuid.uuid4().hex[:12]
    post = frontmatter.Post("")
    post.metadata.update(
        {
            "type": "main_task",
            "name": name,
            "deadline": payload.deadline or None,
            "is_active": False,
            "status_id": _normalize_status_id(payload.status_id),
            "created_at": _now_iso(),
        }
    )
    (d / f"{task_id}.md").write_text(frontmatter.dumps(post))
    return {"ok": True, "main_task": _main_task_from_post(d, task_id, post)}


class MainTaskUpdate(BaseModel):
    name: Optional[str] = None
    deadline: Optional[str] = None
    is_active: Optional[bool] = None
    status_id: Optional[str] = None


@app.put("/api/task-projects/{slug}/main-tasks/{task_id}")
async def update_main_task(slug: str, task_id: str, payload: MainTaskUpdate):
    path = _main_task_path(slug, task_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Main task not found")
    post = frontmatter.load(str(path))
    data = payload.model_dump(exclude_unset=True)
    if "status_id" in data:
        data["status_id"] = _normalize_status_id(data["status_id"])
    for k, v in data.items():
        post.metadata[k] = v
    path.write_text(frontmatter.dumps(post))
    return {"ok": True, "main_task": _main_task_from_post(project_dir(slug), task_id, post)}


@app.delete("/api/task-projects/{slug}/main-tasks/{task_id}")
async def delete_main_task(slug: str, task_id: str):
    path = _main_task_path(slug, task_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Main task not found")
    d = project_dir(slug)
    for p in d.glob("st-*.md"):
        post = frontmatter.load(str(p))
        if post.metadata.get("main_task_id") == task_id:
            p.unlink()
    path.unlink()
    return {"ok": True, "id": task_id}


@app.get("/api/task-projects/{slug}/main-tasks/{task_id}/subtasks")
async def list_subtasks(slug: str, task_id: str):
    d = project_dir(slug)
    if not (d / f"{task_id}.md").exists():
        raise HTTPException(status_code=404, detail="Main task not found")
    out = []
    for p in sorted(d.glob("st-*.md")):
        post = frontmatter.load(str(p))
        if post.metadata.get("main_task_id") != task_id:
            continue
        out.append(_subtask_from_post(d, p.stem, post))
    return {"subtasks": out}


class SubtaskCreate(BaseModel):
    name: str
    deadline: Optional[str] = None
    status_id: Optional[str] = None


@app.post("/api/task-projects/{slug}/main-tasks/{task_id}/subtasks")
async def create_subtask(slug: str, task_id: str, payload: SubtaskCreate):
    d = project_dir(slug)
    if not (d / f"{task_id}.md").exists():
        raise HTTPException(status_code=404, detail="Main task not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    subtask_id = "st-" + uuid.uuid4().hex[:12]
    status_id = _normalize_status_id(payload.status_id)
    post = frontmatter.Post("")
    post.metadata.update(
        {
            "type": "subtask",
            "main_task_id": task_id,
            "name": name,
            "deadline": payload.deadline or None,
            "status_id": status_id,
            "completed_at": _now_iso() if status_id == "done" else None,
            "created_at": _now_iso(),
        }
    )
    (d / f"{subtask_id}.md").write_text(frontmatter.dumps(post))
    return {"ok": True, "subtask": _subtask_from_post(d, subtask_id, post)}


class SubtaskUpdate(BaseModel):
    name: Optional[str] = None
    deadline: Optional[str] = None
    status_id: Optional[str] = None


@app.put("/api/task-projects/{slug}/main-tasks/{task_id}/subtasks/{subtask_id}")
async def update_subtask(slug: str, task_id: str, subtask_id: str, payload: SubtaskUpdate):
    path = _subtask_path(slug, subtask_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Subtask not found")
    post = frontmatter.load(str(path))
    data = payload.model_dump(exclude_unset=True)
    if "status_id" in data:
        data["status_id"] = _normalize_status_id(data["status_id"])
        was_done = _status_id_of(post.metadata) == "done"
        now_done = data["status_id"] == "done"
        if now_done and not was_done:
            post.metadata["completed_at"] = _now_iso()
        elif not now_done and was_done:
            post.metadata["completed_at"] = None
    for k, v in data.items():
        post.metadata[k] = v
    path.write_text(frontmatter.dumps(post))
    return {"ok": True, "subtask": _subtask_from_post(project_dir(slug), subtask_id, post)}


@app.delete("/api/task-projects/{slug}/main-tasks/{task_id}/subtasks/{subtask_id}")
async def delete_subtask(slug: str, task_id: str, subtask_id: str):
    path = _subtask_path(slug, subtask_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Subtask not found")
    path.unlink()
    return {"ok": True, "id": subtask_id}


@app.get("/api/tasks/active-summary")
async def tasks_active_summary():
    """Active (is_active) main tasks across every project — feeds the Dashboard progress bars."""
    _ensure_pinned_project()
    out = []
    for d in sorted(tasks_dir().iterdir()):
        if not d.is_dir():
            continue
        project = _project_from_dir(d)
        if not project:
            continue
        for p in sorted(d.glob("mt-*.md")):
            post = frontmatter.load(str(p))
            if not bool(post.metadata.get("is_active")):
                continue
            mt = _main_task_from_post(d, p.stem, post)
            out.append(
                {
                    "project_slug": project["slug"],
                    "project_name": project["name"],
                    "main_task_id": mt["id"],
                    "main_task_name": mt["name"],
                    "deadline": mt["deadline"],
                    "subtask_done": mt["subtask_done"],
                    "subtask_total": mt["subtask_total"],
                }
            )
    return {"active": out}


@app.get("/api/tasks/completed-by-day")
async def tasks_completed_by_day(start: str, end: str):
    """Subtask-completion counts per day, from `completed_at` — feeds the Dashboard heatmap's Tasks row."""
    try:
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")
    if end_d < start_d:
        raise HTTPException(status_code=400, detail="end must be >= start")
    if (end_d - start_d).days > 400:
        raise HTTPException(status_code=400, detail="range too large (max 400 days)")
    counts: dict[str, int] = {}
    for d in tasks_dir().iterdir():
        if not d.is_dir():
            continue
        for p in d.glob("st-*.md"):
            post = frontmatter.load(str(p))
            completed_at = post.metadata.get("completed_at")
            if not completed_at:
                continue
            day = str(completed_at)[:10]
            counts[day] = counts.get(day, 0) + 1
    return {"days": [{"date": d.isoformat(), "count": counts.get(d.isoformat(), 0)}
                      for d in (start_d + timedelta(days=i) for i in range((end_d - start_d).days + 1))]}


# ── Concepts & weekly synthesis (ledger triggers) ─────────────────────────────

NOTE_SLUG_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _vault_note_path(folder: str, slug: str) -> Path:
    if not NOTE_SLUG_RE.fullmatch(slug or ""):
        raise HTTPException(status_code=400, detail="Invalid slug")
    root = (VAULT / folder).resolve()
    path = (root / f"{slug}.md").resolve()
    if path.parent != root:
        raise HTTPException(status_code=400, detail="Invalid slug")
    return path


class NoteUpdate(BaseModel):
    frontmatter: dict[str, Any]
    body: Optional[str] = None


@app.put("/api/concepts/{slug}")
async def update_concept(slug: str, payload: NoteUpdate):
    path = _vault_note_path("20-Concepts", slug)
    post = frontmatter.load(str(path)) if path.exists() else frontmatter.Post("")
    for k, v in payload.frontmatter.items():
        post.metadata[k] = v
    if payload.body is not None:
        post.content = payload.body
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter.dumps(post))
    return {"ok": True, "slug": slug}


@app.put("/api/synthesis/{slug}")
async def update_synthesis(slug: str, payload: NoteUpdate):
    path = _vault_note_path("40-Synthesis", slug)
    post = frontmatter.load(str(path)) if path.exists() else frontmatter.Post("")
    for k, v in payload.frontmatter.items():
        post.metadata[k] = v
    if payload.body is not None:
        post.content = payload.body
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter.dumps(post))
    return {"ok": True, "slug": slug}




# ── Feynman (CLI terminal — https://www.feynman.is) ────────────────────────────

@app.get("/api/feynman/status")
async def feynman_status(request: Request):
    """Probe the Feynman terminal container and return browser WS/HTTP URLs."""
    installed = False
    reachable = False
    detail = ""
    mode = "terminal"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(FEYNMAN_URL + "/health", timeout=4.0, follow_redirects=True)
            reachable = resp.status_code < 500
            installed = True
            detail = f"HTTP {resp.status_code}"
            try:
                body = resp.json()
                mode = str(body.get("mode") or mode)
            except Exception:
                pass
    except httpx.RequestError as e:
        detail = str(e) or e.__class__.__name__

    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost"
    hostname = host.split(":")[0]
    # Prefer same scheme as the page when behind TLS (Tailscale serve, etc.)
    xf_proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
    ws_scheme = "wss" if xf_proto == "https" else "ws"
    public_url = f"{xf_proto}://{hostname}:{FEYNMAN_HOST_PORT}/"
    ws_url = f"{ws_scheme}://{hostname}:{FEYNMAN_HOST_PORT}/ws"

    return {
        "ok": reachable,
        "installed": installed or reachable,
        "reachable": reachable,
        "mode": mode,
        "internalUrl": FEYNMAN_URL,
        "publicUrl": public_url,
        "wsUrl": ws_url,
        "port": FEYNMAN_HOST_PORT,
        "docsUrl": "https://www.feynman.is",
        "message": detail if not reachable else "Feynman terminal is running",
    }


# ── System Info & Settings ─────────────────────────────────────────────────────

@app.get("/api/info")
async def system_info():
    """Return system information (TeX version, vault path, mounted directories, disk usage)."""

    tex_version = ""
    try:
        result = subprocess.run(["pdflatex", "--version"], capture_output=True, text=True, timeout=5)
        if result.stdout:
            tex_version = result.stdout.split("\n")[0]
    except Exception:
        pass

    if not VAULT.exists():
        VAULT.mkdir(parents=True, exist_ok=True)
    disk_stat = shutil.disk_usage(VAULT)

    available_paths = []
    # Desktop uses a real folder picker. Walking the vault here would list
    # every notes subdirectory as if it were a mount point.
    if not DESKTOP_MODE and VAULT.exists():
        for p in sorted(VAULT.rglob("*")):
            if p.is_dir() and not p.name.startswith("."):
                available_paths.append(str(p))

    manifest = load_manifest(VAULT) if DESKTOP_MODE else None
    previous = PREVIOUS_APP_VERSION or (str(manifest.get("app_version") or "") if manifest else "")
    recovered = DESKTOP_MODE and (EXISTING_DATA or bool(manifest))
    latex_path = (manifest or {}).get("latex_path") or str(VAULT / "70-LaTeX")
    notes_path = (manifest or {}).get("notes_path") or str(VAULT / "10-Papers")
    chosen = True
    if DESKTOP_MODE:
        chosen = bool(_desktop_config().get("data_path_chosen") or manifest)

    return {
        "texVersion": tex_version,
        "vaultPath": str(VAULT),
        "latexPath": latex_path,
        "notesPath": notes_path,
        "indexPath": str(Path(LANCEDB_PATH)),
        "diskFree": disk_stat.free,
        "availablePaths": available_paths,
        "desktop": DESKTOP_MODE,
        "dataPathChosen": chosen,
        "appVersion": APP_VERSION,
        "previousAppVersion": previous or None,
        "existingData": recovered,
        "manifestPresent": bool(manifest),
        "latexFileCount": count_tex_files(Path(latex_path)),
        "reinstall": (
            {"from": previous or "unknown", "to": APP_VERSION}
            if recovered
            else None
        ),
        "owner": "Kamil Nadaf",
        "license": "MIT License",
        "copyright": "© 2026 Kamil Nadaf",
    }


class DataProbePayload(BaseModel):
    path: str


@app.post("/api/data/probe")
async def probe_data_dir(payload: DataProbePayload):
    """Read-only look at a folder. Does not change the active vault."""
    if not DESKTOP_MODE:
        return {"ok": False, "desktop": False, "message": "Data probe is desktop-only."}
    raw = (payload.path or "").strip()
    if not raw:
        return {"ok": False, "desktop": True, "existingData": False, "message": "Choose a folder."}
    try:
        info = inspect_data_dir(Path(raw))
    except Exception as exc:
        return {"ok": False, "desktop": True, "existingData": False, "message": str(exc)}
    return {"ok": True, "desktop": True, **info}


class SettingsPayload(BaseModel):
    latexDir: Optional[str] = None
    userAccount: Optional[str] = None


@app.post("/api/settings")
async def update_settings(payload: SettingsPayload):
    """Persist account prefs. On the desktop app, latexDir is the notes folder."""
    if DESKTOP_MODE and payload.latexDir is not None:
        chosen = payload.latexDir.strip()
        if not chosen:
            return {"ok": False, "message": "Choose a folder for your notes.", "vaultPath": str(VAULT)}
        try:
            set_vault(Path(chosen))
        except Exception as exc:
            return {"ok": False, "message": str(exc), "vaultPath": str(VAULT)}
        return {
            "ok": True,
            "message": "Data path saved.",
            "vaultPath": str(VAULT),
            "latexPath": str(VAULT / "70-LaTeX"),
            "notesPath": str(VAULT / "10-Papers"),
            "desktop": True,
            "existingData": bool(load_manifest(VAULT)),
        }
    return {"ok": True, "message": "Settings received", "desktop": DESKTOP_MODE}


class ClientPrefsPayload(BaseModel):
    """Snapshot of client-side localStorage keys (theme, AI provider config, fonts, …).

    Desktop WKWebView storage is unreliable across relaunches (per-launch identity is
    not guaranteed stable), so the frontend mirrors these keys here as the durable
    source of truth and rehydrates localStorage from this on boot.
    """
    prefs: dict[str, str] = {}


@app.get("/api/settings/client-prefs")
async def get_client_prefs():
    return {"prefs": load_app_settings(VAULT).get("client_prefs") or {}}


@app.post("/api/settings/client-prefs")
async def save_client_prefs(payload: ClientPrefsPayload):
    save_app_settings(VAULT, {**load_app_settings(VAULT), "client_prefs": payload.prefs})
    return {"ok": True}


# ── User-supplied uploads: custom fonts, Loki logo ─────────────────────────
# Stored in the vault so they survive app reinstalls/rebuilds. We never bundle
# or fetch third-party font/image files ourselves — only what the user uploads.

FONT_CONTENT_TYPES = {
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
}
LOGO_CONTENT_TYPES = {
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _uploads_dir(kind: str) -> Path:
    d = VAULT / ".ygg-config" / "uploads" / kind
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_upload_name(filename: str) -> str:
    name = Path(filename or "").name
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")
    return name or "file"


@app.get("/api/uploads/fonts")
async def list_custom_fonts():
    d = _uploads_dir("fonts")
    out = []
    for p in sorted(d.iterdir()):
        if p.is_file() and p.suffix.lower() in FONT_CONTENT_TYPES:
            out.append({"filename": p.name, "url": f"/api/uploads/fonts/file/{p.name}"})
    return {"fonts": out}


@app.post("/api/uploads/fonts")
async def upload_custom_font(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in FONT_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported font type. Use .ttf, .otf, .woff, or .woff2.")
    name = _safe_upload_name(file.filename)
    dest = _uploads_dir("fonts") / name
    dest.write_bytes(await file.read())
    return {"ok": True, "filename": name, "url": f"/api/uploads/fonts/file/{name}"}


@app.delete("/api/uploads/fonts/{filename}")
async def delete_custom_font(filename: str):
    dest = _uploads_dir("fonts") / _safe_upload_name(filename)
    if dest.exists():
        dest.unlink()
    return {"ok": True}


@app.get("/api/uploads/fonts/file/{filename}")
async def get_custom_font_file(filename: str):
    dest = _uploads_dir("fonts") / _safe_upload_name(filename)
    if not dest.exists():
        raise HTTPException(status_code=404, detail="Font not found")
    return FileResponse(dest, media_type=FONT_CONTENT_TYPES.get(dest.suffix.lower(), "application/octet-stream"))


@app.get("/api/uploads/loki-logo")
async def get_loki_logo():
    d = _uploads_dir("loki-logo")
    for p in sorted(d.iterdir()):
        if p.is_file() and p.suffix.lower() in LOGO_CONTENT_TYPES:
            return {"url": f"/api/uploads/loki-logo/file/{p.name}"}
    return {"url": None}


@app.post("/api/uploads/loki-logo")
async def upload_loki_logo(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in LOGO_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image type. Use PNG, SVG, JPG, or WebP.")
    d = _uploads_dir("loki-logo")
    for p in list(d.iterdir()):
        if p.is_file():
            p.unlink()
    name = "logo" + ext
    dest = d / name
    dest.write_bytes(await file.read())
    return {"ok": True, "url": f"/api/uploads/loki-logo/file/{name}"}


@app.delete("/api/uploads/loki-logo")
async def delete_loki_logo():
    d = _uploads_dir("loki-logo")
    for p in list(d.iterdir()):
        if p.is_file():
            p.unlink()
    return {"ok": True}


@app.get("/api/uploads/loki-logo/file/{filename}")
async def get_loki_logo_file(filename: str):
    dest = _uploads_dir("loki-logo") / _safe_upload_name(filename)
    if not dest.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(dest, media_type=LOGO_CONTENT_TYPES.get(dest.suffix.lower(), "application/octet-stream"))


@app.get("/api/settings/analysis-tags")
async def get_analysis_tags():
    tags = current_analysis_tags()
    keys = analysis_keys(tags)
    return {
        "analysis_tags": tags,
        "keys": keys,
        "defaults": list(DEFAULT_ANALYSIS_TAGS),
        "key_counts": scan_frontmatter_keys(VAULT, keys),
    }


class AnalysisTagsPayload(BaseModel):
    analysis_tags: list[str]
    migrate: bool = False
    dry_run: bool = True


@app.post("/api/settings/analysis-tags")
async def set_analysis_tags(payload: AnalysisTagsPayload):
    """
    Save analysis tag labels (≥5, unique keys). Optionally migrate old
    frontmatter keys → new keys in 10-Papers/.
    """
    try:
        tags = normalize_analysis_tags(payload.analysis_tags)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    old_tags = current_analysis_tags()
    old_keys = analysis_keys(old_tags)
    new_keys = analysis_keys(tags)
    mapping = {o: n for o, n in zip(old_keys, new_keys) if o != n}

    save_app_settings(VAULT, {**load_app_settings(VAULT), "analysis_tags": tags})

    migration = None
    if mapping:
        counts = scan_frontmatter_keys(VAULT, list(mapping.keys()))
        if payload.migrate:
            migration = migrate_frontmatter_keys(VAULT, mapping, dry_run=payload.dry_run)
            migration["mapping"] = mapping
            migration["counts"] = counts
        else:
            migration = {
                "ok": True,
                "dry_run": True,
                "mapping": mapping,
                "counts": counts,
                "changed": [],
                "skipped": [],
                "warning": (
                    "Tag keys changed. Call again with migrate=true to rename "
                    "frontmatter keys in batch, or leave notes as-is (Gate will "
                    "look for the new keys)."
                ),
            }

    return {
        "ok": True,
        "analysis_tags": tags,
        "keys": new_keys,
        "migration": migration,
    }


class MigrateTagsPayload(BaseModel):
    mapping: dict[str, str]
    dry_run: bool = False


@app.post("/api/settings/analysis-tags/migrate")
async def migrate_analysis_tags(payload: MigrateTagsPayload):
    if not payload.mapping:
        raise HTTPException(status_code=400, detail="mapping required")
    # Normalize keys
    mapping = {tag_to_key(k): tag_to_key(v) for k, v in payload.mapping.items()}
    result = migrate_frontmatter_keys(VAULT, mapping, dry_run=payload.dry_run)
    result["mapping"] = mapping
    result["counts"] = scan_frontmatter_keys(VAULT, list(mapping.keys()))
    return result


def _task_status_usage() -> dict[str, int]:
    """How many main_tasks + subtasks currently reference each status id."""
    counts: dict[str, int] = {}
    root = tasks_dir()
    if not root.exists():
        return counts
    for d in root.iterdir():
        if not d.is_dir():
            continue
        for p in list(d.glob("mt-*.md")) + list(d.glob("st-*.md")):
            try:
                post = frontmatter.load(str(p))
            except Exception:
                continue
            status_id = _status_id_of(post.metadata)
            if status_id:
                counts[status_id] = counts.get(status_id, 0) + 1
    return counts


def _reassign_task_status(old_id: str, new_id: str) -> int:
    """Rewrite status_id (and completed_at, for subtasks) on every task referencing old_id. Returns count changed."""
    changed = 0
    root = tasks_dir()
    for d in root.iterdir():
        if not d.is_dir():
            continue
        for p in list(d.glob("mt-*.md")) + list(d.glob("st-*.md")):
            try:
                post = frontmatter.load(str(p))
            except Exception:
                continue
            if _status_id_of(post.metadata) != old_id:
                continue
            post.metadata["status_id"] = new_id
            post.metadata.pop("status", None)
            if p.name.startswith("st-"):
                post.metadata["completed_at"] = _now_iso() if new_id == "done" else None
            p.write_text(frontmatter.dumps(post))
            changed += 1
    return changed


@app.get("/api/settings/task-statuses")
async def get_task_statuses():
    statuses = current_task_statuses()
    return {"task_statuses": statuses, "usage": _task_status_usage()}


class TaskStatusesPayload(BaseModel):
    task_statuses: list[dict[str, Any]]
    reassign: dict[str, str] = {}


@app.post("/api/settings/task-statuses")
async def set_task_statuses(payload: TaskStatusesPayload):
    try:
        new_statuses = normalize_task_statuses(payload.task_statuses)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    old_statuses = current_task_statuses()
    new_ids = {s["id"] for s in new_statuses}
    usage = _task_status_usage()

    removed_ids = [s["id"] for s in old_statuses if s["id"] not in new_ids]
    for old_id in removed_ids:
        count = usage.get(old_id, 0)
        if count <= 0:
            continue
        new_id = payload.reassign.get(old_id)
        if not new_id or new_id not in new_ids:
            name = next((s["name"] for s in old_statuses if s["id"] == old_id), old_id)
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f'{count} task(s) use status "{name}" — reassign to another status before deleting it.',
                    "status_id": old_id,
                    "status_name": name,
                    "count": count,
                },
            )

    for old_id, new_id in payload.reassign.items():
        if old_id in removed_ids and new_id in new_ids:
            _reassign_task_status(old_id, new_id)

    save_app_settings(VAULT, {**load_app_settings(VAULT), "task_statuses": new_statuses})
    return {"ok": True, "task_statuses": new_statuses}


@app.get("/api/settings/goals")
async def get_goals():
    return {"goals": current_goals()}


class GoalPayload(BaseModel):
    name: str
    start_date: str
    end_date: str


@app.post("/api/settings/goals")
async def add_goal(payload: GoalPayload):
    goals = current_goals()
    try:
        goals = normalize_goals([*goals, payload.model_dump()])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    save_app_settings(VAULT, {**load_app_settings(VAULT), "goals": goals})
    return {"ok": True, "goals": goals}


@app.delete("/api/settings/goals/{goal_id}")
async def delete_goal(goal_id: str):
    goals = [g for g in current_goals() if g["id"] != goal_id]
    save_app_settings(VAULT, {**load_app_settings(VAULT), "goals": goals})
    return {"ok": True, "goals": goals}


class GoalUpdatePayload(BaseModel):
    name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


@app.put("/api/settings/goals/{goal_id}")
async def update_goal(goal_id: str, payload: GoalUpdatePayload):
    goals = current_goals()
    idx = next((i for i, g in enumerate(goals) if g["id"] == goal_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    updated = dict(goals[idx])
    if payload.name is not None:
        updated["name"] = payload.name
    if payload.start_date is not None:
        updated["start_date"] = payload.start_date
    if payload.end_date is not None:
        updated["end_date"] = payload.end_date
    try:
        goals[idx] = normalize_goals([updated])[0]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    save_app_settings(VAULT, {**load_app_settings(VAULT), "goals": goals})
    return {"ok": True, "goals": goals}


# ── Vault git sync (version-history backup to a remote, alongside Syncthing) ───
# Runs `git` directly against VAULT. This is a separate repo from the app's own
# source repo — it lives INSIDE the vault directory, tracking notes/papers/latex
# docs, not code. Never stores credentials: `remote_url` must already carry its
# own auth (an HTTPS URL with an embedded token, or an SSH URL if you've mounted
# a key into this container) — same as using `git` by hand would require.

def _run_git(*args: str, timeout: float = 30.0) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(VAULT),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = ((result.stdout or "") + (result.stderr or "")).strip()
        return result.returncode == 0, output
    except Exception as e:
        return False, str(e)


@app.get("/api/vault/git/status")
async def vault_git_status():
    is_repo, _ = _run_git("rev-parse", "--is-inside-work-tree")
    if not is_repo:
        return {"is_repo": False}
    remote_ok, remote = _run_git("remote", "get-url", "origin")
    branch_ok, branch = _run_git("rev-parse", "--abbrev-ref", "HEAD")
    commit_ok, last_commit = _run_git("log", "-1", "--format=%h  %ci  %s")
    status_ok, status_out = _run_git("status", "--porcelain")
    dirty_files = len([l for l in status_out.splitlines() if l.strip()]) if status_ok else 0
    return {
        "is_repo": True,
        "remote": remote if remote_ok else None,
        "branch": branch if branch_ok else None,
        "last_commit": last_commit if commit_ok else None,
        "dirty_files": dirty_files,
    }


class GitInitPayload(BaseModel):
    remote_url: str


@app.post("/api/vault/git/init")
async def vault_git_init(payload: GitInitPayload):
    """Initialize the vault as a git repo (if not one already) and point it at a remote."""
    is_repo, _ = _run_git("rev-parse", "--is-inside-work-tree")
    if not is_repo:
        ok, out = _run_git("init")
        if not ok:
            return {"ok": False, "message": f"git init failed: {out}"}
        _run_git("checkout", "-b", "main")

    _run_git("config", "user.email", "yggdrasil@localhost")
    _run_git("config", "user.name", "Yggdrasil")

    has_remote, _ = _run_git("remote", "get-url", "origin")
    if has_remote:
        ok, out = _run_git("remote", "set-url", "origin", payload.remote_url)
    else:
        ok, out = _run_git("remote", "add", "origin", payload.remote_url)
    if not ok:
        return {"ok": False, "message": f"Failed to set remote: {out}"}

    return {"ok": True, "message": "Vault git repo ready — click Sync Now to push"}


@app.post("/api/vault/git/sync")
async def vault_git_sync():
    """
    git add -A && git commit && git push. Never raises to the caller — every
    failure mode (no repo, no remote, nothing to commit, push rejected, network
    error, missing credentials) comes back as a normal {ok: false, message} body.
    """
    is_repo, _ = _run_git("rev-parse", "--is-inside-work-tree")
    if not is_repo:
        return {"ok": False, "message": "Vault is not a git repo yet — set a remote first"}

    has_remote, _ = _run_git("remote", "get-url", "origin")
    if not has_remote:
        return {"ok": False, "message": "No git remote configured — set one above first"}

    _run_git("add", "-A")
    status_ok, status_out = _run_git("status", "--porcelain")
    has_changes = status_ok and bool(status_out.strip())

    if has_changes:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        commit_ok, commit_out = _run_git("commit", "-m", f"Vault sync — {ts}")
        if not commit_ok:
            return {"ok": False, "message": f"Commit failed: {commit_out}"}

    push_ok, push_out = _run_git("push", "-u", "origin", "HEAD", timeout=60.0)
    if not push_ok:
        return {"ok": False, "message": f"Push failed: {push_out}"}

    return {"ok": True, "message": "Synced ✓" if has_changes else "Already up to date", "pushed": has_changes}


# ── Vault WebDAV sync (personal cloud — Nextcloud, ownCloud, generic WebDAV) ────
#
# There's no way to link a real Google/iCloud *account* here — that needs an
# OAuth app registration and consent screen, which is out of scope for a
# self-hosted single-user tool. What IS practical without any of that is
# WebDAV: Nextcloud, ownCloud, Koofr, and most self-hosted/"personal cloud"
# boxes expose a WebDAV endpoint you can push files to with just a URL +
# username + app password — no OAuth needed. This mirrors the vault (skips
# .git and this config file itself) to that endpoint via plain HTTP PUT/MKCOL.

_WEBDAV_CONFIG_PATH = VAULT / ".ygg-config" / "webdav.json"
_WEBDAV_SKIP_DIRS = {".git", ".ygg-config", "index"}


def _webdav_ensure_gitignore():
    """Keep the local WebDAV config (has a password in it) out of the git-sync feature."""
    gitignore = VAULT / ".gitignore"
    line = ".ygg-config/"
    try:
        existing = gitignore.read_text() if gitignore.exists() else ""
        if line not in existing.splitlines():
            with gitignore.open("a") as f:
                if existing and not existing.endswith("\n"):
                    f.write("\n")
                f.write(line + "\n")
    except OSError:
        pass


def _webdav_load_config() -> Optional[dict]:
    if not _WEBDAV_CONFIG_PATH.exists():
        return None
    try:
        return json.loads(_WEBDAV_CONFIG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None


class WebDavConfigPayload(BaseModel):
    url: str
    username: str = ""
    password: str = ""
    remote_dir: str = "yggdrasil-vault"


@app.get("/api/vault/webdav/status")
async def vault_webdav_status():
    cfg = _webdav_load_config()
    if not cfg:
        return {"configured": False}
    return {
        "configured": True,
        "url": cfg.get("url", ""),
        "username": cfg.get("username", ""),
        "remote_dir": cfg.get("remote_dir", ""),
        "last_sync": cfg.get("last_sync"),
    }


@app.post("/api/vault/webdav/config")
async def vault_webdav_config(payload: WebDavConfigPayload):
    url = payload.url.strip().rstrip("/")
    if not url:
        return {"ok": False, "message": "Remote WebDAV URL is required"}
    _WEBDAV_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = _webdav_load_config() or {}
    existing.update(
        {
            "url": url,
            "username": payload.username.strip(),
            "password": payload.password if payload.password else existing.get("password", ""),
            "remote_dir": payload.remote_dir.strip().strip("/") or "yggdrasil-vault",
        }
    )
    _WEBDAV_CONFIG_PATH.write_text(json.dumps(existing))
    _webdav_ensure_gitignore()
    return {"ok": True, "message": "WebDAV remote saved — click Sync Now to push"}


async def _webdav_mkcol(client: httpx.AsyncClient, base: str, auth, path_parts: list[str]):
    """MKCOL each directory level; 405/409 (already exists) are fine, everything else raises."""
    cur = base
    for part in path_parts:
        cur = f"{cur}/{part}"
        resp = await client.request("MKCOL", cur, auth=auth, timeout=15.0)
        if resp.status_code not in (201, 405, 409, 301):
            resp.raise_for_status()


@app.post("/api/vault/webdav/sync")
async def vault_webdav_sync():
    """
    Push every file in the vault to the configured WebDAV remote via PUT,
    creating remote directories as needed. Never raises to the caller — every
    failure (no config, bad credentials, unreachable host) comes back as a
    normal {ok: false, message} body.
    """
    cfg = _webdav_load_config()
    if not cfg or not cfg.get("url"):
        return {"ok": False, "message": "No WebDAV remote configured — set one above first"}

    base = f"{cfg['url']}/{cfg.get('remote_dir', 'yggdrasil-vault')}".rstrip("/")
    auth = (cfg.get("username", ""), cfg.get("password", "")) if cfg.get("username") else None

    files = [
        p for p in VAULT.rglob("*")
        if p.is_file() and not any(part in _WEBDAV_SKIP_DIRS for part in p.relative_to(VAULT).parts)
    ]

    pushed = 0
    made_dirs: set[str] = set()
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            for f in files:
                rel = f.relative_to(VAULT)
                parts = rel.parts
                if len(parts) > 1:
                    dir_parts = parts[:-1]
                    dir_key = "/".join(dir_parts)
                    if dir_key not in made_dirs:
                        await _webdav_mkcol(client, base, auth, list(dir_parts))
                        made_dirs.add(dir_key)
                url = f"{base}/{'/'.join(parts)}"
                resp = await client.put(url, auth=auth, content=f.read_bytes(), timeout=30.0)
                if resp.status_code not in (200, 201, 204):
                    return {"ok": False, "message": f"Failed to upload {rel}: HTTP {resp.status_code}"}
                pushed += 1
    except httpx.HTTPError as e:
        return {"ok": False, "message": f"WebDAV sync failed: {e}"}

    cfg["last_sync"] = datetime.now().isoformat()
    _WEBDAV_CONFIG_PATH.write_text(json.dumps(cfg))
    return {"ok": True, "message": f"Synced {pushed} file(s) ✓", "pushed": pushed}


# ── Auto-sync (periodic, opt-in) — runs the git/webdav sync you already ───────
# configured above on a timer, so you don't have to remember to click "Sync
# Now". Off by default. Config lives next to the webhook config below.

_AUTOSYNC_CONFIG_PATH = VAULT / ".ygg-config" / "autosync.json"


def _autosync_load_config() -> dict:
    if not _AUTOSYNC_CONFIG_PATH.exists():
        return {"enabled": False, "interval_minutes": 30, "target": "git"}
    try:
        return json.loads(_AUTOSYNC_CONFIG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {"enabled": False, "interval_minutes": 30, "target": "git"}


class AutoSyncConfigPayload(BaseModel):
    enabled: bool
    interval_minutes: int = 30
    target: str = "git"  # "git" | "webdav" | "both"


@app.get("/api/vault/autosync/status")
async def autosync_status():
    cfg = _autosync_load_config()
    return {**cfg, "last_run": cfg.get("last_run")}


@app.post("/api/vault/autosync/config")
async def autosync_config(payload: AutoSyncConfigPayload):
    _AUTOSYNC_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    cfg = {
        "enabled": payload.enabled,
        "interval_minutes": max(5, payload.interval_minutes),
        "target": payload.target if payload.target in ("git", "webdav", "both") else "git",
        "last_run": _autosync_load_config().get("last_run"),
    }
    _AUTOSYNC_CONFIG_PATH.write_text(json.dumps(cfg))
    _webdav_ensure_gitignore()
    return {"ok": True, "message": "Auto-sync settings saved"}


async def _autosync_loop():
    """Background loop: every 5 min, check if it's time to auto-sync per config."""
    while True:
        await asyncio.sleep(300)
        try:
            cfg = _autosync_load_config()
            if not cfg.get("enabled"):
                continue
            last_run = cfg.get("last_run")
            interval = timedelta(minutes=cfg.get("interval_minutes", 30))
            if last_run:
                try:
                    if datetime.now() - datetime.fromisoformat(last_run) < interval:
                        continue
                except ValueError:
                    pass
            target = cfg.get("target", "git")
            if target in ("git", "both"):
                try:
                    await vault_git_sync()
                except Exception:
                    pass
            if target in ("webdav", "both"):
                try:
                    await vault_webdav_sync()
                except Exception:
                    pass
            cfg["last_run"] = datetime.now().isoformat()
            _AUTOSYNC_CONFIG_PATH.write_text(json.dumps(cfg))
        except Exception:
            pass  # never let a background sync tick crash the app


# ── Weekly score digest → webhook (Slack/Discord-compatible) ──────────────────

_WEBHOOK_CONFIG_PATH = VAULT / ".ygg-config" / "webhook.json"


def _webhook_load_config() -> Optional[dict]:
    if not _WEBHOOK_CONFIG_PATH.exists():
        return None
    try:
        return json.loads(_WEBHOOK_CONFIG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None


class WebhookConfigPayload(BaseModel):
    url: str
    enabled: bool = True
    day_of_week: int = 6  # 0=Monday .. 6=Sunday
    hour: int = 18        # 24h, local container time


@app.get("/api/webhook/status")
async def webhook_status():
    cfg = _webhook_load_config()
    if not cfg:
        return {"configured": False}
    return {
        "configured": True,
        "url": cfg.get("url", ""),
        "enabled": cfg.get("enabled", False),
        "day_of_week": cfg.get("day_of_week", 6),
        "hour": cfg.get("hour", 18),
        "last_sent": cfg.get("last_sent"),
    }


@app.post("/api/webhook/config")
async def webhook_config(payload: WebhookConfigPayload):
    url = payload.url.strip()
    if not url:
        return {"ok": False, "message": "Webhook URL is required"}
    _WEBHOOK_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = _webhook_load_config() or {}
    existing.update(
        {
            "url": url,
            "enabled": payload.enabled,
            "day_of_week": max(0, min(6, payload.day_of_week)),
            "hour": max(0, min(23, payload.hour)),
        }
    )
    _WEBHOOK_CONFIG_PATH.write_text(json.dumps(existing))
    _webdav_ensure_gitignore()
    return {"ok": True, "message": "Webhook saved"}


def _build_digest_markdown(period: str) -> tuple[str, int, str, str]:
    today = date.today()
    if period == "month":
        start = today.replace(day=1)
    else:
        start = today - timedelta(days=today.weekday())  # Monday of this week
    start_str = start.isoformat()
    today_str = today.isoformat()

    lines = [f"# Reading Digest — {start_str} to {today_str}", ""]
    count = 0
    for p in sorted((VAULT / "10-Papers").glob("*.md")):
        post = frontmatter.load(str(p))
        fm = post.metadata
        read_date = str(fm.get("read") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}", read_date) or read_date < start_str:
            continue
        count += 1
        lines.append(f"## {fm.get('title', p.stem)}")
        meta_bits = [f"arXiv:{fm.get('arxiv')}" if fm.get("arxiv") else None, f"read {read_date}"]
        lines.append(f"*{' · '.join(b for b in meta_bits if b)}*")
        lines.append("")
        for label, slot in zip(current_analysis_tags(), current_analysis_keys()):
            val = str(fm.get(slot) or "").strip()
            if val:
                lines.append(f"**{label}:** {val}")
        aq = str(fm.get("adversarial_question") or "").strip()
        if aq:
            lines.append(f"**Adversarial Question:** {aq}")
        lines.append("")
    if count == 0:
        lines.append("_No papers completed in this period._")
    return "\n".join(lines), count, start_str, today_str


@app.get("/api/digest")
async def get_digest(period: str = "week"):
    """Markdown reading digest — papers whose `read` date falls in the period."""
    markdown, count, start_str, end_str = _build_digest_markdown(period if period == "month" else "week")
    return {"markdown": markdown, "count": count, "start": start_str, "end": end_str}


async def _send_webhook_message(url: str, text: str) -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json={"text": text, "content": text}, timeout=15.0)
            if resp.status_code >= 300:
                return False, f"Webhook returned HTTP {resp.status_code}"
            return True, "Sent ✓"
    except httpx.HTTPError as e:
        return False, f"Webhook request failed: {e}"


def _weekly_digest_message() -> str:
    digest_md, count, start_str, end_str = _build_digest_markdown("week")
    lines = [
        f"*Yggdrasil weekly digest* — {start_str} to {end_str}",
        f"{count} paper(s) completed this week",
    ]
    return "\n".join(lines) + "\n\n" + digest_md


@app.post("/api/webhook/test")
async def webhook_test():
    cfg = _webhook_load_config()
    if not cfg or not cfg.get("url"):
        return {"ok": False, "message": "No webhook URL configured — set one above first"}
    ok, message = await _send_webhook_message(cfg["url"], _weekly_digest_message())
    if ok:
        cfg["last_sent"] = date.today().isoformat()
        _WEBHOOK_CONFIG_PATH.write_text(json.dumps(cfg))
    return {"ok": ok, "message": message}


async def _weekly_digest_loop():
    """Background loop: checks hourly, sends the weekly digest once per the
    configured day/hour, guarded so it only fires once per calendar day."""
    while True:
        await asyncio.sleep(3600)
        try:
            cfg = _webhook_load_config()
            if not cfg or not cfg.get("enabled") or not cfg.get("url"):
                continue
            now = datetime.now()
            if now.weekday() != cfg.get("day_of_week", 6) or now.hour != cfg.get("hour", 18):
                continue
            if cfg.get("last_sent") == now.date().isoformat():
                continue
            ok, _ = await _send_webhook_message(cfg["url"], _weekly_digest_message())
            if ok:
                cfg["last_sent"] = now.date().isoformat()
                _WEBHOOK_CONFIG_PATH.write_text(json.dumps(cfg))
        except Exception:
            pass  # never let a background digest tick crash the app


@app.on_event("startup")
async def _start_background_loops():
    asyncio.create_task(_autosync_loop())
    asyncio.create_task(_weekly_digest_loop())


# ── Full-text search over your own notes (not vector search — exact substring,
# case-insensitive, across frontmatter + body of every note in the vault) ─────

@app.get("/api/search")
async def search_notes(q: str, limit: int = 30):
    q_norm = q.strip().lower()
    if not q_norm:
        return {"results": []}
    results = []
    for md in sorted(VAULT.rglob("*.md")):
        if md.parent.name in (".ygg-config", "index"):
            continue
        try:
            post = frontmatter.load(str(md))
        except Exception:
            continue
        fm = post.metadata
        haystack_parts = [
            str(fm.get("title", "")),
            str(fm.get("abstract", "")),
            " ".join(fm.get("tags") or []),
            " ".join(fm.get("authors") or []),
            *[str(fm.get(k, "")) for k in current_analysis_keys()],
            post.content,
        ]
        combined = "\n".join(haystack_parts)
        idx = combined.lower().find(q_norm)
        if idx == -1:
            continue
        snippet_start = max(0, idx - 60)
        snippet = combined[snippet_start : idx + len(q_norm) + 60].strip().replace("\n", " ")
        results.append(
            {
                "citekey": md.stem,
                "title": fm.get("title") or md.stem,
                "folder": md.parent.name,
                "path": str(md.relative_to(VAULT)),
                "snippet": snippet,
            }
        )
        if len(results) >= limit:
            break
    return {"results": results, "query": q}


# ── Citation graph (Semantic Scholar, best-effort) + AI-adjacent suggestions ──
# "Citation" edges are real references between papers already in your vault
# (via Semantic Scholar's public API — no key required). "Suggested" edges use
# the same local embeddings the indexer already builds for /api/ask — nearest-
# neighbor by content similarity — so this never calls an external LLM and
# never auto-writes anything; both are purely additional edges for the Graph
# view, layered on top of your own [[wikilinks]].

@app.get("/api/graph/citations")
async def graph_citations():
    papers = all_papers()
    arxiv_to_citekey: dict[str, str] = {}
    for p in papers:
        aid = str(p["frontmatter"].get("arxiv", "")).strip()
        if aid:
            arxiv_to_citekey[aid.split("v")[0]] = p["citekey"]

    edges = []
    if not arxiv_to_citekey:
        return {"edges": edges}

    async with httpx.AsyncClient() as client:
        for aid, citekey in arxiv_to_citekey.items():
            try:
                resp = await client.get(
                    f"https://api.semanticscholar.org/graph/v1/paper/arXiv:{aid}",
                    params={"fields": "references.externalIds"},
                    timeout=8.0,
                )
                if resp.status_code != 200:
                    continue
                data = resp.json()
                for ref in data.get("references") or []:
                    ref_arxiv = str((ref.get("externalIds") or {}).get("ArXiv", "")).split("v")[0]
                    if ref_arxiv and ref_arxiv in arxiv_to_citekey and ref_arxiv != aid:
                        edges.append({"source": citekey, "target": arxiv_to_citekey[ref_arxiv], "type": "citation"})
            except httpx.HTTPError:
                continue  # Semantic Scholar is best-effort — one failure shouldn't block the rest
    return {"edges": edges}


@app.get("/api/graph/suggested")
async def graph_suggested(limit_per_paper: int = 3):
    table = get_table()
    if table is None:
        return {"edges": [], "warning": "Index not ready yet"}
    try:
        rows = table.to_pandas()
    except Exception:
        return {"edges": [], "warning": "Index not ready yet"}
    if rows.empty:
        return {"edges": []}

    reps = rows.drop_duplicates(subset="citekey", keep="first")
    edges = []
    seen_pairs = set()
    for _, row in reps.iterrows():
        citekey = row["citekey"]
        try:
            neighbors = (
                table.search(row["embedding"])
                .limit(limit_per_paper + 5)
                .select(["citekey"])
                .to_list()
            )
        except Exception:
            continue
        added = 0
        for n in neighbors:
            other = n["citekey"]
            if other == citekey or added >= limit_per_paper:
                continue
            pair = tuple(sorted((citekey, other)))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            edges.append({"source": citekey, "target": other, "type": "suggested"})
            added += 1
    return {"edges": edges}


# ── Bulk Zotero sync check ─────────────────────────────────────────────────────

@app.get("/api/zotero/audit")
async def zotero_audit():
    """Which papers in 10-Papers/ aren't in Zotero yet — checked all at once
    instead of one at a time. Uses the same search_zotero() as everywhere else,
    so it inherits the Better-BibTeX-then-Web-API fallback."""
    papers = all_papers()
    missing = []
    found = []
    for p in papers:
        fm = p["frontmatter"]
        query = str(fm.get("arxiv") or fm.get("title") or "").strip()
        if not query:
            continue
        entry = {"citekey": p["citekey"], "title": fm.get("title") or p["citekey"], "arxiv": fm.get("arxiv") or ""}
        try:
            result = search_zotero(query)
        except Exception:
            result = None
        (found if result else missing).append(entry)
    return {"missing": missing, "found": found, "total": len(papers)}


# ── Serve React frontend ──────────────────────────────────────────────────────

FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", "/app/frontend/dist"))
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
