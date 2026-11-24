"""zotero_push.py — write side of the Zotero sync (Yggdrasil -> Zotero Web API).

Pure API helpers: no vault access, so they are unit-testable with a fake HTTP client.
reading.py decides *what* to push; this module knows *how* Zotero wants it.

  create_collection(name, parent_key)        -> key
  find_existing_item(meta)                   -> key | None   (DOI / arXiv / title match, avoids duplicates)
  create_item(meta, collection_keys)         -> key
  add_to_collections(item_key, col_keys)     -> None         (union, never removes)
  list_attachment_keys(item_key)             -> {"application/pdf": key, ...}
  upload_attachment(item_key, path)          -> attachment key
"""
from __future__ import annotations

import hashlib
import mimetypes
import re
import secrets
import time
from pathlib import Path
from typing import Any, Callable, Optional

import httpx

from zotero import ZOTERO_API, explain_zotero_error, zotero_credentials

# Yggdrasil item_type -> Zotero itemType
TYPE_OUT = {
    "article": "journalArticle",
    "preprint": "preprint",
    "book": "book",
    "chapter": "bookSection",
    "conference": "conferencePaper",
    "thesis": "thesis",
    "report": "report",
    "webpage": "webpage",
}
# Where the venue / publisher live differs per Zotero type; the first one present in the item template wins.
VENUE_FIELDS = ("publicationTitle", "proceedingsTitle", "bookTitle", "websiteTitle", "repository")
PUBLISHER_FIELDS = ("publisher", "institution", "university")

_template_cache: dict[str, dict[str, Any]] = {}


class ZoteroPushError(RuntimeError):
    """A message a person can act on (already passed through explain_zotero_error).
    `permanent` = retrying will not help (file too large, Zotero storage full)."""

    def __init__(self, msg: str, permanent: bool = False):
        super().__init__(msg)
        self.permanent = permanent


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def norm_doi(s: str) -> str:
    return re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", (s or "").strip(), flags=re.I).lower()


class ZoteroClient:
    def __init__(self, user_id: str = "", api_key: str = "", client: Optional[httpx.Client] = None, sleep: Callable[[float], None] = time.sleep):
        if not (user_id and api_key):
            user_id, api_key = zotero_credentials()
        if not (user_id and api_key):
            raise ZoteroPushError("Zotero isn’t connected yet — open Settings → Zotero and add your user ID and API key.")
        self.uid = user_id
        self.key = api_key
        self.http = client or httpx.Client(timeout=60, follow_redirects=True)
        self._sleep = sleep

    # ── transport ──
    def _headers(self, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        return {"Zotero-API-Key": self.key, "Zotero-API-Version": "3", **(extra or {})}

    def request(self, method: str, path: str, *, ok: tuple[int, ...] = (200, 201, 204), **kw: Any) -> httpx.Response:
        url = path if path.startswith("http") else f"{ZOTERO_API}/users/{self.uid}/{path.lstrip('/')}"
        headers = self._headers(kw.pop("headers", None))
        for attempt in range(2):
            try:
                r = self.http.request(method, url, headers=headers, **kw)
            except httpx.HTTPError as e:
                raise ZoteroPushError(explain_zotero_error(e)) from e
            if r.status_code in (429, 503) and attempt == 0:
                try:
                    wait = min(15.0, float(r.headers.get("Retry-After") or r.headers.get("Backoff") or 2))
                except ValueError:
                    wait = 2.0
                self._sleep(wait)
                continue
            break
        if r.status_code not in ok:
            try:
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                msg = "Zotero storage is full — free some space at zotero.org/settings/storage." if r.status_code == 413 else explain_zotero_error(e)
                raise ZoteroPushError(msg, permanent=r.status_code == 413) from e
            raise ZoteroPushError(f"Zotero returned an unexpected answer ({r.status_code}).")
        return r

    def _post_objects(self, path: str, objs: list[dict[str, Any]]) -> str:
        """POST one object to /items or /collections and return its new key (Zotero answers 200 with per-object success/failure)."""
        r = self.request(
            "POST", path, json=objs,
            headers={"Content-Type": "application/json", "Zotero-Write-Token": secrets.token_hex(16)},
        )
        data = r.json()
        failed = data.get("failed") or {}
        if failed:
            first = next(iter(failed.values()), {})
            raise ZoteroPushError(f"Zotero rejected it: {str(first.get('message') or first)[:200]}")
        succ = data.get("successful") or {}
        first = next(iter(succ.values()), None)
        key = (first or {}).get("key") or (first or {}).get("data", {}).get("key")
        if not key:
            raise ZoteroPushError("Zotero accepted the request but returned no key.")
        return key

    # ── collections ──
    def list_collections(self) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        start = 0
        while True:
            rows = self.request("GET", "collections", params={"limit": 100, "start": start}).json()
            for c in rows:
                out[c["key"]] = c["data"]
            if len(rows) < 100:
                return out
            start += 100

    def create_collection(self, name: str, parent_key: str = "") -> str:
        return self._post_objects("collections", [{"name": name[:255], "parentCollection": parent_key or False}])

    # ── items ──
    def template(self, item_type: str) -> dict[str, Any]:
        if item_type not in _template_cache:
            r = self.http.get(f"{ZOTERO_API}/items/new", params={"itemType": item_type}, headers=self._headers())
            if r.status_code != 200:
                raise ZoteroPushError(f"Couldn’t load the Zotero template for {item_type} ({r.status_code}).")
            _template_cache[item_type] = r.json()
        return dict(_template_cache[item_type])

    def build_item(self, meta: dict[str, Any], collection_keys: list[str]) -> dict[str, Any]:
        ztype = TYPE_OUT.get(meta.get("item_type") or "", "")
        if not ztype:
            ztype = "preprint" if meta.get("arxiv") and not meta.get("venue") else ("book" if meta.get("kind") == "book" else "journalArticle")
        t = self.template(ztype)

        def put(names: tuple[str, ...] | str, value: Any) -> bool:
            if value in (None, "", []):
                return False
            for n in (names,) if isinstance(names, str) else names:
                if n in t:
                    t[n] = value
                    return True
            return False

        extra: list[str] = []
        put("title", meta.get("title", "")[:1000])
        put("abstractNote", meta.get("abstract", ""))
        put(VENUE_FIELDS, meta.get("venue", ""))
        put(PUBLISHER_FIELDS, meta.get("publisher", ""))
        put("volume", meta.get("volume", ""))
        put("issue", meta.get("issue", ""))
        put("pages", meta.get("pages", ""))
        if meta.get("year"):
            put("date", str(meta["year"]))
        arx = meta.get("arxiv", "")
        url = meta.get("url") or (f"https://arxiv.org/abs/{arx}" if arx else "")
        put("url", url)
        if meta.get("doi") and not put("DOI", meta["doi"]):
            extra.append(f"DOI: {meta['doi']}")
        if arx:
            if ztype == "preprint":
                t["archiveID"] = f"arXiv:{arx}"
                if "repository" in t and not t["repository"]:
                    t["repository"] = "arXiv"
            else:
                extra.append(f"arXiv: {arx}")
        if meta.get("citekey"):
            extra.append(f"Citation Key: {meta['citekey']}")
        if extra and "extra" in t:
            t["extra"] = "\n".join(extra)
        creators = []
        for name in meta.get("authors") or []:
            name = (name or "").strip()
            if not name:
                continue
            if "," in name:
                last, first = (p.strip() for p in name.split(",", 1))
            elif " " in name:
                first, last = name.rsplit(" ", 1)
            else:
                creators.append({"creatorType": "author", "name": name})
                continue
            creators.append({"creatorType": "author", "firstName": first, "lastName": last})
        if "creators" in t:
            t["creators"] = creators
        t["tags"] = [{"tag": g} for g in (meta.get("tags") or []) if g]
        t["collections"] = list(collection_keys)
        return t

    def create_item(self, meta: dict[str, Any], collection_keys: list[str]) -> str:
        return self._post_objects("items", [self.build_item(meta, collection_keys)])

    def find_existing_item(self, meta: dict[str, Any]) -> Optional[str]:
        """Same paper already in Zotero (added there, or by an earlier half-finished push)? Match on DOI, arXiv id, then title."""
        doi, arx, title = norm_doi(meta.get("doi", "")), (meta.get("arxiv") or "").lower(), norm(meta.get("title", ""))
        queries = [q for q in (doi, arx, meta.get("title", "")[:100]) if q]
        for q in queries:
            rows = self.request("GET", "items/top", params={"q": q, "qmode": "everything", "limit": 25}).json()
            for row in rows:
                d = row.get("data", {})
                if d.get("itemType") in ("attachment", "note", "annotation"):
                    continue
                if doi and norm_doi(d.get("DOI", "")) == doi:
                    return d["key"]
                blob = " ".join(str(d.get(k, "")) for k in ("archiveID", "url", "extra")).lower()
                if arx and re.search(rf"(?<![\d.]){re.escape(arx)}(?:v\d+)?(?!\d)", blob):
                    return d["key"]
                if len(title) > 12 and norm(d.get("title", "")) == title:
                    return d["key"]
        return None

    def add_to_collections(self, item_key: str, collection_keys: list[str]) -> bool:
        """Union the item's Zotero collections with `collection_keys`. Returns True when something changed."""
        r = self.request("GET", f"items/{item_key}")
        item = r.json()
        have = list((item.get("data") or {}).get("collections") or [])
        want = [k for k in collection_keys if k and k not in have]
        if not want:
            return False
        self.request(
            "PATCH", f"items/{item_key}", json={"collections": have + want},
            headers={"Content-Type": "application/json", "If-Unmodified-Since-Version": str(item.get("version") or r.headers.get("Last-Modified-Version", "0"))},
            ok=(204, 200),
        )
        return True

    # ── attachments ──
    def list_attachment_keys(self, item_key: str) -> dict[str, str]:
        rows = self.request("GET", f"items/{item_key}/children", params={"limit": 100}).json()
        out: dict[str, str] = {}
        for row in rows:
            d = row.get("data", {})
            if d.get("itemType") == "attachment" and d.get("linkMode") in ("imported_file", "imported_url") and d.get("contentType"):
                out.setdefault(d["contentType"], d["key"])
        return out

    def upload_attachment(self, item_key: str, path: Path, max_bytes: int = 300 * 1024 * 1024) -> str:
        size = path.stat().st_size
        if size > max_bytes:
            raise ZoteroPushError(f"{path.name} is larger than {max_bytes // (1024 * 1024)} MB.", permanent=True)
        ctype = mimetypes.guess_type(path.name)[0] or ("application/epub+zip" if path.suffix.lower() == ".epub" else "application/octet-stream")
        att = {"itemType": "attachment", "parentItem": item_key, "linkMode": "imported_file", "title": path.name,
               "contentType": ctype, "filename": path.name, "tags": [], "relations": {}}
        att_key = self._post_objects("items", [att])
        data = path.read_bytes()
        auth = self.request(
            "POST", f"items/{att_key}/file",
            data={"md5": hashlib.md5(data).hexdigest(), "filename": path.name, "filesize": str(size), "mtime": str(int(path.stat().st_mtime * 1000))},
            headers={"If-None-Match": "*"}, ok=(200,),
        ).json()
        if auth.get("exists"):
            return att_key
        up = self.http.post(
            auth["url"], content=auth["prefix"].encode("latin-1") + data + auth["suffix"].encode("latin-1"),
            headers={"Content-Type": auth["contentType"]}, timeout=300,
        )
        if up.status_code not in (200, 201, 204):
            raise ZoteroPushError(f"Zotero file storage refused the upload ({up.status_code}). Your Zotero storage may be full.", permanent=up.status_code in (402, 413))
        self.request("POST", f"items/{att_key}/file", data={"upload": auth["uploadKey"]}, headers={"If-None-Match": "*"}, ok=(204, 200))
        return att_key
