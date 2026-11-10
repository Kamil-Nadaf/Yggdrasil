import { useEffect, useState } from 'react';
import { getState, update } from './store';

const KEY = 'ygg.server';
const norm = (u: string) => { const t = u.trim().replace(/\/+$/, ''); return /^https?:\/\//i.test(t) ? t : t ? `http://${t}` : ''; };

/** True inside the Android shell: Capacitor serves the bundled page from http(s)://localhost and injects window.Capacitor. */
export const isNativeShell = () => typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: unknown }).Capacitor && location.hostname === 'localhost';

async function reachable(url: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try { await fetch(`${url}/version.json?t=${Date.now()}`, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' }); return true; } catch { return false; } finally { clearTimeout(t); }
}

/** Thin shell: remembers your Yggdrasil phone server and opens it, so a server rebuild updates the app with no reinstall. */
export default function Launcher() {
  const change = new URLSearchParams(location.search).has('change');
  const [url, setUrl] = useState(() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async (u: string) => {
    const n = norm(u);
    if (!n) { setMsg('Enter the address of your Yggdrasil phone server.'); return; }
    setBusy(true); setMsg('Connecting…');
    if (await reachable(n)) { try { localStorage.setItem(KEY, n); } catch { /* ignore */ } update((st) => ({ ...st, settings: { ...st.settings, mode: 'server' } })); location.replace(n + '/'); return; }
    setBusy(false); setMsg(`Cannot reach ${n}. Is the server running and your phone on the same network or Tailscale?`);
  };
  useEffect(() => { if (!change && url && getState().settings.mode !== 'local') void open(url); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <main className="screen" style={{ padding: 24, gap: 14, justifyContent: 'center' }}>
      <span className="logo" role="img" aria-label="Yggdrasil" style={{ width: 72, height: 72 }} />
      <h1 className="h2">Yggdrasil</h1>
      <button className="btn primary" style={{ flex: 'none' }} onClick={() => { update((st) => ({ ...st, settings: { ...st.settings, mode: 'local' } })); location.replace('/'); }}>Use on this phone only</button>
      <p className="muted sm">Everything stays on the phone. Back up or move your data to Google Drive from Settings, and connect a server later if you want.</p>
      <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--line)' }} />
      <p className="muted">Or connect to your Yggdrasil phone server (the Mac running <code>docker compose</code>), for example <code>http://100.x.y.z:8080</code> over Tailscale.</p>
      <label className="label" htmlFor="srv">Server address</label>
      <input id="srv" className="input" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="http://my-mac:8080" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void open(url); }} />
      <button className="btn" style={{ flex: 'none' }} disabled={busy} onClick={() => void open(url)}>{busy ? 'Connecting…' : 'Connect'}</button>
      {msg && <p className="sm" role="status">{msg}</p>}
    </main>
  );
}
