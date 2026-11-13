"""Projects: a Tasks project (80-Tasks/<slug>/) plus everything tagged or filed under it.

Papers and books join a project through an ordinary item tag ``project:<slug>``, notes live in
60-Meta/Notes/Projects/<slug>/, documents in 50-Projects/<slug>/files/ and LaTeX drafts are linked
from the project's _project.md. This module holds the pure helpers; the routes live in main.py.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional

PROJECT_TAG_PREFIX = "project:"
DONE_STATUS = "done"
SOON_DAYS = 7


def tag_for(slug: str) -> str:
    return f"{PROJECT_TAG_PREFIX}{slug}"


def project_slugs_of(tags: Any) -> list[str]:
    """Project slugs carried by an item's tags, in order, without duplicates."""
    out: list[str] = []
    for t in tags or []:
        if isinstance(t, str) and t.startswith(PROJECT_TAG_PREFIX):
            s = t[len(PROJECT_TAG_PREFIX):].strip()
            if s and s not in out:
                out.append(s)
    return out


def parse_day(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and len(value) >= 10:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def due_state(deadline: Any, today: date, soon_days: int = SOON_DAYS) -> Optional[str]:
    """'overdue' (before today), 'soon' (within soon_days, today included) or None."""
    d = parse_day(deadline)
    if d is None:
        return None
    if d < today:
        return "overdue"
    if (d - today).days <= soon_days:
        return "soon"
    return None


def _status_of(fm: dict) -> str:
    return str(fm.get("status_id") or fm.get("status") or "")


def summarize_tasks(mains: list[tuple[str, dict]], subs: list[dict], today: date) -> dict[str, Any]:
    """Counts for one project from its main-task and subtask frontmatter.

    Progress counts leaves: a main task with subtasks is measured by them, one without by itself.
    Overdue / due-soon count every open item with a deadline, main tasks and subtasks alike.
    """
    by_main: dict[str, list[dict]] = {}
    for s in subs:
        by_main.setdefault(str(s.get("main_task_id") or ""), []).append(s)
    leaves = done = overdue = soon = starred = 0
    next_deadline: Optional[date] = None

    def look(fm: dict) -> None:
        nonlocal overdue, soon, next_deadline
        if _status_of(fm) == DONE_STATUS:
            return
        st = due_state(fm.get("deadline"), today)
        if st == "overdue":
            overdue += 1
        elif st == "soon":
            soon += 1
        d = parse_day(fm.get("deadline"))
        if d is not None and d >= today and (next_deadline is None or d < next_deadline):
            next_deadline = d

    for mid, fm in mains:
        if fm.get("is_active"):
            starred += 1
        children = by_main.get(mid, [])
        leaf_items = children if children else [fm]
        for it in leaf_items:
            leaves += 1
            if _status_of(it) == DONE_STATUS:
                done += 1
        look(fm)
        for c in children:
            look(c)
    return {
        "main_count": len(mains),
        "task_count": leaves,
        "done_count": done,
        "progress": round(100 * done / leaves) if leaves else 0,
        "overdue": overdue,
        "due_soon": soon,
        "starred": starred,
        "next_deadline": next_deadline.isoformat() if next_deadline else None,
    }


_SAFE_NAME = re.compile(r"[^A-Za-z0-9._ ()\-]+")


def safe_filename(name: str) -> str:
    """A file name that cannot escape its folder; '' when nothing usable is left."""
    base = (name or "").replace("\\", "/").split("/")[-1].strip()
    base = _SAFE_NAME.sub("_", base).strip(" .")
    return base[:120]


def clean_latex_links(raw: Any) -> list[str]:
    """Folder names under 70-LaTeX linked to a project (no paths, no duplicates)."""
    out: list[str] = []
    for x in raw or []:
        if not isinstance(x, str):
            continue
        name = x.strip().strip("/")
        if not name or ".." in name.split("/") or "\\" in name or name in out:
            continue
        out.append(name[:200])
    return out[:50]
