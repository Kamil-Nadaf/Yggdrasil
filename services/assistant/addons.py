"""addons.py — optional tools that are downloaded after install (like editor extensions).

The desktop installers ship a small base app. Heavy engines (MinerU for PDF -> Markdown, ~1 GB) are
installed on demand into the app's data folder, so they survive app updates and reinstalls:

  <config dir>/addons/<id>/site/        the pip --target install
  <config dir>/addons/<id>/addon.json   written only after the install was verified

Installing runs `python -m pip install --target ...` with the app's own interpreter. Nothing is
imported into the running server: engines run as subprocesses with `site/` on their path, so a
restart is not needed. Routes live under /api/addons.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException

# id -> what it is and what it takes. Add a new optional tool by registering it here.
ADDONS: dict[str, dict[str, Any]] = {
    "mineru": {
        "name": "MinerU",
        "desc": "High-quality PDF to Markdown / LaTeX conversion that runs on your computer, offline once installed.",
        "requirements": ["mineru>=4.0,<5"],
        "package": "mineru",
        "entry": "mineru-kit",
        "size_mb": 1000,
    },
}

_JOBS: dict[str, dict[str, Any]] = {}
_LOG_LINES = 40


def addons_root() -> Path:
    cfg = os.environ.get("YGG_CONFIG_PATH")
    base = Path(cfg).parent if cfg else Path.home() / ".yggdrasil"
    return base / "addons"


def site_dir(addon_id: str) -> Path:
    return addons_root() / addon_id / "site"


def _manifest(addon_id: str) -> Optional[dict]:
    try:
        return json.loads((addons_root() / addon_id / "addon.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def site_path(addon_id: str) -> Optional[str]:
    """The folder to put on sys.path / PYTHONPATH, only when the add-on is fully installed."""
    return str(site_dir(addon_id)) if _manifest(addon_id) and site_dir(addon_id).is_dir() else None


def installed_version(addon_id: str) -> str:
    m = _manifest(addon_id)
    return str(m.get("version", "")) if m else ""


def entry_point(addon_id: str, script: str) -> Optional[tuple[str, str]]:
    """(module, attr) of a console script shipped by an installed add-on."""
    site = site_path(addon_id)
    if not site:
        return None
    try:
        from importlib.metadata import distributions

        for dist in distributions(path=[site]):
            for ep in dist.entry_points:
                if ep.group == "console_scripts" and ep.name == script:
                    mod, _, attr = ep.value.partition(":")
                    return mod.strip(), attr.split("[")[0].strip()
    except Exception:  # noqa: BLE001
        pass
    return None


def _dist_version(site: Path, package: str) -> str:
    from importlib.metadata import distributions

    for dist in distributions(path=[str(site)]):
        if (dist.metadata["Name"] or "").lower().replace("_", "-") == package:
            return dist.version
    return ""


def _info(addon_id: str) -> dict:
    spec = ADDONS[addon_id]
    job = _JOBS.get(addon_id) or {}
    state = job.get("state", "idle")
    return {
        "id": addon_id,
        "name": spec["name"],
        "desc": spec["desc"],
        "size_mb": spec["size_mb"],
        "installed": bool(_manifest(addon_id)),
        "version": installed_version(addon_id),
        "state": state,
        "message": job.get("message", ""),
        "log": job.get("log", [])[-6:],
        "elapsed": int(time.time() - job["started"]) if state == "installing" and job.get("started") else 0,
        "error": job.get("error", ""),
    }


async def _install(addon_id: str) -> None:
    spec = ADDONS[addon_id]
    job = _JOBS[addon_id]
    root = addons_root() / addon_id
    site = root / "site"
    try:
        shutil.rmtree(root, ignore_errors=True)
        site.mkdir(parents=True, exist_ok=True)
        need = spec["size_mb"] * 1024 * 1024 * 2  # downloads and the unpacked copy coexist briefly
        free = shutil.disk_usage(root).free
        if free < need:
            raise RuntimeError(f"Not enough free disk space: {spec['name']} needs about {need // 2**30} GB free, {free // 2**20} MB available.")
        cmd = [
            sys.executable, "-m", "pip", "install", "--target", str(site),
            "--no-input", "--disable-pip-version-check", "--progress-bar", "off", *spec["requirements"],
        ]
        job["message"] = "Starting download…"
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "PIP_NO_COLOR": "1", "PYTHONUNBUFFERED": "1"},
        )
        job["proc"] = proc
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            job["log"].append(line)
            del job["log"][:-_LOG_LINES]
            if line.startswith("Collecting "):
                job["message"] = "Downloading " + line[len("Collecting "):].split(" ")[0]
            elif line.startswith("Installing collected"):
                job["message"] = "Installing…"
        code = await proc.wait()
        if job.get("cancelled"):
            raise RuntimeError("Cancelled")
        if code != 0:
            tail = [ln for ln in job["log"] if ln][-3:]
            hint = " (pip is missing from this install - use the full installer)" if any("No module named pip" in t for t in tail) else ""
            raise RuntimeError("Install failed: " + " | ".join(tail) + hint)
        job["message"] = "Checking…"
        ver = _dist_version(site, spec["package"])
        if not ver:
            raise RuntimeError(f"{spec['name']} was downloaded but could not be found afterwards")
        (root / "addon.json").write_text(json.dumps({"version": ver, "installed": int(time.time())}), encoding="utf-8")
        if not entry_point(addon_id, spec["entry"]):
            raise RuntimeError(f"{spec['name']} installed but its command is missing")
        job.update(state="done", message="Installed", error="")
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(root, ignore_errors=True)
        cancelled = bool(job.get("cancelled"))
        job.update(state="cancelled" if cancelled else "error", message="Cancelled" if cancelled else "", error="" if cancelled else (str(e) or e.__class__.__name__))
    finally:
        job.pop("proc", None)


def make_router() -> APIRouter:
    router = APIRouter(prefix="/api/addons", tags=["addons"])

    def known(addon_id: str) -> None:
        if addon_id not in ADDONS:
            raise HTTPException(404, "Unknown add-on")

    @router.get("")
    def list_addons():
        return {"addons": [_info(a) for a in ADDONS]}

    @router.post("/{addon_id}/install")
    async def install(addon_id: str):
        known(addon_id)
        if any(j.get("state") == "installing" for j in _JOBS.values()):
            raise HTTPException(409, "Another add-on is installing. Wait for it to finish.")
        _JOBS[addon_id] = {"state": "installing", "message": "Starting…", "log": [], "started": time.time(), "cancelled": False, "error": ""}
        _JOBS[addon_id]["task"] = asyncio.create_task(_install(addon_id))
        return _info(addon_id)

    @router.post("/{addon_id}/cancel")
    async def cancel(addon_id: str):
        known(addon_id)
        job = _JOBS.get(addon_id)
        if job and job.get("state") == "installing":
            job["cancelled"] = True
            proc = job.get("proc")
            if proc and proc.returncode is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
        return _info(addon_id)

    @router.delete("/{addon_id}")
    def remove(addon_id: str):
        known(addon_id)
        if (_JOBS.get(addon_id) or {}).get("state") == "installing":
            raise HTTPException(409, "Installing right now - cancel it first.")
        shutil.rmtree(addons_root() / addon_id, ignore_errors=True)
        _JOBS.pop(addon_id, None)
        return _info(addon_id)

    return router
