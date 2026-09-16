"""Long-running goal countdowns (e.g. "PhD", start date -> end date)."""
from __future__ import annotations

import secrets
from typing import Any


def normalize_goals(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("goals must be a list")
    seen_ids: set[str] = set()
    out: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("Each goal must be an object")
        name = str(raw.get("name") or "").strip()
        start_date = str(raw.get("start_date") or "").strip()
        end_date = str(raw.get("end_date") or "").strip()
        if not name:
            raise ValueError("Goal name cannot be empty")
        if not start_date or not end_date:
            raise ValueError("Goal needs start_date and end_date")

        goal_id = str(raw.get("id") or "").strip()
        if not goal_id or goal_id in seen_ids:
            goal_id = f"goal_{secrets.token_hex(4)}"
        seen_ids.add(goal_id)

        out.append({"id": goal_id, "name": name, "start_date": start_date, "end_date": end_date})
    return out


def load_goals(app_settings: dict[str, Any]) -> list[dict[str, Any]]:
    """`app_settings` is the dict already returned by analysis_tags.load_app_settings()."""
    raw = app_settings.get("goals")
    if not raw:
        return []
    try:
        return normalize_goals(raw)
    except ValueError:
        return []
