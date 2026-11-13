"""Slide decks: JSON files in 50-Projects/<slug>/slides."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

if "pyarrow" not in sys.modules:
    _pa = ModuleType("pyarrow")
    for _n in ("schema", "field", "utf8", "float32", "list_"):
        setattr(_pa, _n, lambda *a, **k: None)
    sys.modules["pyarrow"] = _pa
if "lancedb" not in sys.modules:
    _ldb = ModuleType("lancedb")
    _ldb.connect = lambda *a, **k: SimpleNamespace(open_table=lambda n: (_ for _ in ()).throw(Exception("no table")))
    sys.modules["lancedb"] = _ldb

from fastapi.testclient import TestClient

import main


class SlidesApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = patch.object(main, "VAULT", Path(self.tmp.name))
        self.patch.start()
        self.c = TestClient(main.app)

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_roundtrip_list_delete(self):
        deck = {"title": "T", "slides": [{"id": "a", "elements": []}]}
        self.assertEqual(self.c.get("/api/projects/p1/slides").json(), {"decks": []})
        r = self.c.put("/api/projects/p1/slides/My deck", json=deck)
        self.assertEqual(r.status_code, 200)
        self.assertTrue((Path(self.tmp.name) / "50-Projects/p1/slides/My deck.json").is_file())
        self.assertEqual(self.c.get("/api/projects/p1/slides/My deck").json(), deck)
        self.assertEqual([d["name"] for d in self.c.get("/api/projects/p1/slides").json()["decks"]], ["My deck"])
        self.assertEqual(self.c.delete("/api/projects/p1/slides/My deck").status_code, 200)
        self.assertEqual(self.c.get("/api/projects/p1/slides/My deck").status_code, 404)

    def test_rejects_bad_body_and_names(self):
        self.assertEqual(self.c.put("/api/projects/p1/slides/x", content=b"nope").status_code, 400)
        self.assertEqual(self.c.put("/api/projects/p1/slides/x", json={"a": 1}).status_code, 400)
        self.assertEqual(self.c.put("/api/projects/p1/slides/%20..", json={"slides": []}).status_code, 400)

    def test_name_is_sanitised(self):
        self.c.put("/api/projects/p1/slides/a%3Ab%3Fc.json", json={"slides": []})
        files = list((Path(self.tmp.name) / "50-Projects/p1/slides").glob("*.json"))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].name, "a_b_c.json")


if __name__ == "__main__":
    unittest.main()
