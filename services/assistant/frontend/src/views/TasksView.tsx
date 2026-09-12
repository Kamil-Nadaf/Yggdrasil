import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { api, type Task } from "../api/client";

type Status = Task["status"];
type Mode = "list" | "kanban";

const COLUMNS: { id: Status; label: string }[] = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done" },
];

function KanbanCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.4 : 1 }
    : undefined;
  return (
    <div ref={setNodeRef} className="task-kanban-card" style={style} {...listeners} {...attributes}>
      <div className="task-kanban-title">{task.title}</div>
      {task.tags.length > 0 && (
        <div className="task-tags">
          {task.tags.map((t) => (
            <span key={t} className="task-tag">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({ id, label, tasks }: { id: Status; label: string; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`task-kanban-col${isOver ? " over" : ""}`}>
      <div className="task-kanban-col-head">
        <span>{label}</span>
        <span className="muted mono">{tasks.length}</span>
      </div>
      <div className="task-kanban-col-body">
        {tasks.map((t) => (
          <KanbanCard key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

export default function TasksView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("list");
  const [newTitle, setNewTitle] = useState("");
  const [newParent, setNewParent] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const reload = useCallback(async () => {
    const r = await api.tasks.list();
    setTasks(r.tasks);
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  const parents = useMemo(() => tasks.filter((t) => !t.parent), [tasks]);
  const childrenOf = useCallback(
    (id: string) => tasks.filter((t) => t.parent === id),
    [tasks]
  );

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  }

  async function handleCreate() {
    const title = newTitle.trim();
    if (!title) return;
    await api.tasks.create({
      title,
      parent: newParent || null,
      status: "todo",
      tags: [],
      recurring: false,
    });
    setNewTitle("");
    await reload();
    flash("Task added");
  }

  async function setStatus(id: string, status: Status) {
    await api.tasks.update(id, { status });
    await reload();
  }

  async function toggleDone(task: Task) {
    await setStatus(task.id, task.status === "done" ? "todo" : "done");
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this task?")) return;
    await api.tasks.delete(id);
    await reload();
  }

  async function updateTags(id: string, raw: string) {
    const tags = raw.split(",").map((s) => s.trim()).filter(Boolean);
    await api.tasks.update(id, { tags });
    await reload();
  }

  async function updateDue(id: string, due: string) {
    await api.tasks.update(id, { due });
    await reload();
  }

  async function toggleRecurring(task: Task) {
    await api.tasks.update(task.id, { recurring: !task.recurring });
    await reload();
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const over = e.over?.id;
    if (!over) return;
    const status = String(over) as Status;
    if (!COLUMNS.some((c) => c.id === status)) return;
    const id = String(e.active.id);
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    await setStatus(id, status);
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) return <div className="muted">Loading…</div>;

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  return (
    <div className="tasks-view">
      <div className="tasks-header">
        <h1 style={{ margin: 0 }}>Tasks</h1>
        <div className="browser-field-tabs">
          <button className={`btn${mode === "list" ? " btn-primary" : ""}`} onClick={() => setMode("list")}>List</button>
          <button className={`btn${mode === "kanban" ? " btn-primary" : ""}`} onClick={() => setMode("kanban")}>Kanban</button>
        </div>
        {msg && <span className="ok mono" style={{ fontSize: 12 }}>{msg}</span>}
      </div>

      <div className="card tasks-create">
        <input
          type="text"
          placeholder="New task…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          style={{ flex: 1 }}
        />
        <select value={newParent} onChange={(e) => setNewParent(e.target.value)}>
          <option value="">Top-level</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={handleCreate} disabled={!newTitle.trim()}>Add</button>
      </div>

      {mode === "list" ? (
        <div className="task-list">
          <div className="task-list-head">
            <span>Name</span>
            <span>Tags</span>
            <span>Status</span>
            <span>Due</span>
            <span></span>
          </div>
          {parents.length === 0 && <div className="muted" style={{ padding: 16 }}>No tasks yet — add a Daily Routine parent, then nest sub-tasks under it.</div>}
          {parents.map((parent) => {
            const kids = childrenOf(parent.id);
            const isOpen = expanded.has(parent.id) || kids.length === 0;
            return (
              <div key={parent.id} className="task-group">
                <TaskRow
                  task={parent}
                  depth={0}
                  hasKids={kids.length > 0}
                  expanded={isOpen}
                  onToggleExpand={() => toggleExpand(parent.id)}
                  onToggleDone={() => toggleDone(parent)}
                  onStatus={(s) => setStatus(parent.id, s)}
                  onTags={(raw) => updateTags(parent.id, raw)}
                  onDue={(d) => updateDue(parent.id, d)}
                  onRecurring={() => toggleRecurring(parent)}
                  onDelete={() => handleDelete(parent.id)}
                />
                {isOpen && kids.map((child) => (
                  <TaskRow
                    key={child.id}
                    task={child}
                    depth={1}
                    hasKids={false}
                    expanded={false}
                    onToggleExpand={() => {}}
                    onToggleDone={() => toggleDone(child)}
                    onStatus={(s) => setStatus(child.id, s)}
                    onTags={(raw) => updateTags(child.id, raw)}
                    onDue={(d) => updateDue(child.id, d)}
                    onRecurring={() => toggleRecurring(child)}
                    onDelete={() => handleDelete(child.id)}
                  />
                ))}
              </div>
            );
          })}
          {/* Orphans with parent missing */}
          {tasks.filter((t) => t.parent && !tasks.some((p) => p.id === t.parent)).map((orphan) => (
            <TaskRow
              key={orphan.id}
              task={orphan}
              depth={0}
              hasKids={false}
              expanded={false}
              onToggleExpand={() => {}}
              onToggleDone={() => toggleDone(orphan)}
              onStatus={(s) => setStatus(orphan.id, s)}
              onTags={(raw) => updateTags(orphan.id, raw)}
              onDue={(d) => updateDue(orphan.id, d)}
              onRecurring={() => toggleRecurring(orphan)}
              onDelete={() => handleDelete(orphan.id)}
            />
          ))}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="task-kanban">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                tasks={tasks.filter((t) => t.status === col.id)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? (
              <div className="task-kanban-card dragging">
                <div className="task-kanban-title">{activeTask.title}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function TaskRow({
  task,
  depth,
  hasKids,
  expanded,
  onToggleExpand,
  onToggleDone,
  onStatus,
  onTags,
  onDue,
  onRecurring,
  onDelete,
}: {
  task: Task;
  depth: number;
  hasKids: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onStatus: (s: Status) => void;
  onTags: (raw: string) => void;
  onDue: (d: string) => void;
  onRecurring: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`task-row${task.status === "done" ? " done" : ""}`} style={{ paddingLeft: 12 + depth * 20 }}>
      <div className="task-row-name">
        {hasKids ? (
          <button type="button" className="task-expand" onClick={onToggleExpand}>{expanded ? "▾" : "▸"}</button>
        ) : (
          <span className="task-expand spacer" />
        )}
        <button type="button" className={`task-check${task.status === "done" ? " checked" : ""}`} onClick={onToggleDone} title="Toggle done">
          {task.status === "done" ? "●" : "○"}
        </button>
        <span className="task-title">{task.title}</span>
        {task.recurring && <span className="task-tag recurring">daily</span>}
      </div>
      <div className="task-row-tags">
        <input
          className="task-inline-input"
          defaultValue={task.tags.join(", ")}
          placeholder="tags"
          onBlur={(e) => {
            const next = e.target.value;
            if (next !== task.tags.join(", ")) onTags(next);
          }}
        />
      </div>
      <div>
        <select value={task.status} onChange={(e) => onStatus(e.target.value as Status)}>
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div>
        <input
          type="date"
          className="task-inline-input"
          value={task.due || ""}
          onChange={(e) => onDue(e.target.value)}
        />
      </div>
      <div className="task-row-actions">
        <button className="btn" title="Toggle recurring daily" onClick={onRecurring}>{task.recurring ? "↻" : "○↻"}</button>
        <button className="btn btn-crit" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
