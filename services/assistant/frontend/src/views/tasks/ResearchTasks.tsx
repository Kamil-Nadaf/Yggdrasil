import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { TaskItem } from "../../api/client";
import { LatexPromptModal } from "../../components/LatexMenuBar";
import { addDaysISO, parseISO, todayISO } from "../../lib/taskDates";
import { allowedFor, formatMinutes } from "../../lib/taskOptions";
import CalendarView from "../CalendarView";
import BoardView from "./BoardView";
import GanttView from "./GanttView";
import ScheduleView from "./ScheduleView";
import TaskPanel from "./TaskPanel";
import { doneStatusId, isDone } from "./TaskBits";
import { matchProject, parseQuickAdd } from "./quickAdd";
import { mainKeyOf } from "./viewTypes";
import { useNow, useTaskData } from "./useTaskData";
import "./tasks.css";

/** A main task (only these carry subtask counts and the starred flag). */
type MainItem = Extract<TaskItem, { kind: "main" }>;
type LayoutId = "main" | "schedule" | "board" | "gantt";
type ListFilter = "open" | "done";

const LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: "main", name: "List + Calendar" },
  { id: "schedule", name: "Schedule" },
  { id: "board", name: "Kanban" },
  { id: "gantt", name: "Gantt" },
];
const LAYOUT_KEY = "yggdrasil:tasks-layout";
const FILTER_KEY = "yggdrasil:tasks-list-filter";
const PROJECT_KEY = "yggdrasil:tasks-project";
const SPLIT_KEY = "yggdrasil:tasks-split";
const HIDE_KEY = "yggdrasil:tasks-split-hide";
const SPLIT_MIN = 0.24;
const SPLIT_MAX = 0.7;
const SPLIT_DEFAULT = 0.4;
const PALETTE = ["#b89ae0", "#7fb3e8", "#e8a97f", "#8fd4a4", "#e88fb0", "#d4c46f"];

function readLayout(): LayoutId {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === "main" || v === "schedule" || v === "board" || v === "gantt") return v;
  } catch {
    /* optional */
  }
  return "main";
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
  return { text: day < today ? `Overdue · ${text}` : text, over: day < today };
}
const fmtDay = (iso: string | null | undefined) => (iso ? parseISO(iso.slice(0, 10)).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

type Props = {
  focus?: { projectSlug: string; mainTaskId: string } | null;
  onFocusConsumed?: () => void;
  requestTab?: "planner" | "list" | "board";
  onTabChange?: (t: "planner" | "list" | "board") => void;
};

/**
 * The Tasks section: one page with the task list on the left and the calendar on the right,
 * plus Kanban and Gantt as the two other views. Click a day (or an hour) to add a task.
 */
export default function ResearchTasks({ focus, onFocusConsumed, requestTab, onTabChange }: Props) {
  const data = useTaskData();
  const { items, projects, statuses, priorities, tags } = data;
  const [layout, setLayout] = useState<LayoutId>(() => (requestTab === "board" ? "board" : requestTab === "planner" ? "main" : readLayout()));
  const [filter, setFilter] = useState<ListFilter>(() => {
    try {
      return localStorage.getItem(FILTER_KEY) === "done" ? "done" : "open";
    } catch {
      return "open";
    }
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
  const [calKey, setCalKey] = useState(0);
  const firstReq = useRef(true);
  const [split, setSplit] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(SPLIT_KEY));
      return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
    } catch {
      return SPLIT_DEFAULT;
    }
  });
  const [hidden, setHidden] = useState<"" | "list" | "cal">(() => {
    try {
      const v = localStorage.getItem(HIDE_KEY);
      return v === "list" || v === "cal" ? v : "";
    } catch {
      return "";
    }
  });
  const [dragging, setDragging] = useState(false);
  const fillRef = useRef<HTMLDivElement>(null);
  const [fillH, setFillH] = useState(640);

  const anyRunning = items.some((i) => i.timer_started_at);
  const now = useNow(anyRunning);
  const today = todayISO();
  const doneId = doneStatusId(statuses);

  const chooseLayout = (l: LayoutId) => {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* optional */
    }
  };
  const chooseFilter = (f: ListFilter) => {
    setFilter(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    if (firstReq.current) {
      firstReq.current = false;
      return;
    }
    if (requestTab === "board") chooseLayout("board");
    else if (requestTab === "planner") {
      // Gantt reports itself as "planner"; keep it instead of bouncing back to main.
      if (layout !== "gantt") chooseLayout("main");
    } else if (requestTab === "list") {
      // Both List + Calendar and Schedule report "list"; only leave Kanban/Gantt.
      if (layout === "board" || layout === "gantt") chooseLayout("main");
    }
  }, [requestTab]);

  useEffect(() => {
    onTabChange?.(layout === "board" ? "board" : layout === "gantt" ? "planner" : "list");
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const filled = layout === "main" || layout === "schedule";
  useEffect(() => {
    if (!filled) return;
    const fit = () => {
      const el = fillRef.current;
      if (!el) return;
      setFillH(Math.max(480, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 20)));
    };
    fit();
    const t = window.setTimeout(fit, 250);
    window.addEventListener("resize", fit);
    const ro = new ResizeObserver(fit);
    ro.observe(document.body);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, [filled, data.loading, data.error]);

  const saveSplit = (v: number, h: "" | "list" | "cal" = "") => {
    setSplit(v);
    setHidden(h);
    try {
      localStorage.setItem(SPLIT_KEY, String(v));
      localStorage.setItem(HIDE_KEY, h);
    } catch {
      /* optional */
    }
  };
  const toggleHide = (side: "list" | "cal") => {
    const h = hidden === side ? "" : side;
    setHidden(h);
    try {
      localStorage.setItem(HIDE_KEY, h);
    } catch {
      /* optional */
    }
  };
  const startDrag = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setDragging(true);
    let last = split;
    const move = (ev: MouseEvent) => {
      last = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, (ev.clientX - box.left) / box.width));
      setSplit(last);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setDragging(false);
      try {
        localStorage.setItem(SPLIT_KEY, String(last));
      } catch {
        /* optional */
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const keySplit = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      saveSplit(Math.max(SPLIT_MIN, split - 0.02));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      saveSplit(Math.min(SPLIT_MAX, split + 0.02));
    }
  };

  useEffect(() => {
    if (!focus) return;
    setOpenRef(`${focus.projectSlug}/${focus.mainTaskId}`);
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

  const openMains = useMemo(() => mains.filter((m) => !isDone(m, statuses)), [mains, statuses]);
  const doneMains = useMemo(
    () => mains.filter((m) => isDone(m, statuses)).sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || "")),
    [mains, statuses]
  );
  /** Open tasks grouped by project, the project with the nearest deadline first. */
  const groups = useMemo(() => {
    const by = new Map<string, MainItem[]>();
    for (const m of openMains) by.set(m.project_slug, [...(by.get(m.project_slug) || []), m]);
    const key = (l: MainItem[]) => l.map((m) => effDue(m) || "9999").sort()[0];
    return [...by.entries()]
      .map(([slug, list]) => ({
        slug,
        name: list[0].project_name,
        list: [...list].sort((a, b) => (effDue(a) || "9999").localeCompare(effDue(b) || "9999")),
      }))
      .sort((a, b) => key(a.list).localeCompare(key(b.list)) || a.name.localeCompare(b.name));
  }, [openMains, effDue]);

  async function toggleDone(it: TaskItem) {
    await data.patch(it, { status_id: isDone(it, statuses) ? statuses[0]?.id : doneId });
    setCalKey((k) => k + 1);
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
    const proj = matchProject(projects, q.project) ?? projects.find((p) => p.slug === projectFilter) ?? real[0] ?? projects[0];
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
      setCalKey((k) => k + 1);
      if (!q.deadline && !q.stage) setOpenRef(`${proj.slug}/${r.main_task.id}`);
    } catch (e) {
      data.setError(e instanceof Error ? e.message : "Could not add task");
    }
  }

  /** Calendar click → a task due on that day. */
  const createFromCalendar = useCallback(
    async (slug: string, name: string, date: string) => {
      const proj = projects.find((p) => p.slug === slug);
      const allowed = allowedFor(statuses, proj?.options?.status_ids);
      await api.mainTasks.create(slug, { name, status_id: allowed[0]?.id, deadline: date });
      await data.reload();
      setCalKey((k) => k + 1);
    },
    [projects, statuses, data]
  );

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

  const priName = (id: string | null) => priorities.find((p) => p.id === id)?.name ?? "";

  function row(it: MainItem) {
    const subs = subsOf.get(it.ref) || [];
    const open = expanded.has(it.ref);
    const done = isDone(it, statuses);
    const due = fmtDue(effDue(it), today);
    const pri = priName(it.priority_id);
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
          {pri && <span className="tp-pri mono">{pri}</span>}
          <span className={`rt-due tp-due mono${due.over ? " over" : ""}`}>{due.text}</span>
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
                  <span className={`rt-due tp-due mono${sdue.over ? " over" : ""}`}>{sdue.text}</span>
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

  const overdueCount = openMains.filter((m) => { const d = effDue(m); return !!d && d < today; }).length;
  const totalSpentMin = doneMains.reduce((a, m) => a + Math.round((m.tracked_sec || 0) / 60), 0);
  const viewProps = { data, items: scoped, now, projectFilter, research: true, onOpen: (it: TaskItem) => setOpenRef(it.ref) };
  const calProjects = projects.map((p) => ({ slug: p.slug, name: p.name }));

  return (
    <div className="tp-page">
      <div className="tp-head">
        <h1 className="tp-h1">Tasks</h1>
        <span className="muted tp-meta mono">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} · {openMains.length} open</span>
        <span style={{ flex: 1 }} />
        <select value={projectFilter} onChange={(e) => pickProject(e.target.value)} aria-label="Project filter" className="tp-select">
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        {layout === "main" && (
          <div className="tk-seg tp-seg tp-presets" role="group" aria-label="Split">
            <button type="button" className={!hidden && Math.abs(split - 0.62) < 0.02 ? "on" : ""} title="Wide list" onClick={() => saveSplit(0.62)}>List</button>
            <button type="button" className={!hidden && Math.abs(split - 0.5) < 0.02 ? "on" : ""} title="Even split" onClick={() => saveSplit(0.5)}>Even</button>
            <button type="button" className={!hidden && Math.abs(split - 0.3) < 0.02 ? "on" : ""} title="Wide calendar" onClick={() => saveSplit(0.3)}>Calendar</button>
          </div>
        )}
        <button type="button" className="btn" onClick={() => setProjectModal(true)}>+ Project</button>
        <div className="tk-seg tp-seg" role="tablist" aria-label="Task layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="tab" aria-selected={layout === l.id} className={layout === l.id ? "on" : ""} onClick={() => chooseLayout(l.id)}>{l.name}</button>
          ))}
        </div>
      </div>

      {data.error && (
        <div className="tk-error" role="alert">{data.error} <button type="button" className="tk-link" onClick={() => data.setError(null)}>dismiss</button></div>
      )}

      {filled && (
        <div ref={fillRef} className="tp-fill" style={{ height: fillH }}>
          {layout === "main" && (
            <div className={`tp-split${dragging ? " dragging" : ""}`}>
              <section
                className={`tp-panel tp-list${hidden === "list" ? " collapsed" : ""}`}
                style={{ flex: hidden === "list" ? "0 0 44px" : hidden === "cal" ? "1 1 0" : `0 0 calc(${(split * 100).toFixed(2)}% - 7px)` }}
                aria-label="Task list"
              >
                {hidden === "list" ? (
                  <button type="button" className="tp-rail" onClick={() => toggleHide("list")} aria-label="Show task list" title="Show task list">
                    <span aria-hidden="true">›</span>
                    <span className="tp-rail-t">Tasks · {openMains.length}</span>
                  </button>
                ) : (
                  <>
                    <div className="tp-bar">
                      <div className="tp-filter" role="tablist" aria-label="Show">
                        <button type="button" role="tab" aria-selected={filter === "open"} className={filter === "open" ? "on" : ""} onClick={() => chooseFilter("open")}>Open <span className="mono">{openMains.length}</span></button>
                        <button type="button" role="tab" aria-selected={filter === "done"} className={filter === "done" ? "on" : ""} onClick={() => chooseFilter("done")}>Done <span className="mono">{doneMains.length}</span></button>
                      </div>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="tp-sq" onClick={() => toggleHide("list")} aria-label="Hide task list" title="Hide task list">‹</button>
                    </div>
                    <div className="tp-scroll">
            <label className="rt-quick tp-quick">
              <span className="rt-quick-plus" aria-hidden="true">+</span>
              <input
                type="text"
                aria-label="Quick add task"
                placeholder="Add task…  #project  !priority  ~2h  fri"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submitQuick()}
              />
              <span className="mono muted">Enter</span>
            </label>
            {quickMsg && <div className="muted" role="status" style={{ fontSize: 12.5 }}>{quickMsg}</div>}


            {data.loading && <div className="muted tk-empty">Loading…</div>}

            {!data.loading && filter === "open" && (
              groups.length === 0 ? (
                <div className="muted tk-empty">Nothing open. Add a task above, or click a day in the calendar.</div>
              ) : (
                groups.map((g) => (
                  <section className="rt-group" key={g.slug}>
                    <div className="rt-group-head">
                      <i className="rt-dot" style={{ background: projectColor(g.slug) }} />
                      <span>{g.name}</span>
                      <span className="muted" />
                      <span className="mono muted">{g.list.length}</span>
                    </div>
                    {g.list.map(row)}
                  </section>
                ))
              )
            )}

            {!data.loading && filter === "done" && (
              doneMains.length === 0 ? (
                <div className="muted tk-empty">Nothing finished yet.</div>
              ) : (
                <div className="tp-done" role="table" aria-label="Finished tasks">
                  <div className="tp-done-row tp-done-head mono" role="row">
                    <span>Task</span><span>Started</span><span>Finished</span><span>Spent</span><span>Priority</span>
                  </div>
                  {doneMains.map((m) => (
                    <div key={m.ref} className="tp-done-row" role="row" onClick={() => setOpenRef(m.ref)}>
                      <span className="tp-done-t">
                        <i className="rt-dot" style={{ background: projectColor(m.project_slug) }} />
                        <span className="tp-done-name">{m.name}</span>
                        {m.tags.length > 0 && <span className="tp-done-tags muted">{m.tags.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean).join(", ")}</span>}
                      </span>
                      <span className="mono">{fmtDay(m.start || m.created_at)}</span>
                      <span className="mono">{fmtDay(m.completed_at)}</span>
                      <span className="mono">{formatMinutes(Math.round((m.tracked_sec || 0) / 60)) || "—"}</span>
                      <span className="mono">{priName(m.priority_id) || "—"}</span>
                    </div>
                  ))}
                  <div className="tp-done-foot mono muted">Total time spent {formatMinutes(totalSpentMin) || "—"}</div>
                </div>
              )
            )}
                    </div>
                    <div className="tp-foot mono muted">
                      <span>{openMains.length} open</span>
                      {overdueCount > 0 && <span className="tp-over">{overdueCount} overdue</span>}
                    </div>
                  </>
                )}
              </section>

              {!hidden && (
                <button
                  type="button"
                  className="tp-grip"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize list and calendar. Drag, or use the left and right arrow keys. Double-click to reset."
                  title="Drag to resize · double-click to reset"
                  onMouseDown={startDrag}
                  onDoubleClick={() => saveSplit(SPLIT_DEFAULT)}
                  onKeyDown={keySplit}
                >
                  <span />
                </button>
              )}
              {hidden && <span className="tp-gap" />}

              <section className={`tp-panel tp-cal${hidden === "cal" ? " collapsed" : ""}`} style={{ flex: hidden === "cal" ? "0 0 44px" : "1 1 0" }} aria-label="Calendar">
                {hidden === "cal" ? (
                  <button type="button" className="tp-rail" onClick={() => toggleHide("cal")} aria-label="Show calendar" title="Show calendar">
                    <span aria-hidden="true">‹</span>
                    <span className="tp-rail-t">Calendar</span>
                  </button>
                ) : (
                  <>
                    <div className="tp-cal-body">
                      <CalendarView
                        compact
                        refreshKey={calKey}
                        projects={calProjects}
                        onCreateTask={createFromCalendar}
                        onOpenTask={(slug, id) => setOpenRef(`${slug}/${id}`)}
                      />
                    </div>
                    <div className="tp-foot mono muted">
                      <span>Click a day to add a task or event</span>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="tp-sq" onClick={() => toggleHide("cal")} aria-label="Hide calendar" title="Hide calendar">›</button>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {layout === "schedule" && !data.loading && (
            <ScheduleView
              data={data}
              mains={mains}
              effDue={effDue}
              isDone={(m) => isDone(m, statuses)}
              projectColor={projectColor}
              onOpen={(r) => setOpenRef(r)}
              onChanged={() => setCalKey((k) => k + 1)}
              height={fillH}
            />
          )}
        </div>
      )}

      {layout === "board" && !data.loading && <BoardView {...viewProps} />}
      {layout === "gantt" && !data.loading && <GanttView {...viewProps} />}

      {openRef && (
        <TaskPanel key={openRef} itemRef={openRef} data={data} now={now} onClose={() => { setOpenRef(null); setCalKey((k) => k + 1); }} onOpenOther={(r) => setOpenRef(r)} />
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
