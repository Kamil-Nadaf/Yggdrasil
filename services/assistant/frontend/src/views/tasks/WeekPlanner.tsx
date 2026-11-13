import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { TaskItem } from "../../api/client";
import { addDaysISO, parseISO, todayISO, toISO } from "../../lib/taskDates";
import { formatMinutes } from "../../lib/taskOptions";
import { isDone } from "./TaskBits";
import type { TaskViewProps } from "./viewTypes";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_CAPACITY_MIN = 6 * 60;

function mondayOf(iso: string): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
}

function PlanCard({ it, onOpen }: { it: TaskItem; onOpen: (it: TaskItem) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: it.ref });
  return (
    <div ref={setNodeRef} className={`tk-plan-card${isDragging ? " dragging" : ""}`} {...listeners} {...attributes} onClick={() => onOpen(it)}>
      <span className="tk-plan-title">{it.kind === "subtask" ? `${it.main_task_name} › ` : ""}{it.name}</span>
      <span className="tk-plan-meta">
        {it.stage && <span className={`tk-stage tk-stage-${it.stage} on`}>{it.stage[0].toUpperCase() + it.stage.slice(1)}</span>}
        {it.estimate_min ? <span className="mono muted">{formatMinutes(it.estimate_min)}</span> : null}
      </span>
    </div>
  );
}

function DayColumn({ id, title, sub, planned, today, children }: { id: string; title: string; sub?: string; planned?: number; today?: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${id}` });
  const over = planned !== undefined && planned > DAY_CAPACITY_MIN;
  return (
    <div ref={setNodeRef} className={`tk-plan-col${isOver ? " over" : ""}${today ? " today" : ""}`}>
      <div className="tk-plan-head">
        <b>{title}</b>
        {sub && <span className="muted mono">{sub}</span>}
        {planned !== undefined && <span className={`mono tk-plan-load${over ? " over" : ""}`}>{planned ? formatMinutes(planned) : "—"}</span>}
      </div>
      <div className="tk-plan-body">{children}</div>
    </div>
  );
}

/** Week planner: drag a task onto a day to set its deadline; the header shows planned time against a 6 h day. */
export default function WeekPlanner({ data, items, onOpen }: TaskViewProps) {
  const [anchor, setAnchor] = useState(() => mondayOf(todayISO()));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const today = todayISO();
  const open = useMemo(() => items.filter((i) => !isDone(i, data.statuses) && !i.waiting_on), [items, data.statuses]);
  const days = Array.from({ length: 7 }, (_, k) => addDaysISO(anchor, k));
  // Only main tasks without subtasks and subtasks themselves are plannable units (a parent is planned through its children).
  const plannable = open.filter((i) => i.kind === "subtask" || i.subtask_total === 0);
  const byDay = (d: string) => plannable.filter((i) => (i.deadline || "").slice(0, 10) === d);
  const unscheduled = plannable.filter((i) => !i.deadline);

  function onDragEnd(e: DragEndEvent) {
    const over = e.over?.id;
    if (typeof over !== "string" || !over.startsWith("day:")) return;
    const it = plannable.find((c) => c.ref === e.active.id);
    if (!it) return;
    const day = over.slice(4);
    const next = day === "none" ? null : day;
    if (((it.deadline || "").slice(0, 10) || null) !== next) void data.patch(it, { deadline: next });
  }

  const label = `${parseISO(days[0]).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${parseISO(days[6]).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="tk-plan">
      <div className="tk-list-bar">
        <button type="button" className="btn" aria-label="Previous week" onClick={() => setAnchor(addDaysISO(anchor, -7))}>‹</button>
        <button type="button" className="btn" onClick={() => setAnchor(mondayOf(today))}>This week</button>
        <button type="button" className="btn" aria-label="Next week" onClick={() => setAnchor(addDaysISO(anchor, 7))}>›</button>
        <span className="mono">{label}</span>
        <span className="muted" style={{ fontSize: 12 }}>Drag a task onto a day to set its deadline.</span>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="tk-plan-grid">
          {days.map((d, k) => {
            const list = byDay(d);
            const planned = list.reduce((a, t) => a + (t.estimate_min || 0), 0);
            return (
              <DayColumn key={d} id={d} title={DAY_NAMES[k]} sub={parseISO(d).getDate().toString()} planned={planned} today={d === today}>
                {list.map((t) => <PlanCard key={t.ref} it={t} onOpen={onOpen} />)}
              </DayColumn>
            );
          })}
          <DayColumn id="none" title="No date">
            {unscheduled.map((t) => <PlanCard key={t.ref} it={t} onOpen={onOpen} />)}
          </DayColumn>
        </div>
      </DndContext>
    </div>
  );
}
