import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { CalEvent, TaskItem } from "../../api/client";
import { addDaysISO, parseISO, toISO, todayISO } from "../../lib/taskDates";
import { formatMinutes } from "../../lib/taskOptions";
import type { TaskData } from "./useTaskData";

type MainItem = Extract<TaskItem, { kind: "main" }>;

const H0 = 7; // first hour shown
const H1 = 21; // last hour shown (exclusive)
const HOUR_PX = 52;
const SNAP = 30; // minutes
const TIMES_KEY = "yggdrasil:task-times";
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
type SView = "month" | "week" | "day";
const VIEW_KEY = "yggdrasil:sched-view";

function loadView(): SView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "month" || v === "week" || v === "day") return v;
  } catch {
    /* optional */
  }
  return "week";
}

function addMonthsISO(iso: string, n: number): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const fmtMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

function weekStartOf(iso: string): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
}

function loadTimes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TIMES_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

type Props = {
  data: TaskData;
  mains: MainItem[];
  effDue: (m: TaskItem) => string | null;
  isDone: (m: TaskItem) => boolean;
  projectColor: (slug: string) => string;
  onOpen: (ref: string) => void;
  /** Called after a task was (re)scheduled, so other views refresh. */
  onChanged: () => void;
  height: number;
};

/**
 * Schedule layout: open tasks in a tray on the left (unscheduled first), a week time grid on the right.
 * Drag a task onto a day to set its due date; where you drop it vertically sets its time slot, and its estimate
 * sets the block length. The date is stored on the task; the time of day is kept in this browser only.
 */
export default function ScheduleView({ data, mains, effDue, isDone, projectColor, onOpen, onChanged, height }: Props) {
  const [anchor, setAnchor] = useState(() => todayISO());
  const [view, setViewState] = useState<SView>(loadView);
  const setView = (v: SView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* optional */
    }
  };
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [times, setTimes] = useState<Record<string, string>>(loadTimes);
  const [ghost, setGhost] = useState<{ day: string; min: number; dur: number; label: string } | null>(null);
  const [trayW, setTrayW] = useState(() => {
    try {
      return Math.min(520, Math.max(240, Number(localStorage.getItem("yggdrasil:sched-tray")) || 340));
    } catch {
      return 340;
    }
  });
  const dragRef = useRef<string | null>(null);
  const today = todayISO();

  useEffect(() => {
    let live = true;
    api.calendarEvents
      .list()
      .then((r) => live && setEvents(r.events))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const days = useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "week") {
      const w = weekStartOf(anchor);
      return Array.from({ length: 7 }, (_, i) => addDaysISO(w, i));
    }
    const first = toISO(new Date(parseISO(anchor).getFullYear(), parseISO(anchor).getMonth(), 1));
    const start = weekStartOf(first);
    const last = parseISO(addMonthsISO(anchor, 1));
    const rows = Math.ceil((parseISO(addDaysISO(toISO(new Date(last.getFullYear(), last.getMonth(), 0)), 0)).getDate() + ((parseISO(first).getDay() + 6) % 7)) / 7);
    return Array.from({ length: rows * 7 }, (_, i) => addDaysISO(start, i));
  }, [anchor, view]);
  const monthOf = parseISO(anchor).getMonth();
  const step = (dir: number) => setAnchor(view === "month" ? addMonthsISO(anchor, dir) : addDaysISO(anchor, dir * (view === "week" ? 7 : 1)));
  const byRef = useMemo(() => new Map(mains.map((m) => [m.ref, m])), [mains]);

  const open = useMemo(() => mains.filter((m) => !isDone(m)), [mains, isDone]);
  const unscheduled = useMemo(() => open.filter((m) => !effDue(m)), [open, effDue]);
  const scheduled = useMemo(
    () => open.filter((m) => effDue(m)).sort((a, b) => (effDue(a) as string).localeCompare(effDue(b) as string)),
    [open, effDue]
  );

  const durOf = (m: TaskItem) => Math.max(30, m.estimate_min || 60);

  const setTime = useCallback((ref: string, hhmm: string | null) => {
    setTimes((prev) => {
      const n = { ...prev };
      if (hhmm) n[ref] = hhmm;
      else delete n[ref];
      try {
        localStorage.setItem(TIMES_KEY, JSON.stringify(n));
      } catch {
        /* optional */
      }
      return n;
    });
  }, []);

  /** Pointer y inside a day column → minutes since midnight, snapped. */
  const minuteAt = (e: React.DragEvent, el: HTMLElement) => {
    const y = e.clientY - el.getBoundingClientRect().top;
    const raw = H0 * 60 + (y / HOUR_PX) * 60;
    return Math.max(H0 * 60, Math.min(H1 * 60 - SNAP, Math.round(raw / SNAP) * SNAP));
  };

  const startDrag = (ref: string) => (e: React.DragEvent) => {
    dragRef.current = ref;
    e.dataTransfer.setData("text/plain", ref);
    e.dataTransfer.effectAllowed = "move";
  };
  const endDrag = () => {
    dragRef.current = null;
    setGhost(null);
  };

  const dropOn = async (day: string, min: number | null) => {
    const ref = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    const m = ref ? byRef.get(ref) : null;
    if (!m) return;
    setTime(m.ref, min === null ? null : fmtMin(min));
    if (effDue(m) !== day || m.deadline?.slice(0, 10) !== day) await data.patch(m, { deadline: day });
    onChanged();
  };

  const weekTasks = useMemo(
    () => scheduled.filter((m) => days.includes(effDue(m) as string) && (view !== "month" || parseISO(effDue(m) as string).getMonth() === monthOf)),
    [scheduled, days, effDue, view, monthOf]
  );
  const plannedMin = weekTasks.reduce((a, m) => a + (m.estimate_min || 0), 0);
  const range =
    view === "month"
      ? parseISO(anchor).toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : view === "day"
        ? parseISO(anchor).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" })
        : `${parseISO(days[0]).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${parseISO(days[6]).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  const trayDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const w0 = trayW;
    let last = w0;
    const move = (ev: MouseEvent) => {
      last = Math.min(520, Math.max(240, w0 + ev.clientX - startX));
      setTrayW(last);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      try {
        localStorage.setItem("yggdrasil:sched-tray", String(last));
      } catch {
        /* optional */
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  function trayRow(m: MainItem, showDue: boolean) {
    const due = effDue(m);
    const overdue = !!due && due < today;
    return (
      <div key={m.ref} className="sc-row" draggable onDragStart={startDrag(m.ref)} onDragEnd={endDrag} onClick={() => onOpen(m.ref)} title="Drag onto the week to schedule">
        <span className="sc-grip" aria-hidden="true">⋮⋮</span>
        <i className="rt-dot" style={{ background: projectColor(m.project_slug) }} />
        <span className="sc-name">{m.name}</span>
        {showDue ? (
          <span className={`mono sc-meta${overdue ? " over" : ""}`}>{overdue ? "Overdue · " : ""}{parseISO(due as string).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        ) : (
          <span className="mono muted sc-meta">{m.estimate_min ? `~${formatMinutes(m.estimate_min)}` : "no est."}</span>
        )}
      </div>
    );
  }

  const hours = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const overdueCount = scheduled.filter((m) => (effDue(m) as string) < today).length;

  return (
    <div className="sc-wrap" style={{ height }}>
      <section className="sc-tray" style={{ flex: `0 0 ${trayW}px` }} aria-label="Task tray">
        <div className="sc-bar"><strong>Tasks</strong><span className="mono muted">{open.length} open</span></div>
        <div className="sc-scroll">
          <div className="sc-hint muted">Drag a task onto the week. Drop on a day’s top strip to set the date only.</div>
          <div className="sc-sec"><span>Unscheduled</span><span className="mono muted">{unscheduled.length}</span></div>
          {unscheduled.length === 0 ? <div className="muted sc-empty">Everything has a date.</div> : unscheduled.map((m) => trayRow(m, false))}
          <div className="sc-sec"><span>Scheduled</span><span className="mono muted">{scheduled.length}</span></div>
          {scheduled.map((m) => trayRow(m, true))}
        </div>
        <div className="sc-foot mono muted">
          <span>{unscheduled.length} unscheduled</span>
          <span>{scheduled.length} scheduled</span>
          {overdueCount > 0 && <span className="over">{overdueCount} overdue</span>}
        </div>
      </section>

      <button type="button" className="tp-grip" role="separator" aria-orientation="vertical" aria-label="Resize tray" onMouseDown={trayDrag} onDoubleClick={() => setTrayW(340)}>
        <span />
      </button>

      <section className="sc-week" aria-label="Week schedule">
        <div className="sc-bar">
          <button type="button" className="btn" aria-label="Previous" onClick={() => step(-1)}>‹</button>
          <button type="button" className="btn" aria-label="Next" onClick={() => step(1)}>›</button>
          <button type="button" className="btn" onClick={() => setAnchor(today)}>Today</button>
          <strong className="sc-range">{range}</strong>
          <span style={{ flex: 1 }} />
          <span className="mono muted sc-planned">Planned · {plannedMin ? formatMinutes(plannedMin) : "—"}</span>
          <div className="cal2-views cal2-views-in sc-views" role="tablist" aria-label="Schedule view">
            {(["month", "week", "day"] as SView[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={`btn${view === v ? " btn-primary" : ""}`} onClick={() => setView(v)}>{v === "month" ? "Month" : v === "week" ? "Week" : "Day"}</button>
            ))}
          </div>
        </div>

        {view === "month" && (
          <div className="sc-month">
            {DAYS.map((d) => <div key={d} className="sc-mhead mono muted">{d}</div>)}
            {days.map((d) => {
              const dayTasks = weekTasks.filter((m) => effDue(m) === d);
              const dayEvents = events.filter((ev) => ev.date === d);
              const out = parseISO(d).getMonth() !== monthOf;
              return (
                <div
                  key={d}
                  className={`sc-mcell${d === today ? " today" : ""}${out ? " out" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); void dropOn(d, null); }}
                >
                  <b className="mono">{parseISO(d).getDate()}</b>
                  {dayTasks.slice(0, 4).map((m) => (
                    <span key={m.ref} className="sc-chip" draggable onDragStart={startDrag(m.ref)} onDragEnd={endDrag} onClick={() => onOpen(m.ref)} style={{ borderLeftColor: projectColor(m.project_slug) }}>{m.name}</span>
                  ))}
                  {dayEvents.slice(0, Math.max(0, 4 - dayTasks.length)).map((ev) => (
                    <span key={ev.id} className="sc-chip sc-chip-ev">{ev.start ? `${ev.start} ` : ""}{ev.title}</span>
                  ))}
                  {dayTasks.length + dayEvents.length > 4 && <span className="mono muted sc-more">+{dayTasks.length + dayEvents.length - 4} more</span>}
                </div>
              );
            })}
          </div>
        )}

        {view !== "month" && (
        <div className="sc-head">
          <div className="sc-gutter" />
          {days.map((d) => (
            <div
              key={d}
              className={`sc-dayhead${d === today ? " today" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void dropOn(d, null); }}
              title="Drop here to set the date without a time"
            >
              <span className="mono muted">{DAYS[(parseISO(d).getDay() + 6) % 7]}</span>
              <b>{parseISO(d).getDate()}</b>
              <span className="sc-allday">
                {weekTasks
                  .filter((m) => effDue(m) === d && !times[m.ref])
                  .map((m) => (
                    <span key={m.ref} className="sc-chip" draggable onDragStart={startDrag(m.ref)} onDragEnd={endDrag} onClick={() => onOpen(m.ref)} style={{ borderLeftColor: projectColor(m.project_slug) }}>{m.name}</span>
                  ))}
              </span>
            </div>
          ))}
        </div>

        )}

        {view !== "month" && (
        <div className="sc-body">
          <div className="sc-grid" style={{ height: hours.length * HOUR_PX }}>
            <div className="sc-gutter">
              {hours.map((h) => <div key={h} className="mono muted sc-hr" style={{ height: HOUR_PX }}>{pad(h)}:00</div>)}
            </div>
            {days.map((d) => (
              <div
                key={d}
                className={`sc-col${d === today ? " today" : ""}`}
                style={{ backgroundSize: `100% ${HOUR_PX}px` }}
                onDragOver={(e) => {
                  e.preventDefault();
                  const m = dragRef.current ? byRef.get(dragRef.current) : null;
                  if (!m) return;
                  setGhost({ day: d, min: minuteAt(e, e.currentTarget), dur: durOf(m), label: m.name });
                }}
                onDrop={(e) => { e.preventDefault(); const mn = minuteAt(e, e.currentTarget); void dropOn(d, mn); }}
              >
                {events
                  .filter((ev) => ev.date === d && !ev.all_day && ev.start)
                  .map((ev) => {
                    const s = toMin(ev.start);
                    const dur = Math.max(30, (ev.end ? toMin(ev.end) : s + 60) - s);
                    return (
                      <div key={ev.id} className="sc-ev" style={{ top: ((s - H0 * 60) / 60) * HOUR_PX, height: (dur / 60) * HOUR_PX - 2 }} title={`${ev.start} · ${ev.title}`}>
                        <span>{ev.title}</span>
                        <span className="mono muted">{ev.start}</span>
                      </div>
                    );
                  })}
                {weekTasks
                  .filter((m) => effDue(m) === d && times[m.ref])
                  .map((m) => {
                    const s = toMin(times[m.ref]);
                    const dur = durOf(m);
                    return (
                      <div
                        key={m.ref}
                        className="sc-block"
                        draggable
                        onDragStart={startDrag(m.ref)}
                        onDragEnd={endDrag}
                        onClick={() => onOpen(m.ref)}
                        style={{ top: ((s - H0 * 60) / 60) * HOUR_PX, height: (dur / 60) * HOUR_PX - 2, borderLeftColor: projectColor(m.project_slug) }}
                      >
                        <span className="sc-bt">{m.name}</span>
                        <span className="mono muted">{fmtMin(s)} – {fmtMin(s + dur)}</span>
                      </div>
                    );
                  })}
                {ghost && ghost.day === d && (
                  <div className="sc-ghost" style={{ top: ((ghost.min - H0 * 60) / 60) * HOUR_PX, height: (ghost.dur / 60) * HOUR_PX - 2 }}>
                    <span>{ghost.label}</span>
                    <span className="mono">{fmtMin(ghost.min)} – {fmtMin(ghost.min + ghost.dur)}</span>
                  </div>
                )}
                {d === today && (() => {
                  const n = new Date();
                  const nm = n.getHours() * 60 + n.getMinutes();
                  return nm >= H0 * 60 && nm < H1 * 60 ? <div className="sc-now" style={{ top: ((nm - H0 * 60) / 60) * HOUR_PX }} /> : null;
                })()}
              </div>
            ))}
          </div>
        </div>
        )}
        <div className="sc-foot mono muted"><span>Block length = task estimate (30 min minimum)</span><span style={{ flex: 1 }} /><span>Dashed block = drop preview</span></div>
      </section>
    </div>
  );
}
