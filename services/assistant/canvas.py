"""canvas.py — Ink Canvas: handwriting → LaTeX through vision-capable engines.

The browser draws ink, crops the selected strokes to an image and posts it here together with an
ordered list of engines. Every engine speaks the OpenAI-compatible chat-completions API with image
input, which covers LM Studio, Gemini (its /v1beta/openai endpoint), OpenRouter and any custom
endpoint. Engines are tried in order; the first answer that looks like well-formed LaTeX wins.

API keys arrive in the request body and are used for that request only — same rule as /ask.

Pages (stroke data) are plain JSON files in the vault:

  90-Canvas/
    {name}.ink.json      ← {"strokes": [...], "blocks": [...], ...} written by the browser

Routes live under /api/canvas.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

CANVAS_DIR = "90-Canvas"
PAGE_SUFFIX = ".ink.json"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$")
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PAGE_BYTES = 20 * 1024 * 1024

PROMPT = (
    "Transcribe the handwriting in this image into LaTeX.\n"
    "- Output only LaTeX. No explanation, no markdown fences.\n"
    "- Write mathematics in math mode. Use the align* environment when there are several equations "
    "or lines, one equation per line, separated by \\\\.\n"
    "- Keep ordinary words as plain text, using \\text{...} inside equations.\n"
    "- Do not invent or complete anything that is not written. If a symbol is unclear, give your best reading."
)


class EngineConfig(BaseModel):
    id: str = ""
    label: str = ""
    base_url: str
    api_key: str = ""
    model: str = ""


class RecognizeRequest(BaseModel):
    image: str  # data:image/...;base64,...
    engines: list[EngineConfig]


class ModelsRequest(BaseModel):
    base_url: str
    api_key: str = ""


# ── LaTeX clean-up and checks ────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^\s*```[a-zA-Z]*\s*\n?(.*?)\n?```\s*$", re.S)
_THINK_RE = re.compile(r"<think>.*?</think>", re.S | re.I)


def clean_latex(raw: str) -> str:
    """Strip what chat models wrap around an answer: think blocks, fences, a full document, $$ / \\[ \\]."""
    s = _THINK_RE.sub("", raw or "").strip()
    m = _FENCE_RE.match(s)
    if m:
        s = m.group(1).strip()
    doc = re.search(r"\\begin\{document\}(.*?)\\end\{document\}", s, re.S)
    if doc:
        s = doc.group(1).strip()
    if s.startswith("$$") and s.endswith("$$") and len(s) > 4 and "$$" not in s[2:-2]:
        s = s[2:-2].strip()
    elif s.startswith("\\[") and s.endswith("\\]"):
        s = s[2:-2].strip()
    return s


def validate_latex(src: str) -> list[str]:
    """Cheap structural checks. Not a compiler — it catches truncated or garbled answers so the next engine can try."""
    if not src.strip():
        return ["Empty result"]
    text = re.sub(r"(?<!\\)%.*", "", src)  # comments
    text = re.sub(r"\\[{}]", "", text)  # escaped braces
    warnings: list[str] = []
    depth = 0
    for ch in text:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                break
    if depth != 0:
        warnings.append("Unbalanced braces")
    stack: list[str] = []
    for m in re.finditer(r"\\(begin|end)\{([^}]*)\}", text):
        kind, env = m.group(1), m.group(2)
        if kind == "begin":
            stack.append(env)
        elif not stack or stack.pop() != env:
            warnings.append(f"Mismatched \\end{{{env}}}")
            break
    else:
        if stack:
            warnings.append(f"Missing \\end{{{stack[-1]}}}")
    if len(re.findall(r"\\left\b", text)) != len(re.findall(r"\\right\b", text)):
        warnings.append("\\left / \\right do not pair up")
    if len(re.findall(r"(?<!\\)\$", text)) % 2:
        warnings.append("Odd number of $ signs")
    return warnings


# ── Engine call ──────────────────────────────────────────────────────────────

def _default_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))


def _answer_text(msg: dict) -> str:
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(b.get("text") or "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _headers(api_key: str) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    return h


def _short_error(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        err = body.get("error")
        if isinstance(err, dict):
            err = err.get("message")
        detail = err or body.get("detail") or body.get("message")
    except Exception:
        detail = None
    return f"HTTP {resp.status_code}: {str(detail or resp.text)[:240]}"


async def _call_engine(
    client: httpx.AsyncClient, eng: EngineConfig, data_url: str, resolve: Callable[[str], str]
) -> str:
    base = resolve(eng.base_url).strip().rstrip("/")
    if not base:
        raise RuntimeError("No base URL")
    body: dict[str, Any] = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        "temperature": 0,
        "max_tokens": 1024,
    }
    if eng.model.strip():
        body["model"] = eng.model.strip()
    # Busy hosted models answer 503/429 for a moment: one quick retry before moving on to the next engine.
    resp = await client.post(f"{base}/chat/completions", headers=_headers(eng.api_key), json=body)
    if resp.status_code in (429, 503):
        await asyncio.sleep(1.5)
        resp = await client.post(f"{base}/chat/completions", headers=_headers(eng.api_key), json=body)
    if resp.status_code >= 400:
        raise RuntimeError(_short_error(resp))
    msg = (resp.json().get("choices") or [{}])[0].get("message") or {}
    text = _answer_text(msg)
    if not text.strip():
        raise RuntimeError("The model returned an empty answer")
    return text


# ── Router ───────────────────────────────────────────────────────────────────

def make_router(
    get_vault: Callable[[], Path],
    resolve_base_url: Callable[[str], str] = lambda u: u,
    client_factory: Callable[[], httpx.AsyncClient] = _default_client,
) -> APIRouter:
    router = APIRouter(prefix="/api/canvas", tags=["canvas"])

    def root() -> Path:
        return get_vault() / CANVAS_DIR

    def page_path(name: str) -> Path:
        if not NAME_RE.fullmatch(name or "") or name.endswith("."):
            raise HTTPException(status_code=400, detail="Invalid page name")
        return root() / f"{name}{PAGE_SUFFIX}"

    @router.post("/recognize")
    async def recognize(req: RecognizeRequest):
        if not req.image.startswith("data:image/") or ";base64," not in req.image[:64]:
            raise HTTPException(status_code=400, detail="image must be a base64 data URL")
        if len(req.image) * 3 // 4 > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image is too large")
        engines = [e for e in req.engines if e.base_url.strip()]
        if not engines:
            raise HTTPException(status_code=400, detail="No engine is configured")

        attempts: list[dict[str, Any]] = []
        best: Optional[dict[str, Any]] = None
        async with client_factory() as client:
            for eng in engines:
                label = eng.label or eng.id or eng.base_url
                t0 = time.monotonic()
                try:
                    raw = await _call_engine(client, eng, req.image, resolve_base_url)
                except httpx.TimeoutException:
                    attempts.append({"engine": label, "ok": False, "error": "Timed out"})
                    continue
                except Exception as e:  # noqa: BLE001 — surface any engine failure to the UI
                    attempts.append({"engine": label, "ok": False, "error": str(e) or e.__class__.__name__})
                    continue
                ms = int((time.monotonic() - t0) * 1000)
                latex = clean_latex(raw)
                warnings = validate_latex(latex)
                attempts.append({"engine": label, "ok": not warnings, "ms": ms, "warnings": warnings})
                cand = {"latex": latex, "engine": label, "engine_id": eng.id, "ms": ms, "warnings": warnings}
                if not warnings:
                    return {**cand, "attempts": attempts}
                if latex and (best is None or len(warnings) < len(best["warnings"])):
                    best = cand
        if best:
            return {**best, "attempts": attempts}
        reasons = "; ".join(f"{a['engine']}: {a.get('error') or ', '.join(a.get('warnings') or [])}" for a in attempts)
        raise HTTPException(status_code=502, detail=f"No engine could read the ink — {reasons}")

    @router.post("/models")
    async def models(req: ModelsRequest):
        base = resolve_base_url(req.base_url).strip().rstrip("/")
        if not base:
            raise HTTPException(status_code=400, detail="No base URL")
        try:
            async with client_factory() as client:
                resp = await client.get(f"{base}/models", headers=_headers(req.api_key))
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Could not reach {base}: {e.__class__.__name__}") from e
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=_short_error(resp))
        data = resp.json()
        items = data.get("data") if isinstance(data, dict) else data
        ids = sorted(
            {str(m.get("id") or m.get("name") or "").removeprefix("models/") for m in (items or []) if isinstance(m, dict)}
            - {""}
        )
        return {"models": ids}

    @router.get("/pages")
    def list_pages():
        out = []
        d = root()
        if d.is_dir():
            for p in d.glob(f"*{PAGE_SUFFIX}"):
                name = p.name[: -len(PAGE_SUFFIX)]
                if NAME_RE.fullmatch(name):
                    out.append({"name": name, "updated": p.stat().st_mtime})
        out.sort(key=lambda x: x["updated"], reverse=True)
        return {"pages": out}

    @router.get("/pages/{name}")
    def get_page(name: str):
        p = page_path(name)
        if not p.is_file():
            raise HTTPException(status_code=404, detail="Page not found")
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise HTTPException(status_code=500, detail="Page file is unreadable") from e

    @router.put("/pages/{name}")
    def put_page(name: str, payload: dict):
        p = page_path(name)
        if not isinstance(payload.get("strokes"), list):
            raise HTTPException(status_code=400, detail="strokes must be a list")
        text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        if len(text.encode("utf-8")) > MAX_PAGE_BYTES:
            raise HTTPException(status_code=413, detail="Page is too large")
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, p)
        return {"ok": True, "name": name}

    @router.delete("/pages/{name}")
    def delete_page(name: str):
        p = page_path(name)
        if p.is_file():
            p.unlink()
        return {"ok": True}

    return router
