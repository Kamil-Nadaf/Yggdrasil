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
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable

import httpx
from fastapi import APIRouter, HTTPException

REPO = os.environ.get("YGG_UPDATE_REPO", "Kamil-Nadaf/Yggdrasil")
MAX_PAYLOAD = 200 * 1024 * 1024
API_URL = f"https://api.github.com/repos/{REPO}/releases/latest"
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


def _routes(url: str = "") -> list[str | None]:
    """Connection routes to try in order. An app opened from the Dock/Start menu doesn't inherit the shell's proxy
    variables, so the system proxy is tried first (when there is one), then a direct connection. Hosts the system
    says to bypass, and localhost, always go direct."""
    routes: list[str | None] = []
    if not os.environ.get("YGG_NO_PROXY"):
        try:
            host = (urllib.parse.urlparse(url).hostname or "") if url else ""
            skip = host in ("localhost", "127.0.0.1", "::1") or (bool(host) and urllib.request.proxy_bypass(host))
            found = urllib.request.getproxies()
            proxy = found.get("https") or found.get("http")
            if proxy and not skip:
                routes.append(proxy if "://" in proxy else "http://" + proxy)
        except Exception:
            pass
    routes.append(None)
    return routes


_LATEST: dict = {"at": 0.0, "data": None}
LATEST_TTL = 300  # seconds: the check, the prompt and the install share one GitHub call (unauthenticated limit is 60/hour)


def fetch_latest(force: bool = False) -> dict:
    now = time.time()
    if not force and _LATEST["data"] is not None and now - _LATEST["at"] < LATEST_TTL:
        return _LATEST["data"]
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Yggdrasil-updater"}
    token = os.environ.get("YGG_UPDATE_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    last = "no answer"
    for attempt in range(3):
        for route in _routes(API_URL):
            try:
                r = httpx.get(API_URL, headers=headers,
                              timeout=httpx.Timeout(20, connect=10), follow_redirects=True, proxy=route)
            except httpx.HTTPError as exc:
                last = str(exc) or exc.__class__.__name__
                continue
            if r.status_code == 404:
                raise HTTPException(404, "No published release found yet (the repository may be private or have no releases).")
            if r.status_code in (403, 429) and "rate limit" in r.text.lower():
                if _LATEST["data"] is not None:
                    return _LATEST["data"]
                raise HTTPException(429, "GitHub is rate-limiting update checks from this network — try again in a few minutes.")
            if r.status_code != 200:
                last = f"GitHub answered {r.status_code}"
                continue
            _LATEST["at"], _LATEST["data"] = now, r.json()
            return _LATEST["data"]
        if attempt < 2:
            time.sleep(1.5 * (attempt + 1))
    if _LATEST["data"] is not None:  # offline right now, but we did hear from GitHub earlier this session
        return _LATEST["data"]
    raise HTTPException(502, f"Couldn't reach GitHub ({last}). Check your connection or proxy and try again.")


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


ProgressFn = Callable[[str, int, int], None]


def _total_from(resp, have: int, hint: int) -> int:
    headers = getattr(resp, "headers", None) or {}
    try:
        rng = headers.get("content-range")
        if rng and "/" in rng and rng.rsplit("/", 1)[1].strip().isdigit():
            return int(rng.rsplit("/", 1)[1])
        length = headers.get("content-length")
        if length and str(length).isdigit():
            return have + int(length)
    except Exception:
        pass
    return hint


def _download(url: str, dest: Path, size_hint: int, progress: ProgressFn | None) -> None:
    """Download ``url`` into ``dest`` (a .part file), resuming where an earlier try stopped and retrying on network
    errors. A flaky connection no longer means starting over: progress made so far is kept between tries."""
    last = "no answer"
    for attempt in range(6):
        have = dest.stat().st_size if dest.exists() else 0
        if size_hint and have >= size_hint:
            return
        for route in _routes(url):
            headers = {"User-Agent": "Yggdrasil-updater"}
            if have:
                headers["Range"] = f"bytes={have}-"
            try:
                with httpx.stream("GET", url, headers=headers, timeout=httpx.Timeout(30, connect=15),
                                  follow_redirects=True, proxy=route) as resp:
                    code = resp.status_code
                    if code == 416 and have:  # asked for bytes past the end: we already have it all
                        return
                    if code not in (200, 206):
                        last = f"HTTP {code}"
                        continue
                    resuming = code == 206 and have > 0
                    if not resuming:
                        have = 0
                    total = _total_from(resp, have, size_hint)
                    with dest.open("ab" if resuming else "wb") as fh:
                        for chunk in resp.iter_bytes(1 << 16):
                            have += len(chunk)
                            if have > MAX_PAYLOAD:
                                dest.unlink(missing_ok=True)
                                raise HTTPException(502, "The update package is unexpectedly large.")
                            fh.write(chunk)
                            if progress:
                                progress("downloading", have, total)
                    if not size_hint or have >= size_hint:
                        return
                    last = "the connection closed early"
            except httpx.HTTPError as exc:
                last = str(exc) or exc.__class__.__name__
                have = dest.stat().st_size if dest.exists() else 0
        time.sleep(min(1.5 * (attempt + 1), 6))
    raise HTTPException(502, f"Download failed after several tries ({last}). What was downloaded is kept, so trying again resumes it.")


def _rename_retry(src: Path, dst: Path, tries: int = 8) -> None:
    """Rename a folder, retrying briefly: on Windows, antivirus or the search indexer can hold freshly written files."""
    for i in range(tries):
        try:
            src.rename(dst)
            return
        except OSError:
            if i == tries - 1:
                raise
            time.sleep(0.4 * (i + 1))


def install_payload(info: dict, progress: ProgressFn | None = None) -> dict:
    payload = info.get("payload")
    if not payload or not payload.get("url"):
        raise HTTPException(409, "This release has no in-app update package — download the full installer instead.")
    root = updates_dir()
    root.mkdir(parents=True, exist_ok=True)
    for old in root.glob(".staging-*"):  # leftovers of an install that was interrupted
        shutil.rmtree(old, ignore_errors=True)
    version_hint = str(info.get("latest") or "")
    part = root / f".download-{version_hint}.part"
    try:
        size_hint = int(payload.get("size") or 0)
    except (TypeError, ValueError):
        size_hint = 0
    digest = str(payload.get("digest") or "")
    for attempt in range(2):
        _download(payload["url"], part, size_hint, progress)
        if digest.startswith("sha256:"):
            h = hashlib.sha256()
            with part.open("rb") as fh:
                for block in iter(lambda: fh.read(1 << 20), b""):
                    h.update(block)
            if digest.split(":", 1)[1].lower() != h.hexdigest():
                part.unlink(missing_ok=True)  # a corrupt partial can't be resumed: start clean once
                if attempt == 0:
                    continue
                raise HTTPException(502, "The downloaded update didn't match its checksum — try again.")
        break
    if progress:
        progress("installing", 1, 1)
    try:
        try:
            zf = zipfile.ZipFile(part)
        except zipfile.BadZipFile as exc:
            part.unlink(missing_ok=True)
            raise HTTPException(502, "The update package is not a valid zip — try again.") from exc
        with zf:
            if zf.testzip() is not None:
                part.unlink(missing_ok=True)
                raise HTTPException(502, "The update package is damaged — try again.")
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
        moved = False
        if current.exists():
            shutil.rmtree(previous, ignore_errors=True)
            try:
                _rename_retry(current, previous)
                moved = True
            except OSError as exc:
                shutil.rmtree(staging, ignore_errors=True)
                raise HTTPException(500, f"Couldn't replace the installed update ({exc}). Close other Yggdrasil windows and try again.") from exc
        try:
            _rename_retry(staging, current)
        except OSError as exc:
            if moved:  # never leave the app without a working update folder
                try:
                    _rename_retry(previous, current)
                except OSError:
                    pass
            shutil.rmtree(staging, ignore_errors=True)
            raise HTTPException(500, f"Couldn't put the update in place ({exc}). The previous version is untouched.") from exc
        (root / "boot.pending").unlink(missing_ok=True)
        part.unlink(missing_ok=True)
        return {"ok": True, "version": version, "restart_required": True}
    except HTTPException as exc:
        if exc.status_code != 500:  # a package that was rejected must not be reused by the next try
            part.unlink(missing_ok=True)
        raise
    except Exception as exc:
        raise HTTPException(500, f"Update failed: {exc}") from exc


# ── background install job: the UI starts it, then polls for progress ──────────────────────────────
_JOB: dict = {"state": "idle", "downloaded": 0, "total": 0, "version": "", "error": "", "code": 0}
_JOB_LOCK = threading.Lock()


def job_status() -> dict:
    with _JOB_LOCK:
        return dict(_JOB)


def start_job(info: dict) -> dict:
    with _JOB_LOCK:
        if _JOB["state"] in ("downloading", "installing"):
            return dict(_JOB)
        try:
            total = int((info.get("payload") or {}).get("size") or 0)
        except (TypeError, ValueError):
            total = 0
        _JOB.update(state="downloading", downloaded=0, total=total, version=str(info.get("latest") or ""), error="", code=0)

    def report(phase: str, done: int, total: int) -> None:
        with _JOB_LOCK:
            _JOB["state"] = "installing" if phase == "installing" else "downloading"
            if phase == "downloading":
                _JOB["downloaded"], _JOB["total"] = done, total or _JOB["total"]

    def run() -> None:
        try:
            install_payload(info, report)
            with _JOB_LOCK:
                _JOB.update(state="done", error="", code=0)
        except HTTPException as exc:
            with _JOB_LOCK:
                _JOB.update(state="error", error=str(exc.detail), code=exc.status_code)
        except Exception as exc:  # never leave the UI waiting on a job that died
            with _JOB_LOCK:
                _JOB.update(state="error", error=f"Update failed: {exc}", code=500)

    threading.Thread(target=run, daemon=True, name="ygg-update-install").start()
    return job_status()


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

    def _installable() -> dict:
        if not desktop:
            raise HTTPException(400, "In-app install is only available in the desktop app. For Docker, rebuild with `docker compose up -d --build`.")
        info = describe(fetch_latest(), app_version, desktop)
        if not info["available"]:
            raise HTTPException(409, "You already have the latest version.")
        if not info["payload"]:
            raise HTTPException(409, "This release has no in-app update package — download the full installer instead.")
        return info

    @router.get("/check")
    def check(fresh: bool = False) -> dict:
        return describe(fetch_latest(force=True) if fresh else fetch_latest(), app_version, desktop)

    @router.post("/install")
    def install() -> dict:
        """Blocking install (kept for scripts); the app uses /install/start + /install/status."""
        return install_payload(_installable())

    @router.post("/install/start")
    def install_start() -> dict:
        return start_job(_installable())

    @router.get("/install/status")
    def install_status() -> dict:
        return job_status()

    @router.post("/restart")
    def restart() -> dict:
        if not desktop:
            raise HTTPException(400, "Restart is only available in the desktop app.")
        restarter()
        return {"ok": True}

    return router
