# Yggdrasil Phase 0 baseline (partial)

Branch `perf/tauri-shell`, from `main` @ a7dbca5 (v0.4.35). No code changed.
Static numbers come from `release/Yggdrasil-20261114-mac-arm64`. Runtime numbers still need to be taken on the Mac (this tool's shell is a Linux aarch64 VM).

## Installer / app size (macOS arm64)
| Item | Size |
|---|---|
| Yggdrasil.app installed | 525 MB |
| .dmg 20261114 | 304.5 MB (250.1 MB on 11-04, 251.6 MB on 11-05) |
| .pkg 20261114 | 206.6 MB (159.0 MB on 11-04) |
| Resources/python | 463 MB (88% of app) |
| Resources/app | 58 MB (slides 48, frontend 8.7) |
| Resources/latex | 0.5 MB (TeX itself is not bundled; needs Docker) |

## Python site-packages (largest)
lancedb 134 MB, pyarrow 99, numpy 34, PyObjCTest 16 (test files), pip 13, cryptography 12, objc 11, tokenizers 9.6, huggingface_hub 7.3, hf_xet 7.2, lance_namespace client 5.4, pydantic_core 4.7, uvloop 4.3, pydantic 4.1, anthropic 3.3, setuptools 2.9, fsspec 2.0.
- lancedb + pyarrow + numpy = ~267 MB (58% of bundled Python).
- Removable now: PyObjCTest + pip + setuptools = ~32 MB.
- tokenizers/huggingface_hub/hf_xet/fsspec/tqdm (~26 MB) are probably pulled in by `anthropic`; verify in Phase 1.

## Code facts
- `main.py`: 5699 lines; `import lancedb` / `import pyarrow` at top level (lines 81-82), so both load at startup. `graph_links.py` also imports them.
- lancedb is used for note embeddings (`open_table("notes")`, about 6 `.search()` call sites).

## Runtime (Linux aarch64 VM, indicative only, not the Mac)
| Test | Result |
|---|---|
| Read all 259 .md files in `data/` (310 KB) | 129 ms (plain Python, cold) |

Vault scan is not a hotspot at this vault size. A Rust rewrite would not pay off here.

## Still to measure on the Mac
Cold start to first paint, idle RAM, search latency, PDF import time, LaTeX compile cold/warm (the Linux VM compile of `motivation-letter.tex` failed, so no number).

## Top 3 hotspots so far
1. lancedb + pyarrow + numpy: 267 MB and loaded at startup.
2. Transitive HF stack (~26 MB) plus junk (~32 MB).
3. Slides (48 MB) and the Docker dependency for LaTeX.

## Phase 1 result (macOS arm64, measured 2026-11-15, same machine)
| | Before (20261114) | After (20261115) |
|---|---|---|
| Yggdrasil.app | 525 MB | 247 MB |
| .dmg | 304.5 MB | 170 MB |
| .pkg | 206.6 MB | 105 MB |

Changes: lancedb + pyarrow replaced by `vecstore.py` (SQLite + numpy); PyObjCTest, pip, setuptools pruned; lancedb no longer imported at startup.
Tests (Python 3.12): 232 pass; 2 fail for reasons unrelated to these changes (`test_books` graph test fails on the original code too; `test_output_compiles` needs `cm-super` in TinyTeX).

## LaTeX spike (macOS arm64)
See `docs/latex-spike-results.md`. Warm Tectonic 0.2-0.8 s (same as latexmk); cold 4-80 s, so the app warms the package cache in the background.
