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
  POST /api/locate
  POST /api/ask
  POST /api/examine          ← GATE PROTECTED; AI call (provider from request, not stored)
  GET  /api/habits/range
  GET  /api/habits/{date}
  POST /api/habits/{date}
  GET  /api/tasks
  POST /api/tasks
  GET  /api/tasks/{id}
  PUT  /api/tasks/{id}
  DELETE /api/tasks/{id}
  GET  /api/graph
  GET  /api/zotero/search
  POST /api/zotero/ensure/{arxiv_id}
  POST /api/zotero/add-paper
  GET  /api/arxiv/daily
  GET  /api/arxiv/search
  GET  /api/scores/today
  GET  /api/scores/week
  GET  /api/scores/range
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
FEYNMAN_URL = os.environ.get("FEYNMAN_URL", "http://feynman:6174").rstrip("/")
FEYNMAN_HOST_PORT = os.environ.get("FEYNMAN_HOST_PORT", "6174")
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

    if provider in ("ollama", "lmstudio"):
        url = (base_url or OLLAMA_URL).rstrip("/")
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
                    headers={"Authorization": f"Bearer {api_key or 'lm-studio'}"},
                    json={
                        "model": gen_model,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    timeout=90.0,
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]
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
    url = (base_url or default_base).rstrip("/")
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
            },
            timeout=90.0,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


@app.post("/api/ask")
async def ask(payload: AskQuery):
    """
    Search user's notes via LanceDB and generate an answer.
    Provider/API key come from the request (browser localStorage) — never stored server-side.
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

    try:
        answer = await _llm_generate(prompt, payload.provider)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}") from e

    sources = [{"citekey": r["citekey"], "excerpt": r["chunk"][:200]} for r in results]
    return {"answer": answer, "sources": sources}


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

    post = frontmatter.load(str(path))
    fm = post.metadata

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
async def arxiv_search(q: str, field: str = "all", start: int = 0, max_results: int = 50):
    """
    Field-targeted, paginated arXiv search.

    `field` picks the arXiv query prefix — "author" (au:) and "title" (ti:) are
    exact-field matches, so searching "Bin-Bin Zhang" as an author returns EVERY
    paper by that author (paginated via `start`/`max_results`), not just whatever
    a fuzzy `all:` full-text match happens to rank in the first 50 hits.

    A bare arXiv ID or an arxiv.org URL is still resolved as an exact id_list
    lookup regardless of `field` (used by "add by arXiv ID or link" flows).
    Accepts both post-2007 IDs (2401.12345) and old-style archive IDs
    (physics/0306138, hep-th/9901001).
    """
    q = q.strip()
    m = ARXIV_ID_RE.search(q)
    if field == "id" or (m and (ARXIV_ID_RE.fullmatch(q) or "arxiv.org" in q)):
        if not m:
            raise HTTPException(
                status_code=400,
                detail=f'"{q}" doesn\'t look like an arXiv ID or URL '
                       f"(expected e.g. 2401.12345 or physics/0306138)",
            )
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


# ── Tasks (80-Tasks/{id}.md) ──────────────────────────────────────────────────

TASK_STATUS_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


def tasks_dir() -> Path:
    d = VAULT / "80-Tasks"
    d.mkdir(parents=True, exist_ok=True)
    return d


def task_path(task_id: str) -> Path:
    if not task_id or "/" in task_id or "\\" in task_id or ".." in task_id:
        raise HTTPException(status_code=400, detail="Invalid task id")
    return tasks_dir() / f"{task_id}.md"


def _task_from_post(task_id: str, post) -> dict:
    fm = dict(post.metadata)
    return {
        "id": task_id,
        "title": fm.get("title") or task_id,
        "status": fm.get("status") or "todo",
        "tags": fm.get("tags") if isinstance(fm.get("tags"), list) else [],
        "parent": fm.get("parent"),
        "due": fm.get("due") or "",
        "completed_date": fm.get("completed_date") or "",
        "recurring": bool(fm.get("recurring")),
        "body": post.content or "",
    }


def _maybe_reset_recurring(task: dict, post, path: Path) -> dict:
    """If recurring and completed on a previous local calendar day, reset to todo."""
    if not task.get("recurring") or task.get("status") != "done":
        return task
    completed = task.get("completed_date") or ""
    today = date.today().strftime("%Y-%m-%d")
    if completed and completed < today:
        post.metadata["status"] = "todo"
        post.metadata["completed_date"] = ""
        path.write_text(frontmatter.dumps(post))
        task["status"] = "todo"
        task["completed_date"] = ""
    return task


@app.get("/api/tasks")
async def list_tasks():
    out = []
    for p in sorted(tasks_dir().glob("*.md")):
        post = frontmatter.load(str(p))
        task = _task_from_post(p.stem, post)
        task = _maybe_reset_recurring(task, post, p)
        out.append(task)
    return {"tasks": out}


class TaskCreate(BaseModel):
    title: str
    status: str = "todo"
    tags: list[str] = []
    parent: Optional[str] = None
    due: Optional[str] = None
    recurring: bool = False
    body: Optional[str] = ""


@app.post("/api/tasks")
async def create_task(payload: TaskCreate):
    status = payload.status.strip().lower() if payload.status and TASK_STATUS_RE.fullmatch(payload.status.strip().lower()) else "todo"
    task_id = "t" + uuid.uuid4().hex[:12]
    path = task_path(task_id)
    post = frontmatter.Post(payload.body or "")
    post.metadata.update(
        {
            "title": payload.title.strip() or "Untitled",
            "status": status,
            "tags": payload.tags or [],
            "parent": payload.parent,
            "due": payload.due or "",
            "completed_date": date.today().strftime("%Y-%m-%d") if status == "done" else "",
            "recurring": bool(payload.recurring),
        }
    )
    path.write_text(frontmatter.dumps(post))
    return {"ok": True, "task": _task_from_post(task_id, post)}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    path = task_path(task_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    post = frontmatter.load(str(path))
    task = _maybe_reset_recurring(_task_from_post(task_id, post), post, path)
    return task


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[list[str]] = None
    parent: Optional[str] = None
    due: Optional[str] = None
    recurring: Optional[bool] = None
    body: Optional[str] = None
    completed_date: Optional[str] = None


@app.put("/api/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate):
    path = task_path(task_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    post = frontmatter.load(str(path))
    data = payload.model_dump(exclude_unset=True)
    if "status" in data:
        raw = (data["status"] or "").strip().lower()
        if not TASK_STATUS_RE.fullmatch(raw):
            raise HTTPException(status_code=400, detail=f"Invalid status: {data['status']}")
        data["status"] = raw
    if "status" in data:
        if data["status"] == "done" and not data.get("completed_date"):
            data["completed_date"] = date.today().strftime("%Y-%m-%d")
        if data["status"] != "done":
            data["completed_date"] = ""
    for k, v in data.items():
        if k == "body":
            post.content = v if v is not None else ""
        else:
            post.metadata[k] = v
    path.write_text(frontmatter.dumps(post))
    return {"ok": True, "task": _task_from_post(task_id, post)}


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    path = task_path(task_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Task not found")
    # Also clear parent pointers? Leave orphans as top-level by nulling parent refs.
    for p in tasks_dir().glob("*.md"):
        if p.stem == task_id:
            continue
        post = frontmatter.load(str(p))
        if post.metadata.get("parent") == task_id:
            post.metadata["parent"] = None
            p.write_text(frontmatter.dumps(post))
    path.unlink()
    return {"ok": True, "id": task_id}


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

    # Tasks completed today: 2 pts each, cap 15/day
    tasks_dir_path = VAULT / "80-Tasks"
    if tasks_dir_path.exists():
        task_pts = 0
        for p in tasks_dir_path.glob("*.md"):
            if task_pts >= 15:
                break
            post = frontmatter.load(str(p))
            fm = post.metadata
            if fm.get("status") == "done" and fm.get("completed_date") == date_str:
                points += 2
                task_pts += 2
                detail.append({"action": "task_done", "citekey": p.stem, "pts": 2})

    # Habits checked today: 1 pt each (dynamic keys)
    habit_file = VAULT / "60-Meta" / f"Daily-{date_str}.md"
    if habit_file.exists():
        post = frontmatter.load(str(habit_file))
        habits = post.metadata.get("habits") if isinstance(post.metadata.get("habits"), dict) else {}
        for key, val in habits.items():
            if val is True or val == 1:
                points += 1
                detail.append({"action": f"habit:{key}", "pts": 1})

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


@app.get("/api/scores/range")
async def scores_range(start: str, end: str):
    """Daily points from start..end inclusive — feeds the Dashboard lightcurve."""
    try:
        start_d = date.fromisoformat(start)
        end_d = date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")
    if end_d < start_d:
        raise HTTPException(status_code=400, detail="end must be >= start")
    if (end_d - start_d).days > 400:
        raise HTTPException(status_code=400, detail="range too large (max 400 days)")
    days = []
    cur = start_d
    while cur <= end_d:
        days.append(compute_scores_for_day(cur))
        cur += timedelta(days=1)
    return {"days": days}


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
        for slot in ["claim", "evidence", "reasoning", "implications", "context"]:
            val = str(fm.get(slot) or "").strip()
            if val:
                lines.append(f"**{slot.capitalize()}:** {val}")
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
    today = date.today()
    days = [compute_scores_for_day(today - timedelta(days=i)) for i in range(6, -1, -1)]
    total = sum(d["points"] for d in days)
    digest_md, count, start_str, end_str = _build_digest_markdown("week")
    lines = [
        f"*Yggdrasil weekly digest* — {start_str} to {end_str}",
        f"Score: {total} / 55 pts · {count} paper(s) completed this week",
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
        if md.parent.name == ".ygg-config":
            continue
        try:
            post = frontmatter.load(str(md))
        except Exception:
            continue
        fm = post.metadata
        haystack_parts = [
            str(fm.get("title", "")),
            " ".join(fm.get("tags") or []),
            " ".join(fm.get("authors") or []),
            str(fm.get("claim", "")),
            str(fm.get("evidence", "")),
            str(fm.get("reasoning", "")),
            str(fm.get("implications", "")),
            str(fm.get("context", "")),
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

FRONTEND_DIST = Path("/app/frontend/dist")
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
