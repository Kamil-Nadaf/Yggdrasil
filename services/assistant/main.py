"""
main.py — CERIC Reading System API (FastAPI)

Routes:
  GET  /api/brief/today
  GET  /api/papers
  GET  /api/papers/{citekey}
  PUT  /api/papers/{citekey}
  POST /api/papers/{citekey}/triage
  POST /api/locate
  POST /api/ask
  POST /api/examine          ← GATE PROTECTED; only Anthropic call
  GET  /api/graph
  GET  /api/zotero/search
  POST /api/zotero/ensure/{arxiv_id}
  GET  /api/scores/today
  GET  /api/scores/week

Static frontend served from /app/frontend/dist at /
"""

import os
import re
import glob
import json
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
from zotero import search_zotero, ensure_arxiv_in_zotero

# ── Config ────────────────────────────────────────────────────────────────────

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
GATE_CHECK = os.environ.get("GATE_CHECK", "true").lower() != "false"
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


# ── Serve React frontend ──────────────────────────────────────────────────────

FRONTEND_DIST = Path("/app/frontend/dist")
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
