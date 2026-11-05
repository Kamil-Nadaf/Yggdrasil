"""In-app updates: check GitHub Releases, and (desktop) install a small code payload.

A release can ship ``Yggdrasil-app-vX.Y.Z.zip`` — the app's Python files and built frontend, plus an
``update.json`` manifest. Installing it unpacks the payload into ``<support>/updates/current``; the launcher
(desktop/launch.py) prefers that folder over the bundled one when it is newer, so no reinstall is needed.
A release that needs new bundled libraries sets ``requires_runtime`` higher than the installed launcher's
level, and the user is pointed to the full installer instead.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import signal  # noqa: F401  (kept for platforms that terminate children on restart)
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Callable

import httpx
from fastapi import APIRouter, HTTPException

REPO = os.environ.get("YGG_UPDATE_REPO", "Kamil-Nadaf/Yggdrasil")
MAX_PAYLOAD = 200 * 1024 * 1024
PAYLOAD_RE = re.compile(r"^Yggdrasil-app-v?(\d+\.\d+\.\d+)\.zip$")


def parse_version(s: str) -> tuple[int, int, int]:
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", s or "")
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else (0, 0, 0)


def runtime_level() -> int:
    try:
        return int(os.environ.get("YGG_RUNTIME_LEVEL", "1"))
    except ValueError:
        return 1


def updates_dir() -> Path:
    cfg = os.environ.get("YGG_CONFIG_PATH")
    base = Path(cfg).parent if cfg else Path.home() / ".yggdrasil"
    return base / "updates"


def installer_asset(assets: list[dict]) -> dict | None:
    """The full installer matching this machine (used when a hot update isn't possible)."""
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Darwin":
        tag = "mac-arm64" if machine in ("arm64", "aarch64") else "mac-intel"
        want = (f"{tag}.pkg", f"{tag}.dmg")
    elif system == "Windows":
        want = ("windows.zip",)
    else:
        want = ("linux.tar.gz",)
    for suffix in want:
        for a in assets:
            if str(a.get("name", "")).endswith(suffix):
                return a
    return None


def fetch_latest() -> dict:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Yggdrasil-updater"}
    token = os.environ.get("YGG_UPDATE_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        r = httpx.get(f"https://api.github.com/repos/{REPO}/releases/latest", headers=headers, timeout=12, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Couldn't reach GitHub: {exc}") from exc
    if r.status_code == 404:
        raise HTTPException(404, "No published release found yet (the repository may be private or have no releases).")
    if r.status_code != 200:
        raise HTTPException(502, f"GitHub answered {r.status_code} while checking for updates.")
    return r.json()


def describe(release: dict, current: str, desktop: bool) -> dict:
    tag = str(release.get("tag_name") or "")
    latest = ".".join(map(str, parse_version(tag)))
    assets = release.get("assets") or []
    payload = next((a for a in assets if PAYLOAD_RE.match(str(a.get("name", "")))), None)
    installer = installer_asset(assets)
    return {
        "current": current,
        "latest": latest,
        "available": parse_version(tag) > parse_version(current),
        "notes": str(release.get("body") or "")[:4000],
        "name": release.get("name") or tag,
        "published": release.get("published_at"),
        "url": release.get("html_url"),
        "desktop": desktop,
        "can_hot_update": bool(desktop and payload),
        "payload": {"name": payload["name"], "size": payload.get("size"), "url": payload.get("browser_download_url"), "digest": payload.get("digest")} if payload else None,
        "installer": {"name": installer["name"], "url": installer.get("browser_download_url")} if installer else None,
    }


def _safe_members(zf: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    out = []
    for m in zf.infolist():
        n = m.filename
        if n.startswith("/") or ".." in Path(n).parts or re.match(r"^[A-Za-z]:", n):
            raise HTTPException(400, "The update package contains an unsafe path.")
        out.append(m)
    return out


def install_payload(info: dict) -> dict:
    payload = info.get("payload")
    if not payload or not payload.get("url"):
        raise HTTPException(409, "This release has no in-app update package — download the full installer instead.")
    root = updates_dir()
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=root, suffix=".zip", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        h = hashlib.sha256()
        size = 0
        try:
            with httpx.stream("GET", payload["url"], headers={"User-Agent": "Yggdrasil-updater"}, timeout=60, follow_redirects=True) as resp:
                if resp.status_code != 200:
                    raise HTTPException(502, f"Download failed ({resp.status_code}).")
                with tmp_path.open("wb") as fh:
                    for chunk in resp.iter_bytes(1 << 16):
                        size += len(chunk)
                        if size > MAX_PAYLOAD:
                            raise HTTPException(502, "The update package is unexpectedly large.")
                        h.update(chunk)
                        fh.write(chunk)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Download failed: {exc}") from exc
        digest = str(payload.get("digest") or "")
        if digest.startswith("sha256:") and digest.split(":", 1)[1].lower() != h.hexdigest():
            raise HTTPException(502, "The downloaded update didn't match its checksum — try again.")
        try:
            zf = zipfile.ZipFile(tmp_path)
        except zipfile.BadZipFile as exc:
            raise HTTPException(502, "The update package is not a valid zip.") from exc
        with zf:
            members = _safe_members(zf)
            names = {m.filename for m in members}
            if not {"update.json", "main.py", "frontend/dist/index.html"} <= names:
                raise HTTPException(400, "The update package is incomplete.")
            manifest = json.loads(zf.read("update.json").decode("utf-8"))
            version = str(manifest.get("version") or "")
            if parse_version(version) != parse_version(info["latest"]):
                raise HTTPException(400, "The update package doesn't match the release version.")
            if int(manifest.get("requires_runtime", 1)) > runtime_level():
                raise HTTPException(409, "This release needs new bundled libraries — please download and install the full installer.")
            staging = root / f".staging-{version}"
            shutil.rmtree(staging, ignore_errors=True)
            staging.mkdir(parents=True)
            zf.extractall(staging)
        current = root / "current"
        previous = root / "previous"
        if current.exists():
            shutil.rmtree(previous, ignore_errors=True)
            current.rename(previous)
        staging.rename(current)
        (root / "boot.pending").unlink(missing_ok=True)
        return {"ok": True, "version": version, "restart_required": True}
    finally:
        tmp_path.unlink(missing_ok=True)


def _relaunch_argv() -> list[str]:
    bundle = os.environ.get("YGG_BUNDLE", "")
    if sys.platform == "darwin" and bundle:
        app = Path(bundle).parent.parent
        if app.suffix == ".app":
            return ["open", "-n", str(app)]
    return [sys.executable, *sys.argv]


# Runs in a detached helper process. It waits until the old app has really exited (the old copy holds the
# fixed port), force-kills it if it lingers, then starts the new copy. On Windows os.kill(pid, 0) would
# terminate the process, so there it keeps the plain delay.
_RELAUNCH_HELPER = """
import os, signal, subprocess, sys, time
pid = int(sys.argv[1])
argv = sys.argv[2:]
def alive():
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True
if os.name == "nt":
    time.sleep(2.5)
else:
    deadline = time.time() + 6
    while alive() and time.time() < deadline:
        time.sleep(0.2)
    if alive():
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
        for _ in range(25):
            if not alive():
                break
            time.sleep(0.2)
    time.sleep(0.5)
subprocess.Popen(argv)
"""


def _log(msg: str) -> None:
    """Write to the launcher's startup log when running inside the desktop app (never raises)."""
    try:
        blog = getattr(sys.modules.get("__main__"), "blog", None)
        if callable(blog):
            blog(msg)
    except Exception:
        pass


def restart_app() -> None:
    """Start a fresh copy after this one has exited (the app keeps a fixed port, so the helper waits for it to free up)."""
    argv = _relaunch_argv()
    _log(f"restart: pid {os.getpid()} will exit, relaunch via {argv[0]}")
    kwargs: dict = {"env": os.environ.copy(), "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([sys.executable, "-c", _RELAUNCH_HELPER, str(os.getpid()), *argv], **kwargs)

    def _exit() -> None:
        main_mod = sys.modules.get("__main__")
        for proc in list(getattr(main_mod, "CHILDREN", []) or []):
            try:
                proc.terminate()
            except Exception:
                pass
        # Close the window first so the OS tears it down cleanly; a hard exit alone can leave a ghost window.
        try:
            import webview

            for w in list(webview.windows):
                w.destroy()
        except Exception as exc:
            _log(f"restart: window close failed: {exc}")
        time.sleep(0.6)
        _log("restart: exiting")
        os._exit(0)

    threading.Timer(0.8, _exit).start()


def make_update_router(app_version: str, desktop: bool, restarter: Callable[[], None] = restart_app) -> APIRouter:
    router = APIRouter(prefix="/api/update", tags=["update"])

    @router.get("/check")
    def check() -> dict:
        return describe(fetch_latest(), app_version, desktop)

    @router.post("/install")
    def install() -> dict:
        if not desktop:
            raise HTTPException(400, "In-app install is only available in the desktop app. For Docker, rebuild with `docker compose up -d --build`.")
        info = describe(fetch_latest(), app_version, desktop)
        if not info["available"]:
            raise HTTPException(409, "You already have the latest version.")
        return install_payload(info)

    @router.post("/restart")
    def restart() -> dict:
        if not desktop:
            raise HTTPException(400, "Restart is only available in the desktop app.")
        restarter()
        return {"ok": True}

    return router
