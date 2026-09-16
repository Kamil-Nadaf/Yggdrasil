"""LaTeX export for book sections — mocks the internal latex service."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

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

from fastapi.testclient import TestClient

import main


class LatexExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / "15-Books").mkdir(parents=True)
        (self.vault / "60-Meta").mkdir(parents=True)
        self._vault_patch = patch.object(main, "VAULT", self.vault)
        self._vault_patch.start()
        main._SCORING_CONFIG = None
        self.store: dict[str, str] = {}
        self.calls: list = []

        async def fake_latex(method, path, json=None, timeout=15.0):
            self.calls.append((method, path, json))
            filename = path.rsplit("/", 1)[-1]
            if method == "GET" and path.startswith("/files/"):
                if filename in self.store:
                    return 200, {"source": self.store[filename]}
                return 404, {"detail": "not found"}
            if method == "POST" and path == "/save":
                name = json["filename"]
                self.store[name] = json["source"]
                return 200, {"path": f"70-LaTeX/{name}"}
            return 500, {"detail": "unexpected"}

        self._http = patch.object(main, "_latex_json", side_effect=fake_latex)
        self._http.start()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self.client.close()
        self._http.stop()
        self._vault_patch.stop()
        self.tmp.cleanup()

    def _seed_section(self) -> None:
        self.client.post(
            "/api/books",
            json={"slug": "gravitation-mtw", "title": "Gravitation", "authors": ["Misner"], "year": 1973, "has_tracks": True},
        )
        self.client.put(
            "/api/books/gravitation-mtw/sections/ch4-s2",
            json={
                "frontmatter": {
                    "chapter": 4,
                    "section": "4.2",
                    "title": "The bending of light",
                    "explain_cold": "Light follows null geodesics.",
                    "sanity_check": "",
                    "confusions": "",
                },
                "body": "## Preview\nWhy does light bend?\n\n## Explain Cold\nLight follows null geodesics.\n",
            },
        )

    def test_snippet_omits_empty_paragraphs(self) -> None:
        snippet = main._build_book_latex_snippet(
            "Gravitation",
            "gravitation-mtw",
            {"chapter": 4, "section": "4.2", "title": "The bending of light", "explain_cold": "geodesics"},
            "## Preview\nWhy bend?\n\n## Sanity Check\n\n## Confusions\n",
        )
        self.assertIn(r"\subsection*{The bending of light}", snippet)
        self.assertIn(r"\paragraph{Preview}", snippet)
        self.assertIn(r"\paragraph{Explain Cold}", snippet)
        self.assertNotIn(r"\paragraph{Sanity Check}", snippet)
        self.assertNotIn(r"\paragraph{Confusions}", snippet)
        self.assertIn(r"\label{sec:gravitation-mtw-ch4-s4.2}", snippet)

    def test_create_writes_new_file(self) -> None:
        self._seed_section()
        r = self.client.post(
            "/api/books/gravitation-mtw/sections/ch4-s2/export-latex",
            json={"target_file": "gravitation-mtw-notes.tex", "mode": "create"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["path"], "70-LaTeX/gravitation-mtw-notes.tex")
        self.assertIn("gravitation-mtw-notes.tex", self.store)
        self.assertIn("bending of light", self.store["gravitation-mtw-notes.tex"])

    def test_create_fails_if_exists(self) -> None:
        self._seed_section()
        self.store["exists.tex"] = "already here"
        r = self.client.post(
            "/api/books/gravitation-mtw/sections/ch4-s2/export-latex",
            json={"target_file": "exists.tex", "mode": "create"},
        )
        self.assertEqual(r.status_code, 409)

    def test_append_keeps_existing_content(self) -> None:
        self._seed_section()
        self.store["notes.tex"] = "\\section{Old}\n"
        r = self.client.post(
            "/api/books/gravitation-mtw/sections/ch4-s2/export-latex",
            json={"target_file": "notes.tex", "mode": "append"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(self.store["notes.tex"].startswith("\\section{Old}"))
        self.assertIn("bending of light", self.store["notes.tex"])

    def test_rejects_bad_filename(self) -> None:
        self._seed_section()
        r = self.client.post(
            "/api/books/gravitation-mtw/sections/ch4-s2/export-latex",
            json={"target_file": "../escape.tex", "mode": "create"},
        )
        self.assertEqual(r.status_code, 400)

    def test_allows_nested_tex_path(self) -> None:
        self._seed_section()
        r = self.client.post(
            "/api/books/gravitation-mtw/sections/ch4-s2/export-latex",
            json={"target_file": "alias/notes.tex", "mode": "create"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["path"], "70-LaTeX/alias/notes.tex")


if __name__ == "__main__":
    unittest.main()
