#!/usr/bin/env python3
"""WebSocket ↔ PTY bridge that runs the Feynman CLI (terminal mode for Yggdrasil Ask)."""

from __future__ import annotations

import asyncio
import fcntl
import json
import os
import pty
import struct
import termios
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import uvicorn

FEYNMAN_BIN = os.environ.get("FEYNMAN_BIN", "feynman")
WORKDIR = os.environ.get("FEYNMAN_WORKDIR", "/workspace")
HOST = os.environ.get("FEYNMAN_TERM_HOST", "0.0.0.0")
PORT = int(os.environ.get("FEYNMAN_TERM_PORT", "6174"))

app = FastAPI(title="Yggdrasil Feynman Terminal")


@app.get("/health")
async def health():
    return {
        "ok": True,
        "mode": "terminal",
        "bin": FEYNMAN_BIN,
        "workdir": WORKDIR,
        "docsUrl": "https://www.feynman.is",
    }


def _set_winsize(fd: int, rows: int, cols: int) -> None:
    rows = max(1, min(rows, 500))
    cols = max(1, min(cols, 500))
    packed = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, packed)


async def _pty_to_ws(master: int, ws: WebSocket, proc: asyncio.subprocess.Process) -> None:
    loop = asyncio.get_event_loop()
    try:
        while True:
            try:
                data = await loop.run_in_executor(None, lambda: os.read(master, 8192))
            except OSError:
                break
            if not data:
                break
            await ws.send_bytes(data)
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass


async def _ws_to_pty(master: int, ws: WebSocket) -> None:
    loop = asyncio.get_event_loop()
    while True:
        message = await ws.receive()
        if message.get("type") == "websocket.disconnect":
            break
        if "bytes" in message and message["bytes"] is not None:
            await loop.run_in_executor(None, os.write, master, message["bytes"])
            continue
        text = message.get("text")
        if text is None:
            continue
        # Control JSON from xterm client (resize / init)
        if text.startswith("{"):
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                await loop.run_in_executor(None, os.write, master, text.encode())
                continue
            if payload.get("type") == "resize":
                _set_winsize(master, int(payload.get("rows", 24)), int(payload.get("cols", 80)))
            continue
        await loop.run_in_executor(None, os.write, master, text.encode())


@app.websocket("/ws")
async def terminal_ws(ws: WebSocket):
    await ws.accept()
    master, slave = pty.openpty()
    _set_winsize(master, 32, 120)

    env = os.environ.copy()
    env.setdefault("TERM", "xterm-256color")
    env.setdefault("COLORTERM", "truecolor")
    # Hint for first-run setup: physics / astrophysics (CLI has no domain chips)
    env.setdefault(
        "FEYNMAN_ONBOARDING_HINT",
        "physics / astrophysics (high-energy astrophysics, GRBs, compact objects)",
    )

    # bash keeps the PTY alive while `feynman` does its slow first-run boot
    # (~30–45s). A bare `feynman` spawn looks like “nothing opened”.
    try:
        proc = await asyncio.create_subprocess_exec(
            "/bin/bash",
            "-lc",
            (
                "echo 'Starting Feynman CLI (first launch can take ~40s)…'; "
                f"exec {FEYNMAN_BIN}"
            ),
            stdin=slave,
            stdout=slave,
            stderr=slave,
            cwd=WORKDIR if os.path.isdir(WORKDIR) else None,
            env=env,
            start_new_session=True,
        )
    except FileNotFoundError:
        os.close(master)
        os.close(slave)
        await ws.send_text(
            f"error: `{FEYNMAN_BIN}` not found in container.\n"
            "Rebuild the feynman image: docker compose build feynman && docker compose up -d feynman\n"
        )
        await ws.close()
        return
    finally:
        os.close(slave)

    reader = asyncio.create_task(_pty_to_ws(master, ws, proc))
    writer: Optional[asyncio.Task] = None
    try:
        writer = asyncio.create_task(_ws_to_pty(master, ws))
        await asyncio.wait({reader, writer}, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in (reader, writer):
            if task and not task.done():
                task.cancel()
        if proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.wait_for(proc.wait(), timeout=2)
            except Exception:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
        try:
            os.close(master)
        except OSError:
            pass
        try:
            await ws.close()
        except Exception:
            pass


@app.get("/")
async def root():
    return JSONResponse(
        {
            "ok": True,
            "mode": "terminal",
            "ws": "/ws",
            "health": "/health",
            "message": "Connect a WebSocket client to /ws for the Feynman CLI.",
        }
    )


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
