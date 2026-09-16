"""Books mode API — Tempdir vault, no running server."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

# main.py imports lancedb/pyarrow at module load; tests don't need a real index.
if "pyarrow" not in sys.modules:
    _pa = ModuleType("pyarrow")
    _pa.schema = lambda *a, **k: None
    _pa.field = lambda *a, **k: None
    _pa.utf8 = lambda: None
    _pa.float32 = lambda: None
    _pa.list_ = lambda *a, **k: None
    sys.modules["pyarrow"] = _pa
if "lancedb" not in sys.modules:
    _ldb = ModuleType("lancedb")
    _ldb.connect = lambda *a, **k: SimpleNamespace(
        open_table=lambda n: (_ for _ in ()).throw(Exception("no table"))
    )
    sys.modules["lancedb"] = _ldb

import frontmatter
from fastapi.testclient import TestClient

import main


class BooksApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / "15-Books").mkdir(parents=True)
        (self.vault / "10-Papers").mkdir(parents=True)
        (self.vault / "60-Meta").mkdir(parents=True)
        (self.vault / "70-LaTeX").mkdir(parents=True)
        self._vault_patch = patch.object(main, "VAULT", self.vault)
        self._vault_patch.start()
        self.client = TestClient(main.app, raise_server_exceptions=True)

    def tearDown(self) -> None:
        self.client.close()
        self._vault_patch.stop()
        self.tmp.cleanup()

    def test_post_books_creates_book_md_with_frontmatter(self) -> None:
        r = self.client.post(
            "/api/books",
            json={
                "slug": "gravitation-mtw",
                "title": "Gravitation",
                "authors": ["Misner, C.W.", "Thorne, K.S.", "Wheeler, J.A."],
                "year": 1973,
                "has_tracks": True,
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"ok": True, "slug": "gravitation-mtw"})
        path = self.vault / "15-Books" / "gravitation-mtw" / "_book.md"
        self.assertTrue(path.is_file())
        post = frontmatter.load(str(path))
        self.assertEqual(post.metadata["type"], "book")
        self.assertEqual(post.metadata["slug"], "gravitation-mtw")
        self.assertEqual(post.metadata["title"], "Gravitation")
        self.assertEqual(post.metadata["authors"][0], "Misner, C.W.")
        self.assertEqual(post.metadata["year"], 1973)
        self.assertTrue(post.metadata["has_tracks"])
        self.assertIn("started", post.metadata)

    def test_post_books_rejects_duplicate_and_bad_slug(self) -> None:
        body = {
            "slug": "gravitation-mtw",
            "title": "Gravitation",
            "authors": ["Misner, C.W."],
            "year": 1973,
            "has_tracks": True,
        }
        self.assertEqual(self.client.post("/api/books", json=body).status_code, 200)
        dup = self.client.post("/api/books", json=body)
        self.assertEqual(dup.status_code, 409)
        bad = self.client.post("/api/books", json={**body, "slug": "Gravitation MTW"})
        self.assertEqual(bad.status_code, 400)
        traversal = self.client.post("/api/books", json={**body, "slug": "../escape"})
        self.assertEqual(traversal.status_code, 400)

    def test_list_books_includes_section_count(self) -> None:
        self.client.post(
            "/api/books",
            json={
                "slug": "gravitation-mtw",
                "title": "Gravitation",
                "authors": ["Misner, C.W."],
                "year": 1973,
                "has_tracks": True,
            },
        )
        self.client.put(
            "/api/books/gravitation-mtw/sections/ch4-s2",
            json={"frontmatter": {"chapter": 4, "section": "4.2", "title": "The bending of light"}},
        )
        r = self.client.get("/api/books")
        self.assertEqual(r.status_code, 200)
        books = r.json()["books"]
        self.assertEqual(len(books), 1)
        self.assertEqual(books[0]["slug"], "gravitation-mtw")
        self.assertEqual(books[0]["section_count"], 1)
        self.assertEqual(books[0]["title"], "Gravitation")

    def test_put_section_writes_body_template_on_create(self) -> None:
        self.client.post(
            "/api/books",
            json={
                "slug": "gravitation-mtw",
                "title": "Gravitation",
                "authors": ["Misner, C.W."],
                "year": 1973,
                "has_tracks": True,
            },
        )
        r = self.client.put(
            "/api/books/gravitation-mtw/sections/ch4-s2",
            json={
                "frontmatter": {
                    "chapter": 4,
                    "section": "4.2",
                    "title": "The bending of light",
                    "track": 1,
                }
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"ok": True, "id": "ch4-s2"})
        got = self.client.get("/api/books/gravitation-mtw/sections/ch4-s2")
        self.assertEqual(got.status_code, 200)
        body = got.json()["body"]
        self.assertIn("## Preview", body)
        self.assertIn("## Explain Cold", body)
        self.assertIn("## Sanity Check", body)
        self.assertIn("## Confusions", body)
        fm = got.json()["frontmatter"]
        self.assertEqual(fm["type"], "book-section")
        self.assertEqual(fm["book"], "gravitation-mtw")
        self.assertEqual(fm["chapter"], 4)
        self.assertEqual(fm["explain_cold"], "")
        path = self.vault / "15-Books" / "gravitation-mtw" / "ch4-s2.md"
        self.assertTrue(path.is_file())
        loaded = frontmatter.load(str(path))
        self.assertEqual(loaded.metadata["type"], "book-section")

    def test_section_path_traversal_rejected(self) -> None:
        self.client.post(
            "/api/books",
            json={
                "slug": "safe-book",
                "title": "Safe",
                "authors": ["A"],
                "year": 2000,
                "has_tracks": False,
            },
        )
        r = self.client.put(
            "/api/books/safe-book/sections/../escape",
            json={"frontmatter": {"title": "nope"}},
        )
        self.assertIn(r.status_code, (400, 404, 422))
        self.assertFalse((self.vault / "escape.md").exists())

    def test_list_get_delete_raw_section(self) -> None:
        self.client.post(
            "/api/books",
            json={
                "slug": "gravitation-mtw",
                "title": "Gravitation",
                "authors": ["Misner, C.W."],
                "year": 1973,
                "has_tracks": True,
            },
        )
        self.client.put(
            "/api/books/gravitation-mtw/sections/ch4-s2",
            json={"frontmatter": {"chapter": 4, "section": "4.2", "title": "Light"}},
        )
        listed = self.client.get("/api/books/gravitation-mtw/sections")
        self.assertEqual(listed.status_code, 200)
        data = listed.json()
        self.assertEqual(data["book"]["slug"], "gravitation-mtw")
        self.assertEqual(len(data["sections"]), 1)
        self.assertEqual(data["sections"][0]["id"], "ch4-s2")
        raw = self.client.get("/api/books/gravitation-mtw/sections/ch4-s2/raw")
        self.assertEqual(raw.status_code, 200)
        self.assertIn("type: book-section", raw.json()["raw"])
        gone = self.client.delete("/api/books/gravitation-mtw/sections/ch4-s2")
        self.assertEqual(gone.status_code, 200)
        self.assertEqual(self.client.get("/api/books/gravitation-mtw/sections/ch4-s2").status_code, 404)

    def test_graph_marks_book_sections_as_15_books(self) -> None:
        self.client.post(
            "/api/books",
            json={
                "slug": "gravitation-mtw",
                "title": "Gravitation",
                "authors": ["Misner, C.W."],
                "year": 1973,
                "has_tracks": True,
            },
        )
        self.client.put(
            "/api/books/gravitation-mtw/sections/ch4-s2",
            json={
                "frontmatter": {"chapter": 4, "section": "4.2", "title": "Light", "concepts": ["[[geodesic]]"]},
                "body": "## Preview\nSee [[geodesic]]\n",
            },
        )
        r = self.client.get("/api/graph")
        self.assertEqual(r.status_code, 200)
        nodes = r.json()["nodes"]
        book_nodes = [n for n in nodes if n["folder"] == "15-Books"]
        self.assertTrue(book_nodes, nodes)
        self.assertTrue(any("ch4-s2" in n["id"] for n in book_nodes))
        edges = r.json()["edges"]
        self.assertTrue(any(e["target"] == "geodesic" for e in edges), edges)


if __name__ == "__main__":
    unittest.main()
