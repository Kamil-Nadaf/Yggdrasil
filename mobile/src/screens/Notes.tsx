import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon, Screen, Top } from '../ui';
import { useAutosave } from '../useAutosave';
import { useY, yg } from '../ygg';

interface NoteFile { name: string; modified: string; size: number }
const title = (n: string) => n.replace(/\.md$/i, '').split('/').pop() || n;
const folderOf = (n: string) => (n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '');
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const stripFm = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n?/, '');
const safe = (s: string) => s.replace(/[^A-Za-z0-9._ -]/g, '').trim();

export function NotesList() {
  const { data, err, loading, reload } = useY<{ folders: string[]; files: NoteFile[] }>('/api/notes/files', { folders: [], files: [] });
  const [folder, setFolder] = useState('All');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const top = ['All', ...new Set(data.files.map((f) => folderOf(f.name).split('/')[0]).filter(Boolean))];
  const files = data.files
    .filter((f) => (folder === 'All' || folderOf(f.name).split('/')[0] === folder) && (!q || f.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.modified.localeCompare(a.modified));
  const create = async () => {
    const raw = prompt(`Note name${folder !== 'All' ? ` (in ${folder})` : ''}`);
    const n = raw ? safe(raw) : '';
    if (!n) return;
    const name = `${folder !== 'All' ? folder + '/' : ''}${n}`;
    try { await yg('/api/notes/files', { method: 'POST', body: { filename: name, source: '' } }); location.hash = `#/notes/${encodeURIComponent(name + '.md')}`; reload(); } catch (e) { alert(e instanceof Error ? e.message : 'Could not create'); }
  };
  return (
    <Screen tab="notes">
      <header className="top big">
        <h1>Notes</h1>
        <button className="iconbtn" aria-label="Search notes" onClick={() => { setSearching(!searching); setQ(''); }}><Icon name="search" /></button>
      </header>
      {searching && <div className="pad"><input autoFocus className="input" placeholder="Search note names" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      <div className="chips pad">{top.map((f) => <button key={f} className={`chip ${folder === f ? 'on' : ''}`} onClick={() => setFolder(f)}>{f}</button>)}</div>
      {err && <p className="err sm pad">{err}</p>}
      <div className="list">
        {!loading && !err && files.length === 0 && <p className="muted pad">No notes here. Tap + to write one.</p>}
        {files.map((f) => (
          <a key={f.name} className="note" href={`#/notes/${encodeURIComponent(f.name)}`}>
            <div className="row between"><span className="t">{title(f.name)}</span><span className="muted sm">{ago(f.modified)}</span></div>
            <div className="muted preview">{folderOf(f.name) || 'Notes'}</div>
          </a>
        ))}
      </div>
      <button className="fab" aria-label="New note" onClick={create}><Icon name="plus" size={24} /></button>
    </Screen>
  );
}

const TOOLS: [string, string, string][] = [
  ['#', '## ', 'Heading'], ['B', '**', 'Bold'], ['-', '- ', 'List'], ['[ ]', '- [ ] ', 'Checkbox'],
  ['[[', '[[', 'Link to note'], ['$', '$', 'Math'], ['</>', '`', 'Code'],
];

export function NoteEditor({ id }: { id: string }) {
  const name = id;
  const { data: all } = useY<{ files: NoteFile[] }>('/api/notes/files', { files: [] });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const { state, reset } = useAutosave(text, null, (t) => yg('/api/notes/files', { method: 'POST', body: { filename: name, source: t } }));

  useEffect(() => {
    setText(null);
    yg<{ source: string }>(`/api/notes/files/${name.split('/').map(encodeURIComponent).join('/')}`)
      .then((j) => { reset(j.source); setText(j.source); })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const html = useMemo(() => {
    const body = stripFm(text || '').replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, t: string) => {
      const target = all.files.find((f) => title(f.name).toLowerCase() === t.trim().toLowerCase());
      return target ? `[${t}](#/notes/${encodeURIComponent(target.name)})` : t;
    });
    return DOMPurify.sanitize(marked.parse(body, { async: false }) as string);
  }, [text, all]);

  if (error) return <Screen><Top back="notes" title="Cannot open note" /><p className="pad err">{error}</p></Screen>;
  if (text === null) return <Screen><Top back="notes" title="Loading…" /></Screen>;

  const insert = (snip: string) => {
    const el = ta.current!;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = text.slice(a, b);
    const pair = snip === '**' || snip === '$' || snip === '`';
    const t = pair ? snip + sel + snip : snip === '[[' ? `[[${sel}]]` : snip + sel;
    setText(text.slice(0, a) + t + text.slice(b));
    requestAnimationFrame(() => { el.focus(); const pos = a + (pair || snip === '[[' ? snip.length : t.length); el.setSelectionRange(pos, pos + sel.length); });
  };
  const del = async () => {
    if (!confirm('Delete this note from your vault?')) return;
    await yg(`/api/notes/files/${name.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }).catch(() => {});
    location.hash = '#/notes';
  };

  return (
    <Screen>
      <Top back="notes" title={<span className="muted sm">{folderOf(name) || 'Notes'} · {state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : 'Not saved — retrying'}</span>} right={
        <>
          <button className="iconbtn" aria-label={preview ? 'Edit' : 'Preview'} onClick={() => setPreview(!preview)}><Icon name={preview ? 'write' : 'eye'} /></button>
          <button className="iconbtn" aria-label="Delete note" onClick={del}><Icon name="trash" /></button>
        </>
      } />
      <div className="editor">
        <div className="note-title">{title(name)}</div>
        {preview
          ? <article className="md" dangerouslySetInnerHTML={{ __html: html }} />
          : <textarea ref={ta} className="mono body" value={text} placeholder="Write in markdown…" onChange={(e) => setText(e.target.value)} />}
      </div>
      {!preview && (
        <div className="toolbar">
          {TOOLS.map(([label, snip, aria]) => <button key={aria} aria-label={aria} className="mono" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(snip)}>{label}</button>)}
        </div>
      )}
    </Screen>
  );
}
