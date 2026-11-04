import shutil, subprocess, sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parent))
import book_notes as bn

ITEM = {"title": "Gamma-Ray Bursts & the 100% Sky_Survey", "authors": ["Ann Lee"], "year": 2020}
NOTES = [
    {"id": "2", "text": "The ﬁt gives α ≈ −1.1 and E_peak ≥ 300 keV (see Fig. 3);\nhyphen-\nated words stay joined. 50% of {all} bursts #1 cost $5 ~ x^2 \\ done", "page": 12, "comment": "Check this & compare", "created": "2"},
    {"id": "1", "text": "Early note ‘quoted’ — fine…", "page": 3, "created": "1"},
    {"id": "3", "text": "   ", "page": 1},
]


def test_clean_and_escape():
    assert bn.clean_text("exam-\nple  of\n text ﬁnal") == "example of text final"
    e = bn.latex_escape("a_b & 100% {x} #1 $5 ~ ^ \\")
    assert r"a\_b \& 100\% \{x\} \#1 \$5" in e and r"\textbackslash{}" in e and "🙂" not in bn.latex_escape("ok 🙂")


def test_latex_structure_and_order():
    tex = bn.build_latex(ITEM, NOTES, citekey="lee2020gamma")
    assert tex.index("Early note") < tex.index("The fit gives")  # page order
    assert r"\cite[p.~3]{lee2020gamma}" in tex and r"\cite[p.~12]{lee2020gamma}" in tex
    assert tex.count(r"\begin{quote}") == 2 and "Check this \\& compare" in tex
    assert r"\hfill" in bn.build_latex(ITEM, NOTES) and "\\section*" not in bn.build_latex(ITEM, NOTES, heading=False)
    assert "\\cite" not in bn.build_latex(ITEM, NOTES, pages=False, citekey="") 


def test_markdown():
    md = bn.build_markdown(ITEM, NOTES)
    assert md.startswith("# Notes on") and "> Early note" in md and "— p. 12" in md


@pytest.mark.skipif(not shutil.which("pdflatex"), reason="pdflatex not installed")
def test_output_compiles(tmp_path):
    body = bn.build_latex(ITEM, NOTES, citekey="lee2020gamma")
    (tmp_path / "references.bib").write_text("@article{lee2020gamma, author={Lee, Ann}, title={Gamma-ray bursts}, journal={ApJ}, year={2020}}\n")
    (tmp_path / "main.tex").write_text("\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\begin{document}\n" + body + "\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}\n")
    r = subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", "main.tex"], cwd=tmp_path, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-1500:]
    assert (tmp_path / "main.pdf").exists()
