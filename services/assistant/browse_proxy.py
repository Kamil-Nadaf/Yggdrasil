"""Fetch a web page for the in-app split-screen browser.

Sites refuse to load inside a frame (X-Frame-Options / frame-ancestors), so the backend downloads the page and
serves it back itself. The page is untrusted, so it is served *inert*: a Content-Security-Policy lets only our own
nonce'd script run (page scripts, connections and plugins are all blocked) and the iframe is sandboxed without
same-origin. What is left is the readable page — text, images, styles — plus link/form interception so that every
click comes back to the app, which then loads the next page through here.
"""
from __future__ import annotations

import html as _html
import json
import re
import secrets
from typing import Callable
from urllib.parse import urljoin, urlparse

import httpx

from pdf_fetch import BROWSER_UA, PdfFetchError

MAX_BYTES = 8 * 1024 * 1024
SEARCH_URL = "https://www.bing.com/search?q="  # DuckDuckGo/Mojeek show a bot challenge to server-side requests; Bing and Brave answer

_META_CSP = re.compile(r"<meta[^>]+http-equiv=[\"']?(?:content-security-policy|refresh)[\"']?[^>]*>", re.I)
_HEAD_OPEN = re.compile(r"<head(?:\s[^>]*)?>", re.I)


def normalize(q: str) -> str:
    """What the address bar typed into a URL: a link as is, a bare domain with https://, anything else a web search."""
    q = (q or "").strip()
    if not q:
        return ""
    if re.match(r"^https?://\S+$", q, re.I):
        return q
    if re.match(r"^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(/\S*)?$", q, re.I) and " " not in q:
        return "https://" + q
    from urllib.parse import quote_plus
    return SEARCH_URL + quote_plus(q)


def unwrap_redirect(url: str) -> str:
    """Search result links go through a tracking redirect (Bing /ck/a?u=a1<base64>, DuckDuckGo /l/?uddg=); go straight
    to the real page, because those redirects are done by script, which the browser pane does not run."""
    import base64
    from urllib.parse import parse_qs
    u = urlparse(url)
    if u.netloc.endswith("duckduckgo.com") and u.path.startswith("/l/"):
        real = parse_qs(u.query).get("uddg", [""])[0]
        if real:
            return real
    if u.netloc.endswith("bing.com") and u.path.startswith("/ck/"):
        tok = parse_qs(u.query).get("u", [""])[0]
        if tok.startswith("a1"):
            try:
                real = base64.urlsafe_b64decode(tok[2:] + "=" * (-len(tok[2:]) % 4)).decode()
                if real.startswith(("http://", "https://")):
                    return real
            except (ValueError, UnicodeDecodeError):
                pass
    return url


def _script(nonce: str) -> str:
    return (
        f'<script nonce="{nonce}">(function(){{var P=function(m){{parent.postMessage(Object.assign({{ygg:1}},m),"*")}};'
        'document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");'
        'if(!a||e.defaultPrevented||e.button>0)return;var h=a.href||"";if(/^ygg-pdf:/i.test(h)){e.preventDefault();P({type:"pdf",url:h.slice(8)});return}if(!/^https?:/i.test(h)){if(/^#/.test(a.getAttribute("href")||""))return;e.preventDefault();return}'
        'e.preventDefault();P({type:"nav",url:h,newTab:e.metaKey||e.ctrlKey||a.target==="_blank"})},true);'
        'document.addEventListener("submit",function(e){var f=e.target;e.preventDefault();var u=new URL(f.action||location.href,document.baseURI);'
        'var d=new FormData(f);var q=new URLSearchParams();d.forEach(function(v,k){if(typeof v==="string")q.append(k,v)});'
        'if((f.method||"get").toLowerCase()==="get"){u.search=q.toString();P({type:"nav",url:u.href})}else{P({type:"nav",url:u.href,post:q.toString()})}},true);'
        'addEventListener("message",function(e){var d=e.data;if(d&&d.ygg===2)document.documentElement.classList.toggle("ygg-dark",!!d.dark)});'
        'P({type:"loaded",title:document.title})})();</script>'
    )


def render(page: str, final_url: str) -> tuple[str, str]:
    """(html to serve, nonce). Adds <base> so relative images/styles resolve, and our single script."""
    nonce = secrets.token_urlsafe(12)
    page = _META_CSP.sub("", page)
    inject = (f'<base href="{_html.escape(final_url, quote=True)}"><meta name="referrer" content="no-referrer">'
              "<style>html.ygg-dark img,html.ygg-dark video,html.ygg-dark picture,html.ygg-dark canvas,html.ygg-dark svg image{filter:invert(1) hue-rotate(180deg)}</style>"
              + _script(nonce))
    m = _HEAD_OPEN.search(page)
    page = (page[: m.end()] + inject + page[m.end():]) if m else (inject + page)
    return page, nonce


def csp(nonce: str) -> str:
    return (
        f"sandbox allow-scripts allow-forms allow-popups; default-src 'none'; script-src 'nonce-{nonce}'; "
        "style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src *; connect-src 'none'; "
        "object-src 'none'; frame-src 'none'; base-uri *; form-action 'none'"
    )


def note_page(title: str, body_html: str) -> tuple[str, str]:
    return render(f"<!doctype html><html><head><meta charset=utf-8><title>{_html.escape(title)}</title>"
                  "<style>body{font:15px/1.5 system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px;color:#333}"
                  "a{color:#2563eb}</style></head><body>" + body_html + "</body></html>", "about:blank")


async def fetch_page(url: str, check: Callable[[str], str], access: dict | None = None, timeout: float = 25.0) -> tuple[str, str, str]:
    """Returns (final_url, kind, html) where kind is "html" or "pdf" (html is then empty)."""
    cur = check(url)
    proxy = ((access or {}).get("proxy") or "").strip() or None
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout, proxy=proxy, cookies=httpx.Cookies()) as client:
        for _ in range(8):
            try:
                resp = await client.get(cur, headers={"User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.9"})
            except httpx.RequestError as exc:
                raise PdfFetchError(502, f"Could not load the page: {exc}")
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                cur = check(urljoin(cur, resp.headers["location"]))
                continue
            ctype = resp.headers.get("content-type", "").lower()
            if resp.status_code in (401, 403, 407, 429):
                raise PdfFetchError(502, f"{urlparse(cur).netloc} refused the request (HTTP {resp.status_code}). It may block automated access or need a sign-in.")
            if resp.status_code >= 400:
                raise PdfFetchError(502, f"The site answered HTTP {resp.status_code}")
            if "pdf" in ctype or resp.content[:5] == b"%PDF-":
                return cur, "pdf", ""
            if "html" not in ctype and "xml" not in ctype and "text" not in ctype:
                raise PdfFetchError(415, f"Can't show this kind of file here ({ctype.split(';')[0] or 'unknown'}).")
            if len(resp.content) > MAX_BYTES:
                raise PdfFetchError(413, "Page is too large to show here")
            return cur, "html", resp.text
    raise PdfFetchError(502, "Too many redirects")
