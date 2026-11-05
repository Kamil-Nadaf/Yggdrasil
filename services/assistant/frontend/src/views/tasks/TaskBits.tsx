import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TaskItem, TaskPriorityDef, TaskTagDef } from "../../api/client";
import { formatClock, formatMinutes, liveTrackedSec } from "../../lib/taskOptions";

/** Small dropdown pill (same look as the status pill) for priority etc. */
export function MenuPill({
  label,
  tint,
  children,
  title,
}: {
  label: ReactNode;
  tint?: string;
  title?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="status-pill-wrap" ref={ref}>
      <button
        type="button"
        className="status-pill"
        title={title}
        style={tint ? { borderColor: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="status-pill-dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Priority picker. The name is always shown; color is only a tint. */
export function PriorityPill({
  priorities,
  value,
  onChange,
}: {
  priorities: TaskPriorityDef[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const cur = priorities.find((p) => p.id === value);
  return (
    <MenuPill
      title="Priority"
      tint={cur?.color}
      label={
        <>
          <span aria-hidden="true">⚑</span>
          <span className={cur ? "" : "muted"}>{cur ? cur.name : "Priority"}</span>
        </>
      }
    >
      {(close) => (
        <>
          {priorities.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className="status-pill-option"
              onClick={() => {
                onChange(p.id);
                close();
              }}
            >
              <span aria-hidden="true" style={{ color: p.color }}>⚑</span>
              <span>{p.name}</span>
            </button>
          ))}
          {cur && (
            <button
              type="button"
              role="menuitem"
              className="status-pill-option"
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              <span aria-hidden="true">×</span>
              <span>Clear</span>
            </button>
          )}
        </>
      )}
    </MenuPill>
  );
}

export function TagChips({ ids, tags }: { ids: string[]; tags: TaskTagDef[] }) {
  const known = ids.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as TaskTagDef[];
  if (!known.length) return null;
  return (
    <span className="tk-tags">
      {known.map((t) => (
        <span
          key={t.id}
          className="tk-tag"
          style={{ borderColor: t.color, background: `color-mix(in srgb, ${t.color} 14%, transparent)` }}
        >
          # {t.name}
        </span>
      ))}
    </span>
  );
}

/** Start/stop button with the live clock. */
export function TimerButton({
  item,
  now,
  onToggle,
  compact,
}: {
  item: Pick<TaskItem, "timer_started_at" | "tracked_sec" | "estimate_min">;
  now: number;
  onToggle: () => void;
  compact?: boolean;
}) {
  const running = !!item.timer_started_at;
  const sec = liveTrackedSec(item.tracked_sec, item.timer_started_at, now);
  const est = formatMinutes(item.estimate_min);
  const showClock = running || item.tracked_sec > 0;
  return (
    <button
      type="button"
      className={`tk-timer${running ? " running" : ""}`}
      title={running ? "Stop timer" : "Start timer"}
      aria-pressed={running}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span aria-hidden="true">{running ? "■" : "▶"}</span>
      {showClock && <span className="mono">{formatClock(sec)}</span>}
      {!compact && est && <span className="muted mono">/ {est}</span>}
    </button>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="task-progress-bar" title={`${done}/${total} subtasks`}>
      <div className="task-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KindBadge({ kind }: { kind: "main" | "subtask" }) {
  return <span className="tk-kind">{kind === "main" ? "Task" : "Subtask"}</span>;
}

/** The literal "done" status if it still exists, else the last one in order. */
export function doneStatusId(statuses: { id: string }[]): string {
  return statuses.find((s) => s.id === "done")?.id ?? statuses[statuses.length - 1]?.id ?? "done";
}

export function isDone(it: TaskItem, statuses: { id: string }[]): boolean {
  return it.status_id === doneStatusId(statuses);
}
