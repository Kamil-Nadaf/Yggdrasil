"""
gate.py — CERIC Gate enforcement.

The Gate is the integrity mechanism of the CERIC reading system.
DO NOT MODIFY THE PASS CONDITION. DO NOT ADD BYPASS PARAMETERS.

A paper passes the Gate if and only if:
  1. All five CERIC slots (claim, evidence, reasoning, implications, context)
     are present and non-empty after .strip()
  2. aq_written is True in frontmatter

This module is called by /api/examine. It raises GateError (HTTP 423) if
the paper does not pass. No other code path should ever call the Anthropic API.
"""

from pathlib import Path
import frontmatter


CERIC_SLOTS = ["claim", "evidence", "reasoning", "implications", "context"]


class GateError(Exception):
    """Raised when the CERIC gate check fails. HTTP 423 Locked."""

    def __init__(self, missing_slots: list[str], aq_missing: bool):
        self.missing_slots = missing_slots
        self.aq_missing = aq_missing
        parts = []
        if missing_slots:
            parts.append(f"CERIC slots not filled: {', '.join(missing_slots)}")
        if aq_missing:
            parts.append("Adversarial question not written (aq_written must be true)")
        super().__init__("; ".join(parts))


def check_gate(note_path: Path) -> None:
    """
    Check whether a paper note passes the CERIC gate.

    Args:
        note_path: Path to the .md file for the paper.

    Raises:
        FileNotFoundError: If the note does not exist.
        GateError: If the gate check fails (HTTP 423 should be returned to client).
    """
    if not note_path.exists():
        raise FileNotFoundError(f"Note not found: {note_path}")

    post = frontmatter.load(str(note_path))
    fm = post.metadata

    missing_slots = []
    for slot in CERIC_SLOTS:
        value = fm.get(slot, "")
        if not isinstance(value, str) or not value.strip():
            missing_slots.append(slot)

    aq_missing = not bool(fm.get("aq_written", False))

    if missing_slots or aq_missing:
        raise GateError(missing_slots=missing_slots, aq_missing=aq_missing)

    # Gate passed — caller may proceed to Anthropic API.
