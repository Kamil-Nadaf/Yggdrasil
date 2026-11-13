import { useEffect, useMemo, useRef, useState } from 'react';
import { daysBetween, isoDay, useY, yg } from '../ygg';

const HABITS: [string, string][] = [['rise', 'Rise early'], ['arxiv', 'arXiv'], ['reading', 'Reading'], ['research', 'Research'], ['extra_read', 'Extra reading'], ['exercise', 'Exercise'], ['mental', 'Mental health']];
const addDays = (d: string, n: number) => isoDay(new Date(Date.parse(d + 'T12:00:00') + n * 864e5));
const fmtDue = (d: string | null, today: string) => {
  if (!d) return '';
  const n = daysBetween(today, d.slice(0, 10));
  return n < 0 ? `${-n}d overdue` : n === 0 ? 'today' : `${n}d left`;
};

function Err({ text }: { text: string }) { return text ? <p className="err sm">{text}</p> : null; }

export function ActiveTasks() {
  const today = isoDay();
  const { data, err, loading } = useY<{ active: { status_id?: string; project_name: string; main_task_id: string; main_task_name: string; deadline: string | null; subtask_done: number; subtask_total: number }[] }>('/api/tasks/active-summary', { active: [] });
  const st = useY<{ task_statuses: { id: string; name: string; color: string }[] }>('/api/settings/task-statuses', { task_statuses: [] });
  return (
    <section className="card">
      <div className="row between"><b>Active tasks</b><a className="muted sm" href="#/tasks">All tasks</a></div>
      <Err text={err} />
      {!loading && !err && data.active.length === 0 && <p className="muted sm">No active tasks. Mark a main task active on desktop.</p>}
      {data.active.map((t) => (
        <div key={t.project_name + t.main_task_id} className="mt">
          <div className="row between"><span>{(() => { const x = st.data.task_statuses.find((y) => y.id === t.status_id); return x ? <span className="chip" style={{ borderColor: x.color, color: x.color, marginRight: 8, padding: '0 8px', minHeight: 22, fontSize: 11 }}>{x.name}</span> : null; })()}{t.main_task_name}</span><span className="muted sm">{t.subtask_done}/{t.subtask_total}{t.deadline ? ` · ${fmtDue(t.deadline, today)}` : ''}</span></div>
          <div className="muted sm">{t.project_name}</div>
          <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${t.subtask_total ? (t.subtask_done / t.subtask_total) * 100 : 0}%` }} /></div>
        </div>
      ))}
    </section>
  );
}

export function DaysLeft() {
  const today = isoDay();
  const goals = useY<{ goals: { id: string; name: string; start_date: string; end_date: string }[] }>('/api/settings/goals', { goals: [] });
  const cal = useY<{ events: { id: string; title: string; date: string; start: string; all_day: boolean }[] }>('/api/calendar/events', { events: [] });
  const upcoming = cal.data.events.filter((e) => e.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 4);
  return (
    <section className="card">
      <b>Days left</b>
      <Err text={goals.err} />
      {goals.data.goals.map((g) => {
        const total = Math.max(1, daysBetween(g.start_date, g.end_date));
        const day = Math.min(total, Math.max(0, daysBetween(g.start_date, today)));
        const left = Math.max(0, daysBetween(today, g.end_date));
        return (
          <div key={g.id} className="mt">
            <div className="row between"><span>{g.name}</span><span className="muted sm">Day {day} of {total}</span></div>
            <div className="big-num">{left}<span className="muted sm"> days left</span></div>
            <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${(day / total) * 100}%` }} /></div>
          </div>
        );
      })}
      {!goals.loading && !goals.err && goals.data.goals.length === 0 && <p className="muted sm">No countdowns set. Add one in desktop Settings → Goals.</p>}
      {upcoming.length > 0 && <div className="label" style={{ paddingBottom: 4 }}>Upcoming</div>}
      {upcoming.map((e) => (
        <div key={e.id} className="row between sm" style={{ padding: '4px 0' }}><span>{e.title}</span><span className="muted">{e.date.slice(5)}{e.all_day ? '' : ` ${e.start}`} · {fmtDue(e.date, today)}</span></div>
      ))}
    </section>
  );
}

const CATS = [['papers', 'Papers'], ['books', 'Books'], ['writing', 'Writing']] as const;
const fmtDur = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}h ` : ''}${Math.floor((s % 3600) / 60)}m`;

export function ReadingTimer() {
  const [cat, setCat] = useState<(typeof CATS)[number][0]>(() => { try { return (localStorage.getItem('ygg.timerCat') as 'papers') || 'papers'; } catch { return 'papers'; } });
  const [running, setRunning] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  const hist = useY<{ goal_minutes: number; days: { date: string; books: number; papers: number; writing: number }[] }>(`/api/reading/history?today=${isoDay()}&days=1`, { goal_minutes: 30, days: [] });
  const pending = useRef(0);
  const flush = async (c: string) => {
    const n = Math.min(pending.current, 3600);
    if (n < 1) return;
    pending.current = 0;
    try { await yg('/api/reading/time', { method: 'POST', body: { category: c, seconds: n, date: isoDay() } }); setErr(''); hist.reload(); } catch (e) { pending.current += n; setErr(e instanceof Error ? e.message : 'Could not save time'); }
  };
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setSecs((x) => x + 1); pending.current += 1;
      if (pending.current >= 60) void flush(cat);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, cat]);
  useEffect(() => () => { void flush(cat); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const d = hist.data.days[0];
  const total = d ? d.books + d.papers + d.writing : 0;
  const stop = () => { setRunning(false); void flush(cat); };
  return (
    <section className="card">
      <div className="row between"><b>Reading timer</b><span className="muted sm">Goal {hist.data.goal_minutes}m</span></div>
      <div className="big-num mono">{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</div>
      <div className="chips" style={{ padding: '8px 0 14px' }}>
        {CATS.map(([k, l]) => <button key={k} disabled={running} className={`chip ${cat === k ? 'on' : ''}`} onClick={() => { setCat(k); try { localStorage.setItem('ygg.timerCat', k); } catch { /* ignore */ } }}>{l}</button>)}
      </div>
      <div className="row gap">
        <button className="btn primary" onClick={() => (running ? stop() : setRunning(true))}>{running ? 'Pause' : secs ? 'Resume' : 'Start'}</button>
        {secs > 0 && !running && <button className="btn" onClick={() => setSecs(0)}>Reset</button>}
      </div>
      <div className="muted sm mt">Today logged on desktop: {fmtDur(d?.papers || 0)} papers · {fmtDur(d?.books || 0)} books · {fmtDur(d?.writing || 0)} writing ({fmtDur(total)})</div>
      <Err text={err || hist.err} />
    </section>
  );
}

const countHabits = (h: Record<string, unknown>) => HABITS.filter(([k]) => h[k] === true).length;
type HabitDay = { date: string; habits: Record<string, unknown> };
type TaskDay = { date: string; count: number; names?: string[] };

/** Same layout as the desktop Dashboard heatmap: one row per habit, one column per day, plus a "Subtasks done" row. Tap a day for details. */
export function ActivityHeatmap() {
  const today = isoDay();
  const DAYS = 28;
  const start = addDays(today, -(DAYS - 1));
  const habits = useY<{ days: HabitDay[] }>(`/api/habits/range?start=${start}&end=${today}`, { days: [] });
  const tasks = useY<{ days: TaskDay[] }>(`/api/tasks/completed-by-day?start=${start}&end=${today}`, { days: [] });
  const [sel, setSel] = useState(today);
  const days: string[] = [];
  for (let i = 0; i < DAYS; i++) days.push(addDays(start, i));
  const hmap = Object.fromEntries(habits.data.days.map((d) => [d.date, d.habits || {}]));
  const tmap = Object.fromEntries(tasks.data.days.map((d) => [d.date, d]));
  const maxT = Math.max(3, ...tasks.data.days.map((d) => d.count));
  const level = (v: number, max: number) => (v <= 0 ? 0 : Math.min(3, Math.max(1, Math.ceil((v / max) * 3))));
  const label = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const hs = (hmap[sel] || {}) as Record<string, unknown>;
  const doneHabits = HABITS.filter(([k]) => hs[k] === true);
  const st = tmap[sel];
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, [habits.data.days.length]);
  return (
    <section className="card">
      <div className="row between"><b>Activity</b><span className="muted sm">Last {DAYS} days</span></div>
      <Err text={habits.err || tasks.err} />
      <div className="hm">
        <div className="hm-labels">
          <div className="hm-corner" />
          {HABITS.map(([k, l]) => <div key={k} className="hm-label">{l}</div>)}
          <div className="hm-label hm-tasks">Subtasks done</div>
        </div>
        <div className="hm-scroll" ref={scroller}>
          <div className="hm-head">{days.map((d) => <button key={d} className={`hm-day${d === sel ? ' sel' : ''}${d === today ? ' today' : ''}`} onClick={() => setSel(d)} aria-label={label(d)}>{Number(d.slice(8))}</button>)}</div>
          {HABITS.map(([k]) => (
            <div key={k} className="hm-row">
              {days.map((d) => <i key={d} onClick={() => setSel(d)} className={`hm-cell${(hmap[d] as Record<string, unknown> | undefined)?.[k] === true ? ' l3' : ''}${d === sel ? ' sel' : ''}`} />)}
            </div>
          ))}
          <div className="hm-row hm-tasks">
            {days.map((d) => { const n = tmap[d]?.count || 0; return <i key={d} onClick={() => setSel(d)} className={`hm-cell${n ? ` l${level(n, maxT)}` : ''}${d === sel ? ' sel' : ''}`} />; })}
          </div>
        </div>
      </div>
      <div className="hm-legend muted sm"><span>Less</span><i className="hm-cell" /><i className="hm-cell l1" /><i className="hm-cell l2" /><i className="hm-cell l3" /><span>More</span></div>
      <div className="hm-detail">
        <div className="row between"><b className="sm">{label(sel)}</b><span className="muted sm">{doneHabits.length} of {HABITS.length} habits · {st?.count || 0} tasks</span></div>
        {doneHabits.length > 0 && <div className="sm" style={{ marginTop: 6 }}>{doneHabits.map(([, l]) => l).join(' · ')}</div>}
        {(st?.names || []).map((n, i) => <div key={i} className="sm hm-task">✓ {n}</div>)}
        {!doneHabits.length && !(st?.count) && <div className="muted sm" style={{ marginTop: 6 }}>Nothing logged. Tap any day to see what you did.</div>}
      </div>
    </section>
  );
}

export function MentalLightcurve() {
  const today = isoDay();
  const start = addDays(today, -29);
  const habits = useY<{ days: { date: string; habits: Record<string, unknown> }[] }>(`/api/habits/range?start=${start}&end=${today}`, { days: [] });
  const [local, setLocal] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState('');
  const days = habits.data.days;
  const todayH = { ...(days.find((d) => d.date === today)?.habits || {}), ...local };
  const set = async (patch: Record<string, unknown>) => {
    setLocal((l) => ({ ...l, ...patch }));
    try { await yg(`/api/habits/${today}`, { method: 'POST', body: { habits: patch } }); setErr(''); habits.reload(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
  };
  const pts = useMemo(() => days.map((d, i) => ({ i, y: countHabits(d.habits), m: d.habits.mental_health })), [days]);
  const W = 340, H = 110, L = 22, B = 18;
  const x = (i: number) => L + (i / Math.max(1, pts.length - 1)) * (W - L - 6);
  const y = (v: number) => H - B - (v / HABITS.length) * (H - B - 8);
  const mood = todayH.mental_health;
  return (
    <section className="card">
      <b>Mental health + lightcurve</b>
      <div className="label" style={{ paddingTop: 12 }}>How are you today?</div>
      <div className="row gap">
        {([[-1, 'Low'], [0, 'Neutral'], [1, 'Good']] as const).map(([v, l]) => <button key={v} className={`btn ${mood === v ? 'primary' : ''}`} onClick={() => set({ mental_health: v })}>{l}</button>)}
      </div>
      {pts.length > 1 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="lc" role="img" aria-label="Habits lightcurve, last 30 days">
          {[0, 3, 7].map((g) => <line key={g} x1={L} x2={W - 6} y1={y(g)} y2={y(g)} stroke="var(--line2)" strokeWidth="1" />)}
          {[0, 3, 7].map((g) => <text key={g} x={2} y={y(g) + 4} fontSize="9" fill="var(--muted)">{g}</text>)}
          <polyline fill="none" stroke="var(--accent)" strokeWidth="1.6" points={pts.map((p) => `${x(p.i)},${y(p.y)}`).join(' ')} />
          {pts.map((p) => p.m === -1 || p.m === 1 ? <circle key={p.i} cx={x(p.i)} cy={y(p.y)} r="3" fill={p.m === 1 ? 'var(--accent)' : 'var(--err)'} /> : null)}
          <text x={L} y={H - 4} fontSize="9" fill="var(--muted)">{start.slice(5)}</text>
          <text x={W - 34} y={H - 4} fontSize="9" fill="var(--muted)">{today.slice(5)}</text>
        </svg>
      )}
      <div className="muted sm">Habits done per day, last 30 days · green dot = good mood, red = low</div>
      <div className="label">Today’s habits</div>
      <div className="chips wrap">
        {HABITS.map(([k, l]) => <button key={k} className={`chip ${todayH[k] === true ? 'on' : ''}`} onClick={() => set({ [k]: todayH[k] !== true })}>{l}</button>)}
      </div>
      <Err text={err || habits.err} />
    </section>
  );
}
