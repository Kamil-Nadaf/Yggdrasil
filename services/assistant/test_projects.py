"""Projects hub, project:<slug> reading tags, project files — Tempdir vault."""
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
import projects as P
from datetime import date


class ProjectHelperTests(unittest.TestCase):
    def test_project_slugs_of(self) -> None:
        self.assertEqual(P.project_slugs_of(["a", "project:x", "project:x", "project:y", 3]), ["x", "y"])

    def test_due_state(self) -> None:
        today = date(2026, 11, 13)
        self.assertEqual(P.due_state("2026-11-12", today), "overdue")
        self.assertEqual(P.due_state("2026-11-13", today), "soon")
        self.assertEqual(P.due_state("2026-11-20", today), "soon")
        self.assertIsNone(P.due_state("2026-11-21", today))
        self.assertIsNone(P.due_state(None, today))

    def test_safe_filename(self) -> None:
        self.assertEqual(P.safe_filename("../../etc/passwd"), "passwd")
        self.assertEqual(P.safe_filename("a b.pdf"), "a b.pdf")
        self.assertEqual(P.safe_filename(".."), "")

    def test_summarize_counts_leaves(self) -> None:
        today = date(2026, 11, 13)
        mains = [("mt-1", {"status_id": "todo", "is_active": True, "deadline": "2026-11-10"}),
                 ("mt-2", {"status_id": "done"})]
        subs = [{"main_task_id": "mt-1", "status_id": "done"}, {"main_task_id": "mt-1", "status_id": "todo"}]
        s = P.summarize_tasks(mains, subs, today)
        self.assertEqual(s["task_count"], 3)
        self.assertEqual(s["done_count"], 2)
        self.assertEqual(s["overdue"], 1)
        self.assertEqual(s["starred"], 1)


class ProjectsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / "80-Tasks").mkdir(parents=True)
        (self.vault / "60-Meta").mkdir(parents=True)
        self._vault_patch = patch.object(main, "VAULT", self.vault)
        self._vault_patch.start()
        self.client = TestClient(main.app, raise_server_exceptions=True)
        self.client.post("/api/task-projects", json={"name": "Fermi Analysis"})

    def tearDown(self) -> None:
        self.client.close()
        self._vault_patch.stop()
        self.tmp.cleanup()

    def test_hub_lists_projects_without_pinned(self) -> None:
        r = self.client.get("/api/projects")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([p["slug"] for p in r.json()["projects"]], ["fermi-analysis"])

    def test_reading_tag_is_counted(self) -> None:
        book = self.vault / "15-Books" / "some-paper"
        book.mkdir(parents=True)
        (book / "_book.md").write_text("---\ntitle: P\ntags:\n- project:fermi-analysis\n---\n")
        p = self.client.get("/api/projects").json()["projects"][0]
        self.assertEqual(p["reading"], 1)

    def test_files_roundtrip_and_traversal(self) -> None:
        r = self.client.post("/api/projects/fermi-analysis/files", files={"file": ("../x.txt", b"hello")})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["name"], "x.txt")
        self.assertEqual(self.client.get("/api/projects/fermi-analysis/files").json()["files"][0]["name"], "x.txt")
        self.assertEqual(self.client.get("/api/projects/fermi-analysis/files/x.txt").content, b"hello")
        self.assertEqual(self.client.post("/api/projects/fermi-analysis/files", files={"file": ("x.txt", b"2")}).json()["name"], "x (2).txt")
        self.assertEqual(self.client.get("/api/projects/fermi-analysis/files/..%2Fx.txt").status_code in (400, 404), True)
        self.assertEqual(self.client.delete("/api/projects/fermi-analysis/files/x.txt").status_code, 200)

    def test_upload_to_missing_project_404(self) -> None:
        r = self.client.post("/api/projects/nope/files", files={"file": ("a.txt", b"1")})
        self.assertEqual(r.status_code, 404)

    def test_latex_links(self) -> None:
        r = self.client.put("/api/projects/fermi-analysis/links", json={"latex": ["paper", "paper", "../bad"]})
        self.assertEqual(r.json()["latex"], ["paper"])
        self.assertEqual(self.client.get("/api/projects").json()["projects"][0]["latex"], ["paper"])


if __name__ == "__main__":
    unittest.main()
