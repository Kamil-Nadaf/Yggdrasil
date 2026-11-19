"""Download a paper's PDF the way a browser would, so institutional (IP-based) access works.

Publishers decide access by the network the request comes from, so this only succeeds when the machine running
the app is on the university network / VPN. What we can do is stop looking like a bot: browser headers, a cookie
jar kept across redirects, a Referer, and following publisher landing pages to their real PDF link.
"""
from __future__ import annotations

import html as _html
import re
from typing import Callable
from urllib.parse import urljoin, urlparse

import httpx

BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MAX_BYTES = 120 * 1024 * 1024
_ADS_ABS = re.compile(r"^https?://(?:ui\.)?adsabs\.harvard\.edu/abs/([^/?#]+)", re.I)
_PDF_LINK_PATTERNS = (
    r'<meta[^>]+name=["\']citation_pdf_url["\'][^>]*content=["\']([^"\']+)',
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*name=["\']citation_pdf_url["\']',
    r'<link[^>]+type=["\']application/pdf["\'][^>]*href=["\']([^"\']+)',
    r'<link[^>]+href=["\']([^"\']+)["\'][^>]*type=["\']application/pdf["\']',
    r'<a[^>]+href=["\']([^"\']*/pdfft[^"\']*)',
)


class PdfFetchError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


_SD_PII = re.compile(r"^(https?://(?:www\.)?sciencedirect\.com/science/article/(?:abs/)?pii/[A-Za-z0-9]+)/?(?:[?#].*)?$", re.I)
_WILEY = re.compile(r"^(https?://[a-z.]*onlinelibrary\.wiley\.com)/doi/(?:abs|full|epdf|pdf)/(10\.[^?#]+)", re.I)
_SPRINGER = re.compile(r"^(https?://link\.springer\.com)/(?:article|chapter)/(10\.[^?#]+)", re.I)
_DOI = re.compile(r"^https?://(?:dx\.)?doi\.org/(10\.[^?#]+)", re.I)


def candidates(url: str) -> list[str]:
    """Pages that have no PDF themselves: ADS abstracts go through its link gateway (publisher, then arXiv, then ADS
    scan); ScienceDirect / Wiley / Springer article pages are tried at their direct PDF address first."""
    m = _ADS_ABS.match(url)
    if m:
        bib = m.group(1)
        return [f"https://ui.adsabs.harvard.edu/link_gateway/{bib}/{k}" for k in ("PUB_PDF", "EPRINT_PDF", "ADS_PDF")]
    m = _SD_PII.match(url)
    if m:
        return [f"{m.group(1)}/pdfft?isDTMRedir=true&download=true", url]
    m = _WILEY.match(url)
    if m:
        return [f"{m.group(1)}/doi/pdfdirect/{m.group(2)}?download=true", url]
    m = _SPRINGER.match(url)
    if m:
        return [f"{m.group(1)}/content/pdf/{m.group(2)}.pdf", url]
    return [url]


def _host_matches(host: str, domain: str) -> bool:
    host, domain = host.lower().split(":")[0], domain.lower().lstrip(".").strip()
    return bool(domain) and (host == domain or host.endswith("." + domain))


def _cookie_for(host: str, access: dict | None) -> str:
    parts = []
    for c in (access or {}).get("cookies") or []:
        if isinstance(c, dict) and _host_matches(host, str(c.get("domain", ""))) and str(c.get("cookie", "")).strip():
            parts.append(str(c["cookie"]).strip().rstrip(";"))
    return "; ".join(parts)


def pdf_link_from_html(page: str, base: str) -> str:
    for pat in _PDF_LINK_PATTERNS:
        m = re.search(pat, page, re.I)
        if m:
            return urljoin(base, _html.unescape(m.group(1)).strip())
    return ""


def _blocked_message(status: int, host: str) -> str:
    return (
        f"{host} refused the request (HTTP {status}). The app downloads from the computer it runs on, so this works only when "
        "that computer is on your university network or VPN and the publisher doesn't block automated requests. "
        "If your browser can open the paper, download the PDF there and drop it onto the reader."
    )


async def _fetch_one(client: httpx.AsyncClient, url: str, check: Callable[[str], str], access: dict | None = None) -> bytes:
    current = check(url)
    referer = f"{urlparse(current).scheme}://{urlparse(current).netloc}/"
    tried_html: set[str] = set()
    for _ in range(10):
        headers = {
            "User-Agent": BROWSER_UA,
            "Accept": "application/pdf,text/html;q=0.9,application/xhtml+xml;q=0.8,*/*;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": referer,
        }
        ck = _cookie_for(urlparse(current).netloc, access)
        if ck:
            headers["Cookie"] = ck  # only ever sent to the host the user entered it for
        try:
            resp = await client.get(current, headers=headers)
        except httpx.RequestError as exc:
            raise PdfFetchError(502, f"Could not fetch PDF: {exc}")
        if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
            referer = current
            current = check(urljoin(current, resp.headers["location"]))
            continue
        host = urlparse(current).netloc
        if resp.status_code in (401, 402, 403, 407):
            raise PdfFetchError(502, _blocked_message(resp.status_code, host))
        if resp.status_code != 200:
            raise PdfFetchError(502, f"PDF host returned {resp.status_code}")
        body = resp.content
        if len(body) > MAX_BYTES:
            raise PdfFetchError(413, "PDF is too large to preview")
        if body.startswith(b"%PDF") or "pdf" in resp.headers.get("content-type", "").lower():
            return body
        # A landing page (or a paywall page): follow its advertised PDF link once per page.
        text = resp.text[:400_000]
        link = pdf_link_from_html(text, current)
        if link and current not in tried_html:
            tried_html.add(current)
            referer = current
            current = check(link)
            continue
        if re.search(r"just a moment|attention required|captcha|cf-chl|are you a robot", text[:6000], re.I):
            raise PdfFetchError(502, _blocked_message(403, host) + " (The site showed a bot check.)")
        raise PdfFetchError(415, "That link is not a PDF — use “Open Paper / DOI” instead, or drop the PDF onto the reader.")
    raise PdfFetchError(502, "Too many redirects while fetching the PDF")


async def fetch_pdf(url: str, check: Callable[[str], str], timeout: float = 60.0, access: dict | None = None) -> bytes:
    """`check` validates every URL we are about to request (public hosts only) and returns it.
    `access` is the user's institutional setup: {"proxy": "http://proxy.uni.edu:3128", "cookies": [{"domain", "cookie"}]}."""
    last: PdfFetchError | None = None
    proxy = ((access or {}).get("proxy") or "").strip() or None
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout, cookies=httpx.Cookies(), proxy=proxy) as client:
        for cand in candidates(url):
            try:
                return await _fetch_one(client, cand, check, access)
            except PdfFetchError as e:
                last = e
    raise last or PdfFetchError(502, "Could not fetch PDF")
