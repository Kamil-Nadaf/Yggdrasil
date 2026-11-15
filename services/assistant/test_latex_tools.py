import latex_tools as lt

LOG = r"""(./main.tex
LaTeX2e <2023-11-01> patch level 1
(/usr/share/texlive/texmf-dist/tex/latex/base/article.cls
Document Class: article 2023/05/17 v1.4n Standard LaTeX document class
(/usr/share/texlive/texmf-dist/tex/latex/base/size11.clo))
(./chapters/intro.tex
Overfull \hbox (12.0pt too wide) in paragraph at lines 7--9
[]\OT1/cmr/m/n/10 text
! Undefined control sequence.
l.12 \foo
         bar
? 
)
LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 30.
Package hyperref Warning: Token not allowed in a PDF string (PDFDocEncoding):
(hyperref)                removing `math shift' on input line 41.
! LaTeX Error: \begin{document} ended by \end{itemize}.

See the LaTeX manual or LaTeX Companion for explanation.
l.204 \end{itemize}

! Extra \endgroup.
l.204 \end{itemize}
! ==> Fatal error occurred, no output PDF file produced!
"""


def test_parse_log_points_at_files_and_lines():
    d = lt.parse_log(LOG, "main.tex")
    errs = [x for x in d if x["kind"] == "error"]
    assert errs[0]["message"] == "Undefined control sequence."
    assert (errs[0]["file"], errs[0]["line"]) == ("chapters/intro.tex", 12)
    assert errs[0]["context"].startswith("\\foo")
    env = errs[1]
    assert env["file"] == "main.tex" and env["line"] == 204 and "\\end{itemize}" in env["message"]
    assert "above" in env["hint"].lower()
    assert not any("Fatal error" in e["message"] for e in errs)


def test_parse_log_warnings():
    d = lt.parse_log(LOG, "main.tex")
    w = [x for x in d if x["kind"] == "warning"]
    assert any("undefined" in x["message"] and x["line"] == 30 for x in w)
    assert any("hyperref" in x["message"] and x["line"] == 41 for x in w)
    t = [x for x in d if x["kind"] == "typesetting"]
    assert t and t[0]["line"] == 7 and t[0]["file"] == "chapters/intro.tex"


def test_missing_package_hint():
    d = lt.parse_log("! LaTeX Error: File `foo.sty' not found.\n\nType X to quit\nl.3 \\usepackage{foo}\n", "m.tex")
    assert d[0]["line"] == 3 and "foo.sty" in d[0]["hint"]


def test_wrapped_lines_are_joined():
    long = "(./chapters/" + "a" * 60 + ".tex"
    assert len(long) < 79
    pad = long + "x" * (79 - len(long))
    out = lt.unwrap(pad + "\ntail")
    assert out == [pad + "tail"]


def test_environment_check_finds_true_origin():
    src = "\\begin{document}\n\\begin{itemize}\n\\item a\n% \\end{itemize}\n\\end{document}\n"
    p = lt.check_environments(src, "main.tex")
    assert p and p[0]["line"] == 2 and "itemize" in p[0]["message"]
    ok = "\\begin{document}\n\\begin{itemize}\n\\item a\n\\end{itemize}\n\\end{document}\n"
    assert lt.check_environments(ok) == []
    stray = "\\end{figure}\n"
    assert lt.check_environments(stray)[0]["line"] == 1


def test_environment_check_skips_verbatim():
    src = "\\begin{verbatim}\n\\begin{itemize}\n\\end{verbatim}\n"
    assert lt.check_environments(src) == []


def test_version_store(tmp_path):
    vs = lt.VersionStore(tmp_path)
    a = vs.save("Paper/main", "one")
    assert a["created"]
    assert not vs.save("Paper/main", "one")["created"]
    b = vs.save("Paper/main.tex", "two", label="draft 2")
    rows = vs.list("Paper/main")
    assert [r["id"] for r in rows] == [b["id"], a["id"]] and rows[0]["label"] == "draft 2"
    assert vs.get("Paper/main", a["id"])["source"] == "one"
    assert vs.get("Paper/main", "../../etc") is None
    assert vs.delete("Paper/main", a["id"]) and len(vs.list("Paper/main")) == 1


def test_missing_package_gets_line():
    log = "! LaTeX Error: File `nonexistentpkg.sty' not found.\n\nType X to quit or <RETURN> to proceed,\nor enter new name. (Default extension: sty)\n\nEnter file name: \n! Emergency stop.\n<read *> \n         \nl.3 \\begin\n          {document}\n"
    src = "\\documentclass{article}\n\\usepackage{amsmath,nonexistentpkg}\n\\begin{document}\n\\end{document}\n"
    ds = lt.diagnostics(log, src, "a.tex")
    miss = [d for d in ds if "not found" in d["message"]][0]
    assert miss["line"] == 2 and miss["file"] == "a.tex"
