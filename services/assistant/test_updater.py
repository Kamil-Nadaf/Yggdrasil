import io, json, sys, zipfile
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent))
import updater
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


def make_zip(version="0.5.0", runtime=1, extra=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("update.json", json.dumps({"version": version, "requires_runtime": runtime}))
        z.writestr("main.py", "x=1")
        z.writestr("frontend/dist/index.html", "<html/>")
        for k, v in (extra or {}).items():
            z.writestr(k, v)
    return buf.getvalue()


RELEASE = {"tag_name": "v0.5.0", "name": "v0.5.0", "body": "notes", "html_url": "http://x", "assets": [
    {"name": "Yggdrasil-app-v0.5.0.zip", "size": 10, "browser_download_url": "http://dl/app.zip"},
    {"name": "Yggdrasil-0.5.0-mac-arm64.dmg", "browser_download_url": "http://dl/a.dmg"},
    {"name": "Yggdrasil-0.5.0-windows.zip", "browser_download_url": "http://dl/w.zip"},
    {"name": "Yggdrasil-0.5.0-linux.tar.gz", "browser_download_url": "http://dl/l.tgz"}]}


def test_versions_and_describe(monkeypatch):
    assert updater.parse_version("v0.10.2") > updater.parse_version("0.9.9")
    d = updater.describe(RELEASE, "0.4.1", True)
    assert d["available"] and d["latest"] == "0.5.0" and d["can_hot_update"]
    assert not updater.describe(RELEASE, "0.5.0", True)["available"]
    assert not updater.describe(RELEASE, "0.4.1", False)["can_hot_update"]


class FakeStream:
    def __init__(self, data, status=200): self.data, self.status_code = data, status
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def iter_bytes(self, n): yield self.data


def run_install(monkeypatch, tmp_path, data, runtime_env=None):
    monkeypatch.setenv("YGG_CONFIG_PATH", str(tmp_path / "config.json"))
    if runtime_env: monkeypatch.setenv("YGG_RUNTIME_LEVEL", runtime_env)
    monkeypatch.setattr(updater.httpx, "stream", lambda *a, **k: FakeStream(data))
    return updater.install_payload(updater.describe(RELEASE, "0.4.1", True))


def test_install_ok_and_replace(monkeypatch, tmp_path):
    r = run_install(monkeypatch, tmp_path, make_zip())
    assert r["ok"] and (tmp_path / "updates/current/main.py").exists()
    run_install(monkeypatch, tmp_path, make_zip())
    assert (tmp_path / "updates/previous/main.py").exists()


def test_install_rejects(monkeypatch, tmp_path):
    with pytest.raises(HTTPException) as e: run_install(monkeypatch, tmp_path, make_zip(version="0.4.9"))
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e: run_install(monkeypatch, tmp_path, make_zip(runtime=2))
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e: run_install(monkeypatch, tmp_path, make_zip(extra={"../evil.py": "x"}))
    assert e.value.status_code == 400
    with pytest.raises(HTTPException): run_install(monkeypatch, tmp_path, b"nope")
    assert not (tmp_path / "updates/current").exists()


def test_routes(monkeypatch):
    monkeypatch.setattr(updater, "fetch_latest", lambda: RELEASE)
    called = []
    app = FastAPI(); app.include_router(updater.make_update_router("0.4.1", False, lambda: called.append(1)))
    c = TestClient(app)
    assert c.get("/api/update/check").json()["available"]
    assert c.post("/api/update/install").status_code == 400
    assert c.post("/api/update/restart").status_code == 400


@pytest.mark.skipif(sys.platform == "win32", reason="helper uses a plain delay on Windows")
def test_relaunch_helper_waits_for_old_process(tmp_path):
    import subprocess, time
    marker = tmp_path / "started"
    old = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    helper = subprocess.Popen([sys.executable, "-c", updater._RELAUNCH_HELPER, str(old.pid),
                               sys.executable, "-c", f"open({str(marker)!r}, 'w').write('x')"])
    try:
        time.sleep(1.2)
        assert not marker.exists()  # old copy still alive: the new one must not start yet
        old.kill(); old.wait()
        helper.wait(timeout=15)
        assert marker.exists()
    finally:
        old.kill(); helper.kill()


# ── robustness: resume, retries, checksum, rollback, background job ───────────────────────────────

class Resp:
    def __init__(self, status, data, headers=None, fail_after=None):
        self.status_code, self.data, self.headers, self.fail_after = status, data, headers or {}, fail_after
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def iter_bytes(self, n):
        if self.fail_after is None:
            yield self.data
        else:
            yield self.data[: self.fail_after]
            raise updater.httpx.ReadError("connection reset")


def release_for(data, digest=None):
    r = json.loads(json.dumps(RELEASE))
    r["assets"][0]["size"] = len(data)
    if digest: r["assets"][0]["digest"] = digest
    return r


@pytest.fixture(autouse=False)
def fast(monkeypatch, tmp_path):
    monkeypatch.setattr(updater.time, "sleep", lambda s: None)
    monkeypatch.setattr(updater, "_routes", lambda *a, **k: [None])
    monkeypatch.setenv("YGG_CONFIG_PATH", str(tmp_path / "config.json"))


def test_download_resumes_after_dropped_connection(monkeypatch, tmp_path, fast):
    data = make_zip()
    cut = len(data) // 2
    seen = []
    def stream(method, url, headers=None, **k):
        seen.append(dict(headers or {}))
        if len(seen) == 1:
            return Resp(200, data, {"content-length": str(len(data))}, fail_after=cut)
        start = int(headers["Range"].split("=")[1].rstrip("-"))
        return Resp(206, data[start:], {"content-range": f"bytes {start}-{len(data)-1}/{len(data)}"})
    monkeypatch.setattr(updater.httpx, "stream", stream)
    r = updater.install_payload(updater.describe(release_for(data), "0.4.1", True))
    assert r["ok"] and len(seen) == 2 and seen[1]["Range"] == f"bytes={cut}-"
    assert (tmp_path / "updates/current/main.py").exists()
    assert not list((tmp_path / "updates").glob(".download-*"))  # partial file cleaned up


def test_download_gives_up_but_keeps_partial(monkeypatch, tmp_path, fast):
    data = make_zip()
    monkeypatch.setattr(updater.httpx, "stream", lambda *a, **k: Resp(200, data, fail_after=5))
    with pytest.raises(HTTPException) as e:
        updater.install_payload(updater.describe(release_for(data), "0.4.1", True))
    assert e.value.status_code == 502 and "resumes" in e.value.detail
    assert list((tmp_path / "updates").glob(".download-*.part"))
    assert not (tmp_path / "updates/current").exists()


def test_checksum_mismatch_retries_clean_then_fails(monkeypatch, tmp_path, fast):
    data = make_zip()
    calls = []
    monkeypatch.setattr(updater.httpx, "stream", lambda *a, **k: (calls.append(1), Resp(200, data))[1])
    with pytest.raises(HTTPException) as e:
        updater.install_payload(updater.describe(release_for(data, "sha256:" + "0" * 64), "0.4.1", True))
    assert e.value.status_code == 502 and "checksum" in e.value.detail and len(calls) == 2


def test_failed_swap_keeps_previous_update(monkeypatch, tmp_path, fast):
    data = make_zip()
    monkeypatch.setattr(updater.httpx, "stream", lambda *a, **k: Resp(200, data))
    info = updater.describe(release_for(data), "0.4.1", True)
    updater.install_payload(info)
    (tmp_path / "updates/current/marker.txt").write_text("keep me")
    real = updater._rename_retry
    def flaky(src, dst, tries=8):
        if dst.name == "current" and src.name.startswith(".staging"):
            raise OSError("access denied")
        return real(src, dst, tries)
    monkeypatch.setattr(updater, "_rename_retry", flaky)
    with pytest.raises(HTTPException) as e:
        updater.install_payload(info)
    assert e.value.status_code == 500
    assert (tmp_path / "updates/current/marker.txt").read_text() == "keep me"  # rolled back
    assert not list((tmp_path / "updates").glob(".staging-*"))


def test_background_job_through_routes(monkeypatch, tmp_path, fast):
    import time as real_time
    data = make_zip()
    rel = release_for(data)
    monkeypatch.setattr(updater, "fetch_latest", lambda: rel)
    monkeypatch.setattr(updater.httpx, "stream", lambda *a, **k: Resp(200, data, {"content-length": str(len(data))}))
    updater._JOB.update(state="idle")
    app = FastAPI(); app.include_router(updater.make_update_router("0.4.1", True, lambda: None))
    c = TestClient(app)
    assert c.get("/api/update/install/status").json()["state"] == "idle"
    assert c.post("/api/update/install/start").status_code == 200
    for _ in range(100):
        s = c.get("/api/update/install/status").json()
        if s["state"] in ("done", "error"): break
        real_time.sleep(0.05)
    assert s["state"] == "done" and s["version"] == "0.5.0", s
    assert (tmp_path / "updates/current/main.py").exists()


def test_install_start_rejects_when_up_to_date_or_no_payload(monkeypatch):
    app = FastAPI()
    monkeypatch.setattr(updater, "fetch_latest", lambda: RELEASE)
    app.include_router(updater.make_update_router("0.5.0", True, lambda: None))
    assert TestClient(app).post("/api/update/install/start").status_code == 409
    no_payload = {**RELEASE, "assets": [a for a in RELEASE["assets"] if "app-v" not in a["name"]]}
    monkeypatch.setattr(updater, "fetch_latest", lambda: no_payload)
    app2 = FastAPI(); app2.include_router(updater.make_update_router("0.4.1", True, lambda: None))
    assert TestClient(app2).post("/api/update/install/start").status_code == 409


def test_fetch_latest_caches_and_retries(monkeypatch, fast):
    updater._LATEST.update(at=0.0, data=None)
    calls = []
    class R:
        def __init__(s, code, body=None): s.status_code, s.text, s._b = code, "", body
        def json(s): return s._b
    seq = [updater.httpx.ConnectError("boom"), R(502), R(200, RELEASE)]
    def get(*a, **k):
        calls.append(1)
        x = seq.pop(0)
        if isinstance(x, Exception): raise x
        return x
    monkeypatch.setattr(updater.httpx, "get", get)
    assert updater.fetch_latest()["tag_name"] == "v0.5.0" and len(calls) == 3
    assert updater.fetch_latest()["tag_name"] == "v0.5.0" and len(calls) == 3  # served from the short cache
