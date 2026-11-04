import sys, io
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import reading

@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(reading, "download_pdf", lambda url, dest: False)
    app = FastAPI()
    app.include_router(reading.make_router(lambda: tmp_path, lambda d, h: None))
    return TestClient(app), tmp_path

def add(c, title, **kw):
    return c.post("/api/reading/items", json={"title": title, "fetch_pdf": False, **kw}).json()["book"]

def test_book_notes_roundtrip_and_latex(env):
    c, root = env
    it = add(c, "Gamma Ray Bursts Handbook", authors=["Ann Lee"], year=2020)
    s = it["slug"]
    assert c.post(f"/api/reading/{s}/notes", json={"text": "   "}).status_code == 400
    r = c.post(f"/api/reading/{s}/notes", json={"text": "exam-\nple of ﬁt", "page": 7}).json()
    assert r["count"] == 1 and r["note"]["text"] == "example of fit"
    c.post(f"/api/reading/{s}/notes", json={"text": "Second & third", "page": 2, "comment": "why?"})
    assert {b["slug"]: b for b in c.get("/api/reading/library").json()["books"]}[s]["note_count"] == 2
    tex = c.post(f"/api/reading/{s}/notes/latex", json={"project": "MyDoc"}).json()
    assert tex["citekey"] == "lee2020gamma" and r"\cite[p.~2]{lee2020gamma}" in tex["latex"] and "Second \\& third" in tex["latex"]
    assert "lee2020gamma" in (root / "70-LaTeX/MyDoc/references.bib").read_text()
    assert r"\hfill" in c.post(f"/api/reading/{s}/notes/latex", json={}).json()["latex"]
    md = c.get(f"/api/reading/{s}/notes/markdown").json()["markdown"]
    assert "> Second & third — p. 2" in md
    notes = c.get(f"/api/reading/{s}/notes").json()["notes"]
    c.put(f"/api/reading/{s}/notes", json={"notes": notes[:1] + [{"id": "x", "text": ""}]})
    assert len(c.get(f"/api/reading/{s}/notes").json()["notes"]) == 1
    assert c.post("/api/reading/nope/notes", json={"text": "x"}).status_code == 404
