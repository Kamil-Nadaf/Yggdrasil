"""tools.py — the Tools section backend. First tool: PDF → Markdown (MinerU).

Each uploaded PDF becomes an entry that persists in the vault, so the file list survives restarts:

  95-Tools/pdf/{id}/
    input.pdf       the original
    result.txt      Markdown from MinerU (".txt" so the notes indexer does not pick it up)
    meta.json       name, size, tier, pages, status, timestamps, error

MinerU is an optional add-on (addons.py) downloaded from Tools; Docker and dev installs have it as a normal package. The CLI is
`mineru-kit parse input.pdf -o out.md --tier flash|basic|standard|advanced`. It is looked up on PATH and
next to the running interpreter, which is where the desktop installers put it.

Routes live under /api/tools/pdf.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional, Union

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

TOOLS_DIR = "95-Tools/pdf"
MAX_PDF_BYTES = 100 * 1024 * 1024
TIERS = ("flash", "basic", "standard", "advanced")
ID_RE = re.compile(r"^[0-9a-f]{12}$")

# Live conversions only: id → {"proc": Process | None, "task": Task}
_RUN: dict[str, dict[str, Any]] = {}


def _entry_point() -> Optional[tuple[str, str]]:
    """(module, attr) of the `mineru-kit` console script.

    MinerU is an optional add-on (see addons.py) installed into the app's data folder, or, in
    Docker and dev, a normal package. pip writes console scripts with an absolute shebang to the
    build-time Python, which is dead after the bundled interpreter is relocated, so the script is
    never exec'd: the entry point is called with the running interpreter instead."""
    import addons

    found = addons.entry_point("mineru", "mineru-kit")
    if found:
        return found
    try:
        from importlib.metadata import entry_points

        for ep in entry_points(group="console_scripts"):
            if ep.name == "mineru-kit":
                mod, _, attr = ep.value.partition(":")
                return mod.strip(), attr.split("[")[0].strip()
    except Exception:  # noqa: BLE001
        pass
    return None


def mineru_env() -> dict[str, str]:
    """Environment for the MinerU subprocess: the add-on folder first on PYTHONPATH."""
    import addons

    env = dict(os.environ)
    site = addons.site_path("mineru")
    if site:
        env["PYTHONPATH"] = site + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    return env


def mineru_cmd() -> Optional[list[str]]:
    """Argv prefix that runs `mineru-kit`, or None when MinerU isn't installed."""
    ep = _entry_point()
    if ep and ep[0] and ep[1]:
        code = (
            "import sys, importlib; sys.argv[0] = 'mineru-kit'; "
            f"sys.exit(getattr(importlib.import_module({ep[0]!r}), {ep[1]!r})())"
        )
        return [sys.executable, "-c", code]
    found = shutil.which("mineru-kit")
    return [found] if found else None


def mineru_bin() -> Optional[str]:
    cmd = mineru_cmd()
    return cmd[0] if cmd else None


def mineru_version() -> str:
    import addons

    v = addons.installed_version("mineru")
    if v:
        return v
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


# ── AI-vision conversion: one model request per page, engines tried in order ──────────────────────

AI_PROMPT = (
    "Convert this page of a document to Markdown. Keep the reading order. Write mathematics as LaTeX "
    "($...$ inline, $$...$$ for display). Keep tables as Markdown tables. Use # headings for section "
    "titles. Skip running headers, footers and page numbers. For a figure write ![figure](figure) and "
    "keep its caption as text. Output only the Markdown, with no commentary and no code fence around it."
)


def page_numbers(spec: str, total: int) -> list[int]:
    """'1-3,7' -> [1, 2, 3, 7] (1-based, clipped to the document)."""
    if not spec:
        return list(range(1, total + 1))
    out: list[int] = []
    for part in spec.split(","):
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if not m:
            continue
        a, b = int(m.group(1)), int(m.group(2) or m.group(1))
        out += [n for n in range(a, b + 1) if 1 <= n <= total and n not in out]
    return out


def _png(rgb: Any) -> bytes:
    """Encode an HxWx3 uint8 array as PNG (no Pillow needed)."""
    import struct
    import zlib

    h, w = rgb.shape[0], rgb.shape[1]
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def render_page_png(pdf_path: Path, number: int, scale: float = 2.0) -> bytes:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf_path))
    try:
        arr = doc[number - 1].render(scale=scale, rev_byteorder=True).to_numpy()
        return _png(arr[:, :, :3])
    finally:
        doc.close()


def _reply_text(data: dict) -> str:
    msg = (data.get("choices") or [{}])[0].get("message") or {}
    c = msg.get("content")
    if isinstance(c, list):
        c = "".join(part.get("text", "") for part in c if isinstance(part, dict))
    text = (c or "").strip()
    m = re.fullmatch(r"```(?:markdown|md)?\s*\n(.*)\n```", text, flags=re.S)
    return (m.group(1) if m else text).strip()


async def ai_page_to_markdown(client: Any, engines: list[dict], png: bytes) -> tuple[str, str, list[str]]:
    """Try each engine in order. Returns (markdown, engine label, errors from engines that failed first)."""
    import base64

    errors: list[str] = []
    image = "data:image/png;base64," + base64.b64encode(png).decode()
    for eng in engines:
        body: dict[str, Any] = {
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": AI_PROMPT},
                {"type": "image_url", "image_url": {"url": image}},
            ]}],
            "temperature": 0,
            "max_tokens": 4096,
        }
        if eng.get("model"):
            body["model"] = eng["model"]
        headers = {"Authorization": f"Bearer {eng.get('api_key') or 'none'}"}
        url = eng["base_url"].rstrip("/") + "/chat/completions"
        try:
            for attempt in range(4):
                r = await client.post(url, json=body, headers=headers, timeout=180.0)
                if r.status_code in (429, 503) and attempt < 3:
                    await asyncio.sleep(4 * (attempt + 1))
                    continue
                r.raise_for_status()
                break
            text = _reply_text(r.json())
            if text:
                return text, eng.get("label") or eng["base_url"], errors
            errors.append(f"{eng.get('label')}: empty answer")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            errors.append(f"{eng.get('label') or eng['base_url']}: {str(e)[:160] or e.__class__.__name__}")
    return "", "", errors


class ImportRequest(BaseModel):
    key: str            # the reader's own key: an arXiv id, or book-{slug} for the Collection
    url: str = ""       # public PDF URL, used when there is no saved copy
    name: str = ""
    kind: str = "paper"  # "paper" starts converting at once; "book" only gets added
    auto: Optional[bool] = None


PdfSource = Union[bytes, Path]


def make_router(
    get_vault: Callable[[], Path],
    resolve_pdf: Optional[Callable[[str, str], Awaitable[PdfSource]]] = None,
) -> APIRouter:
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
        cmd = [*(mineru_cmd() or ["mineru-kit"]), "parse", str(d / "input.pdf"), "-o", str(out), "--tier", tier]
        if pages:
            cmd += ["--pages", pages]
        try:
            try:
                proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=mineru_env())
            except FileNotFoundError as e:
                raise RuntimeError(f"Couldn't start MinerU ({cmd[0]}): {e.strerror or e}. Reinstall the full installer.") from e
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

    async def run_ai_conversion(d: Path, engines: list[dict], pages: str) -> None:
        import httpx

        eid = d.name
        meta = read_meta(d)
        meta.update(status="running", tier="ai", pages=pages, error="", progress="Starting…", started=_now(), updated=_now())
        write_meta(d, meta)
        try:
            try:
                import pypdfium2 as pdfium
            except ImportError:
                raise RuntimeError("AI conversion needs pypdfium2, which isn't in this install. Update to the latest version.") from None
            doc = pdfium.PdfDocument(str(d / "input.pdf"))
            total = len(doc)
            doc.close()
            nums = page_numbers(pages, total)
            if not nums:
                raise RuntimeError("No pages to convert in that range")
            parts: list[str] = []
            first_error = ""
            ok = 0
            async with httpx.AsyncClient() as client:
                for i, n in enumerate(nums, 1):
                    if _RUN.get(eid, {}).get("cancelled"):
                        raise RuntimeError("Cancelled")
                    meta.update(progress=f"Page {i} of {len(nums)}", updated=_now())
                    write_meta(d, meta)
                    png = await asyncio.to_thread(render_page_png, d / "input.pdf", n)
                    text, label, errs = await ai_page_to_markdown(client, engines, png)
                    if text:
                        ok += 1
                        parts.append(text)
                    else:
                        first_error = first_error or " | ".join(errs)
                        parts.append(f"> [Page {n} could not be read: {errs[0] if errs else 'no answer'}]")
            if not ok:
                raise RuntimeError("No model could read the pages. " + first_error)
            out = "\n\n".join(parts) + "\n"
            (d / "result.txt").write_text(out, encoding="utf-8")
            meta.update(status="done", chars=len(out), error="", progress="", finished=_now(), updated=_now())
        except asyncio.CancelledError:
            meta.update(status="cancelled", error="", progress="", updated=_now())
        except Exception as e:  # noqa: BLE001
            cancelled = _RUN.get(eid, {}).get("cancelled")
            meta.update(status="cancelled" if cancelled else "error", error="" if cancelled else (str(e) or e.__class__.__name__), progress="", updated=_now())
        finally:
            _RUN.pop(eid, None)
            if d.is_dir():
                write_meta(d, meta)

    def launch_ai(d: Path, engines: list[dict], pages: str) -> None:
        eid = d.name
        if eid in _RUN:
            raise HTTPException(409, "Already converting")
        _RUN[eid] = {"proc": None, "cancelled": False, "ai": True}
        _RUN[eid]["task"] = asyncio.create_task(run_ai_conversion(d, engines, pages))

    def eid_free(eid: str) -> bool:
        return eid not in _RUN

    def launch(d: Path, tier: str, pages: str) -> None:
        if not mineru_cmd():
            raise HTTPException(500, "MinerU isn't installed yet. Open Tools -> PDF and press Install MinerU.")
        eid = d.name
        if eid in _RUN:
            raise HTTPException(409, "Already converting")
        _RUN[eid] = {"proc": None, "cancelled": False}
        _RUN[eid]["task"] = asyncio.create_task(run_conversion(d, tier, pages))

    @router.get("/status")
    def status():
        return {
            "mineru": {"installed": bool(mineru_cmd()), "version": mineru_version()},
            "tiers": list(TIERS),
            "ai": {"available": importlib.util.find_spec("pypdfium2") is not None},
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
        # Without MinerU the file just waits: the user can install it, or pick an AI model, then press Convert.
        start = bool(mineru_cmd())
        meta = {"id": eid, "name": file.filename or "document.pdf", "size": len(data), "status": "running" if start else "ready",
                "tier": tier, "pages": pages, "created": _now(), "updated": _now(), "error": ""}
        write_meta(d, meta)
        if start:
            launch(d, tier, pages)
        return meta

    @router.post("/import")
    async def import_pdf(req: ImportRequest):
        """Add a PDF that already lives elsewhere in the app (a paper or a Collection book)."""
        if resolve_pdf is None:
            raise HTTPException(500, "Import is not available")
        key = (req.key or "").strip()
        if not key:
            raise HTTPException(400, "Missing key")
        auto = (req.auto if req.auto is not None else req.kind == "paper") and bool(mineru_cmd())
        # The same source is only added once; it may still need converting.
        if root().is_dir():
            for d in root().iterdir():
                if d.is_dir() and ID_RE.fullmatch(d.name) and (d / "meta.json").is_file():
                    m = read_meta(d)
                    if m.get("source_key") == key:
                        started = False
                        if auto and m.get("status") in ("ready", "error", "cancelled") and eid_free(d.name):
                            launch(d, m.get("tier") or "basic", m.get("pages") or "")
                            started = True
                            m = read_meta(d)
                        return {"existed": True, "started": started, "file": m}
        src = await resolve_pdf(key, req.url)
        eid = uuid.uuid4().hex[:12]
        d = root() / eid
        d.mkdir(parents=True, exist_ok=True)
        if isinstance(src, Path):
            shutil.copyfile(src, d / "input.pdf")
        else:
            (d / "input.pdf").write_bytes(src)
        size = (d / "input.pdf").stat().st_size
        head = (d / "input.pdf").open("rb").read(5)
        if not head.startswith(b"%PDF") or size > MAX_PDF_BYTES:
            shutil.rmtree(d, ignore_errors=True)
            raise HTTPException(400, "That file is not a PDF I can convert (or it is over 100 MB)")
        name = (req.name or key).strip()
        if not name.lower().endswith(".pdf"):
            name += ".pdf"
        meta = {"id": eid, "name": name[:160], "size": size, "status": "ready", "tier": "basic", "pages": "",
                "created": _now(), "updated": _now(), "error": "", "source_key": key, "kind": req.kind}
        write_meta(d, meta)
        if auto:
            launch(d, "basic", "")
            meta = read_meta(d)
        return {"existed": False, "started": auto, "file": meta}

    @router.get("/files/{eid}")
    def get_file(eid: str):
        return read_meta(entry_dir(eid))

    @router.post("/files/{eid}/convert")
    async def reconvert(eid: str, tier: str = Form("basic"), pages: str = Form(""), engine: str = Form("mineru"), engines: str = Form("")):
        d = entry_dir(eid)
        try:
            pages = parse_pages(pages)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        if engine == "ai":
            # Models come with the request (browser settings) and are never stored here.
            try:
                chosen = [e for e in json.loads(engines or "[]") if isinstance(e, dict) and str(e.get("base_url", "")).strip()]
            except ValueError:
                chosen = []
            if not chosen:
                raise HTTPException(400, "Tick PDF → Markdown on at least one model in Settings → AI & integrations")
            launch_ai(d, [{**e, "base_url": str(e["base_url"]).strip(), "model": str(e.get("model", "")).strip(), "api_key": str(e.get("api_key", "")).strip()} for e in chosen], pages)
            return read_meta(d)
        if tier not in TIERS:
            raise HTTPException(400, "unknown tier")
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
            task = run.get("task")
            if run.get("ai") and task:
                task.cancel()
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
