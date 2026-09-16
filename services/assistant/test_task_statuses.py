"""Customizable task statuses — Tempdir vault, no running server."""
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


DEFAULT_STATUSES = [
    {"id": "todo", "name": "To Do", "color": "#6B7280", "order": 0, "icon": "circle-outline"},
    {"id": "in_progress", "name": "In Progress", "color": "#F59E0B", "order": 1, "icon": "half-fill"},
    {"id": "done", "name": "Done", "color": "#34D399", "order": 2, "icon": "full-fill"},
]


class TaskStatusesApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        (self.vault / "80-Tasks").mkdir(parents=True)
        (self.vault / "60-Meta").mkdir(parents=True)
        self._vault_patch = patch.object(main, "VAULT", self.vault)
        self._vault_patch.start()
        self.client = TestClient(main.app, raise_server_exceptions=True)

    def tearDown(self) -> None:
        self.client.close()
        self._vault_patch.stop()
        self.tmp.cleanup()

    def test_get_seeds_defaults(self) -> None:
        r = self.client.get("/api/settings/task-statuses")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual([s["id"] for s in body["task_statuses"]], ["todo", "in_progress", "done"])
        self.assertEqual(body["usage"], {})

    def test_rename_does_not_break_existing_tasks(self) -> None:
        self.client.post("/api/task-projects", json={"name": "P"})
        mt = self.client.post("/api/task-projects/p/main-tasks", json={"name": "M"}).json()["main_task"]
        self.assertEqual(mt["status_id"], "todo")

        renamed = [dict(s) for s in DEFAULT_STATUSES]
        renamed[0]["name"] = "Backlog"
        r = self.client.post("/api/settings/task-statuses", json={"task_statuses": renamed})
        self.assertEqual(r.status_code, 200)

        # Task still resolves to the same (now renamed) status — id-based, name is cosmetic.
        r = self.client.get("/api/task-projects/p/main-tasks")
        self.assertEqual(r.json()["main_tasks"][0]["status_id"], "todo")

    def test_add_status(self) -> None:
        statuses = [dict(s) for s in DEFAULT_STATUSES]
        statuses.append({"name": "Blocked", "color": "#EF4444", "icon": "square"})
        r = self.client.post("/api/settings/task-statuses", json={"task_statuses": statuses})
        self.assertEqual(r.status_code, 200)
        ids = [s["id"] for s in r.json()["task_statuses"]]
        self.assertEqual(len(ids), 4)
        self.assertTrue(ids[3])  # server generated a slug id

    def test_delete_unused_status_succeeds_without_reassign(self) -> None:
        statuses = [s for s in DEFAULT_STATUSES if s["id"] != "in_progress"]
        r = self.client.post("/api/settings/task-statuses", json={"task_statuses": statuses})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([s["id"] for s in r.json()["task_statuses"]], ["todo", "done"])

    def test_delete_used_status_requires_reassignment(self) -> None:
        self.client.post("/api/task-projects", json={"name": "P"})
        mt = self.client.post("/api/task-projects/p/main-tasks", json={"name": "M"}).json()["main_task"]
        self.client.put(f"/api/task-projects/p/main-tasks/{mt['id']}", json={"status_id": "in_progress"})

        statuses = [s for s in DEFAULT_STATUSES if s["id"] != "in_progress"]
        r = self.client.post("/api/settings/task-statuses", json={"task_statuses": statuses})
        self.assertEqual(r.status_code, 409)
        detail = r.json()["detail"]
        self.assertEqual(detail["status_id"], "in_progress")
        self.assertEqual(detail["count"], 1)

        # Resubmit with a reassignment — now it succeeds and the task is moved.
        r = self.client.post(
            "/api/settings/task-statuses",
            json={"task_statuses": statuses, "reassign": {"in_progress": "todo"}},
        )
        self.assertEqual(r.status_code, 200)
        r = self.client.get("/api/task-projects/p/main-tasks")
        self.assertEqual(r.json()["main_tasks"][0]["status_id"], "todo")

    def test_usage_counts_main_tasks_and_subtasks(self) -> None:
        self.client.post("/api/task-projects", json={"name": "P"})
        mt = self.client.post("/api/task-projects/p/main-tasks", json={"name": "M"}).json()["main_task"]
        self.client.post(f"/api/task-projects/p/main-tasks/{mt['id']}/subtasks", json={"name": "S1"})
        self.client.post(f"/api/task-projects/p/main-tasks/{mt['id']}/subtasks", json={"name": "S2"})

        r = self.client.get("/api/settings/task-statuses")
        self.assertEqual(r.json()["usage"]["todo"], 3)  # 1 main task + 2 subtasks


if __name__ == "__main__":
    unittest.main()
