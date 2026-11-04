import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import reading, citations

@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(reading, "download_pdf", lambda url, dest: dest.write_bytes(b"%PDF-1.4 x") or True)
    app = FastAPI()
    app.include_router(reading.make_router(lambda: tmp_path, lambda d, h: None))
    return TestClient(app), tmp_path

P = {"title": "Attention Is All You Need", "authors": ["Ashish Vaswani", "Noam Shazeer"], "year": 2017, "arxiv": "1706.03762", "abstract": "x"}

def test_add_paper_downloads_pdf_and_dedupes(env):
    c, root = env
    r = c.post("/api/reading/items", json=P).json()
    b = r["book"]
    assert r["ok"] and not r["duplicate"] and r["pdf_saved"] and b["kind"] == "paper" and b["format"] == "pdf" and b["arxiv"] == "1706.03762"
    r2 = c.post("/api/reading/items", json={**P, "arxiv": "arXiv:1706.03762v5"}).json()
    assert r2["duplicate"] and r2["book"]["slug"] == b["slug"]
    assert len(c.get("/api/reading/library").json()["books"]) == 1

def test_add_to_collection_and_patch_fields(env):
    c, _ = env
    c.put("/api/reading/collections", json={"collections": [{"id": "c1", "name": "GRB", "slugs": []}]})
    slug = c.post("/api/reading/items", json={**P, "collection": "c1"}).json()["book"]["slug"]
    assert c.get("/api/reading/collections").json()["collections"][0]["slugs"] == [slug]
    # adding the same paper again to another collection works through the duplicate path
    b = c.patch(f"/api/reading/{slug}", json={"tags": ["nlp", "nlp", " dl "], "venue": "NeurIPS", "item_type": "conference", "favorite": True, "notes": "great", "doi": "10.5555/3295222"}).json()["book"]
    assert b["tags"] == ["dl", "nlp"] and b["venue"] == "NeurIPS" and b["favorite"] and b["notes"] == "great"
    assert c.patch(f"/api/reading/{slug}", json={"item_type": "bogus"}).status_code == 400

def test_cite_and_export(env):
    c, _ = env
    slug = c.post("/api/reading/items", json={**P, "venue": "NeurIPS", "item_type": "conference", "fetch_pdf": False}).json()["book"]["slug"]
    bib = c.get(f"/api/reading/{slug}/cite", params={"style": "bibtex"}).json()
    assert bib["citekey"] == "vaswani2017attention" and "@inproceedings{vaswani2017attention," in bib["text"] and "booktitle = {NeurIPS}" in bib["text"]
    apa = c.get(f"/api/reading/{slug}/cite", params={"style": "apa"}).json()["text"]
    assert apa.startswith("Vaswani, A., & Shazeer, N. (2017). Attention Is All You Need.")
    ieee = c.get(f"/api/reading/{slug}/cite", params={"style": "ieee"}).json()["text"]
    assert ieee.startswith("A. Vaswani and N. Shazeer, “Attention Is All You Need,”")
    assert c.get(f"/api/reading/{slug}/cite", params={"style": "nope"}).status_code == 400
    ex = c.get("/api/reading/export", params={"format": "ris"})
    assert ex.status_code == 200 and "TY  - CONF" in ex.text and "attachment" in ex.headers["content-disposition"]

BIB = r'''
@article{tong2012,
  author = {Tong, David and Van der Berg, J.},
  title = {Lectures on {Gravitation} \& Friends},
  journal = "Annals",
  year = 2012, pages = {10--20},
  doi = {10.1/abc}
}
@misc{x, title={Hello World Preprint}, author={Doe, Jane}, eprint={2101.00001}, archivePrefix={arXiv}, year={2021}}
@comment{ignored}
'''

def test_bibtex_roundtrip_and_import(env):
    c, _ = env
    items = citations.parse_bibtex(BIB)
    assert len(items) == 2
    a = items[0]
    assert a["title"] == "Lectures on Gravitation & Friends" and a["authors"] == ["Tong, David", "Van der Berg, J."] and a["pages"] == "10-20" and a["year"] == 2012
    assert items[1]["arxiv"] == "2101.00001" and items[1]["item_type"] == "preprint"
    r = c.post("/api/reading/import-refs", json={"text": BIB}).json()
    assert r["added"] == 2 and r["duplicates"] == 0
    assert c.post("/api/reading/import-refs", json={"text": BIB}).json() == {"ok": True, "added": 0, "duplicates": 2}
    lib = {b["title"]: b for b in c.get("/api/reading/library").json()["books"]}
    assert lib["Lectures on Gravitation & Friends"]["citekey"] == "tong2012"
    assert c.post("/api/reading/import-refs", json={"text": "nothing"}).status_code == 400

def test_ris_roundtrip():
    it = {"title": "T", "authors": ["Ann Lee"], "year": 2020, "venue": "J", "pages": "1-5", "doi": "10.1/x", "tags": ["a"], "item_type": "article"}
    back = citations.parse_ris(citations.to_ris(it))[0]
    assert back["authors"] == ["Lee, Ann"] and back["pages"] == "1-5" and back["doi"] == "10.1/x" and back["tags"] == ["a"]

def test_names_and_keys():
    assert citations.parse_name("Ludwig van Beethoven") == ("van Beethoven", "Ludwig")
    assert citations.parse_name("Hawking, Stephen W.") == ("Hawking", "Stephen W.")
    assert citations.make_citekey({"authors": ["Jürgen Müller"], "year": 2001, "title": "The Theory of Things"}) == "muller2001theory"
