import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import tools


def client(tmp_path):
    app = FastAPI()
    app.include_router(tools.make_router(lambda: tmp_path))
    return TestClient(app)


def test_parse_pages():
    assert tools.parse_pages("") == ""
    assert tools.parse_pages("all") == ""
    assert tools.parse_pages("1-2, 4") == "1-2,4"
    with pytest.raises(ValueError):
        tools.parse_pages("x")
    with pytest.raises(ValueError):
        tools.parse_pages("5-2")


def test_status_shape(tmp_path):
    body = client(tmp_path).get("/api/tools/pdf/status").json()
    assert body["tiers"] == ["flash", "basic", "standard", "advanced"]
    assert "installed" in body["mineru"]


def test_rejects_non_pdf(tmp_path):
    r = client(tmp_path).post("/api/tools/pdf/files", files={"file": ("a.pdf", b"not a pdf")})
    assert r.status_code == 400


def test_rejects_bad_pages(tmp_path):
    r = client(tmp_path).post("/api/tools/pdf/files", files={"file": ("a.pdf", b"%PDF-1.4 x")}, data={"pages": "zz"})
    assert r.status_code == 400


def test_unknown_entry(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/tools/pdf/files/abcdef012345").status_code == 404
    assert c.get("/api/tools/pdf/files/not-an-id").status_code == 404


def test_list_markdown_and_delete(tmp_path):
    d = tmp_path / tools.TOOLS_DIR / "abcdef012345"
    d.mkdir(parents=True)
    (d / "input.pdf").write_bytes(b"%PDF-1.4")
    (d / "result.txt").write_text("# Hi", encoding="utf-8")
    (d / "meta.json").write_text('{"id":"abcdef012345","name":"x.pdf","status":"done","created":"2026-01-01T00:00:00"}', encoding="utf-8")
    c = client(tmp_path)
    assert [f["name"] for f in c.get("/api/tools/pdf/files").json()["files"]] == ["x.pdf"]
    assert c.get("/api/tools/pdf/files/abcdef012345/markdown").text == "# Hi"
    assert c.get("/api/tools/pdf/files/abcdef012345/pdf").status_code == 200
    assert c.delete("/api/tools/pdf/files/abcdef012345").status_code == 200
    assert c.get("/api/tools/pdf/files").json()["files"] == []


def test_orphaned_running_entry_becomes_error(tmp_path):
    d = tmp_path / tools.TOOLS_DIR / "abcdef012345"
    d.mkdir(parents=True)
    (d / "meta.json").write_text('{"id":"abcdef012345","name":"x.pdf","status":"running"}', encoding="utf-8")
    f = client(tmp_path).get("/api/tools/pdf/files/abcdef012345").json()
    assert f["status"] == "error"


def test_import_dedupes_and_waits_for_books(tmp_path, monkeypatch):
    src = tmp_path / "book.pdf"
    src.write_bytes(b"%PDF-1.4 body")

    async def resolve(key, url):
        return src

    monkeypatch.setattr(tools, "mineru_cmd", lambda: ["/bin/true"])
    app = FastAPI()
    app.include_router(tools.make_router(lambda: tmp_path, resolve))
    c = TestClient(app)
    first = c.post("/api/tools/pdf/import", json={"key": "book-x", "name": "My Book", "kind": "book"}).json()
    assert first["existed"] is False and first["started"] is False
    assert first["file"]["status"] == "ready" and first["file"]["name"] == "My Book.pdf"
    again = c.post("/api/tools/pdf/import", json={"key": "book-x", "kind": "book"}).json()
    assert again["existed"] is True and again["file"]["id"] == first["file"]["id"]
    assert len(c.get("/api/tools/pdf/files").json()["files"]) == 1


def test_import_rejects_non_pdf(tmp_path):
    async def resolve(key, url):
        return b"<html>"

    app = FastAPI()
    app.include_router(tools.make_router(lambda: tmp_path, resolve))
    r = TestClient(app).post("/api/tools/pdf/import", json={"key": "2501.00001", "kind": "paper"})
    assert r.status_code == 400


def test_mineru_cmd_uses_running_interpreter(monkeypatch):
    # A relocated install has a dead shebang on the console script, so we must call the
    # entry point through sys.executable instead of exec'ing the script.
    import sys

    monkeypatch.setattr(tools, "_entry_point", lambda: ("pkg.cli", "main"))
    cmd = tools.mineru_cmd()
    assert cmd[0] == sys.executable and cmd[1] == "-c"
    assert "pkg.cli" in cmd[2] and "main" in cmd[2]


# ── AI-vision conversion ─────────────────────────────────────────────────────

def _vision_server(replies):
    """Tiny OpenAI-compatible server: answers each chat request from `replies` (a list consumed in order)."""
    import json as _json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    seen = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = _json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append((self.path, self.headers.get("Authorization"), body))
            code, text = replies.pop(0) if replies else (200, "fallback")
            payload = _json.dumps({"choices": [{"message": {"content": text}}]} if code == 200 else {"error": "no"}).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen


def _blank_pdf(path, pages=3):
    pdfium = pytest.importorskip("pypdfium2")
    d = pdfium.PdfDocument.new()
    for _ in range(pages):
        d.new_page(300, 200)
    d.save(str(path))


def test_page_numbers():
    assert tools.page_numbers("", 4) == [1, 2, 3, 4]
    assert tools.page_numbers("2-3,9", 4) == [2, 3]
    assert tools.page_numbers("3,1-2,2", 5) == [3, 1, 2]


def test_reply_text_strips_a_code_fence():
    assert tools._reply_text({"choices": [{"message": {"content": "```markdown\n# Hi\n```"}}]}) == "# Hi"


def test_ai_conversion_tries_engines_in_order_and_skips_a_bad_page(tmp_path):
    import time

    pytest.importorskip("pypdfium2")
    bad, bad_seen = _vision_server([(500, ""), (500, ""), (500, "")])
    good, good_seen = _vision_server([(200, "# Page one"), (200, "Second $x^2$"), (200, "Third")])
    src = tmp_path / "in.pdf"
    _blank_pdf(src)

    async def resolve(key, url):
        return src

    app = FastAPI()
    app.include_router(tools.make_router(lambda: tmp_path, resolve))
    engines = [
        {"id": "a", "label": "Broken", "base_url": f"http://127.0.0.1:{bad.server_port}/v1", "api_key": "k1", "model": "m"},
        {"id": "b", "label": "Good", "base_url": f"http://127.0.0.1:{good.server_port}/v1", "api_key": "k2", "model": "vision"},
    ]
    with TestClient(app) as c:
        f = c.post("/api/tools/pdf/import", json={"key": "book-y", "kind": "book"}).json()["file"]
        r = c.post(f"/api/tools/pdf/files/{f['id']}/convert", data={"engine": "ai", "pages": "1-3", "engines": json.dumps(engines)})
        assert r.status_code == 200
        for _ in range(100):
            m = c.get(f"/api/tools/pdf/files/{f['id']}").json()
            if m["status"] != "running":
                break
            time.sleep(0.1)
        assert m["status"] == "done", m
        text = c.get(f"/api/tools/pdf/files/{f['id']}/markdown").text
    assert text.splitlines()[0] == "# Page one" and "Second $x^2$" in text and "Third" in text
    path, auth, body = good_seen[0]
    assert path == "/v1/chat/completions" and auth == "Bearer k2" and body["model"] == "vision"
    assert body["messages"][0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert len(bad_seen) == 3  # the first engine was tried for every page


def test_ai_conversion_needs_a_model(tmp_path):
    src = tmp_path / "in.pdf"
    src.write_bytes(b"%PDF-1.4 x")

    async def resolve(key, url):
        return src

    app = FastAPI()
    app.include_router(tools.make_router(lambda: tmp_path, resolve))
    c = TestClient(app)
    f = c.post("/api/tools/pdf/import", json={"key": "book-z", "kind": "book"}).json()["file"]
    r = c.post(f"/api/tools/pdf/files/{f['id']}/convert", data={"engine": "ai", "engines": "[]"})
    assert r.status_code == 400 and "PDF" in r.json()["detail"]
