import asyncio
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

import browse_proxy as bp
from pdf_fetch import PdfFetchError

PAGE = b'<html><head><title>T</title><meta http-equiv="Content-Security-Policy" content="script-src none"></head><body><a href="/x">x</a><script>alert(1)</script></body></html>'


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/r":
            self.send_response(302); self.send_header("Location", "/p"); self.end_headers(); return
        if self.path == "/pdf":
            body, ct = b"%PDF-1.4 x", "application/pdf"
        elif self.path == "/img":
            body, ct = b"\x89PNG", "image/png"
        elif self.path == "/403":
            self.send_response(403); self.end_headers(); return
        else:
            body, ct = PAGE, "text/html; charset=utf-8"
        self.send_response(200); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


@pytest.fixture(scope="module")
def base():
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_normalize():
    assert bp.normalize("https://a.org/x") == "https://a.org/x"
    assert bp.normalize("arxiv.org/abs/1") == "https://arxiv.org/abs/1"
    assert bp.normalize("gamma ray bursts").startswith(bp.SEARCH_URL + "gamma+ray")
    assert bp.normalize("  ") == ""
    assert bp.unwrap_redirect("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fa.org%2Fp&rut=1") == "https://a.org/p"
    import base64
    tok = "a1" + base64.urlsafe_b64encode(b"https://example.org/page?x=1").decode().rstrip("=")
    assert bp.unwrap_redirect(f"https://www.bing.com/ck/a?!&&p=abc&u={tok}&ntb=1") == "https://example.org/page?x=1"


def test_fetch_and_render_is_inert(base):
    final, kind, text = asyncio.run(bp.fetch_page(base + "/r", lambda u: u))
    assert final.endswith("/p") and kind == "html"
    page, nonce = bp.render(text, final)
    assert "ygg-dark" in page and "<base href=" in page and f'nonce="{nonce}"' in page
    assert "http-equiv" not in page  # the page's own CSP/refresh meta is dropped
    policy = bp.csp(nonce)
    assert f"script-src 'nonce-{nonce}'" in policy and "connect-src 'none'" in policy and "sandbox" in policy
    assert "allow-same-origin" not in policy


def test_pdf_and_errors(base):
    assert asyncio.run(bp.fetch_page(base + "/pdf", lambda u: u))[1] == "pdf"
    with pytest.raises(PdfFetchError):
        asyncio.run(bp.fetch_page(base + "/403", lambda u: u))
    with pytest.raises(PdfFetchError) as e:
        asyncio.run(bp.fetch_page(base + "/img", lambda u: u))
    assert e.value.status == 415


def test_browse_endpoint_headers(monkeypatch):
    from fastapi.testclient import TestClient
    import main

    async def fake(url, check, access=None, timeout=25.0):
        return "https://example.org/a", "html", "<html><head></head><body><h1>Hi</h1><script>steal()</script></body></html>"

    monkeypatch.setattr(main.browse_proxy, "fetch_page", fake)
    c = TestClient(main.app)
    r = c.get("/api/browse", params={"q": "example.org/a"})
    assert r.status_code == 200 and "<h1>Hi</h1>" in r.text
    pol = r.headers["content-security-policy"]
    assert "sandbox" in pol and "connect-src 'none'" in pol and "x-frame-options" not in r.headers
    assert r.headers["x-browse-final"] == "https://example.org/a"
    assert "Type an address" in c.get("/api/browse").text
