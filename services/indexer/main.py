"""
indexer/main.py

Watches the vault for .md file changes, chunks the content,
embeds via Ollama, and upserts into LanceDB.

Vault is mounted READ-ONLY. LanceDB volume is read-write.

Schema: { id: str, citekey: str, chunk: str, embedding: vector(768), note_path: str }
"""

import os
import time
import hashlib
import logging
from pathlib import Path

import httpx
import lancedb
import pyarrow as pa
import frontmatter
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent

from analysis_tags import DEFAULT_ANALYSIS_TAGS, analysis_keys, load_app_settings
from graph_links import (
    DEFAULT_SIMILARITY_THRESHOLD,
    delete_auto_edges_for,
    delete_manual_edges_for,
    extract_note_features,
    get_edges_table,
    load_features_from_vault,
    manual_edges_from_wikilinks,
    overlap_edges,
    upsert_edges,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("indexer")

VAULT = Path(os.environ.get("VAULT_PATH", "/vault"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
LANCEDB_PATH = "/data/lancedb"
CHUNK_SIZE = 400   # tokens-ish (characters)
CHUNK_OVERLAP = 80

SCHEMA = pa.schema([
    pa.field("id",        pa.utf8()),
    pa.field("citekey",   pa.utf8()),
    pa.field("chunk",     pa.utf8()),
    pa.field("embedding", pa.list_(pa.float32(), 768)),
    pa.field("note_path", pa.utf8()),
])


def get_or_create_table(db):
    try:
        return db.open_table("notes")
    except Exception:
        log.info("Creating LanceDB table 'notes'")
        return db.create_table("notes", schema=SCHEMA)


def embed(text: str) -> list[float]:
    for attempt in range(5):
        try:
            resp = httpx.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text},
                timeout=30.0,
            )
            resp.raise_for_status()
            return resp.json()["embedding"]
        except Exception as e:
            log.warning(f"Embed attempt {attempt+1} failed: {e}")
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("Embedding failed after 5 attempts")


def chunk_text(text: str) -> list[str]:
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        # Try to break on newline
        if end < len(text):
            newline = text.rfind("\n", start, end)
            if newline > start + CHUNK_SIZE // 2:
                end = newline
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - CHUNK_OVERLAP
        if start <= 0 and end == len(text):
            break
    return chunks


WATCH_FOLDERS = ("10-Papers", "20-Concepts", "15-Books")


def citekey_for(path: Path, fm: dict) -> str:
    """Composite {slug}/{id} for book sections so Loki/Ask can surface them."""
    if fm.get("type") == "book-section":
        slug = fm.get("book") or path.parent.name
        return f"{slug}/{path.stem}"
    return fm.get("citekey", path.stem)


def chunk_id(note_path: str, chunk: str, citekey=None) -> str:
    h = hashlib.md5((note_path + chunk[:50]).encode()).hexdigest()[:12]
    key = citekey or Path(note_path).stem
    return f"{key}_{h}"


def current_analysis_keys() -> list[str]:
    try:
        tags = load_app_settings(VAULT).get("analysis_tags") or DEFAULT_ANALYSIS_TAGS
        return analysis_keys(list(tags))
    except Exception:
        return analysis_keys(list(DEFAULT_ANALYSIS_TAGS))


def refresh_graph_edges(citekey: str, fm: dict, body: str = "") -> None:
    """Recompute typed edges for one note into LanceDB graph_edges."""
    try:
        et = get_edges_table(LANCEDB_PATH)
    except Exception as e:
        log.warning(f"graph_edges unavailable: {e}")
        return
    keys = current_analysis_keys()
    delete_manual_edges_for(et, citekey)
    delete_auto_edges_for(et, citekey)
    wiki_text = (body or "") + "\n" + " ".join(str(fm.get(k) or "") for k in keys)
    upsert_edges(et, manual_edges_from_wikilinks(citekey, wiki_text))
    source = extract_note_features(citekey, fm, body or "", analysis_keys=keys)
    others = load_features_from_vault(VAULT, analysis_keys=keys)
    auto = []
    for other_key, other_feat in others.items():
        if other_key == citekey:
            continue
        sim = 0.8 if (
            set(source["methods"]) & set(other_feat["methods"])
            or set(source["entities"]) & set(other_feat["entities"])
            or set(source["citations"]) & set(other_feat["citations"])
        ) else 0.0
        auto.extend(
            overlap_edges(source, other_feat, similarity=sim, threshold=DEFAULT_SIMILARITY_THRESHOLD)
        )
    upsert_edges(et, auto)


def index_file(path: Path, table):
    """Chunk, embed, and upsert one .md file."""
    if path.name.startswith("_"):
        return
    try:
        post = frontmatter.load(str(path))
    except Exception as e:
        log.warning(f"Could not parse {path}: {e}")
        return

    fm = post.metadata
    citekey = citekey_for(path, fm)
    text = post.content or ""

    # Include key frontmatter fields in searchable text (configured analysis tags + book fields)
    slot_bits = [str(fm.get(k, "")) for k in current_analysis_keys()]
    meta_text = " ".join(filter(None, [
        str(fm.get("title", "")),
        str(fm.get("abstract", "")),
        *slot_bits,
        str(fm.get("explain_cold", "")),
        str(fm.get("sanity_check", "")),
        str(fm.get("confusions", "")),
    ]))
    full_text = (meta_text + "\n\n" + text).strip()

    if not full_text:
        return

    chunks = chunk_text(full_text)
    if not chunks:
        return

    rows = []
    note_path_str = str(path.relative_to(VAULT))
    for chunk in chunks:
        cid = chunk_id(note_path_str, chunk, citekey)
        vec = embed(chunk)
        rows.append({
            "id":        cid,
            "citekey":   citekey,
            "chunk":     chunk,
            "embedding": vec,
            "note_path": note_path_str,
        })

    # Delete old chunks for this note, then insert new
    try:
        table.delete(f"note_path = '{note_path_str}'")
    except Exception:
        pass  # Table might be empty

    table.add(rows)
    log.info(f"Indexed {path.name}: {len(chunks)} chunks")
    try:
        refresh_graph_edges(citekey, dict(fm), text)
    except Exception as e:
        log.warning(f"graph edge refresh failed for {citekey}: {e}")


class VaultHandler(FileSystemEventHandler):
    def __init__(self, table):
        self.table = table
        self._debounce: dict[str, float] = {}

    def _should_process(self, path: str) -> bool:
        now = time.time()
        last = self._debounce.get(path, 0)
        if now - last < 2.0:
            return False
        self._debounce[path] = now
        return True

    def on_modified(self, event):
        if isinstance(event, FileModifiedEvent) and event.src_path.endswith(".md"):
            p = Path(event.src_path)
            if self._should_process(event.src_path):
                log.info(f"Modified: {p.name}")
                index_file(p, self.table)

    def on_created(self, event):
        if isinstance(event, FileCreatedEvent) and event.src_path.endswith(".md"):
            p = Path(event.src_path)
            if self._should_process(event.src_path):
                log.info(f"Created: {p.name}")
                index_file(p, self.table)


def watched_markdown() -> list[Path]:
    files: list[Path] = []
    for folder in WATCH_FOLDERS:
        root = VAULT / folder
        if root.is_dir():
            files.extend(root.rglob("*.md"))
    return files


def initial_index(table):
    """Index existing .md files in the watched vault folders."""
    all_md = watched_markdown()
    log.info(f"Initial index: {len(all_md)} files")
    for i, p in enumerate(all_md, 1):
        log.info(f"[{i}/{len(all_md)}] {p.relative_to(VAULT)}")
        index_file(p, table)
    log.info("Initial index complete.")


def wait_for_ollama():
    log.info(f"Waiting for Ollama at {OLLAMA_URL}…")
    for _ in range(30):
        try:
            r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            if r.status_code == 200:
                log.info("Ollama ready.")
                # Pull embed model if not present
                models = [m["name"] for m in r.json().get("models", [])]
                if not any(EMBED_MODEL in m for m in models):
                    log.info(f"Pulling {EMBED_MODEL}…")
                    httpx.post(
                        f"{OLLAMA_URL}/api/pull",
                        json={"name": EMBED_MODEL},
                        timeout=300,
                    )
                return
        except Exception:
            pass
        time.sleep(5)
    raise RuntimeError("Ollama not reachable after 150 seconds")


def main():
    log.info(f"Indexer starting. Vault: {VAULT}")
    wait_for_ollama()

    db = lancedb.connect(LANCEDB_PATH)
    table = get_or_create_table(db)

    initial_index(table)

    handler = VaultHandler(table)
    observer = Observer()
    for folder in WATCH_FOLDERS:
        watch_path = VAULT / folder
        watch_path.mkdir(parents=True, exist_ok=True)
        observer.schedule(handler, str(watch_path), recursive=True)
        log.info(f"Watching {watch_path}")
    observer.start()
    log.info("Watching vault for changes…")

    try:
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
