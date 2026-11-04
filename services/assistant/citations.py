"""citations.py — reference-manager helpers for the Collection library (stdlib only).

Item dicts use these keys (all optional except title):
  title, authors[list of "Given Family" or "Family, Given"], year, venue, doi, arxiv, url,
  publisher, volume, issue, pages, abstract, item_type, citekey, tags[]

item_type: article | preprint | book | chapter | conference | thesis | report | webpage
"""
from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Optional

ITEM_TYPES = ("article", "preprint", "book", "chapter", "conference", "thesis", "report", "webpage")
STYLES = ("bibtex", "apa", "ieee", "harvard", "chicago", "mla", "ris", "csljson")
_PARTICLES = {"van", "von", "de", "der", "den", "di", "da", "del", "della", "la", "le", "du", "bin", "al", "ter", "ten"}


# ── Names ─────────────────────────────────────────────────────────────────────

def parse_name(name: str) -> tuple[str, str]:
    """(family, given) from "Family, Given" or "Given Family"."""
    name = re.sub(r"\s+", " ", (name or "").strip())
    if not name:
        return "", ""
    if "," in name:
        fam, _, giv = name.partition(",")
        return fam.strip(), giv.strip()
    parts = name.split(" ")
    if len(parts) == 1:
        return parts[0], ""
    i = len(parts) - 1
    while i > 1 and parts[i - 1].lower() in _PARTICLES:
        i -= 1
    return " ".join(parts[i:]), " ".join(parts[:i])


def initials(given: str, dots: bool = True) -> str:
    out = []
    for tok in re.split(r"[\s]+", given.strip()):
        if not tok:
            continue
        for sub in tok.split("-"):
            if sub:
                out.append(sub[0].upper() + ("." if dots else ""))
    return " ".join(out)


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def make_citekey(item: dict[str, Any]) -> str:
    authors = item.get("authors") or []
    fam = parse_name(authors[0])[0] if authors else ""
    fam = re.sub(r"[^a-z0-9]", "", _ascii(fam).lower()) or "anon"
    year = str(item.get("year") or "")[:4]
    stop = {"a", "an", "the", "on", "of", "for", "and", "in", "to", "with"}
    word = next((w for w in re.findall(r"[a-z0-9]+", _ascii(item.get("title") or "").lower()) if w not in stop), "")
    return f"{fam}{year}{word}"


def citekey_of(item: dict[str, Any]) -> str:
    return (item.get("citekey") or "").strip() or make_citekey(item)


def _kind(item: dict[str, Any]) -> str:
    t = item.get("item_type")
    if t in ITEM_TYPES:
        return t
    if item.get("kind") == "book":
        return "book"
    if item.get("arxiv") and not item.get("venue"):
        return "preprint"
    return "article"


def _venue(item: dict[str, Any]) -> str:
    v = (item.get("venue") or "").strip()
    if v:
        return v
    if _kind(item) == "preprint" and item.get("arxiv"):
        return f"arXiv preprint arXiv:{item['arxiv']}"
    return ""


def _doi_url(item: dict[str, Any]) -> str:
    if item.get("doi"):
        return f"https://doi.org/{item['doi']}"
    if item.get("url"):
        return item["url"]
    if item.get("arxiv"):
        return f"https://arxiv.org/abs/{item['arxiv']}"
    return ""


# ── BibTeX ────────────────────────────────────────────────────────────────────

_BIB_TYPES = {"article": "article", "preprint": "misc", "book": "book", "chapter": "incollection",
              "conference": "inproceedings", "thesis": "phdthesis", "report": "techreport", "webpage": "misc"}


def _bib_escape(v: str) -> str:
    return v.replace("{", "").replace("}", "")


def to_bibtex(item: dict[str, Any]) -> str:
    kind = _kind(item)
    fields: list[tuple[str, str]] = []
    authors = item.get("authors") or []
    if authors:
        names = []
        for a in authors:
            fam, giv = parse_name(a)
            names.append(f"{fam}, {giv}" if giv else fam)
        fields.append(("author", " and ".join(names)))
    fields.append(("title", "{" + _bib_escape(item.get("title") or "") + "}"))
    venue = (item.get("venue") or "").strip()
    if venue:
        key = {"article": "journal", "conference": "booktitle", "chapter": "booktitle", "thesis": "school", "report": "institution"}.get(kind, "howpublished")
        fields.append((key, venue))
    for src, dst in (("year", "year"), ("volume", "volume"), ("issue", "number"), ("pages", "pages"), ("publisher", "publisher"), ("doi", "doi"), ("url", "url")):
        if item.get(src):
            fields.append((dst, str(item[src])))
    if item.get("arxiv"):
        fields.append(("eprint", item["arxiv"]))
        fields.append(("archiveprefix", "arXiv"))
    if item.get("tags"):
        fields.append(("keywords", ", ".join(item["tags"])))
    if item.get("abstract"):
        fields.append(("abstract", item["abstract"].replace("\n", " ")))
    body = ",\n".join(f"  {k} = {{{v}}}" if k != "title" else f"  {k} = {v}" for k, v in fields)
    return f"@{_BIB_TYPES[kind]}{{{citekey_of(item)},\n{body}\n}}"


def _balanced(text: str, i: int, open_c: str, close_c: str) -> tuple[str, int]:
    depth = 0
    j = i
    while j < len(text):
        c = text[j]
        if c == "\\":
            j += 2
            continue
        if c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return text[i + 1:j], j + 1
        j += 1
    return text[i + 1:], len(text)


def _clean_tex(s: str) -> str:
    s = re.sub(r"\\[`'^\"~=.]\{?(\w)\}?", r"\1", s)
    s = re.sub(r"\\(?:textit|textbf|emph|mathrm)\{([^}]*)\}", r"\1", s)
    s = s.replace("\\&", "&").replace("\\%", "%").replace("\\_", "_").replace("---", "—").replace("--", "–")
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", s).strip()


def parse_bibtex(text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in re.finditer(r"@(\w+)\s*([{(])", text):
        etype = m.group(1).lower()
        if etype in {"comment", "string", "preamble"}:
            continue
        open_c = m.group(2)
        body, _ = _balanced(text, m.end() - 1, open_c, "}" if open_c == "{" else ")")
        key, _, rest = body.partition(",")
        fields: dict[str, str] = {}
        i = 0
        while i < len(rest):
            fm = re.compile(r"\s*([A-Za-z][\w\-]*)\s*=\s*").match(rest, i)
            if not fm:
                i += 1
                continue
            name = fm.group(1).lower()
            i = fm.end()
            parts: list[str] = []
            while i < len(rest):
                while i < len(rest) and rest[i] in " \t\r\n":
                    i += 1
                if i >= len(rest):
                    break
                c = rest[i]
                if c == "{":
                    val, i = _balanced(rest, i, "{", "}")
                elif c == '"':
                    j = i + 1
                    while j < len(rest) and not (rest[j] == '"' and rest[j - 1] != "\\"):
                        j += 1
                    val, i = rest[i + 1:j], j + 1
                else:
                    bm = re.compile(r"[\w.\-:/]+").match(rest, i)
                    val = bm.group(0) if bm else ""
                    i = bm.end() if bm else i + 1
                parts.append(val)
                while i < len(rest) and rest[i] in " \t\r\n":
                    i += 1
                if i < len(rest) and rest[i] == "#":
                    i += 1
                    continue
                break
            fields[name] = "".join(parts)
            while i < len(rest) and rest[i] in ", \t\r\n":
                i += 1
        item: dict[str, Any] = {"citekey": key.strip(), "title": _clean_tex(fields.get("title", ""))}
        if fields.get("author"):
            item["authors"] = [_clean_tex(a) for a in re.split(r"\s+and\s+", fields["author"]) if a.strip()]
        ym = re.search(r"(1[5-9]\d\d|20\d\d)", fields.get("year", "") or fields.get("date", ""))
        if ym:
            item["year"] = int(ym.group(1))
        for k in ("journal", "journaltitle", "booktitle", "school", "institution", "howpublished"):
            if fields.get(k):
                item["venue"] = _clean_tex(fields[k])
                break
        for src, dst in (("doi", "doi"), ("url", "url"), ("publisher", "publisher"), ("volume", "volume"), ("number", "issue"), ("pages", "pages"), ("abstract", "abstract")):
            if fields.get(src):
                item[dst] = _clean_tex(fields[src]).replace("–", "-") if dst == "pages" else _clean_tex(fields[src])
        if fields.get("eprint") and (fields.get("archiveprefix", "").lower() == "arxiv" or re.match(r"^\d{4}\.\d{4,5}|^[a-z\-]+/\d{7}", fields["eprint"])):
            item["arxiv"] = fields["eprint"].strip()
        if fields.get("keywords"):
            item["tags"] = [t.strip() for t in re.split(r"[,;]", fields["keywords"]) if t.strip()]
        rev = {"article": "article", "book": "book", "incollection": "chapter", "inbook": "chapter", "inproceedings": "conference",
               "conference": "conference", "phdthesis": "thesis", "mastersthesis": "thesis", "techreport": "report", "misc": "webpage", "online": "webpage"}
        item["item_type"] = "preprint" if item.get("arxiv") and etype in {"misc", "article", "online"} and not item.get("doi") else rev.get(etype, "article")
        if item["title"]:
            out.append(item)
    return out


# ── RIS ───────────────────────────────────────────────────────────────────────

_RIS_TY = {"article": "JOUR", "preprint": "UNPB", "book": "BOOK", "chapter": "CHAP", "conference": "CONF", "thesis": "THES", "report": "RPRT", "webpage": "ELEC"}


def to_ris(item: dict[str, Any]) -> str:
    lines = [f"TY  - {_RIS_TY[_kind(item)]}"]
    for a in item.get("authors") or []:
        fam, giv = parse_name(a)
        lines.append(f"AU  - {fam}, {giv}" if giv else f"AU  - {fam}")
    lines.append(f"TI  - {item.get('title') or ''}")
    if item.get("year"):
        lines.append(f"PY  - {item['year']}")
    if item.get("venue"):
        lines.append(f"JO  - {item['venue']}")
    for tag, key in (("VL", "volume"), ("IS", "issue"), ("PB", "publisher"), ("DO", "doi"), ("UR", "url"), ("AB", "abstract")):
        if item.get(key):
            lines.append(f"{tag}  - {item[key]}")
    if item.get("pages"):
        a, _, b = str(item["pages"]).replace("--", "-").partition("-")
        lines.append(f"SP  - {a}")
        if b:
            lines.append(f"EP  - {b}")
    if item.get("arxiv"):
        lines.append(f"N1  - arXiv:{item['arxiv']}")
    for t in item.get("tags") or []:
        lines.append(f"KW  - {t}")
    lines.append("ER  - ")
    return "\n".join(lines)


def parse_ris(text: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cur: dict[str, Any] = {}
    rev = {v: k for k, v in _RIS_TY.items()}
    sp = ep = ""
    for raw in text.splitlines():
        m = re.match(r"^([A-Z][A-Z0-9])\s{2}-\s?(.*)$", raw)
        if not m:
            continue
        tag, val = m.group(1), m.group(2).strip()
        if tag == "TY":
            cur, sp, ep = {"item_type": rev.get(val, "article")}, "", ""
        elif tag == "ER":
            if sp:
                cur["pages"] = f"{sp}-{ep}" if ep else sp
            if cur.get("title"):
                items.append(cur)
            cur = {}
        elif tag == "AU" or tag == "A1":
            cur.setdefault("authors", []).append(val)
        elif tag in ("TI", "T1"):
            cur["title"] = val
        elif tag in ("PY", "Y1", "DA"):
            ym = re.search(r"\d{4}", val)
            if ym:
                cur["year"] = int(ym.group(0))
        elif tag in ("JO", "JF", "T2", "JA"):
            cur.setdefault("venue", val)
        elif tag == "DO":
            cur["doi"] = val
        elif tag == "UR":
            cur["url"] = val
        elif tag == "AB" or tag == "N2":
            cur["abstract"] = val
        elif tag == "VL":
            cur["volume"] = val
        elif tag == "IS":
            cur["issue"] = val
        elif tag == "PB":
            cur["publisher"] = val
        elif tag == "SP":
            sp = val
        elif tag == "EP":
            ep = val
        elif tag == "KW":
            cur.setdefault("tags", []).append(val)
        elif tag == "N1":
            am = re.search(r"arXiv:(\S+)", val)
            if am:
                cur["arxiv"] = am.group(1)
    return items


# ── CSL-JSON ──────────────────────────────────────────────────────────────────

_CSL_TY = {"article": "article-journal", "preprint": "article", "book": "book", "chapter": "chapter", "conference": "paper-conference", "thesis": "thesis", "report": "report", "webpage": "webpage"}


def to_csl(item: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"id": citekey_of(item), "type": _CSL_TY[_kind(item)], "title": item.get("title") or ""}
    out["author"] = [{"family": parse_name(a)[0], "given": parse_name(a)[1]} for a in item.get("authors") or []]
    if item.get("year"):
        out["issued"] = {"date-parts": [[int(item["year"])]]}
    for src, dst in (("venue", "container-title"), ("doi", "DOI"), ("url", "URL"), ("publisher", "publisher"), ("volume", "volume"), ("issue", "issue"), ("pages", "page"), ("abstract", "abstract")):
        if item.get(src):
            out[dst] = item[src]
    return out


# ── Formatted citations ──────────────────────────────────────────────────────

def _join(parts: list[str], last: str) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + last + parts[-1]


def format_citation(item: dict[str, Any], style: str) -> str:
    authors = [parse_name(a) for a in item.get("authors") or []]
    year = str(item.get("year") or "n.d.")
    title = (item.get("title") or "").rstrip(".")
    venue = _venue(item)
    vol, iss, pages = item.get("volume") or "", item.get("issue") or "", str(item.get("pages") or "").replace("--", "–")
    link = _doi_url(item)
    kind = _kind(item)
    pub = item.get("publisher") or ""

    def tail_apa() -> str:
        bits = ""
        if vol:
            bits += f", {vol}" + (f"({iss})" if iss else "")
        if pages:
            bits += f", {pages}"
        return bits

    if style == "apa":
        names = [f"{f}, {initials(g)}".strip().rstrip(",") if g else f for f, g in authors]
        if len(names) > 20:
            names = names[:19] + ["…", names[-1]]
            a = ", ".join(names)
        elif len(names) > 1:
            a = ", ".join(names[:-1]) + ", & " + names[-1]
        else:
            a = "".join(names)
        s = f"{a + ' ' if a else ''}({year}). {title}."
        if kind == "book":
            s += (f" {pub}." if pub else "")
        elif venue:
            s += f" {venue}{tail_apa()}."
        return (s + (f" {link}" if link else "")).strip()

    if style == "ieee":
        names = [f"{initials(g)} {f}".strip() for f, g in authors]
        a = names[0] if len(names) == 1 else (" and ".join(names) if len(names) == 2 else (names[0] + " et al." if len(names) > 6 else ", ".join(names[:-1]) + ", and " + names[-1])) if names else ""
        s = f"{a + ', ' if a else ''}“{title},”"
        if kind == "book":
            s = f"{a + ', ' if a else ''}{title}."
            s += f" {pub}," if pub else ""
            return (s + f" {year}.").strip()
        if venue:
            s += f" {venue}"
            if vol:
                s += f", vol. {vol}"
            if iss:
                s += f", no. {iss}"
            if pages:
                s += f", pp. {pages}"
            s += f", {year}."
        else:
            s += f" {year}."
        if item.get("doi"):
            s += f" doi: {item['doi']}."
        return s

    if style == "harvard":
        names = [f"{f}, {initials(g)}".strip().rstrip(",") if g else f for f, g in authors]
        a = names[0] if len(names) == 1 else (", ".join(names[:-1]) + " and " + names[-1] if names else "")
        s = f"{a + ' ' if a else ''}({year}) ‘{title}’"
        if kind == "book":
            s = f"{a + ' ' if a else ''}({year}) {title}." + (f" {pub}." if pub else "")
        elif venue:
            s += f", {venue}"
            if vol:
                s += f", {vol}" + (f"({iss})" if iss else "")
            if pages:
                s += f", pp. {pages}"
            s += "."
        else:
            s += "."
        return (s + (f" Available at: {link}" if link else "")).strip()

    if style == "chicago":
        names = []
        for i, (f, g) in enumerate(authors):
            names.append(f"{f}, {g}" if i == 0 and g else (f"{g} {f}".strip()))
        a = names[0] if len(names) == 1 else (", ".join(names[:-1]) + ", and " + names[-1] if names else "")
        s = f"{a + '. ' if a else ''}{year}. "
        if kind == "book":
            s += f"{title}." + (f" {pub}." if pub else "")
        else:
            s += f"“{title}.”"
            if venue:
                s += f" {venue}"
                if vol:
                    s += f" {vol}" + (f" ({iss})" if iss else "")
                if pages:
                    s += f": {pages}"
                s += "."
        return (s + (f" {link}." if link else "")).strip()

    if style == "mla":
        if not authors:
            a = ""
        elif len(authors) == 1:
            f, g = authors[0]
            a = f"{f}, {g}".strip(", ")
        elif len(authors) == 2:
            f, g = authors[0]
            f2, g2 = authors[1]
            a = f"{f}, {g}, and {g2} {f2}".replace(", ,", ",")
        else:
            f, g = authors[0]
            a = f"{f}, {g}, et al".strip(", ")
        s = f"{a + '. ' if a else ''}"
        if kind == "book":
            s += f"{title}. " + (f"{pub}, " if pub else "") + f"{year}."
        else:
            s += f"“{title}.” "
            parts = [p for p in (venue, f"vol. {vol}" if vol else "", f"no. {iss}" if iss else "", year, f"pp. {pages}" if pages else "") if p]
            s += ", ".join(parts) + "."
        return (s + (f" {link}." if link else "")).strip()

    raise ValueError(f"Unknown style: {style}")


def render(items: list[dict[str, Any]], style: str) -> tuple[str, str, str]:
    """(text, media_type, extension) for an export of one or more items."""
    style = style.lower()
    if style == "bibtex":
        seen: set[str] = set()
        blocks = []
        for it in items:
            it = dict(it)
            k = citekey_of(it)
            base, n = k, 2
            while k in seen:
                k, n = f"{base}{chr(96 + n)}" if n < 28 else f"{base}{n}", n + 1
            seen.add(k)
            it["citekey"] = k
            blocks.append(to_bibtex(it))
        return "\n\n".join(blocks) + "\n", "application/x-bibtex", "bib"
    if style == "ris":
        return "\n\n".join(to_ris(i) for i in items) + "\n", "application/x-research-info-systems", "ris"
    if style == "csljson":
        return json.dumps([to_csl(i) for i in items], indent=1, ensure_ascii=False), "application/json", "json"
    if style in {"apa", "ieee", "harvard", "chicago", "mla"}:
        return "\n\n".join(format_citation(i, style) for i in items) + "\n", "text/plain", "txt"
    raise ValueError(f"Unknown style: {style}")


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", _ascii(t or "").lower())


def norm_arxiv(a: Optional[str]) -> str:
    a = (a or "").strip().lower()
    a = re.sub(r"^(arxiv:|https?://arxiv\.org/(abs|pdf)/)", "", a)
    a = re.sub(r"\.pdf$", "", a)
    return re.sub(r"v\d+$", "", a)


def norm_doi(d: Optional[str]) -> str:
    d = (d or "").strip().lower()
    return re.sub(r"^(doi:|https?://(dx\.)?doi\.org/)", "", d)
