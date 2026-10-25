"""Desktop launcher: first-run tool install, local sidecars, then the app window."""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from setup import load_or_ensure, support_dir

CHILDREN: list[subprocess.Popen] = []
_BOOT_STATE: dict = {"window": None, "chosen_path": None, "event": None}


def bundle_dir() -> Path:
    env = os.environ.get("YGG_BUNDLE")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent


def resources_dir() -> Path:
    env = os.environ.get("YGG_RESOURCES")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "services" / "assistant"


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


# The webview loads http://127.0.0.1:{port}, and browser localStorage (theme, API
# keys, provider settings) is scoped per-origin including the port. A random port
# each launch means a fresh, empty localStorage every time — so the app server
# binds this fixed port by default, only falling back to a random one if it's
# somehow already taken (e.g. another instance running).
DEFAULT_APP_PORT = 47285


def app_port() -> int:
    override = os.environ.get("YGG_PORT")
    if override:
        return int(override)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", DEFAULT_APP_PORT))
            return DEFAULT_APP_PORT
    except OSError:
        return free_port()


def wait_for_server(url: str, tries: int = 80) -> None:
    for _ in range(tries):
        try:
            urllib.request.urlopen(url, timeout=0.4)
            return
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            time.sleep(0.15)
    raise RuntimeError(f"Yggdrasil server did not start at {url}")


def python_bin() -> str:
    return sys.executable


def start_sidecar(module_file: Path, extra_env: dict[str, str]) -> None:
    env = os.environ.copy()
    env.update(extra_env)
    proc = subprocess.Popen(
        [python_bin(), str(module_file)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    CHILDREN.append(proc)


def default_data_path() -> Path:
    return Path.home() / "Documents" / "Yggdrasil"


# Mirrors THEMES[].swatch.accent in services/assistant/frontend/src/lib/theme.ts —
# the default accent per theme when the user hasn't picked a custom one.
_DEFAULT_THEME_ACCENTS = {
    "dark": "#4FC3F7",
    "paper": "#000000",
    "tactile": "#C97B4A",
    "observatory": "#1a1a1a",
    "manuscript": "#e8a020",
    "custom": "#4FC3F7",
}
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def resolve_splash_color(vault: Path) -> str:
    """Read the saved theme/logo colour from the vault settings so the splash
    screen (shown before the app server starts) matches the in-app theme instead
    of always using the hardcoded default accent."""
    fallback = "#4FC3F7"
    try:
        settings_path = vault / ".ygg-config" / "settings.json"
        if not settings_path.exists():
            return fallback
        data = json.loads(settings_path.read_text())
        prefs = (data.get("client_prefs") or {})
        theme_id = prefs.get("theme") or "paper"
        accent = _DEFAULT_THEME_ACCENTS.get(theme_id, fallback)
        accents_raw = prefs.get("yggdrasil:theme-accents")
        if accents_raw:
            accents = json.loads(accents_raw)
            saved = accents.get(theme_id)
            if isinstance(saved, str) and _HEX_RE.match(saved):
                accent = saved
        if theme_id == "custom":
            custom_raw = prefs.get("yggdrasil:custom-theme")
            if custom_raw:
                custom = json.loads(custom_raw)
                saved = custom.get("accent")
                if isinstance(saved, str) and _HEX_RE.match(saved):
                    accent = saved
        logo_raw = prefs.get("yggdrasil:logo-colors")
        if logo_raw:
            logo = json.loads(logo_raw)
            if logo.get("mode") == "custom":
                color = logo.get("color")
                if isinstance(color, str) and _HEX_RE.match(color):
                    accent = color
        return accent if _HEX_RE.match(accent) else fallback
    except Exception:
        return fallback


def boot(window) -> None:
    bundle = bundle_dir()
    resources = resources_dir()
    support = support_dir()
    config_path = support / "config.json"
    os.environ["YGG_DESKTOP"] = "1"
    os.environ["YGG_CONFIG_PATH"] = str(config_path)
    sys.path.insert(0, str(resources))
    from data_manifest import (
        APP_VERSION,
        apply_index_version,
        ensure_layout_safe,
        inspect_data_dir,
        migrate_schema,
        prepare_index,
        resolve_data_dir,
        write_manifest,
    )

    saved_path = None
    data_chosen = False
    if config_path.exists():
        try:
            saved_cfg = json.loads(config_path.read_text())
            saved_path = saved_cfg.get("vault_path")
            data_chosen = bool(saved_cfg.get("data_path_chosen"))
        except Exception:
            pass

    # First launch: ask where to keep notes before creating anything
    if not data_chosen:
        _BOOT_STATE["window"] = window
        _BOOT_STATE["event"] = threading.Event()
        default = str(resolve_data_dir(saved_path, default_data_path()))
        try:
            window.evaluate_js(f"showPicker({json.dumps(default)})")
        except Exception:
            pass
        _BOOT_STATE["event"].wait()
        chosen = _BOOT_STATE.get("chosen_path") or default
        vault = Path(chosen).expanduser()
        data_chosen = True
    else:
        vault = resolve_data_dir(saved_path, default_data_path())

    inspected = inspect_data_dir(vault)
    if inspected.get("manifest") and inspected["manifest"].get("vault_path"):
        vault = Path(inspected["manifest"]["vault_path"]).expanduser()
        inspected = inspect_data_dir(vault)
    ensure_layout_safe(vault)
    try:
        window.evaluate_js(f"setAccentColor({json.dumps(resolve_splash_color(vault))})")
    except Exception:
        pass
    legacy_index = support / "lancedb"
    index_dir, _index_note = prepare_index(vault, legacy_index if legacy_index.exists() else None)
    recovered = bool(inspected.get("existingData"))
    previous = str(inspected.get("previousAppVersion") or "")
    try:
        if recovered and inspected.get("manifest"):
            migrated = migrate_schema(vault, inspected["manifest"])
            apply_index_version(vault, migrated)
        write_manifest(vault, {"app_version": APP_VERSION})
        config_path.parent.mkdir(parents=True, exist_ok=True)
        merged_cfg = {}
        if config_path.exists():
            try:
                merged_cfg = json.loads(config_path.read_text())
            except Exception:
                merged_cfg = {}
        merged_cfg["vault_path"] = str(vault)
        merged_cfg["data_path_chosen"] = True
        config_path.write_text(json.dumps(merged_cfg, indent=2))
    except Exception:
        recovered = bool(inspected.get("existingData"))

    def progress(msg: str) -> None:
        # setStatus() also fills one leaf of the splash logo per step.
        try:
            window.evaluate_js(f"setStatus({json.dumps(msg)})")
        except Exception:
            pass

    def progress_done() -> None:
        """Light the last leaf — setStatus() holds it back until setup really finishes."""
        try:
            window.evaluate_js("setProgress(1)")
        except Exception:
            pass

    try:
        load_or_ensure(bundle, progress)
    except Exception as exc:
        # LaTeX/TeX toolchain setup is best-effort — the rest of the app (Dashboard,
        # Notes, Tasks, Search, Graph) does not depend on it. A failure here (e.g. no
        # LaTeX distribution reachable on Windows, where TinyTeX auto-install isn't
        # wired up yet) should degrade the LaTeX Editor, not block the whole app.
        progress(f"LaTeX setup skipped: {exc}")

    os.environ["VAULT_PATH"] = str(vault)
    os.environ["LANCEDB_PATH"] = str(index_dir)
    os.environ["YGG_APP_VERSION"] = APP_VERSION
    os.environ["YGG_EXISTING_DATA"] = "1" if recovered else "0"
    os.environ["YGG_PREVIOUS_VERSION"] = previous
    os.environ["FRONTEND_DIST"] = str(resources / "frontend" / "dist")
    os.environ.setdefault("OLLAMA_URL", "http://127.0.0.1:11434")
    os.environ.setdefault("GATE_CHECK", "true")
    latex_port = free_port()
    os.environ["LATEX_URL"] = f"http://127.0.0.1:{latex_port}"

    latex_py = bundle / "latex" / "latex_service.py"
    if latex_py.exists():
        progress("Starting the LaTeX service…")
        start_sidecar(
            latex_py,
            {
                "VAULT_PATH": str(vault),
                "TEXMFHOME": os.environ.get("TEXMFHOME", ""),
                "PATH": os.environ.get("PATH", ""),
                "LATEX_BIND": "127.0.0.1",
                "LATEX_PORT": str(latex_port),
            },
        )
    port = app_port()
    url = f"http://127.0.0.1:{port}"

    import uvicorn
    from main import app

    thread = threading.Thread(
        target=lambda: uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning"),
        daemon=True,
    )
    thread.start()
    wait_for_server(f"{url}/api/info")
    progress("Opening Yggdrasil…")
    progress_done()
    window.load_url(url)


class DesktopApi:
    def pick_folder(self) -> str:
        import webview

        if not webview.windows:
            return ""
        result = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        if result and result[0]:
            return str(result[0])
        return ""

    def save_file(self, filename: str, b64: str) -> str:
        """Native "Save as…" for downloads. WKWebView/WebView2 ignore <a download>
        for blob URLs, so the frontend hands us the bytes instead.
        Returns the saved path, or "" if the user cancelled."""
        import base64
        import webview

        if not webview.windows:
            return ""
        safe = Path(filename or "download").name or "download"
        dialog = getattr(getattr(webview, "FileDialog", None), "SAVE", None)
        if dialog is None:
            dialog = webview.SAVE_DIALOG
        downloads = Path.home() / "Downloads"
        result = webview.windows[0].create_file_dialog(
            dialog,
            directory=str(downloads if downloads.exists() else Path.home()),
            save_filename=safe,
        )
        if not result:
            return ""
        target = Path(result if isinstance(result, str) else result[0])
        target.write_bytes(base64.b64decode(b64))
        return str(target)

    def confirm_data_path(self, path: str) -> bool:
        cleaned = (path or "").strip()
        if not cleaned:
            raise ValueError("Choose a folder first.")
        _BOOT_STATE["chosen_path"] = cleaned
        ev = _BOOT_STATE.get("event")
        if ev:
            ev.set()
        return True


def main() -> None:
    import atexit
    import webview

    def _stop() -> None:
        for proc in CHILDREN:
            if proc.poll() is None:
                proc.terminate()

    atexit.register(_stop)

    splash = bundle_dir() / "desktop" / "splash.html"
    if not splash.exists():
        splash = Path(__file__).resolve().parent / "splash.html"
    window = webview.create_window(
        "Yggdrasil",
        splash.as_uri() if splash.exists() else "about:blank",
        width=1360,
        height=860,
        min_size=(960, 640),
        js_api=DesktopApi(),
    )
    storage_path = support_dir() / "webview-storage"
    storage_path.mkdir(parents=True, exist_ok=True)
    # private_mode=True is pywebview's default and silently drops cookies/localStorage
    # (theme, API keys, provider settings) on every quit — must disable it explicitly.
    webview.start(boot, window, private_mode=False, storage_path=str(storage_path))


if __name__ == "__main__":
    main()
