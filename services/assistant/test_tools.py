import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import tools


def client():
    app = FastAPI()
    app.include_router(tools.make_router())
    return TestClient(app)


def test_parse_pages():
    assert tools.parse_pages("", 4) == [0, 1, 2, 3]
    assert tools.parse_pages("1-2, 4", 10) == [0, 1, 3]
    assert tools.parse_pages("3-99", 5) == [2, 3, 4]
    with pytest.raises(ValueError):
        tools.parse_pages("x", 5)
    with pytest.raises(ValueError):
        tools.parse_pages("5-2", 9)


def test_strip_fences():
    assert tools.strip_fences("```markdown\n# Hi\n```") == "# Hi"
    assert tools.strip_fences("<think>x</think>plain") == "plain"


def test_status_shape():
    r = client().get("/api/tools/pdf/status")
    assert r.status_code == 200
    body = r.json()
    assert body["tiers"] == ["flash", "basic", "standard", "advanced"]
    assert "installed" in body["mineru"]


def test_convert_rejects_non_pdf():
    r = client().post("/api/tools/pdf/convert", files={"file": ("a.pdf", b"not a pdf")}, data={"converter": "vision"})
    assert r.status_code == 400


def test_convert_needs_engine_without_mineru(monkeypatch):
    monkeypatch.setattr(tools, "mineru_bin", lambda: None)
    monkeypatch.setattr(tools, "render_available", lambda: True)
    r = client().post("/api/tools/pdf/convert", files={"file": ("a.pdf", b"%PDF-1.4 x")}, data={"engines": "[]"})
    assert r.status_code == 400 and "engine" in r.json()["detail"].lower()


def test_unknown_job():
    assert client().get("/api/tools/pdf/jobs/nope").status_code == 404
