"""Analysis tags settings + migration."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import frontmatter

from analysis_tags import (
    DEFAULT_ANALYSIS_TAGS,
    analysis_keys,
    load_app_settings,
    migrate_frontmatter_keys,
    normalize_analysis_tags,
    save_app_settings,
    tag_to_key,
)


class AnalysisTagsTests(unittest.TestCase):
    def test_tag_to_key(self) -> None:
        self.assertEqual(tag_to_key("Claim"), "claim")
        self.assertEqual(tag_to_key("Explain Cold"), "explain_cold")

    def test_normalize_rejects_bad(self) -> None:
        with self.assertRaises(ValueError):
            normalize_analysis_tags(["A", "B"])
        with self.assertRaises(ValueError):
            normalize_analysis_tags(["A", "B", "C", "D", ""])
        with self.assertRaises(ValueError):
            normalize_analysis_tags(["Claim", "claim", "X", "Y", "Z"])

    def test_save_and_load_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            tags = ["Abstract", "Methods", "Results", "Discussion", "Limitations"]
            save_app_settings(vault, {"analysis_tags": tags})
            loaded = load_app_settings(vault)
            self.assertEqual(loaded["analysis_tags"], tags)
            self.assertEqual(analysis_keys(tags), ["abstract", "methods", "results", "discussion", "limitations"])

    def test_migrate_renames_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            papers = vault / "10-Papers"
            papers.mkdir()
            post = frontmatter.Post("body")
            post.metadata.update({"citekey": "p1", "claim": "hello", "evidence": "fig1"})
            (papers / "p1.md").write_text(frontmatter.dumps(post))
            r = migrate_frontmatter_keys(vault, {"claim": "abstract", "evidence": "methods"})
            self.assertIn("p1", r["changed"])
            loaded = frontmatter.load(str(papers / "p1.md"))
            self.assertEqual(loaded.metadata.get("abstract"), "hello")
            self.assertNotIn("claim", loaded.metadata)

    def test_defaults(self) -> None:
        self.assertEqual(len(DEFAULT_ANALYSIS_TAGS), 5)
        self.assertEqual(analysis_keys(DEFAULT_ANALYSIS_TAGS), ["claim", "evidence", "reasoning", "implications", "context"])


if __name__ == "__main__":
    unittest.main()
