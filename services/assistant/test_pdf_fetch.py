import asyncio
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from pdf_fetch import PdfFetchError, candidates, fetch_pdf, pdf_link_from_html

PDF = b"%PDF-1.4 fake"
SEEN: list[dict] = []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="text/html", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        SEEN.append({"path": self.path, "ua": self.headers.get("User-Agent", ""), "cookie": self.headers.get("Cookie", ""), "referer": self.headers.get("Referer", "")})
        if self.path == "/landing":
            page = b'<html><head><meta name="citation_pdf_url" content="/files/p.pdf?a=1&amp;b=2"></head></html>'
            self._send(200, page, extra={"Set-Cookie": "sess=abc; Path=/"})
        elif self.path.startswith("/files/p.pdf"):
            ok = "Mozilla" in self.headers.get("User-Agent", "") and "sess=abc" in self.headers.get("Cookie", "")
            self._send(200, PDF, "application/pdf") if ok else self._send(403, b"no")
        elif self.path == "/blocked":
            self._send(403, b"forbidden")
        elif self.path == "/bot":
            self._send(200, b"<html><title>Just a moment...</title></html>")
        elif self.path == "/redir":
            self._send(302, b"", extra={"Location": "/landing"})
        else:
            self._send(404, b"")


@pytest.fixture(scope="module")
def base():
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def run(url):
    return asyncio.run(fetch_pdf(url, lambda u: u))


def test_follows_landing_page_pdf_link_with_cookies_and_browser_headers(base):
    SEEN.clear()
    assert run(base + "/redir") == PDF
    last = SEEN[-1]
    assert last["path"] == "/files/p.pdf?a=1&b=2" and "Mozilla" in last["ua"] and last["referer"].endswith("/landing")


def test_blocked_gives_helpful_message(base):
    with pytest.raises(PdfFetchError) as e:
        run(base + "/blocked")
    assert "drop it onto the reader" in e.value.detail and "403" in e.value.detail


def test_bot_check_page_is_reported(base):
    with pytest.raises(PdfFetchError) as e:
        run(base + "/bot")
    assert "bot check" in e.value.detail


def test_ads_abstract_page_uses_link_gateway():
    c = candidates("https://ui.adsabs.harvard.edu/abs/2000ApJ...530..292M/abstract")
    assert [u.rsplit("/", 1)[1] for u in c] == ["PUB_PDF", "EPRINT_PDF", "ADS_PDF"]
    assert c[0].startswith("https://ui.adsabs.harvard.edu/link_gateway/2000ApJ...530..292M/")


def test_pdf_link_patterns():
    assert pdf_link_from_html('<meta content="https://x.org/a.pdf" name="citation_pdf_url">', "https://x.org/") == "https://x.org/a.pdf"
    assert pdf_link_from_html('<a class="pdf" href="/science/article/pii/S1/pdfft?md5=1&amp;pid=2">', "https://www.sciencedirect.com/") == "https://www.sciencedirect.com/science/article/pii/S1/pdfft?md5=1&pid=2"
