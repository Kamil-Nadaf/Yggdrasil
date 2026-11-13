import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { TaskItem } from "../../api/client";
import { LatexPromptModal } from "../../components/LatexMenuBar";
import { addDaysISO, diffDays, parseISO, todayISO } from "../../lib/taskDates";
import { allowedFor, formatMinutes } from "../../lib/taskOptions";
import CalendarView from "../CalendarView";
import BoardView from "./BoardView";
import GanttView from "./GanttView";
import TaskPanel from "./TaskPanel";
import { doneStatusId, isDone } from "./TaskBits";
import TimelineView from "./TimelineView";
import WeekPlanner from "./WeekPlanner";
import { matchProject, parseQuickAdd } from "./quickAdd";
import { mainKeyOf } from "./viewTypes";
import { useNow, useTaskData } from "./useTaskData";
import "./tasks.css";

/** A main task (only these carry subtask counts and the starred flag). */
type MainItem = Extract<TaskItem, { kind: "main" }>;
type ViewId = "today" | "inbox" | "upcoming" | "waiting" | "milestones" | "done";
type LayoutId = "board" | "week" | "calendar" | "timeline" | "gantt";
type Sel = { v: ViewId } | { l: LayoutId };

const VIEWS: { id: ViewId; name: string }[] = [
  { id: "today", name: "Today" },
  { id: "inbox", name: "Inbox" },
  { id: "upcoming", name: "Upcoming" },
  { id: "waiting", name: "Waiting on" },
  { id: "milestones", name: "Milestones" },
  { id: "done", name: "Done" },
];
const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: "board", name: "Kanban board" },
  { id: "week", name: "Week planner" },
  { id: "calendar", name: "Calendar" },
  { id: "timeline", name: "Timeline" },
  { id: "gantt", name: "Gantt" },
];
const SEL_KEY = "yggdrasil:research-sel";
const PROJECT_KEY = "yggdrasil:tasks-project";
const PALETTE = ["#b89ae0", "#7fb3e8", "#e8a97f", "#8fd4a4", "#e88fb0", "#d4c46f"];

function readSel(): Sel {
  try {
    const raw = localStorage.getItem(SEL_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && VIEWS.some((x) => x.id === s.v)) return { v: s.v };
      if (s && LAYOUTS.some((x) => x.id === s.l)) return { l: s.l };
    }
  } catch {
    /* optional */
  }
  return { v: "today" };
}

function projectColor(slug: string): string {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function fmtDue(d: string | null, today: string): { text: string; over: boolean } {
  if (!d) return { text: "", over: false };
  const day = d.slice(0, 10);
  if (day === today) return { text: "Today", over: false };
  if (day === addDaysISO(today, 1)) return { text: "Tomorrow", over: false };
  const dt = parseISO(day);
  const text = dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { text, over: day < today };
}

type Props = {
  focus?: { projectSlug: string; mainTaskId: string } | null;
  onFocusConsumed?: () => void;
  requestTab?: "planner" | "list" | "board";
  onTabChange?: (t: "planner" | "list" | "board") => void;
};

/** The Tasks section for research work: view list, quick add, milestones, and kanban / week planner / calendar layouts. */
export default function ResearchTasks({ focus, onFocusConsumed, requestTab, onTabChange }: Props) {
  const data = useTaskData();
  const { items, projects, statuses } = data;
  const [sel, setSel] = useState<Sel>(() => {
    if (requestTab === "planner") return { l: "calendar" };
    if (requestTab === "board") return { l: "board" };
    return readSel();
  });
  const [projectFilter, setProjectFilter] = useState<string>(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) ?? "all";
    } catch {
      return "all";
    }
  });
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addText, setAddText] = useState<Record<string, string>>({});
  const [quick, setQuick] = useState("");
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const [projectModal, setProjectModal] = useState(false);
  const firstReq = useRef(true);

  const anyRunning = items.some((i) => i.timer_started_at);
  const now = useNow(anyRunning);
  const today = todayISO();
  const doneId = doneStatusId(statuses);

  const choose = (s: Sel) => {
    setSel(s);
    try {
      localStorage.setItem(SEL_KEY, JSON.stringify(s));
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    if (firstReq.current) {
      firstReq.current = false;
      return;
    }
    if (requestTab === "planner") choose({ l: "calendar" });
    else if (requestTab === "board") choose({ l: "board" });
    else if (requestTab === "list") choose({ v: "today" });
  }, [requestTab]);

  useEffect(() => {
    if (!onTabChange) return;
    onTabChange("l" in sel ? (sel.l === "board" ? "board" : "planner") : "list");
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focus) return;
    setOpenRef(`${focus.projectSlug}/${focus.mainTaskId}`);
    if ("l" in sel && sel.l === "calendar") choose({ v: "today" });
    onFocusConsumed?.();
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (projectFilter !== "all" && projects.length && !projects.some((p) => p.slug === projectFilter)) setProjectFilter("all");
  }, [projects, projectFilter]);

  const pickProject = (slug: string) => {
    setProjectFilter(slug);
    try {
      localStorage.setItem(PROJECT_KEY, slug);
    } catch {
      /* optional */
    }
  };

  const scoped = useMemo(() => items.filter((i) => projectFilter === "all" || i.project_slug === projectFilter), [items, projectFilter]);
  const mains = useMemo(() => scoped.filter((i): i is MainItem => i.kind === "main"), [scoped]);
  const subsOf = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const i of scoped) {
      if (i.kind !== "subtask") continue;
      const k = mainKeyOf(i);
      m.set(k, [...(m.get(k) || []), i]);
    }
    return m;
  }, [scoped]);

  /** A task's date for planning: its own deadline, else the earliest open subtask deadline. */
  const effDue = useCallback(
    (m: TaskItem): string | null => {
      if (m.deadline) return m.deadline.slice(0, 10);
      const ds = (subsOf.get(m.ref) || []).filter((s) => !isDone(s, statuses) && s.deadline).map((s) => (s.deadline as string).slice(0, 10));
      return ds.length ? ds.sort()[0] : null;
    },
    [subsOf, statuses]
  );

  const sections = useMemo(() => {
    const open = mains.filter((m) => !isDone(m, statuses));
    const waiting = open.filter((m) => !!m.waiting_on);
    const active = open.filter((m) => !m.waiting_on);
    const byDue = (a: MainItem, b: MainItem) => (effDue(a) || "9999").localeCompare(effDue(b) || "9999");
    const focusToday = active.filter((m) => m.is_active || (effDue(m) !== null && (effDue(m) as string) <= today)).sort(byDue);
    const inFocus = new Set(focusToday.map((m) => m.ref));
    const week = active.filter((m) => !inFocus.has(m.ref) && effDue(m) !== null && (effDue(m) as string) <= addDaysISO(today, 7)).sort(byDue);
    const inbox = active.filter((m) => effDue(m) === null && !m.stage).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const upcoming = active.filter((m) => effDue(m) !== null && (effDue(m) as string) > today).sort(byDue);
    const done = mains.filter((m) => isDone(m, statuses));
    const milestones = mains.filter((m) => m.milestone && !isDone(m, statuses)).sort(byDue);
    return { focusToday, week, waiting, inbox, upcoming, done, milestones, todayCount: focusToday.length + week.length };
  }, [mains, statuses, effDue, today]);

  const counts: Record<ViewId, number> = {
    today: sections.focusToday.length,
    inbox: sections.inbox.length,
    upcoming: sections.upcoming.length,
    waiting: sections.waiting.length,
    milestones: sections.milestones.length,
    done: sections.done.length,
  };

  const plannedMin = sections.focusToday.reduce((a, m) => a + (m.estimate_min || 0), 0);

  async function toggleDone(it: TaskItem) {
    await data.patch(it, { status_id: isDone(it, statuses) ? statuses[0]?.id : doneId });
  }

  async function addSub(main: TaskItem) {
    const name = (addText[`s:${main.ref}`] || "").trim();
    if (!name) return;
    setAddText((p) => ({ ...p, [`s:${main.ref}`]: "" }));
    await api.subtasks.create(main.project_slug, main.id, { name });
    await data.reload();
  }

  async function submitQuick() {
    const q = parseQuickAdd(quick, today);
    if (!q.title) {
      setQuickMsg("Type a task title first.");
      return;
    }
    const real = projects.filter((p) => !p.pinned);
    const proj =
      matchProject(projects, q.project) ??
      projects.find((p) => p.slug === projectFilter) ??
      real[0] ??
      projects[0];
    if (!proj) {
      setQuickMsg("Create a project first (+ Project).");
      return;
    }
    if (q.project && !matchProject(projects, q.project)) setQuickMsg(`No project matches #${q.project}; added to ${proj.name}.`);
    else setQuickMsg(null);
    const allowed = allowedFor(statuses, proj.options?.status_ids);
    try {
      const r = await api.mainTasks.create(proj.slug, {
        name: q.title,
        status_id: allowed[0]?.id,
        deadline: q.deadline,
        estimate_min: q.estimate_min,
        stage: q.stage ?? undefined,
      });
      setQuick("");
      await data.reload();
      if (!q.deadline && !q.stage) setOpenRef(`${proj.slug}/${r.main_task.id}`);
    } catch (e) {
      data.setError(e instanceof Error ? e.message : "Could not add task");
    }
  }

  async function createProject(name: string) {
    setProjectModal(false);
    try {
      const r = await api.taskProjects.create(name);
      await data.reload();
      pickProject(r.project.slug);
    } catch (e) {
      data.setError(e instanceof Error ? e.message : "Could not create project");
    }
  }

  function row(it: MainItem) {
    const subs = subsOf.get(it.ref) || [];
    const open = expanded.has(it.ref);
    const done = isDone(it, statuses);
    const due = fmtDue(effDue(it), today);
    return (
      <div key={it.ref} className="rt-item">
        <div className={`rt-row${done ? " done" : ""}`} onClick={() => setOpenRef(it.ref)}>
          <button
            type="button"
            className="tk-caret"
            aria-label={open ? "Collapse subtasks" : "Expand subtasks"}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => {
                const n = new Set(prev);
                if (n.has(it.ref)) n.delete(it.ref);
                else n.add(it.ref);
                return n;
              });
            }}
          >
            {open ? "▾" : "▸"}
          </button>
          <input type="checkbox" checked={done} aria-label="Mark done" onClick={(e) => e.stopPropagation()} onChange={() => void toggleDone(it)} />
          <span className="rt-main">
            <span className="rt-title">{it.name}</span>
            {it.next_step && !done && <span className="rt-next">↳ {it.next_step}</span>}
            {it.waiting_on && !done && <span className="rt-next">⏳ waiting on {it.waiting_on}</span>}
          </span>
          {subs.length > 0 && (
            <span className="tk-sub-count mono muted" title="Subtasks done">
              {it.subtask_done}/{it.subtask_total}
              <span className="tk-mini-bar" aria-hidden="true"><i style={{ width: `${Math.round((100 * it.subtask_done) / Math.max(1, it.subtask_total))}%` }} /></span>
            </span>
          )}
          {it.stage && <span className={`tk-stage tk-stage-${it.stage} on`}>{it.stage[0].toUpperCase() + it.stage.slice(1)}</span>}
          <span className="rt-proj" style={{ borderColor: projectColor(it.project_slug), color: projectColor(it.project_slug) }}>{it.project_name}</span>
          <span className="rt-est mono muted">{formatMinutes(it.estimate_min)}</span>
          <span className={`rt-due mono${due.over ? " over" : ""}`}>{due.text}</span>
        </div>
        {open && (
          <div className="rt-subs">
            {subs.map((s) => {
              const sd = isDone(s, statuses);
              const sdue = fmtDue(s.deadline, today);
              return (
                <div key={s.ref} className={`rt-subrow${sd ? " done" : ""}`} onClick={() => setOpenRef(s.ref)}>
                  <input type="checkbox" checked={sd} aria-label="Mark subtask done" onClick={(e) => e.stopPropagation()} onChange={() => void toggleDone(s)} />
                  <span className="rt-title">{s.name}</span>
                  {s.stage && <span className={`tk-stage tk-stage-${s.stage} on`}>{s.stage[0].toUpperCase() + s.stage.slice(1)}</span>}
                  <span className={`rt-due mono${sdue.over ? " over" : ""}`}>{sdue.text}</span>
                </div>
              );
            })}
            <input
              type="text"
              className="tk-inline-add rt-subadd"
              placeholder="+ Add subtask"
              aria-label={`Add subtask to ${it.name}`}
              value={addText[`s:${it.ref}`] || ""}
              onChange={(e) => setAddText((p) => ({ ...p, [`s:${it.ref}`]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && void addSub(it)}
            />
          </div>
        )}
      </div>
    );
  }

  const group = (title: string, hint: string, rows: MainItem[]) =>
    rows.length === 0 ? null : (
      <section className="rt-group" key={title}>
        <div className="rt-group-head"><span>{title}</span><span className="muted">{hint}</span><span className="mono muted">{rows.length}</span></div>
        {rows.map(row)}
      </section>
    );

  function milestoneCard(m: MainItem, big?: boolean) {
    const total = m.subtask_total;
    const pct = total > 0 ? Math.round((100 * m.subtask_done) / total) : 0;
    const d = m.deadline ? m.deadline.slice(0, 10) : null;
    const left = d ? diffDays(today, d) : null;
    const leftText = left === null ? "set a date" : left < 0 ? `${-left} days late` : left === 0 ? "today" : `${left} day${left === 1 ? "" : "s"}`;
    return (
      <button key={m.ref} type="button" className={`rt-ms${big ? " big" : ""}`} onClick={() => setOpenRef(m.ref)}>
        <span className="rt-ms-top"><span className="rt-ms-label">Milestone</span><span className={`rt-ms-left${left !== null && left < 0 ? " over" : ""}`}>{leftText}</span></span>
        <span className="rt-ms-name">{m.name}</span>
        <span className="rt-ms-bar" aria-label={`${pct}% done`}><i style={{ width: `${pct}%` }} /></span>
        <span className="muted rt-ms-meta">{total > 0 ? `${m.subtask_done} of ${total} subtasks` : "no subtasks yet"}{d ? ` · ${parseISO(d).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""} · {m.project_name}</span>
      </button>
    );
  }

  const viewProps = { data, items: scoped, now, projectFilter, research: true, onOpen: (it: TaskItem) => setOpenRef(it.ref) };
  const layout = "l" in sel ? sel.l : null;
  const view = "v" in sel ? sel.v : null;
  const heading = layout ? LAYOUTS.find((x) => x.id === layout)!.name : VIEWS.find((x) => x.id === view)!.name;
  const showStrip = view === "today" || view === "inbox" || view === "upcoming" || view === "waiting";

  const upcomingGroups = (() => {
    const a: MainItem[] = [], b: MainItem[] = [], c: MainItem[] = [];
    for (const m of sections.upcoming) {
      const d = effDue(m) as string;
      if (d <= addDaysISO(today, 7)) a.push(m);
      else if (d <= addDaysISO(today, 14)) b.push(m);
      else c.push(m);
    }
    return [group("Next 7 days", "", a), group("Following week", "", b), group("Later", "", c)];
  })();

  return (
    <div className="rt-page">
      <nav className="rt-side" aria-label="Task views">
        <h2 className="rt-side-title">Tasks</h2>
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={`rt-side-b${view === v.id ? " on" : ""}`} aria-current={view === v.id ? "page" : undefined} onClick={() => choose({ v: v.id })}>
            <span>{v.name}</span><span className="mono muted">{counts[v.id]}</span>
          </button>
        ))}
        <div className="rt-side-h">Layouts</div>
        {LAYOUTS.map((l) => (
          <button key={l.id} type="button" className={`rt-side-b${layout === l.id ? " on" : ""}`} aria-current={layout === l.id ? "page" : undefined} onClick={() => choose({ l: l.id })}>
            <span>{l.name}</span>
          </button>
        ))}
        <div className="rt-side-h">Projects</div>
        <button type="button" className={`rt-side-b${projectFilter === "all" ? " on" : ""}`} onClick={() => pickProject("all")}><span>All projects</span></button>
        {projects.map((p) => (
          <button key={p.slug} type="button" className={`rt-side-b${projectFilter === p.slug ? " on" : ""}`} onClick={() => pickProject(p.slug)}>
            <span className="rt-dot" style={{ background: projectColor(p.slug) }} /><span className="rt-side-name">{p.name}</span>
            <span className="mono muted">{p.main_task_count}</span>
          </button>
        ))}
        <button type="button" className="btn rt-newproj" onClick={() => setProjectModal(true)}>+ Project</button>
      </nav>

      <div className="rt-main-col">
        <div className="rt-head">
          <h1 className="rt-h1">{heading}</h1>
          {view === "today" && <span className="muted">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} · {plannedMin ? `${formatMinutes(plannedMin)} planned` : "nothing estimated yet"}</span>}
        </div>

        <label className="rt-quick">
          <span className="rt-quick-plus" aria-hidden="true">+</span>
          <input
            type="text"
            aria-label="Quick add task"
            placeholder="Add task…  #project  !read|analyse|write|admin  ~2h  fri"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submitQuick()}
          />
          <span className="mono muted">Enter</span>
        </label>
        {quickMsg && <div className="muted" role="status" style={{ fontSize: 12.5 }}>{quickMsg}</div>}
        {data.error && (
          <div className="tk-error" role="alert">{data.error} <button type="button" className="tk-link" onClick={() => data.setError(null)}>dismiss</button></div>
        )}

        {showStrip && sections.milestones.length > 0 && <div className="rt-strip">{sections.milestones.slice(0, 4).map((m) => milestoneCard(m))}</div>}

        {data.loading && <div className="muted tk-empty">Loading…</div>}
        {!data.loading && view === "today" && (
          <>
            {group("Focus today", "starred, due, or overdue", sections.focusToday)}
            {group("This week", "next deadlines", sections.week)}
            {group("Waiting on others", "nothing to do until someone replies", sections.waiting)}
            {sections.focusToday.length + sections.week.length + sections.waiting.length === 0 && <div className="muted tk-empty">Nothing due. Add a task above, or look in Inbox.</div>}
          </>
        )}
        {!data.loading && view === "inbox" && (sections.inbox.length ? sections.inbox.map(row) : <div className="muted tk-empty">Inbox is empty: every open task has a date or a stage.</div>)}
        {!data.loading && view === "upcoming" && (sections.upcoming.length ? upcomingGroups : <div className="muted tk-empty">No dated tasks ahead.</div>)}
        {!data.loading && view === "waiting" && (sections.waiting.length ? sections.waiting.map(row) : <div className="muted tk-empty">Not waiting on anyone. Set “Waiting on” in a task to park it here.</div>)}
        {!data.loading && view === "milestones" && (
          sections.milestones.length
            ? <div className="rt-ms-grid">{sections.milestones.map((m) => milestoneCard(m, true))}</div>
            : <div className="muted tk-empty">No milestones. Open a task and press “◇ Milestone” to turn it into one; its subtasks become the progress.</div>
        )}
        {!data.loading && view === "done" && (sections.done.length ? sections.done.map(row) : <div className="muted tk-empty">Nothing finished yet.</div>)}

        {!data.loading && layout === "board" && <BoardView {...viewProps} />}
        {!data.loading && layout === "week" && <WeekPlanner {...viewProps} />}
        {layout === "calendar" && <CalendarView onOpenTask={(slug, id) => setOpenRef(`${slug}/${id}`)} />}
        {!data.loading && layout === "timeline" && <TimelineView {...viewProps} />}
        {!data.loading && layout === "gantt" && <GanttView {...viewProps} />}
      </div>

      {openRef && (
        <TaskPanel key={openRef} itemRef={openRef} data={data} now={now} onClose={() => setOpenRef(null)} onOpenOther={(r) => setOpenRef(r)} />
      )}
      <LatexPromptModal
        open={projectModal}
        title="New project"
        label="Project name"
        confirmLabel="Create"
        onClose={() => setProjectModal(false)}
        onConfirm={(v) => v.trim() && void createProject(v.trim())}
      />
    </div>
  );
}
