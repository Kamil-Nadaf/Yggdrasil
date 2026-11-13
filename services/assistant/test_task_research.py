"""Task extras: priorities, tags, dates, estimate, timer, links, notes, files, project option lists."""
from __future__ import annotations

import base64
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


class TaskResearchApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / "80-Tasks").mkdir(parents=True)
        (self.vault / "60-Meta").mkdir(parents=True)
        self._vault_patch = patch.object(main, "VAULT", self.vault)
        self._vault_patch.start()
        self.client = TestClient(main.app, raise_server_exceptions=True)
        self.client.post("/api/task-projects", json={"name": "Alpha"})
        self.slug = "alpha"
        r = self.client.post(f"/api/task-projects/{self.slug}/main-tasks", json={"name": "Fit"})
        self.mt = r.json()["main_task"]["id"]

    def tearDown(self) -> None:
        self.client.close()
        self._vault_patch.stop()
        self.tmp.cleanup()

    def _put(self, item_id: str, **body):
        return self.client.put(f"/api/task-items/{self.slug}/{item_id}", json=body)

    def test_stage_next_step_waiting_roundtrip(self) -> None:
        r = self._put(self.mt, stage="Analyse", next_step="  Rerun fit  ", waiting_on="Supervisor")
        self.assertEqual(r.status_code, 200, r.text)
        t = r.json()["main_task"]
        self.assertEqual((t["stage"], t["next_step"], t["waiting_on"]), ("analyse", "Rerun fit", "Supervisor"))
        t = self._put(self.mt, stage="", waiting_on="").json()["main_task"]
        self.assertIsNone(t["stage"])
        self.assertEqual(t["waiting_on"], "")

    def test_milestone_flag(self) -> None:
        self.assertFalse(self.client.get(f"/api/task-items/{self.slug}/{self.mt}").json()["item"]["milestone"])
        t = self._put(self.mt, milestone=True).json()["main_task"]
        self.assertTrue(t["milestone"])

    def test_links_are_cleaned(self) -> None:
        links = [
            {"kind": "paper", "ref": "2401.12345", "label": "MAGIC"},
            {"kind": "paper", "ref": "2401.12345", "label": "MAGIC"},
            {"kind": "bogus", "ref": "x"},
            {"kind": "latex", "ref": "../escape"},
            {"kind": "figure", "ref": "plots/a.png"},
        ]
        t = self._put(self.mt, links=links).json()["main_task"]
        self.assertEqual([(x["kind"], x["ref"]) for x in t["links"]], [("paper", "2401.12345"), ("figure", "plots/a.png")])

    def test_bad_stage_rejected(self) -> None:
        self.assertEqual(self._put(self.mt, stage="party").status_code, 400)

    def test_subtask_has_the_same_fields(self) -> None:
        r = self.client.post(
            f"/api/task-projects/{self.slug}/main-tasks/{self.mt}/subtasks",
            json={"name": "Plot", "stage": "write", "next_step": "axes"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        st = r.json()["subtask"]
        self.assertEqual((st["stage"], st["next_step"]), ("write", "axes"))

    def test_comments_add_list_delete(self) -> None:
        url = f"/api/task-items/{self.slug}/{self.mt}/comments"
        self.assertEqual(self.client.post(url, json={"text": "   "}).status_code, 400)
        r = self.client.post(url, json={"text": "Looks good", "author": "Maruf"})
        self.assertEqual(r.status_code, 200, r.text)
        c = r.json()["comments"][0]
        self.assertEqual((c["author"], c["text"]), ("Maruf", "Looks good"))
        self.assertTrue(c["id"].startswith("c-") and c["at"])
        self.client.post(url, json={"text": "second"})
        item = self.client.get(f"/api/task-items/{self.slug}/{self.mt}").json()["item"]
        self.assertEqual([x["text"] for x in item["comments"]], ["Looks good", "second"])
        self.assertEqual(self.client.delete(f"{url}/nope").status_code, 404)
        r = self.client.delete(f"{url}/{c['id']}")
        self.assertEqual([x["text"] for x in r.json()["comments"]], ["second"])

    def test_comment_default_author(self) -> None:
        r = self.client.post(f"/api/task-items/{self.slug}/{self.mt}/comments", json={"text": "hi"})
        self.assertEqual(r.json()["comments"][0]["author"], "me")

    def test_file_limit_is_100mb_and_names_are_safe(self) -> None:
        self.assertEqual(main.TASK_FILE_MAX_BYTES, 100 * 1024 * 1024)
        url = f"/api/task-items/{self.slug}/{self.mt}/files"
        r = self.client.post(url, json={"name": "../../etc/pass wd.png", "content_b64": base64.b64encode(b"x").decode()})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["file"]["name"], "pass wd.png")
        with patch.object(main, "TASK_FILE_MAX_BYTES", 4):
            r = self.client.post(url, json={"name": "big.png", "content_b64": base64.b64encode(b"12345").decode()})
        self.assertEqual(r.status_code, 413)


if __name__ == "__main__":
    unittest.main()
