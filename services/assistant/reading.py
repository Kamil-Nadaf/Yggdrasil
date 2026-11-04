"""reading.py — Books reading library: import, progress, highlights, collections, goals.

Sits next to the existing "Books mode" (15-Books/{slug}/_book.md + section notes) and extends
the same folders instead of creating a parallel store:

  15-Books/
    _collections.json            ← [{id, name, slugs[]}]
    {slug}/
      _book.md                   ← frontmatter (python-frontmatter writes only)
      book.pdf | book.epub       ← the imported file
      cover.jpg|png|webp         ← optional cover
      annotations.json           ← PDF highlights/notes (served through /api/pdf-annotations)
      highlights.json            ← EPUB highlights/notes
  60-Meta/reading-log.json       ← {goal_minutes, days: {YYYY-MM-DD: {...}}}

Routes live under /api/reading so they never collide with the section-notes API at /api/books.
"""
from __future__ import annotations

import json
import os
import posixpath
import re
import secrets
import threading
from html.parser import HTMLParser
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import frontmatter
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import citations
from starlette.concurrency import run_in_threadpool

SLUG_RE = re.compile(r"^[a-z0-9-]+$")
FORMATS = {".pdf": "pdf", ".epub": "epub"}
MEDIA_TYPES = {"pdf": "application/pdf", "epub": "application/epub+zip"}
COVER_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
STATUSES = ("want", "reading", "finished")
MAX_BOOK_BYTES = 300 * 1024 * 1024
MAX_COVER_BYTES = 3 * 1024 * 1024
DEFAULT_GOAL_MINUTES = 30
MAX_SESSION_SECONDS = 3600


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:60].strip("-") or "book"


# ── EPUB metadata (stdlib only) ───────────────────────────────────────────────

_NS_DC = "{http://purl.org/dc/elements/1.1/}"
_NS_OPF = "{http://www.idpf.org/2007/opf}"
_NS_CONTAINER = "{urn:oasis:names:tc:opendocument:xmlns:container}"


def epub_metadata(path: Path) -> dict[str, Any]:
    """Title, authors and cover bytes of an EPUB. Never raises: returns {} when unreadable."""
    try:
        with zipfile.ZipFile(path) as z:
            def read(name: str, cap: int) -> bytes:
                info = z.getinfo(name)
                if info.file_size > cap:
                    raise ValueError("entry too large")
                return z.read(name)

            container = ET.fromstring(read("META-INF/container.xml", 1_000_000))
            rootfile = container.find(f".//{_NS_CONTAINER}rootfile")
            if rootfile is None:
                return {}
            opf_path = rootfile.get("full-path") or ""
            opf = ET.fromstring(read(opf_path, 4_000_000))
            title_el = opf.find(f".//{_NS_DC}title")
            title = (title_el.text or "").strip() if title_el is not None and title_el.text else ""
            authors = [
                (el.text or "").strip()
                for el in opf.findall(f".//{_NS_DC}creator")
                if el.text and el.text.strip()
            ]
            out: dict[str, Any] = {"title": title, "authors": authors}

            manifest = {
                item.get("id"): item
                for item in opf.findall(f".//{_NS_OPF}item")
                if item.get("id")
            }
            cover_item = None
            for meta in opf.findall(f".//{_NS_OPF}meta"):
                if meta.get("name") == "cover" and meta.get("content") in manifest:
                    cover_item = manifest[meta.get("content")]
                    break
            if cover_item is None:
                for item in manifest.values():
                    if "cover-image" in (item.get("properties") or "").split():
                        cover_item = item
                        break
            if cover_item is not None and cover_item.get("href"):
                href = posixpath.normpath(posixpath.join(posixpath.dirname(opf_path), cover_item.get("href")))
                ext = posixpath.splitext(href)[1].lower()
                if ext in COVER_TYPES and not href.startswith(".."):
                    out["cover"] = (read(href, MAX_COVER_BYTES), ".jpg" if ext == ".jpeg" else ext)
            return out
    except Exception:
        return {}


# ── Small JSON helpers ────────────────────────────────────────────────────────

def _json_read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _json_write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    os.replace(tmp, path)


def _iso(d: str) -> str:
    try:
        return date.fromisoformat(d).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid date: {d}")


# ── Models ────────────────────────────────────────────────────────────────────

class BookPatch(BaseModel):
    title: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    status: Optional[str] = None
    total_pages: Optional[int] = None
    last_page: Optional[int] = None
    last_position: Optional[str] = None  # EPUB CFI
    progress: Optional[float] = None  # 0..1
    # Reference-manager fields (Collection)
    item_type: Optional[str] = None
    venue: Optional[str] = None
    doi: Optional[str] = None
    arxiv: Optional[str] = None
    url: Optional[str] = None
    publisher: Optional[str] = None
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None
    abstract: Optional[str] = None
    notes: Optional[str] = None
    citekey: Optional[str] = None
    tags: Optional[list[str]] = None
    favorite: Optional[bool] = None
    kind: Optional[str] = None
    related: Optional[list[str]] = None


class ItemCreate(BaseModel):
    """A reference without a file (a paper from arXiv, a book you only cite, an imported BibTeX entry)."""
    title: str
    kind: str = "paper"  # paper | book
    authors: list[str] = []
    year: Optional[int] = None
    item_type: Optional[str] = None
    venue: Optional[str] = None
    doi: Optional[str] = None
    arxiv: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    publisher: Optional[str] = None
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None
    abstract: Optional[str] = None
    tags: list[str] = []
    collection: Optional[str] = None  # collection id to file the item in
    fetch_pdf: bool = True
    citekey: Optional[str] = None
    notes: Optional[str] = None
    zotero_key: Optional[str] = None


class MergePayload(BaseModel):
    keep: str
    remove: list[str]


class LatexBibPayload(BaseModel):
    project: str = ""
    slugs: list[str]


class ZoteroImportPayload(BaseModel):
    with_pdfs: bool = False


class SearchesPayload(BaseModel):
    searches: list[dict[str, Any]] = []


class ImportRefs(BaseModel):
    text: str
    format: Optional[str] = None  # bibtex | ris (auto-detected when omitted)
    collection: Optional[str] = None


class HighlightsPayload(BaseModel):
    highlights: list[dict[str, Any]] = []


class CollectionsPayload(BaseModel):
    collections: list[dict[str, Any]] = []


class GoalPayload(BaseModel):
    minutes: int


TIME_CATEGORIES = {"books": "seconds", "papers": "papers_seconds", "writing": "writing_seconds"}
# Dashboard habit auto-ticks: habit key, flag stored on the day, minutes needed (books use the daily goal).
HABIT_RULES = {
    "papers": ("arxiv", "synced_arxiv", 15),
    "writing": ("research", "synced_research", 30),
}


class TimePayload(BaseModel):
    category: str
    seconds: int
    date: Optional[str] = None


class SessionPayload(BaseModel):
    slug: str
    seconds: int
    page: Optional[int] = None
    date: Optional[str] = None


ITEM_FIELDS = ("item_type", "venue", "doi", "arxiv", "url", "publisher", "volume", "issue", "pages", "abstract", "notes", "citekey")
MAX_PDF_BYTES = 120 * 1024 * 1024
_UA = {"User-Agent": "Yggdrasil/1.0 (reference manager; mailto:none)"}


def download_pdf(url: str, dest: Path) -> bool:
    """Best-effort PDF download (arXiv etc.). Returns False on any failure; never raises."""
    try:
        if not re.match(r"^https?://", url or ""):
            return False
        req = urllib.request.Request(url, headers=_UA)
        with urllib.request.urlopen(req, timeout=60) as resp:
            head = resp.read(5)
            if head != b"%PDF-":
                return False
            tmp = dest.with_suffix(".part")
            size = len(head)
            with tmp.open("wb") as fh:
                fh.write(head)
                while True:
                    chunk = resp.read(1024 * 256)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > MAX_PDF_BYTES:
                        fh.close()
                        tmp.unlink(missing_ok=True)
                        return False
                    fh.write(chunk)
            os.replace(tmp, dest)
        return True
    except Exception:
        return False


def _http_json(url: str) -> Any:
    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def lookup_metadata(q: str) -> dict[str, Any]:
    """Resolve a DOI or arXiv id/URL into item fields (Crossref / arXiv API)."""
    q = (q or "").strip()
    arx = re.search(r"(?:arxiv\.org/(?:abs|pdf)/|arxiv:)?(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?(?:\.pdf)?$", q, re.IGNORECASE)
    doi = re.search(r"(10\.\d{4,9}/\S+)", q)
    if doi and not (arx and "arxiv" in q.lower()):
        data = _http_json("https://api.crossref.org/works/" + urllib.parse.quote(doi.group(1).rstrip(".,;)"), safe="/"))["message"]
        issued = (data.get("issued") or {}).get("date-parts") or [[None]]
        ctype = data.get("type", "")
        return {
            "title": re.sub(r"<[^>]+>", "", (data.get("title") or [""])[0]),
            "authors": [f"{a.get('given', '')} {a.get('family', '')}".strip() for a in data.get("author", [])],
            "year": issued[0][0],
            "venue": (data.get("container-title") or [""])[0],
            "doi": data.get("DOI", doi.group(1)),
            "url": data.get("URL"),
            "publisher": data.get("publisher"),
            "volume": data.get("volume"),
            "issue": data.get("issue"),
            "pages": data.get("page"),
            "abstract": re.sub(r"<[^>]+>", "", data.get("abstract") or "").strip(),
            "item_type": {"book": "book", "proceedings-article": "conference", "book-chapter": "chapter", "dissertation": "thesis", "report": "report"}.get(ctype, "article"),
        }
    if arx:
        aid = arx.group(1)
        req = urllib.request.Request(f"https://export.arxiv.org/api/query?id_list={aid}", headers=_UA)
        with urllib.request.urlopen(req, timeout=20) as resp:
            root = ET.fromstring(resp.read())
        ns = {"a": "http://www.w3.org/2005/Atom"}
        e = root.find("a:entry", ns)
        if e is None or not (e.findtext("a:title", "", ns) or "").strip():
            raise ValueError("Not found on arXiv")
        return {
            "title": re.sub(r"\s+", " ", e.findtext("a:title", "", ns)).strip(),
            "authors": [(a.findtext("a:name", "", ns) or "").strip() for a in e.findall("a:author", ns)],
            "year": int((e.findtext("a:published", "", ns) or "0000")[:4]) or None,
            "arxiv": aid,
            "abstract": re.sub(r"\s+", " ", e.findtext("a:summary", "", ns)).strip(),
            "item_type": "preprint",
            "url": f"https://arxiv.org/abs/{aid}",
        }
    if re.match(r"^https?://", q):
        return lookup_webpage(q)
    raise ValueError("Enter a DOI (10.xxxx/…), an arXiv id, or a web address")


class _MetaTags(HTMLParser):
    """Collects <meta name=… content=…> and <title> from a web page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: list[tuple[str, str]] = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta" and a.get("content"):
            name = (a.get("name") or a.get("property") or "").lower()
            if name:
                self.meta.append((name, a["content"].strip()))
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def lookup_webpage(url: str) -> dict[str, Any]:
    """Item fields from a publisher / ADS / blog page via citation_* (Highwire) and Open Graph tags."""
    req = urllib.request.Request(url, headers={**_UA, "Accept": "text/html,application/xhtml+xml"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        html = resp.read(2_000_000).decode(resp.headers.get_content_charset() or "utf-8", "replace")
    p = _MetaTags()
    p.feed(html)

    def first(*names: str) -> str:
        for n in names:
            for k, v in p.meta:
                if k == n and v:
                    return v
        return ""

    def many(name: str) -> list[str]:
        return [v for k, v in p.meta if k == name and v]

    title = first("citation_title", "dc.title", "og:title") or re.sub(r"\s+", " ", p.title).strip()
    if not title:
        raise ValueError("Could not read any metadata from that page")
    doi = first("citation_doi", "dc.identifier")
    doi = doi if doi.startswith("10.") else re.sub(r"^doi:\s*", "", doi) if doi.lower().startswith("doi:") else ""
    if doi:
        try:
            full = lookup_metadata(doi)
            if full.get("title"):
                return {**full, "url": url}
        except Exception:
            pass
    authors = many("citation_author") or many("dc.creator") or many("article:author")
    date_s = first("citation_publication_date", "citation_date", "dc.date", "article:published_time")
    ym = re.search(r"(1[5-9]\d\d|20\d\d)", date_s)
    arx = first("citation_arxiv_id")
    sp, ep = first("citation_firstpage"), first("citation_lastpage")
    has_cit = bool(first("citation_title"))
    return {
        "title": title,
        "authors": authors,
        "year": int(ym.group(1)) if ym else None,
        "venue": first("citation_journal_title", "citation_conference_title", "og:site_name"),
        "doi": doi,
        "arxiv": arx,
        "url": url,
        "publisher": first("citation_publisher", "dc.publisher"),
        "volume": first("citation_volume"),
        "issue": first("citation_issue"),
        "pages": f"{sp}-{ep}" if sp and ep else sp,
        "abstract": first("citation_abstract", "dc.description", "og:description", "description"),
        "item_type": "article" if has_cit else "webpage",
        "pdf_url": first("citation_pdf_url"),
    }


_Z_TYPES = {"journalArticle": "article", "preprint": "preprint", "book": "book", "bookSection": "chapter", "conferencePaper": "conference",
            "thesis": "thesis", "report": "report", "webpage": "webpage"}


def zotero_item_fields(d: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Map a Zotero API item `data` block to our item fields; None for items we skip."""
    itype = d.get("itemType", "")
    if itype in {"attachment", "note", "annotation"} or not (d.get("title") or "").strip():
        return None
    authors = []
    for c in d.get("creators") or []:
        if c.get("creatorType") not in (None, "author", "contributor", "editor"):
            continue
        name = c.get("name") or f"{c.get('firstName', '')} {c.get('lastName', '')}".strip()
        if name:
            authors.append(name)
    ym = re.search(r"(1[5-9]\d\d|20\d\d)", d.get("date", "") or "")
    extra = d.get("extra", "") or ""
    arx = ""
    for src in (d.get("archiveID", ""), d.get("url", ""), extra):
        m = re.search(r"(?:arxiv[:./]*(?:abs/)?)?(\d{4}\.\d{4,5})(?:v\d+)?", src or "", re.IGNORECASE) if "arxiv" in (src or "").lower() else None
        if m:
            arx = m.group(1)
            break
    ck = re.search(r"Citation Key:\s*(\S+)", extra)
    venue = next((d[k] for k in ("publicationTitle", "proceedingsTitle", "bookTitle", "websiteTitle", "repository", "blogTitle") if d.get(k)), "")
    return {
        "title": d["title"].strip(),
        "authors": authors,
        "year": int(ym.group(1)) if ym else None,
        "item_type": _Z_TYPES.get(itype, "article"),
        "kind": "book" if itype == "book" else "paper",
        "venue": venue,
        "doi": d.get("DOI", ""),
        "arxiv": arx,
        "url": d.get("url", ""),
        "publisher": d.get("publisher") or d.get("institution") or d.get("university") or "",
        "volume": d.get("volume", ""),
        "issue": d.get("issue", ""),
        "pages": d.get("pages", ""),
        "abstract": d.get("abstractNote", ""),
        "tags": [t.get("tag", "") for t in d.get("tags") or [] if t.get("tag")],
        "citekey": ck.group(1) if ck else None,
        "zotero_key": d.get("key", ""),
    }


def _strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>|</p>|</div>|</li>", "\n", s or "")
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\n{3,}", "\n\n", s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")).strip()


# ── Router ────────────────────────────────────────────────────────────────────

def make_router(get_vault: Callable[[], Path], write_habits: Callable[[str, dict], Any]) -> APIRouter:
    router = APIRouter(prefix="/api/reading", tags=["reading"])

    def root() -> Path:
        return get_vault() / "15-Books"

    def book_dir(slug: str) -> Path:
        if not slug or not SLUG_RE.fullmatch(slug):
            raise HTTPException(status_code=400, detail="Invalid book slug")
        base = root().resolve()
        path = (base / slug).resolve()
        if path.parent != base:
            raise HTTPException(status_code=400, detail="Invalid book slug")
        return path

    def existing_book(slug: str) -> Path:
        d = book_dir(slug)
        if not (d / "_book.md").is_file():
            raise HTTPException(status_code=404, detail="Book not found")
        return d

    def book_file(d: Path) -> Optional[tuple[Path, str]]:
        for ext, fmt in FORMATS.items():
            p = d / f"book{ext}"
            if p.is_file():
                return p, fmt
        return None

    def cover_file(d: Path) -> Optional[Path]:
        for ext in COVER_TYPES:
            p = d / f"cover{ext}"
            if p.is_file():
                return p
        return None

    def count_json_list(path: Path, key: Optional[str]) -> int:
        data = _json_read(path, None)
        if key and isinstance(data, dict):
            data = data.get(key)
        return len(data) if isinstance(data, list) else 0

    def summary(d: Path) -> Optional[dict[str, Any]]:
        md = d / "_book.md"
        if not md.is_file():
            return None
        fm = dict(frontmatter.load(str(md)).metadata)
        found = book_file(d)
        total = fm.get("total_pages")
        last_page = fm.get("last_page") or 0
        progress = fm.get("progress")
        if progress is None:
            progress = (last_page / total) if isinstance(total, int) and total > 0 else 0
        status = fm.get("status")
        if status not in STATUSES:
            status = "reading" if (fm.get("last_opened") or progress) else "want"
        return {
            "slug": fm.get("slug") or d.name,
            "title": fm.get("title") or d.name,
            "authors": fm.get("authors") or [],
            "year": fm.get("year"),
            "format": found[1] if found else "none",
            "has_file": bool(found),
            "has_cover": cover_file(d) is not None,
            "status": status,
            "progress": max(0.0, min(1.0, float(progress or 0))),
            "last_page": last_page,
            "total_pages": total,
            "last_position": fm.get("last_position") or "",
            "highlights": count_json_list(d / "annotations.json", "annotations")
            + count_json_list(d / "highlights.json", "highlights"),
            "last_opened": fm.get("last_opened"),
            "added": fm.get("added") or fm.get("started"),
            "finished": fm.get("finished"),
            "section_count": sum(1 for p in d.glob("*.md") if p.name != "_book.md"),
            "kind": "paper" if fm.get("kind") == "paper" else "book",
            "item_type": fm.get("item_type") or ("preprint" if fm.get("arxiv") and not fm.get("venue") else ("article" if fm.get("kind") == "paper" else "book")),
            "venue": fm.get("venue") or "",
            "doi": fm.get("doi") or "",
            "arxiv": fm.get("arxiv") or "",
            "url": fm.get("url") or "",
            "publisher": fm.get("publisher") or "",
            "volume": str(fm.get("volume") or ""),
            "issue": str(fm.get("issue") or ""),
            "pages": str(fm.get("pages") or ""),
            "abstract": fm.get("abstract") or "",
            "notes": fm.get("notes") or "",
            "citekey": fm.get("citekey") or "",
            "tags": fm.get("tags") or [],
            "favorite": bool(fm.get("favorite")),
            "related": [r for r in (fm.get("related") or []) if isinstance(r, str)],
            "zotero_key": fm.get("zotero_key") or "",
        }

    def unique_slug(base: str) -> str:
        slug = base
        n = 2
        while (root() / slug).exists():
            slug = f"{base[:55]}-{n}"
            n += 1
        return slug

    async def save_upload(upload: UploadFile, dest: Path, limit: int) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        size = 0
        try:
            with tmp.open("wb") as fh:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(status_code=413, detail=f"File is larger than {limit // (1024 * 1024)} MB")
                    fh.write(chunk)
            os.replace(tmp, dest)
        finally:
            if tmp.exists():
                tmp.unlink()

    def write_book_md(d: Path, meta: dict[str, Any]) -> None:
        md = d / "_book.md"
        post = frontmatter.load(str(md)) if md.exists() else frontmatter.Post("")
        post.metadata.update(meta)
        md.write_text(frontmatter.dumps(post))

    def clean_authors(raw: str) -> list[str]:
        return [a.strip() for a in re.split(r"[;\n]|\s+and\s+", raw or "") if a.strip()][:12]

    def link_related(slug: str, other: str, add: bool) -> None:
        md = root() / slug / "_book.md"
        if not md.is_file():
            return
        cur = [r for r in (frontmatter.load(str(md)).metadata.get("related") or []) if isinstance(r, str)]
        nxt = list(dict.fromkeys([*cur, other])) if add else [r for r in cur if r != other]
        if nxt != cur:
            write_book_md(root() / slug, {"related": nxt})

    def purge(slug: str) -> None:
        """Delete one item's folder and unlink it from collections and related items."""
        d = book_dir(slug)
        if d.exists():
            for p in sorted(d.rglob("*"), reverse=True):
                p.unlink() if p.is_file() else p.rmdir()
            d.rmdir()
        cols = _json_read(collections_path(), [])
        if isinstance(cols, list):
            for c in cols:
                if isinstance(c, dict):
                    c["slugs"] = [x for x in (c.get("slugs") or []) if x != slug]
            _json_write(collections_path(), cols)
        base = root()
        if base.exists():
            for o in base.iterdir():
                if o.is_dir() and (o / "_book.md").is_file():
                    link_related(o.name, slug, False)

    # ── Library ──

    @router.get("/library")
    async def library():
        books: list[dict[str, Any]] = []
        base = root()
        if base.exists():
            for d in sorted(p for p in base.iterdir() if p.is_dir()):
                s = summary(d)
                if s:
                    books.append(s)
        return {"books": books}

    @router.post("/import")
    async def import_book(
        file: UploadFile = File(...),
        title: str = Form(""),
        authors: str = Form(""),
        year: str = Form(""),
        cover: Optional[UploadFile] = File(None),
    ):
        ext = Path(file.filename or "").suffix.lower()
        if ext not in FORMATS:
            raise HTTPException(status_code=400, detail="Unsupported file. Use a .pdf or .epub book.")
        staging = root() / f".import-{secrets.token_hex(4)}"
        try:
            staged = staging / f"book{ext}"
            await save_upload(file, staged, MAX_BOOK_BYTES)
            meta = epub_metadata(staged) if ext == ".epub" else {}
            final_title = (title or "").strip() or meta.get("title") or Path(file.filename or "Untitled").stem.replace("_", " ").strip() or "Untitled"
            author_list = clean_authors(authors) or meta.get("authors") or []
            slug = unique_slug(slugify(final_title))
            d = book_dir(slug)
            d.mkdir(parents=True)
            os.replace(staged, d / f"book{ext}")

            cover_saved = False
            if cover is not None and cover.filename:
                cext = Path(cover.filename).suffix.lower()
                if cext in COVER_TYPES:
                    await save_upload(cover, d / f"cover{'.jpg' if cext == '.jpeg' else cext}", MAX_COVER_BYTES)
                    cover_saved = True
            if not cover_saved and meta.get("cover"):
                data, cext = meta["cover"]
                (d / f"cover{cext}").write_bytes(data)

            try:
                year_val: Optional[int] = int(year) if year.strip() else None
            except ValueError:
                year_val = None
            today = date.today().strftime("%Y-%m-%d")
            write_book_md(
                d,
                {
                    "type": "book",
                    "slug": slug,
                    "title": final_title,
                    "authors": author_list,
                    "year": year_val,
                    "has_tracks": False,
                    "total_sections": None,
                    "started": today,
                    "added": today,
                    "format": FORMATS[ext],
                    "status": "want",
                    "total_pages": None,
                    "last_page": 0,
                    "progress": 0,
                },
            )
            result = summary(d)
        finally:
            if staging.exists():
                for p in staging.glob("*"):
                    p.unlink()
                staging.rmdir()
        return {"ok": True, "book": result}

    # ── Collections & goals (static paths first, before /{slug}) ──

    def collections_path() -> Path:
        return root() / "_collections.json"

    @router.get("/collections")
    async def get_collections():
        data = _json_read(collections_path(), [])
        return {"collections": data if isinstance(data, list) else []}

    @router.put("/collections")
    async def put_collections(payload: CollectionsPayload):
        if len(payload.collections) > 200:
            raise HTTPException(status_code=400, detail="Too many collections")
        clean: list[dict[str, Any]] = []
        seen: set[str] = set()
        for c in payload.collections:
            name = str(c.get("name") or "").strip()[:80]
            if not name:
                continue
            cid = str(c.get("id") or "")
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", cid) or cid in seen:
                cid = f"c_{secrets.token_hex(4)}"
            seen.add(cid)
            slugs = [s for s in (c.get("slugs") or []) if isinstance(s, str) and SLUG_RE.fullmatch(s)]
            entry: dict[str, Any] = {"id": cid, "name": name, "slugs": list(dict.fromkeys(slugs))}
            parent = c.get("parent")
            if isinstance(parent, str) and parent:
                entry["parent"] = parent
            if isinstance(c.get("zotero_key"), str) and c["zotero_key"]:
                entry["zotero_key"] = c["zotero_key"][:40]
            clean.append(entry)
        ids = {c["id"] for c in clean}
        by_id = {c["id"]: c for c in clean}
        for c in clean:  # drop dangling / self / cyclic parents
            par, hops = c.get("parent"), 0
            while par and hops < 50:
                if par == c["id"] or par not in ids:
                    c.pop("parent", None)
                    break
                par, hops = by_id[par].get("parent"), hops + 1
            else:
                if par:
                    c.pop("parent", None)
        _json_write(collections_path(), clean)
        return {"ok": True, "collections": clean}

    def log_path() -> Path:
        return get_vault() / "60-Meta" / "reading-log.json"

    def load_log() -> dict[str, Any]:
        data = _json_read(log_path(), {})
        if not isinstance(data, dict):
            data = {}
        goal = data.get("goal_minutes")
        data["goal_minutes"] = goal if isinstance(goal, int) and 1 <= goal <= 600 else DEFAULT_GOAL_MINUTES
        if not isinstance(data.get("days"), dict):
            data["days"] = {}
        return data

    @router.put("/goal")
    async def put_goal(payload: GoalPayload):
        if not 1 <= payload.minutes <= 600:
            raise HTTPException(status_code=400, detail="Goal must be between 1 and 600 minutes")
        log = load_log()
        log["goal_minutes"] = payload.minutes
        _json_write(log_path(), log)
        return {"ok": True, "goal_minutes": payload.minutes}

    def sync_habits(entry: dict[str, Any], day: str, goal_minutes: int) -> bool:
        """Tick dashboard habits once per day when a threshold is reached. Returns True if 'Extra reading' was ticked now."""
        ticked_extra = False
        if int(entry.get("seconds") or 0) >= goal_minutes * 60 and not entry.get("habit_synced"):
            try:
                write_habits(day, {"extra_read": True})
                entry["habit_synced"] = True
                ticked_extra = True
            except Exception:
                pass  # a convenience; never fail the log over it
        for cat, (habit, flag, minutes) in HABIT_RULES.items():
            if int(entry.get(TIME_CATEGORIES[cat]) or 0) >= minutes * 60 and not entry.get(flag):
                try:
                    write_habits(day, {habit: True})
                    entry[flag] = True
                except Exception:
                    pass
        return ticked_extra

    @router.post("/time")
    async def post_time(payload: TimePayload):
        """Active time spent on papers or writing (books go through /session). Called every minute by the page timers."""
        field = TIME_CATEGORIES.get(payload.category)
        if not field:
            raise HTTPException(status_code=400, detail="category must be 'books', 'papers' or 'writing'")
        if not 1 <= payload.seconds <= MAX_SESSION_SECONDS:
            raise HTTPException(status_code=400, detail="seconds out of range")
        today_server = date.today()
        day = _iso(payload.date) if payload.date else today_server.strftime("%Y-%m-%d")
        if abs((date.fromisoformat(day) - today_server).days) > 1:
            raise HTTPException(status_code=400, detail="date must be today")
        log = load_log()
        entry = log["days"].setdefault(day, {"seconds": 0, "books": {}})
        entry[field] = int(entry.get(field) or 0) + payload.seconds
        sync_habits(entry, day, log["goal_minutes"])
        _json_write(log_path(), log)
        return {"ok": True, "date": day, "category": payload.category, "seconds": entry[field]}

    @router.get("/history")
    async def get_history(today: Optional[str] = None, days: int = 90):
        """Per-day totals (newest first) for the dashboard card's day browser."""
        day = _iso(today) if today else date.today().strftime("%Y-%m-%d")
        end = date.fromisoformat(day)
        log = load_log()
        goal_s = log["goal_minutes"] * 60
        out = []
        for i in range(max(1, min(days, 366))):
            d = end - timedelta(days=i)
            e = log["days"].get(d.strftime("%Y-%m-%d")) or {}
            books = int(e.get("seconds") or 0)
            out.append({
                "date": d.strftime("%Y-%m-%d"),
                "books": books,
                "papers": int(e.get("papers_seconds") or 0),
                "writing": int(e.get("writing_seconds") or 0),
                "goal_met": books >= goal_s,
            })
        return {"goal_minutes": log["goal_minutes"], "days": out}

    @router.post("/session")
    async def post_session(payload: SessionPayload):
        """Add active reading time (and the page reached) to a day. Called by the reader every minute."""
        d = existing_book(payload.slug)
        if not 1 <= payload.seconds <= MAX_SESSION_SECONDS:
            raise HTTPException(status_code=400, detail="seconds out of range")
        today_server = date.today()
        day = _iso(payload.date) if payload.date else today_server.strftime("%Y-%m-%d")
        if abs((date.fromisoformat(day) - today_server).days) > 1:
            raise HTTPException(status_code=400, detail="date must be today")
        log = load_log()
        entry = log["days"].setdefault(day, {"seconds": 0, "books": {}})
        entry["seconds"] = int(entry.get("seconds") or 0) + payload.seconds
        b = entry.setdefault("books", {}).setdefault(payload.slug, {"seconds": 0})
        b["seconds"] = int(b.get("seconds") or 0) + payload.seconds
        if payload.page and payload.page > 0:
            b["first_page"] = min(int(b.get("first_page") or payload.page), payload.page)
            b["last_page"] = payload.page
        goal_met = entry["seconds"] >= log["goal_minutes"] * 60
        synced = sync_habits(entry, day, log["goal_minutes"])
        _json_write(log_path(), log)
        write_book_md(d, {"last_opened": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        return {"ok": True, "date": day, "seconds": entry["seconds"], "goal_met": goal_met, "habit_synced": synced}

    @router.get("/goal")
    async def get_goal(today: Optional[str] = None):
        """Everything the dashboard card and the Goals screen need, in one call. `today` = the client's local date."""
        day = _iso(today) if today else date.today().strftime("%Y-%m-%d")
        today_d = date.fromisoformat(day)
        log = load_log()
        goal_s = log["goal_minutes"] * 60
        days = log["days"]

        def secs(d: date) -> int:
            return int((days.get(d.strftime("%Y-%m-%d")) or {}).get("seconds") or 0)

        met = {k for k, v in days.items() if int((v or {}).get("seconds") or 0) >= goal_s}
        # current streak: ends today if today is met, otherwise yesterday (today is still in progress)
        cur = today_d if day in met else today_d - timedelta(days=1)
        streak = 0
        while cur.strftime("%Y-%m-%d") in met:
            streak += 1
            cur -= timedelta(days=1)
        record = 0
        run = 0
        prev: Optional[date] = None
        for k in sorted(met):
            kd = date.fromisoformat(k)
            run = run + 1 if prev is not None and (kd - prev).days == 1 else 1
            record = max(record, run)
            prev = kd
        record = max(record, streak)

        monday = today_d - timedelta(days=today_d.weekday())
        letters = ["M", "T", "W", "T", "F", "S", "S"]
        week = []
        for i in range(7):
            d = monday + timedelta(days=i)
            k = d.strftime("%Y-%m-%d")
            s = secs(d)
            state = "today" if d == today_d else ("future" if d > today_d else ("done" if k in met else "missed"))
            week.append({"date": k, "letter": letters[i], "seconds": s, "met": k in met, "state": state})

        today_entry = days.get(day) or {}
        pages_today = sum(
            max(0, int(b.get("last_page") or 0) - int(b.get("first_page") or 0) + 1)
            for b in (today_entry.get("books") or {}).values()
            if b.get("last_page")
        )
        pages_week = 0
        for i in range(7):
            e = days.get((monday + timedelta(days=i)).strftime("%Y-%m-%d")) or {}
            pages_week += sum(
                max(0, int(b.get("last_page") or 0) - int(b.get("first_page") or 0) + 1)
                for b in (e.get("books") or {}).values()
                if b.get("last_page")
            )

        books = []
        base = root()
        if base.exists():
            for d in sorted(p for p in base.iterdir() if p.is_dir()):
                s = summary(d)
                if s:
                    books.append(s)
        reading = [b for b in books if b["status"] == "reading" and b["has_file"]]
        reading.sort(key=lambda b: b.get("last_opened") or "", reverse=True)
        current = reading[0] if reading else None
        year_prefix = f"{today_d.year}-"

        def week_sum(field: str) -> int:
            return sum(int((days.get((monday + timedelta(days=i)).strftime("%Y-%m-%d")) or {}).get(field) or 0) for i in range(7))

        time_today = {
            "books": int(today_entry.get("seconds") or 0),
            "papers": int(today_entry.get("papers_seconds") or 0),
            "writing": int(today_entry.get("writing_seconds") or 0),
        }
        time_week = {
            "books": sum(w["seconds"] for w in week),
            "papers": week_sum("papers_seconds"),
            "writing": week_sum("writing_seconds"),
        }
        return {
            "time_today": time_today,
            "time_week": time_week,
            "date": day,
            "goal_minutes": log["goal_minutes"],
            "today_seconds": int(today_entry.get("seconds") or 0),
            "goal_met": day in met,
            "streak": streak,
            "record": record,
            "week": week,
            "week_seconds": sum(w["seconds"] for w in week),
            "pages_today": pages_today,
            "pages_week": pages_week,
            "highlights_total": sum(b["highlights"] for b in books),
            "finished_this_year": sum(1 for b in books if b["status"] == "finished" and str(b.get("finished") or "").startswith(year_prefix)),
            "reading_count": sum(1 for b in books if b["status"] == "reading"),
            "current": (
                {k: current[k] for k in ("slug", "title", "format", "progress", "last_page", "total_pages")}
                if current
                else None
            ),
        }

    # ── References (papers, citation-only books, BibTeX/RIS import & export) ──

    def all_summaries() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        base = root()
        if base.exists():
            for d in sorted(p for p in base.iterdir() if p.is_dir()):
                s = summary(d)
                if s:
                    out.append(s)
        return out

    def find_duplicate(fields: dict[str, Any]) -> Optional[dict[str, Any]]:
        doi = citations.norm_doi(fields.get("doi"))
        arx = citations.norm_arxiv(fields.get("arxiv"))
        title = citations.norm_title(fields.get("title") or "")
        for s in all_summaries():
            if doi and citations.norm_doi(s["doi"]) == doi:
                return s
            if arx and citations.norm_arxiv(s["arxiv"]) == arx:
                return s
            if title and len(title) > 12 and citations.norm_title(s["title"]) == title:
                return s
        return None

    def add_to_collection(slug: str, collection: Optional[str]) -> None:
        if not collection:
            return
        cols = _json_read(collections_path(), [])
        if isinstance(cols, list):
            for c in cols:
                if isinstance(c, dict) and c.get("id") == collection and slug not in (c.get("slugs") or []):
                    c["slugs"] = [*(c.get("slugs") or []), slug]
            _json_write(collections_path(), cols)

    def create_item(p: ItemCreate) -> tuple[dict[str, Any], bool]:
        title = p.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        fields = p.model_dump()
        dup = find_duplicate(fields)
        if dup:
            add_to_collection(dup["slug"], p.collection)
            return dup, True
        slug = unique_slug(slugify(title))
        d = book_dir(slug)
        d.mkdir(parents=True)
        kind = "book" if p.kind == "book" else "paper"
        meta: dict[str, Any] = {
            "type": "book",
            "kind": kind,
            "slug": slug,
            "title": title[:300],
            "authors": [a.strip() for a in p.authors if a.strip()][:60],
            "year": p.year,
            "has_tracks": False,
            "total_sections": None,
            "started": date.today().strftime("%Y-%m-%d"),
            "added": date.today().strftime("%Y-%m-%d"),
            "status": "want",
            "total_pages": None,
            "last_page": 0,
            "progress": 0,
            "tags": sorted({t.strip()[:60] for t in p.tags if t.strip()})[:60],
        }
        if p.item_type in citations.ITEM_TYPES:
            meta["item_type"] = p.item_type
        for f in ("venue", "doi", "arxiv", "url", "publisher", "volume", "issue", "pages", "abstract"):
            v = getattr(p, f)
            if v:
                meta[f] = str(v).strip()[:20000 if f == "abstract" else 500]
        for f in ("citekey", "notes", "zotero_key"):
            v = getattr(p, f)
            if v:
                meta[f] = str(v).strip()[:20000 if f == "notes" else 500]
        write_book_md(d, meta)
        add_to_collection(slug, p.collection)
        return summary(d) or {}, False

    def pdf_url_for(p: dict[str, Any]) -> str:
        if p.get("pdf_url"):
            return p["pdf_url"]
        if p.get("arxiv"):
            return f"https://arxiv.org/pdf/{citations.norm_arxiv(p['arxiv'])}"
        return ""

    @router.post("/items")
    async def add_item(payload: ItemCreate):
        item, existed = await run_in_threadpool(create_item, payload)
        got_pdf = bool(item.get("has_file"))
        if not existed and payload.fetch_pdf and not got_pdf:
            url = pdf_url_for(payload.model_dump())
            if url:
                d = book_dir(item["slug"])
                if await run_in_threadpool(download_pdf, url, d / "book.pdf"):
                    write_book_md(d, {"format": "pdf"})
                    item = summary(d) or item
                    got_pdf = True
        return {"ok": True, "duplicate": existed, "pdf_saved": got_pdf, "book": item}

    @router.post("/items/{slug}/fetch-pdf")
    async def fetch_item_pdf(slug: str, url: str = ""):
        d = existing_book(slug)
        s = summary(d) or {}
        target = url or pdf_url_for(s)
        if not target:
            raise HTTPException(status_code=400, detail="No PDF link known — add an arXiv id or paste a URL")
        if not await run_in_threadpool(download_pdf, target, d / "book.pdf"):
            raise HTTPException(status_code=502, detail="Could not download a PDF from that link")
        write_book_md(d, {"format": "pdf", "total_pages": None, "last_page": 0, "progress": 0})
        return {"ok": True, "book": summary(d)}

    @router.get("/lookup")
    async def lookup(q: str):
        try:
            return {"item": await run_in_threadpool(lookup_metadata, q)}
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception:
            raise HTTPException(status_code=502, detail="Lookup failed — check your connection and the identifier")

    @router.post("/import-refs")
    async def import_refs(payload: ImportRefs):
        text = payload.text or ""
        if len(text) > 5_000_000:
            raise HTTPException(status_code=413, detail="File too large")
        fmt = (payload.format or ("ris" if re.search(r"^TY  - ", text, re.M) else "bibtex")).lower()
        parsed = citations.parse_ris(text) if fmt == "ris" else citations.parse_bibtex(text)
        if not parsed:
            raise HTTPException(status_code=400, detail="No references found in that file")
        added = dupes = 0
        for it in parsed[:2000]:
            item, existed = create_item(ItemCreate(
                title=it["title"], kind="paper", authors=it.get("authors", []), year=it.get("year"), item_type=it.get("item_type"),
                venue=it.get("venue"), doi=it.get("doi"), arxiv=it.get("arxiv"), url=it.get("url"), publisher=it.get("publisher"),
                volume=it.get("volume"), issue=it.get("issue"), pages=it.get("pages"), abstract=it.get("abstract"),
                tags=it.get("tags", []), collection=payload.collection, fetch_pdf=False,
            ))
            if existed:
                dupes += 1
            else:
                added += 1
                if it.get("citekey") and item.get("slug"):
                    write_book_md(book_dir(item["slug"]), {"citekey": it["citekey"]})
        return {"ok": True, "added": added, "duplicates": dupes}

    @router.get("/export")
    async def export_refs(format: str = "bibtex", collection: Optional[str] = None, slugs: Optional[str] = None):
        items = all_summaries()
        if collection:
            cols = _json_read(collections_path(), [])
            members = next((c.get("slugs") or [] for c in cols if isinstance(c, dict) and c.get("id") == collection), [])
            items = [i for i in items if i["slug"] in members]
        elif slugs:
            want = set(slugs.split(","))
            items = [i for i in items if i["slug"] in want]
        if not items:
            raise HTTPException(status_code=404, detail="Nothing to export")
        try:
            text, media, ext = citations.render(items, format)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        from fastapi.responses import Response
        return Response(content=text, media_type=f"{media}; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="references.{ext}"'})

    @router.get("/{slug}/cite")
    async def cite(slug: str, style: str = "apa"):
        d = existing_book(slug)
        s = summary(d) or {}
        try:
            text, _, _ = citations.render([s], style)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"style": style, "text": text.strip(), "citekey": citations.citekey_of(s)}

    # ── Saved searches ──

    @router.get("/searches")
    async def get_searches():
        data = _json_read(root() / "_searches.json", [])
        return {"searches": data if isinstance(data, list) else []}

    @router.put("/searches")
    async def put_searches(payload: SearchesPayload):
        clean = []
        for x in payload.searches[:100]:
            name, q = str(x.get("name") or "").strip()[:80], str(x.get("q") or "").strip()[:300]
            if name and q:
                sid = str(x.get("id") or "")
                clean.append({"id": sid if re.fullmatch(r"[A-Za-z0-9_-]{1,40}", sid) else f"s_{secrets.token_hex(4)}", "name": name, "q": q})
        _json_write(root() / "_searches.json", clean)
        return {"ok": True, "searches": clean}

    # ── Merge duplicates ──

    @router.post("/merge")
    async def merge_items(payload: MergePayload):
        dk = existing_book(payload.keep)
        fk = dict(frontmatter.load(str(dk / "_book.md")).metadata)
        removed = 0
        for r in payload.remove:
            if r == payload.keep:
                continue
            dr = existing_book(r)
            fr = dict(frontmatter.load(str(dr / "_book.md")).metadata)
            upd: dict[str, Any] = {}
            for f in (*ITEM_FIELDS, "year"):
                if not fk.get(f) and fr.get(f):
                    upd[f] = fr[f]
            if not fk.get("authors") and fr.get("authors"):
                upd["authors"] = fr["authors"]
            upd["tags"] = sorted({*(fk.get("tags") or []), *(fr.get("tags") or [])})
            upd["related"] = [x for x in dict.fromkeys([*(fk.get("related") or []), *(fr.get("related") or [])]) if x not in (payload.keep, r)]
            if fr.get("favorite"):
                upd["favorite"] = True
            if fk.get("notes") and fr.get("notes") and fr["notes"] not in fk["notes"]:
                upd["notes"] = f"{fk['notes']}\n\n{fr['notes']}"
            if not book_file(dk) and (src := book_file(dr)):
                os.replace(src[0], dk / src[0].name)
                upd["format"] = src[1]
                for extra in ("annotations.json", "highlights.json"):
                    if (dr / extra).is_file() and not (dk / extra).exists():
                        os.replace(dr / extra, dk / extra)
            if not cover_file(dk) and (cv := cover_file(dr)):
                os.replace(cv, dk / cv.name)
            write_book_md(dk, upd)
            fk.update(upd)
            cols = _json_read(collections_path(), [])
            if isinstance(cols, list):
                for c in cols:
                    if isinstance(c, dict) and r in (c.get("slugs") or []):
                        c["slugs"] = list(dict.fromkeys(payload.keep if x == r else x for x in c["slugs"]))
                _json_write(collections_path(), cols)
            purge(r)
            removed += 1
        for o in fk.get("related") or []:
            link_related(o, payload.keep, True)
        return {"ok": True, "removed": removed, "book": summary(dk)}

    # ── LaTeX bibliography (70-LaTeX/{project}/references.bib) ──

    @router.post("/latex-bib")
    async def latex_bib(payload: LatexBibPayload):
        project = next((p for p in payload.project.replace("\\", "/").split("/") if p), "")
        if project and (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._ \-]*", project) or project.startswith("..")):
            raise HTTPException(status_code=400, detail="Invalid project folder")
        base = (get_vault() / "70-LaTeX" / project).resolve()
        if not str(base).startswith(str((get_vault() / "70-LaTeX").resolve())):
            raise HTTPException(status_code=400, detail="Invalid project folder")
        bib = base / "references.bib"
        existing = bib.read_text(encoding="utf-8", errors="replace") if bib.is_file() else ""
        have = set(re.findall(r"@\w+\s*\{\s*([^,\s]+)\s*,", existing))
        summaries = all_summaries()
        used = {s["citekey"] for s in summaries if s["citekey"]}
        keys: dict[str, str] = {}
        blocks: list[str] = []
        for slug in payload.slugs[:200]:
            d = existing_book(slug)
            item = summary(d) or {}
            key = item.get("citekey") or ""
            if not key:
                base_key, n = citations.make_citekey(item), 0
                key = base_key
                while key in used:
                    n += 1
                    key = f"{base_key}{chr(96 + n) if n < 27 else n}"
                write_book_md(d, {"citekey": key})
                used.add(key)
            keys[slug] = key
            if key not in have:
                blocks.append(citations.to_bibtex({**item, "citekey": key}))
                have.add(key)
        if blocks:
            base.mkdir(parents=True, exist_ok=True)
            bib.write_text(existing.rstrip() + ("\n\n" if existing.strip() else "") + "\n\n".join(blocks) + "\n", encoding="utf-8")
        return {"ok": True, "keys": keys, "added": len(blocks), "path": f"70-LaTeX/{project + '/' if project else ''}references.bib"}

    # ── Import from a Zotero library (web API) ──

    zstate: dict[str, Any] = {"running": False, "phase": "idle", "done": 0, "total": 0, "added": 0, "duplicates": 0, "pdfs": 0, "collections": 0, "error": ""}

    def zotero_job(with_pdfs: bool) -> None:
        import httpx
        import zotero as zlib

        uid, key = zlib.zotero_credentials()
        headers = {"Zotero-API-Key": key, "Zotero-API-Version": "3"}
        client = httpx.Client(timeout=60, follow_redirects=True, headers=headers)

        def pages(path: str, params: Optional[dict[str, Any]] = None):
            start = 0
            while True:
                r = client.get(f"https://api.zotero.org/users/{uid}/{path}", params={"limit": 100, "start": start, **(params or {})})
                r.raise_for_status()
                rows = r.json()
                yield from rows
                if len(rows) < 100:
                    return
                start += 100

        try:
            zstate.update(running=True, phase="collections", done=0, total=0, added=0, duplicates=0, pdfs=0, collections=0, error="")
            zcols = {c["key"]: c["data"] for c in pages("collections")}
            ours = _json_read(collections_path(), [])
            ours = ours if isinstance(ours, list) else []
            zmap: dict[str, str] = {}
            for zk, cd in zcols.items():
                existing = next((c for c in ours if c.get("zotero_key") == zk), None)
                if existing:
                    zmap[zk] = existing["id"]
                    continue
                cid = f"c_{secrets.token_hex(4)}"
                ours.append({"id": cid, "name": (cd.get("name") or "Untitled")[:80], "slugs": [], "zotero_key": zk})
                zmap[zk] = cid
                zstate["collections"] += 1
            for c in ours:
                zk = c.get("zotero_key")
                par = zcols.get(zk, {}).get("parentCollection") if zk else None
                if par and par in zmap:
                    c["parent"] = zmap[par]
            _json_write(collections_path(), ours)

            zstate["phase"] = "notes"
            notes: dict[str, list[str]] = {}
            attachments: dict[str, str] = {}
            for row in pages("items", {"itemType": "note || attachment"}):
                d = row["data"]
                parent = d.get("parentItem")
                if not parent:
                    continue
                if d.get("itemType") == "note":
                    notes.setdefault(parent, []).append(_strip_html(d.get("note", "")))
                elif d.get("contentType") == "application/pdf" and d.get("linkMode") in ("imported_file", "imported_url"):
                    attachments.setdefault(parent, d["key"])

            zstate["phase"] = "items"
            known = {x["zotero_key"]: x for x in all_summaries() if x.get("zotero_key")}
            rows = [r for r in pages("items/top")]
            zstate["total"] = len(rows)
            for row in rows:
                d = row["data"]
                f = zotero_item_fields(d)
                zstate["done"] += 1
                if not f:
                    continue
                nts = "\n\n".join(n for n in notes.get(d["key"], []) if n)
                if d.get("extra") and not re.fullmatch(r"\s*(Citation Key:\s*\S+\s*)+", d["extra"]):
                    nts = (nts + "\n\n" if nts else "") + d["extra"]
                dup = known.get(d["key"])
                col_ids = [zmap[c] for c in d.get("collections", []) if c in zmap]
                item_in = ItemCreate(
                    title=f["title"], kind=f.pop("kind"), authors=f["authors"], year=f["year"], item_type=f["item_type"], venue=f["venue"], doi=f["doi"],
                    arxiv=f["arxiv"], url=f["url"], publisher=f["publisher"], volume=f["volume"], issue=f["issue"], pages=f["pages"], abstract=f["abstract"],
                    tags=f["tags"], fetch_pdf=False, citekey=f["citekey"], notes=nts or None, zotero_key=f["zotero_key"],
                )
                item, existed = (dup, True) if dup else create_item(item_in)
                known[d["key"]] = item
                zstate["duplicates" if existed else "added"] += 1
                slug = item["slug"]
                for cid in col_ids:
                    add_to_collection(slug, cid)
                if with_pdfs and not item.get("has_file") and d["key"] in attachments:
                    zstate["phase"] = "pdfs"
                    try:
                        r = client.get(f"https://api.zotero.org/users/{uid}/items/{attachments[d['key']]}/file")
                        if r.status_code == 200 and r.content[:5] == b"%PDF-" and len(r.content) <= MAX_PDF_BYTES:
                            (book_dir(slug) / "book.pdf").write_bytes(r.content)
                            write_book_md(book_dir(slug), {"format": "pdf"})
                            zstate["pdfs"] += 1
                    except Exception:
                        pass
                    zstate["phase"] = "items"
            zstate["phase"] = "done"
        except Exception as e:  # noqa: BLE001
            zstate["error"] = f"Zotero import failed: {str(e)[:200]}"
            zstate["phase"] = "error"
        finally:
            zstate["running"] = False

    @router.post("/import-zotero")
    async def import_zotero(payload: ZoteroImportPayload):
        import zotero as zlib

        if not all(zlib.zotero_credentials()):
            raise HTTPException(status_code=400, detail="Zotero isn’t connected yet — open Settings → Zotero and add your user ID and API key.")
        if zstate["running"]:
            return {"ok": True, "started": False, **zstate}
        threading.Thread(target=zotero_job, args=(payload.with_pdfs,), daemon=True).start()
        zstate.update(running=True, phase="starting", error="")
        return {"ok": True, "started": True, **zstate}

    @router.get("/import-zotero/status")
    async def import_zotero_status():
        return dict(zstate)

    # ── Two-way annotation sync with Zotero ──

    asy: dict[str, Any] = {}

    def asy_reset() -> None:
        asy.clear()
        asy.update(running=False, phase="idle", done=0, total=0, pulled=0, pushed=0, updated_local=0, updated_remote=0, deleted_local=0,
                     deleted_remote=0, needs_open=0, unsupported=0, unlinked=0, no_pdf=0, failed=0, error="", items=0)

    asy_reset()

    def annotation_sync_job() -> None:
        import httpx
        import zotero as zlib
        import zotero_annotations as za

        uid, key = zlib.zotero_credentials()
        client = httpx.Client(timeout=60, follow_redirects=True, headers={"Zotero-API-Key": key, "Zotero-API-Version": "3"})
        base = f"https://api.zotero.org/users/{uid}"

        def pages(path: str, params: Optional[dict[str, Any]] = None):
            start = 0
            while True:
                r = client.get(f"{base}/{path}", params={"limit": 100, "start": start, **(params or {})})
                r.raise_for_status()
                rows = r.json()
                yield from rows
                if len(rows) < 100:
                    return
                start += 100

        def fail(msg: str, n: int = 1) -> None:
            asy["failed"] += n
            asy["error"] = asy["error"] or msg

        try:
            asy_reset()
            asy.update(running=True, phase="reading Zotero")
            atts: dict[str, tuple[str, bool]] = {}
            for row in pages("items", {"itemType": "attachment"}):
                d = row["data"]
                parent = d.get("parentItem")
                if parent and d.get("contentType") == "application/pdf":
                    imported = d.get("linkMode") in ("imported_file", "imported_url")
                    if parent not in atts or (imported and not atts[parent][1]):
                        atts[parent] = (row["key"], imported)
            by_att: dict[str, list[dict[str, Any]]] = {}
            for row in pages("items", {"itemType": "annotation"}):
                d = row["data"]
                if d.get("parentItem"):
                    by_att.setdefault(d["parentItem"], []).append({"key": row["key"], "version": row["version"], "data": d})

            asy["phase"] = "syncing"
            summaries = all_summaries()
            asy["total"] = len(summaries)
            for item in summaries:
                asy["done"] += 1
                slug = item["slug"]
                d = book_dir(slug)
                ann_path, st_path = d / "annotations.json", d / "zotero-sync.json"
                doc = _json_read(ann_path, {})
                doc = doc if isinstance(doc, dict) else {}
                local = [a for a in (doc.get("annotations") or []) if isinstance(a, dict) and a.get("id")]
                zk = item.get("zotero_key")
                if not zk:
                    asy["unlinked"] += 1 if local else 0
                    continue
                att = atts.get(zk, ("", False))[0]
                if not att:
                    asy["no_pdf"] += 1 if local else 0
                    continue
                remote_rows = by_att.get(att, [])
                if not local and not remote_rows:
                    continue
                state = _json_read(st_path, {})
                state_items = state.get("items", {}) if isinstance(state, dict) and state.get("att") == att else {}
                plan = za.merge(local, remote_rows, state_items, att)
                anns, st = plan["annotations"], plan["state"]
                by_id = {a["id"]: a for a in anns}
                st_stats = plan["stats"]

                creates = plan["create"]
                for i in range(0, len(creates), 50):
                    chunk = creates[i:i + 50]
                    r = client.post(f"{base}/items", json=[p for _, p in chunk], headers={"Zotero-Write-Token": secrets.token_hex(16)})
                    if r.status_code != 200:
                        fail(f"Zotero rejected new annotations ({r.status_code}): {r.text[:160]}", len(chunk))
                        continue
                    j = r.json()
                    for idx, ok in (j.get("successful") or {}).items():
                        a = by_id.get(chunk[int(idx)][0])
                        new_key = ok.get("key") or (ok.get("data") or {}).get("key")
                        if a is not None and new_key:
                            a["zkey"] = new_key
                            st[new_key] = {"version": ok.get("version") or (ok.get("data") or {}).get("version") or 0, "hash": za.local_hash(a)}
                            asy["pushed"] += 1
                    for idx, bad in (j.get("failed") or {}).items():
                        fail(f"Zotero rejected an annotation: {str(bad.get('message', ''))[:160]}")
                for zkey_, ver, payload in plan["update"]:
                    a = next((x for x in anns if x.get("zkey") == zkey_), None)
                    body = {k: v for k, v in payload.items() if k not in ("itemType", "parentItem", "tags")}
                    r = client.patch(f"{base}/items/{zkey_}", json=body, headers={"If-Unmodified-Since-Version": str(ver)})
                    if r.status_code in (200, 204) and a is not None:
                        st[zkey_] = {"version": int(r.headers.get("Last-Modified-Version", ver + 1)), "hash": za.local_hash(a)}
                        asy["updated_remote"] += 1
                    else:
                        fail(f"Couldn’t update an annotation in Zotero ({r.status_code}) — try again after the next sync.")
                        if zkey_ in state_items:
                            st[zkey_] = state_items[zkey_]
                for zkey_, ver in plan["delete"]:
                    r = client.delete(f"{base}/items/{zkey_}", headers={"If-Unmodified-Since-Version": str(ver)})
                    if r.status_code not in (200, 204):
                        fail(f"Couldn’t delete an annotation in Zotero ({r.status_code}).")
                        st_stats["deleted_remote"] -= 1
                        if zkey_ in state_items:
                            st[zkey_] = state_items[zkey_]

                for k in ("pulled", "updated_local", "deleted_local", "deleted_remote", "needs_open", "unsupported"):
                    asy[k] += st_stats[k]
                if anns != local:
                    ann_path.parent.mkdir(parents=True, exist_ok=True)
                    _json_write(ann_path, {**({"key": f"book-{slug}", "title": item.get("title", ""), "url": ""} if not doc else doc), "annotations": anns})
                _json_write(st_path, {"att": att, "items": st, "synced": datetime.now(timezone.utc).isoformat()})
                asy["items"] += 1
            asy["phase"] = "done"
        except Exception as e:  # noqa: BLE001
            asy["error"] = f"Annotation sync failed: {str(e)[:200]}"
            asy["phase"] = "error"
        finally:
            asy["running"] = False

    @router.post("/sync-annotations")
    async def sync_annotations():
        import zotero as zlib

        if not all(zlib.zotero_credentials()):
            raise HTTPException(status_code=400, detail="Zotero isn’t connected yet — open Settings → Zotero and add your user ID and API key.")
        if asy["running"]:
            return {"ok": True, "started": False, **asy}
        asy.update(running=True, phase="starting", error="")
        threading.Thread(target=annotation_sync_job, daemon=True).start()
        return {"ok": True, "started": True, **asy}

    @router.get("/sync-annotations/status")
    async def sync_annotations_status():
        return dict(asy)

    # ── One book ──

    @router.get("/{slug}/file")
    async def get_file(slug: str):
        d = existing_book(slug)
        found = book_file(d)
        if not found:
            raise HTTPException(status_code=404, detail="No file attached to this book")
        path, fmt = found
        return FileResponse(path, media_type=MEDIA_TYPES[fmt], headers={"Content-Disposition": f'inline; filename="{slug}.{fmt}"'})

    @router.post("/{slug}/file")
    async def attach_file(slug: str, file: UploadFile = File(...)):
        """Attach a PDF/EPUB to a book that so far only has section notes."""
        d = existing_book(slug)
        ext = Path(file.filename or "").suffix.lower()
        if ext not in FORMATS:
            raise HTTPException(status_code=400, detail="Unsupported file. Use a .pdf or .epub book.")
        for other in FORMATS:
            if other != ext and (d / f"book{other}").exists():
                (d / f"book{other}").unlink()
        await save_upload(file, d / f"book{ext}", MAX_BOOK_BYTES)
        write_book_md(d, {"format": FORMATS[ext], "total_pages": None, "last_page": 0, "progress": 0, "last_position": ""})
        return {"ok": True, "book": summary(d)}

    @router.get("/{slug}/cover")
    async def get_cover(slug: str):
        d = existing_book(slug)
        p = cover_file(d)
        if not p:
            raise HTTPException(status_code=404, detail="No cover")
        return FileResponse(p, media_type=COVER_TYPES[p.suffix.lower()], headers={"Cache-Control": "private, max-age=300"})

    @router.post("/{slug}/cover")
    async def put_cover(slug: str, cover: UploadFile = File(...)):
        d = existing_book(slug)
        cext = Path(cover.filename or "").suffix.lower()
        if cext not in COVER_TYPES:
            raise HTTPException(status_code=400, detail="Cover must be a JPG, PNG or WebP image")
        for ext in COVER_TYPES:
            if (d / f"cover{ext}").exists():
                (d / f"cover{ext}").unlink()
        await save_upload(cover, d / f"cover{'.jpg' if cext == '.jpeg' else cext}", MAX_COVER_BYTES)
        return {"ok": True}

    @router.patch("/{slug}")
    async def patch_book(slug: str, payload: BookPatch):
        d = existing_book(slug)
        updates: dict[str, Any] = {}
        if payload.title is not None:
            if not payload.title.strip():
                raise HTTPException(status_code=400, detail="Title cannot be empty")
            updates["title"] = payload.title.strip()[:200]
        if payload.authors is not None:
            updates["authors"] = [a.strip() for a in payload.authors if a.strip()][:12]
        if payload.year is not None:
            updates["year"] = payload.year
        if payload.total_pages is not None and payload.total_pages > 0:
            updates["total_pages"] = payload.total_pages
        if payload.last_page is not None and payload.last_page >= 0:
            updates["last_page"] = payload.last_page
        if payload.last_position is not None:
            updates["last_position"] = payload.last_position[:2000]
        if payload.progress is not None:
            updates["progress"] = max(0.0, min(1.0, payload.progress))
        for f in ITEM_FIELDS:
            v = getattr(payload, f)
            if v is not None:
                if f == "item_type" and v not in citations.ITEM_TYPES:
                    raise HTTPException(status_code=400, detail="Invalid item type")
                updates[f] = v.strip()[:20000] if f in ("abstract", "notes") else v.strip()[:500]
        if payload.tags is not None:
            updates["tags"] = sorted({t.strip()[:60] for t in payload.tags if t.strip()})[:60]
        if payload.favorite is not None:
            updates["favorite"] = payload.favorite
        if payload.kind is not None:
            if payload.kind not in ("paper", "book"):
                raise HTTPException(status_code=400, detail="Invalid kind")
            updates["kind"] = payload.kind
        if payload.related is not None:
            old = frontmatter.load(str(d / "_book.md")).metadata.get("related") or []
            new = [r for r in dict.fromkeys(payload.related) if r != slug and SLUG_RE.fullmatch(r) and (root() / r / "_book.md").is_file()]
            updates["related"] = new
            for other in set(new) - set(old):
                link_related(other, slug, True)
            for other in set(old) - set(new):
                link_related(other, slug, False)
        if payload.status is not None:
            if payload.status not in STATUSES:
                raise HTTPException(status_code=400, detail="Invalid status")
            updates["status"] = payload.status
            if payload.status == "finished":
                updates["finished"] = date.today().strftime("%Y-%m-%d")
                updates["progress"] = 1.0
        elif updates.get("progress") or updates.get("last_page"):
            current = summary(d)
            if current and current["status"] == "want":
                updates["status"] = "reading"
        if {"progress", "last_page", "last_position"} & updates.keys():
            updates["last_opened"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if updates:
            write_book_md(d, updates)
        return {"ok": True, "book": summary(d)}

    @router.delete("/{slug}")
    async def delete_book(slug: str):
        existing_book(slug)
        purge(slug)
        return {"ok": True, "slug": slug}

    @router.get("/{slug}/highlights")
    async def get_highlights(slug: str):
        d = existing_book(slug)
        data = _json_read(d / "highlights.json", {})
        items = data.get("highlights") if isinstance(data, dict) else []
        return {"highlights": items if isinstance(items, list) else []}

    @router.put("/{slug}/highlights")
    async def put_highlights(slug: str, payload: HighlightsPayload):
        d = existing_book(slug)
        if len(payload.highlights) > 5000:
            raise HTTPException(status_code=400, detail="Too many highlights")
        _json_write(d / "highlights.json", {"highlights": payload.highlights})
        return {"ok": True}

    return router
