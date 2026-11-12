import os
import time
from pathlib import Path

import drive_sync as ds
import icloud_sync as ic


def mk(tmp_path):
    a, b, t = tmp_path / "vault" / "15-Books", tmp_path / "icloud" / "Books", tmp_path / "trash"
    (tmp_path / "icloud").mkdir()
    a.mkdir(parents=True)
    return a, b, tmp_path / "state.json", t


def run(a, b, st, t, **kw):
    return ic.run_mirror(a, b, st, t, **kw)


def test_first_sync_uploads_everything_then_is_quiet(tmp_path):
    a, b, st, t = mk(tmp_path)
    (a / "x.pdf").write_bytes(b"1")
    (a / "sub").mkdir()
    (a / "sub" / "y.epub").write_bytes(b"22")
    r = run(a, b, st, t)
    assert r["ok"] and r["uploaded"] == 2 and (b / "sub" / "y.epub").read_bytes() == b"22"
    r = run(a, b, st, t)
    assert r["ok"] and r["uploaded"] == r["downloaded"] == 0


def test_changes_flow_both_ways_and_deletes_go_to_trash(tmp_path):
    a, b, st, t = mk(tmp_path)
    (a / "x.pdf").write_bytes(b"1")
    run(a, b, st, t)
    (b / "z.pdf").write_bytes(b"from icloud")  # added on another device
    (a / "x.pdf").write_bytes(b"edited")
    r = run(a, b, st, t)
    assert (a / "z.pdf").read_bytes() == b"from icloud" and (b / "x.pdf").read_bytes() == b"edited"
    (b / "z.pdf").unlink()
    r = run(a, b, st, t)
    assert not (a / "z.pdf").exists() and r["deleted_local"] == 1
    assert list(t.rglob("z.pdf"))


def test_conflict_keeps_both(tmp_path):
    a, b, st, t = mk(tmp_path)
    (a / "x.pdf").write_bytes(b"base")
    run(a, b, st, t)
    (a / "x.pdf").write_bytes(b"local")
    time.sleep(0.02)
    (b / "x.pdf").write_bytes(b"remote-newer")
    r = run(a, b, st, t)
    assert r["conflicts"] == 1
    assert (a / "x.pdf").read_bytes() == b"remote-newer"
    assert any(p.read_bytes() == b"local" for p in a.glob("x (conflict*"))
    assert any(p.read_bytes() == b"local" for p in b.glob("x (conflict*"))


def test_evicted_files_are_never_treated_as_deleted(tmp_path):
    a, b, st, t = mk(tmp_path)
    (a / "x.pdf").write_bytes(b"1")
    run(a, b, st, t)
    (b / "x.pdf").unlink()
    (b / ".x.pdf.icloud").write_bytes(b"")  # macOS evicted it to save space
    r = run(a, b, st, t)
    assert (a / "x.pdf").exists() and r["deleted_local"] == 0


def test_mass_delete_needs_confirmation(tmp_path):
    a, b, st, t = mk(tmp_path)
    for i in range(40):
        (a / f"{i}.pdf").write_bytes(bytes([i]))
    run(a, b, st, t)
    for p in b.glob("*.pdf"):
        p.unlink()
    r = run(a, b, st, t)
    assert r.get("needs_confirm") and len(list(a.glob("*.pdf"))) == 40
    r = run(a, b, st, t, force=True)
    assert r["ok"] and not list(a.glob("*.pdf"))


def test_missing_icloud_parent(tmp_path):
    a = tmp_path / "v" / "15-Books"
    r = ic.run_mirror(a, tmp_path / "nope" / "Books", tmp_path / "s.json", tmp_path / "t")
    assert not r["ok"] and "iCloud" in r["message"]


def test_books_storage_skip_rules():
    assert ds.skip_top_for({"books_storage": "zotero"}) == ("10-Papers", "15-Books")
    assert ds.skip_top_for({"books_storage": "icloud"}) == ("10-Papers", "15-Books")
    assert ds.skip_top_for({"books_storage": "drive"}) == ("10-Papers",)
    assert ds.skip_top_for({"books_storage": "drive", "sync_papers_books": True}) == ()
