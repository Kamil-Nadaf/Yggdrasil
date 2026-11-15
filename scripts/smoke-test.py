#!/usr/bin/env python3
"""
Smoke test for a running Yggdrasil (desktop app or docker).

Read-only by default: GETs every endpoint that needs no parameters, then checks the
LaTeX compile paths and the graph. Nothing in your vault is modified.

  python3 scripts/smoke-test.py                  # auto-detect the running app
  python3 scripts/smoke-test.py http://127.0.0.1:8000
  python3 scripts/smoke-test.py --write          # also rebuild graph edges (derived data only)

Exit code 0 = no failures. Warnings (e.g. "Ollama not running") are not failures.
"""
import base64
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--")]
WRITE = "--write" in sys.argv
results = {"PASS": 0, "WARN": 0, "FAIL": 0}
failures = []


def say(level, name, detail=""):
    results[level] += 1
    mark = {"PASS": "ok  ", "WARN": "warn", "FAIL": "FAIL"}[level]
    print(f"[{mark}] {name}" + (f"  - {detail}" if detail else ""))
    if level == "FAIL":
        failures.append(name)


def call(base, method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        raw, code = e.read(), e.code
    except Exception as e:  # noqa: BLE001
        return None, str(e)
    try:
        return code, json.loads(raw.decode() or "null")
    except Exception:
        return code, raw[:200].decode(errors="replace")


def find_base():
    if args:
        return args[0].rstrip("/")
    ports = []
    try:
        out = subprocess.run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"], capture_output=True, text=True, timeout=15).stdout
        for line in out.splitlines():
            if re.search(r"python|Yggdrasil|uvicorn", line, re.I):
                m = re.search(r":(\d+) \(LISTEN\)", line)
                if m:
                    ports.append(int(m.group(1)))
    except Exception:
        pass
    ports += [8000, 8765, 8080]
    for p in dict.fromkeys(ports):
        code, data = call(f"http://127.0.0.1:{p}", "GET", "/openapi.json", timeout=3)
        if code == 200 and isinstance(data, dict) and "paths" in data:
            return f"http://127.0.0.1:{p}"
    sys.exit("Could not find a running Yggdrasil. Start it, or pass the URL as an argument.")


base = find_base()
print(f"Testing {base}\n")
code, spec = call(base, "GET", "/openapi.json")
if code != 200:
    sys.exit(f"openapi.json returned {code}")

# 1. Every GET endpoint with no path parameters ---------------------------------------
SKIP = ("/openapi", "/docs", "/redoc", "/api/updates/apply", "/api/export", "/download", "/api/open", "/api/reveal")
gets = [p for p, ops in spec["paths"].items() if "get" in ops and "{" not in p and not p.startswith(SKIP)]
print(f"--- {len(gets)} read-only GET endpoints ---")
for path in sorted(gets):
    code, data = call(base, "GET", path, timeout=30)
    if code is None:
        say("FAIL", f"GET {path}", f"no response: {data}")
    elif code in (502, 504) and "update" in path:
        say("WARN", f"GET {path}", "external service unreachable (offline or rate-limited)")
    elif code >= 500:
        say("FAIL", f"GET {path}", f"HTTP {code}: {str(data)[:120]}")
    elif code in (422,):
        say("WARN", f"GET {path}", "needs query parameters (not tested)")
    elif code >= 400:
        say("WARN", f"GET {path}", f"HTTP {code}")
    else:
        say("PASS", f"GET {path}")

# 2. Feature checks ---------------------------------------------------------------------
print("\n--- Graph ---")
code, g = call(base, "GET", "/api/graph")
if code == 200 and isinstance(g, dict) and "nodes" in g:
    say("PASS", "graph loads", f"{len(g['nodes'])} nodes, {len(g['edges'])} edges")
else:
    say("FAIL", "graph loads", f"HTTP {code}")
code, g = call(base, "GET", "/api/graph/suggested")
if code == 200:
    warn = g.get("warning") if isinstance(g, dict) else None
    say("WARN" if warn else "PASS", "graph suggested (needs the notes index)", warn or f"{len(g.get('edges', []))} edges")
else:
    say("FAIL", "graph suggested", f"HTTP {code}")
if WRITE:
    code, g = call(base, "POST", "/api/graph/rebuild", {}, timeout=300)
    ok = code == 200 and isinstance(g, dict) and g.get("ok") is not False
    say("PASS" if ok else "FAIL", "graph rebuild (writes the local edge store)", str(g)[:100])
    code, g2 = call(base, "GET", "/api/graph")
    say("PASS" if code == 200 else "FAIL", "graph still loads after rebuild")
else:
    say("WARN", "graph rebuild skipped", "run with --write to test the edge store")

print("\n--- LaTeX ---")
simple = r"\documentclass{article}\usepackage{amsmath}\begin{document}Hello $E=mc^2$.\end{document}"
bib = r"\documentclass{article}\usepackage[style=numeric]{biblatex}\begin{document}Hi\end{document}"
bad = r"\documentclass{article}\begin{document}\undefinedcommand\end{document}"
code, r = call(base, "POST", "/api/latex/compile", {"source": simple, "filename": "smoke-simple"}, timeout=140)
if code == 200 and isinstance(r, dict) and r.get("pdf_b64"):
    pdf = base64.b64decode(r["pdf_b64"])[:4]
    say("PASS" if pdf == b"%PDF" else "FAIL", "compile simple document", f"engine={r.get('engine', '?')}")
else:
    say("FAIL", "compile simple document", f"HTTP {code}: {str(r)[:150]}")
code, r = call(base, "POST", "/api/latex/compile", {"source": bib, "filename": "smoke-biblatex"}, timeout=140)
if code == 200 and isinstance(r, dict):
    eng = r.get("engine", "?")
    say("PASS" if eng != "tectonic" else "FAIL", "biblatex document uses full TeX (not Tectonic)", f"engine={eng}")
else:
    say("WARN", "biblatex document", f"HTTP {code} (biber/biblatex may be missing in TinyTeX)")
code, r = call(base, "POST", "/api/latex/compile", {"source": bad, "filename": "smoke-error"}, timeout=140)
if code and code >= 400 and isinstance(r, dict) and r.get("diagnostics"):
    d = r["diagnostics"][0]
    say("PASS", "compile error is reported with diagnostics", f"line={d.get('line')} {str(d.get('message'))[:50]}")
else:
    say("FAIL", "compile error is reported with diagnostics", f"HTTP {code}: {str(r)[:120]}")

print("\n--- Semantic search (needs Ollama / LM Studio embeddings) ---")
code, r = call(base, "POST", "/api/locate", {"query": "gamma-ray burst", "limit": 3}, timeout=60)
if code == 200:
    say("WARN" if (isinstance(r, dict) and r.get("warning")) else "PASS", "locate", (r or {}).get("warning", "ok") if isinstance(r, dict) else "")
elif code and 400 <= code < 600:
    say("WARN", "locate", f"HTTP {code} (expected when no embedding server is running)")
else:
    say("FAIL", "locate", str(r)[:100])

print(f"\nSummary: {results['PASS']} passed, {results['WARN']} warnings, {results['FAIL']} FAILED")
if failures:
    print("Failed:", *failures, sep="\n  - ")
sys.exit(1 if failures else 0)
