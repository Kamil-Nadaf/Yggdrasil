import { useCallback, useEffect, useRef, useState } from "react";

interface GoogleStatus {
  client_id: string; has_secret: boolean; connected: boolean; needs_reconnect: boolean;
  calendar: boolean; tasks: boolean; connected_at: string; redirect_uri: string;
}
interface MicrosoftStatus {
  client_id: string; connected: boolean; needs_reconnect: boolean; todo: boolean;
  connected_at: string; redirect_uri: string;
}
interface RunResult {
  at: string;
  targets: Record<string, { created: number; updated: number; deleted: number; unchanged: number }>;
  errors: string[];
}
interface Status {
  reminder_time: string; remind_days_before: number[]; auto: boolean;
  google: GoogleStatus; microsoft: MicrosoftStatus; last_run: RunResult | null;
}

const DAY_OPTIONS: { d: number; label: string }[] = [
  { d: 0, label: "On the day" },
  { d: 1, label: "1 day before" },
  { d: 2, label: "2 days before" },
];

async function call<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const r = await fetch(`/api/tasksync/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `Request failed (${r.status})`);
  return j as T;
}

function summarize(r: RunResult): string {
  const parts = Object.entries(r.targets).map(([name, s]) => {
    const bits = [s.created && `${s.created} added`, s.updated && `${s.updated} updated`, s.deleted && `${s.deleted} removed`]
      .filter(Boolean).join(", ");
    return `${name}: ${bits || `up to date (${s.unchanged})`}`;
  });
  return parts.length ? parts.join(" · ") : "Nothing is connected yet.";
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="tasksync-copy">
      <span className="muted">{label}</span>
      <code>{value}</code>
      <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); window.setTimeout(() => setDone(false), 1200); }}>
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function TaskSyncSettings() {
  const [st, setSt] = useState<Status | null>(null);
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<number[]>([0, 1]);
  const [auto, setAuto] = useState(true);
  const [gId, setGId] = useState("");
  const [gSecret, setGSecret] = useState("");
  const [gCal, setGCal] = useState(true);
  const [gTasks, setGTasks] = useState(true);
  const [mId, setMId] = useState("");
  const [mTodo, setMTodo] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const poll = useRef<number | null>(null);

  const apply = useCallback((s: Status, keepForm = false) => {
    setSt(s);
    if (keepForm) return;
    setTime(s.reminder_time); setDays(s.remind_days_before); setAuto(s.auto);
    setGId(s.google.client_id); setGCal(s.google.calendar); setGTasks(s.google.tasks);
    setMId(s.microsoft.client_id); setMTodo(s.microsoft.todo);
  }, []);

  useEffect(() => {
    call<Status>("status").then((s) => apply(s)).catch((e) => setMsg({ ok: false, text: String(e.message || e) }));
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, [apply]);

  function form() {
    return {
      reminder_time: time, remind_days_before: days, auto,
      google: { client_id: gId, client_secret: gSecret, calendar: gCal, tasks: gTasks },
      microsoft: { client_id: mId, todo: mTodo },
    };
  }

  async function save(quiet = false) {
    const s = await call<Status>("config", "POST", form());
    setGSecret("");
    apply(s);
    if (!quiet) setMsg({ ok: true, text: "Saved." });
    return s;
  }

  async function wrap(key: string, fn: () => Promise<void>) {
    setBusy(key); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(""); }
  }

  async function connect(provider: "google" | "microsoft") {
    await wrap(provider, async () => {
      await save(true);
      const r = await call<{ auth_url: string; opened: boolean }>(`connect/${provider}`, "POST");
      if (!r.opened) window.open(r.auth_url, "_blank", "noopener");
      setMsg({ ok: true, text: "Finish signing in in the browser window that opened — this page updates when you're done." });
      if (poll.current) window.clearInterval(poll.current);
      let n = 0;
      poll.current = window.setInterval(async () => {
        n += 1;
        try {
          const s = await call<Status>("status");
          if (s[provider].connected || n > 90) {
            if (poll.current) window.clearInterval(poll.current);
            apply(s, true);
            if (s[provider].connected) setMsg({ ok: true, text: `${provider === "google" ? "Google" : "Microsoft"} connected.` });
          }
        } catch { /* keep polling */ }
      }, 2000);
    });
  }

  async function disconnect(provider: "google" | "microsoft") {
    await wrap(provider, async () => { apply(await call<Status>(`disconnect/${provider}`, "POST"), true); setMsg({ ok: true, text: "Disconnected. Items already created stay in your account." }); });
  }

  async function syncNow() {
    await wrap("run", async () => {
      await save(true);
      const r = await call<{ result: RunResult } & Status>("run", "POST");
      apply(r, true);
      setMsg({ ok: r.result.errors.length === 0, text: r.result.errors.length ? r.result.errors.slice(0, 3).join(" | ") : summarize(r.result) });
    });
  }

  if (!st) return <div className="settings-info">{msg ? msg.text : "Loading…"}</div>;

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  const pill = (connected: boolean, needs: boolean) => (
    <span className={`mcp-status${connected ? " configured" : ""}`}>
      {needs ? "⚠ Sign in again" : connected ? "● Connected" : "○ Not connected"}
    </span>
  );

  return (
    <div className="tasksync">
      <div className="settings-info" style={{ marginBottom: 12 }}>
        One-way sync: every task and subtask with a deadline is mirrored to your phone, and ticking it off here completes it there.
        Changes made on the phone are not copied back. Needs the app to be running (a Mac mini or always-on server works well).
      </div>

      <div className="settings-item">
        <label htmlFor="tsTime">Reminder time</label>
        <input id="tsTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ maxWidth: 140 }} />
        <div className="tasksync-days">
          {DAY_OPTIONS.map((o) => (
            <label key={o.d}><input type="checkbox" checked={days.includes(o.d)} onChange={() => toggleDay(o.d)} /> {o.label}</label>
          ))}
        </div>
        <div className="settings-info">Deadlines have no time of day, so reminders fire at this time. Microsoft To Do supports one reminder per task (the earliest ticked).</div>
        <label style={{ marginTop: 8 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Sync automatically every 15 minutes</label>
      </div>

      <div className="tasksync-card">
        <div className="tasksync-card-head"><strong>Google</strong> {pill(st.google.connected, st.google.needs_reconnect)}</div>
        <div className="settings-info">Calendar events with pop-up reminders, plus a Google Tasks list. Shows in the Calendar and Tasks apps on Android.</div>
        <details className="tasksync-help">
          <summary>One-time setup (Google Cloud, free)</summary>
          <ol>
            <li>Open <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a>, create a project, and enable <b>Google Calendar API</b> and <b>Google Tasks API</b>.</li>
            <li>APIs &amp; Services → <b>OAuth consent screen</b>: choose External, add yourself as a test user, then set publishing status to <b>In production</b> (otherwise sign-in expires every 7 days). The "unverified app" warning is expected for your own app.</li>
            <li>Credentials → Create credentials → <b>OAuth client ID</b> → type <b>Web application</b>. Add the redirect URI below, then paste the client ID and secret here.</li>
          </ol>
        </details>
        <CopyField label="Redirect URI" value={st.google.redirect_uri} />
        <label htmlFor="tsGid">Client ID</label>
        <input id="tsGid" type="text" value={gId} onChange={(e) => setGId(e.target.value)} placeholder="1234…apps.googleusercontent.com" />
        <label htmlFor="tsGsec">Client secret</label>
        <input id="tsGsec" type="password" value={gSecret} onChange={(e) => setGSecret(e.target.value)} placeholder={st.google.has_secret ? "Saved — leave blank to keep" : "GOCSPX-…"} autoComplete="off" />
        <div className="tasksync-days">
          <label><input type="checkbox" checked={gCal} onChange={(e) => setGCal(e.target.checked)} /> Calendar events</label>
          <label><input type="checkbox" checked={gTasks} onChange={(e) => setGTasks(e.target.checked)} /> Google Tasks</label>
        </div>
        <div className="tasksync-actions">
          <button type="button" className="btn btn-primary" disabled={busy !== "" || !gId.trim() || (!st.google.has_secret && !gSecret.trim())} onClick={() => void connect("google")}>
            {busy === "google" ? "…" : st.google.connected || st.google.needs_reconnect ? "Reconnect Google" : "Connect Google"}
          </button>
          {(st.google.connected || st.google.needs_reconnect) && <button type="button" className="btn" disabled={busy !== ""} onClick={() => void disconnect("google")}>Disconnect</button>}
        </div>
      </div>

      <div className="tasksync-card">
        <div className="tasksync-card-head"><strong>Microsoft To Do</strong> {pill(st.microsoft.connected, st.microsoft.needs_reconnect)}</div>
        <div className="settings-info">A list called “Yggdrasil” with due dates and a reminder, in the To Do app on Android (personal or work account).</div>
        <details className="tasksync-help">
          <summary>One-time setup (Azure, free)</summary>
          <ol>
            <li>Open <a href="https://entra.microsoft.com/" target="_blank" rel="noopener noreferrer">entra.microsoft.com</a> → App registrations → <b>New registration</b>. Supported account types: <b>Any organizational directory and personal Microsoft accounts</b>.</li>
            <li>Redirect URI: platform <b>Mobile and desktop applications</b> (public client), value as shown below. Under Authentication, enable <b>Allow public client flows</b>.</li>
            <li>API permissions → Microsoft Graph → Delegated → <b>Tasks.ReadWrite</b> and <b>offline_access</b>.</li>
            <li>Copy the <b>Application (client) ID</b> here. No secret is needed.</li>
          </ol>
        </details>
        <CopyField label="Redirect URI" value={st.microsoft.redirect_uri} />
        <label htmlFor="tsMid">Application (client) ID</label>
        <input id="tsMid" type="text" value={mId} onChange={(e) => setMId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        <div className="tasksync-days">
          <label><input type="checkbox" checked={mTodo} onChange={(e) => setMTodo(e.target.checked)} /> Sync to Microsoft To Do</label>
        </div>
        <div className="tasksync-actions">
          <button type="button" className="btn btn-primary" disabled={busy !== "" || !mId.trim()} onClick={() => void connect("microsoft")}>
            {busy === "microsoft" ? "…" : st.microsoft.connected || st.microsoft.needs_reconnect ? "Reconnect Microsoft" : "Connect Microsoft"}
          </button>
          {(st.microsoft.connected || st.microsoft.needs_reconnect) && <button type="button" className="btn" disabled={busy !== ""} onClick={() => void disconnect("microsoft")}>Disconnect</button>}
        </div>
      </div>

      <div className="tasksync-actions">
        <button type="button" className="btn" disabled={busy !== ""} onClick={() => void wrap("save", async () => { await save(); })}>Save</button>
        <button type="button" className="btn btn-primary" disabled={busy !== "" || (!st.google.connected && !st.microsoft.connected)} onClick={() => void syncNow()}>
          {busy === "run" ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {msg && <div className={msg.ok ? "ok mono" : "crit mono"} style={{ fontSize: 12, marginTop: 8 }}>{msg.text}</div>}
      {st.last_run && (
        <div className="settings-info" style={{ marginTop: 8 }}>
          Last sync {new Date(st.last_run.at).toLocaleString()} — {summarize(st.last_run)}
          {st.last_run.errors.length > 0 && <div className="crit">{st.last_run.errors.slice(0, 3).join(" | ")}</div>}
        </div>
      )}
    </div>
  );
}
