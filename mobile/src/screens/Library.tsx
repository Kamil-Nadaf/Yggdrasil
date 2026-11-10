import { useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../api';
import PdfView from '../PdfView';
import { Icon, Screen, Top } from '../ui';
import { flatten, isoDay, saveCollections, useY, yg, type DCol, type Item } from '../ygg';

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

export function Collection({ id }: { id: string }) {
  const { items, cols, err } = useLibrary();
  const [f, setF] = useState<'all' | 'want' | 'reading' | 'finished'>('all');
  const col = cols.find((c) => c.id === id);
  const kids = cols.filter((c) => c.parent === id);
  const filed = new Set(cols.flatMap((c) => c.slugs));
  const base = id === '_all' ? items : id === '_unfiled' ? items.filter((p) => !filed.has(p.slug)) : items.filter((p) => col?.slugs.includes(p.slug));
  const list = base.filter((p) => f === 'all' || p.status === f);
  return (
    <Screen tab="library">
      <Top back="library" title={<b>{col?.name || (id === '_unfiled' ? 'Unfiled' : 'All items')}</b>} />
      <div className="chips pad">
        {(['all', 'want', 'reading', 'finished'] as const).map((k) => <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{k === 'all' ? 'All' : STATUS[k]}</button>)}
      </div>
      {err && <p className="err sm pad">{err}</p>}
      <div className="list">
        {kids.map((c) => <a key={c.id} href={`#/library/${c.id}`} className="grow"><Icon name="library" size={18} /><span className="f1">{c.name}</span><span className="muted sm">{c.slugs.length}</span></a>)}
        {list.length === 0 && <p className="muted pad">No items.</p>}
        {list.map((p) => <a key={p.slug} className="paperrow" href={`#/read/${encodeURIComponent(p.slug)}`}><b className="lead">{p.title}</b><div className="row gap muted sm mt-s"><Sdot s={p.status} />{meta(p)}</div></a>)}
      </div>
    </Screen>
  );
}

async function fetchFile(slug: string): Promise<ArrayBuffer> {
  const url = `/ygg/api/reading/${encodeURIComponent(slug)}/file`;
  const c = typeof caches !== 'undefined' ? await caches.open('ygg-pdf') : null;
  const hit = await c?.match(url);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(url, { headers: authHeaders() });
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
