import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { TaskItem } from "../../api/client";
import { STATUS_ICON_GLYPH } from "../../lib/taskStatuses";
import { allowedFor, formatMinutes } from "../../lib/taskOptions";
import { fmtRange } from "../../lib/taskDates";
import { KindBadge, PriorityPill, ProgressBar, TagChips, TimerButton } from "./TaskBits";
import type { TaskViewProps } from "./viewTypes";

function Card({
  it,
  props,
  overlay,
}: {
  it: TaskItem;
  props: TaskViewProps;
  overlay?: boolean;
}) {
  const { data, now, onOpen } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: it.ref });
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`tk-card${isDragging ? " dragging" : ""}${overlay ? " overlay" : ""}`}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      onClick={() => onOpen(it)}
    >
      <div className="tk-card-title">
        {it.kind === "subtask" && <KindBadge kind="subtask" />} {it.name}
      </div>
      <div className="muted tk-card-sub">{it.kind === "subtask" ? `${it.main_task_name} · ` : ""}{it.project_name}</div>
      {it.kind === "main" && it.subtask_total > 0 && <ProgressBar done={it.subtask_done} total={it.subtask_total} />}
      <div className="tk-card-meta">
        <PriorityPill priorities={data.priorities} value={it.priority_id} onChange={(p) => void data.patch(it, { priority_id: p })} />
        <TagChips ids={it.tags} tags={data.tags} />
      </div>
      <div className="tk-card-foot">
        <span className="mono muted">{fmtRange(it.start, it.deadline)}</span>
        {it.estimate_min ? <span className="mono muted">{formatMinutes(it.estimate_min)}</span> : null}
        <span style={{ marginLeft: "auto" }}>
          <TimerButton item={it} now={now} compact onToggle={() => void data.toggleTimer(it)} />
        </span>
      </div>
    </div>
  );
}

function Column({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${id}` });
  return (
    <div ref={setNodeRef} className={`tk-col${isOver ? " over" : ""}`}>
      <div className="tk-col-head">
        {title} <span className="muted mono">{count}</span>
      </div>
      <div className="tk-col-body">{children}</div>
    </div>
  );
}

export default function BoardView(props: TaskViewProps) {
  const { data, items, projectFilter } = props;
  const [withSubs, setWithSubs] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const project = data.projects.find((p) => p.slug === projectFilter);
  const statuses = allowedFor(data.statuses, project?.options?.status_ids);
  const cards = useMemo(() => items.filter((i) => withSubs || i.kind === "main"), [items, withSubs]);
  const dragged = cards.find((c) => c.ref === dragId) || null;

  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const over = e.over?.id;
    if (typeof over !== "string" || !over.startsWith("col:")) return;
    const it = cards.find((c) => c.ref === e.active.id);
    const statusId = over.slice(4);
    if (it && it.status_id !== statusId) void data.patch(it, { status_id: statusId });
  }

  return (
    <div>
      <div className="tk-list-bar">
        <label className="tk-check">
          <input type="checkbox" checked={withSubs} onChange={(e) => setWithSubs(e.target.checked)} /> Show subtasks
        </label>
      </div>
      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div className="tk-board">
          {statuses.map((s) => {
            const col = cards.filter((c) => c.status_id === s.id);
            return (
              <Column
                key={s.id}
                id={s.id}
                count={col.length}
                title={
                  <>
                    <span aria-hidden="true">{STATUS_ICON_GLYPH[s.icon] || "○"}</span> {s.name}
                  </>
                }
              >
                {col.map((c) => (
                  <Card key={c.ref} it={c} props={props} />
                ))}
                {col.length === 0 && <div className="muted tk-col-empty">Drop here</div>}
              </Column>
            );
          })}
        </div>
        <DragOverlay>{dragged ? <Card it={dragged} props={props} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
