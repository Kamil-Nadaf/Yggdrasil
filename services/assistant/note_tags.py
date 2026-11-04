"""
Auto-tagging for notes.

Pure-Python keyword extraction (no LLM, no network) built on the same
tokenizer the notes keyword graph uses, so tags suggested here line up with
the keyword hubs shown in the Graph view.
"""
from __future__ import annotations

import re

import frontmatter

from graph_keywords import GRB_RE, STOP, _clean_text, _phrases

HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$", re.MULTILINE)

# The shared tokenizer ignores 1-2 letter words instead of treating them as phrase
# breaks, so "uniqueness of free fall" would yield the bigram "uniqueness free".
# Turn those connectors into sentence breaks before tokenizing.
_SHORT_STOP_RE = re.compile(
    r"\b(?:of|is|in|to|as|at|by|on|or|an|be|if|it|no|so|up|we|do|he|me|my|us|am)\b",
    re.IGNORECASE,
)
# Generic verbs/nouns that are never useful as tags.
_EXTRA_STOP = {
    "state", "provide", "rest", "become", "conclude", "detect", "demonstrate",
    "elevate", "distinguish", "effect", "way", "foundation", "concept",
}


def normalize_tag(raw: str) -> str:
    """lowercase, spaces/underscores -> hyphens, strip '#' and punctuation."""
    t = str(raw).strip().lstrip("#").lower()
    t = re.sub(r"[\s_]+", "-", t)
    t = re.sub(r"[^a-z0-9\-]", "", t)
    return t.strip("-")[:40]


def suggest_tags(source: str, limit: int = 6) -> list[str]:
    try:
        post = frontmatter.loads(source)
        body, title = post.content or "", str(post.metadata.get("title") or "")
    except Exception:
        body, title = source or "", ""

    headings = " ".join(HEADING_RE.findall(body))
    def prep(t: str) -> str:
        return _SHORT_STOP_RE.sub(" . ", _clean_text(t))

    full = _clean_text(f"{title}\n{body}")
    counts = _phrases(prep(f"{title}\n{body}"))
    boost = _phrases(prep(f"{title}\n{headings}"))

    scored: dict[str, float] = {}
    for term, c in counts.items():
        b = boost.get(term, 0)
        if c < 2 and b == 0:
            continue  # a single stray mention is not a keyword
        score = c + 3 * b
        if " " in term:
            score *= 1.5  # prefer phrases ("equivalence principle") over bare words
        scored[term] = score

    picked: list[str] = []
    for term, _ in sorted(scored.items(), key=lambda kv: (-kv[1], kv[0])):
        words = set(term.split())
        if term in STOP or words & _EXTRA_STOP:
            continue
        # skip a word already covered by a chosen phrase, or a phrase that mostly repeats one
        if any(words <= set(p.split()) for p in picked):
            continue
        if " " in term and any(set(p.split()) <= words and " " not in p for p in picked):
            picked = [p for p in picked if not (" " not in p and set(p.split()) <= words)]
        picked.append(term)
        if len(picked) >= limit:
            break

    entities = [f"grb-{m.group(1).lower()}" for m in GRB_RE.finditer(full)]
    out: list[str] = []
    for t in [*dict.fromkeys(entities), *picked]:
        n = normalize_tag(t)
        if n and n not in out:
            out.append(n)
    return out[: max(limit, len(entities))]
