"""tools.py — the Tools section backend. First tool: PDF → Markdown (MinerU).

Each uploaded PDF becomes an entry that persists in the vault, so the file list survives restarts:

  95-Tools/pdf/{id}/
    input.pdf       the original
    result.txt      Markdown from MinerU (".txt" so the notes indexer does not pick it up)
    meta.json       name, size, tier, pages, status, timestamps, error

MinerU ships inside the app (requirements.txt), so there is no fallback converter. The CLI is
`mineru-kit parse input.pdf -o out.md --tier flash|basic|standard|advanced`. It is looked up on PATH and
next to the running interpreter, which is where the desktop installers put it.

Routes live under /api/tools/pdf.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

TOOLS_DIR = "95-Tools/pdf"
MAX_PDF_BYTES = 100 * 1024 * 1024
TIERS = ("flash", "basic", "standard", "advanced")
ID_RE = re.compile(r"^[0-9a-f]{12}$")

# Live conversions only: id → {"proc": Process | None, "task": Task}
_RUN: dict[str, dict[str, Any]] = {}


def mineru_bin() -> Optional[str]:
    found = shutil.which("mineru-kit")
    if found:
        return found
    here = Path(sys.executable).resolve().parent
    for base in (here, here / "Scripts", here / "bin"):
        for name in ("mineru-kit", "mineru-kit.exe"):
            c = base / name
            if c.is_file():
                return str(c)
    return None


def mineru_version() -> str:
    try:
        from importlib.metadata import version

        return version("mineru")
    except Exception:  # noqa: BLE001
        return ""


def parse_pages(spec: str) -> str:
    """Validate '1-3,7' (1-based). Returns the cleaned spec; empty means every page."""
    spec = (spec or "").strip().lower()
    if not spec or spec == "all":
        return ""
    for part in spec.split(","):
        m = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", part)
        if not m:
            raise ValueError(f"Bad page range: {part.strip()!r}")
        a, b = int(m.group(1)), int(m.group(2) or m.group(1))
        if a < 1 or b < a:
            raise ValueError(f"Bad page range: {part.strip()!r}")
    return re.sub(r"\s+", "", spec)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def make_router(get_vault: Callable[[], Path]) -> APIRouter:
    router = APIRouter(prefix="/api/tools/pdf", tags=["tools"])

    def root() -> Path:
        return get_vault() / TOOLS_DIR

    def entry_dir(eid: str) -> Path:
        if not ID_RE.fullmatch(eid or ""):
            raise HTTPException(404, "Unknown file")
        d = root() / eid
        if not (d / "meta.json").is_file():
            raise HTTPException(404, "Unknown file")
        return d

    def read_meta(d: Path) -> dict:
        try:
            meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            meta = {"id": d.name, "name": d.name, "status": "error", "error": "Unreadable entry"}
        # A conversion that was running when the server stopped will never finish.
        if meta.get("status") == "running" and meta.get("id") not in _RUN:
            meta["status"] = "error"
            meta["error"] = "Interrupted — convert again"
        return meta

    def write_meta(d: Path, meta: dict) -> None:
        tmp = d / "meta.json.tmp"
        tmp.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        tmp.replace(d / "meta.json")

    async def run_conversion(d: Path, tier: str, pages: str) -> None:
        eid = d.name
        meta = read_meta(d)
        meta.update(status="running", tier=tier, pages=pages, error="", started=_now(), updated=_now())
        write_meta(d, meta)
        out = d / "out" / "result.md"
        shutil.rmtree(d / "out", ignore_errors=True)
        out.parent.mkdir(parents=True, exist_ok=True)
        cmd = [mineru_bin() or "mineru-kit", "parse", str(d / "input.pdf"), "-o", str(out), "--tier", tier]
        if pages:
            cmd += ["--pages", pages]
        try:
            proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            _RUN[eid]["proc"] = proc
            log, _ = await proc.communicate()
            if _RUN.get(eid, {}).get("cancelled"):
                raise RuntimeError("Cancelled")
            if proc.returncode != 0:
                tail = log.decode("utf-8", "replace").strip().splitlines()[-4:]
                raise RuntimeError("MinerU failed: " + " | ".join(tail))
            md = out if out.is_file() else next(iter(sorted((d / "out").rglob("*.md"))), None)
            if not md:
                raise RuntimeError("MinerU produced no Markdown file")
            text = md.read_text(encoding="utf-8", errors="replace")
            (d / "result.txt").write_text(text, encoding="utf-8")
            meta.update(status="done", chars=len(text), error="", finished=_now(), updated=_now())
        except Exception as e:  # noqa: BLE001
            cancelled = _RUN.get(eid, {}).get("cancelled")
            meta.update(status="cancelled" if cancelled else "error", error="" if cancelled else (str(e) or e.__class__.__name__), updated=_now())
        finally:
            shutil.rmtree(d / "out", ignore_errors=True)
            _RUN.pop(eid, None)
            if d.is_dir():
                write_meta(d, meta)

    def launch(d: Path, tier: str, pages: str) -> None:
        if not mineru_bin():
            raise HTTPException(500, "MinerU is missing from this install")
        eid = d.name
        if eid in _RUN:
            raise HTTPException(409, "Already converting")
        _RUN[eid] = {"proc": None, "cancelled": False}
        _RUN[eid]["task"] = asyncio.create_task(run_conversion(d, tier, pages))

    @router.get("/status")
    def status():
        return {
            "mineru": {"installed": bool(mineru_bin()), "version": mineru_version()},
            "tiers": list(TIERS),
        }

    @router.get("/files")
    def list_files():
        items = []
        if root().is_dir():
            for d in root().iterdir():
                if d.is_dir() and ID_RE.fullmatch(d.name) and (d / "meta.json").is_file():
                    items.append(read_meta(d))
        items.sort(key=lambda m: m.get("created", ""), reverse=True)
        return {"files": items}

    @router.post("/files")
    async def add_file(
        file: UploadFile = File(...),
        tier: str = Form("basic"),
        pages: str = Form(""),
    ):
        if tier not in TIERS:
            raise HTTPException(400, "unknown tier")
        try:
            pages = parse_pages(pages)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        data = await file.read()
        if len(data) > MAX_PDF_BYTES:
            raise HTTPException(413, "PDF is larger than 100 MB")
        if not data.startswith(b"%PDF"):
            raise HTTPException(400, "That does not look like a PDF")
        eid = uuid.uuid4().hex[:12]
        d = root() / eid
        d.mkdir(parents=True, exist_ok=True)
        (d / "input.pdf").write_bytes(data)
        meta = {"id": eid, "name": file.filename or "document.pdf", "size": len(data), "status": "running",
                "tier": tier, "pages": pages, "created": _now(), "updated": _now(), "error": ""}
        write_meta(d, meta)
        launch(d, tier, pages)
        return meta

    @router.get("/files/{eid}")
    def get_file(eid: str):
        return read_meta(entry_dir(eid))

    @router.post("/files/{eid}/convert")
    async def reconvert(eid: str, tier: str = Form("basic"), pages: str = Form("")):
        d = entry_dir(eid)
        if tier not in TIERS:
            raise HTTPException(400, "unknown tier")
        try:
            pages = parse_pages(pages)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        launch(d, tier, pages)
        return read_meta(d)

    @router.get("/files/{eid}/pdf")
    def get_pdf(eid: str):
        d = entry_dir(eid)
        return FileResponse(d / "input.pdf", media_type="application/pdf", content_disposition_type="inline")

    @router.get("/files/{eid}/markdown")
    def get_markdown(eid: str):
        d = entry_dir(eid)
        p = d / "result.txt"
        if not p.is_file():
            raise HTTPException(404, "No result yet")
        return PlainTextResponse(p.read_text(encoding="utf-8", errors="replace"))

    def stop(eid: str) -> None:
        run = _RUN.get(eid)
        if run:
            run["cancelled"] = True
            proc = run.get("proc")
            if proc and proc.returncode is None:
                proc.terminate()

    @router.post("/files/{eid}/cancel")
    def cancel(eid: str):
        entry_dir(eid)
        stop(eid)
        return {"ok": True}

    @router.delete("/files/{eid}")
    def delete_file(eid: str):
        d = entry_dir(eid)
        stop(eid)
        shutil.rmtree(d, ignore_errors=True)
        return {"ok": True}

    return router
