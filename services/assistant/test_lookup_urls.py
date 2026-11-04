import io, sys, urllib.error
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import reading


@pytest.mark.parametrize("q,expect", [
    ("https://arxiv.org/abs/2301.01234v2", ("arxiv", "2301.01234")),
    ("arxiv.org/pdf/2301.01234v1.pdf", ("arxiv", "2301.01234")),
    ("https://arxiv.org/abs/2301.01234?context=astro-ph", ("arxiv", "2301.01234")),
    ("arXiv:hep-th/9901001", ("arxiv", "hep-th/9901001")),
    ("2301.01234", ("arxiv", "2301.01234")),
    ("https://doi.org/10.48550/arXiv.2301.01234", ("arxiv", "2301.01234")),
    ("https://doi.org/10.1093/mnras/stz123", ("doi", "10.1093/mnras/stz123")),
    ("https://journals.aps.org/prd/abstract/10.1103/PhysRevD.100.123456?utm=1#x", ("doi", "10.1103/PhysRevD.100.123456")),
    ("https://link.springer.com/article/10.1007/s10509-020-1/fulltext.html", ("doi", "10.1007/s10509-020-1")),
    ("https://www.nature.com/articles/s41586-020-2649-2", ("url", "https://www.nature.com/articles/s41586-020-2649-2")),
    ("hello", ("", "")),
])
def test_parse_identifier(q, expect):
    assert reading.parse_identifier(q) == expect


def test_open_uses_ca_bundle_and_retries_429(monkeypatch):
    seen = []
    calls = {"n": 0}

    def fake(req, timeout=None, context=None):
        seen.append(context)
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError("u", 429, "slow", {"Retry-After": "0"}, io.BytesIO(b""))
        return "ok"

    monkeypatch.setattr(reading.urllib.request, "urlopen", fake)
    monkeypatch.setattr(reading.time, "sleep", lambda s: None)
    assert reading._open(reading.urllib.request.Request("https://x.test")) == "ok"
    assert calls["n"] == 2 and all(c is not None for c in seen)


def test_doi_404_in_publisher_url_falls_back_to_page(monkeypatch):
    def nf(doi):
        raise urllib.error.HTTPError("u", 404, "nf", {}, io.BytesIO(b""))
    monkeypatch.setattr(reading, "_lookup_doi", nf)
    monkeypatch.setattr(reading, "lookup_webpage", lambda u: {"title": "From page", "url": u})
    assert reading.lookup_metadata("https://pub.example/10.1234/abc/def")["title"] == "From page"
    with pytest.raises(urllib.error.HTTPError):
        reading.lookup_metadata("10.1234/abc")  # bare DOI: nothing to fall back to


def test_lookup_route_messages(monkeypatch):
    app = FastAPI()
    app.include_router(reading.make_router(lambda: Path("/tmp"), lambda d, h: None))
    c = TestClient(app)

    def boom(code):
        def f(q):
            raise urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(b""))
        return f
    monkeypatch.setattr(reading, "lookup_metadata", boom(403))
    r = c.get("/api/reading/lookup", params={"q": "https://x.test"})
    assert r.status_code == 502 and "DOI or arXiv" in r.json()["detail"]
    monkeypatch.setattr(reading, "lookup_metadata", boom(404))
    assert c.get("/api/reading/lookup", params={"q": "10.1/x"}).status_code == 404
    monkeypatch.setattr(reading, "lookup_metadata", lambda q: (_ for _ in ()).throw(reading.ssl.SSLError("bad")))
    assert "certificate" in c.get("/api/reading/lookup", params={"q": "https://x.test"}).json()["detail"]


def test_relative_pdf_url_is_resolved(monkeypatch):
    html = b'<html><head><meta name="citation_title" content="T"><meta name="citation_pdf_url" content="/pdf/1.pdf"></head></html>'

    class R(io.BytesIO):
        headers = type("H", (), {"get_content_charset": staticmethod(lambda: "utf-8")})()
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(reading, "_open", lambda req, timeout=20: R(html))
    assert reading.lookup_webpage("https://pub.example/a/b")["pdf_url"] == "https://pub.example/pdf/1.pdf"
