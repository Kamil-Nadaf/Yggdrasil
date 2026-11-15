#!/usr/bin/env python3
"""Compile a document through the running app and print the engine, errors and the end of the log.

  python3 scripts/latex-debug.py                 # built-in biblatex test document
  python3 scripts/latex-debug.py my.tex          # your own file
  python3 scripts/latex-debug.py my.tex http://127.0.0.1:47285
"""
import json, sys, urllib.error, urllib.request

DEFAULT = r"\documentclass{article}\usepackage[style=numeric]{biblatex}\begin{document}Hi\end{document}"
src = open(sys.argv[1]).read() if len(sys.argv) > 1 else DEFAULT
base = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:47285"
req = urllib.request.Request(base + "/api/latex/compile", data=json.dumps({"source": src, "filename": "debug-compile"}).encode(),
                             headers={"Content-Type": "application/json"})
try:
    d = json.load(urllib.request.urlopen(req, timeout=300)); code = 200
except urllib.error.HTTPError as e:
    d = json.load(e); code = e.code
print("HTTP", code, "| engine:", d.get("engine", "(not reported: old build running?)"))
print("errors:", d.get("errors"))
print("\n".join((d.get("log") or "").splitlines()[-40:]))
