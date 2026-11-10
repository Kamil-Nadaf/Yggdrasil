import { useState } from 'react';
import { useStore, update } from '../store';
import { Screen, Top } from '../ui';
import { exportBackup, mergeBackup } from '../backup';
import { isLocal, useY, yg } from '../ygg';

function LocalConnection() {
  const [msg, setMsg] = useState('');
  const file = (f: File | undefined) => { if (f) f.text().then((t) => setMsg(mergeBackup(t))).catch((e) => setMsg(e instanceof Error ? e.message : 'Import failed')); };
  const native = !!(window as unknown as { Capacitor?: unknown }).Capacitor;
  return (
    <Screen>
      <Top back="settings" title={<h1 className="h2">Phone only</h1>} />
      <div className="stack pad">
        <section className="card">
          <b>Everything is stored on this phone</b>
          <p className="muted sm">Notes, LaTeX, tasks, habits, goals, collections and saved papers live in the app. arXiv is fetched directly. Compiling LaTeX and Zotero sync need your Yggdrasil server.</p>
        </section>
        <section className="card">
          <b>Backup and sync</b>
          <p className="muted sm">Export a backup and send it to Google Drive (or any app) from the share sheet. On another device, Import merges it: the newer copy of each note wins and nothing is deleted.</p>
          <div className="row gap" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => exportBackup().then(setMsg).catch((e) => setMsg(e.message))}>Export backup</button>
            <label className="btn" style={{ cursor: 'pointer' }}>Import<input type="file" accept="application/json,.json" hidden onChange={(e) => { file(e.target.files?.[0]); e.target.value = ''; }} /></label>
          </div>
          {msg && <p className="sm" role="status">{msg}</p>}
        </section>
        <section className="card group">
          {native ? <a className="grow" href="/?change=1"><span className="f1">Connect to a server instead</span><span className="muted sm">full vault, Zotero, LaTeX</span></a>
            : <button className="grow plainbtn" onClick={() => { update((st) => ({ ...st, settings: { ...st.settings, mode: 'server' } })); location.reload(); }}><span className="f1">Use my Yggdrasil server instead</span></button>}
        </section>
      </div>
    </Screen>
  );
}

export default function Sync() {
  return isLocal() ? <LocalConnection /> : <ServerConnection />;
}

function ServerConnection() {
  const s = useStore();
  const set = (p: Partial<typeof s.settings>) => update((st) => ({ ...st, settings: { ...st.settings, ...p } }));
  const info = useY<Record<string, unknown>>('/api/info', {});
  const zot = useY<{ collections: { key: string }[]; error?: string }>('/api/zotero/collections', { collections: [] });
  const zerr = zot.data.error || zot.err;
  return (
    <Screen>
      <Top back="settings" title={<h1 className="h2">Connection</h1>} />
      <div className="stack pad">
        <section className="card">
          <div className="row gap"><span className={`dot ${info.err ? 'bad' : ''}`} /><b>Yggdrasil backend</b><span className="f1 right muted sm">{info.loading ? 'Checking…' : info.err ? 'Not reachable' : 'Connected'}</span></div>
          {info.err && <p className="err sm">{info.err}</p>}
          <p className="muted sm">Notes, LaTeX, papers, tasks, goals, habits and arXiv read and write your desktop vault through this connection, so phone and desktop always show the same data.</p>
          <div className="row gap sm" style={{ marginTop: 8 }}><span className={`dot ${zerr ? 'bad' : ''}`} /><span>Zotero: {zot.loading ? 'checking…' : zerr ? zerr : `${zot.data.collections.length} collections available`}</span></div>
        </section>
        <ZoteroCard onSaved={zot.reload} />
        <section className="card">
          <b>Phone server token</b>
          <p className="muted sm">Same as SYNC_TOKEN on the server. Required whenever the server is reachable beyond your own network.</p>
          <label className="label" htmlFor="tok">Token</label>
          <input id="tok" className="input" type="password" autoComplete="off" placeholder="Same as SYNC_TOKEN on the server" value={s.settings.token} onChange={(e) => set({ token: e.target.value })} />
        </section>
        {/\bwv\b/.test(navigator.userAgent) && <section className="card group"><a className="grow" href="http://localhost/?change=1"><span className="f1">Change server</span><span className="muted sm">{location.host}</span></a></section>}
        {!(window as unknown as { Capacitor?: unknown }).Capacitor && <section className="card group"><button className="grow plainbtn" onClick={() => { update((st) => ({ ...st, settings: { ...st.settings, mode: 'local' } })); location.reload(); }}><span className="f1">Use this phone only (no server)</span></button></section>}
        <section className="card group">
          <div className="grow"><span className="f1">arXiv topic</span><span className="muted sm">{s.settings.category}</span></div>
        </section>
      </div>
    </Screen>
  );
}

function ZoteroCard({ onSaved }: { onSaved: () => void }) {
  const cur = useY<{ user_id: string; has_key: boolean; source: string }>('/api/settings/zotero', { user_id: '', has_key: false, source: 'none' });
  const [uid, setUid] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await yg('/api/settings/zotero', { method: 'PUT', body: { user_id: (uid ?? cur.data.user_id).trim(), api_key: key.trim() } });
      setKey(''); setMsg('Saved to your Yggdrasil backend.'); cur.reload(); onSaved();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <b>Zotero</b>
      <p className="muted sm">Same as desktop Settings → Zotero. Get both at zotero.org/settings/keys. Stored on your Yggdrasil backend, not on the phone.{cur.data.has_key ? ' A key is saved.' : ''}</p>
      <label className="label" htmlFor="zuid">User ID (number)</label>
      <input id="zuid" className="input" inputMode="numeric" autoComplete="off" value={uid ?? cur.data.user_id} onChange={(e) => setUid(e.target.value)} />
      <label className="label" htmlFor="zkey">API key</label>
      <input id="zkey" className="input" type="password" autoComplete="off" placeholder={cur.data.has_key ? 'Saved. Type to replace' : 'Paste API key'} value={key} onChange={(e) => setKey(e.target.value)} />
      <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Zotero'}</button>
      {msg && <p className="sm" role="status">{msg}</p>}
    </section>
  );
}
