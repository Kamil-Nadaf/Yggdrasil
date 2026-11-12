"""Two-way mirror of the Books folder with a folder in iCloud Drive (macOS/Windows iCloud client).

iCloud itself uploads the folder to the cloud, so "syncing to iCloud" is a safe three-way file mirror between
``<vault>/15-Books`` and a folder the user picks inside iCloud Drive. Same rules as the Google Drive sync:
a change on one side is copied to the other, a file changed on both sides keeps both versions (the older one as
"name (conflict …)"), deletions are mirrored (to a trash folder, never destroyed) and a mass deletion asks first.
Files macOS has evicted to save space (".name.icloud" placeholders) are left alone, never treated as deleted.
"""
from __future__ import annotations

import json
import os
import shutil
import secrets
from datetime import datetime
from pathlib import Path

from drive_sync import MIN_DELETE_GUARD, _atomic_write, _conflict_name, _md5_file, _unique_local, scan_local

ICLOUD_ROOT = Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs"


def default_dir() -> str:
    """Suggested folder: <iCloud Drive>/Yggdrasil Books, when iCloud Drive exists on this computer."""
    return str(ICLOUD_ROOT / "Yggdrasil Books") if ICLOUD_ROOT.is_dir() else ""


def _evicted(root: Path) -> set[str]:
    out = set()
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if fn.startswith(".") and fn.endswith(".icloud") and len(fn) > 8:
                out.add((Path(dirpath) / fn[1:-7]).relative_to(root).as_posix())
    return out


def _copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f".sync-{secrets.token_hex(4)}-{dst.name}")
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
    finally:
        if tmp.exists():
            tmp.unlink()


def run_mirror(local: Path, remote: Path, state_file: Path, trash_root: Path, force: bool = False) -> dict:
    """-> {"ok","message","uploaded"(local→iCloud),"downloaded"(iCloud→local),"deleted_*","conflicts","errors", ...}"""
    res: dict = {"ok": False, "uploaded": 0, "downloaded": 0, "deleted_local": 0, "deleted_remote": 0,
                 "conflicts": 0, "errors": [], "notes": []}
    local, remote = Path(local), Path(remote)
    if not remote.parent.is_dir():
        res["message"] = f"iCloud folder not found: {remote.parent}. Is iCloud Drive turned on?"
        return res
    local.mkdir(parents=True, exist_ok=True)
    remote.mkdir(parents=True, exist_ok=True)
    try:
        st = json.loads(Path(state_file).read_text())
    except Exception:
        st = {}
    prev_a, prev_b = st.get("a", {}), st.get("b", {})
    A, _ = scan_local(local, prev_a)
    B, _ = scan_local(remote, prev_b)
    evicted = _evicted(remote)
    B = {k: v for k, v in B.items() if not (Path(k).name.startswith(".") and k.endswith(".icloud"))}
    if evicted:
        res["notes"].append(f"{len(evicted)} files are stored only in iCloud (not downloaded on this Mac yet)")

    ups, downs, del_a, del_b, conflicts, keep = [], [], [], [], [], {}
    for rel in sorted(set(A) | set(B) | set(prev_a)):
        a, b, base = A.get(rel), B.get(rel), (prev_a.get(rel) or {}).get("md5")
        if rel in evicted and not b:
            if a:  # the iCloud copy exists but isn't downloaded: don't overwrite or delete it
                keep[rel] = None
            continue
        if a and b:
            if a["md5"] == b["md5"]:
                keep[rel] = (a, b)
            elif base == a["md5"]:
                downs.append(rel)
            elif base == b["md5"]:
                ups.append(rel)
            else:
                conflicts.append((rel, a, b))
        elif a and not b:
            (del_a if base and base == a["md5"] else ups).append(rel)
        elif b and not a:
            (del_b if base and base == b["md5"] else downs).append(rel)

    n_del = len(del_a) + len(del_b)
    if n_del > max(MIN_DELETE_GUARD, int(0.3 * len(prev_a))) and not force:
        res.update(needs_confirm=True, pending_deletions=n_del,
                   message=f"Syncing books with iCloud would delete {n_del} files. If that's expected, run it again and confirm.")
        return res

    err = res["errors"]
    for rel, a, b in conflicts:
        remote_newer = b["mtime"] > a["mtime"]
        cpy = _unique_local(local, _conflict_name(rel))
        try:
            if remote_newer:
                (local / cpy).parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(local / rel), str(local / cpy))
                downs.append(rel)
            else:
                _copy(remote / rel, local / cpy)
                ups.append(rel)
            ups.append(cpy)
            res["conflicts"] += 1
        except OSError as e:
            err.append(f"conflict {rel}: {e}")

    def stamp(rel: str) -> tuple[dict, dict]:
        pa, pb = local / rel, remote / rel
        sa, sb = pa.stat(), pb.stat()
        m = _md5_file(pa)
        return ({"md5": m, "size": sa.st_size, "mt": sa.st_mtime_ns}, {"md5": m, "size": sb.st_size, "mt": sb.st_mtime_ns})

    new_a: dict = {}
    new_b: dict = {}
    for rel, v in keep.items():
        if v:
            new_a[rel] = {k: v[0][k] for k in ("md5", "size", "mt")}
            new_b[rel] = {k: v[1][k] for k in ("md5", "size", "mt")}
        elif rel in prev_a:
            new_a[rel] = prev_a[rel]
    for rel in ups:
        try:
            _copy(local / rel, remote / rel)
            new_a[rel], new_b[rel] = stamp(rel)
            res["uploaded"] += 1
        except OSError as e:
            err.append(f"to iCloud {rel}: {e}")
    for rel in downs:
        try:
            _copy(remote / rel, local / rel)
            new_a[rel], new_b[rel] = stamp(rel)
            res["downloaded"] += 1
        except OSError as e:
            err.append(f"from iCloud {rel}: {e}")
    trash = Path(trash_root) / datetime.now().strftime("%Y%m%d-%H%M%S") / "15-Books"
    for side, rels, key in ((local, del_a, "deleted_local"), (remote, del_b, "deleted_remote")):
        for rel in rels:
            try:
                dest = trash / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(side / rel), str(dest))
                res[key] += 1
            except OSError as e:
                err.append(f"delete {rel}: {e}")
                if rel in prev_a:
                    new_a[rel] = prev_a[rel]
    for rel, v in prev_a.items():  # failed transfers keep their old entry so the next run retries
        if rel not in new_a and rel in A and rel in B:
            new_a[rel], new_b[rel] = v, prev_b.get(rel, v)
    _atomic_write(Path(state_file), json.dumps({"a": new_a, "b": new_b}))
    res["ok"] = not err
    parts = [f"{res['uploaded']} to iCloud", f"{res['downloaded']} from iCloud"]
    if res["deleted_local"] or res["deleted_remote"]:
        parts.append(f"{res['deleted_local'] + res['deleted_remote']} deleted")
    if res["conflicts"]:
        parts.append(f"{res['conflicts']} conflict cop{'y' if res['conflicts'] == 1 else 'ies'} kept")
    if err:
        parts.append(f"{len(err)} failed")
    res["message"] = ("Books synced with iCloud ✓ — " if not err else "Books synced with problems — ") + ", ".join(parts)
    return res
