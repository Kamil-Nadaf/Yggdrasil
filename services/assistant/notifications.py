"""Deadline reminders for the Yggdrasil desktop app.

The helpers here have no I/O (which items are due, the message text, which
reminders were already shown), so they are unit-tested directly. Delivery goes
through `notify_desktop()`, which never raises: in Docker or a browser, or when
the OS tool is missing, it just reports that nothing was shown.
"""
from __future__ import annotations

import base64
import os
import platform
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

OVERDUE = "overdue"
TODAY = "today"
TOMORROW = "tomorrow"
_BUCKET_ORDER = (OVERDUE, TODAY, TOMORROW)
_BUCKET_LABEL = {OVERDUE: "overdue", TODAY: "due today", TOMORROW: "due tomorrow"}

_KEEP_SENT_DAYS = 3        # dedupe keys older than this are pruned
_MAX_LINES = 4             # item names listed in one notification before "…and N more"
_CREATE_NO_WINDOW = 0x08000000

# Windows: a tray balloon via NotifyIcon. Title/body/icon come in as environment
# variables so no user-controlled text is ever spliced into the script.
_WINDOWS_BALLOON = r"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$icon = $env:YGG_NOTIFY_ICON
if ($icon -and (Test-Path $icon)) {
  $n.Icon = New-Object System.Drawing.Icon($icon)
} else {
  $n.Icon = [System.Drawing.SystemIcons]::Information
}
$n.Visible = $true
$n.ShowBalloonTip(8000, $env:YGG_NOTIFY_TITLE, $env:YGG_NOTIFY_BODY, [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Seconds 9
$n.Dispose()
"""


def parse_deadline(value) -> Optional[date]:
    """'YYYY-MM-DD' (or an ISO datetime) → date; anything else → None."""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def deadline_bucket(deadline, today: date) -> Optional[str]:
    """Overdue / today / tomorrow for a deadline; None when it is further out or unset."""
    due = parse_deadline(deadline)
    if due is None:
        return None
    delta = (due - today).days
    if delta < 0:
        return OVERDUE
    if delta == 0:
        return TODAY
    if delta == 1:
        return TOMORROW
    return None


def reminder_key(item: dict, bucket: str, today: date) -> str:
    """One reminder per item, per bucket, per day. A bucket change (tomorrow → today)
    counts as new, so the reminder fires again when the deadline is actually close."""
    return f"{item['kind']}:{item['id']}|{item.get('deadline')}|{bucket}|{today.isoformat()}"


def due_reminders(items: list[dict], today: date, sent: dict) -> tuple[list[tuple[str, dict]], list[str]]:
    """Open items that need a reminder and have not been shown yet.

    Returns (reminders, keys). `reminders` is a list of (bucket, item); `keys` are
    the dedupe keys to record once the notification has actually been delivered."""
    reminders: list[tuple[str, dict]] = []
    keys: list[str] = []
    for item in items:
        if item.get("done"):
            continue
        bucket = deadline_bucket(item.get("deadline"), today)
        if bucket is None:
            continue
        key = reminder_key(item, bucket, today)
        if key in sent or key in keys:
            continue
        reminders.append((bucket, item))
        keys.append(key)
    return reminders, keys


def build_message(reminders: list[tuple[str, dict]]) -> tuple[str, str]:
    """Title and body for one combined notification."""
    counts = {b: 0 for b in _BUCKET_ORDER}
    for bucket, _ in reminders:
        counts[bucket] += 1
    summary = " · ".join(f"{counts[b]} {_BUCKET_LABEL[b]}" for b in _BUCKET_ORDER if counts[b])
    lines = [f"{item.get('name') or 'Untitled'} ({_BUCKET_LABEL[bucket]})" for bucket, item in reminders[:_MAX_LINES]]
    if len(reminders) > _MAX_LINES:
        lines.append(f"…and {len(reminders) - _MAX_LINES} more")
    return "Yggdrasil — deadlines", "\n".join([summary, *lines])


def prune_sent(sent: dict, today: date) -> dict:
    """Keep only recent dedupe keys so the state file does not grow forever."""
    cutoff = (today - timedelta(days=_KEEP_SENT_DAYS)).isoformat()
    return {key: day for key, day in sent.items() if str(day) >= cutoff}


def _powershell_args(script: str) -> list[str]:
    """Run a script without shell quoting: -EncodedCommand takes base64 of UTF-16LE."""
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded]


def notify_desktop(title: str, body: str, icon: Optional[Path] = None) -> bool:
    """Show a native notification. True when a notifier was launched, False otherwise.

    Launches the OS tool detached (no waiting), so the caller never blocks."""
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(
                [
                    "osascript",
                    "-e", "on run argv",
                    "-e", "display notification (item 2 of argv) with title (item 1 of argv)",
                    "-e", "end run",
                    title,
                    body,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        if system == "Linux":
            if not shutil.which("notify-send"):
                return False
            args = ["notify-send", "-a", "Yggdrasil"]
            if icon and Path(icon).exists():
                args += ["-i", str(icon)]
            subprocess.Popen(
                [*args, title, body],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        if system == "Windows":
            env = {**os.environ, "YGG_NOTIFY_TITLE": title, "YGG_NOTIFY_BODY": body}
            if icon and Path(icon).exists():
                env["YGG_NOTIFY_ICON"] = str(icon)
            subprocess.Popen(
                _powershell_args(_WINDOWS_BALLOON),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=_CREATE_NO_WINDOW,
            )
            return True
    except Exception:
        return False
    return False
