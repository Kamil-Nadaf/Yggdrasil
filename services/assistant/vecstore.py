"""
vecstore.py: a tiny SQLite + numpy replacement for the LanceDB usage in Yggdrasil.

Why: lancedb + pyarrow add ~230 MB to the app, but Yggdrasil only needs
  * a "notes" table of chunk embeddings searched by L2 distance, and
  * a "graph_edges" table with simple insert / delete-by-condition / list.
A vault has thousands of chunks, so a brute-force numpy search is milliseconds.

API mirrors the small slice of LanceDB we used:
    db = connect(dir)
    t = db.open_table("notes")            # raises if the table does not exist
    t = db.create_table("graph_edges")    # idempotent
    t.add(rows); t.delete("id = 'x'"); t.count_rows(); t.to_list()
    t.search(vec).where("citekey = 'k'").limit(5).select(["citekey"]).to_list()

The WHERE strings are passed to SQLite, so the same simple SQL used before
(=, !=, AND, OR, parentheses, quoted strings) works unchanged.
Data lives in <dir>/vecstore.sqlite3 (WAL mode, safe for the indexer and the
assistant to share the same volume).
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any, Optional

import numpy as np

DB_FILE = "vecstore.sqlite3"

SCHEMAS: dict[str, list[tuple[str, str]]] = {
    "notes": [
        ("id", "TEXT"),
        ("citekey", "TEXT"),
        ("chunk", "TEXT"),
        ("embedding", "BLOB"),
        ("note_path", "TEXT"),
    ],
    "graph_edges": [
        ("id", "TEXT"),
        ("source_note", "TEXT"),
        ("target_note", "TEXT"),
        ("type", "TEXT"),
        ("reason_text", "TEXT"),
        ("confidence_score", "REAL"),
        ("created_at", "TEXT"),
    ],
}
_INDEXES = {
    "notes": ["id", "citekey"],
    "graph_edges": ["id", "source_note", "target_note"],
}


def _pack(vec: Any) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def _unpack(blob: Optional[bytes]) -> list[float]:
    if not blob:
        return []
    return np.frombuffer(blob, dtype=np.float32).tolist()


class Database:
    def __init__(self, path: str | Path):
        self.dir = Path(path)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(self.dir / DB_FILE), check_same_thread=False, timeout=30
        )
        self._conn.row_factory = sqlite3.Row
        try:
            self._conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.DatabaseError:
            pass
        self._conn.execute("PRAGMA synchronous=NORMAL")

    def _exists(self, name: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        return row is not None

    def open_table(self, name: str) -> "Table":
        with self._lock:
            if name not in SCHEMAS or not self._exists(name):
                raise FileNotFoundError(f"Table '{name}' was not found")
        return Table(self, name)

    def create_table(self, name: str, schema: Any = None) -> "Table":
        if name not in SCHEMAS:
            raise ValueError(f"Unknown table '{name}'")
        cols = ", ".join(f"{c} {t}" for c, t in SCHEMAS[name])
        with self._lock:
            self._conn.execute(f"CREATE TABLE IF NOT EXISTS {name} ({cols})")
            for col in _INDEXES.get(name, []):
                self._conn.execute(
                    f"CREATE INDEX IF NOT EXISTS idx_{name}_{col} ON {name}({col})"
                )
            self._conn.commit()
        return Table(self, name)

    def table_names(self) -> list[str]:
        with self._lock:
            return [
                r[0]
                for r in self._conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (%s)"
                    % ",".join("?" * len(SCHEMAS)),
                    tuple(SCHEMAS),
                )
            ]


def connect(path: str | Path) -> Database:
    return Database(path)


class Table:
    def __init__(self, db: Database, name: str):
        self._db = db
        self.name = name
        self._cols = [c for c, _ in SCHEMAS[name]]
        self._cache: dict[int, tuple[tuple, np.ndarray, np.ndarray, np.ndarray]] = {}

    # ---- writes -----------------------------------------------------------
    def add(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        placeholders = ",".join("?" * len(self._cols))
        data = []
        for r in rows:
            vals = []
            for c in self._cols:
                v = r.get(c)
                if c == "embedding" and v is not None:
                    v = _pack(v)
                vals.append(v)
            data.append(tuple(vals))
        with self._db._lock:
            self._db._conn.executemany(
                f"INSERT INTO {self.name} ({','.join(self._cols)}) VALUES ({placeholders})",
                data,
            )
            self._db._conn.commit()

    def delete(self, where: str) -> None:
        with self._db._lock:
            self._db._conn.execute(f"DELETE FROM {self.name} WHERE {where}")
            self._db._conn.commit()

    # ---- reads ------------------------------------------------------------
    def count_rows(self) -> int:
        with self._db._lock:
            return int(
                self._db._conn.execute(f"SELECT COUNT(*) FROM {self.name}").fetchone()[0]
            )

    def _row_to_dict(self, row: sqlite3.Row, cols: list[str]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for c in cols:
            out[c] = _unpack(row[c]) if c == "embedding" else row[c]
        return out

    def to_list(self) -> list[dict[str, Any]]:
        with self._db._lock:
            rows = self._db._conn.execute(
                f"SELECT {','.join(self._cols)} FROM {self.name} ORDER BY rowid"
            ).fetchall()
        return [self._row_to_dict(r, self._cols) for r in rows]

    def first_rows(self, by: str) -> list[dict[str, Any]]:
        """One row (the earliest) per distinct value of column `by`, embeddings included."""
        if by not in self._cols:
            raise ValueError(f"Unknown column: {by}")
        with self._db._lock:
            rows = self._db._conn.execute(
                f"SELECT {','.join(self._cols)} FROM {self.name} WHERE rowid IN "
                f"(SELECT MIN(rowid) FROM {self.name} GROUP BY {by}) ORDER BY rowid"
            ).fetchall()
        return [self._row_to_dict(r, self._cols) for r in rows]

    def search(self, vector: Any) -> "Query":
        return Query(self, vector)

    # ---- vector matrix cache (rebuilt only when the table changes) ---------
    def _matrix(self, dim: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        conn = self._db._conn
        stamp = tuple(
            conn.execute(
                f"SELECT COUNT(*), COALESCE(MAX(rowid),0) FROM {self.name}"
            ).fetchone()
        )
        hit = self._cache.get(dim)
        if hit is not None and hit[0] == stamp:
            return hit[1], hit[2], hit[3]
        ids: list[int] = []
        vecs: list[np.ndarray] = []
        for rowid, blob in conn.execute(
            f"SELECT rowid, embedding FROM {self.name} WHERE embedding IS NOT NULL ORDER BY rowid"
        ):
            if blob and len(blob) == dim * 4:
                ids.append(rowid)
                vecs.append(np.frombuffer(blob, dtype=np.float32))
        if vecs:
            mat = np.vstack(vecs)
        else:
            mat = np.zeros((0, dim), dtype=np.float32)
        rowids = np.asarray(ids, dtype=np.int64)
        sq = (mat * mat).sum(axis=1)
        self._cache[dim] = (stamp, rowids, mat, sq)
        return rowids, mat, sq


class Query:
    def __init__(self, table: Table, vector: Any):
        self._t = table
        self._vec = np.asarray(vector, dtype=np.float32).ravel()
        self._where: Optional[str] = None
        self._limit = 10
        self._select: Optional[list[str]] = None

    def where(self, expr: str, prefilter: bool = True) -> "Query":
        self._where = expr
        return self

    def limit(self, n: int) -> "Query":
        self._limit = max(0, int(n))
        return self

    def select(self, cols: list[str]) -> "Query":
        bad = [c for c in cols if c not in self._t._cols]
        if bad:
            raise ValueError(f"Unknown column(s): {bad}")
        self._select = list(cols)
        return self

    def to_list(self) -> list[dict[str, Any]]:
        t = self._t
        with t._db._lock:
            rowids, mat, sq = t._matrix(int(self._vec.shape[0]))
            if rowids.size == 0 or self._limit == 0:
                return []
            if self._where:
                allowed = np.fromiter(
                    (
                        r[0]
                        for r in t._db._conn.execute(
                            f"SELECT rowid FROM {t.name} WHERE {self._where}"
                        )
                    ),
                    dtype=np.int64,
                )
                keep = np.isin(rowids, allowed)
                rowids, mat, sq = rowids[keep], mat[keep], sq[keep]
                if rowids.size == 0:
                    return []
            q = self._vec
            dist = np.maximum(sq - 2.0 * (mat @ q) + float(q @ q), 0.0)  # squared L2
            k = min(self._limit, dist.shape[0])
            top = np.argpartition(dist, k - 1)[:k] if k < dist.shape[0] else np.arange(k)
            top = top[np.argsort(dist[top], kind="stable")]
            cols = self._select or t._cols
            out: list[dict[str, Any]] = []
            for i in top:
                row = t._db._conn.execute(
                    f"SELECT {','.join(t._cols)} FROM {t.name} WHERE rowid = ?",
                    (int(rowids[i]),),
                ).fetchone()
                if row is None:
                    continue
                d = t._row_to_dict(row, cols)
                d["_distance"] = float(dist[i])
                out.append(d)
            return out
