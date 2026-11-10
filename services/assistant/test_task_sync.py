"""Task sync against a fake Google/Microsoft server (no network, no real accounts)."""
import json
import re
from datetime import date
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

import task_sync as ts

TODAY = date(2026, 11, 10)


class Fake:
    """Just enough of Google Calendar/Tasks, Microsoft Graph and the two token endpoints."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.store: dict[str, dict] = {}  # url-without-id -> {id: body}
        self.n = 0
        self.fail_token: set[str] = set()
        self.ms_list_exists = False

    def handle(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url).split("?")[0]
        body = json.loads(req.content) if req.content and req.headers.get("content-type", "").startswith("application/json") else {}
        self.calls.append((req.method, url, body))
        if url == ts.GOOGLE_TOKEN or url == ts.MS_TOKEN:
            form = {k: v[0] for k, v in parse_qs(req.content.decode()).items()}
            who = "google" if url == ts.GOOGLE_TOKEN else "microsoft"
            if who in self.fail_token:
                return httpx.Response(400, json={"error": "invalid_grant"})
            if form["grant_type"] == "authorization_code":
                return httpx.Response(200, json={"access_token": "A", "refresh_token": f"R-{who}"})
            out = {"access_token": f"tok-{who}"}
            if who == "microsoft":
                out["refresh_token"] = "R-microsoft-rotated"
            return httpx.Response(200, json=out)
        if url == f"{ts.GRAPH}/me/todo/lists":
            if req.method == "GET":
                return httpx.Response(200, json={"value": [{"id": "L1"}] if self.ms_list_exists else []})
            self.ms_list_exists = True
            return httpx.Response(201, json={"id": "L1"})
        m = re.match(r"^(.*?/(?:events|tasks))(?:/([^/]+))?$", url)
        if not m:
            return httpx.Response(500, json={"err": url})
        coll, rid = m.groups()
        bucket = self.store.setdefault(coll, {})
        if req.method == "POST":
            self.n += 1
            rid = f"id{self.n}"
            bucket[rid] = body
            return httpx.Response(201, json={"id": rid})
        if rid not in bucket:
            return httpx.Response(404, json={})
        if req.method == "DELETE":
            del bucket[rid]
            return httpx.Response(204)
        bucket[rid].update(body)
        return httpx.Response(200, json={"id": rid})

    def client(self):
        return httpx.Client(transport=httpx.MockTransport(self.handle))

    def n_calls(self, method, contains):
        return sum(1 for mth, u, _ in self.calls if mth == method and contains in u)


def item(i, name, deadline, done=False, kind="main", main=""):
    return {"kind": kind, "id": i, "name": name, "deadline": deadline, "done": done,
            "project_slug": "proj", "project_name": "Proj", "main_task_id": "m", "main_task_name": main}


@pytest.fixture
def cfgpath(tmp_path, monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Shanghai")
    p = tmp_path / ".ygg-config" / "task-sync.json"
    cfg = ts.default_config()
    cfg["google"].update(client_id="gid", client_secret="gsec", refresh_token="gr")
    cfg["microsoft"].update(client_id="mid", refresh_token="mr")
    ts.save_config(p, cfg)
    return p


def test_creates_everywhere_with_reminders(cfgpath):
    fake = Fake()
    res = ts.run_sync(cfgpath, [item("t1", "Write intro", "2026-11-12")], TODAY, fake.client())
    assert res["errors"] == []
    assert {k: v["created"] for k, v in res["targets"].items()} == {
        "Google Calendar": 1, "Google Tasks": 1, "Microsoft To Do": 1}
    ev = next(iter(fake.store[f"{ts.GCAL}/calendars/primary/events"].values()))
    assert ev["start"]["dateTime"] == "2026-11-12T09:00:00+08:00"
    assert [o["minutes"] for o in ev["reminders"]["overrides"]] == [0, 1440]
    assert ev["reminders"]["useDefault"] is False
    gt = next(iter(fake.store[f"{ts.GTASKS}/lists/@default/tasks"].values()))
    assert gt["due"] == "2026-11-12T00:00:00.000Z" and gt["status"] == "needsAction"
    ms = next(iter(fake.store[f"{ts.GRAPH}/me/todo/lists/L1/tasks"].values()))
    assert ms["isReminderOn"] is True and ms["dueDateTime"]["dateTime"].startswith("2026-11-12T00:00")
    # day-before reminder at 09:00 Shanghai = 01:00 UTC on the 11th (earliest of 0/1 days)
    assert ms["reminderDateTime"]["dateTime"].startswith("2026-11-11T01:00:00")


def test_second_run_is_idempotent(cfgpath):
    fake = Fake()
    items = [item("t1", "A", "2026-11-12"), item("t2", "B", "2026-11-15")]
    ts.run_sync(cfgpath, items, TODAY, fake.client())
    posts = fake.n_calls("POST", "/events") + fake.n_calls("POST", "/tasks")
    res = ts.run_sync(cfgpath, items, TODAY, fake.client())
    assert fake.n_calls("POST", "/events") + fake.n_calls("POST", "/tasks") == posts
    assert all(v["unchanged"] == 2 and v["created"] == 0 for v in res["targets"].values())


def test_rename_and_date_change_update_in_place(cfgpath):
    fake = Fake()
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    res = ts.run_sync(cfgpath, [item("t1", "A renamed", "2026-11-20")], TODAY, fake.client())
    assert all(v["updated"] == 1 for v in res["targets"].values())
    ev = next(iter(fake.store[f"{ts.GCAL}/calendars/primary/events"].values()))
    assert ev["summary"] == "A renamed" and ev["start"]["dateTime"].startswith("2026-11-20")


def test_done_completes_tasks_and_removes_event(cfgpath):
    fake = Fake()
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    res = ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12", done=True)], TODAY, fake.client())
    assert res["targets"]["Google Calendar"]["deleted"] == 1
    assert fake.store[f"{ts.GCAL}/calendars/primary/events"] == {}
    gt = next(iter(fake.store[f"{ts.GTASKS}/lists/@default/tasks"].values()))
    assert gt["status"] == "completed"
    ms = next(iter(fake.store[f"{ts.GRAPH}/me/todo/lists/L1/tasks"].values()))
    assert ms["status"] == "completed" and ms["isReminderOn"] is False


def test_reopening_clears_completed(cfgpath):
    fake = Fake()
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12", done=True)], TODAY, fake.client())
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    patch = [b for m, u, b in fake.calls if m == "PATCH" and "/lists/@default/tasks/" in u][-1]
    assert patch["status"] == "needsAction" and "completed" in patch and patch["completed"] is None
    assert len(fake.store[f"{ts.GCAL}/calendars/primary/events"]) == 1  # event is back


def test_deleted_task_or_cleared_deadline_removes_remote(cfgpath):
    fake = Fake()
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12"), item("t2", "B", "2026-11-13")], TODAY, fake.client())
    res = ts.run_sync(cfgpath, [item("t2", "B", "2026-11-13")], TODAY, fake.client())
    assert all(v["deleted"] == 1 for v in res["targets"].values())
    assert all(len(b) == 1 for b in fake.store.values())


def test_item_deleted_on_phone_is_recreated(cfgpath):
    fake = Fake()
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    fake.store[f"{ts.GTASKS}/lists/@default/tasks"].clear()  # user deletes it in Google Tasks
    res = ts.run_sync(cfgpath, [item("t1", "A renamed", "2026-11-12")], TODAY, fake.client())
    assert res["errors"] == []
    assert len(fake.store[f"{ts.GTASKS}/lists/@default/tasks"]) == 1


def test_past_and_old_done_items_are_not_mirrored(cfgpath):
    fake = Fake()
    items = [item("old", "Old", "2026-10-01", done=True), item("late", "Overdue", "2026-11-01"),
             item("fresh", "Fresh", "2026-11-10")]
    res = ts.run_sync(cfgpath, items, TODAY, fake.client())
    # Overdue-but-open stays visible in Tasks/To Do, but gets no (past) calendar event.
    assert res["targets"]["Google Calendar"]["created"] == 1
    assert res["targets"]["Google Tasks"]["created"] == 2
    assert res["targets"]["Microsoft To Do"]["created"] == 2


def test_ms_refresh_token_rotation_and_list_reuse(cfgpath):
    fake = Fake()
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    assert ts.load_config(cfgpath)["microsoft"]["refresh_token"] == "R-microsoft-rotated"
    ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    assert fake.n_calls("POST", "/me/todo/lists") == 1 + 0 or True
    assert sum(1 for m, u, _ in fake.calls if m == "POST" and u == f"{ts.GRAPH}/me/todo/lists") == 1


def test_revoked_token_flags_reconnect_and_other_provider_still_syncs(cfgpath):
    fake = Fake()
    fake.fail_token.add("google")
    res = ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, fake.client())
    cfg = ts.load_config(cfgpath)
    assert cfg["google"]["needs_reconnect"] is True
    assert any("Google" in e for e in res["errors"])
    assert res["targets"]["Microsoft To Do"]["created"] == 1
    assert not ts.is_connected(cfg, "google") and ts.is_connected(cfg, "microsoft")


def test_toggles_limit_targets(cfgpath):
    cfg = ts.load_config(cfgpath)
    cfg["google"]["calendar"] = False
    cfg["microsoft"]["todo"] = False
    ts.save_config(cfgpath, cfg)
    res = ts.run_sync(cfgpath, [item("t1", "A", "2026-11-12")], TODAY, Fake().client())
    assert list(res["targets"]) == ["Google Tasks"]


def test_subtask_notes_mention_parent():
    cfg = ts.default_config()
    spec = ts.build_specs([item("s1", "Sub", "2026-11-12", kind="subtask", main="Main thing")], cfg)["proj/s1"]
    assert "Task: Main thing" in spec["notes"] and "Project: Proj" in spec["notes"]


def test_oauth_flow_google_and_microsoft(cfgpath):
    cfg = ts.load_config(cfgpath)
    cfg["google"]["refresh_token"] = ""
    ts.save_config(cfgpath, cfg)
    redirect = "http://localhost:8000/api/tasksync/callback/google"
    url = ts.start_auth("google", ts.load_config(cfgpath), redirect)
    q = {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}
    assert q["access_type"] == "offline" and q["prompt"] == "consent" and q["code_challenge_method"] == "S256"
    assert "calendar.events" in q["scope"] and "auth/tasks" in q["scope"]
    ts.finish_auth(cfgpath, "google", "CODE", q["state"], redirect, Fake().client())
    c = ts.load_config(cfgpath)
    assert c["google"]["refresh_token"] == "R-google" and ts.is_connected(c, "google")
    # state is single-use
    with pytest.raises(ValueError):
        ts.finish_auth(cfgpath, "google", "CODE", q["state"], redirect, Fake().client())
    murl = ts.start_auth("microsoft", c, "http://localhost:8000/api/tasksync/callback/microsoft")
    mq = {k: v[0] for k, v in parse_qs(urlparse(murl).query).items()}
    assert "Tasks.ReadWrite" in mq["scope"] and "offline_access" in mq["scope"]
    with pytest.raises(ValueError):  # wrong provider for this state
        ts.finish_auth(cfgpath, "google", "CODE", mq["state"], redirect, Fake().client())


def test_config_file_is_private_and_roundtrips(cfgpath):
    import os, stat
    assert stat.S_IMODE(os.stat(cfgpath).st_mode) == 0o600
    assert ts.load_config(cfgpath)["google"]["client_secret"] == "gsec"


def test_http_api_hides_secret(cfgpath):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(ts.make_router(lambda: cfgpath, lambda: []))
    c = TestClient(app)
    s = c.get("/api/tasksync/status").json()
    assert s["google"]["connected"] is True and "client_secret" not in json.dumps(s)
    assert s["google"]["redirect_uri"] == "http://testserver/api/tasksync/callback/google"
    # blank secret keeps the saved one; changing the client id drops the old token
    r = c.post("/api/tasksync/config", json={"google": {"client_id": "other", "client_secret": ""}}).json()
    assert r["google"]["connected"] is False
    assert ts.load_config(cfgpath)["google"]["client_secret"] == "gsec"
    assert c.post("/api/tasksync/connect/nope").status_code == 404
