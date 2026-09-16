"""arXiv topic taxonomy + query helpers."""
from __future__ import annotations

import unittest

from arxiv_topics import ARXIV_TOPICS, is_valid_category, normalize_category, search_query_for


class ArxivTopicsTests(unittest.TestCase):
    def test_covers_requested_fields(self) -> None:
        ids = {t["id"] for t in ARXIV_TOPICS}
        self.assertIn("all", ids)
        self.assertIn("physics.chem-ph", ids)
        self.assertIn("physics.geo-ph", ids)
        self.assertIn("physics.hist-ph", ids)
        self.assertIn("math", ids)
        self.assertIn("cs", ids)
        self.assertGreater(len(ARXIV_TOPICS), 80)

    def test_normalize_and_query(self) -> None:
        self.assertEqual(normalize_category("all"), "all")
        self.assertEqual(normalize_category("*"), "all")
        self.assertEqual(search_query_for("all"), "all:*")
        self.assertEqual(search_query_for("math.GT"), "cat:math.GT")

    def test_valid_categories(self) -> None:
        self.assertTrue(is_valid_category("all"))
        self.assertTrue(is_valid_category("q-bio.NC"))
        self.assertTrue(is_valid_category("astro-ph.HE"))
        self.assertTrue(is_valid_category("physics.chem-ph"))
        self.assertFalse(is_valid_category("cat:math"))
        self.assertFalse(is_valid_category("../etc"))


if __name__ == "__main__":
    unittest.main()
