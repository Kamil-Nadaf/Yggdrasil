import { useState } from 'react';
import { Icon, Screen, Top } from '../ui';
import { daysBetween, isoDay, useY, yg } from '../ygg';

interface Status { id: string; name: string; color: string }
interface Project { slug: string; name: string; pinned: boolean; main_task_count: number }
interface Main { id: string; name: string; deadline: string | null; is_active: boolean; subtask_done: number; subtask_total: number }
interface Sub { id: string; name: string; deadline: string | null; status_id: string }

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
              <div className="row between"><b>{m.name}</b><span className="muted sm">{m.subtask_done}/{m.subtask_total}{m.deadline ? ` · ${daysBetween(today, m.deadline.slice(0, 10))}d` : ''}</span></div>
              <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${m.subtask_total ? (m.subtask_done / m.subtask_total) * 100 : 0}%` }} /></div>
            </button>
            {open === m.id && <Subtasks base={`${base}/${m.id}/subtasks`} statuses={st.data.task_statuses} onChange={mains.reload} />}
          </section>
        ))}
      </div>
    </Screen>
  );
}

function Subtasks({ base, statuses, onChange }: { base: string; statuses: Status[]; onChange: () => void }) {
  const { data, err, reload } = useY<{ subtasks: Sub[] }>(base, { subtasks: [] });
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
          <button key={s.id} className="plainbtn subrow" onClick={() => cycle(s)} aria-label={`${s.name}: ${sx?.name || s.status_id}. Tap to change`}>
            <span className="dot" style={{ background: sx?.color || '#6B7280', width: 10, height: 10 }} />
            <span className={`f1 ${s.status_id === 'done' ? 'muted strike' : ''}`}>{s.name}</span>
            <span className="muted sm">{sx?.name || s.status_id}</span>
          </button>
        );
      })}
      <button className="link-btn" onClick={add}>+ Add subtask</button>
    </div>
  );
}
