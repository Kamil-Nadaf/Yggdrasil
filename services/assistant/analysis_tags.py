"""Configurable analysis tags (flexible CERIC slot names)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

DEFAULT_ANALYSIS_TAGS = ["Claim", "Evidence", "Reasoning", "Implications", "Context"]
SETTINGS_REL = Path(".ygg-config") / "settings.json"


def tag_to_key(label: str) -> str:
    """Display label → frontmatter key (lowercase, hyphen/space → underscore)."""
    s = str(label).strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "slot"


def normalize_analysis_tags(tags: Any) -> list[str]:
    if not isinstance(tags, list):
        raise ValueError("analysis_tags must be a list of strings")
    cleaned = [str(t).strip() for t in tags]
    if len(cleaned) < 5:
        raise ValueError("Need at least 5 analysis tags")
    if any(not t for t in cleaned):
        raise ValueError("Analysis tag names cannot be empty")
    keys = [tag_to_key(t) for t in cleaned]
    if len(set(keys)) != len(keys):
        raise ValueError("Duplicate analysis tag keys after normalization")
    return cleaned


def analysis_keys(tags: list[str]) -> list[str]:
    return [tag_to_key(t) for t in tags]


def settings_path(vault: Path) -> Path:
    return vault / SETTINGS_REL


def load_app_settings(vault: Path) -> dict[str, Any]:
    path = settings_path(vault)
    if not path.is_file():
        return {"analysis_tags": list(DEFAULT_ANALYSIS_TAGS)}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {"analysis_tags": list(DEFAULT_ANALYSIS_TAGS)}
    if not isinstance(data, dict):
        return {"analysis_tags": list(DEFAULT_ANALYSIS_TAGS)}
    if "analysis_tags" not in data:
        data["analysis_tags"] = list(DEFAULT_ANALYSIS_TAGS)
    else:
        try:
            data["analysis_tags"] = normalize_analysis_tags(data["analysis_tags"])
        except ValueError:
            data["analysis_tags"] = list(DEFAULT_ANALYSIS_TAGS)
    return data


def save_app_settings(vault: Path, data: dict[str, Any]) -> dict[str, Any]:
    tags = normalize_analysis_tags(data.get("analysis_tags", DEFAULT_ANALYSIS_TAGS))
    merged = dict(data)
    merged["analysis_tags"] = tags
    path = settings_path(vault)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(merged, indent=2) + "\n")
    return merged


def scan_frontmatter_keys(vault: Path, keys: list[str]) -> dict[str, int]:
    """Count how many paper notes contain each frontmatter key."""
    import frontmatter

    counts = {k: 0 for k in keys}
    papers = vault / "10-Papers"
    if not papers.is_dir():
        return counts
    for p in papers.glob("*.md"):
        try:
            post = frontmatter.load(str(p))
        except Exception:
            continue
        for k in keys:
            if k in post.metadata:
                counts[k] += 1
    return counts


def migrate_frontmatter_keys(
    vault: Path,
    mapping: dict[str, str],
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Rename frontmatter keys in 10-Papers/. mapping: old_key → new_key."""
    import frontmatter

    changed: list[str] = []
    skipped: list[str] = []
    papers = vault / "10-Papers"
    if not papers.is_dir():
        return {"ok": True, "changed": [], "skipped": [], "dry_run": dry_run}
    for p in papers.glob("*.md"):
        try:
            post = frontmatter.load(str(p))
        except Exception:
            skipped.append(p.stem)
            continue
        dirty = False
        for old, new in mapping.items():
            if old == new:
                continue
            if old in post.metadata:
                if new in post.metadata and post.metadata[new] not in ("", None):
                    # keep both; don't overwrite non-empty new
                    skipped.append(f"{p.stem}:{old}")
                    continue
                post.metadata[new] = post.metadata.pop(old)
                dirty = True
        if dirty:
            changed.append(p.stem)
            if not dry_run:
                p.write_text(frontmatter.dumps(post))
    return {"ok": True, "changed": changed, "skipped": skipped, "dry_run": dry_run}
