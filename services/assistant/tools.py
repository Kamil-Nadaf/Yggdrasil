"""tools.py — the Tools section backend. First tool: PDF → Markdown / LaTeX.

Two converters, picked automatically:
  1. MinerU (`mineru-kit parse`), when the CLI is installed in the container. Best quality: tables, formulas, layout.
  2. Vision fallback — pages are rendered to images (pypdfium2) and read page by page through the same
     OpenAI-compatible engines the Ink Canvas uses (LM Studio / Gemini free tier / OpenRouter …). No new keys.

Conversion runs as an in-memory job: POST /convert returns a job id, GET /jobs/{id} reports progress and
finally the result. Engine API keys arrive in the request and are used for that job only.

Routes live under /api/tools.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

import canvas

MAX_PDF_BYTES = 100 * 1024 * 1024
MAX_FALLBACK_PAGES = 60
TIERS = ("flash", "basic", "standard", "advanced")
JOB_TTL = 3600

_MD_PROMPT = (
    "Convert this document page to Markdown.\n"
    "- Output only the Markdown. No explanation and no code fences around it.\n"
    "- Keep headings (#), lists and tables (Markdown tables). Write formulas as LaTeX between $...$ or $$...$$.\n"
    "- Skip page numbers, running headers and footers. Do not invent text that is not on the page."
)
_TEX_PROMPT = (
    "Convert this document page to LaTeX body text (no preamble, no \\begin{document}).\n"
    "- Output only LaTeX. No explanation and no code fences.\n"
    "- Use \\section/\\subsection for headings, itemize/enumerate for lists, tabular for tables, "
    "and proper math environments for formulas.\n"
    "- Skip page numbers, running headers and footers. Do not invent text that is not on the page."
)

_JOBS: dict[str, dict[str, Any]] = {}


def mineru_bin() -> Optional[str]:
    return shutil.which("mineru-kit")


def mineru_version() -> str:
    try:
        from importlib.metadata import version

        return version("mineru")
    except Exception:  # noqa: BLE001
        return ""


def render_available() -> bool:
    try:
        import pypdfium2  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


def parse_pages(spec: str, total: int) -> list[int]:
    """'1-3,7' → [0,1,2,6] (zero-based). Empty spec means every page."""
    spec = (spec or "").strip().lower()
    if not spec or spec == "all":
        return list(range(total))
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        m = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", part)
        if not m:
            raise ValueError(f"Bad page range: {part!r}")
        a = int(m.group(1))
        b = int(m.group(2) or a)
        if a < 1 or b < a:
            raise ValueError(f"Bad page range: {part!r}")
        for p in range(a, min(b, total) + 1):
            if p - 1 not in out:
                out.append(p - 1)
    if not out:
        raise ValueError("No pages selected")
    return out


def strip_fences(text: str) -> str:
    s = canvas._THINK_RE.sub("", text or "").strip()
    m = canvas._FENCE_RE.match(s)
    return (m.group(1) if m else s).strip()


def _gc() -> None:
    now = time.time()
    for jid in [j for j, v in _JOBS.items() if now - v["created"] > JOB_TTL]:
        d = _JOBS.pop(jid, {}).get("dir")
        if d:
            shutil.rmtree(d, ignore_errors=True)


async def _vision_page(client: httpx.AsyncClient, engines: list[canvas.EngineConfig], data_url: str, prompt: str,
                       resolve: Callable[[str], str]) -> tuple[str, str]:
    errors: list[str] = []
    for eng in engines:
        label = eng.label or eng.model or eng.base_url
        base = resolve(eng.base_url).strip().rstrip("/")
        body: dict[str, Any] = {
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}],
            "temperature": 0,
            "max_tokens": 4096,
        }
        if eng.model.strip():
            body["model"] = eng.model.strip()
        try:
            for attempt in range(2):
                resp = await client.post(f"{base}/chat/completions", headers=canvas._headers(eng.api_key), json=body)
                if resp.status_code in (429, 503) and attempt == 0:
                    await asyncio.sleep(2)
                    continue
                break
            if resp.status_code >= 400:
                raise RuntimeError(canvas._short_error(resp))
            msg = (resp.json().get("choices") or [{}])[0].get("message") or {}
            text = canvas._answer_text(msg)
            if not text.strip():
                raise RuntimeError("empty answer")
            return strip_fences(text), label
        except Exception as e:  # noqa: BLE001
            errors.append(f"{label}: {e or e.__class__.__name__}")
    raise RuntimeError("; ".join(errors) or "No engine configured")


async def _run_vision(job: dict, pdf: Path, pages_spec: str, fmt: str, engines: list[canvas.EngineConfig],
                      resolve: Callable[[str], str]) -> None:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    total = len(doc)
    idx = parse_pages(pages_spec, total)
    if len(idx) > MAX_FALLBACK_PAGES:
        raise ValueError(f"The vision fallback reads up to {MAX_FALLBACK_PAGES} pages at a time — pick a page range")
    job["total"] = len(idx)
    prompt = _TEX_PROMPT if fmt == "latex" else _MD_PROMPT
    parts: list[str] = []
    used = ""
    async with httpx.AsyncClient(timeout=180) as client:
        for n, i in enumerate(idx, 1):
            job["message"] = f"Reading page {i + 1}"
            img = doc[i].render(scale=2).to_pil()
            import io

            buf = io.BytesIO()
            img.convert("RGB").save(buf, "JPEG", quality=85)
            url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
            text, used = await _vision_page(client, engines, url, prompt, resolve)
            parts.append(text)
            job["done"] = n
            job["partial"] = "\n\n".join(parts)
    job["result"] = {"text": "\n\n".join(parts), "format": fmt, "converter": f"Vision · {used}", "pages": len(idx)}


async def _run_mineru(job: dict, pdf: Path, pages_spec: str, tier: str) -> None:
    out = pdf.parent / "out.md"
    cmd = [mineru_bin() or "mineru-kit", "parse", str(pdf), "-o", str(out), "--tier", tier]
    if pages_spec.strip():
        cmd += ["--pages", pages_spec.strip()]
    job["message"] = f"MinerU ({tier}) is reading the document"
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    job["proc"] = proc
    log, _ = await proc.communicate()
    job.pop("proc", None)
    if job.get("cancelled"):
        raise RuntimeError("Cancelled")
    if proc.returncode != 0:
        tail = log.decode("utf-8", "replace").strip().splitlines()[-4:]
        raise RuntimeError("MinerU failed: " + " | ".join(tail))
    md = out if out.is_file() else next(iter(sorted(pdf.parent.rglob("*.md"))), None)
    if not md:
        raise RuntimeError("MinerU produced no Markdown file")
    text = md.read_text(encoding="utf-8", errors="replace")
    job["done"] = job["total"] = max(job.get("total", 1), 1)
    job["result"] = {"text": text, "format": "markdown", "converter": f"MinerU · {tier}", "pages": 0}


def make_router(resolve_base_url: Callable[[str], str] = lambda u: u) -> APIRouter:
    router = APIRouter(prefix="/api/tools", tags=["tools"])

    @router.get("/pdf/status")
    def status():
        return {
            "mineru": {"installed": bool(mineru_bin()), "version": mineru_version()},
            "vision": {"available": render_available()},
            "tiers": list(TIERS),
            "hint": "" if mineru_bin() else
                    "MinerU is not installed in this container. Rebuild with `--build-arg WITH_MINERU=1`, "
                    "or use the vision engines you configured for the Canvas.",
        }

    @router.post("/pdf/convert")
    async def convert(
        file: UploadFile = File(...),
        output: str = Form("markdown"),
        tier: str = Form("basic"),
        pages: str = Form(""),
        converter: str = Form("auto"),
        engines: str = Form("[]"),
    ):
        _gc()
        if output not in ("markdown", "latex"):
            raise HTTPException(400, "output must be markdown or latex")
        if tier not in TIERS:
            raise HTTPException(400, "unknown tier")
        data = await file.read()
        if len(data) > MAX_PDF_BYTES:
            raise HTTPException(413, "PDF is larger than 100 MB")
        if not data.startswith(b"%PDF"):
            raise HTTPException(400, "That does not look like a PDF")
        try:
            eng_list = [canvas.EngineConfig(**e) for e in json.loads(engines or "[]")]
        except Exception:  # noqa: BLE001
            raise HTTPException(400, "engines must be a JSON list") from None
        eng_list = [e for e in eng_list if e.base_url.strip()]
        use_mineru = converter == "mineru" or (converter == "auto" and bool(mineru_bin()))
        if use_mineru and not mineru_bin():
            raise HTTPException(400, "MinerU is not installed in this container")
        if not use_mineru:
            if not render_available():
                raise HTTPException(400, "Neither MinerU nor the page renderer is available in this container")
            if not eng_list:
                raise HTTPException(400, "No handwriting/vision engine is configured — add one in the Canvas settings, or install MinerU")
        if pages.strip():
            try:
                parse_pages(pages, 10**6)
            except ValueError as e:
                raise HTTPException(400, str(e)) from None

        d = Path(tempfile.mkdtemp(prefix="ygg-pdf-"))
        pdf = d / "input.pdf"
        pdf.write_bytes(data)
        jid = uuid.uuid4().hex[:12]
        job: dict[str, Any] = {
            "id": jid, "created": time.time(), "dir": str(d), "status": "running", "done": 0, "total": 0,
            "message": "Starting", "name": file.filename or "document.pdf", "output": output,
            "converter": "mineru" if use_mineru else "vision",
        }
        _JOBS[jid] = job

        async def run():
            try:
                if use_mineru:
                    await _run_mineru(job, pdf, pages, tier)
                else:
                    await _run_vision(job, pdf, pages, output, eng_list, resolve_base_url)
                job["status"] = "done"
                job["message"] = "Done"
            except Exception as e:  # noqa: BLE001
                job["status"] = "cancelled" if job.get("cancelled") else "error"
                job["error"] = str(e) or e.__class__.__name__
            finally:
                shutil.rmtree(d, ignore_errors=True)

        job["task"] = asyncio.create_task(run())
        return {"job_id": jid}

    def _public(job: dict) -> dict:
        return {k: job.get(k) for k in ("id", "status", "done", "total", "message", "error", "name", "output", "converter", "result", "partial")}

    @router.get("/pdf/jobs/{jid}")
    def job_state(jid: str):
        job = _JOBS.get(jid)
        if not job:
            raise HTTPException(404, "Unknown job")
        return _public(job)

    @router.delete("/pdf/jobs/{jid}")
    def cancel(jid: str):
        job = _JOBS.get(jid)
        if not job:
            raise HTTPException(404, "Unknown job")
        job["cancelled"] = True
        proc = job.get("proc")
        if proc and proc.returncode is None:
            proc.terminate()
        task = job.get("task")
        if task and not task.done():
            task.cancel()
            job["status"] = "cancelled"
        return {"ok": True}

    return router
