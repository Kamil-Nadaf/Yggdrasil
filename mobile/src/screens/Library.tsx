import { useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../api';
import PdfView from '../PdfView';
import { Icon, Screen, Top } from '../ui';
import { update, useStore } from '../store';
import { getDB } from '../local';
import { flatten, isLocal, isoDay, saveCollections, useY, yg, type DCol, type Item } from '../ygg';

const STATUS: Record<string, string> = { want: 'To read', reading: 'Reading', finished: 'Done' };
const COLOR: Record<string, string> = { want: '#E6B673', reading: '#8DB8FF', finished: '#7FD6A4' };
const Sdot = ({ s }: { s: string }) => <span className="dot" style={{ background: COLOR[s] || '#8E8E96' }} />;
const meta = (p: Item) => `${STATUS[p.status] || p.status}${p.year ? ` · ${p.year}` : ''}${p.kind === 'paper' && !p.has_file ? ' · no PDF' : ''}`;

function useLibrary() {
  const lib = useY<{ books: Item[] }>('/api/reading/library', { books: [] });
  const cols = useY<{ collections: DCol[] }>('/api/reading/collections', { collections: [] });
  return { items: lib.data.books, cols: cols.data.collections, err: lib.err || cols.err, loading: lib.loading || cols.loading, reload: () => { lib.reload(); cols.reload(); } };
}

export function Library() {
  const { items, cols, err, loading, reload } = useLibrary();
  const [q, setQ] = useState('');
  const flat = useMemo(() => flatten(cols), [cols]);
  const hits = q ? items.filter((p) => (p.title + ' ' + p.authors.join(' ')).toLowerCase().includes(q.toLowerCase())) : [];
  const filed = new Set(cols.flatMap((c) => c.slugs));
  const unfiled = items.filter((p) => !filed.has(p.slug));
  const recent = [...items].sort((a, b) => (b.added || '').localeCompare(a.added || '')).slice(0, 5);
  const newCol = async () => {
    const name = prompt('New collection name')?.trim();
    if (name) { await saveCollections([...cols, { id: `c_${Math.random().toString(16).slice(2, 10)}`, name, slugs: [] }]).catch(() => {}); reload(); }
  };
  return (
    <Screen tab="library">
      <header className="top big"><h1>Library</h1><button className="iconbtn" aria-label="New collection" onClick={newCol}><Icon name="plus" /></button></header>
      <div className="pad">
        <input className="input" type="search" placeholder="Search your papers and books" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="muted sm mt-s">{loading ? 'Loading…' : `${items.filter((i) => i.kind === 'paper').length} papers · ${items.filter((i) => i.kind === 'book').length} books`}</div>
        {err && <p className="err sm">{err}</p>}
        {q ? (
          <div className="list" style={{ padding: '8px 0 80px' }}>
            {hits.map((p) => <a key={p.slug} className="paperrow" href={`#/read/${encodeURIComponent(p.slug)}`}><b className="lead">{p.title}</b><div className="row gap muted sm mt-s"><Sdot s={p.status} />{meta(p)}</div></a>)}
            {hits.length === 0 && <p className="muted">No matches.</p>}
          </div>
        ) : (
          <>
            <div className="label">Collections</div>
            <div className="card group">
              <a href="#/library/_all" className="grow"><Icon name="library" size={20} /><span className="f1">All items</span><span className="muted sm">{items.length}</span></a>
              {flat.map((c) => (
                <a key={c.id} href={`#/library/${c.id}`} className="grow" style={{ paddingLeft: 18 + c.depth * 20 }}>
                  <Icon name="library" size={c.depth ? 16 : 20} /><span className="f1">{c.name}</span>
                  {c.zotero_key && <span className="tag">Zotero</span>}
                  <span className="muted sm">{c.slugs.length}</span>
                </a>
              ))}
              <a href="#/library/_unfiled" className="grow"><Icon name="library" size={20} /><span className="f1">Unfiled</span><span className="muted sm">{unfiled.length}</span></a>
            </div>
            {recent.length > 0 && <div className="label">Recently added</div>}
            {recent.map((p) => <a key={p.slug} className="paperrow" href={`#/read/${encodeURIComponent(p.slug)}`}><div className="row gap"><Sdot s={p.status} /><span className="t">{p.title}</span></div><div className="muted sm ind">{meta(p)}</div></a>)}
          </>
        )}
      </div>
    </Screen>
  );
}

function hue(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function Tile({ p, onManage }: { p: Item; onManage?: (p: Item) => void }) {
  return (
    <a className="tile" onContextMenu={(e) => { if (onManage) { e.preventDefault(); onManage(p); } }} href={`#/read/${encodeURIComponent(p.slug)}`} style={{ ['--h' as string]: hue(p.slug) }}>
      <div className="cover">
        <span className="kind">{p.kind === 'book' ? 'Book' : 'Paper'}</span>
        <b className="ttl">{p.title}</b>
        <span className="au">{p.authors.slice(0, 2).join(', ')}{p.authors.length > 2 ? ' et al.' : ''}</span>
      </div>
      <div className="row gap muted sm tmeta"><Sdot s={p.status} /><span className="clip">{STATUS[p.status] || p.status}{p.year ? ` · ${p.year}` : ''}</span></div>
      {p.progress > 0 && <div className="bar"><i style={{ width: `${Math.min(100, p.progress * 100)}%` }} /></div>}
      {onManage && <button className="iconbtn tile-more" aria-label={`Manage ${p.title}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onManage(p); }}>⋯</button>}
    </a>
  );
}

function Row({ p, onManage }: { p: Item; onManage?: (p: Item) => void }) {
  return (
    <a className="paperrow" href={`#/read/${encodeURIComponent(p.slug)}`} onContextMenu={(e) => { if (onManage) { e.preventDefault(); onManage(p); } }}>
      {onManage && <button className="iconbtn row-more" aria-label={`Manage ${p.title}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onManage(p); }}>⋯</button>}
      <b className="lead">{p.title}</b>
      {p.authors.length > 0 && <div className="muted sm clip mt-s">{p.authors.slice(0, 3).join(', ')}{p.authors.length > 3 ? ' et al.' : ''}</div>}
      <div className="row gap muted sm mt-s"><Sdot s={p.status} />{meta(p)}{p.progress > 0 && <span className="f1 right">{Math.round(p.progress * 100)}%</span>}</div>
    </a>
  );
}

export function Collection({ id }: { id: string }) {
  const { items, cols, err, reload } = useLibrary();
  const [managed, setManaged] = useState<Item | null>(null);
  const [mErr, setMErr] = useState('');
  const view = useStore().settings.libView;
  const [kind, setKind] = useState<'all' | 'paper' | 'book'>('all');
  const [f, setF] = useState<'all' | 'want' | 'reading' | 'finished'>('all');
  const col = cols.find((c) => c.id === id);
  const kids = cols.filter((c) => c.parent === id);
  const filed = new Set(cols.flatMap((c) => c.slugs));
  const base = id === '_all' ? items : id === '_unfiled' ? items.filter((p) => !filed.has(p.slug)) : items.filter((p) => col?.slugs.includes(p.slug));
  const list = base.filter((p) => (f === 'all' || p.status === f) && (kind === 'all' || p.kind === kind));
  return (
    <Screen tab="library">
      <Top back="library" title={<b>{col?.name || (id === '_unfiled' ? 'Unfiled' : 'All items')}</b>} />
      <div className="chips pad" style={{ alignItems: 'center' }}>
        {(['all', 'paper', 'book'] as const).map((k) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === 'all' ? 'Everything' : k === 'paper' ? 'Papers' : 'Books'}</button>)}
        <div className="viewtoggle" style={{ marginLeft: 'auto', flex: 'none' }} role="group" aria-label="View">
          <button className={view === 'list' ? 'on' : ''} aria-label="List view" aria-pressed={view === 'list'} onClick={() => update((st) => ({ ...st, settings: { ...st.settings, libView: 'list' } }))}><Icon name="list" size={18} /></button>
          <button className={view === 'tile' ? 'on' : ''} aria-label="Tile view" aria-pressed={view === 'tile'} onClick={() => update((st) => ({ ...st, settings: { ...st.settings, libView: 'tile' } }))}><Icon name="grid" size={18} /></button>
        </div>
      </div>
      <div className="chips pad" style={{ paddingTop: 0 }}>
        {(['all', 'want', 'reading', 'finished'] as const).map((k) => <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{k === 'all' ? 'All' : STATUS[k]}</button>)}
      </div>
      {err && <p className="err sm pad">{err}</p>}
      <div className="list">
        {kids.map((c) => <a key={c.id} href={`#/library/${c.id}`} className="grow"><Icon name="library" size={18} /><span className="f1">{c.name}</span><span className="muted sm">{c.slugs.length}</span></a>)}
        {list.length === 0 && <p className="muted pad">No items.</p>}
        {view === 'tile' ? <div className="tiles">{list.map((p) => <Tile key={p.slug} p={p} onManage={setManaged} />)}</div> : list.map((p) => <Row key={p.slug} p={p} onManage={setManaged} />)}
      </div>
      {managed && (
        <div className="sheet-scrim" onClick={() => setManaged(null)}>
          <div className="sheet" role="dialog" aria-label="Manage item" onClick={(e) => e.stopPropagation()}>
            <b className="clip">{managed.title}</b>
            {mErr && <p className="err sm">{mErr}</p>}
            <button className="grow plainbtn" onClick={async () => { const name = prompt('Rename', managed.title)?.trim(); if (!name || name === managed.title) return; try { await yg(`/api/reading/${encodeURIComponent(managed.slug)}`, { method: 'PATCH', body: { title: name } }); setManaged(null); reload(); } catch (e) { setMErr(e instanceof Error ? e.message : 'Rename failed'); } }}><span className="f1">Rename…</span></button>
            {(['want', 'reading', 'finished'] as const).filter((st) => st !== managed.status).map((st) => (
              <button key={st} className="grow plainbtn" onClick={async () => { try { await yg(`/api/reading/${encodeURIComponent(managed.slug)}`, { method: 'PATCH', body: { status: st } }); setManaged(null); reload(); } catch (e) { setMErr(e instanceof Error ? e.message : 'Failed'); } }}><span className="f1">Mark as {STATUS[st].toLowerCase()}</span></button>
            ))}
            <button className="grow plainbtn danger" onClick={async () => { if (!confirm(`Delete “${managed.title}”, its file and notes from your vault? This cannot be undone.`)) return; try { await yg(`/api/reading/${encodeURIComponent(managed.slug)}`, { method: 'DELETE' }); setManaged(null); reload(); } catch (e) { setMErr(e instanceof Error ? e.message : 'Delete failed'); } }}><span className="f1">Delete…</span></button>
            <button className="btn" onClick={() => setManaged(null)}>Cancel</button>
          </div>
        </div>
      )}
    </Screen>
  );
}

async function fetchFile(slug: string): Promise<ArrayBuffer> {
  const local = isLocal() ? getDB().items[slug] : null;
  if (isLocal() && !local?.pdf_url) throw new Error('No PDF link for this item.');
  const url = local ? local.pdf_url! : `/ygg/api/reading/${encodeURIComponent(slug)}/file`;
  const c = typeof caches !== 'undefined' ? await caches.open('ygg-pdf') : null;
  const hit = await c?.match(url);
  if (hit) return hit.arrayBuffer();
  const cap = (window as unknown as { Capacitor?: { Plugins?: { CapacitorHttp?: { get: (o: object) => Promise<{ status: number; data: string }> } } } }).Capacitor?.Plugins?.CapacitorHttp;
  if (local && cap) {
    const n = await cap.get({ url, responseType: 'blob' });
    if (n.status >= 400) throw new Error('PDF not available');
    const buf = Uint8Array.from(atob(n.data), (ch) => ch.charCodeAt(0)).buffer;
    await c?.put(url, new Response(buf.slice(0)));
    return buf;
  }
  let r: Response;
  try { r = await fetch(url, local ? undefined : { headers: authHeaders() }); } catch { throw new Error(local ? 'Cannot download the PDF here. The Android app can; a browser cannot.' : 'PDF unavailable (offline or backend unreachable)'); }
  if (!r.ok) throw new Error(r.status === 404 ? 'No PDF attached. Open the item on desktop and fetch the PDF.' : 'PDF unavailable (offline or backend unreachable)');
  await c?.put(url, r.clone());
  return r.arrayBuffer();
}

export function Reader({ id }: { id: string }) {
  const { data, err } = useY<{ books: Item[] }>('/api/reading/library', { books: [] });
  const p = data.books.find((x) => x.slug === id);
  const last = useRef(0);
  const page = useRef(0);
  // log active reading time to the desktop every minute while the screen is visible
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      yg('/api/reading/session', { method: 'POST', body: { slug: id, seconds: 60, page: page.current || undefined, date: isoDay() } }).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [id]);
  if (!p) return <Screen><Top back="library" title={err ? 'Cannot reach backend' : 'Loading…'} />{err && <p className="pad err">{err}</p>}</Screen>;
  const save = (pg: number, total: number) => {
    page.current = pg;
    if (Date.now() - last.current < 2500) return;
    last.current = Date.now();
    yg(`/api/reading/${encodeURIComponent(id)}`, { method: 'PATCH', body: { last_page: pg, total_pages: total, progress: pg / total } }).catch(() => {});
  };
  return (
    <Screen>
      <Top back="library" title={<span className="clip">{p.title}</span>} />
      <PdfView key={id} load={() => fetchFile(id)} initialPage={p.last_page || 1} onPage={save} />
      <div className="actionbar">
        <button className="btn" onClick={() => yg(`/api/reading/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: p.status === 'finished' ? 'reading' : 'finished' } }).then(() => location.reload()).catch(() => {})}>
          {p.status === 'finished' ? 'Mark unfinished' : 'Mark done'}
        </button>
      </div>
    </Screen>
  );
}
