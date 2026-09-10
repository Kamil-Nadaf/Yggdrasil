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


def chunk_id(note_path: str, chunk: str) -> str:
    h = hashlib.md5((note_path + chunk[:50]).encode()).hexdigest()[:12]
    return f"{Path(note_path).stem}_{h}"


def index_file(path: Path, table):
    """Chunk, embed, and upsert one .md file."""
    try:
        post = frontmatter.load(str(path))
    except Exception as e:
        log.warning(f"Could not parse {path}: {e}")
        return

    fm = post.metadata
    citekey = fm.get("citekey", path.stem)
    text = post.content or ""

    # Include key frontmatter fields in searchable text
    meta_text = " ".join(filter(None, [
        str(fm.get("title", "")),
        str(fm.get("claim", "")),
        str(fm.get("evidence", "")),
        str(fm.get("reasoning", "")),
        str(fm.get("implications", "")),
        str(fm.get("context", "")),
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
        cid = chunk_id(note_path_str, chunk)
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


def initial_index(table):
    """Index all existing .md files on startup."""
    all_md = list(VAULT.rglob("*.md"))
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
    observer.schedule(handler, str(VAULT), recursive=True)
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
