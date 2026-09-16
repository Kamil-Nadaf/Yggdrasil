"""Gate accepts configured analysis slot names."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import frontmatter

from gate import GateError, check_gate


class GateConfigurableSlotsTests(unittest.TestCase):
    def test_custom_slots(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.md"
            post = frontmatter.Post("")
            post.metadata.update(
                {
                    "abstract": "a",
                    "methods": "b",
                    "results": "c",
                    "discussion": "d",
                    "limitations": "e",
                    "aq_written": True,
                }
            )
            path.write_text(frontmatter.dumps(post))
            check_gate(
                path,
                slots=["abstract", "methods", "results", "discussion", "limitations"],
            )

    def test_missing_custom_slot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.md"
            post = frontmatter.Post("")
            post.metadata.update(
                {
                    "abstract": "a",
                    "methods": "",
                    "results": "c",
                    "discussion": "d",
                    "limitations": "e",
                    "aq_written": True,
                }
            )
            path.write_text(frontmatter.dumps(post))
            with self.assertRaises(GateError) as ctx:
                check_gate(
                    path,
                    slots=["abstract", "methods", "results", "discussion", "limitations"],
                )
            self.assertIn("methods", ctx.exception.missing_slots)


if __name__ == "__main__":
    unittest.main()
