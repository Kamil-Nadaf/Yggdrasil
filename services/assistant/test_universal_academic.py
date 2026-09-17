"""Unit and integration test for universal academic search and multi-discipline daily feeds."""
from __future__ import annotations

import unittest
from arxiv_topics import (
    ARXIV_TOPICS,
    is_valid_category,
    is_openalex_topic,
    get_topic_search_query,
    normalize_category,
)
from main import (
    _invert_openalex_abstract,
    _openalex_work_to_paper,
)


class UniversalAcademicTests(unittest.TestCase):
    def test_topic_helpers(self):
        self.assertTrue(is_openalex_topic("field:psychology"))
        self.assertTrue(is_openalex_topic("field:linguistics"))
        self.assertTrue(is_openalex_topic("field:philosophy"))
        self.assertTrue(is_openalex_topic("field:geography"))
        self.assertTrue(is_openalex_topic("custom:chinese-history"))
        self.assertFalse(is_openalex_topic("cs.AI"))
        self.assertFalse(is_openalex_topic("astro-ph.HE"))
        self.assertFalse(is_openalex_topic("all"))

        self.assertEqual(get_topic_search_query("field:psychology"), "psychology")
        self.assertEqual(get_topic_search_query("custom:urban-geography"), "urban geography")

    def test_invert_openalex_abstract(self):
        sample_inverted = {
            "This": [0],
            "is": [1],
            "a": [2],
            "test": [3],
            "abstract.": [4],
        }
        inverted = _invert_openalex_abstract(sample_inverted)
        self.assertEqual(inverted, "This is a test abstract.")

    def test_openalex_work_mapping(self):
        sample_work = {
            "id": "https://openalex.org/W123456",
            "doi": "https://doi.org/10.1016/j.cogpsych.2024.101",
            "title": "Cognitive architectures in human memory",
            "authorships": [
                {"author": {"display_name": "Jane Doe"}},
                {"author": {"display_name": "John Smith"}},
            ],
            "abstract_inverted_index": {"Memory": [0], "retrieval": [1], "models": [2]},
            "concepts": [
                {"display_name": "Psychology"},
                {"display_name": "Cognitive Science"},
            ],
            "best_oa_location": {
                "pdf_url": "https://example.org/paper.pdf",
                "landing_page_url": "https://doi.org/10.1016/j.cogpsych.2024.101",
            },
            "publication_date": "2024-05-10",
        }
        paper = _openalex_work_to_paper(sample_work)
        self.assertEqual(paper["id"], "10.1016/j.cogpsych.2024.101")
        self.assertEqual(paper["title"], "Cognitive architectures in human memory")
        self.assertEqual(paper["authors"], ["Jane Doe", "John Smith"])
        self.assertEqual(paper["abstract"], "Memory retrieval models")
        self.assertEqual(paper["pdf_url"], "https://example.org/paper.pdf")
        self.assertEqual(paper["source"], "openalex")
        self.assertIn("Psychology", paper["categories"])


if __name__ == "__main__":
    unittest.main()
