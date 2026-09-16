# Yggdrasil desktop packs (no Docker)

Same app for Mac, Windows, and Linux. Colleagues double-click; no Docker required.

## What they get

| Platform | Build command (on that OS) | Deliverable |
|---|---|---|
| macOS | `bash packaging/build-macos-app.sh` | `release/Yggdrasil.app` + `release/Yggdrasil-*-mac.dmg` |
| Linux | `bash packaging/build-linux.sh` | `release/Yggdrasil-*-linux.tar.gz` |
| Windows | `powershell -File packaging/build-windows.ps1` | `release/Yggdrasil-*-windows.zip` |

## First launch

1. Splash / setup (TinyTeX once if needed)
2. **Choose folder** for notes (vault) — required once
3. App window opens

AI keys stay in the app’s local storage. Ollama is optional — LM Studio / Claude / DeepSeek work from Settings.

**Known v0 limitation:** TinyTeX auto-installs on first launch on Mac and Linux only.
On Windows, install a LaTeX distribution yourself (e.g. [MiKTeX](https://miktex.org/download))
and make sure `pdflatex`/`latexmk` are on PATH before opening the app — everything
else (Dashboard, Notes, Tasks, Search, Graph, Daily ArXiv) works regardless.

## Build requirements

- Node 20+ (frontend build)
- [`uv`](https://docs.astral.sh/uv/) — all three build scripts use it to pin the bundled
  Python to 3.12, since `pyarrow`/`lancedb`'s pinned versions don't ship prebuilt wheels
  for newer Python. Install: `curl -LsSf https://astral.sh/uv/install.sh | sh` (Mac/Linux)
  or `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"` (Windows).
- Network for first `uv pip install` + optional TinyTeX download on first run

Cross-compiling from one OS to another is not supported — run each script on its target platform (or CI runners). The Windows script also runs under `pwsh` on macOS/Linux as a local sanity check of file assembly (it says so and stops short of a real Windows build), which is how the path-handling and Python-pinning bugs above were caught before ever touching a Windows machine.
