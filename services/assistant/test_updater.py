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
