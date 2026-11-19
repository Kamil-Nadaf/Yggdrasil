"""Find the paper behind a reference-list entry (the PDF reader's citation card → "Open paper").

Order: an arXiv id (in the entry text or in an ADS-style link name such as ``cite.2024arXiv240710156Y``),
then the entry's DOI (OpenAlex), then journal + volume + first page + year + first author (OpenAlex).
Never raises: the caller just gets fewer fields back.
"""
from __future__ import annotations

import re
from typing import Any, Optional

import httpx
from fastapi import APIRouter

OPENALEX = "https://api.openalex.org"
HEADERS = {"User-Agent": "Yggdrasil/1.0 (mailto:academic-reader@yggdrasil.local)"}

router = APIRouter()

_ARXIV_TEXT = re.compile(r"arXiv\s*[:\s]\s*((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Za-z]{2})?/\d{7}))", re.I)
_ARXIV_BIBCODE = re.compile(r"\d{4}arXiv(\d{4})(\d{5})[A-Z]")
_DOI = re.compile(r"(10\.\d{4,9}/[^\s\"<>]+)(?:\s(\d+-\d+)\b)?")
_YEAR = re.compile(r"\b(1[89]|20)\d{2}[a-z]?\b")
_VOL_PAGE = re.compile(r",\s*(\d{1,4}),\s*([A-Za-z]?\d{1,6}[A-Za-z]?)\b")


def parse_entry(text: str, name: str = "") -> dict[str, str]:
    """Pull whatever identifies the paper out of the entry text and the link name."""
    out = {"arxiv": "", "doi": "", "year": "", "surname": "", "volume": "", "page": ""}
    m = _ARXIV_BIBCODE.search(name or "")
    if m:
        out["arxiv"] = f"{m.group(1)}.{m.group(2)}"
    elif (m := _ARXIV_TEXT.search(text)):
        out["arxiv"] = m.group(1)
    if (d := _DOI.search(text)):
        doi = d.group(1).rstrip(".,;)]")
        # Springer chapter DOIs lose their underscore in PDF text: "…-0 151-1".
        if d.group(2) and re.search(r"-\d{4}-\d$", doi):
            doi = f"{doi}_{d.group(2)}"
        out["doi"] = doi
    if (y := _YEAR.search(text)):
        out["year"] = y.group(0)[:4]
    s = re.sub(r"^\s*(?:\[?\d{1,3}[.\]]\s*)", "", text)
    out["surname"] = s.split(",", 1)[0].strip() if "," in s else ""
    if out["year"] and (v := _VOL_PAGE.search(text[text.find(out["year"]):] if out["year"] in text else text)):
        out["volume"], out["page"] = v.group(1), v.group(2)
    return out


def _from_work(w: dict[str, Any]) -> dict[str, Any]:
    arxiv = ""
    pdf = ""
    for loc in [w.get("best_oa_location"), w.get("primary_location"), *(w.get("locations") or [])]:
        if not loc:
            continue
        landing = loc.get("landing_page_url") or ""
        if (am := re.search(r"arxiv\.org/(?:abs|pdf)/([^\s?#]+?)(?:v\d+)?(?:\.pdf)?$", landing)):
            arxiv = arxiv or am.group(1)
        pdf = pdf or loc.get("pdf_url") or ""
    doi = (w.get("doi") or "").replace("https://doi.org/", "")
    return {
        "title": w.get("title") or w.get("display_name") or "",
        "arxiv": arxiv,
        "doi": doi,
        "pdf_url": f"https://arxiv.org/pdf/{arxiv}" if arxiv else pdf,
        "landing_url": f"https://doi.org/{doi}" if doi else "",
    }


async def resolve(text: str, name: str = "") -> dict[str, Any]:
    info = parse_entry(text, name)
    res: dict[str, Any] = {"ok": False, "arxiv": info["arxiv"], "doi": info["doi"], "pdf_url": "", "landing_url": "", "title": "", "source": ""}
    if info["arxiv"]:
        res.update(ok=True, pdf_url=f"https://arxiv.org/pdf/{info['arxiv']}", source="arxiv")
        return res
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=12.0, headers=HEADERS) as c:
            work: Optional[dict] = None
            if info["doi"]:
                r = await c.get(f"{OPENALEX}/works/doi:{info['doi']}")
                if r.status_code == 200:
                    work = r.json()
                    res["source"] = "doi"
            if work is None and info["year"] and info["volume"] and info["page"] and info["surname"]:
                r = await c.get(f"{OPENALEX}/works", params={
                    "filter": f"publication_year:{info['year']},biblio.volume:{info['volume']},biblio.first_page:{info['page']}",
                    "per_page": 25,  # no `search`: OpenAlex searches titles, not authors; match the surname below
                })
                if r.status_code == 200:
                    sur = info["surname"].lower()
                    for w in r.json().get("results") or []:
                        first = ((w.get("authorships") or [{}])[0].get("author") or {}).get("display_name", "")
                        if first and first.lower().split()[-1] == sur.split()[-1]:
                            work, res["source"] = w, "journal"
                            break
            if work:
                found = _from_work(work)
                res.update({k: v for k, v in found.items() if v})
                res["ok"] = bool(res["pdf_url"] or res["landing_url"])
    except Exception:  # offline, rate-limited, bad JSON: the card falls back to Search / Go to reference
        pass
    if not res["landing_url"] and res["doi"]:
        res["landing_url"] = f"https://doi.org/{res['doi']}"
        res["ok"] = True
    return res


@router.get("/api/citation/resolve")
async def citation_resolve(text: str, name: str = ""):
    return await resolve(text[:600], name[:200])
