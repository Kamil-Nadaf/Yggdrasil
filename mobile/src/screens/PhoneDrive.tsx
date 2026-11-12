import { useEffect, useRef, useState } from 'react';
import { ago } from '../syncAll';
import { pollDeviceFlow, startDeviceFlow, type DeviceCode } from '../cloud/auth';
import { cloudDisconnect, cloudRunning, cloudSync, getCloud, setCloud } from '../cloud/cloud';

/** Open a page in the phone's real browser when the Capacitor Browser plugin is bundled, else the WebView/window. */
function openExternal(url: string) {
  const cap = (window as unknown as { Capacitor?: { nativePromise?: (p: string, m: string, o: object) => Promise<unknown> } }).Capacitor;
  if (cap?.nativePromise) cap.nativePromise('Browser', 'open', { url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
}

function useCloud() {
  const [, tick] = useState(0);
  useEffect(() => { const h = () => tick((n) => n + 1); addEventListener('ygg-cloud', h); return () => removeEventListener('ygg-cloud', h); }, []);
  return getCloud();
}

export default function PhoneDrive() {
  const s = useCloud();
  const [cid, setCid] = useState(s.clientId);
  const [sec, setSec] = useState('');
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [askRoot, setAskRoot] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async (opts: { force?: boolean; createRoot?: boolean } = {}) => {
    setBusy(true); setMsg(''); setAskRoot('');
    const r = await cloudSync(opts);
    setBusy(false);
    if (r.needsRoot) setAskRoot(r.message);
    else if (r.needsConfirm) setMsg(r.message);
    else setMsg(r.message);
    return r;
  };

  const signIn = async () => {
    const client = { id: cid.trim(), secret: (sec || s.clientSecret).trim() };
    if (!client.id || !client.secret) { setMsg('Paste the client ID and secret first.'); return; }
    setMsg(''); setBusy(true);
    try {
      setCloud({ clientId: client.id, clientSecret: client.secret });
      const d = await startDeviceFlow(client);
      setCode(d); setBusy(false);
      void navigator.clipboard?.writeText(d.user_code).catch(() => {});
      abort.current = new AbortController();
      const t = await pollDeviceFlow(client, d, { signal: abort.current.signal });
      setCode(null); setSec('');
      setCloud({ refresh: t.refresh_token });
      await run();
    } catch (e) {
      setCode(null); setBusy(false);
      setMsg(e instanceof Error ? e.message : 'Sign-in failed');
    }
  };
  const cancel = () => { abort.current?.abort(); setCode(null); setBusy(false); };

  const connected = !!s.refresh;
  return (
    <section className="card">
      <div className="row gap"><span className={`dot ${connected && s.lastOk ? '' : 'bad'}`} /><b>Google Drive</b><span className="f1 right muted sm">{connected ? `Connected · ${ago(s.lastRun || null)}` : 'Not connected'}</span></div>
      <p className="muted sm">Syncs notes, LaTeX, tasks, habits and goals with the same Drive folder as your desktop app, so edits on either side show up on both. Papers stay in Zotero.</p>

      {!connected && !code && <>
        <p className="sm">Create a Google Cloud OAuth client of type <b>“TVs and Limited Input devices”</b> in the <b>same project</b> as your desktop client, then paste it here once.</p>
        <label className="label" htmlFor="pcid">Client ID</label>
        <input id="pcid" className="input" autoComplete="off" value={cid} onChange={(e) => setCid(e.target.value)} placeholder="1234…apps.googleusercontent.com" />
        <label className="label" htmlFor="pcsec">Client secret</label>
        <input id="pcsec" className="input" type="password" autoComplete="off" value={sec} onChange={(e) => setSec(e.target.value)} placeholder={s.clientSecret ? 'Saved. Type to replace' : 'GOCSPX-…'} />
        <button className="btn primary" style={{ marginTop: 12, width: '100%' }} disabled={busy} onClick={signIn}>{busy ? 'Starting…' : 'Sign in with Google'}</button>
      </>}

      {code && (
        <div style={{ marginTop: 8 }}>
          <p className="sm">1. Open Google’s sign-in page (on this phone or any device). 2. Enter this code and choose your account.</p>
          <div style={{ fontSize: 30, letterSpacing: 4, fontWeight: 700, textAlign: 'center', margin: '10px 0' }}>{code.user_code}</div>
          <div className="row gap">
            <button className="btn primary f1" onClick={() => { void navigator.clipboard?.writeText(code.user_code).catch(() => {}); openExternal(code.verification_url); }}>Copy code and open browser</button>
            <button className="btn" onClick={cancel}>Cancel</button>
          </div>
          <p className="muted sm">Or go to {code.verification_url} yourself. Waiting for you to approve…</p>
        </div>
      )}

      {connected && <>
        <div className="row gap" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy || cloudRunning()} onClick={() => run()}>{busy ? 'Syncing…' : s.initialDone ? 'Sync now' : 'Upload everything now'}</button>
          <button className="btn" disabled={busy} onClick={() => { if (confirm('Disconnect Google Drive? Your notes stay on the phone and on Drive.')) { cloudDisconnect(); setMsg('Disconnected.'); } }}>Disconnect</button>
        </div>
        <label className="row gap sm" style={{ marginTop: 10 }}><input type="checkbox" checked={s.auto} onChange={(e) => setCloud({ auto: e.target.checked })} /> Sync automatically every {s.intervalMin} min while the app is open</label>
        {s.lastMessage && <p className={`sm ${s.lastOk ? '' : 'err'}`} role="status">{s.lastMessage}</p>}
      </>}

      {askRoot && (
        <div style={{ marginTop: 10 }}>
          <p className="sm err">{askRoot}</p>
          <p className="muted sm">If you already sync from the desktop, this means the desktop and phone use different Google Cloud projects, so the phone can’t see the desktop’s folder. Use a client from the same project. Otherwise you can start a fresh folder.</p>
          <div className="row gap"><button className="btn" onClick={() => run({ createRoot: true })}>Create a new folder</button><button className="btn" onClick={() => setAskRoot('')}>Cancel</button></div>
        </div>
      )}
      {msg && !connected && <p className="sm err" role="status">{msg}</p>}
      {msg && connected && !s.lastMessage && <p className="sm" role="status">{msg}</p>}
    </section>
  );
}
