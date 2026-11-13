import { useState } from 'react';
import { Icon, Screen, Top } from '../ui';
import { daysBetween, isoDay, useY, yg } from '../ygg';

interface Status { id: string; name: string; color: string }
interface Project { slug: string; name: string; pinned: boolean; main_task_count: number }
interface Extra { stage?: string | null; next_step?: string; waiting_on?: string; milestone?: boolean }
interface Main extends Extra { id: string; name: string; deadline: string | null; is_active: boolean; subtask_done: number; subtask_total: number }
interface Sub extends Extra { id: string; name: string; deadline: string | null; status_id: string }
interface Comment { id: string; author: string; at: string; text: string }
interface Link { kind: string; ref: string; label: string }
interface Item extends Extra { id: string; comments: Comment[]; links: Link[]; files: { name: string; size: number }[] }
const STAGES = ['read', 'analyse', 'write', 'admin'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function Tasks({ slug }: { slug?: string }) {
  return slug ? <ProjectView slug={slug} /> : <ProjectList />;
}

function ProjectList() {
  const { data, err, loading, reload } = useY<{ projects: Project[] }>('/api/task-projects', { projects: [] });
  const add = async () => {
    const name = prompt('New project name')?.trim();
    if (name) { await yg('/api/task-projects', { method: 'POST', body: { name } }).catch((e) => alert(e.message)); reload(); }
  };
  return (
    <Screen>
      <Top back="today" title={<h1 className="h2">Tasks</h1>} right={<button className="iconbtn" aria-label="New project" onClick={add}><Icon name="plus" /></button>} />
      {err && <p className="err sm pad">{err}</p>}
      <div className="stack pad">
        {data.projects.map((p) => (
          <a key={p.slug} className="card link" href={`#/tasks/${encodeURIComponent(p.slug)}`}><b>{p.name}</b><div className="muted sm mt-s">{p.main_task_count} main tasks</div></a>
        ))}
        {!loading && !err && data.projects.length === 0 && <p className="muted">No projects yet.</p>}
      </div>
    </Screen>
  );
}

function ProjectView({ slug }: { slug: string }) {
  const today = isoDay();
  const mains = useY<{ main_tasks: Main[] }>(`/api/task-projects/${encodeURIComponent(slug)}/main-tasks`, { main_tasks: [] });
  const st = useY<{ task_statuses: Status[] }>('/api/settings/task-statuses', { task_statuses: [] });
  const [open, setOpen] = useState<string>('');
  const base = `/api/task-projects/${encodeURIComponent(slug)}/main-tasks`;
  const addMain = async () => {
    const name = prompt('New main task')?.trim();
    if (name) { await yg(base, { method: 'POST', body: { name } }).catch((e) => alert(e.message)); mains.reload(); }
  };
  return (
    <Screen>
      <Top back="tasks" title={<b className="clip">{slug}</b>} right={<button className="iconbtn" aria-label="New main task" onClick={addMain}><Icon name="plus" /></button>} />
      {mains.err && <p className="err sm pad">{mains.err}</p>}
      <div className="stack pad">
        {mains.data.main_tasks.map((m) => (
          <section key={m.id} className="card">
            <button className="plainbtn" onClick={() => setOpen(open === m.id ? '' : m.id)}>
              <div className="row between"><b>{m.milestone ? '◆ ' : ''}{m.name}</b><span className="muted sm">{m.stage ? `${cap(m.stage)} · ` : ''}{m.subtask_done}/{m.subtask_total}{m.deadline ? ` · ${daysBetween(today, m.deadline.slice(0, 10))}d` : ''}</span></div>
              {(m.next_step || m.waiting_on) && <div className="muted sm mt-s">{m.waiting_on ? `Waiting on ${m.waiting_on}` : `↳ ${m.next_step}`}</div>}
              <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${m.subtask_total ? (m.subtask_done / m.subtask_total) * 100 : 0}%` }} /></div>
            </button>
            {open === m.id && <TaskDetail slug={slug} id={m.id} onChange={mains.reload} />}
            {open === m.id && <Subtasks slug={slug} base={`${base}/${m.id}/subtasks`} statuses={st.data.task_statuses} onChange={mains.reload} />}
          </section>
        ))}
      </div>
    </Screen>
  );
}

function Subtasks({ slug, base, statuses, onChange }: { slug: string; base: string; statuses: Status[]; onChange: () => void }) {
  const { data, err, reload } = useY<{ subtasks: Sub[] }>(base, { subtasks: [] });
  const [detail, setDetail] = useState('');
  const order = statuses.map((s) => s.id);
  const cycle = async (s: Sub) => {
    const next = order.length ? order[(Math.max(0, order.indexOf(s.status_id)) + 1) % order.length] : s.status_id === 'done' ? 'todo' : 'done';
    await yg(`${base}/${s.id}`, { method: 'PUT', body: { status_id: next } }).catch(() => {});
    reload(); onChange();
  };
  const add = async () => {
    const name = prompt('New subtask')?.trim();
    if (name) { await yg(base, { method: 'POST', body: { name } }).catch((e) => alert(e.message)); reload(); onChange(); }
  };
  return (
    <div className="mt">
      {err && <p className="err sm">{err}</p>}
      {data.subtasks.map((s) => {
        const sx = statuses.find((x) => x.id === s.status_id);
        return (
          <div key={s.id}>
            <div className="row">
              <button className="plainbtn subrow f1" onClick={() => cycle(s)} aria-label={`${s.name}: ${sx?.name || s.status_id}. Tap to change`}>
                <span className="dot" style={{ background: sx?.color || '#6B7280', width: 10, height: 10 }} />
                <span className={`f1 ${s.status_id === 'done' ? 'muted strike' : ''}`}>{s.name}</span>
                <span className="muted sm">{s.stage ? `${cap(s.stage)} · ` : ''}{sx?.name || s.status_id}</span>
              </button>
              <button className="link-btn" onClick={() => setDetail(detail === s.id ? '' : s.id)} aria-expanded={detail === s.id}>Details</button>
            </div>
            {detail === s.id && <TaskDetail slug={slug} id={s.id} onChange={() => { reload(); onChange(); }} />}
          </div>
        );
      })}
      <button className="link-btn" onClick={add}>+ Add subtask</button>
    </div>
  );
}

/** Research fields of one task or subtask: stage, next step, waiting on, comments and links. Attachments are managed on the desktop. */
function TaskDetail({ slug, id, onChange }: { slug: string; id: string; onChange: () => void }) {
  const path = `/api/task-items/${encodeURIComponent(slug)}/${id}`;
  const { data, err, reload } = useY<{ item: Item | null }>(path, { item: null });
  const [text, setText] = useState('');
  const item = data.item;
  const put = async (body: Record<string, unknown>) => { await yg(path, { method: 'PUT', body }).catch((e) => alert(e.message)); reload(); onChange(); };
  const comment = async () => {
    const t = text.trim(); if (!t) return;
    setText('');
    await yg(`${path}/comments`, { method: 'POST', body: { text: t, author: localStorage.getItem('yggdrasil:author') || undefined } }).catch((e) => alert(e.message));
    reload();
  };
  if (err) return <p className="err sm">{err}</p>;
  if (!item) return null;
  return (
    <div className="stack mt">
      <div className="chips wrap" role="group" aria-label="Research stage">
        {STAGES.map((x) => <button key={x} className={`chip${item.stage === x ? ' on' : ''}`} aria-pressed={item.stage === x} onClick={() => put({ stage: item.stage === x ? '' : x })}>{cap(x)}</button>)}
      </div>
      <input className="input" key={`n${item.next_step}`} defaultValue={item.next_step || ''} placeholder="Next step" aria-label="Next step" onBlur={(e) => e.target.value.trim() !== (item.next_step || '') && put({ next_step: e.target.value })} />
      <input className="input" key={`w${item.waiting_on}`} defaultValue={item.waiting_on || ''} placeholder="Waiting on (person or event)" aria-label="Waiting on" onBlur={(e) => e.target.value.trim() !== (item.waiting_on || '') && put({ waiting_on: e.target.value })} />
      {item.links.length > 0 && <div className="muted sm">{item.links.map((l) => `${l.kind}: ${l.label}`).join(' · ')}</div>}
      {item.files.length > 0 && <div className="muted sm">Files: {item.files.map((f) => f.name).join(', ')}</div>}
      {item.comments.map((c) => (
        <div key={c.id} className="card">
          <div className="muted sm">{c.author} · {c.at.replace('T', ' ').slice(0, 16)}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <input className="input f1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" aria-label="Add a comment" onKeyDown={(e) => e.key === 'Enter' && comment()} />
        <button className="chip" onClick={comment} disabled={!text.trim()}>Post</button>
      </div>
    </div>
  );
}
