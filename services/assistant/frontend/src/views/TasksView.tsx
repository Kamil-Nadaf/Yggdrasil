import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { TaskItem, TaskProject } from "../api/client";
import { LatexPromptModal } from "../components/LatexMenuBar";
import { allowedFor } from "../lib/taskOptions";
import CalendarView from "./CalendarView";
import BoardView from "./tasks/BoardView";
import GanttView from "./tasks/GanttView";
import ListView from "./tasks/ListView";
import TaskPanel from "./tasks/TaskPanel";
import TimelineView from "./tasks/TimelineView";
import { doneStatusId } from "./tasks/TaskBits";
import { useNow, useTaskData } from "./tasks/useTaskData";
import "./tasks/tasks.css";

export type TasksTab = "planner" | "list" | "board";
type Tab = TasksTab;
type PlannerView = "calendar" | "timeline" | "gantt";
const PLANNER_VIEWS: { id: PlannerView; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "timeline", label: "Timeline" },
  { id: "gantt", label: "Gantt" },
];
const PLANNER_KEY = "yggdrasil:planner-view";
const TAB_KEY = "yggdrasil:tasks-tab";
const PROJECT_KEY = "yggdrasil:tasks-project";
const DONE_KEY = "yggdrasil:tasks-show-done";

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* optional */
  }
}

/** Project-level choice of which custom statuses / priorities / tags this project offers. */
function ProjectOptionsPopover({
  project,
  data,
  onClose,
  onDeleted,
}: {
  project: TaskProject;
  data: ReturnType<typeof useTaskData>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [status, setStatus] = useState<Set<string>>(() => new Set(allowedFor(data.statuses, project.options.status_ids).map((x) => x.id)));
  const [pri, setPri] = useState<Set<string>>(() => new Set(allowedFor(data.priorities, project.options.priority_ids).map((x) => x.id)));
  const [tag, setTag] = useState<Set<string>>(() => new Set(allowedFor(data.tags, project.options.tag_ids).map((x) => x.id)));
  const [err, setErr] = useState<string | null>(null);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };
  // "Everything ticked" is stored as null so newly created global options appear automatically.
  const norm = (set: Set<string>, all: { id: string }[]) => (all.every((x) => set.has(x.id)) ? null : all.filter((x) => set.has(x.id)).map((x) => x.id));

  async function save() {
    if (status.size === 0) {
      setErr("Keep at least one status.");
      return;
    }
    if (pri.size === 0 && data.priorities.length) {
      setErr("Keep at least one priority.");
      return;
    }
    try {
      await api.taskProjects.setOptions(project.slug, {
        status_ids: norm(status, data.statuses),
        priority_ids: norm(pri, data.priorities),
        tag_ids: norm(tag, data.tags),
      });
      await data.reload();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function del() {
    if (!window.confirm(`Delete project "${project.name}" and everything inside it?`)) return;
    await api.taskProjects.delete(project.slug);
    await data.reload();
    onDeleted();
  }

  const group = (title: string, all: { id: string; name: string }[], set: Set<string>, setter: (s: Set<string>) => void, empty: string) => (
    <fieldset className="tk-opt-group">
      <legend>{title}</legend>
      {all.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{empty}</div>}
      {all.map((o) => (
        <label key={o.id} className="tk-check">
          <input type="checkbox" checked={set.has(o.id)} onChange={() => toggle(set, setter, o.id)} /> {o.name}
        </label>
      ))}
    </fieldset>
  );

  return (
    <div className="tk-pop tk-opts" role="dialog" aria-label="Project options">
      <div className="tk-pop-title">{project.name} — choose from your custom lists</div>
      {group("Statuses", data.statuses, status, setStatus, "")}
      {group("Priorities", data.priorities, pri, setPri, "")}
      {group("Tags", data.tags, tag, setTag, "No tags yet — define them in Settings → Task Priorities & Tags.")}
      {err && <div style={{ color: "var(--crit)", fontSize: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {!project.pinned && <button type="button" className="btn btn-crit" onClick={() => void del()}>Delete project</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}

export default function TasksView({
  focus,
  onFocusConsumed,
  requestTab,
  onTabChange,
}: {
  focus?: { projectSlug: string; mainTaskId: string } | null;
  onFocusConsumed?: () => void;
  requestTab?: TasksTab;
  onTabChange?: (t: TasksTab) => void;
}) {
  const data = useTaskData();
  const [tab, setTab] = useState<Tab>(() => {
    if (requestTab) return requestTab;
    const v = readLS(TAB_KEY, "list");
    if (v === "list" || v === "board" || v === "planner") return v;
    return v === "calendar" || v === "timeline" || v === "gantt" ? "planner" : "list";
  });
  const [plannerView, setPlannerView] = useState<PlannerView>(() => {
    const v = readLS(PLANNER_KEY, "");
    if (v === "calendar" || v === "timeline" || v === "gantt") return v;
    const old = readLS(TAB_KEY, "");
    return old === "timeline" || old === "gantt" ? old : "calendar";
  });
  const firstTab = useRef(true);
  useEffect(() => { if (firstTab.current) { firstTab.current = false; return; } if (requestTab) setTab(requestTab); }, [requestTab]);
  useEffect(() => { onTabChange?.(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  /** What is actually on screen: the planner shows one of three views. */
  const eff: "calendar" | "timeline" | "gantt" | "list" | "board" = tab === "planner" ? plannerView : tab;
  const [projectFilter, setProjectFilter] = useState<string>(() => readLS(PROJECT_KEY, "all"));
  const [showDone, setShowDone] = useState(() => readLS(DONE_KEY, "1") === "1");
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newProject, setNewProject] = useState("");
  const [optsOpen, setOptsOpen] = useState(false);
  const [projectModal, setProjectModal] = useState(false);

  const { items, projects, statuses } = data;
  const doneId = doneStatusId(statuses);
  const anyRunning = items.some((i) => i.timer_started_at);
  const now = useNow(anyRunning);

  // A filter pointing at a deleted project falls back to "all".
  useEffect(() => {
    if (projectFilter !== "all" && projects.length && !projects.some((p) => p.slug === projectFilter)) setProjectFilter("all");
  }, [projects, projectFilter]);

  // Dashboard / calendar → open a specific task.
  useEffect(() => {
    if (!focus) return;
    setOpenRef(`${focus.projectSlug}/${focus.mainTaskId}`);
    if (tab === "planner" && plannerView === "calendar") setTab("list");
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const changePlannerView = (v: PlannerView) => {
    setPlannerView(v);
    writeLS(PLANNER_KEY, v);
  };
  useEffect(() => { writeLS(TAB_KEY, tab); }, [tab]);
  const changeProject = (v: string) => {
    setProjectFilter(v);
    writeLS(PROJECT_KEY, v);
    setOptsOpen(false);
  };

  const visible: TaskItem[] = items.filter(
    (i) => (projectFilter === "all" || i.project_slug === projectFilter) && (showDone || i.status_id !== doneId)
  );
  const selectedProject = projects.find((p) => p.slug === projectFilter);

  const startNew = () => {
    setNewProject(selectedProject?.slug || projects.find((p) => !p.pinned)?.slug || projects[0]?.slug || "");
    setNewName("");
    setNewOpen(true);
  };

  const createTask = useCallback(async () => {
    const n = newName.trim();
    if (!n || !newProject) return;
    const proj = projects.find((p) => p.slug === newProject);
    const allowed = allowedFor(statuses, proj?.options?.status_ids);
    try {
      const r = await api.mainTasks.create(newProject, { name: n, status_id: allowed[0]?.id });
      setNewOpen(false);
      await data.reload();
      setOpenRef(`${newProject}/${r.main_task.id}`);
    } catch (e) {
      data.setError(e instanceof Error ? e.message : "Could not create task");
    }
  }, [newName, newProject, projects, statuses, data]);

  async function createProject(name: string) {
    setProjectModal(false);
    try {
      const r = await api.taskProjects.create(name);
      await data.reload();
      changeProject(r.project.slug);
    } catch (e) {
      data.setError(e instanceof Error ? e.message : "Could not create project");
    }
  }

  const viewProps = { data, items: visible, now, projectFilter, onOpen: (it: TaskItem) => setOpenRef(it.ref) };

  return (
    <div className="tk-page">

      <div className="tk-toolbar">
        <div className="tk-pop-anchor">
          <button type="button" className="btn btn-primary" onClick={startNew}>+ New task</button>
          {newOpen && (
            <div className="tk-pop" role="dialog" aria-label="New task">
              <input
                autoFocus
                type="text"
                placeholder="Task name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createTask();
                  if (e.key === "Escape") setNewOpen(false);
                }}
              />
              <select value={newProject} onChange={(e) => setNewProject(e.target.value)} aria-label="Project">
                {projects.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.name}</option>
                ))}
              </select>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setNewOpen(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={!newName.trim()} onClick={() => void createTask()}>Create &amp; open</button>
              </div>
            </div>
          )}
        </div>

        {tab === "planner" && (
          <div className="tk-seg" role="tablist" aria-label="Planner view">
            {PLANNER_VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={plannerView === v.id} className={`tk-seg-b${plannerView === v.id ? " on" : ""}`} onClick={() => changePlannerView(v.id)}>
                {v.id === "calendar" ? "Month" : v.label}
              </button>
            ))}
          </div>
        )}

        {eff !== "calendar" && (
          <>
            <select value={projectFilter} onChange={(e) => changeProject(e.target.value)} aria-label="Project filter">
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>{p.name}</option>
              ))}
            </select>
            <label className="tk-check">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(e) => {
                  setShowDone(e.target.checked);
                  writeLS(DONE_KEY, e.target.checked ? "1" : "0");
                }}
              />{" "}
              Show done
            </label>
          </>
        )}
        <button type="button" className="btn" onClick={() => setProjectModal(true)}>+ Project</button>
        {selectedProject && eff !== "calendar" && (
          <div className="tk-pop-anchor">
            <button type="button" className="btn" onClick={() => setOptsOpen((v) => !v)} aria-expanded={optsOpen}>Project options</button>
            {optsOpen && (
              <ProjectOptionsPopover
                key={selectedProject.slug}
                project={selectedProject}
                data={data}
                onClose={() => setOptsOpen(false)}
                onDeleted={() => {
                  setOptsOpen(false);
                  changeProject("all");
                }}
              />
            )}
          </div>
        )}
      </div>

      {data.error && (
        <div className="tk-error" role="alert">
          {data.error} <button type="button" className="tk-link" onClick={() => data.setError(null)}>dismiss</button>
        </div>
      )}

      {eff === "calendar" && <CalendarView onOpenTask={(slug, id) => setOpenRef(`${slug}/${id}`)} />}
      {eff !== "calendar" && data.loading && <div className="muted tk-empty">Loading…</div>}
      {eff === "list" && !data.loading && <ListView {...viewProps} />}
      {eff === "board" && !data.loading && <BoardView {...viewProps} />}
      {eff === "timeline" && !data.loading && <TimelineView {...viewProps} />}
      {eff === "gantt" && !data.loading && <GanttView {...viewProps} />}

      {openRef && (
        <TaskPanel
          key={openRef}
          itemRef={openRef}
          data={data}
          now={now}
          onClose={() => setOpenRef(null)}
          onOpenOther={(r) => setOpenRef(r)}
        />
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
