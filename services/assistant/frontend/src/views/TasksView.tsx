import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { api, type TaskProject, type MainTask, type Subtask, type TaskStatusDef } from "../api/client";
import { LatexPromptModal } from "../components/LatexMenuBar";
import DeadlinePicker from "../components/DeadlinePicker";
import StatusPill from "../components/StatusPill";
import {
  ensureTaskStatuses,
  getCachedTaskStatuses,
  TASK_STATUSES_EVENT,
  STATUS_ICON_GLYPH,
} from "../lib/taskStatuses";

type Mode = "list" | "kanban";
type StatusFilter = "all" | string;

function mtKey(projectSlug: string, mainTaskId: string) {
  return `${projectSlug}:${mainTaskId}`;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="task-progress-bar" title={`${pct}%`}>
      <div className="task-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

interface KanbanCardData {
  mainTask: MainTask;
  projectSlug: string;
  projectName: string;
}

export default function TasksView({
  focus,
  onFocusConsumed,
}: {
  focus?: { projectSlug: string; mainTaskId: string } | null;
  onFocusConsumed?: () => void;
}) {
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [statuses, setStatuses] = useState<TaskStatusDef[]>(() => getCachedTaskStatuses());
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("list");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [mainTasksByProject, setMainTasksByProject] = useState<Record<string, MainTask[]>>({});
  const [expandedMainTasks, setExpandedMainTasks] = useState<Set<string>>(new Set());
  const [subtasksByKey, setSubtasksByKey] = useState<Record<string, Subtask[]>>({});
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newMainTaskName, setNewMainTaskName] = useState<Record<string, string>>({});
  const [newSubtaskName, setNewSubtaskName] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortByStatus, setSortByStatus] = useState(false);
  const [kanbanCards, setKanbanCards] = useState<KanbanCardData[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // The status a subtask jumps to via the quick-complete checkbox — the
  // literal "done" status if it still exists, else whatever is last in order.
  const doneStatusId = statuses.find((s) => s.id === "done")?.id ?? statuses[statuses.length - 1]?.id ?? "done";
  const todoStatusId = statuses[0]?.id ?? "todo";

  function statusRank(id: string): number {
    const i = statuses.findIndex((s) => s.id === id);
    return i === -1 ? statuses.length : i;
  }

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  }

  useEffect(() => {
    ensureTaskStatuses(() => api.taskStatuses.get()).then(setStatuses);
    const onUpdate = () => setStatuses(getCachedTaskStatuses());
    window.addEventListener(TASK_STATUSES_EVENT, onUpdate);
    return () => window.removeEventListener(TASK_STATUSES_EVENT, onUpdate);
  }, []);

  const refreshProjects = useCallback(async () => {
    const r = await api.taskProjects.list();
    setProjects(r.projects);
    return r.projects;
  }, []);

  const loadMainTasks = useCallback(async (slug: string) => {
    const r = await api.mainTasks.list(slug);
    setMainTasksByProject((prev) => ({ ...prev, [slug]: r.main_tasks }));
    return r.main_tasks;
  }, []);

  const loadSubtasks = useCallback(async (slug: string, mainTaskId: string) => {
    const r = await api.subtasks.list(slug, mainTaskId);
    setSubtasksByKey((prev) => ({ ...prev, [mtKey(slug, mainTaskId)]: r.subtasks }));
    return r.subtasks;
  }, []);

  useEffect(() => {
    refreshProjects().finally(() => setLoading(false));
  }, [refreshProjects]);

  // Dashboard bar click → expand and reveal that project/main task.
  useEffect(() => {
    if (!focus) return;
    (async () => {
      setExpandedProjects((prev) => new Set(prev).add(focus.projectSlug));
      await loadMainTasks(focus.projectSlug);
      const key = mtKey(focus.projectSlug, focus.mainTaskId);
      setExpandedMainTasks((prev) => new Set(prev).add(key));
      await loadSubtasks(focus.projectSlug, focus.mainTaskId);
      onFocusConsumed?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const refreshKanban = useCallback(async () => {
    const projectList = projects.length ? projects : await refreshProjects();
    const cards: KanbanCardData[] = [];
    for (const project of projectList) {
      const mainTasks = await loadMainTasks(project.slug);
      for (const mt of mainTasks) {
        cards.push({ mainTask: mt, projectSlug: project.slug, projectName: project.name });
      }
    }
    setKanbanCards(cards);
  }, [projects, refreshProjects, loadMainTasks]);

  useEffect(() => {
    if (mode === "kanban") void refreshKanban();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function toggleProjectExpand(slug: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
    if (!mainTasksByProject[slug]) await loadMainTasks(slug);
  }

  async function toggleMainTaskExpand(slug: string, id: string) {
    const key = mtKey(slug, id);
    setExpandedMainTasks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!subtasksByKey[key]) await loadSubtasks(slug, id);
  }

  async function createProject(name: string) {
    setNewProjectOpen(false);
    try {
      await api.taskProjects.create(name);
      await refreshProjects();
      flash(`Created ${name}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not create project");
    }
  }

  async function deleteProject(project: TaskProject) {
    if (project.pinned) return;
    if (!window.confirm(`Delete project "${project.name}" and everything inside it?`)) return;
    await api.taskProjects.delete(project.slug);
    await refreshProjects();
  }

  async function createMainTask(slug: string) {
    const name = (newMainTaskName[slug] || "").trim();
    if (!name) return;
    await api.mainTasks.create(slug, { name });
    setNewMainTaskName((prev) => ({ ...prev, [slug]: "" }));
    await loadMainTasks(slug);
    await refreshProjects();
  }

  async function deleteMainTask(slug: string, id: string) {
    if (!window.confirm("Delete this main task and its subtasks?")) return;
    await api.mainTasks.delete(slug, id);
    await loadMainTasks(slug);
    await refreshProjects();
  }

  async function toggleActive(slug: string, mt: MainTask) {
    await api.mainTasks.update(slug, mt.id, { is_active: !mt.is_active });
    await loadMainTasks(slug);
  }

  async function updateMainTaskStatus(slug: string, mt: MainTask, statusId: string) {
    await api.mainTasks.update(slug, mt.id, { status_id: statusId });
    await loadMainTasks(slug);
  }

  async function updateDeadline(slug: string, mt: MainTask, deadline: string | null) {
    await api.mainTasks.update(slug, mt.id, { deadline });
    await loadMainTasks(slug);
  }

  async function createSubtask(slug: string, mainTaskId: string) {
    const key = mtKey(slug, mainTaskId);
    const name = (newSubtaskName[key] || "").trim();
    if (!name) return;
    await api.subtasks.create(slug, mainTaskId, { name });
    setNewSubtaskName((prev) => ({ ...prev, [key]: "" }));
    await loadSubtasks(slug, mainTaskId);
    await loadMainTasks(slug);
  }

  async function updateSubtaskStatus(slug: string, mainTaskId: string, st: Subtask, statusId: string) {
    await api.subtasks.update(slug, mainTaskId, st.id, { status_id: statusId });
    await loadSubtasks(slug, mainTaskId);
    await loadMainTasks(slug);
  }

  /** Checkbox: quick shortcut that jumps straight to Done, or back to To Do if already Done. */
  async function quickToggleSubtask(slug: string, mainTaskId: string, st: Subtask) {
    await updateSubtaskStatus(slug, mainTaskId, st, st.status_id === doneStatusId ? todoStatusId : doneStatusId);
  }

  async function updateSubtaskDeadline(slug: string, mainTaskId: string, st: Subtask, deadline: string | null) {
    await api.subtasks.update(slug, mainTaskId, st.id, { deadline });
    await loadSubtasks(slug, mainTaskId);
  }

  async function deleteSubtask(slug: string, mainTaskId: string, id: string) {
    await api.subtasks.delete(slug, mainTaskId, id);
    await loadSubtasks(slug, mainTaskId);
    await loadMainTasks(slug);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveCardId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveCardId(null);
    const over = e.over?.id;
    if (!over || !statuses.some((s) => s.id === over)) return;
    const statusId = String(over);
    const id = String(e.active.id);
    const card = kanbanCards.find((c) => c.mainTask.id === id);
    if (!card || card.mainTask.status_id === statusId) return;
    await api.mainTasks.update(card.projectSlug, id, { status_id: statusId });
    setKanbanCards((prev) =>
      prev.map((c) => (c.mainTask.id === id ? { ...c, mainTask: { ...c.mainTask, status_id: statusId } } : c))
    );
  }

  function orderMainTasks(list: MainTask[]): MainTask[] {
    const filtered = statusFilter === "all" ? list : list.filter((mt) => mt.status_id === statusFilter);
    return sortByStatus ? [...filtered].sort((a, b) => statusRank(a.status_id) - statusRank(b.status_id)) : filtered;
  }

  function orderSubtasks(list: Subtask[]): Subtask[] {
    const filtered = statusFilter === "all" ? list : list.filter((st) => st.status_id === statusFilter);
    return sortByStatus ? [...filtered].sort((a, b) => statusRank(a.status_id) - statusRank(b.status_id)) : filtered;
  }

  if (loading) return <div className="muted">Loading…</div>;

  const activeCard = activeCardId ? kanbanCards.find((c) => c.mainTask.id === activeCardId) : null;

  return (
    <div className="tasks-view">
      <div className="tasks-header">
        <h1 style={{ margin: 0 }}>Tasks</h1>
        <div className="browser-field-tabs">
          <button className={`btn${mode === "list" ? " btn-primary" : ""}`} onClick={() => setMode("list")}>List</button>
          <button className={`btn${mode === "kanban" ? " btn-primary" : ""}`} onClick={() => setMode("kanban")}>Kanban</button>
        </div>
        {mode === "list" && (
          <>
            <button className="btn btn-primary" onClick={() => setNewProjectOpen(true)}>+ New Project</button>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} title="Filter by status">
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>{STATUS_ICON_GLYPH[s.icon]} {s.name}</option>
              ))}
            </select>
            <button
              type="button"
              className={`btn${sortByStatus ? " btn-primary" : ""}`}
              aria-pressed={sortByStatus}
              onClick={() => setSortByStatus((v) => !v)}
            >
              Sort by status
            </button>
          </>
        )}
        {msg && <span className="ok mono" style={{ fontSize: 12 }}>{msg}</span>}
      </div>

      {mode === "list" ? (
        <div className="task-projects">
          {projects.map((project) => {
            const open = expandedProjects.has(project.slug);
            const mainTasks = orderMainTasks(mainTasksByProject[project.slug] || []);
            return (
              <div key={project.slug} className="task-project card">
                <div className="task-project-head">
                  <button type="button" className="task-expand" onClick={() => toggleProjectExpand(project.slug)}>
                    {open ? "▾" : "▸"}
                  </button>
                  <span className="task-project-name">{project.name}</span>
                  <span className="muted mono">{project.main_task_count} main task{project.main_task_count === 1 ? "" : "s"}</span>
                  <div className="task-row-actions">
                    {!project.pinned && (
                      <button className="btn btn-crit" onClick={() => deleteProject(project)}>Delete</button>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="task-project-body">
                    {mainTasks.map((mt) => {
                      const key = mtKey(project.slug, mt.id);
                      const mtOpen = expandedMainTasks.has(key);
                      const subtasks = orderSubtasks(subtasksByKey[key] || []);
                      return (
                        <div key={mt.id} className="task-main">
                          <div className="task-main-head">
                            <button type="button" className="task-expand" onClick={() => toggleMainTaskExpand(project.slug, mt.id)}>
                              {mtOpen ? "▾" : "▸"}
                            </button>
                            <button
                              type="button"
                              className={`task-star${mt.is_active ? " active" : ""}`}
                              title={mt.is_active ? "Active — showing on Dashboard" : "Mark active — show on Dashboard"}
                              onClick={() => toggleActive(project.slug, mt)}
                            >
                              {mt.is_active ? "★" : "☆"}
                            </button>
                            <span className="task-main-name">{mt.name}</span>
                            <StatusPill statuses={statuses} statusId={mt.status_id} onChange={(s) => updateMainTaskStatus(project.slug, mt, s)} />
                            <span className="muted mono">{mt.subtask_done}/{mt.subtask_total} subtasks</span>
                            <ProgressBar done={mt.subtask_done} total={mt.subtask_total} />
                            <DeadlinePicker value={mt.deadline} onChange={(d) => updateDeadline(project.slug, mt, d)} title="Main task deadline" />
                            <button className="btn btn-crit" onClick={() => deleteMainTask(project.slug, mt.id)}>Delete</button>
                          </div>
                          {mtOpen && (
                            <div className="task-sub-list">
                              {subtasks.map((st) => (
                                <div key={st.id} className={`task-row${st.status_id === doneStatusId ? " done" : ""}`}>
                                  <div className="task-row-name">
                                    <span className="task-expand spacer" />
                                    <button
                                      type="button"
                                      className={`task-check${st.status_id === doneStatusId ? " checked" : ""}`}
                                      onClick={() => quickToggleSubtask(project.slug, mt.id, st)}
                                      title="Quick-complete (jumps to Done)"
                                    >
                                      {st.status_id === doneStatusId ? "●" : "○"}
                                    </button>
                                    <span className="task-title">{st.name}</span>
                                  </div>
                                  <StatusPill statuses={statuses} statusId={st.status_id} onChange={(s) => updateSubtaskStatus(project.slug, mt.id, st, s)} />
                                  <DeadlinePicker
                                    value={st.deadline}
                                    onChange={(d) => updateSubtaskDeadline(project.slug, mt.id, st, d)}
                                    title="Subtask deadline"
                                  />
                                  <button className="btn btn-crit" onClick={() => deleteSubtask(project.slug, mt.id, st.id)}>Delete</button>
                                </div>
                              ))}
                              <div className="task-sub-add">
                                <input
                                  type="text"
                                  placeholder="New subtask…"
                                  value={newSubtaskName[key] || ""}
                                  onChange={(e) => setNewSubtaskName((prev) => ({ ...prev, [key]: e.target.value }))}
                                  onKeyDown={(e) => { if (e.key === "Enter") createSubtask(project.slug, mt.id); }}
                                />
                                <button className="btn" onClick={() => createSubtask(project.slug, mt.id)}>Add</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="task-sub-add">
                      <input
                        type="text"
                        placeholder="New main task…"
                        value={newMainTaskName[project.slug] || ""}
                        onChange={(e) => setNewMainTaskName((prev) => ({ ...prev, [project.slug]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") createMainTask(project.slug); }}
                      />
                      <button className="btn" onClick={() => createMainTask(project.slug)}>Add main task</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="task-kanban">
            {statuses.map((s) => (
              <KanbanColumn key={s.id} status={s} cards={kanbanCards.filter((c) => c.mainTask.status_id === s.id)} />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="task-kanban-card dragging">
                <div className="task-kanban-title">{activeCard.mainTask.name}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <LatexPromptModal
        open={newProjectOpen}
        title="New Project"
        label="Project name"
        confirmLabel="Create"
        onClose={() => setNewProjectOpen(false)}
        onConfirm={createProject}
      />
    </div>
  );
}

function KanbanCard({ card }: { card: KanbanCardData }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.mainTask.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : undefined;
  return (
    <div ref={setNodeRef} className="task-kanban-card" style={style} {...listeners} {...attributes}>
      <div className="task-kanban-title">{card.mainTask.name}</div>
      <div className="muted mono" style={{ fontSize: 11 }}>{card.projectName}</div>
      {card.mainTask.subtask_total > 0 && (
        <div className="muted mono" style={{ fontSize: 11 }}>
          {card.mainTask.subtask_done}/{card.mainTask.subtask_total} subtasks
        </div>
      )}
    </div>
  );
}

function KanbanColumn({ status, cards }: { status: TaskStatusDef; cards: KanbanCardData[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  return (
    <div ref={setNodeRef} className={`task-kanban-col${isOver ? " over" : ""}`} style={{ borderTopColor: status.color }}>
      <div className="task-kanban-col-head">
        <span>{STATUS_ICON_GLYPH[status.icon]} {status.name.toUpperCase()}</span>
        <span className="muted mono">{cards.length}</span>
      </div>
      <div className="task-kanban-col-body">
        {cards.map((c) => (
          <KanbanCard key={c.mainTask.id} card={c} />
        ))}
      </div>
    </div>
  );
}
