import io, json, sys, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "assistant"))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import reading

PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"

def make_epub():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/c.opf"/></rootfiles></container>')
        z.writestr("OEBPS/c.opf", '<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Dune</dc:title><dc:creator>Frank Herbert</dc:creator></metadata></package>')
    return b.getvalue()

@pytest.fixture
def env(tmp_path):
    habits = []
    app = FastAPI()
    app.include_router(reading.make_router(lambda: tmp_path, lambda d, h: habits.append((d, h))))
    return TestClient(app), tmp_path, habits

def imp(c, name="a.pdf", data=PDF, title="My Book", authors="A One; B Two"):
    return c.post("/api/reading/import", files={"file": (name, data)}, data={"title": title, "authors": authors, "year": "2020"})

def test_import_pdf_and_library(env):
    c, root, _ = env
    r = imp(c); assert r.status_code == 200, r.text
    b = r.json()["book"]; assert b["slug"] == "my-book" and b["format"] == "pdf" and b["has_file"]
    assert (root / "15-Books/my-book/book.pdf").exists()
    lib = c.get("/api/reading/library").json()["books"]
    assert [x["slug"] for x in lib] == ["my-book"] and lib[0]["authors"] == ["A One", "B Two"]
    assert c.get("/api/reading/my-book/file").content == PDF

def test_import_epub_metadata(env):
    c, _, _ = env
    r = imp(c, "d.epub", make_epub(), title="", authors=""); assert r.status_code == 200, r.text
    b = r.json()["book"]; assert b["title"] == "Dune" and b["authors"] == ["Frank Herbert"] and b["format"] == "epub"

def test_reject_bad_type_and_slug(env):
    c, _, _ = env
    assert imp(c, "x.exe", b"hi").status_code in (400, 415)
    assert c.get("/api/reading/..%2Fx/file").status_code in (400, 404)

def test_patch_collections_delete(env):
    c, root, _ = env; imp(c)
    r = c.patch("/api/reading/my-book", json={"status": "finished", "last_page": 3, "progress": 0.5}); assert r.status_code == 200
    assert r.json()["book"]["status"] == "finished"
    cols = [{"id": "c1", "name": "Phys", "slugs": ["my-book"]}]
    assert c.put("/api/reading/collections", json={"collections": cols}).status_code == 200
    assert c.get("/api/reading/collections").json()["collections"][0]["slugs"] == ["my-book"]
    assert c.delete("/api/reading/my-book").status_code == 200
    assert c.get("/api/reading/library").json()["books"] == []
    assert c.get("/api/reading/collections").json()["collections"][0]["slugs"] == []

def test_highlights_roundtrip(env):
    c, _, _ = env; imp(c, "d.epub", make_epub(), title="Dune")
    h = [{"id": "1", "cfi": "epubcfi(/6/2)", "text": "t", "color": "y", "note": "n", "chapter": "", "created": "2026-01-01T00:00:00"}]
    assert c.put("/api/reading/dune/highlights", json={"highlights": h}).status_code == 200
    assert c.get("/api/reading/dune/highlights").json()["highlights"][0]["note"] == "n"
    assert c.get("/api/reading/library").json()["books"][0]["highlights"] == 1

def test_sessions_goal_streak_and_habit_sync(env):
    c, _, habits = env; imp(c)
    c.put("/api/reading/goal", json={"minutes": 10})
    from datetime import date, timedelta
    t = date.today(); today = t.isoformat()
    g = c.get(f"/api/reading/goal?today={today}").json()
    assert g["goal_minutes"] == 10 and g["today_seconds"] == 0 and g["streak"] == 0 and len(g["week"]) == 7
    c.post("/api/reading/session", json={"slug": "my-book", "seconds": 300, "page": 2, "date": today})
    assert habits == []
    c.post("/api/reading/session", json={"slug": "my-book", "seconds": 400, "page": 5, "date": today})
    assert habits == [(today, {"extra_read": True})]
    c.post("/api/reading/session", json={"slug": "my-book", "seconds": 100, "page": 6, "date": today})
    assert len(habits) == 1  # synced once per day
    for d in ((t - timedelta(days=1)).isoformat(),):
        c.post("/api/reading/session", json={"slug": "my-book", "seconds": 700, "page": 1, "date": d})
    g = c.get(f"/api/reading/goal?today={today}").json()
    assert g["streak"] == 2 and g["goal_met"] and g["today_seconds"] == 800
    assert g["pages_today"] >= 1 and g["week"][-1]["state"] in ("today", "done") or any(d["state"] == "today" for d in g["week"])

def test_session_rejects_bad_input(env):
    from datetime import date
    c, _, _ = env; imp(c)
    assert c.post("/api/reading/session", json={"slug": "nope", "seconds": 5, "date": date.today().isoformat()}).status_code in (400, 404)
    assert c.post("/api/reading/session", json={"slug": "my-book", "seconds": 5, "date": "garbage"}).status_code in (400, 422)


def test_papers_and_writing_time(env):
    from datetime import date
    c, _, habits = env
    t = date.today().isoformat()
    assert c.post("/api/reading/time", json={"category": "papers", "seconds": 120, "date": t}).status_code == 200
    assert c.post("/api/reading/time", json={"category": "papers", "seconds": 60, "date": t}).json()["seconds"] == 180
    assert c.post("/api/reading/time", json={"category": "writing", "seconds": 300, "date": t}).status_code == 200
    assert c.post("/api/reading/time", json={"category": "nope", "seconds": 5, "date": t}).status_code == 400
    assert c.post("/api/reading/time", json={"category": "papers", "seconds": 99999, "date": t}).status_code == 400
    g = c.get(f"/api/reading/goal?today={t}").json()
    assert g["time_today"] == {"books": 0, "papers": 180, "writing": 300}
    assert g["time_week"]["papers"] == 180 and g["today_seconds"] == 0 and habits == []


def test_manual_books_time_history_and_habit_rules(env):
    from datetime import date, timedelta
    c, _, habits = env
    t = date.today(); today = t.isoformat()
    c.put("/api/reading/goal", json={"minutes": 10})
    assert c.post("/api/reading/time", json={"category": "books", "seconds": 600, "date": today}).status_code == 200
    assert (today, {"extra_read": True}) in habits
    c.post("/api/reading/time", json={"category": "papers", "seconds": 900, "date": today})
    c.post("/api/reading/time", json={"category": "writing", "seconds": 1800, "date": today})
    c.post("/api/reading/time", json={"category": "writing", "seconds": 600, "date": today})
    assert (today, {"arxiv": True}) in habits and (today, {"research": True}) in habits
    assert len(habits) == 3  # each habit ticked once per day
    h = c.get(f"/api/reading/history?today={today}&days=3").json()
    assert h["days"][0] == {"date": today, "books": 600, "papers": 900, "writing": 2400, "goal_met": True}
    assert len(h["days"]) == 3 and h["days"][1]["date"] == (t - timedelta(days=1)).isoformat()
