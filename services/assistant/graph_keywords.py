"""
Notes-only keyword graph.

Scans the user's *notes* (papers, books, concepts, questions, synthesis,
projects, Notes workspace, inbox notes) -- never daily schedules, tasks,
briefs, LaTeX or templates -- extracts keywords, and derives:
  * keyword hub nodes   (id "kw:<term>", folder "keyword")
  * note -> keyword edges   (type "has_keyword")
  * note <-> note edges via shared keywords (type "shared_keyword")
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

import frontmatter

NOTE_TOP_FOLDERS = {
    "00-Inbox", "10-Papers", "15-Books", "20-Concepts",
    "30-Questions", "40-Synthesis", "50-Projects",
}
NOTES_WORKSPACE_REL = ("60-Meta", "Notes")
EXCLUDE_NAME_RE = re.compile(
    r"^(daily[-_ ]|mt[-_]|st[-_]|brief|template|readme|_)", re.IGNORECASE
)
EXPLICIT_FIELDS = ("keywords", "concepts", "methods", "objects", "instruments", "tags")
GRB_RE = re.compile(r"\bGRB[\s-]?(\d{6}[A-Z]?)\b", re.IGNORECASE)
WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-']{2,}")
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")
CODE_RE = re.compile(r"```.*?```|`[^`]*`|\$\$.*?\$\$|\$[^$\n]*\$", re.DOTALL)
URL_RE = re.compile(r"https?://\S+")

STOP = set("""
a about above after again against all also am an and any are as at be because been before being below between
both but by can could did do does doing down during each few for from further had has have having he her here
hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other
our out over own same she should so some such than that the their them then there these they this those through
to too under until up very was we were what when where which while who whom why will with would you your
paper papers note notes see using used use based shows show shown figure fig table et al however thus hence
therefore also within without among across via per whether one two three first second new many much may might
can't don't it's their theirs set sets case cases result results section data model models work works study
studies analysis method methods approach given implies imply implication implications claim evidence reasoning
context question questions todo tbd etc eq equation like since upon onto toward towards each every both either
neither whose whereas although though even still yet already often usually typically generally specifically
""".split())


def is_note_file(vault: Path, md: Path) -> bool:
    try:
        rel = md.relative_to(vault)
    except ValueError:
        return False
    if len(rel.parts) < 2:
        return False
    if EXCLUDE_NAME_RE.match(md.stem):
        return False
    top = rel.parts[0]
    if top in NOTE_TOP_FOLDERS:
        return True
    if rel.parts[:2] == NOTES_WORKSPACE_REL and len(rel.parts) > 2:
        return True
    return False


def node_for(vault: Path, md: Path) -> Optional[dict]:
    if not is_note_file(vault, md):
        return None
    rel = md.relative_to(vault)
    top = rel.parts[0]
    if top == "15-Books":
        slug = rel.parts[1] if len(rel.parts) > 2 else ""
        nid = f"{slug}/{md.stem}" if slug else md.stem
        return {"id": nid, "label": md.stem, "folder": "15-Books", "path": str(rel)}
    folder = "Notes" if rel.parts[:2] == NOTES_WORKSPACE_REL else top
    return {"id": md.stem, "label": md.stem, "folder": folder, "path": str(rel)}


def _norm(term: str) -> str:
    t = re.sub(r"\s+", " ", str(term).strip().lower().replace("_", " ").replace("-", " "))
    return t.strip("#.,;:()[]\"' ")


def _stem(w: str) -> str:
    if len(w) > 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def _list_field(fm: dict, key: str) -> list[str]:
    v = fm.get(key)
    if v is None:
        return []
    if isinstance(v, str):
        return [x for x in re.split(r"[,;]", v) if x.strip()]
    if isinstance(v, (list, tuple)):
        return [str(x) for x in v if str(x).strip()]
    return []


def _clean_text(text: str) -> str:
    text = CODE_RE.sub(" ", text)
    text = URL_RE.sub(" ", text)
    text = WIKILINK_RE.sub(lambda m: " " + m.group(1) + " ", text)
    return text


def _phrases(text: str) -> Counter:
    """Unigram + bigram counts over content words."""
    c: Counter = Counter()
    for sentence in re.split(r"[\n.;:!?()\[\]{}]+", text):
        words = [_stem(w.lower().strip("-'").replace("-", " ")) for w in WORD_RE.findall(sentence)]
        prev = None
        for w in words:
            if w in STOP or len(w) < 3:
                prev = None
                continue
            c[w] += 1
            if prev:
                c[f"{prev} {w}"] += 1
            prev = w
    return c


def extract_note_terms(fm: dict, body: str, slot_keys: list[str]) -> dict[str, Any]:
    explicit: list[str] = []
    for f in EXPLICIT_FIELDS:
        for item in _list_field(fm, f):
            t = _norm(item)
            if t and t not in STOP and len(t) >= 2:
                explicit.append(t)
    slot_text = " ".join(str(fm.get(k) or "") for k in slot_keys)
    title = str(fm.get("title") or "")
    full = _clean_text(f"{title}\n{slot_text}\n{body or ''}")
    entities = [f"grb {m.group(1).upper()}" for m in GRB_RE.finditer(full)]
    counts = _phrases(full)
    # slot text / title count extra: they are the researcher's own distilled words
    counts.update({k: v * 2 for k, v in _phrases(_clean_text(f"{title}\n{slot_text}")).items()})
    return {"explicit": list(dict.fromkeys(explicit)),
            "entities": list(dict.fromkeys(entities)),
            "counts": counts}


def build_keyword_graph(vault: Path, slot_keys: list[str], per_note: int = 12,
                        max_links_per_note: int = 8) -> dict[str, Any]:
    nodes: dict[str, dict] = {}
    terms: dict[str, dict] = {}
    texts: dict[str, str] = {}
    for md in sorted(vault.rglob("*.md")):
        node = node_for(vault, md)
        if not node or node["id"] in nodes:
            continue
        try:
            post = frontmatter.load(str(md))
        except Exception:
            continue
        nodes[node["id"]] = node
        texts[node["id"]] = post.content or ""
        terms[node["id"]] = extract_note_terms(dict(post.metadata), post.content or "", slot_keys)

    N = len(nodes)
    # document frequency over candidate phrases
    df: Counter = Counter()
    for t in terms.values():
        cand = set(t["explicit"]) | set(t["entities"]) | set(t["counts"].keys())
        df.update(cand)

    max_df = max(3, int(N * 0.6)) if N >= 5 else N

    def idf(term: str) -> float:
        return math.log((N + 1) / (df[term] + 0.5))

    note_kws: dict[str, list[tuple[str, float, bool]]] = {}
    for nid, t in terms.items():
        scored: dict[str, tuple[float, bool]] = {}
        for term in t["explicit"] + t["entities"]:
            if df[term] >= 2:
                scored[term] = (10.0 + idf(term), True)
        for term, tf in t["counts"].items():
            if term in scored or df[term] < 2 or df[term] > max_df:
                continue
            is_bi = " " in term
            if not is_bi and tf < 2:
                continue
            # bigrams that repeat are far more meaningful than lone words
            if is_bi and tf < 2 and df[term] < 2:
                continue
            w = (1 + math.log(tf)) * idf(term) * (1.6 if is_bi else 1.0)
            scored[term] = (w, False)
        top = sorted(scored.items(), key=lambda kv: -kv[1][0])[:per_note]
        # drop unigrams already covered by a kept bigram
        kept = [k for k, _ in top]
        bigram_words = {w for k in kept if " " in k for w in k.split()}
        note_kws[nid] = [(k, v[0], v[1]) for k, v in top
                         if " " in k or k not in bigram_words]

    kw_notes: dict[str, list[str]] = defaultdict(list)
    for nid, kws in note_kws.items():
        for k, _, _ in kws:
            kw_notes[k].append(nid)
    kw_notes = {k: v for k, v in kw_notes.items() if len(v) >= 2}

    edges: list[dict] = []
    kw_nodes: dict[str, dict] = {}
    for k, nlist in kw_notes.items():
        kid = f"kw:{k}"
        kw_nodes[kid] = {"id": kid, "label": k, "folder": "keyword", "path": "", "count": len(nlist)}
        for nid in nlist:
            edges.append({"source": nid, "target": kid, "type": "has_keyword",
                          "reason_text": f"note keyword “{k}”", "confidence_score": 1.0})

    # note <-> note via shared keywords
    pair: dict[tuple[str, str], list[tuple[str, float]]] = defaultdict(list)
    weight = {(nid, k): w for nid, kws in note_kws.items() for k, w, _ in kws}
    for k, nlist in kw_notes.items():
        for i in range(len(nlist)):
            for j in range(i + 1, len(nlist)):
                a, b = sorted((nlist[i], nlist[j]))
                pair[(a, b)].append((k, min(weight[(a, k)], weight[(b, k)])))
    cand: dict[str, list[tuple[float, str, str, list[str]]]] = defaultdict(list)
    for (a, b), shared in pair.items():
        score = sum(w for _, w in shared)
        top_terms = [k for k, _ in sorted(shared, key=lambda x: -x[1])[:5]]
        if len(shared) < 2 and score < 8:
            continue
        item_a = (score, a, b, top_terms)
        cand[a].append(item_a)
        cand[b].append(item_a)
    chosen: set[tuple[str, str]] = set()
    for nid, items in cand.items():
        for score, a, b, tt in sorted(items, key=lambda x: -x[0])[:max_links_per_note]:
            if (a, b) in chosen:
                continue
            chosen.add((a, b))
            edges.append({"source": a, "target": b, "type": "shared_keyword",
                          "reason_text": "shared keywords: " + ", ".join(tt),
                          "confidence_score": round(min(1.0, score / 30.0), 3)})

    return {"nodes": nodes, "keyword_nodes": kw_nodes, "edges": edges,
            "note_keywords": {n: [k for k, _, _ in v] for n, v in note_kws.items()}}


_CACHE: dict[str, Any] = {"sig": None, "val": None}


def cached_keyword_graph(vault: Path, slot_keys: list[str]) -> dict[str, Any]:
    sig_parts = []
    for md in vault.rglob("*.md"):
        if is_note_file(vault, md):
            try:
                st = md.stat()
                sig_parts.append((str(md), st.st_mtime_ns, st.st_size))
            except OSError:
                pass
    sig = (tuple(sorted(sig_parts)), tuple(slot_keys))
    if _CACHE["sig"] != sig:
        _CACHE["val"] = build_keyword_graph(vault, slot_keys)
        _CACHE["sig"] = sig
    return _CACHE["val"]
