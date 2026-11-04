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

def test_related_is_symmetric_and_cleaned_on_delete(env):
    c, _ = env
    a, b = add(c, "Paper A about gravity"), add(c, "Paper B about light")
    r = c.patch(f"/api/reading/{a['slug']}", json={"related": [b["slug"], "nope", a["slug"]]}).json()["book"]
    assert r["related"] == [b["slug"]]
    lib = {x["slug"]: x for x in c.get("/api/reading/library").json()["books"]}
    assert lib[b["slug"]]["related"] == [a["slug"]]
    c.delete(f"/api/reading/{a['slug']}")
    assert c.get("/api/reading/library").json()["books"][0]["related"] == []

def test_merge_combines_fields_collections_and_file(env):
    c, root = env
    c.put("/api/reading/collections", json={"collections": [{"id": "c1", "name": "X", "slugs": []}, {"id": "c2", "name": "Y", "slugs": []}]})
    a = add(c, "Same Paper Title Here", tags=["a"], collection="c1")
    b = add(c, "Same Paper Title Here v2", doi="10.1/zzz", tags=["b"], collection="c2", abstract="abs")
    (root / "15-Books" / b["slug"] / "book.pdf").write_bytes(b"%PDF-1.4 x")
    r = c.post("/api/reading/merge", json={"keep": a["slug"], "remove": [b["slug"]]}).json()
    assert r["removed"] == 1 and r["book"]["doi"] == "10.1/zzz" and r["book"]["tags"] == ["a", "b"] and r["book"]["abstract"] == "abs" and r["book"]["has_file"]
    cols = {x["id"]: x["slugs"] for x in c.get("/api/reading/collections").json()["collections"]}
    assert cols == {"c1": [a["slug"]], "c2": [a["slug"]]}
    assert len(c.get("/api/reading/library").json()["books"]) == 1

def test_collection_parent_kept_and_cycles_dropped(env):
    c, _ = env
    cols = [{"id": "p", "name": "Parent", "slugs": [], "parent": "q"}, {"id": "q", "name": "Child", "slugs": [], "parent": "p"}, {"id": "r", "name": "Solo", "slugs": [], "parent": "ghost"}]
    out = {x["id"]: x for x in c.put("/api/reading/collections", json={"collections": cols}).json()["collections"]}
    assert not (out["p"].get("parent") and out["q"].get("parent")) and "parent" not in out["r"]
    ok = c.put("/api/reading/collections", json={"collections": [{"id": "a", "name": "A", "slugs": []}, {"id": "b", "name": "B", "slugs": [], "parent": "a"}]}).json()["collections"]
    assert ok[1]["parent"] == "a"

def test_saved_searches(env):
    c, _ = env
    r = c.put("/api/reading/searches", json={"searches": [{"name": "GRB papers", "q": "tag:grb type:paper"}, {"name": "", "q": "x"}]}).json()
    assert len(r["searches"]) == 1 and r["searches"][0]["id"].startswith("s_")
    assert c.get("/api/reading/searches").json()["searches"][0]["q"] == "tag:grb type:paper"

def test_latex_bib_writes_unique_keys_once(env):
    c, root = env
    a = add(c, "Attention Is All You Need", authors=["Ashish Vaswani"], year=2017, arxiv="1706.03762")
    b = add(c, "Attention Is Not Enough Today", authors=["Ann Vaswani"], year=2017)
    r = c.post("/api/reading/latex-bib", json={"project": "MyPaper/main", "slugs": [a["slug"], b["slug"]]}).json()
    assert r["added"] == 2 and r["keys"][a["slug"]] == "vaswani2017attention" and r["keys"][b["slug"]] == "vaswani2017attentiona"
    bib = (root / "70-LaTeX/MyPaper/references.bib").read_text()
    assert bib.count("@") == 2 and "eprint = {1706.03762}" in bib
    r2 = c.post("/api/reading/latex-bib", json={"project": "MyPaper", "slugs": [a["slug"]]}).json()
    assert r2["added"] == 0 and (root / "70-LaTeX/MyPaper/references.bib").read_text().count("@") == 2
    assert c.post("/api/reading/latex-bib", json={"project": "..", "slugs": []}).status_code == 400

def test_zotero_field_mapping():
    f = reading.zotero_item_fields({"key": "K1", "itemType": "preprint", "title": " T ", "creators": [{"creatorType": "author", "firstName": "Ann", "lastName": "Lee"}, {"creatorType": "editor", "name": "Ed"}],
        "date": "2021-03-04", "repository": "arXiv", "archiveID": "arXiv:2103.01234", "DOI": "", "tags": [{"tag": "grb"}], "extra": "Citation Key: lee2021grb"})
    assert f["title"] == "T" and f["authors"] == ["Ann Lee", "Ed"] and f["year"] == 2021 and f["arxiv"] == "2103.01234" and f["item_type"] == "preprint" and f["citekey"] == "lee2021grb" and f["tags"] == ["grb"]
    assert reading.zotero_item_fields({"itemType": "attachment", "title": "x"}) is None

class FakeResp:
    def __init__(self, data, status=200, content=b""): self._d, self.status_code, self.content = data, status, content
    def json(self): return self._d
    def raise_for_status(self): pass

def test_zotero_import_job(env, monkeypatch):
    import httpx, types, time
    c, root = env
    try:
        import zotero
    except ImportError:  # the real module lives next to reading.py in the app
        zotero = types.ModuleType('zotero'); zotero.zotero_credentials = lambda: ('', ''); monkeypatch.setitem(sys.modules, 'zotero', zotero)
    monkeypatch.setattr(zotero, "zotero_credentials", lambda: ("1", "k"))
    top = [{"key": "I1", "data": {"key": "I1", "itemType": "journalArticle", "title": "A Long Enough Title Alpha", "creators": [], "date": "2019", "collections": ["C2"], "DOI": "10.1/a"}},
           {"key": "I2", "data": {"key": "I2", "itemType": "book", "title": "A Long Enough Title Book", "creators": [], "date": "2010", "collections": []}}]
    kids = [{"key": "N1", "data": {"key": "N1", "itemType": "note", "parentItem": "I1", "note": "<p>my note</p>"}},
            {"key": "P1", "data": {"key": "P1", "itemType": "attachment", "parentItem": "I1", "contentType": "application/pdf", "linkMode": "imported_file"}}]
    colls = [{"key": "C1", "data": {"key": "C1", "name": "Root"}}, {"key": "C2", "data": {"key": "C2", "name": "Sub", "parentCollection": "C1"}}]
    class FakeClient:
        def __init__(self, **kw): pass
        def get(self, url, params=None):
            if url.endswith("/collections"): return FakeResp(colls if params["start"] == 0 else [])
            if url.endswith("/items/top"): return FakeResp(top if params["start"] == 0 else [])
            if url.endswith("/items"): return FakeResp(kids if params["start"] == 0 else [])
            if url.endswith("/file"): return FakeResp(None, 200, b"%PDF-1.4 zz")
            raise AssertionError(url)
    monkeypatch.setattr(httpx, "Client", FakeClient)
    assert c.post("/api/reading/import-zotero", json={"with_pdfs": True}).json()["ok"]
    for _ in range(50):
        st = c.get("/api/reading/import-zotero/status").json()
        if not st["running"] and st["phase"] in ("done", "error"): break
        time.sleep(0.1)
    assert st["phase"] == "done" and st["added"] == 2 and st["pdfs"] == 1 and st["collections"] == 2, st
    cols = {x["name"]: x for x in c.get("/api/reading/collections").json()["collections"]}
    assert cols["Sub"]["parent"] == cols["Root"]["id"] and len(cols["Sub"]["slugs"]) == 1
    lib = {b["title"]: b for b in c.get("/api/reading/library").json()["books"]}
    assert lib["A Long Enough Title Alpha"]["notes"] == "my note" and lib["A Long Enough Title Alpha"]["has_file"] and lib["A Long Enough Title Book"]["kind"] == "book"
    c.post("/api/reading/import-zotero", json={}); time.sleep(0.5)
    assert len(c.get("/api/reading/library").json()["books"]) == 2 and len(c.get("/api/reading/collections").json()["collections"]) == 2

def test_webpage_lookup(monkeypatch):
    html = b'<html><head><title>x</title><meta name="citation_title" content="Gamma-ray bursts"><meta name="citation_author" content="Lee, Ann"><meta name="citation_author" content="Bo Wu"><meta name="citation_publication_date" content="2020/05/01"><meta name="citation_journal_title" content="ApJ"><meta name="citation_firstpage" content="10"><meta name="citation_lastpage" content="20"></head></html>'
    class R:
        headers = type("H", (), {"get_content_charset": lambda self: "utf-8"})()
        def read(self, n=-1): return html
        def __enter__(self): return self
        def __exit__(self, *a): pass
    monkeypatch.setattr(reading, "_open", lambda req, timeout=20: R())
    it = reading.lookup_metadata("https://example.org/paper")
    assert it["title"] == "Gamma-ray bursts" and it["authors"] == ["Lee, Ann", "Bo Wu"] and it["year"] == 2020 and it["venue"] == "ApJ" and it["pages"] == "10-20" and it["item_type"] == "article"
