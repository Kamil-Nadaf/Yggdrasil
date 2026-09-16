"""Tasks: project → main task → subtask — Tempdir vault, no running server."""
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


class TasksApiTests(unittest.TestCase):
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

    def test_list_projects_seeds_pinned_daily_habits(self) -> None:
        r = self.client.get("/api/task-projects")
        self.assertEqual(r.status_code, 200)
        projects = r.json()["projects"]
        self.assertEqual(projects[0]["slug"], "_daily-habits")
        self.assertTrue(projects[0]["pinned"])

    def test_pinned_project_cannot_be_deleted(self) -> None:
        self.client.get("/api/task-projects")  # seed it
        r = self.client.delete("/api/task-projects/_daily-habits")
        self.assertEqual(r.status_code, 400)

    def test_delete_project_removes_its_folder(self) -> None:
        self.client.post("/api/task-projects", json={"name": "Scratch Project"})
        r = self.client.delete("/api/task-projects/scratch-project")
        self.assertEqual(r.status_code, 200)
        self.assertFalse((self.vault / "80-Tasks" / "scratch-project").exists())

    def test_create_project_slugifies_name(self) -> None:
        r = self.client.post("/api/task-projects", json={"name": "Fermi Analysis"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["project"]["slug"], "fermi-analysis")

    def test_full_tree_lifecycle_and_progress_counts(self) -> None:
        self.client.post("/api/task-projects", json={"name": "Fermi Analysis"})

        r = self.client.post(
            "/api/task-projects/fermi-analysis/main-tasks",
            json={"name": "Develop dashboard", "deadline": "2026-09-20"},
        )
        self.assertEqual(r.status_code, 200)
        mt = r.json()["main_task"]
        self.assertFalse(mt["is_active"])
        self.assertEqual(mt["status_id"], "todo")
        self.assertEqual(mt["subtask_total"], 0)

        st1 = self.client.post(
            f"/api/task-projects/fermi-analysis/main-tasks/{mt['id']}/subtasks",
            json={"name": "Fix LaTeX error"},
        ).json()["subtask"]
        self.client.post(
            f"/api/task-projects/fermi-analysis/main-tasks/{mt['id']}/subtasks",
            json={"name": "Design dashboard"},
        )

        # Progress count reflects live subtask state.
        r = self.client.get("/api/task-projects/fermi-analysis/main-tasks")
        listed = r.json()["main_tasks"][0]
        self.assertEqual(listed["subtask_total"], 2)
        self.assertEqual(listed["subtask_done"], 0)

        # Mark one subtask done — completed_at gets stamped, counts update.
        r = self.client.put(
            f"/api/task-projects/fermi-analysis/main-tasks/{mt['id']}/subtasks/{st1['id']}",
            json={"status_id": "done"},
        )
        self.assertTrue(r.json()["subtask"]["completed_at"])
        self.assertTrue(r.json()["subtask"]["done"])

        # Moving it back to in_progress clears completed_at.
        r = self.client.put(
            f"/api/task-projects/fermi-analysis/main-tasks/{mt['id']}/subtasks/{st1['id']}",
            json={"status_id": "in_progress"},
        )
        self.assertIsNone(r.json()["subtask"]["completed_at"])
        self.assertFalse(r.json()["subtask"]["done"])

        # Back to done for the rest of the test.
        self.client.put(
            f"/api/task-projects/fermi-analysis/main-tasks/{mt['id']}/subtasks/{st1['id']}",
            json={"status_id": "done"},
        )

        r = self.client.get("/api/task-projects/fermi-analysis/main-tasks")
        listed = r.json()["main_tasks"][0]
        self.assertEqual(listed["subtask_done"], 1)

        # Not active yet — shouldn't surface on the Dashboard.
        r = self.client.get("/api/tasks/active-summary")
        self.assertEqual(r.json()["active"], [])

        # Mark active — now it should.
        self.client.put(
            f"/api/task-projects/fermi-analysis/main-tasks/{mt['id']}",
            json={"is_active": True},
        )
        r = self.client.get("/api/tasks/active-summary")
        active = r.json()["active"]
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]["main_task_name"], "Develop dashboard")
        self.assertEqual(active[0]["subtask_done"], 1)
        self.assertEqual(active[0]["subtask_total"], 2)
        self.assertEqual(active[0]["deadline"], "2026-09-20")

        # Deleting the main task cascades to its subtasks.
        r = self.client.delete(f"/api/task-projects/fermi-analysis/main-tasks/{mt['id']}")
        self.assertEqual(r.status_code, 200)
        remaining_files = list((self.vault / "80-Tasks" / "fermi-analysis").glob("st-*.md"))
        self.assertEqual(remaining_files, [])

    def test_status_defaults_and_rejects_unknown_values(self) -> None:
        self.client.post("/api/task-projects", json={"name": "Status Test"})
        mt = self.client.post(
            "/api/task-projects/status-test/main-tasks", json={"name": "M1", "status_id": "bogus"}
        ).json()["main_task"]
        self.assertEqual(mt["status_id"], "todo")  # invalid value silently normalized

        r = self.client.put(
            f"/api/task-projects/status-test/main-tasks/{mt['id']}", json={"status_id": "in_progress"}
        )
        self.assertEqual(r.json()["main_task"]["status_id"], "in_progress")

    def test_completed_by_day_counts_subtasks(self) -> None:
        self.client.post("/api/task-projects", json={"name": "Reading"})
        mt = self.client.post(
            "/api/task-projects/reading/main-tasks", json={"name": "Read paper 1"}
        ).json()["main_task"]
        st = self.client.post(
            f"/api/task-projects/reading/main-tasks/{mt['id']}/subtasks",
            json={"name": "Check localization"},
        ).json()["subtask"]
        self.client.put(
            f"/api/task-projects/reading/main-tasks/{mt['id']}/subtasks/{st['id']}",
            json={"status_id": "done"},
        )
        from datetime import date

        today = date.today().isoformat()
        r = self.client.get(f"/api/tasks/completed-by-day?start={today}&end={today}")
        self.assertEqual(r.json()["days"], [{"date": today, "count": 1}])


if __name__ == "__main__":
    unittest.main()
