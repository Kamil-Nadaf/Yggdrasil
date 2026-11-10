"""One-way task sync: Yggdrasil deadlines -> Google Calendar, Google Tasks, Microsoft To Do.

Each task or subtask with a deadline becomes:
  * a timed Google Calendar event at the configured reminder time, with popup reminders;
  * a Google Task (due date);
  * a Microsoft To Do task in a list called "Yggdrasil" (due date + a reminder).
Completing a task in Yggdrasil completes it remotely (and removes the calendar
event); deleting it, or clearing its deadline, deletes the remote copies.
Nothing is ever read back or modified on the remote side except items this
module created (tracked by id in the config's "map").

OAuth uses your own client IDs (Google Cloud / Azure app registration) and a
loopback redirect to this server, so no secret ever leaves your machine other
than to Google/Microsoft themselves. HTTP goes through httpx and is fully
injectable, so the sync logic is unit-tested against a fake server.
"""
import base64
import hashlib
import json
import os
import secrets
import threading
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks"
GCAL = "https://www.googleapis.com/calendar/v3"
GTASKS = "https://tasks.googleapis.com/tasks/v1"
MS_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MS_SCOPES = "offline_access Tasks.ReadWrite"
GRAPH = "https://graph.microsoft.com/v1.0"
MS_LIST_NAME = "Yggdrasil"

KEEP_DONE_DAYS = 7  # completed tasks stay mirrored this long, then are removed from Tasks / To Do
EVENT_MINUTES = 30

_LOCK = threading.Lock()
_PENDING: dict[str, dict] = {}  # OAuth state -> {provider, verifier, ts}


class NotFound(Exception):
    """The remote item no longer exists (deleted on the phone/web)."""


class AuthError(Exception):
    """Refresh/access token rejected — the account must be reconnected."""


# ── config ──────────────────────────────────────────────────────────────────

def default_config() -> dict:
    return {
        "reminder_time": "09:00",
        "remind_days_before": [0, 1],
        "auto": True,
        "google": {"client_id": "", "client_secret": "", "refresh_token": "", "calendar": True, "tasks": True,
                   "needs_reconnect": False, "connected_at": ""},
        "microsoft": {"client_id": "", "refresh_token": "", "todo": True, "needs_reconnect": False, "connected_at": ""},
        "map": {"gcal": {}, "gtasks": {}, "mstodo": {}},
        "last_run": None,
    }


def load_config(path: Path) -> dict:
    cfg = default_config()
    try:
        raw = json.loads(Path(path).read_text())
    except Exception:
        return cfg
    for k, v in raw.items():
        if isinstance(v, dict) and isinstance(cfg.get(k), dict):
            cfg[k].update(v)
        else:
            cfg[k] = v
    for k in ("gcal", "gtasks", "mstodo"):
        cfg["map"].setdefault(k, {})
    return cfg


def save_config(path: Path, cfg: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=1))
    try:
        os.chmod(tmp, 0o600)  # holds refresh tokens + client secret
    except OSError:
        pass
    os.replace(tmp, path)


def is_connected(cfg: dict, provider: str) -> bool:
    p = cfg[provider]
    return bool(p.get("refresh_token") and p.get("client_id")) and not p.get("needs_reconnect")


def parse_hhmm(value: str) -> dtime:
    try:
        h, m = str(value).split(":")
        return dtime(int(h), int(m))
    except Exception:
        return dtime(9, 0)


def local_tz():
    name = os.environ.get("TZ", "")
    if name:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    return datetime.now().astimezone().tzinfo or timezone.utc


# ── what to sync ────────────────────────────────────────────────────────────

def build_specs(items: list[dict], cfg: dict) -> dict[str, dict]:
    """ref -> spec for every task/subtask with a deadline."""
    rt = parse_hhmm(cfg["reminder_time"])
    days = sorted({int(d) for d in cfg["remind_days_before"] if 0 <= int(d) <= 28}) or [0]
    out: dict[str, dict] = {}
    for it in items:
        try:
            due = date.fromisoformat(str(it["deadline"])[:10])
        except (KeyError, ValueError):
            continue
        ref = f'{it.get("project_slug", "")}/{it["id"]}'
        notes = f'Project: {it.get("project_name", "")}'
        if it.get("kind") == "subtask" and it.get("main_task_name"):
            notes += f'\nTask: {it["main_task_name"]}'
        notes += "\n\nSynced from Yggdrasil"
        spec = {
            "ref": ref,
            "title": (it.get("name") or "").strip() or "(untitled)",
            "notes": notes,
            "due": due,
            "done": bool(it.get("done")),
            "time": rt,
            "days": days,
        }
        spec["fp"] = hashlib.sha1(
            json.dumps([spec["title"], notes, due.isoformat(), spec["done"], rt.isoformat(), days]).encode()
        ).hexdigest()
        out[ref] = spec
    return out


def _utc_iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.0000000")


# ── remote targets ──────────────────────────────────────────────────────────

class _Api:
    def __init__(self, client: httpx.Client, token: str):
        self.client, self.token = client, token

    def call(self, method: str, url: str, **kw) -> dict:
        r = self.client.request(method, url, headers={"Authorization": f"Bearer {self.token}"}, timeout=30, **kw)
        if r.status_code in (404, 410):
            raise NotFound(url)
        if r.status_code == 401:
            raise AuthError("access denied (401)")
        r.raise_for_status()
        return r.json() if r.content else {}


class GoogleCalendar:
    key, label = "gcal", "Google Calendar"

    def __init__(self, api: _Api, tz):
        self.api, self.tz = api, tz

    def wants(self, spec: dict, today: date) -> bool:
        return not spec["done"] and spec["due"] >= today

    def keep(self, spec: dict, today: date) -> bool:
        return self.wants(spec, today)

    def _body(self, spec: dict) -> dict:
        start = datetime.combine(spec["due"], spec["time"], tzinfo=self.tz)
        end = start + timedelta(minutes=EVENT_MINUTES)
        return {
            "summary": spec["title"],
            "description": spec["notes"],
            "start": {"dateTime": start.isoformat()},
            "end": {"dateTime": end.isoformat()},
            "reminders": {"useDefault": False,
                          "overrides": [{"method": "popup", "minutes": d * 1440} for d in spec["days"][:5]]},
            "extendedProperties": {"private": {"yggRef": spec["ref"]}},
        }

    def create(self, spec: dict) -> str:
        return self.api.call("POST", f"{GCAL}/calendars/primary/events", json=self._body(spec))["id"]

    def update(self, rid: str, spec: dict) -> None:
        self.api.call("PUT", f"{GCAL}/calendars/primary/events/{rid}", json=self._body(spec))

    def delete(self, rid: str) -> None:
        self.api.call("DELETE", f"{GCAL}/calendars/primary/events/{rid}")


class GoogleTasks:
    key, label = "gtasks", "Google Tasks"

    def __init__(self, api: _Api):
        self.api = api

    def wants(self, spec: dict, today: date) -> bool:
        return True

    def keep(self, spec: dict, today: date) -> bool:
        return (not spec["done"]) or spec["due"] >= today - timedelta(days=KEEP_DONE_DAYS)

    def _body(self, spec: dict, update: bool) -> dict:
        body = {
            "title": spec["title"],
            "notes": spec["notes"],
            "due": f'{spec["due"].isoformat()}T00:00:00.000Z',
            "status": "completed" if spec["done"] else "needsAction",
        }
        if update and not spec["done"]:
            body["completed"] = None  # re-open a task that was ticked off before
        return body

    def create(self, spec: dict) -> str:
        return self.api.call("POST", f"{GTASKS}/lists/@default/tasks", json=self._body(spec, False))["id"]

    def update(self, rid: str, spec: dict) -> None:
        self.api.call("PATCH", f"{GTASKS}/lists/@default/tasks/{rid}", json=self._body(spec, True))

    def delete(self, rid: str) -> None:
        self.api.call("DELETE", f"{GTASKS}/lists/@default/tasks/{rid}")


class MicrosoftTodo:
    key, label = "mstodo", "Microsoft To Do"

    def __init__(self, api: _Api, tz):
        self.api, self.tz = api, tz
        self.list_id = ""

    def ensure_list(self) -> None:
        found = self.api.call("GET", f"{GRAPH}/me/todo/lists", params={"$filter": f"displayName eq '{MS_LIST_NAME}'"})
        vals = found.get("value") or []
        self.list_id = vals[0]["id"] if vals else self.api.call(
            "POST", f"{GRAPH}/me/todo/lists", json={"displayName": MS_LIST_NAME})["id"]

    def wants(self, spec: dict, today: date) -> bool:
        return True

    def keep(self, spec: dict, today: date) -> bool:
        return (not spec["done"]) or spec["due"] >= today - timedelta(days=KEEP_DONE_DAYS)

    def _body(self, spec: dict) -> dict:
        # Microsoft supports a single reminder: use the earliest one configured.
        remind_at = datetime.combine(spec["due"] - timedelta(days=max(spec["days"])), spec["time"], tzinfo=self.tz)
        body = {
            "title": spec["title"],
            "body": {"content": spec["notes"], "contentType": "text"},
            "status": "completed" if spec["done"] else "notStarted",
            "dueDateTime": {"dateTime": f'{spec["due"].isoformat()}T00:00:00.0000000', "timeZone": "UTC"},
            "isReminderOn": not spec["done"],
        }
        if not spec["done"]:
            body["reminderDateTime"] = {"dateTime": _utc_iso(remind_at), "timeZone": "UTC"}
        return body

    def create(self, spec: dict) -> str:
        return self.api.call("POST", f"{GRAPH}/me/todo/lists/{self.list_id}/tasks", json=self._body(spec))["id"]

    def update(self, rid: str, spec: dict) -> None:
        self.api.call("PATCH", f"{GRAPH}/me/todo/lists/{self.list_id}/tasks/{rid}", json=self._body(spec))

    def delete(self, rid: str) -> None:
        self.api.call("DELETE", f"{GRAPH}/me/todo/lists/{self.list_id}/tasks/{rid}")


# ── sync engine ─────────────────────────────────────────────────────────────

def sync_target(target, specs: dict[str, dict], mapping: dict, today: date, errors: list[str]) -> dict:
    stats = {"created": 0, "updated": 0, "deleted": 0, "unchanged": 0}

    def drop(ref: str) -> None:
        try:
            target.delete(mapping[ref]["id"])
        except NotFound:
            pass
        mapping.pop(ref, None)
        stats["deleted"] += 1

    for ref, spec in specs.items():
        try:
            m = mapping.get(ref)
            if not target.keep(spec, today):
                if m:
                    drop(ref)
                continue
            if not target.wants(spec, today):
                if m:
                    drop(ref)
                continue
            if m is None:
                if spec["done"]:
                    continue  # never mirrored and already finished: nothing to show on the phone
                mapping[ref] = {"id": target.create(spec), "fp": spec["fp"]}
                stats["created"] += 1
            elif m.get("fp") == spec["fp"]:
                stats["unchanged"] += 1
            else:
                try:
                    target.update(m["id"], spec)
                except NotFound:
                    m["id"] = target.create(spec)  # it was deleted on the phone; put it back
                m["fp"] = spec["fp"]
                stats["updated"] += 1
        except AuthError:
            raise
        except Exception as e:  # one bad item must not stop the rest
            errors.append(f'{target.label}: "{spec["title"]}": {e}')
    for ref in [r for r in mapping if r not in specs]:
        try:
            drop(ref)
        except AuthError:
            raise
        except Exception as e:
            errors.append(f"{target.label}: remove {ref}: {e}")
    return stats


def _token(client: httpx.Client, url: str, data: dict) -> dict:
    r = client.post(url, data=data, timeout=30)
    if r.status_code in (400, 401):
        raise AuthError(f"token refused ({r.status_code}): {r.text[:160]}")
    r.raise_for_status()
    return r.json()


def google_access_token(cfg: dict, client: httpx.Client) -> str:
    g = cfg["google"]
    return _token(client, GOOGLE_TOKEN, {
        "client_id": g["client_id"], "client_secret": g["client_secret"],
        "refresh_token": g["refresh_token"], "grant_type": "refresh_token",
    })["access_token"]


def microsoft_access_token(cfg: dict, client: httpx.Client) -> str:
    m = cfg["microsoft"]
    tok = _token(client, MS_TOKEN, {
        "client_id": m["client_id"], "refresh_token": m["refresh_token"],
        "grant_type": "refresh_token", "scope": MS_SCOPES,
    })
    if tok.get("refresh_token"):
        m["refresh_token"] = tok["refresh_token"]  # Microsoft rotates refresh tokens
    return tok["access_token"]


def run_sync(config_path: Path, items: list[dict], today: Optional[date] = None,
             client: Optional[httpx.Client] = None) -> dict:
    """One full pass over every connected target. Never raises; problems are reported in the result."""
    with _LOCK:
        cfg = load_config(config_path)
        today = today or date.today()
        specs = build_specs(items, cfg)
        tz = local_tz()
        own = client is None
        client = client or httpx.Client()
        result: dict = {"at": datetime.now().isoformat(timespec="seconds"), "targets": {}, "errors": []}
        try:
            plan: list[tuple[str, Callable[[], list]]] = []
            if is_connected(cfg, "google") and (cfg["google"]["calendar"] or cfg["google"]["tasks"]):
                def google_targets():
                    api = _Api(client, google_access_token(cfg, client))
                    ts = []
                    if cfg["google"]["calendar"]:
                        ts.append(GoogleCalendar(api, tz))
                    if cfg["google"]["tasks"]:
                        ts.append(GoogleTasks(api))
                    return ts
                plan.append(("google", google_targets))
            if is_connected(cfg, "microsoft") and cfg["microsoft"]["todo"]:
                def ms_targets():
                    t = MicrosoftTodo(_Api(client, microsoft_access_token(cfg, client)), tz)
                    t.ensure_list()
                    return [t]
                plan.append(("microsoft", ms_targets))
            for provider, make in plan:
                try:
                    for target in make():
                        result["targets"][target.label] = sync_target(
                            target, specs, cfg["map"][target.key], today, result["errors"])
                except AuthError as e:
                    cfg[provider]["needs_reconnect"] = True
                    result["errors"].append(f"{provider.title()}: sign in again ({e})")
                except Exception as e:
                    result["errors"].append(f"{provider.title()}: {e}")
                save_config(config_path, cfg)
        finally:
            if own:
                client.close()
        cfg["last_run"] = result
        save_config(config_path, cfg)
        return result


# ── OAuth (loopback redirect to this server) ────────────────────────────────

def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def start_auth(provider: str, cfg: dict, redirect_uri: str) -> str:
    client_id = cfg[provider]["client_id"].strip()
    if not client_id:
        raise ValueError(f"Enter the {provider.title()} client ID first.")
    verifier = secrets.token_urlsafe(64)
    state = secrets.token_urlsafe(16)
    now = time.time()
    for s in [s for s, v in _PENDING.items() if now - v["ts"] > 600]:
        _PENDING.pop(s, None)
    _PENDING[state] = {"provider": provider, "verifier": verifier, "ts": now}
    params = {
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "state": state,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256",
    }
    if provider == "google":
        params.update(scope=GOOGLE_SCOPES, access_type="offline", prompt="consent")
        return f"{GOOGLE_AUTH}?{urlencode(params)}"
    params.update(scope=MS_SCOPES, prompt="select_account")
    return f"{MS_AUTH}?{urlencode(params)}"


def finish_auth(config_path: Path, provider: str, code: str, state: str, redirect_uri: str,
                client: Optional[httpx.Client] = None) -> None:
    pend = _PENDING.pop(state, None)
    if not pend or pend["provider"] != provider or time.time() - pend["ts"] > 600:
        raise ValueError("This sign-in link expired or was already used — click Connect again.")
    cfg = load_config(config_path)
    p = cfg[provider]
    data = {"code": code, "client_id": p["client_id"], "redirect_uri": redirect_uri,
            "grant_type": "authorization_code", "code_verifier": pend["verifier"]}
    url = GOOGLE_TOKEN
    if provider == "google":
        data["client_secret"] = p["client_secret"]
    else:
        url, data["scope"] = MS_TOKEN, MS_SCOPES
    own = client is None
    client = client or httpx.Client()
    try:
        tok = _token(client, url, data)
    finally:
        if own:
            client.close()
    if not tok.get("refresh_token"):
        raise ValueError("No refresh token returned — remove the app's access in your account and connect again.")
    p["refresh_token"] = tok["refresh_token"]
    p["needs_reconnect"] = False
    p["connected_at"] = datetime.now().isoformat(timespec="seconds")
    save_config(config_path, cfg)


# ── HTTP API ────────────────────────────────────────────────────────────────

def make_router(config_path: Callable[[], Path], get_items: Callable[[], list[dict]],
                open_browser: Optional[Callable[[str], bool]] = None):
    import asyncio

    from fastapi import APIRouter, HTTPException, Request
    from fastapi.responses import HTMLResponse
    from pydantic import BaseModel

    router = APIRouter(prefix="/api/tasksync")

    def redirect_for(request: Request, provider: str) -> str:
        return f'{str(request.base_url).rstrip("/")}/api/tasksync/callback/{provider}'

    def view(cfg: dict, request: Request) -> dict:
        g, m = cfg["google"], cfg["microsoft"]
        return {
            "reminder_time": cfg["reminder_time"],
            "remind_days_before": cfg["remind_days_before"],
            "auto": cfg["auto"],
            "google": {"client_id": g["client_id"], "has_secret": bool(g["client_secret"]),
                       "connected": is_connected(cfg, "google"), "needs_reconnect": g["needs_reconnect"],
                       "calendar": g["calendar"], "tasks": g["tasks"], "connected_at": g["connected_at"],
                       "redirect_uri": redirect_for(request, "google")},
            "microsoft": {"client_id": m["client_id"], "connected": is_connected(cfg, "microsoft"),
                          "needs_reconnect": m["needs_reconnect"], "todo": m["todo"],
                          "connected_at": m["connected_at"], "redirect_uri": redirect_for(request, "microsoft")},
            "last_run": cfg["last_run"],
        }

    @router.get("/status")
    async def status(request: Request):
        return view(load_config(config_path()), request)

    class GoogleIn(BaseModel):
        client_id: str = ""
        client_secret: str = ""  # empty = keep the saved one
        calendar: bool = True
        tasks: bool = True

    class MicrosoftIn(BaseModel):
        client_id: str = ""
        todo: bool = True

    class ConfigIn(BaseModel):
        reminder_time: str = "09:00"
        remind_days_before: list[int] = [0, 1]
        auto: bool = True
        google: GoogleIn = GoogleIn()
        microsoft: MicrosoftIn = MicrosoftIn()

    @router.post("/config")
    async def save(payload: ConfigIn, request: Request):
        cfg = load_config(config_path())
        cfg["reminder_time"] = payload.reminder_time if len(payload.reminder_time) == 5 else "09:00"
        cfg["remind_days_before"] = sorted({d for d in payload.remind_days_before if 0 <= d <= 28}) or [0]
        cfg["auto"] = payload.auto
        g, m = cfg["google"], cfg["microsoft"]
        if payload.google.client_id.strip() != g["client_id"]:
            g.update(refresh_token="", connected_at="", needs_reconnect=False)  # different app: old token is useless
        g["client_id"] = payload.google.client_id.strip()
        if payload.google.client_secret.strip():
            g["client_secret"] = payload.google.client_secret.strip()
        g["calendar"], g["tasks"] = payload.google.calendar, payload.google.tasks
        if payload.microsoft.client_id.strip() != m["client_id"]:
            m.update(refresh_token="", connected_at="", needs_reconnect=False)
        m["client_id"] = payload.microsoft.client_id.strip()
        m["todo"] = payload.microsoft.todo
        save_config(config_path(), cfg)
        return view(cfg, request)

    @router.post("/connect/{provider}")
    async def connect(provider: str, request: Request):
        if provider not in ("google", "microsoft"):
            raise HTTPException(404, "Unknown provider")
        cfg = load_config(config_path())
        if provider == "google" and not cfg["google"]["client_secret"]:
            raise HTTPException(400, "Enter and save the Google client secret first.")
        try:
            url = start_auth(provider, cfg, redirect_for(request, provider))
        except ValueError as e:
            raise HTTPException(400, str(e))
        opened = bool(open_browser and open_browser(url))
        return {"auth_url": url, "opened": opened}

    @router.get("/callback/{provider}", response_class=HTMLResponse)
    async def callback(provider: str, request: Request, code: str = "", state: str = "", error: str = ""):
        def page(msg: str, ok: bool) -> HTMLResponse:
            color = "#2e7d32" if ok else "#c62828"
            return HTMLResponse(
                f'<html><body style="font-family:system-ui;max-width:520px;margin:15vh auto;text-align:center">'
                f'<h2 style="color:{color}">{msg}</h2><p>You can close this tab and go back to Yggdrasil.</p>'
                f'<script>setTimeout(function(){{location.href="/"}}, 2500)</script></body></html>')
        if provider not in ("google", "microsoft"):
            return page("Unknown provider", False)
        if error or not code:
            return page(f"Sign-in cancelled ({error or 'no code'})", False)
        try:
            await asyncio.to_thread(finish_auth, config_path(), provider, code, state, redirect_for(request, provider))
        except Exception as e:
            return page(f"Could not connect: {e}", False)
        return page(f"{provider.title()} connected", True)

    @router.post("/disconnect/{provider}")
    async def disconnect(provider: str, request: Request):
        if provider not in ("google", "microsoft"):
            raise HTTPException(404, "Unknown provider")
        cfg = load_config(config_path())
        cfg[provider].update(refresh_token="", connected_at="", needs_reconnect=False)
        for k in ({"google": ("gcal", "gtasks"), "microsoft": ("mstodo",)})[provider]:
            cfg["map"][k] = {}  # forget ids; already-created remote items are left in place
        save_config(config_path(), cfg)
        return view(cfg, request)

    @router.post("/run")
    async def run(request: Request):
        result = await asyncio.to_thread(run_sync, config_path(), get_items())
        return {"result": result, **view(load_config(config_path()), request)}

    return router


def auto_sync_due(config_path: Path) -> bool:
    cfg = load_config(config_path)
    return bool(cfg["auto"] and (is_connected(cfg, "google") or is_connected(cfg, "microsoft")))
