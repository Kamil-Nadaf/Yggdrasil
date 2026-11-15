"""LaTeX helpers that live in the assistant (not the latex container) so they also reach in-app updates:

* ``parse_log``          – turn a TeX/latexmk log into structured diagnostics (file, line, message, context, hint)
* ``check_environments`` – source-level \\begin/\\end pairing check that points at the REAL cause of cascading errors
* ``VersionStore``       – per-file snapshot history (the "History" sidebar): save, list, read, delete
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path

MAX_LINE = 79  # TeX wraps its log at 79 columns (max_print_line)

_FILE_EXT = r"(?:tex|sty|cls|bib|bbl|aux|def|cfg|ltx|fd|clo|ldf|cnf|lbl|toc|out|lof|lot|map|enc|ist|bst|png|jpe?g|pdf|eps|svg|mps)"
_OPEN_FILE = re.compile(r"\((\.{0,2}/[^\s()]*|[A-Za-z0-9_][^\s()]*\." + _FILE_EXT + r")(?=[\s)]|$)", re.IGNORECASE)
_LNUM = re.compile(r"^l\.(\d+)\s?(.*)$")
_INPUT_LINE = re.compile(r"on input line (\d+)")

HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"File [`']([^`']+)['`'] not found", re.I),
     "'{0}' is not installed. The app tries to install missing TeX packages automatically on each compile; if it "
     "still fails, the TeX distribution could not download it (offline / blocked?). Remove the \\usepackage line, "
     "or upload {0} next to your main file."),
    (re.compile(r"Undefined control sequence", re.I),
     "A command is misspelled or its package is not loaded. Check the highlighted command and the \\usepackage list."),
    (re.compile(r"ended by \\end\{|\\begin\{[^}]+\} on input line \d+ ended by", re.I),
     "Environments are closed in the wrong order: look ABOVE this line for a \\begin{...} that has no matching \\end{...}."),
    (re.compile(r"Extra \\endgroup|Too many \}'s|Extra \}, or forgotten", re.I),
     "A brace or environment was closed twice, or opened once too few times. Check the lines just above for unbalanced { } or \\begin/\\end."),
    (re.compile(r"Missing \$ inserted", re.I),
     "A math symbol (_ ^ \\alpha ...) is used outside math mode. Wrap it in $...$ or escape it (\\_)."),
    (re.compile(r"Runaway argument|File ended while scanning|Paragraph ended before", re.I),
     "A { was opened and never closed (or a blank line appeared inside a command argument). Look above the reported line."),
    (re.compile(r"Package inputenc Error|Unicode (?:character|char)", re.I),
     "A special character is not supported by this engine. Use \\usepackage[utf8]{inputenc} with pdfLaTeX, or switch to XeLaTeX/LuaLaTeX."),
    (re.compile(r"Option clash for package ([^\s.]+)", re.I),
     "Package {0} is loaded twice with different options. Load it once, or pass the options with \\PassOptionsToPackage."),
    (re.compile(r"Environment ([^\s]+) undefined", re.I),
     "The environment {0} comes from a package that is not loaded (or is misspelled)."),
    (re.compile(r"There's no line here to end|Misplaced alignment tab|Misplaced \\noalign", re.I),
     "Check table/align rows: every row needs the right number of & and a closing \\\\."),
]


def _hint_for(message: str) -> str:
    for rx, text in HINTS:
        m = rx.search(message)
        if m and text:
            for n, g in enumerate(m.groups()):
                text = text.replace("{%d}" % n, g or "")
            return text
    return ""


def unwrap(log: str) -> list[str]:
    """Undo TeX's hard wrap at 79 columns so file names and messages are not cut in two."""
    out: list[str] = []
    carry = ""
    for raw in log.splitlines():
        line = carry + raw.rstrip("\r")
        carry = ""
        if len(raw.rstrip("\r")) == MAX_LINE:
            carry = line
            continue
        out.append(line)
    if carry:
        out.append(carry)
    return out


def _norm_file(name: str) -> str:
    name = name.strip()
    while name.startswith("./"):
        name = name[2:]
    return name


def parse_log(log: str, main_file: str = "main.tex") -> list[dict]:
    """Return diagnostics: {kind: error|warning|typesetting, message, file, line, context, hint, source}."""
    lines = unwrap(log or "")
    stack: list[str | None] = []  # file names; None marks a non-file parenthesis
    current = main_file
    out: list[dict] = []
    seen: set[tuple] = set()

    def cur() -> str:
        for item in reversed(stack):
            if item:
                return item
        return main_file

    def add(kind: str, message: str, line: int | None, file: str, context: str = "") -> None:
        message = re.sub(r"\s+", " ", message).strip()
        key = (kind, message, line, file)
        if key in seen or not message:
            return
        seen.add(key)
        d = {"kind": kind, "message": message, "file": file or main_file, "line": line, "context": context.strip(), "source": "log"}
        if kind == "error":
            d["hint"] = _hint_for(message)
        out.append(d)

    def track_parens(text: str) -> None:
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "(":
                m = _OPEN_FILE.match(text, i)
                if m:
                    stack.append(_norm_file(m.group(1)))
                    i = m.end()
                    continue
                stack.append(None)
            elif ch == ")":
                if stack:
                    stack.pop()
            i += 1

    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()

        # ── errors ──────────────────────────────────────────────────────────
        if line.startswith("!"):
            msg = line.lstrip("!").strip()
            if msg.startswith("==> Fatal error") or msg.startswith("Emergency stop") and any(d["kind"] == "error" for d in out):
                i += 1
                continue
            lnum, ctx = None, ""
            for j in range(i + 1, min(i + 14, len(lines))):
                m = _LNUM.match(lines[j])
                if m:
                    lnum = int(m.group(1))
                    ctx = m.group(2)
                    if j + 1 < len(lines) and lines[j + 1].startswith(" ") and lines[j + 1].strip():
                        ctx = (ctx + " ⏎ " + lines[j + 1].strip()).strip()
                    break
                if lines[j].startswith("!"):
                    break
            add("error", msg, lnum, cur(), ctx)
            i += 1
            continue

        # ── warnings ────────────────────────────────────────────────────────
        m = re.match(r"^(LaTeX Font|LaTeX|Package \S+|Class \S+) Warning: (.*)$", line)
        if m:
            text = m.group(2)
            j = i + 1
            while j < len(lines):
                cont = re.match(r"^\((\S+)\)\s+(.*)$", lines[j])
                if cont:
                    text += " " + cont.group(2)
                    j += 1
                else:
                    break
            ln = _INPUT_LINE.search(text)
            add("warning", f"{m.group(1)}: " + _INPUT_LINE.sub("", text).rstrip(" ."), int(ln.group(1)) if ln else None, cur())
            i = j
            continue
        m = re.match(r"^(Overfull|Underfull) \\[hv]box (.*)$", line)
        if m:
            at = re.search(r"at lines? (\d+)", line) or re.search(r"at lines? (\d+)", lines[i + 1] if i + 1 < len(lines) else "")
            add("typesetting", line.strip(), int(at.group(1)) if at else None, cur())
            i += 1
            continue
        m = re.match(r"^Missing character: (.*)$", line)
        if m:
            add("warning", "Missing character: " + m.group(1), None, cur())
            i += 1
            continue

        # ── file stack bookkeeping (skip message lines so their parentheses do not confuse it) ──
        if not (s.startswith(("!", "l.", "LaTeX", "Package", "Class", "Overfull", "Underfull", "Missing", "Latexmk", "Rule", "Run number", "Collected error", "-----"))):
            track_parens(line)
        i += 1
    return out


# ── source-level environment pairing ───────────────────────────────────────────

_RAW_ENVS = {"verbatim", "lstlisting", "minted", "comment", "Verbatim", "alltt"}
_BEGIN_END = re.compile(r"\\(begin|end)\s*\{([^}]*)\}")


def _strip_comment(line: str) -> str:
    out = []
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == "\\":
            out.append(line[i : i + 2])
            i += 2
            continue
        if ch == "%":
            break
        out.append(ch)
        i += 1
    return "".join(out)


def check_environments(source: str, file: str = "") -> list[dict]:
    """Find mismatched/unclosed \\begin..\\end pairs and report the line where the problem really starts."""
    stack: list[tuple[str, int]] = []
    problems: list[dict] = []
    raw: str | None = None
    for no, line in enumerate((source or "").splitlines(), start=1):
        text = line if raw else _strip_comment(line)
        for m in _BEGIN_END.finditer(text):
            kind, name = m.group(1), m.group(2).strip()
            if raw:
                if kind == "end" and name == raw:
                    raw = None
                    if stack:
                        stack.pop()
                continue
            if kind == "begin":
                if name in _RAW_ENVS:
                    raw = name
                stack.append((name, no))
                continue
            if raw is None and stack and stack[-1][0] == name:
                stack.pop()
                continue
            # \end{X} that does not match the innermost open environment
            if any(n == name for n, _ in stack):
                while stack and stack[-1][0] != name:
                    n, ln = stack.pop()
                    problems.append({"kind": "error", "message": f"\\begin{{{n}}} (line {ln}) is never closed — it is still open at \\end{{{name}}} on line {no}", "line": ln, "context": f"\\begin{{{n}}}"})
                if stack:
                    stack.pop()
            else:
                problems.append({"kind": "error", "message": f"\\end{{{name}}} has no matching \\begin{{{name}}}", "line": no, "context": f"\\end{{{name}}}"})
    for n, ln in stack:
        if n == "document":
            continue
        problems.append({"kind": "error", "message": f"\\begin{{{n}}} is never closed (missing \\end{{{n}}})", "line": ln, "context": f"\\begin{{{n}}}"})
    for p in problems:
        p.update({"file": file, "source": "check", "hint": "Found by scanning your \\begin/\\end pairs — this is usually the true origin of cascading LaTeX errors further down."})
    return problems


_MISSING_FILE = re.compile(r"File [`'\"]?([^`'\"\s]+?)[`'\"]? not found")


def _locate_missing_files(items: list[dict], source: str, main_file: str) -> None:
    """LaTeX gives no line for a missing package/file (it stops at the prompt), so find the
    \\usepackage / \\input / \\includegraphics line that names it in the main file."""
    lines = source.split("\n")
    for d in items:
        if d.get("kind") != "error" or d.get("line"):
            continue
        m = _MISSING_FILE.search(d.get("message", ""))
        if not m:
            continue
        name = re.sub(r"\.(sty|cls|tex|bib|bst|png|jpg|jpeg|pdf|eps)$", "", m.group(1))
        pat = re.compile(r"(?<![A-Za-z0-9_-])" + re.escape(name) + r"(?![A-Za-z0-9_-])")
        for i, ln in enumerate(lines, 1):
            code = re.split(r"(?<!\\)%", ln, 1)[0]
            if pat.search(code) and re.search(r"\\(usepackage|RequirePackage|documentclass|input|include|includegraphics|bibliography|addbibresource|usetikzlibrary)", code):
                d["line"] = i
                d["file"] = main_file
                d["context"] = ln.strip()[:200]
                break


def diagnostics(log: str, source: str, main_file: str) -> list[dict]:
    """Log diagnostics + environment check (on the main file only), errors first, ordered by line."""
    out = parse_log(log, main_file)
    _locate_missing_files(out, source, main_file)
    for p in check_environments(source, main_file):
        # don't repeat an identical position the log already reports
        out.append(p)
    order = {"error": 0, "warning": 1, "typesetting": 2}
    out.sort(key=lambda d: (order.get(d["kind"], 3), d.get("file") != main_file, d.get("line") or 10**9))
    return out


# ── version history ───────────────────────────────────────────────────────────

class VersionStore:
    """Snapshots of a LaTeX file, one JSON per version under <vault>/.ygg-config/latex-history/<file key>/."""

    KEEP = 300

    def __init__(self, vault: Path):
        self.root = Path(vault) / ".ygg-config" / "latex-history"

    def _dir(self, filename: str) -> Path:
        stem = re.sub(r"\.tex$", "", filename.strip().strip("/"))
        if not stem or ".." in stem.split("/"):
            raise ValueError("bad filename")
        key = re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:60] + "-" + hashlib.sha1(stem.encode()).hexdigest()[:8]
        return self.root / key

    def save(self, filename: str, source: str, label: str = "", force: bool = False) -> dict:
        d = self._dir(filename)
        d.mkdir(parents=True, exist_ok=True)
        versions = self._load_all(d)
        if versions and versions[-1]["source"] == source and not (force and label):
            return {"created": False, "id": versions[-1]["id"]}
        vid = f"{int(time.time() * 1000)}"
        while (d / f"{vid}.json").exists():
            vid = str(int(vid) + 1)
        (d / f"{vid}.json").write_text(json.dumps({"id": vid, "ts": int(vid) / 1000, "label": label.strip()[:120], "source": source}), encoding="utf-8")
        self._prune(d)
        return {"created": True, "id": vid}

    def _load_all(self, d: Path) -> list[dict]:
        out = []
        for p in sorted(d.glob("*.json")):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except Exception:
                continue
        return out

    def _prune(self, d: Path) -> None:
        files = sorted(d.glob("*.json"))
        extra = len(files) - self.KEEP
        for p in files:
            if extra <= 0:
                break
            try:
                if not json.loads(p.read_text(encoding="utf-8")).get("label"):
                    p.unlink()
                    extra -= 1
            except Exception:
                continue

    def list(self, filename: str) -> list[dict]:
        d = self._dir(filename)
        if not d.exists():
            return []
        rows = []
        for v in self._load_all(d):
            src = v.get("source", "")
            rows.append({"id": v["id"], "ts": v.get("ts", 0), "label": v.get("label", ""), "lines": src.count("\n") + (1 if src else 0), "bytes": len(src.encode("utf-8"))})
        return list(reversed(rows))  # newest first

    def get(self, filename: str, vid: str) -> dict | None:
        if not re.fullmatch(r"\d{10,16}", vid):
            return None
        p = self._dir(filename) / f"{vid}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None

    def delete(self, filename: str, vid: str) -> bool:
        if not re.fullmatch(r"\d{10,16}", vid):
            return False
        p = self._dir(filename) / f"{vid}.json"
        if p.exists():
            p.unlink()
            return True
        return False
