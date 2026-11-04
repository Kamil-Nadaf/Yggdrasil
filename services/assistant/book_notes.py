"""Reading notes for books: clean selected text, render it as LaTeX / Markdown.

Notes live in ``15-Books/{slug}/notes.json`` as ``{"notes": [{id, text, page, comment, created, loc}]}``.
"""
from __future__ import annotations

import re
from typing import Any, Optional

_LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st", "\u00ad": "", "\u200b": "", "\ufeff": ""}
_MATH = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta", "ε": r"\epsilon", "ϵ": r"\epsilon", "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta",
    "ι": r"\iota", "κ": r"\kappa", "λ": r"\lambda", "μ": r"\mu", "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ρ": r"\rho", "σ": r"\sigma", "τ": r"\tau",
    "υ": r"\upsilon", "φ": r"\phi", "ϕ": r"\phi", "χ": r"\chi", "ψ": r"\psi", "ω": r"\omega", "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta",
    "Λ": r"\Lambda", "Ξ": r"\Xi", "Π": r"\Pi", "Σ": r"\Sigma", "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega", "×": r"\times", "±": r"\pm", "∓": r"\mp",
    "≈": r"\approx", "≃": r"\simeq", "∼": r"\sim", "≤": r"\leq", "≥": r"\geq", "≠": r"\neq", "∝": r"\propto", "∞": r"\infty", "∂": r"\partial",
    "∇": r"\nabla", "∫": r"\int", "∑": r"\sum", "∏": r"\prod", "√": r"\sqrt{}", "→": r"\rightarrow", "←": r"\leftarrow", "⇒": r"\Rightarrow",
    "∈": r"\in", "∼": r"\sim", "·": r"\cdot", "⊙": r"\odot", "°": r"^{\circ}", "ℏ": r"\hbar", "−": "-",
}
_SIMPLE = {"‘": "`", "’": "'", "“": "``", "”": "''", "–": "--", "—": "---", "…": r"\ldots{}", "\u00a0": "~", "•": r"\textbullet{}", "′": "'", "″": "''"}
_ESC = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}


def clean_text(text: str) -> str:
    """Selected PDF text → one tidy paragraph (joins words hyphenated across lines, collapses whitespace)."""
    t = text or ""
    for a, b in _LIGATURES.items():
        t = t.replace(a, b)
    t = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", t)
    return re.sub(r"\s+", " ", t).strip()


def latex_escape(text: str) -> str:
    out: list[str] = []
    for ch in text:
        if ch in _ESC:
            out.append(_ESC[ch])
        elif ch in _MATH:
            out.append(f"${_MATH[ch]}$")
        elif ch in _SIMPLE:
            out.append(_SIMPLE[ch])
        elif ord(ch) > 0x2fff or (0xd800 <= ord(ch) < 0xe000):
            continue  # symbols pdflatex cannot typeset (emoji, CJK) are dropped rather than breaking the build
        else:
            out.append(ch)
    s = "".join(out)
    return re.sub(r"\$\s*\$", "", s.replace("$$", "$ $"))


def _page(n: Any) -> Optional[int]:
    try:
        v = int(n)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def build_latex(item: dict[str, Any], notes: list[dict[str, Any]], citekey: str = "", pages: bool = True, heading: bool = True, comments: bool = True) -> str:
    title = (item.get("title") or "Untitled").strip()
    authors = ", ".join(item.get("authors") or [])
    lines = [f"% Reading notes — {title}" + (f" ({authors}{', ' if authors and item.get('year') else ''}{item.get('year') or ''})" if authors or item.get("year") else "")]
    if heading:
        lines += [f"\\section*{{Notes on \\emph{{{latex_escape(title)}}}}}", ""]
    ordered = sorted((n for n in notes if clean_text(n.get("text", ""))), key=lambda n: (_page(n.get("page")) or 10**9, str(n.get("created") or "")))
    for n in ordered:
        text = latex_escape(clean_text(n["text"]))
        pg = _page(n.get("page"))
        cite = ""
        if citekey:
            cite = f"\\cite[p.~{pg}]{{{citekey}}}" if pages and pg else f"\\cite{{{citekey}}}"
        elif pages and pg:
            cite = f" \\hfill{{\\small(p.~{pg})}}"
        lines += ["\\begin{quote}", f"{text}{cite}", "\\end{quote}"]
        comment = clean_text(n.get("comment", "")) if comments else ""
        if comment:
            lines += ["", latex_escape(comment)]
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def build_markdown(item: dict[str, Any], notes: list[dict[str, Any]]) -> str:
    out = [f"# Notes on {item.get('title') or 'Untitled'}", ""]
    for n in sorted((n for n in notes if clean_text(n.get("text", ""))), key=lambda n: (_page(n.get("page")) or 10**9, str(n.get("created") or ""))):
        pg = _page(n.get("page"))
        out.append(f"> {clean_text(n['text'])}" + (f" — p. {pg}" if pg else ""))
        if clean_text(n.get("comment", "")):
            out += ["", clean_text(n["comment"])]
        out.append("")
    return "\n".join(out).rstrip() + "\n"
