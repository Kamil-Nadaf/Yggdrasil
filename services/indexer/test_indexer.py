"""Indexer citekey helpers — no Ollama required."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace

if "pyarrow" not in sys.modules:
    _pa = ModuleType("pyarrow")
    _pa.schema = lambda *a, **k: None
    _pa.field = lambda *a, **k: None
    _pa.utf8 = lambda: None
    _pa.float32 = lambda: None
    _pa.list_ = lambda *a, **k: None
    sys.modules["pyarrow"] = _pa
if "lancedb" not in sys.modules:
    _ldb = ModuleType("lancedb")
    _ldb.connect = lambda *a, **k: SimpleNamespace()
    sys.modules["lancedb"] = _ldb

from main import citekey_for, chunk_id


class CitekeyTests(unittest.TestCase):
    def test_book_section_uses_composite_id(self) -> None:
        path = Path("/vault/15-Books/gravitation-mtw/ch4-s2.md")
        fm = {"type": "book-section", "book": "gravitation-mtw"}
        self.assertEqual(citekey_for(path, fm), "gravitation-mtw/ch4-s2")
        self.assertTrue(
            chunk_id("15-Books/gravitation-mtw/ch4-s2.md", "hello", "gravitation-mtw/ch4-s2").startswith(
                "gravitation-mtw/ch4-s2_"
            )
        )

    def test_paper_keeps_citekey(self) -> None:
        path = Path("/vault/10-Papers/zhang2011internal.md")
        self.assertEqual(citekey_for(path, {"citekey": "zhang2011internal"}), "zhang2011internal")


if __name__ == "__main__":
    unittest.main()
