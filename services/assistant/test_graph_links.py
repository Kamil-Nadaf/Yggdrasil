"""Typed graph edge helpers — no LanceDB / Ollama required."""
from __future__ import annotations

import unittest

from graph_links import (
    extract_note_features,
    manual_edges_from_wikilinks,
    neighbors_from_rows,
    overlap_edges,
    parse_wikilinks,
)


class GraphLinksTests(unittest.TestCase):
    def test_parse_wikilinks(self) -> None:
        self.assertEqual(parse_wikilinks("see [[internal-shock]] and [[zhang2011|Zhang]]"), ["internal-shock", "zhang2011"])

    def test_extract_features_from_frontmatter_and_body(self) -> None:
        fm = {
            "claim": "Internal shocks dominate prompt emission",
            "methods": ["spectral fitting", "internal shock model"],
            "objects": ["GRB 221009A"],
            "arxiv": "1009.3338",
        }
        body = "Also compare arXiv:2401.12345 and GRB250920C."
        feats = extract_note_features("zhang2011internal", fm, body)
        self.assertTrue(feats["claims"])
        self.assertIn("internal shock model", feats["methods"])
        self.assertIn("1009.3338", feats["citations"])
        self.assertIn("2401.12345", feats["citations"])
        self.assertTrue(any("grb250920c" in e for e in feats["entities"]))

    def test_overlap_requires_similarity_threshold(self) -> None:
        a = extract_note_features(
            "a",
            {"claim": "x", "methods": ["internal shock model"], "objects": ["GRB 080916C"]},
        )
        b = extract_note_features(
            "b",
            {"claim": "y", "methods": ["internal shock model"], "objects": ["GRB 080916C"]},
        )
        low = overlap_edges(a, b, similarity=0.4, threshold=0.75)
        self.assertEqual(low, [])
        high = overlap_edges(a, b, similarity=0.8, threshold=0.75)
        types = {e["type"] for e in high}
        self.assertIn("shared_method", types)
        self.assertIn("shared_entity", types)
        self.assertTrue(any("internal shock model" in e["reason_text"] for e in high))

    def test_manual_wikilink_edges(self) -> None:
        edges = manual_edges_from_wikilinks("paper-a", "Argues against: [[paper-b]]")
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["type"], "manual_link")
        self.assertEqual(edges[0]["target_note"], "paper-b")
        self.assertEqual(edges[0]["confidence_score"], 1.0)

    def test_neighbors_ranked_with_reason(self) -> None:
        rows = [
            {
                "source_note": "a",
                "target_note": "b",
                "type": "shared_method",
                "reason_text": "shares method: spectral fitting",
                "confidence_score": 0.9,
            },
            {
                "source_note": "c",
                "target_note": "a",
                "type": "manual_link",
                "reason_text": "manual [[wikilink]] → a",
                "confidence_score": 1.0,
            },
        ]
        hits = neighbors_from_rows(rows, "a")
        self.assertEqual(hits[0]["note"], "c")
        self.assertEqual(hits[0]["confidence_score"], 1.0)
        self.assertIn("reason_text", hits[0])


if __name__ == "__main__":
    unittest.main()
