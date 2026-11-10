import { useEffect, useMemo, useState } from 'react';
import { useStore, update, markDecision, type ArxivItem } from '../store';
import { Icon, Screen, Top } from '../ui';
import SavePicker from '../SavePicker';
import { isoDay, yg, useY, type Topic, type WebPaper } from '../ygg';

const toItem = (p: WebPaper): ArxivItem => ({ id: p.id, title: p.title, abstract: p.abstract, authors: p.authors, published: p.submitted, pdf: p.pdf_url });
const toPaper = (i: ArxivItem): WebPaper => ({ id: i.id, title: i.title, authors: i.authors, abstract: i.abstract, arxiv_url: `https://arxiv.org/abs/${i.id}`, pdf_url: i.pdf, categories: [], submitted: i.published });

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [text]);
  return <div className="toast" role="status">{text}</div>;
}

export function ArxivFeed() {
  const s = useStore();
  const cat = s.settings.category;
  const today = isoDay();
  const [date, setDate] = useState(today);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');
  const [pick, setPick] = useState<ArxivItem | null>(null);
  const [toast, setToast] = useState('');
  const topics = useY<{ topics: Topic[] }>('/api/arxiv/topics', { topics: [] });
  const groups = useMemo(() => {
    const m = new Map<string, Topic[]>();
    for (const t of topics.data.topics) m.set(t.group, [...(m.get(t.group) || []), t]);
    return [...m.entries()];
  }, [topics.data]);

  const load = (force = false) => {
    setBusy(true); setErr(''); setWarn('');
    const path = query
      ? `/api/arxiv/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(cat)}&max_results=40`
      : `/api/arxiv/daily?cat=${encodeURIComponent(cat)}&max=100${date !== today ? `&date=${date}` : ''}${force ? '&refresh=true' : ''}`;
    yg<{ papers: WebPaper[]; warning?: string | null }>(path)
      .then((j) => {
        setWarn(j.warning || '');
        update((st) => ({ ...st, feed: { cat: query ? `search: ${query}` : cat, sample: false, fetched: Date.now(), items: j.papers.map(toItem) } }));
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cat, date, query]);

  const items = s.feed?.items || [];
  const done = items.filter((i) => s.decisions[i.id]).length;
  const todo = items.filter((i) => !s.decisions[i.id]);
  const handled = items.filter((i) => s.decisions[i.id]);
  const label = query ? `Results for “${query}”` : date === today ? 'Latest' : date;

  return (
    <Screen tab="arxiv">
      <header className="top big"><h1>arXiv</h1><button className="iconbtn" aria-label="Refresh" onClick={() => load(true)}><Icon name="search" /></button></header>
      <div className="pad stack" style={{ paddingBottom: 8 }}>
        <form className="searchrow" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input className="input" type="search" placeholder="Search papers, authors, ids" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary" style={{ flex: 'none', minWidth: 72 }} type="submit">Go</button>
        </form>
        <div className="searchrow">
          <select className="select f1" aria-label="Topic" value={cat} onChange={(e) => update((st) => ({ ...st, feed: null, settings: { ...st.settings, category: e.target.value } }))}>
            {!topics.data.topics.some((t) => t.id === cat) && <option value={cat}>{cat}</option>}
            {groups.map(([g, ts]) => <optgroup key={g} label={g}>{ts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}
          </select>
          <input className="select" style={{ width: 150, flex: 'none' }} type="date" aria-label="Date" max={today} value={date} onChange={(e) => { setQuery(''); setQ(''); setDate(e.target.value || today); }} />
        </div>
        <div className="chips" style={{ padding: 0 }}>
          <button className={`chip ${!query && date === today ? 'on' : ''}`} onClick={() => { setQuery(''); setQ(''); setDate(today); }}>Today</button>
          <button className={`chip ${!query && date === isoDay(new Date(Date.now() - 864e5)) ? 'on' : ''}`} onClick={() => { setQuery(''); setQ(''); setDate(isoDay(new Date(Date.now() - 864e5))); }}>Yesterday</button>
          {query && <button className="chip on" onClick={() => { setQuery(''); setQ(''); }}>Clear search ✕</button>}
        </div>
      </div>
      <div className="pad muted sm">{busy ? 'Loading…' : `${label} · ${items.length} papers · ${done} triaged`}{warn && ` · ${warn}`}</div>
      <div className="pad bar-wrap"><div className="bar"><i style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div></div>
      {err && <p className="pad err">{err} <button className="link-btn" onClick={() => load(true)}>Retry</button></p>}

      <div className="stack pad">
        {todo.map((i) => (
          <article key={i.id} className="card">
            <a href={`#/arxiv/${encodeURIComponent(i.id)}`} className="plain">
              <b className="lead">{i.title}</b>
              <div className="muted sm mt-s">{i.authors.slice(0, 3).join(', ')}{i.authors.length > 3 ? ' et al.' : ''} · {i.published.slice(0, 10)}</div>
              <p className="clamp">{i.abstract}</p>
            </a>
            <div className="row gap mt">
              <button className="btn" onClick={() => markDecision(i.id, 'skip')}>Skip</button>
              <button className="btn primary" onClick={() => setPick(i)}>Save…</button>
            </div>
          </article>
        ))}
        {!busy && !err && items.length === 0 && <p className="muted">No papers for this day and topic yet. arXiv posts new papers on weekdays; try Yesterday.</p>}
        {items.length > 0 && todo.length === 0 && <p className="muted">All triaged for now. Nice.</p>}
        {handled.length > 0 && <div className="label">Triaged</div>}
        {handled.map((i) => (
          <article key={i.id} className={`card slim ${s.decisions[i.id] === 'saved' ? 'saved' : ''}`}>
            <a href={`#/arxiv/${encodeURIComponent(i.id)}`} className="plain"><b className="lead">{i.title}</b></a>
            <div className="row between mt-s sm">
              <span className={s.decisions[i.id] === 'saved' ? 'acc' : 'muted'}>{s.decisions[i.id] === 'saved' ? <><Icon name="check" size={14} /> Saved</> : 'Skipped'}</span>
              <button className="link-btn" onClick={() => markDecision(i.id, null)}>Undo</button>
            </div>
          </article>
        ))}
      </div>
      {pick && <SavePicker paper={toPaper(pick)} onClose={() => setPick(null)} onSaved={(where, note) => { markDecision(pick.id, 'saved'); setPick(null); setToast(`Saved to ${where}${note ? ` · ${note}` : ''}`); }} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </Screen>
  );
}

export function Abstract({ id }: { id: string }) {
  const s = useStore();
  const items = s.feed?.items || [];
  const idx = items.findIndex((i) => i.id === id);
  const item = items[idx];
  const [claim, setClaim] = useState('');
  const [pick, setPick] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => { setClaim(''); }, [id]);

  if (!item) return <Screen><Top back="arxiv" title="Paper not found" /><p className="pad muted">Open it from the arXiv feed.</p></Screen>;
  const next = items[idx + 1];
  const go = () => { location.hash = next ? `#/arxiv/${encodeURIComponent(next.id)}` : '#/arxiv'; };

  return (
    <Screen>
      <Top back="arxiv" title={<span className="muted sm">{s.feed?.cat} · {idx + 1} of {items.length}</span>}
        right={next && <a className="iconbtn" href={`#/arxiv/${encodeURIComponent(next.id)}`} aria-label="Next paper"><Icon name="next" /></a>} />
      <div className="pad abs">
        <h1 className="h2">{item.title}</h1>
        <div className="muted sm mt-s">{item.authors.join(', ')}</div>
        <div className="muted sm mt-s">{item.id} · {item.published.slice(0, 10)}</div>
        <p className="abstract">{item.abstract}</p>
        <label className="label" htmlFor="claim">Claim in one line</label>
        <input id="claim" className="input" placeholder="What do they claim?" value={claim} onChange={(e) => setClaim(e.target.value)} />
      </div>
      <div className="actionbar">
        <button className="btn" onClick={() => { markDecision(item.id, 'skip'); go(); }}>Skip</button>
        <a className="btn" href={item.pdf || '#'} target="_blank" rel="noreferrer">PDF</a>
        <button className="btn primary" onClick={() => setPick(true)}>Save…</button>
      </div>
      {pick && <SavePicker paper={toPaper(item)} claim={claim.trim()} onClose={() => setPick(false)} onSaved={(where, note) => { markDecision(item.id, 'saved'); setPick(false); setToast(`Saved to ${where}${note ? ` · ${note}` : ''}`); setTimeout(go, 900); }} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </Screen>
  );
}
