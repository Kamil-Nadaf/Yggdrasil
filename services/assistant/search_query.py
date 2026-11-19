"""Turn what people paste into the search box into something the paper APIs understand.

Handles two real-world cases:
  * text copied from a PDF where accents were split off the letters ("M ́esz ́aros"), and
  * citation-style queries ("Mészáros & Rees 2000", "Band et al. 1993") -> author surnames + a year.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

_SPECIAL = str.maketrans({"ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ð": "d", "þ": "th", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ı": "i"})
# Spacing accent characters that PDF text extraction leaves between letters.
_SPACING = "´`¨ˇ˜ˆ¯˘˙˚˝¸˛"
_YEAR = re.compile(r"(?<![\d.])((?:19|20)\d{2})[a-z]?(?![\d])")


def _is_initial(w: str) -> bool:
    bare = w.strip(".")
    return len(bare) <= 1 or (w.endswith(".") and len(bare) <= 3) or (bare.isupper() and len(bare) <= 3)


def fold(s: str) -> str:
    """Repair detached accents and strip diacritics: "M ́esz ́aros" / "Mészáros" -> "Meszaros"."""
    s = re.sub(r"\s+([̀-ͯ])", r"\1", s or "")
    s = re.sub(rf"(?<=\w)\s*[{_SPACING}]\s*(?=\w)", "", s)
    s = re.sub(rf"[{_SPACING}]", "", s)
    s = unicodedata.normalize("NFKD", s.translate(_SPECIAL))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip()


@dataclass
class Parsed:
    text: str
    year: int | None = None
    authors: list[str] = field(default_factory=list)
    citation: bool = False


def parse_query(q: str, search_field: str = "all") -> Parsed:
    text = re.sub(r"\s+", " ", re.sub(r"[()\[\]]", " ", fold(q))).strip()
    if search_field not in ("all", "author"):
        return Parsed(text)
    ym = _YEAR.search(text)
    year = int(ym.group(1)) if ym else None
    rest = _YEAR.sub(" ", text, count=1) if ym else text
    etal = bool(re.search(r"\bet\.?\s*al\b\.?", rest, re.I))
    rest = re.sub(r"\bet\.?\s*al\b\.?", " ", rest, flags=re.I)
    amp = bool(re.search(r"&|\band\b", rest, re.I))
    parts = [p.strip(" .") for p in re.split(r"\s*(?:&|\band\b|,|;)\s*", rest, flags=re.I) if p.strip(" .")]
    surnames: list[str] = []
    for part in parts:
        words = part.split()
        if not 1 <= len(words) <= 3 or not all(re.fullmatch(r"[A-Za-z][A-Za-z'’.\-]*", w) for w in words):
            return Parsed(text, year)
        names = [w.strip(".") for w in words if not _is_initial(w)]
        if not names:  # "M. J." after "Rees," -> initials belong to the previous surname
            continue
        sur = names[-1]
        if len(sur) < 2 or not sur[0].isupper():
            return Parsed(text, year)
        surnames.append(sur)
    if not surnames or len(surnames) > 4:
        return Parsed(text, year)
    if year is None and not (etal or amp):
        return Parsed(text)  # a bare name/word: leave it to the normal search
    return Parsed(text, year, surnames, True)


def arxiv_author_query(p: Parsed) -> str:
    q = " AND ".join(f"au:{n}" for n in p.authors)
    if p.year:
        q += f" AND submittedDate:[{p.year - 1}01010000 TO {p.year + 1}12312359]"
    return q


def openalex_author_filter(p: Parsed) -> str:
    f = ",".join(f"raw_author_name.search:{n}" for n in p.authors)
    if p.year:
        f += f",publication_year:{p.year - 1}-{p.year + 1}"
    return f
