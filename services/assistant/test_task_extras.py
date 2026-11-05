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
import task_options as to


class TaskOptionsUnitTests(unittest.TestCase):
    def test_relations_drop_junk_self_and_duplicates(self) -> None:
        me = "p/mt-aaaaaaaaaaaa"
        other = "p/st-bbbbbbbbbbbb"
        out = to.clean_relations(
            [
                {"type": "blocked_by", "target": other},
                {"type": "blocked_by", "target": other},
                {"type": "related", "target": me},
                {"type": "nonsense", "target": other},
                {"type": "related", "target": "../etc/passwd"},
            ],
            me,
        )
        self.assertEqual(out, [{"type": "blocked_by", "target": other}])

    def test_estimate_and_dates_validate(self) -> None:
        self.assertEqual(to.clean_estimate("90"), 90)
        self.assertIsNone(to.clean_estimate(0))
        with self.assertRaises(ValueError):
            to.clean_estimate(-5)
        with self.assertRaises(ValueError):
            to.clean_date("tomorrow")
        self.assertEqual(to.clean_date("2026-11-05"), "2026-11-05")

    def test_allowed_none_means_all_and_unknown_ids_drop(self) -> None:
        self.assertIsNone(to.clean_allowed(None, ["a", "b"]))
        self.assertEqual(to.clean_allowed(["b", "zzz", "b"], ["a", "b"]), ["b"])

    def test_priorities_need_one_tags_may_be_empty(self) -> None:
        with self.assertRaises(ValueError):
            to.normalize_priorities([])
        self.assertEqual(to.normalize_tags([]), [])
        tags = to.normalize_tags([{"name": "reading"}, {"name": "fitting", "color": "#112233"}])
        self.assertEqual([t["name"] for t in tags], ["reading", "fitting"])
        self.assertTrue(all(t["id"] for t in tags))

    def test_elapsed(self) -> None:
        self.assertEqual(to.timer_elapsed_sec("2026-11-05T10:00:00", "2026-11-05T10:01:30"), 90)
        self.assertEqual(to.timer_elapsed_sec(None, "2026-11-05T10:01:30"), 0)


class TaskExtrasApiTests(unittest.TestCase):
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

    def tearDown(self) -> None:
        self.client.close()
        self._vault_patch.stop()
        self.tmp.cleanup()

    def _main(self, name: str = "Fit spectra", **extra) -> dict:
        r = self.client.post(f"/api/task-projects/{self.slug}/main-tasks", json={"name": name, **extra})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["main_task"]

    def test_create_with_all_extras_and_read_back(self) -> None:
        mt = self._main(
            priority_id="urgent",
            start="2026-11-04",
            deadline="2026-11-07",
            estimate_min=240,
            tags=["t1", "t2", "t1"],
            note="## Plan\n- fit CPL",
        )
        self.assertEqual(mt["priority_id"], "urgent")
        self.assertEqual(mt["start"], "2026-11-04")
        self.assertEqual(mt["estimate_min"], 240)
        self.assertEqual(mt["tags"], ["t1", "t2"])
        self.assertTrue(mt["has_note"])
        got = self.client.get(f"/api/task-items/{self.slug}/{mt['id']}").json()
        self.assertEqual(got["note"], "## Plan\n- fit CPL")

    def test_unknown_priority_becomes_none_and_bad_date_rejected(self) -> None:
        mt = self._main(priority_id="nope")
        self.assertIsNone(mt["priority_id"])
        r = self.client.put(f"/api/task-items/{self.slug}/{mt['id']}", json={"start": "soon"})
        self.assertEqual(r.status_code, 400)

    def test_generic_item_update_works_for_subtasks(self) -> None:
        mt = self._main()
        st = self.client.post(
            f"/api/task-projects/{self.slug}/main-tasks/{mt['id']}/subtasks", json={"name": "Load data"}
        ).json()["subtask"]
        r = self.client.put(
            f"/api/task-items/{self.slug}/{st['id']}", json={"status_id": "done", "priority_id": "high", "tags": ["x"]}
        )
        self.assertEqual(r.status_code, 200, r.text)
        sub = r.json()["subtask"]
        self.assertTrue(sub["done"])
        self.assertIsNotNone(sub["completed_at"])
        self.assertEqual(sub["priority_id"], "high")

    def test_all_tasks_lists_both_kinds_with_derived_blocking(self) -> None:
        a = self._main("A")
        b = self._main("B")
        self.client.put(
            f"/api/task-items/{self.slug}/{b['id']}",
            json={"relations": [{"type": "blocked_by", "target": f"{self.slug}/{a['id']}"}]},
        )
        self.client.post(f"/api/task-projects/{self.slug}/main-tasks/{a['id']}/subtasks", json={"name": "Sub"})
        data = self.client.get("/api/tasks/all").json()
        by_name = {i["name"]: i for i in data["items"]}
        self.assertEqual(by_name["A"]["blocking"], [f"{self.slug}/{b['id']}"])
        self.assertEqual(by_name["B"]["relations"][0]["type"], "blocked_by")
        self.assertEqual(by_name["Sub"]["kind"], "subtask")
        self.assertEqual(by_name["Sub"]["main_task_name"], "A")
        self.assertEqual(by_name["A"]["subtask_total"], 1)

    def test_dangling_relation_targets_are_dropped(self) -> None:
        a = self._main("A")
        self.client.put(
            f"/api/task-items/{self.slug}/{a['id']}",
            json={"relations": [{"type": "related", "target": f"{self.slug}/mt-000000000000"}]},
        )
        items = self.client.get("/api/tasks/all").json()["items"]
        self.assertEqual(items[0]["relations"], [])

    def test_only_one_timer_runs_and_time_is_banked(self) -> None:
        a = self._main("A")
        b = self._main("B")
        self.client.post(f"/api/task-items/{self.slug}/{a['id']}/timer", json={"action": "start"})
        with patch.object(main, "_now_iso", return_value="2099-01-01T00:00:00"):
            r = self.client.post(f"/api/task-items/{self.slug}/{b['id']}/timer", json={"action": "start"})
        self.assertEqual(r.status_code, 200)
        items = {i["name"]: i for i in self.client.get("/api/tasks/all").json()["items"]}
        self.assertIsNone(items["A"]["timer_started_at"])
        self.assertEqual(items["A"]["tracked_sec"], main.MAX_TIMER_SEC)  # capped: A "ran" for decades
        self.assertIsNotNone(items["B"]["timer_started_at"])
        r = self.client.post(f"/api/task-items/{self.slug}/{b['id']}/timer", json={"action": "stop"})
        self.assertIsNone(r.json()["item"]["timer_started_at"])
        bad = self.client.post(f"/api/task-items/{self.slug}/{b['id']}/timer", json={"action": "pause"})
        self.assertEqual(bad.status_code, 400)

    def test_project_options_roundtrip_and_validation(self) -> None:
        r = self.client.put(f"/api/task-projects/{self.slug}/options", json={"priority_ids": ["high", "bogus"]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["project"]["options"]["priority_ids"], ["high"])
        self.assertIsNone(r.json()["project"]["options"]["status_ids"])
        r = self.client.put(f"/api/task-projects/{self.slug}/options", json={"status_ids": []})
        self.assertEqual(r.status_code, 400)
        r = self.client.put(f"/api/task-projects/{self.slug}/options", json={"priority_ids": None})
        self.assertIsNone(r.json()["project"]["options"]["priority_ids"])

    def test_settings_options_save_and_purge_removed_from_tasks(self) -> None:
        r = self.client.post(
            "/api/settings/task-options",
            json={"task_tags": [{"id": "reading", "name": "reading", "color": "#A77BE0"}, {"id": "fit", "name": "fit"}]},
        )
        self.assertEqual(r.status_code, 200, r.text)
        mt = self._main(tags=["reading", "fit"], priority_id="high")
        got = self.client.get("/api/settings/task-options").json()
        self.assertEqual(got["usage"]["tags"]["reading"], 1)
        self.client.post(
            "/api/settings/task-options",
            json={
                "task_tags": [{"id": "fit", "name": "fit"}],
                "task_priorities": [{"id": "urgent", "name": "Urgent"}, {"id": "low", "name": "Low"}],
            },
        )
        item = self.client.get(f"/api/task-items/{self.slug}/{mt['id']}").json()["item"]
        self.assertEqual(item["tags"], ["fit"])
        self.assertIsNone(item["priority_id"])
        bad = self.client.post("/api/settings/task-options", json={"task_priorities": []})
        self.assertEqual(bad.status_code, 400)

    def test_files_upload_download_delete_and_cleanup(self) -> None:
        mt = self._main()
        payload = {"name": "../spec trum.pha", "content_b64": base64.b64encode(b"DATA").decode()}
        r = self.client.post(f"/api/task-items/{self.slug}/{mt['id']}/files", json=payload)
        self.assertEqual(r.status_code, 200, r.text)
        name = r.json()["file"]["name"]
        self.assertNotIn("/", name)
        dup = self.client.post(f"/api/task-items/{self.slug}/{mt['id']}/files", json=payload).json()["file"]["name"]
        self.assertNotEqual(name, dup)
        got = self.client.get(f"/api/task-items/{self.slug}/{mt['id']}/files/{name}")
        self.assertEqual(got.content, b"DATA")
        item = self.client.get(f"/api/task-items/{self.slug}/{mt['id']}").json()["item"]
        self.assertEqual(len(item["files"]), 2)
        self.assertEqual(self.client.delete(f"/api/task-items/{self.slug}/{mt['id']}/files/{dup}").status_code, 200)
        self.client.delete(f"/api/task-items/{self.slug}/{mt['id']}")
        self.assertFalse((self.vault / "80-Tasks" / self.slug / "_files" / mt["id"]).exists())

    def test_bad_ids_rejected(self) -> None:
        self.assertEqual(self.client.get(f"/api/task-items/{self.slug}/not-an-id").status_code, 400)
        self.assertEqual(self.client.get(f"/api/task-items/{self.slug}/mt-000000000000").status_code, 404)

    def test_active_summary_carries_quick_action_fields(self) -> None:
        mt = self._main("Starred", priority_id="high")
        self.client.put(f"/api/task-projects/{self.slug}/main-tasks/{mt['id']}", json={"is_active": True})
        self.client.post(f"/api/task-items/{self.slug}/{mt['id']}/timer", json={"action": "start"})
        active = self.client.get("/api/tasks/active-summary").json()["active"][0]
        self.assertEqual(active["status_id"], "todo")
        self.assertEqual(active["priority_id"], "high")
        self.assertIsNotNone(active["timer_started_at"])


if __name__ == "__main__":
    unittest.main()
