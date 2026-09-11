"""
latex_service.py — Yggdrasil LaTeX compile + vault-storage service.

Routes:
  POST   /compile            compile LaTeX source to PDF (scratch space, not saved)
  POST   /save                write source to /vault/70-LaTeX/{filename}.tex
  GET    /files               list saved .tex files
  GET    /files/{filename}    read a saved .tex file's source
  DELETE /files/{filename}    delete a saved .tex file

This service only ever touches /vault/70-LaTeX/ — it does not read or write
anywhere else in the vault (10-Papers, 20-Concepts, etc. are out of scope).
"""

import asyncio
import base64
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
LATEX_DIR = VAULT / "70-LaTeX"
WORK_DIR = Path("/tmp/latex-build")
COMPILE_TIMEOUT = 120  # seconds

app = FastAPI(title="Yggdrasil LaTeX Service")

# Letters, digits, dot, underscore, dash only — blocks path traversal ("/", "..").
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def safe_rel_path(path_value: str) -> str:
    """Validate a relative path and reject traversal / invalid segments."""
    name = path_value.strip().strip("/")
    if not name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid path")

    parts = []
    for part in name.split("/"):
        if part in ("", ".", "..") or not SAFE_NAME_RE.match(part):
            raise HTTPException(status_code=400, detail="Invalid path")
        parts.append(part)

    return "/".join(parts)


def safe_stem(filename: str) -> str:
    """Validate a filename and strip a trailing .tex, returning a bare stem."""
    name = safe_rel_path(filename)
    if name.endswith(".tex"):
        name = name[: -len(".tex")]
    if not name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


def extract_errors(log: str) -> list[str]:
    """Pull human-readable error lines out of a latexmk/pdflatex log."""
    lines = log.splitlines()
    errors = []
    for i, line in enumerate(lines):
        if not line.startswith("!"):
            continue
        msg = line.lstrip("!").strip()
        line_no = ""
        for look in lines[i : i + 5]:
            m = re.match(r"^l\.(\d+)", look)
            if m:
                line_no = m.group(1)
                break
        errors.append(f"line {line_no}: {msg}" if line_no else msg)
    return errors


class CompileRequest(BaseModel):
    source: str
    filename: str = "draft"


class SaveRequest(BaseModel):
    filename: str
    source: str


@app.post("/compile")
async def compile_latex(payload: CompileRequest):
    name = safe_stem(payload.filename)

    source_path = WORK_DIR / f"{name}.tex"
    build_dir = source_path.parent
    build_dir.mkdir(parents=True, exist_ok=True)

    source_path.write_text(payload.source)

    proc = await asyncio.create_subprocess_exec(
        "latexmk",
        "-pdf",
        "-interaction=nonstopmode",
        f"-output-directory={build_dir}",
        str(source_path),
        cwd=str(build_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=COMPILE_TIMEOUT)
        log = stdout.decode(errors="replace")
        returncode = proc.returncode
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return JSONResponse(
            status_code=422,
            content={
                "log": "Compilation exceeded the time limit and was killed.",
                "errors": [f"Compilation timed out after {COMPILE_TIMEOUT}s"],
            },
        )

    pdf_path = source_path.with_suffix(".pdf")
    if returncode != 0 or not pdf_path.exists():
        errors = extract_errors(log) or ["Compilation failed — see log for details"]
        return JSONResponse(status_code=422, content={"log": log, "errors": errors})

    pdf_b64 = base64.b64encode(pdf_path.read_bytes()).decode("ascii")
    return {"pdf_b64": pdf_b64, "log": log, "errors": []}


@app.post("/save")
async def save_file(payload: SaveRequest):
    name = safe_stem(payload.filename)
    LATEX_DIR.mkdir(parents=True, exist_ok=True)
    path = LATEX_DIR / f"{name}.tex"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload.source)
    return {"path": f"70-LaTeX/{name}.tex"}


@app.post("/folders")
async def create_folder(payload: dict):
    folder = safe_rel_path(payload.get("path", ""))
    target = LATEX_DIR / folder
    target.mkdir(parents=True, exist_ok=True)
    return {"path": folder}


@app.get("/files")
async def list_files():
    LATEX_DIR.mkdir(parents=True, exist_ok=True)
    folders = []
    for p in sorted(LATEX_DIR.rglob("*")):
        if p.is_dir() and p != LATEX_DIR and not p.name.startswith("_"):
            folders.append(str(p.relative_to(LATEX_DIR)).replace("\\", "/"))

    files = []
    for p in sorted(LATEX_DIR.rglob("*.tex")):
        stat = p.stat()
        files.append(
            {
                "name": str(p.relative_to(LATEX_DIR)).replace("\\", "/"),
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "size": stat.st_size,
            }
        )
    return {"folders": folders, "files": files}


@app.get("/files/{filename}")
async def get_file(filename: str):
    name = safe_stem(filename)
    path = LATEX_DIR / f"{name}.tex"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {name}.tex")
    return {"source": path.read_text()}


@app.delete("/files/{filename}")
async def delete_file(filename: str):
    name = safe_stem(filename)
    path = LATEX_DIR / f"{name}.tex"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {name}.tex")
    path.unlink()
    return {"ok": True}


@app.on_event("startup")
async def cleanup_work_dir():
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("latex_service:app", host="0.0.0.0", port=9000, reload=False)
