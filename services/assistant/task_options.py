"""Custom task priorities and tags, plus per-project allow-lists and task field cleaning.

Statuses live in task_statuses.py; priorities and tags follow the same shape so Settings can
edit all three the same way. Everything here is pure (no vault/IO) so it is easy to test.
"""
from __future__ import annotations

import re
import secrets
from typing import Any, Iterable, Optional

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REF_RE = re.compile(r"^[A-Za-z0-9_-]+/(mt|st)-[a-f0-9]{12}$")
RELATION_TYPES = {"blocked_by", "related"}
MAX_TAGS_PER_TASK = 12
MAX_ESTIMATE_MIN = 60 * 24 * 30

DEFAULT_TASK_PRIORITIES: list[dict[str, Any]] = [
    {"id": "urgent", "name": "Urgent", "color": "#F87171", "order": 0},
    {"id": "high", "name": "High", "color": "#F59E0B", "order": 1},
    {"id": "normal", "name": "Normal", "color": "#4FC3F7", "order": 2},
    {"id": "low", "name": "Low", "color": "#6B7280", "order": 3},
]

DEFAULT_TASK_TAGS: list[dict[str, Any]] = []

TAG_PALETTE = ["#A77BE0", "#4FD1C5", "#F0993E", "#5F86E8", "#7FB04A", "#E06C9F"]


def _slugify(name: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or fallback


def _normalize_defs(value: Any, kind: str, *, allow_empty: bool) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"task_{kind}s must be a list")
    if not value and not allow_empty:
        raise ValueError(f"task_{kind}s must be a non-empty list")
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError(f"Each {kind} must be an object")
        name = str(raw.get("name") or "").strip()
        if not name:
            raise ValueError(f"{kind.capitalize()} name cannot be empty")
        item_id = str(raw.get("id") or "").strip()
        if not item_id:
            item_id = f"{_slugify(name, kind)}_{secrets.token_hex(3)}"
        if item_id in seen:
            raise ValueError(f"Duplicate {kind} id: {item_id}")
        seen.add(item_id)
        color = str(raw.get("color") or "")
        if not HEX_RE.fullmatch(color):
            color = TAG_PALETTE[i % len(TAG_PALETTE)] if kind == "tag" else "#6B7280"
        out.append({"id": item_id, "name": name, "color": color, "order": i})
    return out


def normalize_priorities(value: Any) -> list[dict[str, Any]]:
    return _normalize_defs(value, "priority", allow_empty=False)


def normalize_tags(value: Any) -> list[dict[str, Any]]:
    return _normalize_defs(value, "tag", allow_empty=True)


def load_priorities(app_settings: dict[str, Any]) -> list[dict[str, Any]]:
    raw = app_settings.get("task_priorities")
    if not raw:
        return [dict(p) for p in DEFAULT_TASK_PRIORITIES]
    try:
        return normalize_priorities(raw)
    except ValueError:
        return [dict(p) for p in DEFAULT_TASK_PRIORITIES]


def load_tags(app_settings: dict[str, Any]) -> list[dict[str, Any]]:
    raw = app_settings.get("task_tags")
    if not raw:
        return [dict(t) for t in DEFAULT_TASK_TAGS]
    try:
        return normalize_tags(raw)
    except ValueError:
        return [dict(t) for t in DEFAULT_TASK_TAGS]


def clean_allowed(value: Any, valid_ids: Iterable[str]) -> Optional[list[str]]:
    """Per-project allow-list. None (or missing) means 'every custom option is available'."""
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError("Allowed options must be a list or null")
    valid = set(valid_ids)
    seen: list[str] = []
    for v in value:
        s = str(v)
        if s in valid and s not in seen:
            seen.append(s)
    return seen


def clean_date(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    s = str(value)
    if not DATE_RE.fullmatch(s):
        raise ValueError("Dates must look like YYYY-MM-DD")
    return s


def clean_estimate(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ValueError("Estimate must be a whole number of minutes")
    if n < 0 or n > MAX_ESTIMATE_MIN:
        raise ValueError("Estimate is out of range")
    return n or None


def clean_tag_ids(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValueError("tags must be a list")
    out: list[str] = []
    for v in value:
        s = str(v).strip()
        if s and s not in out:
            out.append(s)
    return out[:MAX_TAGS_PER_TASK]


def clean_relations(value: Any, self_ref: str = "") -> list[dict[str, str]]:
    """[{type: blocked_by|related, target: 'project-slug/mt-…'}] — drops junk, duplicates and self links."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValueError("relations must be a list")
    out: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw in value:
        if not isinstance(raw, dict):
            continue
        rtype = str(raw.get("type") or "")
        target = str(raw.get("target") or "")
        if rtype not in RELATION_TYPES or not REF_RE.fullmatch(target) or target == self_ref:
            continue
        key = (rtype, target)
        if key in seen:
            continue
        seen.add(key)
        out.append({"type": rtype, "target": target})
    return out


def timer_elapsed_sec(started_at_iso: Optional[str], now_iso: str) -> int:
    """Whole seconds between two ISO timestamps (never negative)."""
    from datetime import datetime

    if not started_at_iso:
        return 0
    try:
        started = datetime.fromisoformat(started_at_iso)
        now = datetime.fromisoformat(now_iso)
    except ValueError:
        return 0
    return max(0, int((now - started).total_seconds()))
