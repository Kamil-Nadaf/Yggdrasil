import { useEffect, useRef, useState } from 'react';
import PdfView from '../PdfView';
import { Icon, Screen, Top } from '../ui';
import { useAutosave } from '../useAutosave';
import { useY, yg } from '../ygg';

interface TexFile { name: string; modified: string; size: number }
const stem = (n: string) => n.replace(/\.tex$/i, '');
const enc = (n: string) => n.split('/').map(encodeURIComponent).join('/');
const safe = (s: string) => s.replace(/[^A-Za-z0-9._ -]/g, '').trim();
const TEMPLATE = '\\documentclass{article}\n\\usepackage{amsmath}\n\\title{Untitled}\n\\begin{document}\n\\maketitle\n\\section{Introduction}\n\n\\end{document}\n';

export function Projects() {
  const { data, err, loading, reload } = useY<{ files: TexFile[] }>('/api/latex/files', { files: [] });
  const files = [...data.files].sort((a, b) => b.modified.localeCompare(a.modified));
  const create = async () => {
    const raw = prompt('New paper name (a folder/main is created)');
    const n = raw ? safe(raw) : '';
    if (!n) return;
    const name = `${n}/main`;
    try { await yg('/api/latex/save', { method: 'POST', body: { filename: name, source: TEMPLATE } }); location.hash = `#/write/${encodeURIComponent(name + '.tex')}`; reload(); } catch (e) { alert(e instanceof Error ? e.message : 'Could not create'); }
  };
  return (
    <Screen tab="write">
      <header className="top big"><h1>Write</h1></header>
      <div className="pad muted sm">LaTeX in your vault{loading ? ' · loading…' : ''}</div>
      {err && <p className="err sm pad">{err}</p>}
      <div className="stack pad">
        {files.map((f) => (
          <a key={f.name} className="card link" href={`#/write/${encodeURIComponent(f.name)}`}>
            <b>{stem(f.name)}</b>
            <div className="muted sm mt-s">{(f.size / 1024).toFixed(1)} KB · edited {new Date(f.modified).toLocaleDateString()}</div>
          </a>
        ))}
        {!loading && !err && files.length === 0 && <p className="muted">No .tex files in the vault yet.</p>}
      </div>
      <button className="fab" aria-label="New paper" onClick={create}><Icon name="plus" size={24} /></button>
    </Screen>
  );
}

const b64ToBuf = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;

export function LatexEditor({ id }: { id: string }) {
  const name = stem(id);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'source' | 'pdf'>('source');
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; text: string }>({ kind: 'idle', text: 'Not compiled yet' });
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null);
  const [rev, setRev] = useState(0);
  const gutter = useRef<HTMLDivElement>(null);
  const { state, flush, reset } = useAutosave(text, null, async (t) => { await yg('/api/latex/save', { method: 'POST', body: { filename: name, source: t } }); });

  useEffect(() => {
    setText(null);
    yg<{ source: string }>(`/api/latex/files/${enc(name)}`).then((j) => { reset(j.source); setText(j.source); }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (error) return <Screen><Top back="write" title="Cannot open" /><p className="pad err">{error}</p></Screen>;
  if (text === null) return <Screen><Top back="write" title="Loading…" /></Screen>;

  const lines = text.split('\n').length;
  const compile = async () => {
    setStatus({ kind: 'busy', text: 'Compiling on your server…' });
    await flush();
    try {
      const j = await yg<{ pdf_b64: string }>('/api/latex/compile', { method: 'POST', body: { source: text, filename: name } });
      setPdf(b64ToBuf(j.pdf_b64)); setRev((r) => r + 1);
      setStatus({ kind: 'ok', text: 'Compiled, no errors' });
      setTab('pdf');
    } catch (e) {
      setStatus({ kind: 'err', text: e instanceof Error ? e.message : 'Compile failed' });
    }
  };

  return (
    <Screen>
      <Top back="write" title={<b className="clip">{name}<span className="muted sm"> · {state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Not saved'}</span></b>} right={
        <button className="btn primary pill" onClick={compile} disabled={status.kind === 'busy'}><Icon name="play" size={16} /> Compile</button>
      } />
      {tab === 'source' ? (
        <div className="latex">
          <div className="gutter mono" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}</div>
          <textarea
            className="mono code" spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off"
            value={text} onChange={(e) => setText(e.target.value)}
            onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
          />
        </div>
      ) : pdf ? (
        <PdfView key={rev} load={() => Promise.resolve(pdf.slice(0))} />
      ) : (
        <p className="pad muted">Compile to see the PDF.</p>
      )}
      <div className={`status ${status.kind}`}><span className="dot" /><span className="f1 logtxt">{status.text}</span></div>
      <div className="seg">
        <button className={tab === 'source' ? 'on' : ''} onClick={() => setTab('source')}>Source</button>
        <button className={tab === 'pdf' ? 'on' : ''} onClick={() => setTab('pdf')}>PDF</button>
      </div>
    </Screen>
  );
}
