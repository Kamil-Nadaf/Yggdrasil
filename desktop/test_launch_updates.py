import importlib.util, json, os, sys, types
from pathlib import Path
import pytest

def load(tmp, monkeypatch):
    base = tmp / "bundle"; base.mkdir()
    (base / "data_manifest.py").write_text('APP_VERSION = "0.5.0"\n')
    monkeypatch.setenv("YGG_RESOURCES", str(base))
    for name in ("webview",):
        sys.modules.setdefault(name, types.ModuleType(name))
    spec = importlib.util.spec_from_file_location("launch_under_test", str(Path(__file__).resolve().parent / "launch.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    sup = tmp / "support"; (sup / "updates" / "current" / "frontend" / "dist").mkdir(parents=True)
    cur = sup / "updates" / "current"
    (cur / "main.py").write_text("x=1"); (cur / "frontend/dist/index.html").write_text("<html/>")
    (cur / "update.json").write_text(json.dumps({"version": "0.5.1", "requires_runtime": 1}))
    monkeypatch.setattr(m, "support_dir", lambda: sup)
    m._RES_CACHE = None
    return m, sup

def start(m):
    m._RES_CACHE = None
    return m.resources_dir()

def test_normal_boot_clears_pending(tmp_path, monkeypatch):
    m, sup = load(tmp_path, monkeypatch)
    assert start(m) == sup / "updates/current"
    assert (sup / "updates/boot.pending").read_text() == "0.5.1:1"
    m.mark_boot_ok()
    assert not (sup / "updates/boot.pending").exists()
    assert start(m) == sup / "updates/current"

def test_one_interrupted_start_is_forgiven(tmp_path, monkeypatch):
    m, sup = load(tmp_path, monkeypatch)
    start(m)                       # start 1: quit/sleep before boot finished (pending stays)
    assert start(m) == sup / "updates/current"       # start 2: update still used
    assert (sup / "updates/boot.pending").read_text() == "0.5.1:2"

def test_two_interrupted_starts_drop_update(tmp_path, monkeypatch):
    m, sup = load(tmp_path, monkeypatch)
    start(m); start(m)
    assert start(m) == tmp_path / "bundle"           # start 3: give up
    assert (sup / "updates/failed").exists() and not (sup / "updates/current").exists()

def test_crash_drops_update_next_start(tmp_path, monkeypatch):
    m, sup = load(tmp_path, monkeypatch)
    start(m); m.mark_boot_failed()
    assert start(m) == tmp_path / "bundle"

def test_legacy_pending_file_counts_as_one_try(tmp_path, monkeypatch):
    m, sup = load(tmp_path, monkeypatch)
    (sup / "updates/boot.pending").write_text("0.5.1")
    assert start(m) == sup / "updates/current"
