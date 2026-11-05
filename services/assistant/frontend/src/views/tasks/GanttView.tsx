import { useEffect, useMemo, useRef } from "react";
import type { TaskItem } from "../../api/client";
import { diffDays, fmtRange, spanOf, todayISO } from "../../lib/taskDates";
import { AxisHeader, Bar, GridBackdrop, ZoomControls, shiftBody, useAxis, useZoom, xOf } from "./TimeChart";
import { KindBadge, doneStatusId } from "./TaskBits";
import { mainKeyOf, type TaskViewProps } from "./viewTypes";

const ROW_H = 34;
const NAME_W = 280;

/** One row per task (subtasks nested), bars with progress, and arrows for “blocked by” links. */
export default function GanttView({ data, items, onOpen }: TaskViewProps) {
  const [zoom, setZoom] = useZoom();
  const scroller = useRef<HTMLDivElement | null>(null);
  const { statuses, projects } = data;
  const doneId = doneStatusId(statuses);
  const { origin, days } = useAxis(items);

  const rows = useMemo(() => {
    const out: { it?: TaskItem; header?: string; depth: number }[] = [];
    const subs = new Map<string, TaskItem[]>();
    for (const i of items) if (i.kind === "subtask") subs.set(mainKeyOf(i), [...(subs.get(mainKeyOf(i)) || []), i]);
    for (const p of projects) {
      const mains = items.filter((i) => i.kind === "main" && i.project_slug === p.slug);
      if (!mains.length) continue;
      out.push({ header: p.name, depth: 0 });
      for (const m of mains) {
        out.push({ it: m, depth: 0 });
        for (const s of subs.get(m.ref) || []) out.push({ it: s, depth: 1 });
      }
    }
    return out;
  }, [items, projects]);

  const index = new Map<string, number>();
  rows.forEach((r, i) => r.it && index.set(r.it.ref, i));

  function scrollToToday() {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, xOf(origin, todayISO(), zoom) - el.clientWidth / 3);
  }
  useEffect(scrollToToday, [origin, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const width = days * zoom;
  const height = rows.length * ROW_H;

  const arrows: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
  for (const r of rows) {
    const it = r.it;
    if (!it) continue;
    const to = spanOf(it);
    const toI = index.get(it.ref);
    if (!to || toI === undefined) continue;
    for (const rel of it.relations) {
      if (rel.type !== "blocked_by") continue;
      const fi = index.get(rel.target);
      const from = rows[fi ?? -1]?.it;
      const fs = from && spanOf(from);
      if (fi === undefined || !fs) continue;
      arrows.push({
        key: `${rel.target}->${it.ref}`,
        x1: xOf(origin, fs.end, zoom) + (diffDays(fs.end, fs.end) + 1) * zoom,
        y1: fi * ROW_H + ROW_H / 2,
        x2: xOf(origin, to.start, zoom),
        y2: toI * ROW_H + ROW_H / 2,
      });
    }
  }

  return (
    <div>
      <ZoomControls zoom={zoom} setZoom={setZoom} onToday={scrollToToday} />
      <div className="tk-gantt">
        <div className="tk-gantt-names" style={{ width: NAME_W }}>
          <div className="tk-axis-spacer" />
          {rows.map((r, i) =>
            r.header ? (
              <div key={`h${i}`} className="tk-gantt-name head" style={{ height: ROW_H }}>{r.header}</div>
            ) : (
              <button
                key={r.it!.ref}
                type="button"
                className="tk-gantt-name"
                style={{ height: ROW_H, paddingLeft: 10 + r.depth * 18 }}
                onClick={() => onOpen(r.it!)}
                title={r.it!.name}
              >
                {r.it!.kind === "subtask" && <KindBadge kind="subtask" />}
                <span className="tk-gantt-name-text">{r.it!.name}</span>
              </button>
            )
          )}
        </div>
        <div className="tk-chart tk-gantt-scroll" ref={scroller}>
          <div style={{ width, position: "relative" }}>
            <AxisHeader origin={origin} days={days} dayW={zoom} />
            <div style={{ position: "relative", height, width }}>
              <GridBackdrop origin={origin} days={days} dayW={zoom} height={height} />
              {rows.map((r, i) => {
                if (!r.it) return <div key={`h${i}`} className="tk-gantt-headrow" style={{ top: i * ROW_H, height: ROW_H, width }} />;
                const s = spanOf(r.it);
                if (!s) return null;
                const st = statuses.find((x) => x.id === r.it!.status_id);
                const isDone = r.it.status_id === doneId;
                const progress = isDone ? 1 : r.it.kind === "main" && r.it.subtask_total ? r.it.subtask_done / r.it.subtask_total : 0;
                return (
                  <Bar
                    key={r.it.ref}
                    left={xOf(origin, s.start, zoom)}
                    width={Math.max(zoom, (diffDays(s.start, s.end) + 1) * zoom)}
                    top={i * ROW_H + 5}
                    height={ROW_H - 10}
                    dayW={zoom}
                    label={r.it.name}
                    tint={st?.color || "var(--accent)"}
                    progress={progress}
                    done={isDone}
                    title={`${r.it.name} — ${fmtRange(r.it.start, r.it.deadline)}`}
                    onOpen={() => onOpen(r.it!)}
                    onShift={(d) => void data.patch(r.it!, shiftBody(r.it!, d))}
                  />
                );
              })}
              <svg className="tk-arrows" width={width} height={height} aria-hidden="true">
                <defs>
                  <marker id="tk-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
                  </marker>
                </defs>
                {arrows.map((a) => (
                  <path
                    key={a.key}
                    d={`M${a.x1},${a.y1} h10 V${a.y2} H${Math.max(a.x2 - 2, a.x1 + 10)}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    markerEnd="url(#tk-arrowhead)"
                  />
                ))}
              </svg>
            </div>
          </div>
        </div>
      </div>
      {rows.length === 0 && <div className="muted tk-empty">Nothing to show yet.</div>}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Drag a bar to reschedule. Arrows run from a blocking task to the task it blocks. Tasks without dates have no bar — open them to set a start/deadline.
      </div>
    </div>
  );
}
