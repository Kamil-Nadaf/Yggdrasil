"""Desktop data-directory registry. Never deletes vault/LaTeX/index files."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

APP_VERSION = "0.3.2"  # keep in sync with packaging/build-*.sh and frontend/package.json
SCHEMA_VERSION = 1
INDEX_VERSION = 1
MANIFEST_NAME = ".yggdrasil-manifest.json"
MIGRATION_LOG = ".yggdrasil-migration.log"

VAULT_FOLDERS = (
    "00-Inbox",
    "10-Papers",
    "15-Books",
    "20-Concepts",
    "30-Questions",
    "40-Synthesis",
    "50-Projects",
    "60-Meta",
    "70-LaTeX",
    "80-Tasks",
)

REQUIRED_FIELDS = (
    "schema_version",
    "app_version",
    "created_at",
    "last_opened",
    "vault_path",
    "latex_path",
    "notes_path",
    "index_path",
    "index_version",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def manifest_path(data_dir: Path) -> Path:
    return data_dir / MANIFEST_NAME


def log_path(data_dir: Path) -> Path:
    return data_dir / MIGRATION_LOG


def default_paths(data_dir: Path) -> dict[str, Any]:
    root = data_dir.expanduser().resolve()
    return {
        "schema_version": SCHEMA_VERSION,
        "app_version": APP_VERSION,
        "created_at": utc_now(),
        "last_opened": utc_now(),
        "vault_path": str(root),
        "latex_path": str(root / "70-LaTeX"),
        "notes_path": str(root / "10-Papers"),
        "index_path": str(root / "index"),
        "index_version": INDEX_VERSION,
    }


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text())
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def append_log(data_dir: Path, message: str) -> None:
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        with log_path(data_dir).open("a", encoding="utf-8") as fh:
            fh.write(f"{utc_now()} {message}\n")
    except Exception:
        pass


def looks_like_vault(data_dir: Path) -> bool:
    if not data_dir.is_dir():
        return False
    markers = ("10-Papers", "70-LaTeX", "00-Inbox", "60-Meta", "80-Tasks")
    return any((data_dir / name).is_dir() for name in markers)


def load_manifest(data_dir: Path) -> dict[str, Any] | None:
    return read_json(manifest_path(data_dir))


def merge_manifest(existing: dict[str, Any] | None, data_dir: Path) -> dict[str, Any]:
    """Add missing keys only. Never drop keys the older app wrote."""
    merged = dict(existing or {})
    defaults = default_paths(data_dir)
    for key, value in defaults.items():
        if key not in merged or merged[key] in (None, ""):
            merged[key] = value
    return merged


def ensure_data_gitignore(data_dir: Path) -> None:
    gitignore = data_dir / ".gitignore"
    lines = ("index/", MIGRATION_LOG)
    try:
        existing = gitignore.read_text() if gitignore.exists() else ""
        extra = [line for line in lines if line not in existing.splitlines()]
        if not extra:
            return
        with gitignore.open("a", encoding="utf-8") as fh:
            if existing and not existing.endswith("\n"):
                fh.write("\n")
            fh.write("\n".join(extra) + "\n")
    except OSError:
        pass


def write_manifest(data_dir: Path, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    current = load_manifest(data_dir)
    merged = merge_manifest(current, data_dir)
    if extra:
        for key, value in extra.items():
            if value is not None:
                merged[key] = value
    merged["last_opened"] = utc_now()
    merged["app_version"] = APP_VERSION
    merged["schema_version"] = max(int(merged.get("schema_version") or 0), SCHEMA_VERSION)
    write_json(manifest_path(data_dir), merged)
    ensure_data_gitignore(data_dir)
    return merged


def ensure_layout_safe(data_dir: Path) -> None:
    """Create missing vault folders. Never delete or replace existing files."""
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in VAULT_FOLDERS:
        (data_dir / name).mkdir(parents=True, exist_ok=True)


def count_tex_files(latex_dir: Path) -> int:
    if not latex_dir.is_dir():
        return 0
    return sum(1 for p in latex_dir.rglob("*.tex") if not any(part.startswith("_") for part in p.parts))


def migrate_schema(data_dir: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    """Read-only additive migration. Failure must not raise to the caller."""
    try:
        before = dict(manifest)
        old_schema = int(before.get("schema_version") or 0)
        old_app = str(before.get("app_version") or "unknown")
        merged = merge_manifest(before, data_dir)
        changed = [key for key in merged if key not in before]
        if old_schema < SCHEMA_VERSION:
            changed.append(f"schema_version {old_schema}->{SCHEMA_VERSION}")
        if old_app != APP_VERSION:
            changed.append(f"app_version {old_app}->{APP_VERSION}")
        if changed:
            append_log(data_dir, "migration: " + ", ".join(changed))
        merged["schema_version"] = max(old_schema, SCHEMA_VERSION)
        write_json(manifest_path(data_dir), merged)
        return merged
    except Exception as exc:
        append_log(data_dir, f"migration failed (kept old data): {exc}")
        return manifest


def prepare_index(data_dir: Path, legacy_index: Path | None = None) -> tuple[Path, str]:
    """
    Prefer {DATA_DIR}/index. Copy a leftover Application Support index if
    needed. Never delete either location.
    """
    dest = (data_dir / "index").resolve()
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        append_log(data_dir, f"index mkdir failed: {exc}")
        if legacy_index and legacy_index.exists():
            return legacy_index, "using legacy index"
        return dest, "index unavailable"

    dest_has = any(dest.iterdir()) if dest.exists() else False
    if dest_has:
        return dest, "existing index preserved"

    if legacy_index and legacy_index.exists() and any(legacy_index.iterdir()):
        try:
            shutil.copytree(legacy_index, dest, dirs_exist_ok=True)
            append_log(data_dir, f"copied legacy index {legacy_index} → {dest} (source kept)")
            return dest, "copied legacy index"
        except Exception as exc:
            append_log(data_dir, f"index copy failed, using legacy: {exc}")
            return legacy_index.resolve(), "legacy index after copy failure"

    return dest, "new empty index"


def inspect_data_dir(data_dir: Path) -> dict[str, Any]:
    root = data_dir.expanduser()
    try:
        root = root.resolve()
    except Exception:
        pass
    manifest = load_manifest(root)
    legacy = looks_like_vault(root)
    previous = str(manifest.get("app_version") or "") if manifest else ""
    return {
        "path": str(root),
        "exists": root.is_dir(),
        "hasManifest": bool(manifest),
        "hasVaultLayout": legacy,
        "existingData": bool(manifest or legacy),
        "previousAppVersion": previous,
        "manifest": manifest,
        "latexFileCount": count_tex_files(root / "70-LaTeX"),
    }


def resolve_data_dir(configured: str | None, default_dir: Path) -> Path:
    if configured:
        return Path(configured).expanduser()
    return default_dir.expanduser()


def apply_index_version(data_dir: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    stored = int(manifest.get("index_version") or 0)
    if stored == INDEX_VERSION:
        return manifest
    append_log(
        data_dir,
        f"index version {stored} → {INDEX_VERSION}; existing index left intact (no wipe, no overwrite)",
    )
    manifest = dict(manifest)
    manifest["index_version"] = INDEX_VERSION
    try:
        write_json(manifest_path(data_dir), merge_manifest(manifest, data_dir))
    except Exception as exc:
        append_log(data_dir, f"index version stamp failed: {exc}")
    return manifest
