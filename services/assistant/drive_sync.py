"""Two-way Google Drive sync of the Yggdrasil vault.

The whole vault (notes, tasks, papers, ...) is mirrored into one Drive folder
("Yggdrasil Vault" by default). Every device that signs in with the same Google
OAuth client sees the same folder, so a phone and a computer converge on the
same data.

Design
------
* Scope is ``drive.file``: the app can only see files *it* created — it never
  gets access to the rest of the user's Drive.
* Each device keeps a manifest (path -> content md5 at the last successful
  sync). Comparing local / remote / manifest gives a classic three-way merge:
    - only one side changed          -> copy it across
    - both changed (different bytes) -> newest wins, the loser is kept as
                                        "name (conflict <host> <time>).ext"
    - deleted on one side, untouched on the other -> deletion propagates
      (local deletions go to ``.ygg-config/sync-trash``, remote ones to the
      Drive bin), and a mass-deletion guard asks for confirmation first.
* Nothing is ever read from or written to ``.git``, ``.ygg-config`` or the
  search index.
* HTTP goes through httpx and is injectable, so the whole algorithm is unit
  tested against a fake Drive.
"""
import hashlib
import json
import os
import secrets
import shutil
import socket
import stat as statmod
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlencode

import httpx

from task_sync import GOOGLE_AUTH, GOOGLE_TOKEN, AuthError, _b64url, _token

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
API = "https://www.googleapis.com/drive/v3"
UPLOAD = "https://www.googleapis.com/upload/drive/v3"
FOLDER = "application/vnd.google-apps.folder"
SKIP_DIRS = {".git", ".ygg-config", "index", "node_modules", "__pycache__", ".trash"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}
SKIP_SUFFIXES = (".tmp", "~", ".lock")
PAPERS_BOOKS = ("10-Papers", "15-Books")  # live in Zotero; only synced here when the user opts in
APP_SETTINGS_REL = "_app/settings.json"  # virtual file: task statuses, goals, tags... from .ygg-config/settings.json
SETTINGS_SKIP_KEYS = {"client_prefs"}  # per-device UI prefs; also holds AI provider keys, so never uploaded
MAX_BYTES = 200 * 1024 * 1024
SMALL_UPLOAD = 5 * 1024 * 1024
MIN_DELETE_GUARD = 25  # deletions above max(this, 30% of tracked files) need confirmation

_RUN_LOCK = threading.Lock()
_PROGRESS: dict = {"phase": "", "done": 0, "total": 0}


def skip_top_for(cfg: dict) -> tuple:
    """Top-level vault folders this sync leaves alone. Papers live in Zotero; books go to Drive, iCloud or Zotero."""
    if cfg.get("sync_papers_books"):  # legacy "sync both" setting
        return ()
    return ("10-Papers",) if cfg.get("books_storage") == "drive" else PAPERS_BOOKS
_PENDING: dict[str, dict] = {}


class DriveError(Exception):
    pass


# ── config / state ──────────────────────────────────────────────────────────

def default_config() -> dict:
    return {
        "client_id": "", "client_secret": "",  # empty = reuse the Task Sync Google credentials
        "refresh_token": "", "needs_reconnect": False, "connected_at": "",
        "root_name": "Yggdrasil Vault", "root_id": "",
        "auto": False, "interval_minutes": 15, "sync_papers_books": False,
        "books_storage": "zotero", "icloud_dir": "", "initial_done": False, "icloud_last": None,
        "last_run": None, "last_result": None,
    }


def load_config(path: Path) -> dict:
    cfg = default_config()
    try:
        cfg.update(json.loads(Path(path).read_text()))
    except Exception:
        pass
    return cfg


def _atomic_write(path: Path, text: str, private: bool = False) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_text(text)
    if private:
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
    os.replace(tmp, path)


def save_config(path: Path, cfg: dict) -> None:
    _atomic_write(path, json.dumps(cfg, indent=1), private=True)


def state_path(config_path: Path) -> Path:
    return Path(config_path).with_name("drive-sync-state.json")


def load_state(config_path: Path) -> dict:
    try:
        return json.loads(state_path(config_path).read_text())
    except Exception:
        return {}


def is_connected(cfg: dict, fallback: tuple[str, str] = ("", "")) -> bool:
    cid, _ = creds(cfg, fallback)
    return bool(cfg.get("refresh_token") and cid) and not cfg.get("needs_reconnect")


def builtin_client() -> tuple[str, str]:
    """The Google OAuth client shipped with the app (a "Desktop app" client), so users just click Sign in.

    Set YGG_GOOGLE_CLIENT_ID / YGG_GOOGLE_CLIENT_SECRET, or put {"client_id": ..., "client_secret": ...}
    in google_client.json next to this file. For installed apps Google does not treat the secret as confidential."""
    cid, sec = os.environ.get("YGG_GOOGLE_CLIENT_ID", ""), os.environ.get("YGG_GOOGLE_CLIENT_SECRET", "")
    if not cid:
        try:
            d = json.loads((Path(__file__).with_name("google_client.json")).read_text())
            d = d.get("installed", d)
            cid, sec = d.get("client_id", ""), d.get("client_secret", "")
        except Exception:
            pass
    return cid, sec


def creds(cfg: dict, fallback: tuple[str, str]) -> tuple[str, str]:
    b = builtin_client()
    return (cfg.get("client_id") or fallback[0] or b[0], cfg.get("client_secret") or fallback[1] or b[1])


# ── Drive client ────────────────────────────────────────────────────────────

def _check(r: httpx.Response, what: str) -> None:
    if r.status_code == 401:
        raise AuthError("access denied (401)")
    if r.status_code < 400:
        return
    reason = ""
    try:
        reason = r.json()["error"]["errors"][0]["reason"]
    except Exception:
        reason = r.text[:120]
    if reason == "storageQuotaExceeded":
        raise DriveError("Google Drive is full")
    if reason in ("accessNotConfigured", "SERVICE_DISABLED"):
        raise DriveError("Turn on the Google Drive API for your Google Cloud project")
    raise DriveError(f"{what}: HTTP {r.status_code} {reason}")


def _ts(s: str) -> float:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


class Drive:
    def __init__(self, client: httpx.Client, token: str):
        self.client, self.token = client, token

    def req(self, method: str, url: str, what: str = "request", **kw) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self.token}", **kw.pop("headers", {})}
        for attempt in range(4):
            r = self.client.request(method, url, headers=headers, timeout=120, **kw)
            retry = r.status_code in (429, 500, 502, 503, 504) or (
                r.status_code == 403 and ("rateLimitExceeded" in r.text or "userRateLimitExceeded" in r.text))
            if retry and attempt < 3:
                time.sleep(min(2 ** attempt, 8))
                continue
            _check(r, what)
            return r
        raise DriveError(what)  # pragma: no cover

    def json(self, method: str, url: str, what: str = "request", **kw) -> dict:
        r = self.req(method, url, what, **kw)
        return r.json() if r.content else {}

    def list_all(self) -> list[dict]:
        out, page = [], None
        while True:
            params = {"q": "trashed=false", "pageSize": 1000, "spaces": "drive",
                      "fields": "nextPageToken,files(id,name,mimeType,parents,md5Checksum,modifiedTime,createdTime,size)"}
            if page:
                params["pageToken"] = page
            j = self.json("GET", f"{API}/files", "list files", params=params)
            out += j.get("files", [])
            page = j.get("nextPageToken")
            if not page:
                return out

    def create_folder(self, name: str, parent: Optional[str]) -> str:
        meta = {"name": name, "mimeType": FOLDER}
        if parent:
            meta["parents"] = [parent]
        return self.json("POST", f"{API}/files", f"create folder {name}", params={"fields": "id"}, json=meta)["id"]

    def upload(self, name: str, parent: str, data: bytes, file_id: Optional[str] = None) -> dict:
        meta: dict = {} if file_id else {"name": name, "parents": [parent]}
        method = "PATCH" if file_id else "POST"
        base = f"{UPLOAD}/files" + (f"/{file_id}" if file_id else "")
        fields = "id,md5Checksum,modifiedTime"
        if len(data) <= SMALL_UPLOAD:
            boundary = secrets.token_hex(16)
            body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
                    f"--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n").encode() \
                + data + f"\r\n--{boundary}--".encode()
            r = self.req(method, f"{base}?uploadType=multipart&fields={fields}", f"upload {name}", content=body,
                         headers={"Content-Type": f"multipart/related; boundary={boundary}"})
        else:
            r0 = self.req(method, f"{base}?uploadType=resumable&fields={fields}", f"start upload {name}", json=meta,
                          headers={"X-Upload-Content-Type": "application/octet-stream"})
            r = self.req("PUT", r0.headers["Location"], f"upload {name}", content=data)
        return r.json()

    def trash(self, file_id: str) -> None:
        self.json("PATCH", f"{API}/files/{file_id}", "move to bin", json={"trashed": True})

    def download(self, file_id: str, dest: Path) -> str:
        """Stream a file to ``dest``; returns its md5."""
        h = hashlib.md5()
        with self.client.stream("GET", f"{API}/files/{file_id}", params={"alt": "media"}, timeout=120,
                                headers={"Authorization": f"Bearer {self.token}"}) as r:
            if r.status_code >= 400:
                r.read()
            _check(r, "download")
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    h.update(chunk)
                    f.write(chunk)
        return h.hexdigest()


# ── scanning ────────────────────────────────────────────────────────────────

def _md5_file(p: Path) -> str:
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_local(root: Path, prev: dict, skip_top: tuple = ()) -> tuple[dict, list[str]]:
    out: dict[str, dict] = {}
    skipped: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not (Path(dirpath) == root and d in skip_top)]
        for fn in filenames:
            if fn in SKIP_FILES or fn.endswith(SKIP_SUFFIXES) or fn.startswith(".sync-"):
                continue
            p = Path(dirpath) / fn
            try:
                st = p.lstat()
            except OSError:
                continue
            if not statmod.S_ISREG(st.st_mode):
                continue
            rel = p.relative_to(root).as_posix()
            if st.st_size > MAX_BYTES:
                skipped.append(f"{rel} (over {MAX_BYTES // 1024 // 1024} MB)")
                continue
            c = prev.get(rel)
            if c and c.get("size") == st.st_size and c.get("mt") == st.st_mtime_ns and c.get("md5"):
                md5 = c["md5"]
            else:
                try:
                    md5 = _md5_file(p)
                except OSError:
                    continue
            out[rel] = {"md5": md5, "size": st.st_size, "mt": st.st_mtime_ns, "mtime": st.st_mtime}
    return out, skipped


def _safe_name(n: str) -> bool:
    return bool(n) and n not in (".", "..") and "/" not in n and "\\" not in n and "\0" not in n


def scan_remote(items: list[dict], root_id: str) -> tuple[dict, dict, list[str]]:
    """-> (files by rel path, folder ids by rel path, notes)"""
    by_id = {i["id"]: i for i in items}
    notes: list[str] = []
    cache: dict[str, Optional[str]] = {root_id: ""}

    def path_of(i: dict) -> Optional[str]:
        iid = i["id"]
        if iid in cache:
            return cache[iid]
        cache[iid] = None  # also guards against parent cycles
        if not _safe_name(i["name"]):
            return None
        parent = (i.get("parents") or [None])[0]
        if parent in by_id:
            base = path_of(by_id[parent])
            if base is None:
                return None
        elif parent == root_id:
            base = ""
        else:
            return None  # not inside the vault folder
        cache[iid] = f"{base}/{i['name']}" if base else i["name"]
        return cache[iid]

    files: dict[str, dict] = {}
    folders: dict[str, str] = {}
    for i in items:
        if i["id"] == root_id:
            continue
        p = path_of(i)
        if p is None:
            continue
        if i.get("mimeType") == FOLDER:
            folders[p] = i["id"]
            continue
        if i.get("mimeType", "").startswith("application/vnd.google-apps") or not i.get("md5Checksum"):
            continue  # Docs/Sheets etc. can't be mirrored as bytes
        old = files.get(p)
        if old:
            notes.append(f"duplicate on Drive: {p}")
            if _ts(old.get("modifiedTime", "")) >= _ts(i.get("modifiedTime", "")):
                continue
        files[p] = i
    return files, folders, notes


# ── app settings (statuses, goals, tags …) as a virtual synced file ─────────

def _settings_file(vault: Path) -> Path:
    return vault / ".ygg-config" / "settings.json"


def _virtual_file(vault: Path) -> Path:
    return vault / ".ygg-config" / "sync-virtual" / "settings.json"


def export_settings(vault: Path) -> Optional[dict]:
    """Write the shareable part of settings.json to a canonical file; returns its scan entry (or None)."""
    src = _settings_file(vault)
    try:
        data = json.loads(src.read_text())
        mtime = src.stat().st_mtime
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    shared = {k: v for k, v in data.items() if k not in SETTINGS_SKIP_KEYS}
    if not shared:
        return None
    blob = json.dumps(shared, sort_keys=True, indent=1, ensure_ascii=False).encode()
    dest = _virtual_file(vault)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(blob)
    st = dest.stat()
    return {"md5": hashlib.md5(blob).hexdigest(), "size": len(blob), "mt": st.st_mtime_ns, "mtime": mtime}


def merge_settings(vault: Path, downloaded: Path) -> None:
    """Fold keys from another device into settings.json, leaving device-local keys alone."""
    remote = json.loads(downloaded.read_text())
    if not isinstance(remote, dict):
        raise DriveError("settings file from Drive is malformed")
    src = _settings_file(vault)
    try:
        cur = json.loads(src.read_text())
        if not isinstance(cur, dict):
            cur = {}
    except (OSError, ValueError):
        cur = {}
    cur.update({k: v for k, v in remote.items() if k not in SETTINGS_SKIP_KEYS})
    _atomic_write(src, json.dumps(cur, indent=2, ensure_ascii=False), private=True)


# ── the sync ────────────────────────────────────────────────────────────────

def _conflict_name(rel: str) -> str:
    p = Path(rel)
    stamp = datetime.now().strftime("%Y-%m-%d %H%M")
    host = (socket.gethostname().split(".")[0] or "device")[:20]
    return str(p.with_name(f"{p.stem} (conflict {host} {stamp}){p.suffix}").as_posix())


def _unique_local(root: Path, rel: str) -> str:
    cand, n = rel, 2
    while (root / cand).exists():
        p = Path(rel)
        cand = p.with_name(f"{p.stem} {n}{p.suffix}").as_posix()
        n += 1
    return cand


def access_token(cfg: dict, fallback: tuple[str, str], client: httpx.Client) -> str:
    cid, secret = creds(cfg, fallback)
    return _token(client, GOOGLE_TOKEN, {"client_id": cid, "client_secret": secret,
                                         "refresh_token": cfg["refresh_token"], "grant_type": "refresh_token"})["access_token"]


def run_sync(config_path: Path, vault: Path, fallback: tuple[str, str] = ("", ""), force: bool = False,
             client: Optional[httpx.Client] = None, workers: int = 6) -> dict:
    """Never raises: failures come back as {"ok": False, "message": ...}."""
    if not _RUN_LOCK.acquire(blocking=False):
        return {"ok": False, "busy": True, "message": "A sync is already running"}
    started = time.time()
    own = client is None
    client = client or httpx.Client()
    cfg = load_config(config_path)
    result: dict = {"ok": False, "uploaded": 0, "downloaded": 0, "deleted_local": 0, "deleted_remote": 0,
                    "conflicts": 0, "errors": [], "notes": []}
    try:
        if not is_connected(cfg, fallback):
            result["message"] = "Google Drive is not connected"
            return result
        vault = Path(vault)
        try:
            drive = Drive(client, access_token(cfg, fallback, client))
            _sync(drive, cfg, config_path, vault, result, force, workers)
        except AuthError as e:
            cfg["needs_reconnect"] = True
            result["message"] = f"Google sign-in expired — reconnect Drive ({e})"
        except (DriveError, httpx.HTTPError) as e:
            result["message"] = f"Drive sync failed: {e}"
        except Exception as e:  # noqa: BLE001
            result["message"] = f"Unexpected error: {type(e).__name__}: {e}"
        result["seconds"] = round(time.time() - started, 1)
        flipped_auto = False
        if result.get("ok") and not cfg.get("initial_done"):
            cfg["initial_done"] = True
            if not cfg.get("last_run"):
                # very first sync: everything local has just been uploaded; keep it in sync from now on
                cfg["auto"], flipped_auto, result["first_sync"] = True, True, True
                result["message"] = f"First sync done ✓ — {result['uploaded']} files uploaded to Drive. Automatic sync is now on."
        _PROGRESS.update(phase="", done=0, total=0)
        cfg["last_run"] = datetime.now().isoformat(timespec="seconds")
        slim = {k: v for k, v in result.items() if k != "notes"}
        slim["errors"] = result["errors"][:5]
        cfg["last_result"] = slim
        keys = ["needs_reconnect", "root_id", "last_run", "last_result", "initial_done"] + (["auto"] if flipped_auto else [])
        cfg = {**load_config(config_path), **{k: cfg[k] for k in keys}}
        save_config(config_path, cfg)
        return result
    finally:
        if own:
            client.close()
        _RUN_LOCK.release()


def _sync(drive: Drive, cfg: dict, config_path: Path, vault: Path, result: dict, force: bool, workers: int) -> None:
    state = load_state(config_path)
    manifest: dict[str, dict] = state.get("files", {}) if state.get("root_id") == cfg.get("root_id") else {}

    items = drive.list_all()
    root_id = cfg.get("root_id")
    ids = {i["id"] for i in items}
    if not root_id or root_id not in ids:
        cands = [i for i in items if i.get("mimeType") == FOLDER and i["name"] == cfg["root_name"]
                 and (i.get("parents") or [None])[0] not in ids]
        if cands:
            root_id = sorted(cands, key=lambda i: i.get("createdTime", ""))[0]["id"]
        else:
            root_id = drive.create_folder(cfg["root_name"], None)
            items.append({"id": root_id, "name": cfg["root_name"], "mimeType": FOLDER})
        if cfg.get("root_id") != root_id:
            manifest = {}  # a different Drive folder: start fresh (conflicts are kept, nothing deleted)
        cfg["root_id"] = root_id

    skip_top = skip_top_for(cfg)
    drop = lambda rel: rel.split("/", 1)[0] in skip_top  # noqa: E731
    remote, folders, notes = scan_remote(items, root_id)
    remote = {k: v for k, v in remote.items() if not drop(k)}
    manifest = {k: v for k, v in manifest.items() if not drop(k)}
    result["notes"] += notes
    local, skipped = scan_local(vault, manifest, skip_top)
    result["notes"] += [f"skipped {s}" for s in skipped]
    virt = export_settings(vault)
    if virt:
        local[APP_SETTINGS_REL] = virt

    def lpath(rel: str) -> Path:
        return _virtual_file(vault) if rel == APP_SETTINGS_REL else vault / rel

    up, down, del_local, del_remote, conflicts = [], [], [], [], []
    keep: dict[str, dict] = {}  # entries that need no transfer
    for rel in sorted(set(local) | set(remote) | set(manifest)):
        L, R, B = local.get(rel), remote.get(rel), manifest.get(rel)
        lm, rm, bm = (L or {}).get("md5"), (R or {}).get("md5Checksum"), (B or {}).get("md5")
        if rel == APP_SETTINGS_REL and R and not L:
            down.append((rel, R))  # never trash shared settings just because this device has none yet
            continue
        if L and R:
            if lm == rm:
                keep[rel] = {"md5": lm, "id": R["id"], "size": L["size"], "mt": L["mt"]}
            elif bm == lm:
                down.append((rel, R))
            elif bm == rm:
                up.append((rel, R["id"]))
            else:
                conflicts.append((rel, L, R))
        elif L and not R:
            if B and bm == lm:
                del_local.append(rel)
            else:
                up.append((rel, None))
        elif R and not L:
            if B and bm == rm:
                del_remote.append((rel, R["id"]))
            else:
                down.append((rel, R))

    n_del = len(del_local) + len(del_remote)
    if n_del > max(MIN_DELETE_GUARD, int(0.3 * len(manifest))) and not force:
        result.update(ok=False, needs_confirm=True, pending_deletions=n_del,
                      message=f"This sync would delete {n_del} files ({len(del_local)} here, {len(del_remote)} on Drive). "
                              f"If that's expected, run it again and confirm.")
        return

    errors = result["errors"]

    # conflicts: newest wins; the other version is kept next to it as a conflict copy
    extra_up: list[tuple[str, Optional[str]]] = []
    extra_down: list[tuple[str, dict]] = []
    for rel, L, R in conflicts:
        if rel == APP_SETTINGS_REL:  # settings: newest wins, no conflict copy
            if _ts(R.get("modifiedTime", "")) > L["mtime"]:
                down.append((rel, R))
            else:
                up.append((rel, R["id"]))
            continue
        cpy = _unique_local(vault, _conflict_name(rel))
        remote_newer = _ts(R.get("modifiedTime", "")) > L["mtime"]
        try:
            if remote_newer:
                (vault / cpy).parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(vault / rel), str(vault / cpy))
                down.append((rel, R))
            else:
                up.append((rel, R["id"]))
                extra_down.append((cpy, R))
            extra_up.append((cpy, None))
            result["conflicts"] += 1
        except OSError as e:
            errors.append(f"conflict {rel}: {e}")

    new_state: dict[str, dict] = dict(keep)

    # make sure every Drive folder we need exists (sequential: folders are cheap, races are not)
    def ensure_folder(parts: tuple[str, ...]) -> str:
        parent, built = root_id, ""
        for part in parts:
            built = f"{built}/{part}" if built else part
            if built not in folders:
                folders[built] = drive.create_folder(part, parent)
            parent = folders[built]
        return parent

    def do_download(rel: str, item: dict):
        dest = lpath(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(f".sync-{secrets.token_hex(4)}-{dest.name}")
        try:
            md5 = drive.download(item["id"], tmp)
            if md5 != item["md5Checksum"]:
                raise DriveError(f"checksum mismatch for {rel}")
            mtime = _ts(item.get("modifiedTime", "")) or time.time()
            os.utime(tmp, (mtime, mtime))
            if rel == APP_SETTINGS_REL:
                merge_settings(vault, tmp)
                tmp.unlink()
                export_settings(vault)
                # record the *remote* md5: if merging added local-only keys, the local copy now differs
                # from it, so the next run uploads the union.
                return rel, {"md5": md5, "id": item["id"], "size": 0, "mt": 0}
            os.replace(tmp, dest)
        finally:
            if tmp.exists():
                tmp.unlink()
        st = dest.stat()
        return rel, {"md5": md5, "id": item["id"], "size": st.st_size, "mt": st.st_mtime_ns}

    def do_upload(rel: str, file_id: Optional[str], parent: str):
        p = lpath(rel)
        data = p.read_bytes()
        md5 = hashlib.md5(data).hexdigest()
        st = p.stat()
        j = drive.upload(p.name, parent, data, file_id)
        return rel, {"md5": md5, "id": j["id"], "size": len(data), "mt": st.st_mtime_ns}

    def run_all(jobs: list[Callable], counter: str):
        _PROGRESS.update(phase="Uploading" if counter == "uploaded" else "Downloading", done=0, total=len(jobs))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [(ex.submit(j), tag) for j, tag in jobs]
            for fut, tag in futs:
                _PROGRESS["done"] += 1
                try:
                    rel, entry = fut.result()
                    new_state[rel] = entry
                    result[counter] += 1
                except AuthError:
                    raise
                except Exception as e:  # noqa: BLE001
                    errors.append(f"{tag}: {e}")

    # 1) downloads (including conflict losers), 2) uploads, 3) deletions
    run_all([((lambda r=r, i=i: do_download(r, i)), f"download {r}") for r, i in down + extra_down], "downloaded")
    ups = []
    for rel, fid in up + extra_up:
        if not lpath(rel).is_file():
            continue
        try:
            parent = ensure_folder(tuple(Path(rel).parts[:-1]))
        except DriveError as e:
            errors.append(f"folder for {rel}: {e}")
            continue
        ups.append(((lambda r=rel, f=fid, p=parent: do_upload(r, f, p)), f"upload {rel}"))
    run_all(ups, "uploaded")

    trash_dir = vault / ".ygg-config" / "sync-trash" / datetime.now().strftime("%Y%m%d-%H%M%S")
    for rel in del_local:
        if rel == APP_SETTINGS_REL:
            continue  # never delete local settings because Drive lacks the file
        try:
            dest = trash_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(vault / rel), str(dest))
            result["deleted_local"] += 1
        except OSError as e:
            errors.append(f"delete {rel}: {e}")
            new_state[rel] = manifest[rel]
    for rel, fid in del_remote:
        try:
            drive.trash(fid)
            result["deleted_remote"] += 1
        except AuthError:
            raise
        except Exception as e:  # noqa: BLE001
            errors.append(f"trash {rel}: {e}")
            new_state[rel] = manifest[rel]

    # anything that failed keeps its old manifest entry so the next run retries it
    for rel, B in manifest.items():
        if rel not in new_state and rel in local and rel in remote:
            new_state[rel] = B
    _atomic_write(state_path(config_path), json.dumps({"root_id": root_id, "files": new_state}))

    result["ok"] = not errors
    parts = [f"{result['uploaded']} uploaded", f"{result['downloaded']} downloaded"]
    if result["deleted_local"] or result["deleted_remote"]:
        parts.append(f"{result['deleted_local'] + result['deleted_remote']} deleted")
    if result["conflicts"]:
        parts.append(f"{result['conflicts']} conflict cop{'y' if result['conflicts'] == 1 else 'ies'} kept")
    if errors:
        parts.append(f"{len(errors)} failed")
    result["message"] = ("Synced ✓ — " if not errors else "Synced with problems — ") + ", ".join(parts)
    result["tracked"] = len(new_state)


# ── OAuth (loopback redirect to this server) ────────────────────────────────

def start_auth(cfg: dict, fallback: tuple[str, str], redirect_uri: str) -> str:
    cid, secret = creds(cfg, fallback)
    if not cid or not secret:
        raise ValueError("This build has no Google sign-in client yet. Add google_client.json (see docs) or enter your own client under Advanced.")
    verifier, state, now = secrets.token_urlsafe(64), secrets.token_urlsafe(16), time.time()
    for s in [s for s, v in _PENDING.items() if now - v["ts"] > 600]:
        _PENDING.pop(s, None)
    _PENDING[state] = {"verifier": verifier, "ts": now}
    params = {"client_id": cid, "redirect_uri": redirect_uri, "response_type": "code", "state": state,
              "scope": DRIVE_SCOPE, "access_type": "offline", "prompt": "consent",
              "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256"}
    return f"{GOOGLE_AUTH}?{urlencode(params)}"


def finish_auth(config_path: Path, fallback: tuple[str, str], code: str, state: str, redirect_uri: str,
                client: Optional[httpx.Client] = None) -> None:
    pend = _PENDING.pop(state, None)
    if not pend or time.time() - pend["ts"] > 600:
        raise ValueError("This sign-in link expired or was already used — click Connect again.")
    cfg = load_config(config_path)
    cid, secret = creds(cfg, fallback)
    own = client is None
    client = client or httpx.Client()
    try:
        tok = _token(client, GOOGLE_TOKEN, {"code": code, "client_id": cid, "client_secret": secret,
                                            "redirect_uri": redirect_uri, "grant_type": "authorization_code",
                                            "code_verifier": pend["verifier"]})
    finally:
        if own:
            client.close()
    if not tok.get("refresh_token"):
        raise ValueError("No refresh token returned — remove this app's access in your Google account and connect again.")
    cfg.update(refresh_token=tok["refresh_token"], needs_reconnect=False,
               connected_at=datetime.now().isoformat(timespec="seconds"))
    save_config(config_path, cfg)


# ── HTTP API ────────────────────────────────────────────────────────────────


def drive_quota(config_path: Path, fallback: tuple[str, str], client: Optional[httpx.Client] = None) -> dict:
    """Used / total bytes of the signed-in Google account (Drive about API). {} when not connected."""
    cfg = load_config(config_path)
    if not is_connected(cfg, fallback):
        return {}
    own = client is None
    client = client or httpx.Client()
    try:
        d = Drive(client, access_token(cfg, fallback, client))
        q = d.json("GET", "https://www.googleapis.com/drive/v3/about?fields=storageQuota", "storage quota").get("storageQuota", {})
        used = int(q.get("usage", 0) or 0)
        total = int(q["limit"]) if q.get("limit") else 0  # absent for unlimited (Workspace) plans
        return {"used": used, "total": total, "free": max(total - used, 0) if total else 0}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}
    finally:
        if own:
            client.close()


def _icloud_default() -> str:
    try:
        import icloud_sync
        return icloud_sync.default_dir()
    except Exception:
        return ""


def make_router(config_path: Callable[[], Path], get_vault: Callable[[], Path],
                get_fallback: Callable[[], tuple[str, str]], open_browser: Optional[Callable[[str], bool]] = None):
    import asyncio

    from fastapi import APIRouter, HTTPException, Request
    from fastapi.responses import HTMLResponse
    from pydantic import BaseModel

    router = APIRouter(prefix="/api/drivesync")

    def redirect_for(request: Request) -> str:
        return f'{str(request.base_url).rstrip("/")}/api/drivesync/callback'

    def view(request: Request) -> dict:
        cfg, fb = load_config(config_path()), get_fallback()
        st = load_state(config_path())
        return {
            "connected": is_connected(cfg, fb), "needs_reconnect": cfg["needs_reconnect"],
            "connected_at": cfg["connected_at"], "client_id": cfg["client_id"],
            "has_secret": bool(cfg["client_secret"]), "uses_task_sync_credentials": not cfg["client_id"] and bool(fb[0]),
            "builtin_client": bool(builtin_client()[0]),
            "root_name": cfg["root_name"], "sync_papers_books": cfg["sync_papers_books"], "auto": cfg["auto"], "interval_minutes": cfg["interval_minutes"],
            "last_run": cfg["last_run"], "last_result": cfg["last_result"],
            "tracked_files": len(st.get("files", {})), "running": _RUN_LOCK.locked(),
            "redirect_uri": redirect_for(request),
            "books_storage": cfg["books_storage"], "icloud_dir": cfg["icloud_dir"], "initial_done": cfg["initial_done"],
            "icloud_last": cfg["icloud_last"], "progress": dict(_PROGRESS), "icloud_suggested": _icloud_default(),
        }

    @router.get("/storage")
    async def storage():
        return await asyncio.to_thread(drive_quota, config_path(), get_fallback())

    @router.get("/status")
    async def status(request: Request):
        return view(request)

    class ConfigIn(BaseModel):
        client_id: str = ""
        client_secret: str = ""  # empty = keep the saved one
        root_name: str = "Yggdrasil Vault"
        auto: bool = False
        interval_minutes: int = 15
        sync_papers_books: bool = False
        books_storage: str = "zotero"  # "zotero" (not synced here) | "drive" | "icloud"
        icloud_dir: str = ""

    @router.post("/config")
    async def save(payload: ConfigIn, request: Request):
        cfg = load_config(config_path())
        cid = payload.client_id.strip()
        if cid != cfg["client_id"]:
            cfg.update(refresh_token="", connected_at="", needs_reconnect=False)
        cfg["client_id"] = cid
        if payload.client_secret.strip():
            cfg["client_secret"] = payload.client_secret.strip()
        name = payload.root_name.strip() or "Yggdrasil Vault"
        if name != cfg["root_name"]:
            cfg["root_id"] = ""
        cfg["root_name"] = name
        cfg["auto"] = payload.auto
        cfg["sync_papers_books"] = payload.sync_papers_books
        if payload.books_storage not in ("zotero", "drive", "icloud"):
            raise HTTPException(400, "Unknown books storage")
        cfg["books_storage"] = payload.books_storage
        d = payload.icloud_dir.strip()
        if payload.books_storage == "icloud":
            d = d or _icloud_default()
            if not d:
                raise HTTPException(400, "iCloud Drive wasn't found on this computer. Turn on iCloud Drive, or choose Google Drive.")
            if not Path(d).expanduser().parent.is_dir():
                raise HTTPException(400, f"Folder not found: {Path(d).expanduser().parent}")
            d = str(Path(d).expanduser())
        cfg["icloud_dir"] = d
        cfg["interval_minutes"] = min(max(payload.interval_minutes, 5), 1440)
        save_config(config_path(), cfg)
        return view(request)

    @router.post("/connect")
    async def connect(request: Request):
        try:
            url = start_auth(load_config(config_path()), get_fallback(), redirect_for(request))
        except ValueError as e:
            raise HTTPException(400, str(e))
        return {"auth_url": url, "opened": bool(open_browser and open_browser(url))}

    @router.get("/callback", response_class=HTMLResponse)
    async def callback(request: Request, code: str = "", state: str = "", error: str = ""):
        def page(msg: str, ok: bool) -> HTMLResponse:
            color = "#2e7d32" if ok else "#c62828"
            return HTMLResponse(
                f'<html><body style="font-family:system-ui;max-width:520px;margin:15vh auto;text-align:center">'
                f'<h2 style="color:{color}">{msg}</h2><p>You can close this tab and go back to Yggdrasil.</p>'
                f'<script>setTimeout(function(){{location.href="/"}}, 2500)</script></body></html>')
        if error or not code:
            return page(f"Sign-in cancelled ({error or 'no code'})", False)
        try:
            await asyncio.to_thread(finish_auth, config_path(), get_fallback(), code, state, redirect_for(request))
        except Exception as e:  # noqa: BLE001
            return page(f"Could not connect: {e}", False)
        # first connection: start uploading everything right away (progress shows in Settings)
        threading.Thread(target=run_all, args=(config_path(), get_vault(), get_fallback()), daemon=True).start()
        return page("Google Drive connected — uploading your files…", True)

    @router.post("/disconnect")
    async def disconnect(request: Request):
        cfg = load_config(config_path())
        cfg.update(refresh_token="", connected_at="", needs_reconnect=False, root_id="", auto=False)
        save_config(config_path(), cfg)
        try:
            state_path(config_path()).unlink()
        except OSError:
            pass
        return view(request)  # files already on Drive / on disk are left untouched

    class RunIn(BaseModel):
        force: bool = False

    @router.post("/run")
    async def run(request: Request, payload: RunIn = RunIn()):
        result = await asyncio.to_thread(run_all, config_path(), get_vault(), get_fallback(), payload.force)
        return {"result": result, **view(request)}

    return router


def run_all(config_path: Path, vault: Path, fallback: tuple[str, str] = ("", ""), force: bool = False,
            client: Optional[httpx.Client] = None) -> dict:
    """Google Drive sync plus, when books live in iCloud, the Books <-> iCloud folder mirror."""
    cfg = load_config(config_path)
    icloud = cfg.get("books_storage") == "icloud" and bool(cfg.get("icloud_dir"))
    res = run_sync(config_path, vault, fallback, force, client) if (is_connected(cfg, fallback) or not icloud) else None
    if not icloud:
        return res  # type: ignore[return-value]
    import icloud_sync

    _PROGRESS.update(phase="Syncing books with iCloud", done=0, total=0)
    try:
        r2 = icloud_sync.run_mirror(Path(vault) / "15-Books", Path(cfg["icloud_dir"]),
                                    Path(config_path).with_name("books-icloud-state.json"),
                                    Path(vault) / ".ygg-config" / "sync-trash", force)
    except Exception as e:  # noqa: BLE001
        r2 = {"ok": False, "message": f"iCloud sync failed: {type(e).__name__}: {e}", "errors": []}
    finally:
        _PROGRESS.update(phase="", done=0, total=0)
    c = load_config(config_path)
    c["icloud_last"] = {"at": datetime.now().isoformat(timespec="seconds"), "ok": r2["ok"], "message": r2["message"]}
    if res is None:
        c["last_run"] = c["icloud_last"]["at"]
        c["last_result"] = {k: v for k, v in r2.items() if k != "notes"}
    save_config(config_path, c)
    if res is None:
        return r2
    out = dict(res)
    for k in ("uploaded", "downloaded", "deleted_local", "deleted_remote", "conflicts"):
        out[k] = res.get(k, 0) + r2.get(k, 0)
    out["errors"] = list(res.get("errors", [])) + list(r2.get("errors", []))
    out["ok"] = bool(res.get("ok")) and bool(r2["ok"])
    out["needs_confirm"] = bool(res.get("needs_confirm") or r2.get("needs_confirm"))
    out["message"] = f"{res.get('message', '')} · {r2['message']}"
    return out


def auto_due(config_path: Path, fallback: tuple[str, str] = ("", "")) -> bool:
    cfg = load_config(config_path)
    icloud_only = cfg.get("books_storage") == "icloud" and bool(cfg.get("icloud_dir"))
    if not (cfg["auto"] and (is_connected(cfg, fallback) or icloud_only)):
        return False
    if not cfg["last_run"]:
        return True
    try:
        age = (datetime.now() - datetime.fromisoformat(cfg["last_run"])).total_seconds()
    except ValueError:
        return True
    return age >= cfg["interval_minutes"] * 60
