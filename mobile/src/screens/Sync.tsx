import { useState } from 'react';
import { useStore, update } from '../store';
import { Screen, Top } from '../ui';
import { useY, yg } from '../ygg';

export default function Sync() {
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
