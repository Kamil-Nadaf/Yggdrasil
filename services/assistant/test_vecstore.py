import tempfile
import unittest

import vecstore


def _rows():
    return [
        {"id": "a1", "citekey": "a", "chunk": "alpha", "embedding": [1.0, 0.0, 0.0], "note_path": "a.md"},
        {"id": "a2", "citekey": "a", "chunk": "alpha2", "embedding": [0.9, 0.1, 0.0], "note_path": "a.md"},
        {"id": "b1", "citekey": "b", "chunk": "beta", "embedding": [0.0, 1.0, 0.0], "note_path": "b.md"},
        {"id": "c1", "citekey": "c", "chunk": "gamma", "embedding": [0.0, 0.0, 1.0], "note_path": "c.md"},
    ]


class VecStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = vecstore.connect(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_open_missing_table_raises(self):
        with self.assertRaises(Exception):
            self.db.open_table("notes")

    def test_search_orders_by_distance_and_limits(self):
        t = self.db.create_table("notes")
        t.add(_rows())
        hits = t.search([1.0, 0.0, 0.0]).limit(2).select(["citekey", "chunk"]).to_list()
        self.assertEqual([h["chunk"] for h in hits], ["alpha", "alpha2"])
        self.assertEqual(set(hits[0]), {"citekey", "chunk", "_distance"})

    def test_where_prefilter_and_embedding_roundtrip(self):
        t = self.db.create_table("notes")
        t.add(_rows())
        hits = (
            t.search([1.0, 0.0, 0.0])
            .where("citekey = 'b'", prefilter=True)
            .limit(1)
            .select(["citekey", "embedding"])
            .to_list()
        )
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["citekey"], "b")
        self.assertEqual(list(hits[0]["embedding"]), [0.0, 1.0, 0.0])

    def test_delete_then_search_sees_change(self):
        t = self.db.create_table("notes")
        t.add(_rows())
        t.search([1.0, 0.0, 0.0]).limit(1).to_list()  # warm cache
        t.delete("citekey = 'a'")
        hits = t.search([1.0, 0.0, 0.0]).limit(5).select(["citekey"]).to_list()
        self.assertEqual({h["citekey"] for h in hits}, {"b", "c"})
        self.assertEqual(t.count_rows(), 2)

    def test_dimension_mismatch_is_ignored(self):
        t = self.db.create_table("notes")
        t.add(_rows())
        t.add([{"id": "x", "citekey": "x", "chunk": "x", "embedding": [1.0, 2.0], "note_path": "x.md"}])
        hits = t.search([1.0, 0.0, 0.0]).limit(10).select(["citekey"]).to_list()
        self.assertNotIn("x", {h["citekey"] for h in hits})

    def test_empty_table_search(self):
        t = self.db.create_table("notes")
        self.assertEqual(t.search([1.0, 0.0, 0.0]).limit(3).to_list(), [])

    def test_unknown_select_column_rejected(self):
        t = self.db.create_table("notes")
        with self.assertRaises(ValueError):
            t.search([1.0, 0.0, 0.0]).select(["nope; DROP TABLE notes"])

    def test_graph_edges_crud(self):
        t = self.db.create_table("graph_edges")
        t.add([
            {"id": "e1", "source_note": "a", "target_note": "b", "type": "manual_link",
             "reason_text": "r", "confidence_score": 1.0, "created_at": "t"},
            {"id": "e2", "source_note": "a", "target_note": "c", "type": "overlap",
             "reason_text": "r", "confidence_score": 0.8, "created_at": "t"},
        ])
        self.assertEqual(len(t.to_list()), 2)
        t.delete("(source_note = 'a' OR target_note = 'a') AND type != 'manual_link'")
        rows = t.to_list()
        self.assertEqual([r["id"] for r in rows], ["e1"])
        t.delete("id = 'e1'")
        self.assertEqual(t.to_list(), [])

    def test_first_rows_one_per_key_with_embedding(self):
        t = self.db.create_table("notes")
        t.add(_rows())
        rows = t.first_rows("citekey")
        self.assertEqual([r["id"] for r in rows], ["a1", "b1", "c1"])
        self.assertEqual(rows[0]["embedding"], [1.0, 0.0, 0.0])
        with self.assertRaises(ValueError):
            t.first_rows("nope")

    def test_create_table_is_idempotent_and_persists(self):
        t = self.db.create_table("notes")
        t.add(_rows())
        self.db.create_table("notes")
        db2 = vecstore.connect(self.tmp.name)
        self.assertEqual(db2.open_table("notes").count_rows(), 4)


if __name__ == "__main__":
    unittest.main()
