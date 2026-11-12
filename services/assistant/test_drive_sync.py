"""Tests for drive_sync against an in-memory fake of the Drive v3 API."""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

import drive_sync as ds

FB = ("cid.apps.googleusercontent.com", "secret")


class FakeDrive:
    def __init__(self):
        self.files: dict[str, dict] = {}
        self.n = 0
        self.clock = datetime.now(timezone.utc)
        self.fail_token = False
        self.upload_sessions: dict[str, dict] = {}

    def now(self) -> str:
        self.clock += timedelta(seconds=1)
        return self.clock.isoformat().replace("+00:00", "Z")

    def new(self, name, parents, mime="application/octet-stream", content=b"") -> dict:
        self.n += 1
        f = {"id": f"id{self.n}", "name": name, "parents": parents, "mimeType": mime, "content": content,
             "trashed": False, "modifiedTime": self.now(), "createdTime": self.now()}
        self.files[f["id"]] = f
        return f

    def view(self, f: dict) -> dict:
        d = {k: f[k] for k in ("id", "name", "parents", "mimeType", "modifiedTime", "createdTime")}
        if f["mimeType"] != ds.FOLDER:
            d["md5Checksum"] = hashlib.md5(f["content"]).hexdigest()
            d["size"] = str(len(f["content"]))
        return d

    @staticmethod
    def multipart(req: httpx.Request) -> tuple[dict, bytes]:
        boundary = re.search(r"boundary=(\S+)", req.headers["content-type"]).group(1).encode()
        parts = [p for p in req.content.split(b"--" + boundary) if p.strip(b"\r\n-")]
        out = []
        for p in parts:
            head, _, body = p.partition(b"\r\n\r\n")
            out.append(body[:-2] if body.endswith(b"\r\n") else body)
        return json.loads(out[0] or b"{}"), out[1]

    def handler(self, req: httpx.Request) -> httpx.Response:
        url, m, path = str(req.url), req.method, req.url.path
        if "oauth2.googleapis.com/token" in url:
            if self.fail_token:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt"})
        if path == "/drive/v3/files" and m == "GET":
            return httpx.Response(200, json={"files": [self.view(f) for f in self.files.values() if not f["trashed"]]})
        if path == "/drive/v3/files" and m == "POST":
            j = json.loads(req.content)
            return httpx.Response(200, json=self.view(self.new(j["name"], j.get("parents", []), j["mimeType"])))
        if path.startswith("/upload/drive/v3/files"):
            fid = path.rsplit("/", 1)[1] if path.count("/") > 4 else None
            kind = req.url.params.get("uploadType")
            if kind == "multipart":
                meta, data = self.multipart(req)
                return httpx.Response(200, json=self.store(fid, meta, data))
            if kind == "resumable":
                sid = f"s{len(self.upload_sessions)}"
                self.upload_sessions[sid] = {"fid": fid, "meta": json.loads(req.content)}
                return httpx.Response(200, headers={"Location": f"https://upload.test/session/{sid}"})
        if "upload.test/session" in url and m == "PUT":
            s = self.upload_sessions[path.rsplit("/", 1)[1]]
            return httpx.Response(200, json=self.store(s["fid"], s["meta"], req.content))
        mm = re.fullmatch(r"/drive/v3/files/(\w+)", path)
        if mm and m == "PATCH":
            self.files[mm.group(1)].update(json.loads(req.content))
            return httpx.Response(200, json={})
        if mm and m == "GET" and req.url.params.get("alt") == "media":
            return httpx.Response(200, content=self.files[mm.group(1)]["content"])
        return httpx.Response(404, json={"error": {"errors": [{"reason": "notFound"}]}})

    def store(self, fid, meta, data) -> dict:
        if fid:
            f = self.files[fid]
            f["content"], f["modifiedTime"] = data, self.now()
        else:
            f = self.new(meta["name"], meta["parents"], content=data)
        return {"id": f["id"], "md5Checksum": hashlib.md5(data).hexdigest(), "modifiedTime": f["modifiedTime"]}

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))

    def live(self) -> dict[str, bytes]:
        """path -> content of everything non-trashed under the vault folder"""
        files = {i: f for i, f in self.files.items() if not f["trashed"]}

        def p(f):
            par = f["parents"][0] if f["parents"] else None
            return f["name"] if par not in files else p(files[par]) + "/" + f["name"]
        root = next(f for f in files.values() if f["name"] == "Yggdrasil Vault")
        return {p(f)[len(root["name"]) + 1:]: f["content"] for f in files.values()
                if f["mimeType"] != ds.FOLDER and p(f).startswith(root["name"] + "/")}


class Device:
    def __init__(self, tmp: Path, name: str, drive: FakeDrive):
        self.vault, self.cfg, self.drive = tmp / name, tmp / name / ".ygg-config" / "drive-sync.json", drive
        self.vault.mkdir(parents=True)
        ds.save_config(self.cfg, {**ds.default_config(), "refresh_token": "rt"})

    def write(self, rel: str, text: str, mtime: float | None = None):
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        if mtime:
            os.utime(p, (mtime, mtime))

    def read(self, rel: str) -> str:
        return (self.vault / rel).read_text()

    def sync(self, **kw) -> dict:
        return ds.run_sync(self.cfg, self.vault, FB, client=self.drive.client(), **kw)

    def files(self) -> set[str]:
        return {p.relative_to(self.vault).as_posix() for p in self.vault.rglob("*")
                if p.is_file() and ".ygg-config" not in p.parts}


@pytest.fixture
def world(tmp_path):
    d = FakeDrive()
    return d, Device(tmp_path, "a", d), Device(tmp_path, "b", d)


def test_first_sync_uploads_and_skips_private_dirs(world):
    d, a, _ = world
    a.write("data/notes/one.md", "hello")
    a.write("data/80-Tasks/p/mt-1.md", "task ünï")
    a.write(".git/config", "secret")
    a.write("index/db.sqlite", "x")
    a.write(".DS_Store", "x")
    r = a.sync()
    assert r["ok"], r
    assert r["uploaded"] == 2
    assert d.live() == {"data/notes/one.md": b"hello", "data/80-Tasks/p/mt-1.md": "task ünï".encode()}


def test_second_device_downloads_and_noop_is_quiet(world):
    d, a, b = world
    a.write("data/one.md", "hello")
    a.write("two.md", "world")
    a.sync()
    r = b.sync()
    assert r["ok"] and r["downloaded"] == 2 and r["uploaded"] == 0
    assert b.read("data/one.md") == "hello"
    for dev in (a, b):
        r = dev.sync()
        assert r["ok"] and (r["uploaded"], r["downloaded"], r["deleted_local"], r["deleted_remote"]) == (0, 0, 0, 0)


def test_edits_propagate_both_ways(world):
    d, a, b = world
    a.write("n.md", "v1")
    a.sync()
    b.sync()
    b.write("n.md", "v2 from b")
    b.write("new-on-b.md", "b")
    assert b.sync()["uploaded"] == 2
    r = a.sync()
    assert r["downloaded"] == 2 and a.read("n.md") == "v2 from b" and a.read("new-on-b.md") == "b"


def test_delete_propagates_with_local_trash(world):
    d, a, b = world
    a.write("keep.md", "k")
    a.write("gone.md", "g")
    a.sync()
    b.sync()
    (a.vault / "gone.md").unlink()
    assert a.sync()["deleted_remote"] == 1
    assert "gone.md" not in d.live()
    r = b.sync()
    assert r["deleted_local"] == 1 and not (b.vault / "gone.md").exists()
    saved = list((b.vault / ".ygg-config" / "sync-trash").rglob("gone.md"))
    assert saved and saved[0].read_text() == "g"  # recoverable
    assert b.read("keep.md") == "k"


def test_conflict_keeps_both_versions(world):
    d, a, b = world
    a.write("n.md", "base")
    a.sync()
    b.sync()
    now = time.time()
    a.write("n.md", "from a", now)
    a.sync()
    b.write("n.md", "from b", now + 500)  # newer than a's upload
    r = b.sync()
    assert r["ok"] and r["conflicts"] == 1
    assert b.read("n.md") == "from b"
    conflict = [f for f in b.files() if "conflict" in f]
    assert len(conflict) == 1 and b.read(conflict[0]) == "from a"
    a.sync()
    assert a.read("n.md") == "from b" and conflict[0] in a.files() and a.read(conflict[0]) == "from a"


def test_conflict_remote_newer_wins_and_local_copy_is_kept(world):
    d, a, b = world
    a.write("n.md", "base")
    a.sync()
    b.sync()
    a.write("n.md", "from a")
    a.sync()
    b.write("n.md", "from b", time.time() - 3600)  # older than a's upload
    r = b.sync()
    assert r["conflicts"] == 1 and b.read("n.md") == "from a"
    conflict = [f for f in b.files() if "conflict" in f]
    assert b.read(conflict[0]) == "from b" and conflict[0] in d.live()


def test_first_sync_with_same_path_on_both_sides_is_a_conflict_not_a_loss(world):
    d, a, b = world
    a.write("n.md", "a version")
    a.sync()
    b.write("n.md", "b version")
    r = b.sync()
    assert r["conflicts"] == 1
    assert sorted(b.read(f) for f in b.files()) == ["a version", "b version"]


def test_mass_deletion_needs_confirmation(world):
    d, a, _ = world
    for i in range(40):
        a.write(f"f{i}.md", str(i))
    assert a.sync()["uploaded"] == 40
    for i in range(35):
        (a.vault / f"f{i}.md").unlink()
    r = a.sync()
    assert not r["ok"] and r["needs_confirm"] and r["pending_deletions"] == 35
    assert len(d.live()) == 40  # nothing touched
    r = a.sync(force=True)
    assert r["ok"] and r["deleted_remote"] == 35 and len(d.live()) == 5


def test_emptied_drive_folder_does_not_wipe_local_files(world):
    d, a, _ = world
    for i in range(30):
        a.write(f"f{i}.md", str(i))
    a.sync()
    for f in d.files.values():
        if f["mimeType"] != ds.FOLDER:
            f["trashed"] = True  # someone emptied the Drive folder
    r = a.sync()
    assert r["needs_confirm"] and r["pending_deletions"] == 30 and len(a.files()) == 30


def test_deleted_drive_folder_is_recreated_from_local(world):
    d, a, _ = world
    for i in range(30):
        a.write(f"f{i}.md", str(i))
    a.sync()
    for f in d.files.values():
        f["trashed"] = True
    r = a.sync()
    assert r["ok"] and r["uploaded"] == 30 and len(a.files()) == 30 and len(d.live()) == 30


def test_large_file_uses_resumable_upload(world, monkeypatch):
    monkeypatch.setattr(ds, "SMALL_UPLOAD", 10)
    d, a, b = world
    a.write("big.md", "x" * 100)
    assert a.sync()["uploaded"] == 1 and d.upload_sessions
    a.write("big.md", "y" * 120)
    assert a.sync()["uploaded"] == 1
    assert b.sync()["downloaded"] == 1 and b.read("big.md") == "y" * 120


def test_foreign_and_duplicate_drive_items_are_handled(world):
    d, a, b = world
    a.write("a.md", "1")
    a.sync()
    d.new("elsewhere.md", ["some-other-folder"], content=b"nope")  # outside the vault folder
    d.new("sheet", [next(i for i, f in d.files.items() if f["name"] == "Yggdrasil Vault")],
          mime="application/vnd.google-apps.spreadsheet")  # native Google file: ignored
    r = b.sync()
    assert r["ok"] and b.files() == {"a.md"}


def test_revoked_token_flags_reconnect(world):
    d, a, _ = world
    d.fail_token = True
    r = a.sync()
    assert not r["ok"] and "reconnect" in r["message"].lower()
    assert ds.load_config(a.cfg)["needs_reconnect"] is True
    assert not ds.is_connected(ds.load_config(a.cfg), FB)


def test_failed_download_is_retried_next_run(world, monkeypatch):
    d, a, b = world
    a.write("x.md", "x")
    a.write("y.md", "y")
    a.sync()
    orig = d.handler
    bad = {"on": True}

    def flaky(req):
        if bad["on"] and req.url.params.get("alt") == "media":
            return httpx.Response(200, content=b"corrupted")
        return orig(req)
    d.handler = flaky
    r = b.sync()
    assert not r["ok"] and r["errors"] and b.files() == set()  # nothing half-written
    bad["on"] = False
    r = b.sync()
    assert r["ok"] and b.files() == {"x.md", "y.md"}


def test_not_connected_and_busy(world):
    d, a, _ = world
    ds.save_config(a.cfg, ds.default_config())
    assert not a.sync()["ok"]
    ds.save_config(a.cfg, {**ds.default_config(), "refresh_token": "rt"})
    assert ds._RUN_LOCK.acquire()
    try:
        assert a.sync().get("busy")
    finally:
        ds._RUN_LOCK.release()


def test_unsafe_remote_names_are_ignored(world):
    d, a, b = world
    a.write("ok.md", "1")
    a.sync()
    root = next(i for i, f in d.files.items() if f["name"] == "Yggdrasil Vault")
    d.new("..", [root], content=b"evil")
    d.new("a/b.md", [root], content=b"evil")
    r = b.sync()
    assert r["ok"] and b.files() == {"ok.md"}


def test_oauth_flow_and_config_perms(tmp_path):
    cfgp = tmp_path / "c" / "drive-sync.json"
    url = ds.start_auth(ds.default_config(), FB, "http://localhost:8000/api/drivesync/callback")
    assert "scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file" in url and "access_type=offline" in url
    state = re.search(r"state=([^&]+)", url).group(1)
    d = FakeDrive()
    ds.finish_auth(cfgp, FB, "code", state, "http://x", client=d.client())
    cfg = ds.load_config(cfgp)
    assert cfg["refresh_token"] == "rt" and ds.is_connected(cfg, FB)
    assert oct(cfgp.stat().st_mode)[-3:] == "600"
    with pytest.raises(ValueError):
        ds.finish_auth(cfgp, FB, "code", state, "http://x", client=d.client())  # state is single-use
    with pytest.raises(ValueError):
        ds.start_auth(ds.default_config(), ("", ""), "http://x")


def test_http_api_hides_secret_and_reuses_task_sync_creds(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    cfgp = tmp_path / "drive-sync.json"
    app = FastAPI()
    app.include_router(ds.make_router(lambda: cfgp, lambda: tmp_path, lambda: FB))
    c = TestClient(app)
    s = c.get("/api/drivesync/status").json()
    assert s["uses_task_sync_credentials"] and not s["connected"]
    assert s["redirect_uri"].endswith("/api/drivesync/callback")
    s = c.post("/api/drivesync/config", json={"client_id": "mine", "client_secret": "shh", "auto": True,
                                              "interval_minutes": 1}).json()
    assert s["client_id"] == "mine" and s["has_secret"] and s["interval_minutes"] == 5
    assert "shh" not in json.dumps(s) and "shh" not in c.get("/api/drivesync/status").text
    r = c.post("/api/drivesync/run", json={}).json()
    assert r["result"]["ok"] is False
    assert c.post("/api/drivesync/connect").json()["auth_url"].startswith("https://accounts.google.com")


def test_auto_due(tmp_path):
    p = tmp_path / "c.json"
    ds.save_config(p, {**ds.default_config(), "refresh_token": "rt", "auto": True, "interval_minutes": 15})
    assert ds.auto_due(p, FB)
    cfg = ds.load_config(p)
    cfg["last_run"] = datetime.now().isoformat()
    ds.save_config(p, cfg)
    assert not ds.auto_due(p, FB)


def _settings(dev, **kw):
    p = dev.vault / ".ygg-config" / "settings.json"
    cur = json.loads(p.read_text()) if p.exists() else {}
    cur.update(kw)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(cur))


def test_papers_and_books_are_not_synced_by_default(world):
    d, a, b = world
    a.write("80-Tasks/p/mt-1.md", "task")
    a.write("10-Papers/x.md", "paper")
    a.write("15-Books/b.pdf", "book")
    r = a.sync()
    assert r["uploaded"] == 1 and set(d.live()) == {"80-Tasks/p/mt-1.md"}
    b.write("10-Papers/only-b.md", "mine")
    assert b.sync()["ok"] and b.read("10-Papers/only-b.md") == "mine" and "10-Papers/only-b.md" not in d.live()
    # opting in syncs them
    for dev in (a, b):
        cfg = ds.load_config(dev.cfg)
        cfg["sync_papers_books"] = True
        ds.save_config(dev.cfg, cfg)
    a.sync()
    b.sync()
    assert b.read("15-Books/b.pdf") == "book" and "10-Papers/x.md" in d.live()


def test_toggling_papers_off_never_deletes_anything(world):
    d, a, _ = world
    a.write("10-Papers/x.md", "paper")
    cfg = ds.load_config(a.cfg)
    cfg["sync_papers_books"] = True
    ds.save_config(a.cfg, cfg)
    a.sync()
    cfg["sync_papers_books"] = False
    ds.save_config(a.cfg, cfg)
    r = a.sync()
    assert r["ok"] and a.read("10-Papers/x.md") == "paper" and "10-Papers/x.md" in d.live()


def test_app_settings_sync_without_device_local_secrets(world):
    d, a, b = world
    _settings(a, task_statuses=["todo", "doing", "done"], goals=[{"id": "g1"}],
              client_prefs={"yggdrasil:ai-providers": "SECRET-KEY"})
    a.write("n.md", "x")
    assert a.sync()["ok"]
    live = d.live()
    assert "_app/settings.json" in live and b"SECRET-KEY" not in live["_app/settings.json"]
    assert not any(b"SECRET-KEY" in c for c in live.values())
    _settings(b, client_prefs={"theme": "dark"}, analysis_tags=["mine"])
    assert b.sync()["ok"]
    got = json.loads((b.vault / ".ygg-config" / "settings.json").read_text())
    assert got["task_statuses"] == ["todo", "doing", "done"] and got["goals"] == [{"id": "g1"}]
    assert got["client_prefs"] == {"theme": "dark"}  # b's own UI prefs untouched
    assert b.sync()["ok"] and a.sync()["ok"]  # b pushes the union, a pulls it
    got_a = json.loads((a.vault / ".ygg-config" / "settings.json").read_text())
    assert got_a["analysis_tags"] == ["mine"] and got_a["client_prefs"]["yggdrasil:ai-providers"] == "SECRET-KEY"
    # edit on b propagates to a, and a quiet sync is quiet
    _settings(b, task_statuses=["todo", "done"])
    assert b.sync()["ok"] and a.sync()["ok"]
    assert json.loads((a.vault / ".ygg-config" / "settings.json").read_text())["task_statuses"] == ["todo", "done"]
    r = a.sync()
    assert (r["uploaded"], r["downloaded"]) == (0, 0)


def test_missing_local_settings_never_trashes_drive_copy(world):
    d, a, b = world
    _settings(a, goals=[1])
    a.sync()
    b.sync()
    (b.vault / ".ygg-config" / "settings.json").unlink()
    assert b.sync()["ok"] and "_app/settings.json" in d.live()


def test_books_on_drive_papers_stay_in_zotero(world):
    d, a, b = world
    cfg = ds.load_config(a.cfg)
    cfg["books_storage"] = "drive"
    ds.save_config(a.cfg, cfg)
    a.write("80-Tasks/p/mt-1.md", "task")
    a.write("10-Papers/x.md", "paper")
    a.write("15-Books/b.pdf", "book")
    a.sync()
    assert set(d.live()) == {"80-Tasks/p/mt-1.md", "15-Books/b.pdf"}


def test_first_sync_uploads_all_and_turns_auto_on_once(world):
    d, a, _ = world
    a.write("n/one.md", "1")
    a.write("n/two.md", "2")
    r = a.sync()
    assert r["first_sync"] and r["uploaded"] == 2 and "First sync" in r["message"]
    cfg = ds.load_config(a.cfg)
    assert cfg["auto"] and cfg["initial_done"]
    cfg["auto"] = False  # the user switches it off: later syncs must not switch it back on
    ds.save_config(a.cfg, cfg)
    a.write("n/three.md", "3")
    assert "first_sync" not in a.sync() and not ds.load_config(a.cfg)["auto"]
