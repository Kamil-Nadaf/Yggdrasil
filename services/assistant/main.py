"""
main.py — CERIC Reading System API (FastAPI)

Routes:
  GET  /api/brief/today
  GET  /api/papers
  GET  /api/papers/{citekey}
  PUT  /api/papers/{citekey}
  POST /api/papers/{citekey}/triage
  POST /api/papers/{citekey}/append-slot
  GET  /api/papers/{citekey}/raw
  POST /api/locate
  POST /api/ask
  POST /api/examine          ← GATE PROTECTED; only Anthropic call
  GET  /api/graph
  GET  /api/zotero/search
  POST /api/zotero/ensure/{arxiv_id}
  POST /api/zotero/add-paper
  GET  /api/arxiv/daily
  GET  /api/arxiv/search
  GET  /api/scores/today
  GET  /api/scores/week
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
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from gate import check_gate, GateError
from zotero import search_zotero, ensure_arxiv_in_zotero, add_paper_to_zotero

# ── Config ────────────────────────────────────────────────────────────────────

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
GATE_CHECK = os.environ.get("GATE_CHECK", "true").lower() != "false"
LATEX_URL = os.environ.get("LATEX_URL", "http://latex:9000")
LANCEDB_PATH = "/data/lancedb"

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


async def embed(text: str) -> list[float]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


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


def gate_status(citekey: str) -> dict:
    """Return gate pass/fail and which slots are missing."""
    path = paper_path(citekey)
    if not path.exists():
        return {"passed": False, "missing": ["note does not exist"]}
    try:
        check_gate(path)
        return {"passed": True, "missing": []}
    except GateError as e:
        return {
            "passed": False,
            "missing": e.missing_slots,
            "aq_missing": e.aq_missing,
        }


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
        post.metadata["claim"] = payload.claim
    path.write_text(frontmatter.dumps(post))
    return {"ok": True}


CERIC_SLOT_KEYS = ["claim", "evidence", "reasoning", "implications", "context"]


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
            "claim": "",
            "evidence": "",
            "reasoning": "",
            "implications": "",
            "context": "",
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
    Append text to one CERIC slot, creating a skeleton note first if this paper
    has no note yet. Never overwrites existing slot content — always appends
    with a newline separator; the user reviews/edits the result afterward in
    the CERIC Editor. Uses python-frontmatter for the write, never hand-rolled YAML.
    """
    if payload.slot not in CERIC_SLOT_KEYS:
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

    return {"ok": True, "citekey": citekey, "slot": payload.slot, "value": post.metadata[payload.slot]}


@app.get("/api/papers/{citekey}/raw")
async def get_paper_raw(citekey: str):
    """Raw .md text for clipboard/export — read-only; serialized by python-frontmatter."""
    path = paper_path(citekey)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Paper not found: {citekey}")
    post = frontmatter.load(str(path))
    return {"raw": frontmatter.dumps(post)}


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

class AskQuery(BaseModel):
    question: str
    limit: int = 6


@app.post("/api/ask")
async def ask(payload: AskQuery):
    """
    Search user's notes via LanceDB and generate an answer with Ollama.
    CONSTRAINT: This endpoint never calls Anthropic API. It answers from
    the user's own notes only — not from the underlying LLM's parametric knowledge.
    """
    table = get_table()
    if table is None:
        return {"answer": "Index not ready.", "sources": []}

    vec = await embed(payload.question)
    results = (
        table.search(vec)
        .limit(payload.limit)
        .select(["citekey", "chunk"])
        .to_list()
    )

    if not results:
        return {"answer": "No relevant notes found.", "sources": []}

    context = "\n\n---\n\n".join(
        f"[{r['citekey']}]: {r['chunk']}" for r in results
    )
    prompt = (
        "You are a research assistant. Answer the question using ONLY the "
        "provided excerpts from the researcher's own reading notes. "
        "Cite the citekey when quoting. If the excerpts don't contain the "
        "answer, say so — do not use outside knowledge.\n\n"
        f"QUESTION: {payload.question}\n\n"
        f"EXCERPTS:\n{context}\n\nANSWER:"
    )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": "llama3.2", "prompt": prompt, "stream": False},
            timeout=60.0,
        )
        resp.raise_for_status()
        answer = resp.json().get("response", "")

    sources = [{"citekey": r["citekey"], "excerpt": r["chunk"][:200]} for r in results]
    return {"answer": answer, "sources": sources}


# ── Examine (GATE PROTECTED — only Anthropic call in the system) ───────────────

class ExaminePayload(BaseModel):
    citekey: str


@app.post("/api/examine")
async def examine(payload: ExaminePayload):
    """
    Run deep AI analysis on a paper. GATE PROTECTED.

    HTTP 423 Locked is returned if gate check fails.
    Anthropic API is called ONLY from here, ONLY after gate passes.
    AI output is written as a > [!ai] callout block in the note body.
    CERIC slots are NEVER written by this endpoint.
    """
    path = paper_path(payload.citekey)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Paper not found")

    # ── Gate check ─────────────────────────────────────────────────────────
    if GATE_CHECK:
        try:
            check_gate(path)
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

    # ── Load note ──────────────────────────────────────────────────────────
    post = frontmatter.load(str(path))
    fm = post.metadata

    # ── Fetch relevant context from vault ──────────────────────────────────
    vec = await embed(fm.get("claim", "") + " " + fm.get("adversarial_question", ""))
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

    # ── Build prompt ───────────────────────────────────────────────────────
    user_prompt = f"""You are reviewing a GRB astrophysics paper based on a researcher's active reading notes.

Paper: {fm.get('title', '')} ({fm.get('year', '')})
Authors: {', '.join(fm.get('authors', []))}
ArXiv: {fm.get('arxiv', '')}

CERIC Notes (written by the researcher):
- Claim: {fm.get('claim', '')}
- Evidence: {fm.get('evidence', '')}
- Reasoning: {fm.get('reasoning', '')}
- Implications: {fm.get('implications', '')}
- Context: {fm.get('context', '')}

Adversarial Question posed: {fm.get('adversarial_question', '')}

Relevant excerpts from the researcher's prior notes:
{context_str}

Your task:
1. Evaluate whether the CERIC slots are internally consistent.
2. Address the adversarial question directly — steelman the best counter-argument.
3. Identify 2-3 concepts in the researcher's existing notes that connect to this paper.
4. Suggest 1-2 follow-up questions for the 30-Questions vault.
5. Be concise and precise — this is a physics researcher, not a general audience.

Do NOT summarize the paper. Do NOT restate the CERIC slots. Add value beyond what the researcher wrote."""

    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=60.0,
        )
        resp.raise_for_status()
        ai_text = resp.json()["content"][0]["text"]

    # ── Append AI callout to note body (NEVER writes CERIC slots) ─────────
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    callout = f"\n\n> [!ai] AI · /examine · {ts}\n"
    for line in ai_text.splitlines():
        callout += f"> {line}\n"

    post.content = (post.content or "") + callout
    path.write_text(frontmatter.dumps(post))

    return {"ok": True, "response": ai_text}


# ── Graph ─────────────────────────────────────────────────────────────────────

@app.get("/api/graph")
async def graph():
    """Return nodes and edges derived from [[wikilinks]] across all .md files."""
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    wikilink_re = re.compile(r"\[\[([^\]|#]+)(?:[|\#][^\]]*)?\]\]")

    all_md = list(VAULT.rglob("*.md"))
    for md in all_md:
        stem = md.stem
        folder = md.parent.name
        nodes[stem] = {"id": stem, "label": stem, "folder": folder, "path": str(md.relative_to(VAULT))}

    for md in all_md:
        src = md.stem
        text = md.read_text(errors="replace")
        for m in wikilink_re.finditer(text):
            target = m.group(1).strip()
            if target and target != src:
                if target not in nodes:
                    nodes[target] = {"id": target, "label": target, "folder": "external", "path": ""}
                edges.append({"source": src, "target": target})

    return {"nodes": list(nodes.values()), "edges": edges}


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
        arxiv_id = arxiv_url.rsplit("/", 1)[-1] if arxiv_url else ""
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


async def _fetch_arxiv(params: dict) -> tuple[list[dict], int]:
    """
    arXiv's public API rate-limits aggressively (429) if hit more than ~1x/3s.
    Retry with backoff before giving up, since a single 429 shouldn't surface
    as "no results" to the user.
    """
    last_exc: Exception | None = None
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for attempt in range(2):
            try:
                resp = await client.get("https://export.arxiv.org/api/query", params=params, timeout=12.0)
                if resp.status_code == 429:
                    last_exc = httpx.HTTPStatusError("429", request=resp.request, response=resp)
                    if attempt == 0:
                        await asyncio.sleep(3.0)
                    continue
                resp.raise_for_status()
                return _parse_arxiv_atom(resp.text)
            except httpx.HTTPStatusError as e:
                last_exc = e
                if getattr(e.response, "status_code", None) != 429:
                    break
            except httpx.HTTPError as e:
                last_exc = e
                if attempt == 0:
                    await asyncio.sleep(2.0)
    raise HTTPException(status_code=503, detail="arXiv is rate-limiting requests right now — wait ~30s and try again.") from last_exc


_DAILY_CACHE: dict[int, tuple[float, list[dict]]] = {}
_DAILY_CACHE_TTL = 180.0


@app.get("/api/arxiv/daily")
async def arxiv_daily(max: int = 200):
    """Latest astro-ph.HE papers straight from the public arXiv API — no key needed."""
    max_results = min(max, 2000)
    cached = _DAILY_CACHE.get(max_results)
    if cached and (time.time() - cached[0]) < _DAILY_CACHE_TTL:
        return cached[1]
    papers, _total = await _fetch_arxiv(
        {
            "search_query": "cat:astro-ph.HE",
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "max_results": max_results,
        }
    )
    _DAILY_CACHE[max_results] = (time.time(), papers)
    return papers


ARXIV_ID_RE = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")

ARXIV_FIELD_PREFIX = {"author": "au", "title": "ti", "all": "all"}


@app.get("/api/arxiv/search")
async def arxiv_search(q: str, field: str = "all", start: int = 0, max_results: int = 50):
    """
    Field-targeted, paginated arXiv search.

    `field` picks the arXiv query prefix — "author" (au:) and "title" (ti:) are
    exact-field matches, so searching "Bin-Bin Zhang" as an author returns EVERY
    paper by that author (paginated via `start`/`max_results`), not just whatever
    a fuzzy `all:` full-text match happens to rank in the first 50 hits.

    A bare arXiv ID or an arxiv.org URL is still resolved as an exact id_list
    lookup regardless of `field` (used by "add by arXiv ID or link" flows).
    """
    q = q.strip()
    m = ARXIV_ID_RE.search(q)
    if field == "id" or (m and (ARXIV_ID_RE.fullmatch(q) or "arxiv.org" in q)):
        if not m:
            raise HTTPException(status_code=400, detail=f'"{q}" doesn\'t look like an arXiv ID or URL (expected e.g. 2401.12345)')
        papers, total = await _fetch_arxiv({"id_list": m.group(0), "max_results": 1})
        return {"papers": papers, "total": total, "start": 0}

    prefix = ARXIV_FIELD_PREFIX.get(field, "all")
    search_query = f'{prefix}:"{q}"' if prefix != "all" else f"all:{q}"
    max_results = max(1, min(max_results, 200))

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
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.request(method, f"{LATEX_URL}{path}", json=json, timeout=timeout)
    except httpx.RequestError:
        raise HTTPException(status_code=503, detail="LaTeX service unavailable")

    try:
        payload = resp.json()
    except Exception:
        payload = {"detail": resp.text or f"Unexpected LaTeX service response ({resp.status_code})"}

    return JSONResponse(status_code=resp.status_code, content=payload)


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


@app.get("/api/latex/files/{filename:path}")
async def latex_get_file(filename: str):
    return await _proxy_latex("GET", f"/files/{filename}")


@app.delete("/api/latex/files/{filename:path}")
async def latex_delete_file(filename: str):
    return await _proxy_latex("DELETE", f"/files/{filename}")


# ── Scores ────────────────────────────────────────────────────────────────────

def compute_scores_for_day(target_date: date) -> dict:
    """Compute scoring points for a given day."""
    date_str = target_date.strftime("%Y-%m-%d")
    points = 0
    detail = []

    papers = []
    for p in (VAULT / "10-Papers").glob("*.md"):
        post = frontmatter.load(str(p))
        fm = post.metadata
        if fm.get("read") == date_str:
            papers.append((p.stem, fm))

    triage_count = 0
    for citekey, fm in papers:
        verdict = fm.get("verdict", "")
        tier = fm.get("tier", 0)

        # Triage: 1pt each, cap 10/day
        if verdict in ("read", "skip", "later") and triage_count < 10:
            points += 1
            triage_count += 1
            detail.append({"action": "triage", "citekey": citekey, "pts": 1})

        # T1 full CERIC: 5pt
        if tier == 1:
            slots_ok = all(fm.get(s, "").strip() for s in ["claim", "evidence", "reasoning", "implications", "context"])
            if slots_ok:
                points += 5
                detail.append({"action": "t1_complete", "citekey": citekey, "pts": 5})

        # AQ written: 2pt
        if fm.get("aq_written"):
            points += 2
            detail.append({"action": "aq_written", "citekey": citekey, "pts": 2})

    # Concept note updated today
    for p in (VAULT / "20-Concepts").glob("*.md"):
        post = frontmatter.load(str(p))
        if post.metadata.get("updated") == date_str:
            points += 4
            detail.append({"action": "concept_updated", "note": p.stem, "pts": 4})

    # Synthesis written today (cap 1)
    synth_written = False
    for p in (VAULT / "50-Syntheses").glob("*.md"):
        post = frontmatter.load(str(p))
        if post.metadata.get("created") == date_str and not synth_written:
            points += 10
            detail.append({"action": "weekly_synthesis", "note": p.stem, "pts": 10})
            synth_written = True

    return {"date": date_str, "points": points, "detail": detail}


@app.get("/api/scores/today")
async def scores_today():
    return compute_scores_for_day(date.today())


@app.get("/api/scores/week")
async def scores_week():
    today = date.today()
    days = [compute_scores_for_day(today - timedelta(days=i)) for i in range(6, -1, -1)]
    total = sum(d["points"] for d in days)
    return {"days": days, "week_total": total, "week_target": 55}


# ── System Info & Settings ─────────────────────────────────────────────────────

@app.get("/api/info")
async def system_info():
    """Return system information (TeX version, vault path, mounted directories, disk usage)."""
    import shutil
    import subprocess

    tex_version = ""
    try:
        result = subprocess.run(["pdflatex", "--version"], capture_output=True, text=True, timeout=5)
        if result.stdout:
            tex_version = result.stdout.split("\n")[0]
    except Exception:
        pass

    disk_stat = shutil.disk_usage(VAULT)

    available_paths = []
    if VAULT.exists():
        for p in sorted(VAULT.rglob("*")):
            if p.is_dir() and not p.name.startswith("."):
                available_paths.append(str(p))

    return {
        "texVersion": tex_version,
        "vaultPath": str(VAULT),
        "diskFree": disk_stat.free,
        "availablePaths": available_paths,
    }


class SettingsPayload(BaseModel):
    latexDir: Optional[str] = None
    userAccount: Optional[str] = None


@app.post("/api/settings")
async def update_settings(payload: SettingsPayload):
    """Update user settings (currently just stores them; could persist to config file)."""
    # In a production system, you'd write these to a config file or database
    # For now, we just acknowledge the request
    return {"ok": True, "message": "Settings received (not persisted yet)"}


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
_WEBDAV_SKIP_DIRS = {".git", ".ygg-config"}


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


# ── Serve React frontend ──────────────────────────────────────────────────────

FRONTEND_DIST = Path("/app/frontend/dist")
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
