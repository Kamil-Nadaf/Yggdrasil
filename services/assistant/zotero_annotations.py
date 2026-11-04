"""Two-way annotation sync with Zotero: pure conversion + merge logic (HTTP lives in reading.py).

Our annotations (annotations.json) carry, besides the on-screen fractions (`rects`, `pts`), a Zotero-style
`zpos` in PDF user-space units (written by the PDF viewer, which knows the page geometry):
  highlight/underline/note/text:  {"pageIndex": 0, "rects": [[x1, y1, x2, y2], ...], "ph": <page height>}
  ink:                            {"pageIndex": 0, "paths": [[x, y, x, y, ...]], "ph": <page height>}
Annotations that came from Zotero carry `zkey`. Per item, `zotero-sync.json` remembers, for every synced annotation,
the Zotero version and a hash of our side at the time — that is how we tell "changed here" from "changed there"
and "deleted here" from "never synced".
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

ZOTERO_COLORS = ["#ffd400", "#ff6666", "#5fb236", "#2ea8e5", "#a28ae5", "#e56eee", "#f19837", "#aaaaaa"]
KIND_TO_ZOTERO = {"highlight": "highlight", "underline": "underline", "note": "note", "text": "text", "ink": "ink"}
ZOTERO_TO_KIND = {"highlight": "highlight", "underline": "underline", "note": "note", "text": "text", "ink": "ink", "image": "area"}


def nearest_color(hex_color: str) -> str:
    """Zotero's palette colour closest to ours (its UI only offers these eight)."""
    try:
        n = int(hex_color.lstrip("#")[:6], 16)
        rgb = ((n >> 16) & 255, (n >> 8) & 255, n & 255)
    except ValueError:
        return ZOTERO_COLORS[0]

    def dist(c: str) -> int:
        m = int(c[1:], 16)
        return sum((a - b) ** 2 for a, b in zip(rgb, ((m >> 16) & 255, (m >> 8) & 255, m & 255)))

    return min(ZOTERO_COLORS, key=dist)


def local_hash(a: dict[str, Any]) -> str:
    keep = {k: a.get(k) for k in ("kind", "color", "note", "text", "zpos")}
    return hashlib.sha1(json.dumps(keep, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _position(a: dict[str, Any]) -> Optional[dict[str, Any]]:
    z = a.get("zpos")
    if not isinstance(z, dict) or "pageIndex" not in z:
        return None
    kind = a.get("kind") or "highlight"
    pos: dict[str, Any] = {"pageIndex": int(z["pageIndex"])}
    if kind == "ink":
        paths = z.get("paths")
        if not paths:
            return None
        pos.update(paths=paths, width=2)
    else:
        rects = z.get("rects")
        if not rects:
            return None
        pos["rects"] = rects
        if kind == "text":
            pos.update(fontSize=12, rotation=0)
    return pos


def _sort_index(pos: dict[str, Any], ph: float) -> str:
    ys = []
    if "rects" in pos:
        ys = [r[3] for r in pos["rects"]]
    elif "paths" in pos:
        ys = [p[i] for p in pos["paths"] for i in range(1, len(p), 2)]
    top = max(0, int((ph or 0) - max(ys))) if ys and ph else 0
    return f"{pos['pageIndex']:05d}|000000|{top:05d}"


def to_zotero(a: dict[str, Any], att_key: str) -> Optional[dict[str, Any]]:
    """The Zotero item for one of our annotations, or None if it can't be represented (area, no geometry yet)."""
    kind = a.get("kind") or "highlight"
    zt = KIND_TO_ZOTERO.get(kind)
    pos = _position(a)
    if not zt or not pos:
        return None
    z = a["zpos"]
    body = (a.get("text") or "") if kind != "text" else ""
    comment = (a.get("note") or "") if kind != "text" else (a.get("text") or "")
    return {
        "itemType": "annotation",
        "parentItem": att_key,
        "annotationType": zt,
        "annotationText": body,
        "annotationComment": comment,
        "annotationColor": nearest_color(a.get("color") or ZOTERO_COLORS[0]),
        "annotationPageLabel": str(pos["pageIndex"] + 1),
        "annotationSortIndex": _sort_index(pos, float(z.get("ph") or 0)),
        "annotationPosition": json.dumps(pos, separators=(",", ":")),
        "tags": [],
    }


def from_zotero(d: dict[str, Any], key: str) -> Optional[dict[str, Any]]:
    kind = ZOTERO_TO_KIND.get(d.get("annotationType", ""))
    if not kind:
        return None
    try:
        pos = json.loads(d.get("annotationPosition") or "{}")
        page = int(pos["pageIndex"]) + 1
    except (ValueError, KeyError, TypeError):
        return None
    text = d.get("annotationText") or ""
    note = d.get("annotationComment") or ""
    if kind == "text":
        text, note = (note or text), ""
    return {
        "id": f"z-{key}", "kind": kind, "page": page, "rects": [], "text": text, "note": note,
        "color": d.get("annotationColor") or ZOTERO_COLORS[0], "created": d.get("dateAdded") or "",
        "zkey": key, "zpos": pos,
    }


def merge(local: list[dict[str, Any]], remote_rows: list[dict[str, Any]], state_items: dict[str, dict[str, Any]], att_key: str) -> dict[str, Any]:
    """Plan one item's sync. `remote_rows`: [{"key", "version", "data"}]. Nothing is sent here — see the returned plan."""
    remote = {r["key"]: r for r in remote_rows}
    stats = dict(pulled=0, updated_local=0, deleted_local=0, deleted_remote=0, needs_open=0, unsupported=0)
    out: list[dict[str, Any]] = []
    create: list[tuple[str, dict[str, Any]]] = []
    update: list[tuple[str, int, dict[str, Any]]] = []
    delete: list[tuple[str, int]] = []
    state: dict[str, dict[str, Any]] = {}
    seen_local = {a.get("zkey") for a in local if a.get("zkey")}

    for a in local:
        zk = a.get("zkey")
        if zk and zk in remote:
            r = remote[zk]
            prev = state_items.get(zk)
            remote_changed = prev is None or r["version"] != prev["version"]
            if remote_changed:
                new = from_zotero(r["data"], zk)
                if new is None:
                    out.append(a)
                    continue
                merged = {**a, "kind": new["kind"], "page": new["page"], "text": new["text"], "note": new["note"], "zpos": new["zpos"]}
                if nearest_color(a.get("color") or "") != new["color"]:
                    merged["color"] = new["color"]
                same_geo = _geo(a.get("zpos")) == _geo(new["zpos"])
                if not same_geo:
                    merged["rects"] = []
                    merged.pop("pts", None)
                if merged != a:
                    stats["updated_local"] += 1
                out.append(merged)
                state[zk] = {"version": r["version"], "hash": local_hash(merged)}
                continue
            out.append(a)
            if local_hash(a) != prev["hash"]:
                z = to_zotero(a, att_key)
                if z:
                    update.append((zk, r["version"], z))
                    continue
            state[zk] = prev
            continue
        if zk:  # we know it, Zotero no longer has it
            if zk in state_items:
                stats["deleted_local"] += 1
                continue
            a = {k: v for k, v in a.items() if k != "zkey"}
        out.append(a)
        if (a.get("kind") or "highlight") not in KIND_TO_ZOTERO:
            stats["unsupported"] += 1
            continue
        z = to_zotero(a, att_key)
        if z is None:
            stats["needs_open"] += 1
            continue
        create.append((a["id"], z))

    for zk, r in remote.items():
        if zk in seen_local:
            continue
        if zk in state_items:
            delete.append((zk, r["version"]))
            stats["deleted_remote"] += 1
            continue
        new = from_zotero(r["data"], zk)
        if new:
            out.append(new)
            state[zk] = {"version": r["version"], "hash": local_hash(new)}
            stats["pulled"] += 1
    return {"annotations": out, "create": create, "update": update, "delete": delete, "state": state, "stats": stats}


def _geo(z: Any) -> str:
    if not isinstance(z, dict):
        return ""
    return json.dumps({k: z.get(k) for k in ("pageIndex", "rects", "paths")}, sort_keys=True)
