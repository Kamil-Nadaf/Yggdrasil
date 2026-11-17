#!/usr/bin/env python3
"""Fail the build when a packaged backend can't import one of its own modules.

usage: check-packaged-app.py <packaged-app-dir>

Installers once shipped main.py without tools.py (a hand-kept copy list), and the installed app died on start
with "No module named 'tools'". This reads every packaged .py file, and for each import that names a module
of services/assistant/ checks the module was packaged too (a package folder counts as well).
"""
import ast
import sys
from pathlib import Path

src = Path(__file__).resolve().parent.parent / "services" / "assistant"
dst = Path(sys.argv[1])
if not (dst / "main.py").is_file():
    sys.exit(f"{dst} has no main.py - nothing was packaged")

first_party = {p.stem for p in src.glob("*.py") if not p.name.startswith("test_")}
first_party |= {p.name for p in src.iterdir() if p.is_dir() and (p / "__init__.py").exists()}
have = {p.stem for p in dst.glob("*.py")} | {p.name for p in dst.iterdir() if p.is_dir()}

missing: dict[str, set[str]] = {}
for f in sorted(dst.glob("*.py")):
    for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module.split(".")[0]]
        elif isinstance(node, ast.Import):
            names = [a.name.split(".")[0] for a in node.names]
        else:
            continue
        for name in names:
            if name in first_party and name not in have:
                missing.setdefault(name, set()).add(f.name)

if missing:
    for name, users in sorted(missing.items()):
        print(f"MISSING from the package: {name} (imported by {', '.join(sorted(users))})", file=sys.stderr)
    sys.exit(1)
print(f"packaged app OK: {len(have)} modules, every first-party import is present")
