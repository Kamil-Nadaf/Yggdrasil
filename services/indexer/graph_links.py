"""
Typed vault graph edges — manual wikilinks + local semantic auto-links.

Never writes into note bodies. Edges live in LanceDB table `graph_edges`.
Embeddings and scoring run via Ollama locally.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import frontmatter
import httpx

EDGE_TYPES = (
    "manual_link",
    "shared_claim",
    "shared_method",
    "shared_citation",
    "shared_entity",
)

DEFAULT_SIMILARITY_THRESHOLD = 0.75

ARXIV_RE = re.compile(
    r"(?:arxiv\.org/(?:abs|pdf)/|arxiv:)?\s*"
    r"((?:\d{4}\.\d{4,5}(?:v\d+)?)|(?:[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?))",
    re.IGNORECASE,
)
GRB_RE = re.compile(r"\bGRB[\s-]?\d{6}[A-Z]?\b", re.IGNORECASE)
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")

EDGE_SCHEMA = None  # built lazily with pyarrow when opening the table


def _edge_schema():
    import pyarrow as pa

    return pa.schema(
        [
            pa.field("id", pa.utf8()),
            pa.field("source_note", pa.utf8()),
            pa.field("target_note", pa.utf8()),
            pa.field("type", pa.utf8()),
            pa.field("reason_text", pa.utf8()),
            pa.field("confidence_score", pa.float32()),
            pa.field("created_at", pa.utf8()),
        ]
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def edge_id(source: str, target: str, edge_type: str) -> str:
    a, b = sorted((source, target))
    return f"{a}::{b}::{edge_type}"


def normalize_term(raw: str) -> str:
    return re.sub(r"\s+", " ", str(raw).strip().strip("[]")).lower()


def _list_field(fm: dict, key: str) -> list[str]:
    val = fm.get(key) or []
    if isinstance(val, str):
        val = [val]
    return [str(x).strip() for x in val if str(x).strip()]


def extract_note_features(
    citekey: str,
    fm: dict,
    body: str = "",
    *,
    analysis_keys: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Pull claim/methods/entities/citations from frontmatter + body regex."""
    keys = analysis_keys or ["claim", "evidence", "reasoning", "implications", "context"]
    claim_key = keys[0] if keys else "claim"
    claims = []
    claim_val = str(fm.get(claim_key) or "").strip()
    if claim_val:
        claims.append(claim_val)

    methods = [normalize_term(x) for x in _list_field(fm, "methods")]
    entities: list[str] = []
    for field in ("objects", "instruments", "concepts", "tags"):
        for item in _list_field(fm, field):
            entities.append(normalize_term(item))

    text = f"{body}\n" + " ".join(str(fm.get(k) or "") for k in keys)
    citations: list[str] = []
    arxiv = str(fm.get("arxiv") or "").strip()
    if arxiv:
        citations.append(arxiv.split("v")[0].lower())
    for m in ARXIV_RE.finditer(text):
        citations.append(m.group(1).split("v")[0].lower())
    for m in GRB_RE.finditer(text):
        entities.append(normalize_term(m.group(0)))

    # Deduplicate preserving order
    def uniq(items: Iterable[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for x in items:
            if not x or x in seen:
                continue
            seen.add(x)
            out.append(x)
        return out

    return {
        "citekey": citekey,
        "claims": uniq(claims),
        "methods": uniq(methods),
        "entities": uniq(entities),
        "citations": uniq(citations),
        "title": str(fm.get("title") or citekey),
    }


def parse_wikilinks(text: str) -> list[str]:
    return [m.group(1).strip() for m in WIKILINK_RE.finditer(text or "") if m.group(1).strip()]


def overlap_edges(
    source: dict[str, Any],
    target: dict[str, Any],
    *,
    similarity: Optional[float] = None,
    threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
) -> list[dict[str, Any]]:
    """Build typed suggestion edges when overlap exists (and optional sim gate)."""
    if source["citekey"] == target["citekey"]:
        return []
    if similarity is not None and similarity < threshold:
        # Still allow hard overlaps below threshold? Spec: threshold + overlap.
        # Require BOTH: similarity gate AND at least one shared field.
        return []

    edges: list[dict[str, Any]] = []
    src, tgt = source["citekey"], target["citekey"]
    conf = float(similarity) if similarity is not None else 0.85

    shared_methods = set(source["methods"]) & set(target["methods"])
    for m in sorted(shared_methods):
        edges.append(
            {
                "source_note": src,
                "target_note": tgt,
                "type": "shared_method",
                "reason_text": f"shares method: {m}",
                "confidence_score": min(0.99, conf + 0.05),
            }
        )

    shared_cites = set(source["citations"]) & set(target["citations"])
    for c in sorted(shared_cites):
        edges.append(
            {
                "source_note": src,
                "target_note": tgt,
                "type": "shared_citation",
                "reason_text": f"cites same arXiv/id: {c}",
                "confidence_score": min(0.99, conf + 0.08),
            }
        )

    shared_ents = set(source["entities"]) & set(target["entities"])
    for e in sorted(shared_ents):
        label = e.upper() if e.lower().startswith("grb") else e
        edges.append(
            {
                "source_note": src,
                "target_note": tgt,
                "type": "shared_entity",
                "reason_text": f"shares entity: {label}",
                "confidence_score": min(0.99, conf),
            }
        )

    # Shared claim: only when both have claim text and high similarity
    if source["claims"] and target["claims"] and similarity is not None and similarity >= threshold:
        edges.append(
            {
                "source_note": src,
                "target_note": tgt,
                "type": "shared_claim",
                "reason_text": "similar claim content",
                "confidence_score": float(similarity),
            }
        )

    return edges


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return float(dot / (na * nb))


def get_edges_table(db_path: str):
    import lancedb

    db = lancedb.connect(db_path)
    try:
        return db.open_table("graph_edges")
    except Exception:
        return db.create_table("graph_edges", schema=_edge_schema())


def delete_auto_edges_for(table, citekey: str) -> None:
    """Remove non-manual edges involving citekey so they can be recomputed."""
    try:
        table.delete(
            f"(source_note = '{citekey}' OR target_note = '{citekey}') AND type != 'manual_link'"
        )
    except Exception:
        pass


def delete_manual_edges_for(table, citekey: str) -> None:
    try:
        table.delete(
            f"(source_note = '{citekey}' OR target_note = '{citekey}') AND type = 'manual_link'"
        )
    except Exception:
        pass


def upsert_edges(table, edges: list[dict[str, Any]], *, created_at: Optional[str] = None) -> int:
    if not edges:
        return 0
    ts = created_at or utc_now()
    rows = []
    for e in edges:
        src, tgt = e["source_note"], e["target_note"]
        rows.append(
            {
                "id": edge_id(src, tgt, e["type"]),
                "source_note": src,
                "target_note": tgt,
                "type": e["type"],
                "reason_text": e["reason_text"],
                "confidence_score": float(e["confidence_score"]),
                "created_at": ts,
            }
        )
    # Delete colliding ids then add
    for row in rows:
        try:
            table.delete(f"id = '{row['id']}'")
        except Exception:
            pass
    table.add(rows)
    return len(rows)


def manual_edges_from_wikilinks(citekey: str, text: str) -> list[dict[str, Any]]:
    edges = []
    for target in parse_wikilinks(text):
        if target == citekey:
            continue
        edges.append(
            {
                "source_note": citekey,
                "target_note": target,
                "type": "manual_link",
                "reason_text": f"manual [[wikilink]] → {target}",
                "confidence_score": 1.0,
            }
        )
    return edges


def neighbors_from_rows(
    rows: list[dict[str, Any]],
    note_or_topic: str,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Rank connected notes for Loki. Includes reason_text."""
    needle = note_or_topic.strip().lower()
    hits: list[dict[str, Any]] = []
    for row in rows:
        src = str(row.get("source_note") or "")
        tgt = str(row.get("target_note") or "")
        reason = str(row.get("reason_text") or "")
        etype = str(row.get("type") or "")
        conf = float(row.get("confidence_score") or 0)
        other = None
        if src.lower() == needle:
            other = tgt
        elif tgt.lower() == needle:
            other = src
        elif needle and (needle in reason.lower() or needle in src.lower() or needle in tgt.lower()):
            other = tgt if needle in src.lower() or needle in reason.lower() else src
        if not other:
            continue
        hits.append(
            {
                "note": other,
                "type": etype,
                "reason_text": reason,
                "confidence_score": conf,
                "created_at": row.get("created_at"),
            }
        )
    hits.sort(key=lambda h: (-h["confidence_score"], h["note"]))
    # Deduplicate by note keeping highest confidence
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for h in hits:
        if h["note"] in seen:
            continue
        seen.add(h["note"])
        out.append(h)
        if len(out) >= limit:
            break
    return out


async def embed_text(ollama_url: str, model: str, text: str) -> list[float]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ollama_url.rstrip('/')}/api/embeddings",
            json={"model": model, "prompt": text[:4000]},
            timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


def load_features_from_vault(
    vault: Path,
    *,
    analysis_keys: Optional[list[str]] = None,
) -> dict[str, dict[str, Any]]:
    """Map citekey → features for papers + book sections."""
    out: dict[str, dict[str, Any]] = {}
    papers = vault / "10-Papers"
    if papers.is_dir():
        for p in papers.glob("*.md"):
            try:
                post = frontmatter.load(str(p))
            except Exception:
                continue
            ck = post.metadata.get("citekey") or p.stem
            text = (post.content or "") + "\n" + " ".join(
                str(post.metadata.get(k) or "") for k in (analysis_keys or [])
            )
            out[str(ck)] = extract_note_features(
                str(ck), dict(post.metadata), post.content or "", analysis_keys=analysis_keys
            )
            out[str(ck)]["_wikilink_text"] = text + "\n" + (post.content or "")

    books = vault / "15-Books"
    if books.is_dir():
        for p in books.rglob("*.md"):
            if p.name.startswith("_"):
                continue
            try:
                post = frontmatter.load(str(p))
            except Exception:
                continue
            fm = dict(post.metadata)
            slug = fm.get("book") or p.parent.name
            ck = f"{slug}/{p.stem}"
            out[ck] = extract_note_features(ck, fm, post.content or "", analysis_keys=analysis_keys)
            out[ck]["_wikilink_text"] = post.content or ""
    return out
