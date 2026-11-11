import { useEffect, useRef, useState } from "react";
import { driveApi, refreshDriveStatus, runDriveSync, setDriveStatus, useDriveSync, type DriveStatus } from "../lib/driveSync";

const INTERVALS = [5, 15, 30, 60, 240];

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

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

export default function DriveSyncSettings() {
  const { status: st, running } = useDriveSync();
  const [cid, setCid] = useState("");
  const [secret, setSecret] = useState("");
  const [folder, setFolder] = useState("Yggdrasil Vault");
  const [auto, setAuto] = useState(false);
  const [papers, setPapers] = useState(false);
  const [every, setEvery] = useState(15);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  const poll = useRef<number | null>(null);

  function fill(s: DriveStatus) {
    setCid(s.client_id); setFolder(s.root_name); setAuto(s.auto); setPapers(s.sync_papers_books); setEvery(s.interval_minutes);
  }

  useEffect(() => {
    void refreshDriveStatus();
    return () => { if (poll.current) window.clearInterval(poll.current); };
  }, []);
  useEffect(() => {
    if (st && !loaded.current) { loaded.current = true; fill(st); }
  }, [st]);

  async function save(quiet = false) {
    const s = await driveApi<DriveStatus>("config", "POST", {
      client_id: cid, client_secret: secret, root_name: folder, auto, interval_minutes: every, sync_papers_books: papers,
    });
    setSecret("");
    setDriveStatus(s);
    fill(s);
    if (!quiet) setMsg({ ok: true, text: "Saved." });
  }

  async function wrap(fn: () => Promise<void>) {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  }

  async function connect() {
    if (!hasCreds) {
      setMsg({ ok: false, text: "This build doesn't include Google sign-in yet. Open “Advanced” below and paste your own Google client, or install a build that ships with one." });
      return;
    }
    await wrap(async () => {
      await save(true);
      const r = await driveApi<{ auth_url: string; opened: boolean }>("connect", "POST");
      if (!r.opened) window.open(r.auth_url, "_blank", "noopener");
      setMsg({ ok: true, text: "Finish signing in in the browser window that opened — this page updates when you're done." });
      if (poll.current) window.clearInterval(poll.current);
      let n = 0;
      poll.current = window.setInterval(async () => {
        n += 1;
        try {
          const s = await driveApi<DriveStatus>("status");
          if (s.connected || n > 90) {
            if (poll.current) window.clearInterval(poll.current);
            setDriveStatus(s);
            if (s.connected) setMsg({ ok: true, text: "Google Drive connected. Press Sync now to upload your vault." });
          }
        } catch { /* keep polling */ }
      }, 2000);
    });
  }

  async function disconnect() {
    await wrap(async () => {
      setDriveStatus(await driveApi<DriveStatus>("disconnect", "POST"));
      setMsg({ ok: true, text: "Disconnected. Your files on Drive and on this computer are untouched." });
    });
  }

  if (!st) return <div className="settings-info">Loading…</div>;

  const hasCreds = !!(cid.trim() && (st.has_secret || secret.trim())) || st.uses_task_sync_credentials || st.builtin_client;
  const connected = st.connected || st.needs_reconnect;
  const r = st.last_result;

  return (
    <div className="tasksync">
      <div className="settings-info" style={{ marginBottom: 12 }}>
        Two-way sync of your notes, tasks, LaTeX, goals, task statuses/tags and other app data with one Google Drive folder. Papers and books are not included by default: they stay in sync through Zotero (use the sync button in Collection). Use the <b>Sync</b> button next to
        Settings, or turn on automatic sync. Sign in with the same Google account on another device to see the same folder. Only files
        Yggdrasil itself puts there are visible to it — it never reads the rest of your Drive.
      </div>

      <div className="tasksync-card">
        <div className="tasksync-card-head">
          <strong>Google Drive</strong>
          <span className={`mcp-status${st.connected ? " configured" : ""}`}>
            {st.needs_reconnect ? "⚠ Sign in again" : st.connected ? "● Connected" : "○ Not connected"}
          </span>
        </div>
        {st.builtin_client && !st.connected && (
          <div className="settings-info">Click <b>Sign in with Google</b>: your browser opens, you pick your Google account and allow access. No keys or setup needed.</div>
        )}
        <label htmlFor="dsFolder">Drive folder name</label>
        <input id="dsFolder" type="text" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <div className="tasksync-days">
          <label title="Papers and books are kept in sync through Zotero instead"><input type="checkbox" checked={papers} onChange={(e) => setPapers(e.target.checked)} /> Also sync the Papers and Books folders (off: those go through Zotero)</label>
        </div>
        <div className="tasksync-days">
          <label><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Sync automatically</label>
          <label>every{" "}
            <select value={every} onChange={(e) => setEvery(Number(e.target.value))} disabled={!auto}>
              {INTERVALS.map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </select>
          </label>
        </div>
        <details className="tasksync-help" style={{ marginTop: 10 }} >
          <summary>Advanced: use my own Google client</summary>
          <ol>
            <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud</a> enable the <b>Google Drive API</b>, then create an OAuth client ID of type <b>Desktop app</b> (or Web application with the redirect URI below).</li>
          </ol>
          <CopyField label="Redirect URI" value={st.redirect_uri} />
          <label htmlFor="dsCid">Client ID</label>
          <input id="dsCid" type="text" value={cid} onChange={(e) => setCid(e.target.value)} placeholder={st.builtin_client ? "Leave empty to use the built-in client" : "1234…apps.googleusercontent.com"} />
          <label htmlFor="dsSec">Client secret</label>
          <input id="dsSec" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={st.has_secret ? "Saved — leave blank to keep" : "GOCSPX-…"} autoComplete="off" />
        </details>
        <div className="tasksync-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
            {connected ? "Sign in again" : "Sign in with Google"}
          </button>
          {connected && <button type="button" className="btn" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>}
          <button type="button" className="btn" disabled={busy} onClick={() => void wrap(async () => { await save(); })}>Save</button>
          <button type="button" className="btn btn-primary" disabled={busy || running || !st.connected} onClick={() => void runDriveSync()}>
            {running ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {msg && <div className={msg.ok ? "ok mono" : "crit mono"} style={{ fontSize: 12, marginTop: 8 }}>{msg.text}</div>}
      {st.connected && (
        <div className="settings-info" style={{ marginTop: 8 }}>
          Last sync {ago(st.last_run)}{r ? ` — ${r.message}` : ""}. {st.tracked_files} files tracked.
          {r && !r.ok && r.errors && r.errors.length > 0 && <div className="crit">{r.errors.slice(0, 3).join(" | ")}</div>}
        </div>
      )}
      <div className="settings-info" style={{ marginTop: 12 }}>
        <b>How conflicts work:</b> if the same file changed in both places, the newer version is kept under its name and the other
        is saved next to it as “name (conflict …)”. Files deleted on one side are deleted on the other (local ones go to
        <code> .ygg-config/sync-trash</code>, Drive ones to the Drive bin), and a sync that would delete lots of files asks first.
      </div>
    </div>
  );
}
