import { useMemo, useState } from "react";
import type { TaskItem } from "../../api/client";
import { api } from "../../api/client";
import StatusPill from "../../components/StatusPill";
import { fmtRange } from "../../lib/taskDates";
import { formatMinutes } from "../../lib/taskOptions";
import { KindBadge, PriorityPill, ProgressBar, TagChips, TimerButton, doneStatusId } from "./TaskBits";
import { mainKeyOf, type TaskViewProps } from "./viewTypes";

type GroupBy = "status" | "project";
const GROUP_KEY = "yggdrasil:tasks-group";

function loadGroup(): GroupBy {
  try {
    return localStorage.getItem(GROUP_KEY) === "project" ? "project" : "status";
  } catch {
    return "status";
  }
}

export default function ListView({ data, items, now, onOpen }: TaskViewProps) {
  const { statuses, priorities, tags, projects, patch, toggleTimer, reload } = data;
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroup);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addText, setAddText] = useState<Record<string, string>>({});

  const mains = useMemo(() => items.filter((i) => i.kind === "main"), [items]);
  const subsByMain = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const i of items) {
      if (i.kind !== "subtask") continue;
      const k = mainKeyOf(i);
      m.set(k, [...(m.get(k) || []), i]);
    }
    return m;
  }, [items]);

  function setGroup(g: GroupBy) {
    setGroupBy(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      /* optional */
    }
  }

  function toggleExpand(ref: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      return n;
    });
  }

  async function addMain(slug: string) {
    const name = (addText[`p:${slug}`] || "").trim();
    if (!name) return;
    setAddText((p) => ({ ...p, [`p:${slug}`]: "" }));
    await api.mainTasks.create(slug, { name });
    await reload();
  }

  async function addSub(main: TaskItem) {
    const name = (addText[`s:${main.ref}`] || "").trim();
    if (!name) return;
    setAddText((p) => ({ ...p, [`s:${main.ref}`]: "" }));
    await api.subtasks.create(main.project_slug, main.id, { name });
    await reload();
  }

  function row(it: TaskItem, depth: number) {
    const subs = it.kind === "main" ? subsByMain.get(it.ref) || [] : [];
    const open = expanded.has(it.ref);
    const done = it.status_id === doneStatusId(statuses);
    return (
      <div key={it.ref}>
        <div className={`tk-row${done ? " done" : ""}`} style={{ paddingLeft: 8 + depth * 24 }} onClick={() => onOpen(it)}>
          {it.kind === "main" ? (
            <button
              type="button"
              className="tk-caret"
              aria-label={open ? "Collapse subtasks" : "Expand subtasks"}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(it.ref);
              }}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : (
            <span className="tk-caret" />
          )}
          {it.kind === "main" ? (
            <button
              type="button"
              className={`tk-star${it.is_active ? " on" : ""}`}
              title={it.is_active ? "Starred — shown on Dashboard" : "Star to show on Dashboard"}
              aria-pressed={it.is_active}
              onClick={(e) => {
                e.stopPropagation();
                void patch(it, { is_active: !it.is_active });
              }}
            >
              {it.is_active ? "★" : "☆"}
            </button>
          ) : (
            <input
              type="checkbox"
              checked={done}
              aria-label="Mark done"
              onClick={(e) => e.stopPropagation()}
              onChange={() => void patch(it, { status_id: done ? statuses[0]?.id : doneStatusId(statuses) })}
            />
          )}
          <span className="tk-name">
            {it.kind === "subtask" && <KindBadge kind="subtask" />} {it.name}
          </span>
          {it.kind === "main" && it.subtask_total > 0 && (
            <span className="tk-sub-count mono muted" title="Subtasks done">
              {it.subtask_done}/{it.subtask_total}
            </span>
          )}
          <span className="tk-cell tk-cell-status">
            <StatusPill statuses={statuses} statusId={it.status_id} onChange={(s) => void patch(it, { status_id: s })} />
          </span>
          <span className="tk-cell tk-cell-pri">
            <PriorityPill priorities={priorities} value={it.priority_id} onChange={(p) => void patch(it, { priority_id: p })} />
          </span>
          <span className="tk-cell tk-cell-tags">
            <TagChips ids={it.tags} tags={tags} />
          </span>
          <span className="tk-cell tk-cell-dates mono muted">{fmtRange(it.start, it.deadline)}</span>
          <span className="tk-cell tk-cell-est mono muted">{formatMinutes(it.estimate_min)}</span>
          <span className="tk-cell tk-cell-timer">
            <TimerButton item={it} now={now} compact onToggle={() => void toggleTimer(it)} />
          </span>
        </div>
        {it.kind === "main" && open && (
          <>
            {it.subtask_total > 0 && (
              <div style={{ paddingLeft: 8 + 24 + 40, paddingRight: 12 }}>
                <ProgressBar done={it.subtask_done} total={it.subtask_total} />
              </div>
            )}
            {subs.map((s) => row(s, depth + 1))}
            <div className="tk-add" style={{ paddingLeft: 8 + (depth + 1) * 24 + 40 }}>
              <input
                type="text"
                placeholder="+ Add subtask"
                value={addText[`s:${it.ref}`] || ""}
                onChange={(e) => setAddText((p) => ({ ...p, [`s:${it.ref}`]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && void addSub(it)}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  const groups: { id: string; title: React.ReactNode; rows: TaskItem[]; slug?: string }[] =
    groupBy === "status"
      ? statuses.map((s, i) => ({
          id: s.id,
          title: (
            <>
              <span aria-hidden="true">{({ "circle-outline": "○", "half-fill": "◐", "full-fill": "●", square: "■", triangle: "▲" } as Record<string, string>)[s.icon] || "○"}</span> {s.name}
            </>
          ),
          rows: mains.filter((m) => m.status_id === s.id || (i === 0 && !statuses.some((x) => x.id === m.status_id))),
        }))
      : projects.map((p) => ({ id: p.slug, title: p.name, rows: mains.filter((m) => m.project_slug === p.slug), slug: p.slug }));

  return (
    <div className="tk-list">
      <div className="tk-list-bar">
        <span className="muted">Group by</span>
        <button type="button" className={`btn${groupBy === "status" ? " btn-primary" : ""}`} onClick={() => setGroup("status")}>
          Status
        </button>
        <button type="button" className={`btn${groupBy === "project" ? " btn-primary" : ""}`} onClick={() => setGroup("project")}>
          Project
        </button>
      </div>
      {groups.map((g) => {
        if (groupBy === "status" && g.rows.length === 0) return null;
        return (
          <section key={g.id} className="tk-group">
            <h3 className="tk-group-head">
              {g.title} <span className="muted mono">{g.rows.length}</span>
            </h3>
            {g.rows.map((m) => row(m, 0))}
            {g.slug && (
              <div className="tk-add" style={{ paddingLeft: 8 + 40 }}>
                <input
                  type="text"
                  placeholder="+ Add task"
                  value={addText[`p:${g.slug}`] || ""}
                  onChange={(e) => setAddText((p) => ({ ...p, [`p:${g.slug}`]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && void addMain(g.slug!)}
                />
              </div>
            )}
          </section>
        );
      })}
      {mains.length === 0 && groupBy === "status" && <div className="muted tk-empty">No tasks yet — use “+ New task”.</div>}
    </div>
  );
}
