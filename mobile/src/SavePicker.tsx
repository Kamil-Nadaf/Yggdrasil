import { useMemo, useState } from 'react';
import { flatten, saveCollections, savePaper, useY, type DCol, type WebPaper } from './ygg';
import { Icon } from './ui';

/** Bottom sheet: choose a desktop collection / sub-collection (linked ones sync to Zotero), then save. */
export default function SavePicker({ paper, claim = '', onClose, onSaved }: { paper: WebPaper; claim?: string; onClose: () => void; onSaved: (where: string, note: string) => void }) {
  const { data, err, loading, reload } = useY<{ collections: DCol[] }>('/api/reading/collections', { collections: [] });
  const [sel, setSel] = useState<string>(() => { try { return localStorage.getItem('ygg.lastCol') || ''; } catch { return ''; } });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const flat = useMemo(() => flatten(data.collections), [data]);
  const shown = q ? flat.filter((c) => c.path.toLowerCase().includes(q.toLowerCase())) : flat;
  const chosen = flat.find((c) => c.id === sel) || null;

  const create = async () => {
    const name = prompt(chosen ? `New sub-collection inside “${chosen.name}”` : 'New collection name')?.trim();
    if (!name) return;
    const id = `c_${Math.random().toString(16).slice(2, 10)}`;
    try {
      await saveCollections([...data.collections, { id, name, slugs: [], ...(chosen ? { parent: chosen.id } : {}) }]);
      setSel(id); reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not create'); }
  };

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await savePaper(paper, chosen, claim);
      try { if (chosen) localStorage.setItem('ygg.lastCol', chosen.id); } catch { /* ignore */ }
      const z = r.zotero === 'ok' ? 'Sent to Zotero' : r.zotero === 'skipped' ? (chosen ? 'Not linked to a Zotero collection' : '') : `Zotero: ${r.zotero}`;
      onSaved(chosen ? chosen.path : 'Library', z);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Save failed'); setBusy(false); }
  };

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Save to collection" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><b>Save to collection</b><button className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="back" /></button></div>
        <div className="muted sm clamp1">{paper.title}</div>
        <input className="input mt-s" placeholder="Filter collections" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="sheet-list">
          {loading && <p className="muted sm">Loading…</p>}
          {err && <p className="err sm">{err}</p>}
          <button className={`pick ${sel === '' ? 'on' : ''}`} onClick={() => setSel('')}><span className="f1">Library (no collection)</span>{sel === '' && <Icon name="check" size={16} />}</button>
          {shown.map((c) => (
            <button key={c.id} className={`pick ${sel === c.id ? 'on' : ''}`} style={{ paddingLeft: 12 + (q ? 0 : c.depth * 18) }} onClick={() => setSel(c.id)}>
              <span className="f1">{q ? c.path : c.name}</span>
              {c.zotero_key && <span className="tag">Zotero</span>}
              <span className="muted sm">{c.slugs.length}</span>
              {sel === c.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        {msg && <p className="err sm">{msg}</p>}
        <div className="row gap mt">
          <button className="btn" onClick={create}>{chosen ? 'New sub-collection' : 'New collection'}</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
