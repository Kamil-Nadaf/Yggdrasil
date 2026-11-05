import { useEffect, useMemo, useRef, useState } from "react";
import { fmtRange, packLanes, spanOf, diffDays, todayISO } from "../../lib/taskDates";
import { AxisHeader, Bar, GridBackdrop, ZoomControls, shiftBody, useAxis, useZoom, xOf } from "./TimeChart";
import { doneStatusId } from "./TaskBits";
import type { TaskViewProps } from "./viewTypes";

const LANE_H = 30;
const LANE_PAD = 6;

/** Swimlane timeline: one band per project, overlapping tasks stack into lanes. */
export default function TimelineView({ data, items, onOpen }: TaskViewProps) {
  const [zoom, setZoom] = useZoom();
  const [withSubs, setWithSubs] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const shown = useMemo(() => items.filter((i) => withSubs || i.kind === "main"), [items, withSubs]);
  const { origin, days } = useAxis(shown);
  const { statuses, projects } = data;
  const doneId = doneStatusId(statuses);

  function scrollToToday() {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, xOf(origin, todayISO(), zoom) - el.clientWidth / 3);
  }
  useEffect(scrollToToday, [origin, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const bands = projects
    .map((p) => {
      const rows = shown.filter((i) => i.project_slug === p.slug);
      const dated = rows.filter((r) => spanOf(r));
      const { lanes, count } = packLanes(dated, (r) => spanOf(r)!, (r) => r.ref);
      return { project: p, dated, undated: rows.filter((r) => !spanOf(r)), lanes, count };
    })
    .filter((b) => b.dated.length || b.undated.length);

  const width = days * zoom;

  return (
    <div>
      <div className="tk-list-bar">
        <label className="tk-check">
          <input type="checkbox" checked={withSubs} onChange={(e) => setWithSubs(e.target.checked)} /> Show subtasks
        </label>
        <ZoomControls zoom={zoom} setZoom={setZoom} onToday={scrollToToday} />
      </div>
      <div className="tk-chart" ref={scroller}>
        <div style={{ width, minWidth: "100%" }}>
          <AxisHeader origin={origin} days={days} dayW={zoom} />
          {bands.map((b) => {
            const h = b.count * LANE_H + LANE_PAD * 2;
            return (
              <section key={b.project.slug} className="tk-band">
                <div className="tk-band-head">{b.project.name}</div>
                <div className="tk-band-body" style={{ height: h, width }}>
                  <GridBackdrop origin={origin} days={days} dayW={zoom} height={h} />
                  {b.dated.map((it) => {
                    const s = spanOf(it)!;
                    const st = statuses.find((x) => x.id === it.status_id);
                    const isDone = it.status_id === doneId;
                    const progress = isDone ? 1 : it.kind === "main" && it.subtask_total ? it.subtask_done / it.subtask_total : 0;
                    return (
                      <Bar
                        key={it.ref}
                        left={xOf(origin, s.start, zoom)}
                        width={Math.max(zoom, (diffDays(s.start, s.end) + 1) * zoom)}
                        top={LANE_PAD + (b.lanes.get(it.ref) || 0) * LANE_H}
                        height={LANE_H - 6}
                        dayW={zoom}
                        label={it.name}
                        tint={st?.color || "var(--accent)"}
                        progress={progress}
                        done={isDone}
                        title={`${it.name} — ${fmtRange(it.start, it.deadline)}`}
                        onOpen={() => onOpen(it)}
                        onShift={(d) => void data.patch(it, shiftBody(it, d))}
                      />
                    );
                  })}
                </div>
                {b.undated.length > 0 && (
                  <div className="tk-unscheduled">
                    <span className="muted">No dates:</span>{" "}
                    {b.undated.map((u) => (
                      <button key={u.ref} type="button" className="tk-chip-btn" onClick={() => onOpen(u)}>
                        {u.name}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {bands.length === 0 && <div className="muted tk-empty">Nothing to show yet.</div>}
        </div>
      </div>
    </div>
  );
}
