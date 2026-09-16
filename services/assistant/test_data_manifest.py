"""Reinstall persistence cases. Never require a running server."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from data_manifest import (
    APP_VERSION,
    INDEX_VERSION,
    MANIFEST_NAME,
    MIGRATION_LOG,
    apply_index_version,
    ensure_layout_safe,
    inspect_data_dir,
    load_manifest,
    migrate_schema,
    prepare_index,
    write_manifest,
)


class ManifestPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write_note(self, data_dir: Path, name: str = "paper.md") -> Path:
        notes = data_dir / "10-Papers"
        notes.mkdir(parents=True, exist_ok=True)
        path = notes / name
        path.write_text("---\ncitekey: paper\nclaim: keep me\n---\nbody\n")
        return path

    def _write_tex(self, data_dir: Path) -> Path:
        latex = data_dir / "70-LaTeX"
        latex.mkdir(parents=True, exist_ok=True)
        path = latex / "thesis.tex"
        path.write_text("\\documentclass{article}\\begin{document}hi\\end{document}\n")
        return path

    def test_fresh_install_writes_manifest_and_defaults(self) -> None:
        data_dir = self.root / "fresh"
        ensure_layout_safe(data_dir)
        manifest = write_manifest(data_dir)
        self.assertTrue((data_dir / MANIFEST_NAME).is_file())
        self.assertEqual(manifest["app_version"], APP_VERSION)
        self.assertEqual(manifest["vault_path"], str(data_dir.resolve()))
        self.assertEqual(manifest["latex_path"], str((data_dir / "70-LaTeX").resolve()))
        self.assertEqual(manifest["notes_path"], str((data_dir / "10-Papers").resolve()))
        self.assertTrue((data_dir / "10-Papers").is_dir())
        self.assertTrue((data_dir / "70-LaTeX").is_dir())

    def test_reinstall_same_version_same_path_keeps_files(self) -> None:
        data_dir = self.root / "same"
        ensure_layout_safe(data_dir)
        note = self._write_note(data_dir)
        tex = self._write_tex(data_dir)
        write_manifest(data_dir, {"app_version": APP_VERSION})
        info = inspect_data_dir(data_dir)
        self.assertTrue(info["existingData"])
        self.assertEqual(info["previousAppVersion"], APP_VERSION)
        ensure_layout_safe(data_dir)
        write_manifest(data_dir)
        self.assertEqual(note.read_text(), "---\ncitekey: paper\nclaim: keep me\n---\nbody\n")
        self.assertTrue(tex.exists())
        self.assertEqual(info["latexFileCount"], 1)

    def test_reinstall_new_version_migrates_without_deleting(self) -> None:
        data_dir = self.root / "upgrade"
        ensure_layout_safe(data_dir)
        note = self._write_note(data_dir, "keep.md")
        old = {
            "schema_version": 0,
            "app_version": "1.0.0",
            "created_at": "2026-01-01T00:00:00+00:00",
            "vault_path": str(data_dir),
            "custom_legacy_field": "must-survive",
        }
        (data_dir / MANIFEST_NAME).write_text(json.dumps(old))
        loaded = load_manifest(data_dir)
        migrated = migrate_schema(data_dir, loaded or {})
        apply_index_version(data_dir, migrated)
        self.assertTrue(note.exists())
        self.assertEqual(migrated["custom_legacy_field"], "must-survive")
        self.assertIn("latex_path", migrated)
        self.assertIn("notes_path", migrated)
        log = (data_dir / MIGRATION_LOG).read_text()
        self.assertIn("1.0.0", log)
        self.assertTrue(inspect_data_dir(data_dir)["hasManifest"])

    def test_reinstall_different_path_is_fresh(self) -> None:
        old_dir = self.root / "old"
        new_dir = self.root / "new"
        ensure_layout_safe(old_dir)
        self._write_note(old_dir)
        write_manifest(old_dir)
        info_new = inspect_data_dir(new_dir)
        self.assertFalse(info_new["existingData"])
        self.assertFalse(info_new["hasManifest"])
        ensure_layout_safe(new_dir)
        write_manifest(new_dir)
        self.assertTrue((old_dir / "10-Papers" / "paper.md").exists())
        self.assertFalse((new_dir / "10-Papers" / "paper.md").exists())

    def test_prepare_index_copies_legacy_and_keeps_source(self) -> None:
        data_dir = self.root / "idx"
        legacy = self.root / "legacy-lancedb"
        legacy.mkdir()
        (legacy / "notes.lance").write_text("vector-bytes")
        dest, note = prepare_index(data_dir, legacy)
        self.assertEqual(dest, (data_dir / "index").resolve())
        self.assertTrue((dest / "notes.lance").exists())
        self.assertTrue((legacy / "notes.lance").exists())
        self.assertIn("copied", note)
        dest2, note2 = prepare_index(data_dir, legacy)
        self.assertEqual(dest2, dest)
        self.assertIn("preserved", note2)


if __name__ == "__main__":
    unittest.main()
