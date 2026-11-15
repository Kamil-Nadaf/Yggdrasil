import asyncio
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import latex_service as ls


class NeedsFullTexTests(unittest.TestCase):
    def test_plain_article_is_fast_path(self):
        src = r"\documentclass{article}\usepackage{amsmath,graphicx}\usepackage[margin=1in]{geometry}\begin{document}x\end{document}"
        self.assertFalse(ls.needs_full_tex(src))

    def test_biblatex_default_needs_biber(self):
        self.assertTrue(ls.needs_full_tex(r"\usepackage[style=ieee]{biblatex}"))
        self.assertTrue(ls.needs_full_tex(r"\usepackage{biblatex}"))

    def test_biblatex_with_bibtex_backend_is_fast_path(self):
        self.assertFalse(ls.needs_full_tex(r"\usepackage[backend=bibtex,style=numeric]{biblatex}"))

    def test_shell_escape_packages_need_full_tex(self):
        for pkg in ("minted", "pythontex", "svg"):
            self.assertTrue(ls.needs_full_tex(rf"\usepackage{{{pkg}}}"), pkg)
        self.assertTrue(ls.needs_full_tex(r"\usepackage{amsmath, minted}"))

    def test_write18_and_lua_need_full_tex(self):
        self.assertTrue(ls.needs_full_tex(r"\immediate\write18{ls}"))
        self.assertTrue(ls.needs_full_tex(r"\directlua{print(1)}"))

    def test_listings_tikz_beamer_siunitx_are_fast_path(self):
        src = r"\documentclass{beamer}\usepackage{listings,tikz,pgfplots,siunitx,tcolorbox}"
        self.assertFalse(ls.needs_full_tex(src))


class EngineSelectionTests(unittest.TestCase):
    def test_no_binary_means_latexmk(self):
        with patch.dict(os.environ, {"YGG_TECTONIC": ""}, clear=False), patch.object(ls.shutil, "which", return_value=None):
            self.assertFalse(ls.should_try_tectonic("x", "-pdf"))

    def test_auto_uses_tectonic_for_simple_pdflatex_and_xelatex(self):
        with patch.dict(os.environ, {"YGG_TECTONIC": "/bin/true", "YGG_LATEX_ENGINE": "auto"}):
            self.assertTrue(ls.should_try_tectonic(r"\documentclass{article}", "-pdf"))
            self.assertTrue(ls.should_try_tectonic(r"\documentclass{article}", "-pdfxe"))
            self.assertFalse(ls.should_try_tectonic(r"\documentclass{article}", "-pdflua"))
            self.assertFalse(ls.should_try_tectonic(r"\usepackage{biblatex}", "-pdf"))

    def test_forced_modes(self):
        with patch.dict(os.environ, {"YGG_TECTONIC": "/bin/true", "YGG_LATEX_ENGINE": "latexmk"}):
            self.assertFalse(ls.should_try_tectonic(r"\documentclass{article}", "-pdf"))
        with patch.dict(os.environ, {"YGG_TECTONIC": "/bin/true", "YGG_LATEX_ENGINE": "tectonic"}):
            self.assertTrue(ls.should_try_tectonic(r"\usepackage{biblatex}", "-pdf"))


class RunTectonicTests(unittest.TestCase):
    def _fake(self, tmp: Path, body: str) -> str:
        p = tmp / "tectonic"
        p.write_text("#!/bin/sh\n" + body)
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
        return str(p)

    def test_success_reads_tex_log_and_args(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            fake = self._fake(tmp, 'echo "$@" > args.txt; echo "TEXLOG" > main.log; echo pdf > main.pdf; exit 0\n')
            (tmp / "main.tex").write_text("x")
            with patch.dict(os.environ, {"YGG_TECTONIC": fake}):
                code, log = asyncio.run(ls.run_tectonic(tmp, "main.tex"))
            self.assertEqual(code, 0)
            self.assertIn("TEXLOG", log)
            args = (tmp / "args.txt").read_text()
            self.assertIn("-X compile main.tex", args)
            self.assertIn("--keep-logs", args)

    def test_failure_returns_nonzero(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            fake = self._fake(tmp, 'echo "error: boom"; exit 1\n')
            with patch.dict(os.environ, {"YGG_TECTONIC": fake}):
                code, log = asyncio.run(ls.run_tectonic(tmp, "main.tex"))
            self.assertEqual(code, 1)
            self.assertIn("boom", log)


if __name__ == "__main__":
    unittest.main()
