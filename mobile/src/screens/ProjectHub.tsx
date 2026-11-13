import { useState } from 'react';
import DeckPlayer, { deckList } from './DeckPlayer';
import { Icon, Screen, Top } from '../ui';
import { daysBetween, isoDay, useY, yg, type Item } from '../ygg';

/** Projects = the desktop task projects. Reading items join one with a "project:<slug>" tag. */
interface TProject { slug: string; name: string; pinned: boolean }
interface Main { id: string; name: string; deadline: string | null; is_active: boolean; status_id?: string; subtask_done: number; subtask_total: number }
interface NoteFile { name: string; modified: string }

export const projectTag = (slug: string) => `project:${slug}`;
const isDone = (m: Main) => m.status_id === 'done' || (m.subtask_total > 0 && m.subtask_done === m.subtask_total);
const dueText = (d: string, today: string) => {
  const n = daysBetween(today, d.slice(0, 10));
  return n < 0 ? `${-n}d overdue` : n === 0 ? 'today' : `in ${n}d`;
};

function useProjectMains(slug: string) {
  return useY<{ main_tasks: Main[] }>(`/api/task-projects/${encodeURIComponent(slug)}/main-tasks`, { main_tasks: [] });
}

function Card({ p, items }: { p: TProject; items: Item[] }) {
  const today = isoDay();
  const { data } = useProjectMains(p.slug);
  const ms = data.main_tasks;
  const total = ms.reduce((a, m) => a + (m.subtask_total || 1), 0);
  const done = ms.reduce((a, m) => a + (m.subtask_total ? m.subtask_done : isDone(m) ? 1 : 0), 0);
  const over = ms.filter((m) => !isDone(m) && m.deadline && m.deadline.slice(0, 10) < today).length;
  const next = ms.filter((m) => !isDone(m) && m.deadline && m.deadline.slice(0, 10) >= today).map((m) => m.deadline!.slice(0, 10)).sort()[0];
  const reads = items.filter((i) => (i.tags || []).includes(projectTag(p.slug))).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <a className="card link" href={`#/projects/${encodeURIComponent(p.slug)}`}>
      <div className="row between"><b>{p.name}</b>{over > 0 && <span className="err sm">{over} overdue</span>}</div>
      <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div>
      <div className="muted sm mt-s">{done}/{total} tasks · {pct}%{next ? ` · next ${dueText(next, today)}` : ''}</div>
      <div className="muted sm mt-s">{ms.filter((m) => m.is_active).length} starred · {reads} readings</div>
    </a>
  );
}

export function ProjectList() {
  const projects = useY<{ projects: TProject[] }>('/api/task-projects', { projects: [] });
  const lib = useY<{ books: Item[] }>('/api/reading/library', { books: [] });
  const add = async () => {
    const name = prompt('New project name')?.trim();
    if (name) { await yg('/api/task-projects', { method: 'POST', body: { name } }).catch((e) => alert(e.message)); projects.reload(); }
  };
  const list = projects.data.projects.filter((p) => !p.pinned);
  return (
    <Screen tab="projects">
      <Top title={<h1 className="h2">Projects</h1>} right={<button className="iconbtn" aria-label="New project" onClick={add}><Icon name="plus" /></button>} />
      {projects.err && <p className="err sm pad">{projects.err}</p>}
      <div className="stack pad">
        {list.map((p) => <Card key={p.slug} p={p} items={lib.data.books} />)}
        {!projects.loading && !projects.err && list.length === 0 && <p className="muted">No projects yet. Tap + to create one.</p>}
      </div>
    </Screen>
  );
}

type Tab = 'overview' | 'tasks' | 'notes' | 'slides' | 'reading';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['tasks', 'Tasks'], ['notes', 'Notes'], ['slides', 'Slides'], ['reading', 'Reading']];

export function ProjectView({ slug }: { slug: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const projects = useY<{ projects: TProject[] }>('/api/task-projects', { projects: [] });
  const name = projects.data.projects.find((p) => p.slug === slug)?.name || slug;
  return (
    <Screen>
      <Top back="projects" title={<b className="clip">{name}</b>} />
      <div className="chips pad">
        {TABS.map(([id, label]) => <button key={id} className={`chip ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'overview' && <Overview slug={slug} />}
      {tab === 'tasks' && <TasksTab slug={slug} />}
      {tab === 'notes' && <NotesTab slug={slug} />}
      {tab === 'slides' && <SlidesTab slug={slug} />}
      {tab === 'reading' && <ReadingTab slug={slug} />}
    </Screen>
  );
}

function Overview({ slug }: { slug: string }) {
  const today = isoDay();
  const { data, err, reload } = useProjectMains(slug);
  const open = data.main_tasks.filter((m) => !isDone(m));
  const dd = (m: Main) => (m.deadline || '').slice(0, 10);
  const over = open.filter((m) => dd(m) && dd(m) < today);
  const soon = open.filter((m) => dd(m) && dd(m) >= today && daysBetween(today, dd(m)) <= 7);
  const star = open.filter((m) => m.is_active && !over.includes(m) && !soon.includes(m));
  const toggleStar = async (m: Main) => { await yg(`/api/task-projects/${encodeURIComponent(slug)}/main-tasks/${m.id}`, { method: 'PUT', body: { is_active: !m.is_active } }).catch(() => {}); reload(); };
  const group = (title: string, ms: Main[], bad = false) => ms.length === 0 ? null : (
    <section key={title}>
      <div className={`muted sm ${bad ? 'err' : ''}`} style={{ margin: '12px 0 4px', fontWeight: 600 }}>{title} · {ms.length}</div>
      {ms.sort((a, b) => dd(a).localeCompare(dd(b))).map((m) => (
        <div key={m.id} className="card row between" style={{ marginBottom: 8 }}>
          <a href={`#/tasks/${encodeURIComponent(slug)}`} style={{ flex: 1, minWidth: 0 }}>
            <div className="clip">{m.name}</div>
            <div className="muted sm">{m.subtask_done}/{m.subtask_total}{dd(m) ? ` · ${dueText(dd(m), today)}` : ''}</div>
          </a>
          <button className="iconbtn" aria-label={m.is_active ? 'Unstar' : 'Star'} onClick={() => void toggleStar(m)} style={{ color: m.is_active ? '#E9B949' : undefined }}>{m.is_active ? '★' : '☆'}</button>
        </div>
      ))}
    </section>
  );
  return (
    <div className="pad">
      {err && <p className="err sm">{err}</p>}
      {group('Overdue', over, true)}
      {group('Due in 7 days', soon)}
      {group('Starred', star)}
      {open.length > 0 && over.length + soon.length + star.length === 0 && <p className="muted">Nothing due or starred.</p>}
      {data.main_tasks.length === 0 && !err && <p className="muted">No tasks yet.</p>}
    </div>
  );
}

function TasksTab({ slug }: { slug: string }) {
  return (
    <div className="pad stack">
      <a className="btn primary" href={`#/tasks/${encodeURIComponent(slug)}`}>Open all tasks</a>
      <p className="muted sm">Same tasks as the Tasks screen and desktop — edits sync everywhere.</p>
    </div>
  );
}

function NotesTab({ slug }: { slug: string }) {
  const folder = `Projects/${slug}`;
  const { data, err, reload } = useY<{ files: NoteFile[] }>('/api/notes/files', { files: [] });
  const files = data.files.filter((f) => f.name.startsWith(folder + '/')).sort((a, b) => b.modified.localeCompare(a.modified));
  const create = async () => {
    const n = prompt('Note name')?.replace(/[^A-Za-z0-9._ -]/g, '').trim();
    if (!n) return;
    const name = `${folder}/${n}`;
    try { await yg('/api/notes/files', { method: 'POST', body: { filename: name, source: '' } }); reload(); location.hash = `#/notes/${encodeURIComponent(name + '.md')}`; } catch (e) { alert(e instanceof Error ? e.message : 'Could not create'); }
  };
  return (
    <div>
      <div className="pad"><button className="btn primary" onClick={create}>New note</button></div>
      {err && <p className="err sm pad">{err}</p>}
      <div className="list">
        {files.length === 0 && !err && <p className="muted pad">No notes in this project yet.</p>}
        {files.map((f) => (
          <a key={f.name} className="note" href={`#/notes/${encodeURIComponent(f.name)}`}>
            <span className="t">{f.name.slice(folder.length + 1).replace(/\.md$/i, '')}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function SlidesTab({ slug }: { slug: string }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const decks = deckList(slug);
  return (
    <div>
      <p className="muted sm pad">View and present only. Make or edit decks in the desktop app; they arrive with Drive sync.</p>
      <div className="list">
        {decks.length === 0 && <p className="muted pad">No decks in this project yet.</p>}
        {decks.map((d) => (
          <button key={d.name} className="note" onClick={() => setPlaying(d.name)}>
            <span className="t">{d.name.replace(/\.json$/i, '')}</span>
          </button>
        ))}
      </div>
      {playing && <DeckPlayer slug={slug} name={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

function ReadingTab({ slug }: { slug: string }) {
  const { data, err, loading } = useY<{ books: Item[] }>('/api/reading/library', { books: [] });
  const mine = data.books.filter((b) => (b.tags || []).includes(projectTag(slug)));
  return (
    <div className="list">
      {err && <p className="err sm pad">{err}</p>}
      {!loading && !err && mine.length === 0 && <p className="muted pad">Nothing tagged yet. In Library, open an item’s ⋯ menu → Add to project.</p>}
      {mine.map((b) => (
        <a key={b.slug} className="note" href={b.has_file ? `#/read/${encodeURIComponent(b.slug)}` : '#/library'}>
          <div className="row between"><span className="t">{b.title}</span><span className="muted sm">{b.status}</span></div>
          <div className="muted preview">{b.kind} · {b.authors[0] || ''}{b.year ? ` ${b.year}` : ''}{b.has_file ? '' : ' · no file'}</div>
        </a>
      ))}
    </div>
  );
}

/** Library sheet section: tick the projects an item belongs to. */
export function ProjectPicker({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const projects = useY<{ projects: TProject[] }>('/api/task-projects', { projects: [] });
  const tags = item.tags || [];
  const toggle = async (slug: string) => {
    const t = projectTag(slug);
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    item.tags = next;
    await yg(`/api/reading/${encodeURIComponent(item.slug)}`, { method: 'PATCH', body: { tags: next } }).catch(() => {});
    onChanged();
  };
  const list = projects.data.projects.filter((p) => !p.pinned);
  if (list.length === 0) return null;
  return (
    <div>
      <div className="muted sm" style={{ margin: '8px 0 4px' }}>Projects</div>
      {list.map((p) => (
        <label key={p.slug} className="grow" style={{ gap: 10 }}>
          <input type="checkbox" checked={tags.includes(projectTag(p.slug))} onChange={() => void toggle(p.slug)} />
          <span className="f1">{p.name}</span>
        </label>
      ))}
    </div>
  );
}
