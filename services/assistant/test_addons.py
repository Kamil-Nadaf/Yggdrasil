import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import addons


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("YGG_CONFIG_PATH", str(tmp_path / "cfg" / "config.json"))
    addons._JOBS.clear()
    app = FastAPI()
    app.include_router(addons.make_router())
    with TestClient(app) as c:
        yield c


def test_lists_not_installed(client):
    a = client.get("/api/addons").json()["addons"][0]
    assert a["id"] == "mineru" and a["installed"] is False and a["state"] == "idle"
    assert addons.site_path("mineru") is None


def test_unknown_addon(client):
    assert client.post("/api/addons/nope/install").status_code == 404
    assert client.delete("/api/addons/nope").status_code == 404


def test_partial_install_does_not_count(client, tmp_path):
    # site/ exists but addon.json (written only after verification) does not
    (addons.addons_root() / "mineru" / "site").mkdir(parents=True)
    assert addons.site_path("mineru") is None
    assert client.get("/api/addons").json()["addons"][0]["installed"] is False


def test_remove_installed(client):
    root = addons.addons_root() / "mineru"
    (root / "site").mkdir(parents=True)
    (root / "addon.json").write_text(json.dumps({"version": "1.0"}))
    assert client.get("/api/addons").json()["addons"][0]["version"] == "1.0"
    assert client.delete("/api/addons/mineru").json()["installed"] is False
    assert not root.exists()


def test_refuses_when_disk_too_small(client, monkeypatch):
    import shutil, time

    monkeypatch.setattr(shutil, "disk_usage", lambda p: shutil._ntuple_diskusage(10, 9, 1))
    client.post("/api/addons/mineru/install")
    for _ in range(50):
        a = client.get("/api/addons").json()["addons"][0]
        if a["state"] != "installing":
            break
        time.sleep(0.1)
    assert a["state"] == "error" and "free disk space" in a["error"]


def test_activate_puts_an_installed_addon_on_the_path(client):
    import sys

    assert addons.activate("pdfrender") is False
    root = addons.addons_root() / "pdfrender"
    (root / "site").mkdir(parents=True)
    (root / "addon.json").write_text(json.dumps({"version": "1"}))
    try:
        assert addons.activate("pdfrender") is True
        assert str(root / "site") in sys.path
    finally:
        sys.path[:] = [p for p in sys.path if p != str(root / "site")]
