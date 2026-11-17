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
