"""
latex_service.py — Yggdrasil LaTeX compile + vault-storage service.

Routes:
  POST   /compile                 compile LaTeX (project-aware when under a folder)
  POST   /save                    write .tex to /vault/70-LaTeX/{path}.tex
  POST   /folders                 create a folder under 70-LaTeX/
  DELETE /folders/{path}          delete a folder (recursive)
  GET    /files                   list .tex files, assets, and folders
  GET    /files/{filename}        read a saved .tex file's source
  DELETE /files/{filename}        delete a .tex file
  POST   /assets                  write a binary asset (png/pdf/bib/…) via base64
  DELETE /assets/{path}           delete a non-.tex asset
  GET    /zip/{path}              zip a project folder or single .tex (base64)
  POST   /rename                  move/rename a file or folder under 70-LaTeX/

This service only ever touches /vault/70-LaTeX/.
"""

import asyncio
import base64
import io
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
LATEX_DIR = VAULT / "70-LaTeX"
WORK_DIR = Path("/tmp/latex-build")
COMPILE_TIMEOUT = 120  # seconds
BUNDLED_SUPPORT_DIR = Path(__file__).resolve().parent

# Asset extensions that may live alongside a main.tex (images, bib, chapters as .tex are separate).
ASSET_EXTS = {
    ".png", ".jpg", ".jpeg", ".pdf", ".eps", ".svg",
    ".bib", ".bst", ".cls", ".sty", ".txt", ".csv", ".dat",
}

app = FastAPI(title="Yggdrasil LaTeX Service")

# Letters, digits, dot, underscore, dash, space — blocks path traversal ("/", "..").
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._ -]+$")


def safe_rel_path(path_value: str) -> str:
    """Validate a relative path and reject traversal / invalid segments."""
    name = path_value.strip().strip("/")
    if not name or name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid path")

    parts = []
    for part in name.split("/"):
        part = part.strip()
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


def under_latex(rel: str) -> Path:
    """Resolve a relative path under LATEX_DIR, rejecting escapes."""
    target = (LATEX_DIR / rel).resolve()
    root = LATEX_DIR.resolve()
    if target != root and root not in target.parents:
        raise HTTPException(status_code=400, detail="Path escapes LaTeX directory")
    return target


# Optional per-document engine selection via a magic comment near the top:
#   % !TEX program = lualatex
_TEX_PROGRAM_RE = re.compile(
    r"^\s*%+\s*!TE?X\s+(?:TS-)?program\s*=\s*([A-Za-z]+)", re.IGNORECASE | re.MULTILINE
)
_ENGINE_FLAGS = {
    "pdflatex": "-pdf",
    "lualatex": "-pdflua",
    "luatex": "-pdflua",
    "xelatex": "-pdfxe",
    "xetex": "-pdfxe",
}


def latexmk_engine_flag(source: str) -> str:
    match = _TEX_PROGRAM_RE.search(source)
    if match:
        return _ENGINE_FLAGS.get(match.group(1).lower(), "-pdf")
    return "-pdf"


_MISSING_TEX_RE = re.compile(
    r"File [`']([^`']+)[`'] not found",
    re.IGNORECASE,
)
_MISSING_FONT_RE = re.compile(r"I can't find file [`']([^`']+)[`']", re.IGNORECASE)
_STY_TO_PKG = {
    "epsf.sty": "epsf",
    "graphicx.sty": "graphics",
    "graphics.sty": "graphics",
    "color.sty": "graphics",
    "trig.sty": "graphics",
    "xcolor.sty": "xcolor",
    "hyperref.sty": "hyperref",
    "natbib.sty": "natbib",
    "booktabs.sty": "booktabs",
    "url.sty": "url",
    "amsmath.sty": "amsmath",
    "amssymb.sty": "amsfonts",
    "fontawesome5.sty": "fontawesome5",
    "tikzposter.cls": "tikzposter",
    "beamerposter.sty": "beamerposter",
    "pgfplots.sty": "pgfplots",
    "lipsum.sty": "lipsum",
    "phvr": "helvet",
    "phvb": "helvet",
    "phvbo": "helvet",
    "phvro": "helvet",
}


def packages_from_log(log: str) -> list[str]:
    names = []
    missing = _MISSING_TEX_RE.findall(log) + _MISSING_FONT_RE.findall(log)
    for fname in missing:
        key = Path(fname).stem.lower()
        names.append(_STY_TO_PKG.get(key, key))
    return list(dict.fromkeys(names))


async def tlmgr_install(packages: list[str]) -> list[str]:
    tlmgr = shutil.which("tlmgr")
    if not tlmgr or not packages:
        return []
    installed: list[str] = []
    for pkg in packages:
        proc = await asyncio.create_subprocess_exec(tlmgr, "install", pkg, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        try:
            _, _ = await asyncio.wait_for(proc.communicate(), timeout=180)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            continue
        if proc.returncode != 0:
            init = await asyncio.create_subprocess_exec(tlmgr, "init-usertree", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            await asyncio.wait_for(init.communicate(), timeout=120)
            proc = await asyncio.create_subprocess_exec(tlmgr, "--usermode", "install", pkg, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            try:
                await asyncio.wait_for(proc.communicate(), timeout=180)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                continue
        if proc.returncode == 0:
            installed.append(pkg)
    return installed


async def run_latexmk(build_dir: Path, source_name: str, engine_flag: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        "latexmk",
        engine_flag,
        "-interaction=nonstopmode",
        f"-output-directory={build_dir}",
        source_name,
        cwd=str(build_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=COMPILE_TIMEOUT)
        return proc.returncode or 0, stdout.decode(errors="replace")
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, "Compilation exceeded the time limit and was killed."


def extract_errors(log: str) -> list[str]:
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


def project_root_for(stem: str) -> Path | None:
    """
    If stem is 'MyPaper/main' or 'MyPaper/chapters/intro', the project root is
    the top-level folder under 70-LaTeX (MyPaper/). Root-level files return None.
    """
    if "/" not in stem:
        return None
    top = stem.split("/", 1)[0]
    root = under_latex(top)
    return root if root.is_dir() else None


class CompileRequest(BaseModel):
    source: str
    filename: str = "draft"


class SaveRequest(BaseModel):
    filename: str
    source: str


class AssetUploadRequest(BaseModel):
    path: str  # relative path under 70-LaTeX, e.g. MyPaper/images/fig1.png
    content_b64: str


class RenameRequest(BaseModel):
    src: str
    dest: str


@app.post("/compile")
async def compile_latex(payload: CompileRequest):
    """
    Compile editor source. If the file lives under a project folder
    (e.g. MyPaper/main.tex), copy that whole folder into the scratch
    workdir first so \\input{chapters/...} and images/ resolve.
    """
    stem = safe_stem(payload.filename)
    job = WORK_DIR / uuid.uuid4().hex
    job.mkdir(parents=True, exist_ok=True)

    try:
        # The desktop bundle ships journal/poster support files next to this
        # service. Put them on the compile job's search path so bundled
        # templates work without requiring a separate TeX installation.
        for support_name in ("aastex", "posters"):
            support_dir = BUNDLED_SUPPORT_DIR / support_name
            if support_dir.is_dir():
                for support_file in support_dir.iterdir():
                    if support_file.is_file():
                        shutil.copy2(support_file, job / support_file.name)

        proj = project_root_for(stem)
        if proj is not None:
            # Mirror the project tree so relative \\input / \\includegraphics work.
            shutil.copytree(proj, job, dirs_exist_ok=True)
            # stem is "MyPaper/main" → write relative "main.tex" inside the copy
            rel_inside = stem.split("/", 1)[1]
            source_path = job / f"{rel_inside}.tex"
            source_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            # Flat file at 70-LaTeX root — just the single .tex
            bare = stem.split("/")[-1]
            source_path = job / f"{bare}.tex"

        source_path.write_text(payload.source)
        build_dir = source_path.parent

        engine_flag = latexmk_engine_flag(payload.source)
        returncode, log = await run_latexmk(build_dir, source_path.name, engine_flag)
        if returncode == 124:
            return JSONResponse(
                status_code=422,
                content={
                    "log": log,
                    "errors": [f"Compilation timed out after {COMPILE_TIMEOUT}s"],
                },
            )

        # TinyTeX is minimal. If a paper needs epsf.sty (or similar), install
        # the TeX Live package and retry instead of leaving a dead compile.
        attempted: set[str] = set()
        for _ in range(3):
            missing = [p for p in packages_from_log(log) if p not in attempted]
            if not missing:
                break
            attempted.update(missing)
            installed = await tlmgr_install(missing)
            if not installed:
                break
            returncode, log = await run_latexmk(build_dir, source_path.name, engine_flag)
            if returncode == 0:
                break

        pdf_path = source_path.with_suffix(".pdf")
        if returncode != 0 or not pdf_path.exists():
            errors = extract_errors(log) or ["Compilation failed — see log for details"]
            return JSONResponse(status_code=422, content={"log": log, "errors": errors})

        pdf_b64 = base64.b64encode(pdf_path.read_bytes()).decode("ascii")
        return {"pdf_b64": pdf_b64, "log": log, "errors": []}
    finally:
        shutil.rmtree(job, ignore_errors=True)


@app.post("/save")
async def save_file(payload: SaveRequest):
    name = safe_stem(payload.filename)
    LATEX_DIR.mkdir(parents=True, exist_ok=True)
    path = under_latex(f"{name}.tex")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload.source)
    return {"path": f"70-LaTeX/{name}.tex"}


@app.post("/folders")
async def create_folder(payload: dict):
    folder = safe_rel_path(payload.get("path", ""))
    target = under_latex(folder)
    target.mkdir(parents=True, exist_ok=True)
    return {"path": folder}


@app.delete("/folders/{folder_path:path}")
async def delete_folder(folder_path: str):
    folder = safe_rel_path(folder_path)
    target = under_latex(folder)
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Folder not found: {folder}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Not a folder")
    if target.resolve() == LATEX_DIR.resolve():
        raise HTTPException(status_code=400, detail="Cannot delete LaTeX root")
    shutil.rmtree(target)
    return {"ok": True, "path": folder}


@app.get("/files")
async def list_files():
    LATEX_DIR.mkdir(parents=True, exist_ok=True)
    folders = []
    for p in sorted(LATEX_DIR.rglob("*")):
        if p.is_dir() and p != LATEX_DIR and not p.name.startswith("_") and not any(
            part.startswith("_") for part in p.relative_to(LATEX_DIR).parts
        ):
            folders.append(str(p.relative_to(LATEX_DIR)).replace("\\", "/"))

    files = []
    for p in sorted(LATEX_DIR.rglob("*.tex")):
        if any(part.startswith("_") for part in p.relative_to(LATEX_DIR).parts):
            continue
        stat = p.stat()
        files.append(
            {
                "name": str(p.relative_to(LATEX_DIR)).replace("\\", "/"),
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "size": stat.st_size,
                "kind": "tex",
            }
        )

    assets = []
    for p in sorted(LATEX_DIR.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() == ".tex":
            continue
        if p.suffix.lower() not in ASSET_EXTS:
            continue
        if any(part.startswith("_") for part in p.relative_to(LATEX_DIR).parts):
            continue
        stat = p.stat()
        assets.append(
            {
                "name": str(p.relative_to(LATEX_DIR)).replace("\\", "/"),
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "size": stat.st_size,
                "kind": "asset",
            }
        )

    return {"folders": folders, "files": files, "assets": assets}


@app.get("/files/{filename:path}")
async def get_file(filename: str):
    name = safe_stem(filename)
    path = under_latex(f"{name}.tex")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {name}.tex")
    return {"source": path.read_text()}


@app.delete("/files/{filename:path}")
async def delete_file(filename: str):
    name = safe_stem(filename)
    path = under_latex(f"{name}.tex")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {name}.tex")
    path.unlink()
    return {"ok": True}


@app.post("/assets")
async def upload_asset(payload: AssetUploadRequest):
    rel = safe_rel_path(payload.path)
    suffix = Path(rel).suffix.lower()
    if suffix not in ASSET_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported asset type '{suffix}'. Allowed: {', '.join(sorted(ASSET_EXTS))}",
        )
    path = under_latex(rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = base64.b64decode(payload.content_b64, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}") from exc
    path.write_bytes(data)
    return {"path": f"70-LaTeX/{rel}", "size": len(data)}


@app.post("/rename")
async def rename_path(payload: RenameRequest):
    src = safe_rel_path(payload.src)
    dest = safe_rel_path(payload.dest)
    src_path = under_latex(src)
    dest_path = under_latex(dest)
    if not src_path.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {src}")
    if dest_path.exists():
        raise HTTPException(status_code=409, detail=f"Already exists: {dest}")
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    src_path.rename(dest_path)
    return {"ok": True, "src": src, "dest": dest}


@app.delete("/assets/{asset_path:path}")
async def delete_asset(asset_path: str):
    rel = safe_rel_path(asset_path)
    path = under_latex(rel)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Asset not found: {rel}")
    if path.suffix.lower() == ".tex":
        raise HTTPException(status_code=400, detail="Use /files to delete .tex files")
    path.unlink()
    return {"ok": True}


@app.get("/zip/{rel:path}")
async def zip_download(rel: str):
    """Zip a project folder, or a single root-level .tex (nested stems zip the parent folder)."""
    rel_path = safe_rel_path(rel)
    as_dir = under_latex(rel_path)
    buf = io.BytesIO()

    if as_dir.is_dir():
        root = as_dir
        zip_basename = root.name
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in sorted(root.rglob("*")):
                if not p.is_file():
                    continue
                if any(part.startswith(".") for part in p.relative_to(root).parts):
                    continue
                zf.write(p, arcname=str(Path(zip_basename) / p.relative_to(root)))
    else:
        name = safe_stem(rel)
        tex = under_latex(f"{name}.tex")
        if not tex.exists():
            raise HTTPException(status_code=404, detail=f"Nothing to zip: {rel_path}")
        if "/" in name:
            root = tex.parent
            zip_basename = root.name
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for p in sorted(root.rglob("*")):
                    if not p.is_file():
                        continue
                    if any(part.startswith(".") for part in p.relative_to(root).parts):
                        continue
                    zf.write(p, arcname=str(Path(zip_basename) / p.relative_to(root)))
        else:
            zip_basename = tex.stem
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.write(tex, arcname=tex.name)

    return {
        "filename": f"{zip_basename}.zip",
        "zip_b64": base64.b64encode(buf.getvalue()).decode("ascii"),
    }


@app.on_event("startup")
async def cleanup_work_dir():
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("LATEX_BIND", "0.0.0.0")
    port = int(os.environ.get("LATEX_PORT", "9000"))
    uvicorn.run(app, host=host, port=port, reload=False)
