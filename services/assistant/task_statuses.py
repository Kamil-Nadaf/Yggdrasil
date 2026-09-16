"""Configurable task statuses (List/Kanban status pill + columns)."""
from __future__ import annotations

import re
import secrets
from typing import Any

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
ICON_TOKENS = {"circle-outline", "half-fill", "full-fill", "square", "triangle"}
ICON_CYCLE = ["circle-outline", "half-fill", "full-fill", "square", "triangle"]

DEFAULT_TASK_STATUSES: list[dict[str, Any]] = [
    {"id": "todo", "name": "To Do", "color": "#6B7280", "order": 0, "icon": "circle-outline"},
    {"id": "in_progress", "name": "In Progress", "color": "#F59E0B", "order": 1, "icon": "half-fill"},
    {"id": "done", "name": "Done", "color": "#34D399", "order": 2, "icon": "full-fill"},
]


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "status"


def normalize_task_statuses(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ValueError("task_statuses must be a non-empty list")

    seen_ids: set[str] = set()
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError("Each status must be an object")
        name = str(raw.get("name") or "").strip()
        if not name:
            raise ValueError("Status name cannot be empty")

        status_id = str(raw.get("id") or "").strip()
        if not status_id:
            status_id = f"{_slugify(name)}_{secrets.token_hex(3)}"
        if status_id in seen_ids:
            raise ValueError(f"Duplicate status id: {status_id}")
        seen_ids.add(status_id)

        color = str(raw.get("color") or "")
        if not HEX_RE.fullmatch(color):
            color = "#6B7280"

        icon = str(raw.get("icon") or "")
        if icon not in ICON_TOKENS:
            icon = ICON_CYCLE[i % len(ICON_CYCLE)]

        out.append({"id": status_id, "name": name, "color": color, "order": i, "icon": icon})
    return out


def load_task_statuses(app_settings: dict[str, Any]) -> list[dict[str, Any]]:
    """`app_settings` is the dict already returned by analysis_tags.load_app_settings()."""
    raw = app_settings.get("task_statuses")
    if not raw:
        return [dict(s) for s in DEFAULT_TASK_STATUSES]
    try:
        return normalize_task_statuses(raw)
    except ValueError:
        return [dict(s) for s in DEFAULT_TASK_STATUSES]
