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

## Build requirements

- Node 20+ (frontend build)
- Python 3.12+
- Network for first pip install + optional TinyTeX download on first run

Cross-compiling from one OS to another is not supported — run each script on its target platform (or CI runners).
