"""Calendar + deadline reminders — pure helpers, OS delivery (mocked), and the API."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date
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
import notifications as n

TODAY = date(2026, 10, 29)


def item(id_: str, deadline: str | None, done: bool = False, kind: str = "main", name: str | None = None) -> dict:
    return {"kind": kind, "id": id_, "name": name or id_, "deadline": deadline, "done": done}


class DeadlineBucketTests(unittest.TestCase):
    def test_buckets(self) -> None:
        self.assertEqual(n.deadline_bucket("2026-10-28", TODAY), n.OVERDUE)
        self.assertEqual(n.deadline_bucket("2026-10-29", TODAY), n.TODAY)
        self.assertEqual(n.deadline_bucket("2026-10-30", TODAY), n.TOMORROW)
        self.assertIsNone(n.deadline_bucket("2026-11-02", TODAY))

    def test_unset_or_invalid_deadline_has_no_bucket(self) -> None:
        self.assertIsNone(n.deadline_bucket(None, TODAY))
        self.assertIsNone(n.deadline_bucket("", TODAY))
        self.assertIsNone(n.deadline_bucket("not-a-date", TODAY))

    def test_iso_datetime_is_accepted(self) -> None:
        self.assertEqual(n.deadline_bucket("2026-10-29T09:00:00", TODAY), n.TODAY)


class DueRemindersTests(unittest.TestCase):
    def test_done_and_far_items_are_skipped(self) -> None:
        items = [item("a", "2026-10-29", done=True), item("b", "2026-12-01"), item("c", None)]
        reminders, keys = n.due_reminders(items, TODAY, {})
        self.assertEqual(reminders, [])
        self.assertEqual(keys, [])

    def test_due_item_is_reported_once_per_day(self) -> None:
        items = [item("a", "2026-10-29")]
        reminders, keys = n.due_reminders(items, TODAY, {})
        self.assertEqual(len(reminders), 1)
        # Once recorded as sent, the same item, bucket and day is not repeated.
        sent = {k: TODAY.isoformat() for k in keys}
        again, _ = n.due_reminders(items, TODAY, sent)
        self.assertEqual(again, [])

    def test_bucket_change_counts_as_new_reminder(self) -> None:
        items = [item("a", "2026-10-30")]  # tomorrow
        _, keys = n.due_reminders(items, TODAY, {})
        sent = {k: TODAY.isoformat() for k in keys}
        next_day = date(2026, 10, 30)  # now due today
        reminders, _ = n.due_reminders(items, next_day, sent)
        self.assertEqual([bucket for bucket, _ in reminders], [n.TODAY])

    def test_duplicate_items_in_one_pass_are_reported_once(self) -> None:
        items = [item("a", "2026-10-29"), item("a", "2026-10-29")]
        reminders, keys = n.due_reminders(items, TODAY, {})
        self.assertEqual(len(reminders), 1)
        self.assertEqual(len(keys), 1)


class MessageAndPruneTests(unittest.TestCase):
    def test_summary_counts_each_bucket(self) -> None:
        reminders = [
            (n.OVERDUE, item("a", "2026-10-27", name="Fix plot")),
            (n.TODAY, item("b", "2026-10-29", name="Write intro")),
            (n.TODAY, item("c", "2026-10-29", name="Run fit")),
            (n.TOMORROW, item("d", "2026-10-30", name="Submit draft")),
        ]
        title, body = n.build_message(reminders)
        self.assertIn("Yggdrasil", title)
        first = body.split("\n")[0]
        self.assertEqual(first, "1 overdue · 2 due today · 1 due tomorrow")
        self.assertIn("Fix plot (overdue)", body)
        self.assertIn("Submit draft (due tomorrow)", body)

    def test_long_list_is_truncated(self) -> None:
        reminders = [(n.TODAY, item(str(i), "2026-10-29", name=f"Task {i}")) for i in range(7)]
        _, body = n.build_message(reminders)
        self.assertIn("…and 3 more", body)
        self.assertEqual(body.count("(due today)"), 4)

    def test_prune_keeps_recent_keys_only(self) -> None:
        sent = {"old": "2026-10-20", "recent": "2026-10-28", "today": "2026-10-29"}
        self.assertEqual(set(n.prune_sent(sent, TODAY)), {"recent", "today"})


class NotifyDesktopTests(unittest.TestCase):
    def test_macos_uses_osascript_with_arguments_not_string_splicing(self) -> None:
        with patch("notifications.platform.system", return_value="Darwin"), patch(
            "notifications.subprocess.Popen"
        ) as popen:
            self.assertTrue(n.notify_desktop('Title "x"', 'Body; rm -rf'))
        argv = popen.call_args.args[0]
        self.assertEqual(argv[0], "osascript")
        # Title and body are separate argv items, never embedded in the script text.
        self.assertEqual(argv[-2:], ['Title "x"', "Body; rm -rf"])

    def test_linux_without_notify_send_reports_nothing_shown(self) -> None:
        with patch("notifications.platform.system", return_value="Linux"), patch(
            "notifications.shutil.which", return_value=None
        ), patch("notifications.subprocess.Popen") as popen:
            self.assertFalse(n.notify_desktop("t", "b"))
        popen.assert_not_called()

    def test_linux_passes_icon_when_it_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            icon = Path(tmp) / "icon.png"
            icon.write_bytes(b"x")
            with patch("notifications.platform.system", return_value="Linux"), patch(
                "notifications.shutil.which", return_value="/usr/bin/notify-send"
            ), patch("notifications.subprocess.Popen") as popen:
                self.assertTrue(n.notify_desktop("t", "b", icon=icon))
        argv = popen.call_args.args[0]
        self.assertIn("-i", argv)
        self.assertEqual(argv[argv.index("-i") + 1], str(icon))

    def test_windows_passes_text_through_environment(self) -> None:
        with patch("notifications.platform.system", return_value="Windows"), patch(
            "notifications.subprocess.Popen"
        ) as popen:
            self.assertTrue(n.notify_desktop("T'itle", "Body $(evil)"))
        kwargs = popen.call_args.kwargs
        self.assertEqual(kwargs["env"]["YGG_NOTIFY_TITLE"], "T'itle")
        self.assertEqual(kwargs["env"]["YGG_NOTIFY_BODY"], "Body $(evil)")
        argv = popen.call_args.args[0]
        self.assertIn("-EncodedCommand", argv)  # script is encoded, not spliced into the command line
        self.assertNotIn("T'itle", " ".join(argv))

    def test_never_raises_when_launch_fails(self) -> None:
        with patch("notifications.platform.system", return_value="Darwin"), patch(
            "notifications.subprocess.Popen", side_effect=OSError("boom")
        ):
            self.assertFalse(n.notify_desktop("t", "b"))


class CalendarApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.vault = self.root / "vault"
        (self.vault / "80-Tasks").mkdir(parents=True)
        (self.vault / "60-Meta").mkdir(parents=True)
        self._patches = [
            patch.object(main, "VAULT", self.vault),
            patch.dict("os.environ", {"YGG_CONFIG_PATH": str(self.root / "cfg" / "config.json")}, clear=False),
        ]
        for p in self._patches:
            p.start()
        self.client = TestClient(main.app, raise_server_exceptions=True)
        self.client.post("/api/task-projects", json={"name": "Fermi Analysis"})
        main_task = self.client.post(
            "/api/task-projects/fermi-analysis/main-tasks",
            json={"name": "Write paper", "deadline": "2026-11-05"},
        ).json()["main_task"]
        self.client.post(
            f"/api/task-projects/fermi-analysis/main-tasks/{main_task['id']}/subtasks",
            json={"name": "Draft intro", "deadline": "2026-10-29"},
        )
        self.client.post(
            f"/api/task-projects/fermi-analysis/main-tasks/{main_task['id']}/subtasks",
            json={"name": "No date yet"},
        )
        self.main_id = main_task["id"]

    def tearDown(self) -> None:
        self.client.close()
        for p in reversed(self._patches):
            p.stop()
        self.tmp.cleanup()

    def test_calendar_lists_only_items_with_a_deadline(self) -> None:
        items = self.client.get("/api/tasks/calendar").json()["items"]
        names = [i["name"] for i in items]
        self.assertEqual(names, ["Draft intro", "Write paper"])  # sorted by deadline
        sub = items[0]
        self.assertEqual(sub["kind"], "subtask")
        self.assertEqual(sub["main_task_name"], "Write paper")
        self.assertEqual(sub["main_task_id"], self.main_id)
        self.assertEqual(sub["project_slug"], "fermi-analysis")
        self.assertFalse(sub["done"])

    def test_done_subtask_is_marked_done(self) -> None:
        subs = self.client.get(f"/api/task-projects/fermi-analysis/main-tasks/{self.main_id}/subtasks").json()["subtasks"]
        intro = next(s for s in subs if s["name"] == "Draft intro")
        self.client.put(
            f"/api/task-projects/fermi-analysis/main-tasks/{self.main_id}/subtasks/{intro['id']}",
            json={"status_id": "done"},
        )
        items = self.client.get("/api/tasks/calendar").json()["items"]
        self.assertTrue(next(i for i in items if i["name"] == "Draft intro")["done"])

    def test_settings_default_on_and_persist_in_device_state(self) -> None:
        r = self.client.get("/api/notifications/settings").json()
        self.assertTrue(r["enabled"])
        self.client.post("/api/notifications/settings", json={"enabled": False})
        self.assertFalse(self.client.get("/api/notifications/settings").json()["enabled"])
        state_file = self.root / "cfg" / "notifications.json"
        self.assertTrue(state_file.exists())
        self.assertFalse(json.loads(state_file.read_text())["enabled"])
        # The vault never receives notification state (it is device-local).
        self.assertFalse((self.vault / ".ygg-config" / "notifications.json").exists())

    def test_web_mode_never_notifies(self) -> None:
        with patch.dict("os.environ", {"YGG_DESKTOP": "0"}), patch.object(main, "notify_desktop") as notify:
            self.assertEqual(main._run_deadline_reminders(TODAY), 0)
            self.assertFalse(self.client.post("/api/notifications/test").json()["sent"])
        notify.assert_not_called()

    def test_desktop_pass_notifies_once_then_stays_quiet(self) -> None:
        with patch.dict("os.environ", {"YGG_DESKTOP": "1"}), patch.object(main, "notify_desktop", return_value=True) as notify:
            first = main._run_deadline_reminders(TODAY)
            second = main._run_deadline_reminders(TODAY)
        self.assertEqual(first, 1)  # "Draft intro" is due today; "Write paper" is further out
        self.assertEqual(second, 0)  # still due, but already shown today, so nothing new to show
        self.assertEqual(notify.call_count, 1)
        title, body = notify.call_args.args
        self.assertIn("Draft intro", body)

    def test_disabled_reminders_do_nothing_on_desktop(self) -> None:
        self.client.post("/api/notifications/settings", json={"enabled": False})
        with patch.dict("os.environ", {"YGG_DESKTOP": "1"}), patch.object(main, "notify_desktop") as notify:
            self.assertEqual(main._run_deadline_reminders(TODAY), 0)
        notify.assert_not_called()

    def test_failed_delivery_is_retried_later(self) -> None:
        with patch.dict("os.environ", {"YGG_DESKTOP": "1"}), patch.object(main, "notify_desktop", return_value=False):
            main._run_deadline_reminders(TODAY)
        with patch.dict("os.environ", {"YGG_DESKTOP": "1"}), patch.object(main, "notify_desktop", return_value=True) as notify:
            main._run_deadline_reminders(TODAY)
        self.assertEqual(notify.call_count, 1)


if __name__ == "__main__":
    unittest.main()
