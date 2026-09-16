"""
gate.py — Active-reading Gate enforcement.

DO NOT ADD BYPASS PARAMETERS. The pass condition is always:
  1. Every configured analysis slot is a non-empty string after .strip()
  2. aq_written is True in frontmatter

Slot names default to the classic CERIC five, but may be supplied by the
caller from vault settings (analysis_tags → lowercase keys). Enforcement
stays hard either way.
"""

from pathlib import Path
from typing import Optional, Sequence

import frontmatter


DEFAULT_SLOTS = ["claim", "evidence", "reasoning", "implications", "context"]
# Back-compat alias
CERIC_SLOTS = DEFAULT_SLOTS


class GateError(Exception):
    """Raised when the gate check fails. HTTP 423 Locked."""

    def __init__(self, missing_slots: list[str], aq_missing: bool):
        self.missing_slots = missing_slots
        self.aq_missing = aq_missing
        parts = []
        if missing_slots:
            parts.append(f"Analysis slots not filled: {', '.join(missing_slots)}")
        if aq_missing:
            parts.append("Adversarial question not written (aq_written must be true)")
        super().__init__("; ".join(parts))


def check_gate(note_path: Path, slots: Optional[Sequence[str]] = None) -> None:
    """
    Check whether a paper note passes the active-reading gate.

    Args:
        note_path: Path to the .md file for the paper.
        slots: Frontmatter keys that must be non-empty. Defaults to classic
            CERIC keys when omitted.

    Raises:
        FileNotFoundError: If the note does not exist.
        GateError: If the gate check fails (HTTP 423 should be returned to client).
    """
    if not note_path.exists():
        raise FileNotFoundError(f"Note not found: {note_path}")

    post = frontmatter.load(str(note_path))
    fm = post.metadata
    required = list(slots) if slots else list(DEFAULT_SLOTS)

    missing_slots = []
    for slot in required:
        value = fm.get(slot, "")
        if not isinstance(value, str) or not value.strip():
            missing_slots.append(slot)

    aq_missing = not bool(fm.get("aq_written", False))

    if missing_slots or aq_missing:
        raise GateError(missing_slots=missing_slots, aq_missing=aq_missing)

    # Gate passed — caller may proceed to Anthropic API.
