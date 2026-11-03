import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CalEvent, type CalendarItem, type NotificationSettings, type TaskStatusDef } from "../api/client";
import {
  ensureTaskStatuses,
  getCachedTaskStatuses,
  STATUS_ICON_GLYPH,
  TASK_STATUSES_EVENT,
} from "../lib/taskStatuses";

/**
 * Calendar: your own events (with times and colour-coded calendars) plus every task and
 * subtask deadline. Month / Week / Day / Schedule views, a day timeline beside the month,
 * Quick Add, calendar filters and a 7-day look-ahead. Clicking a task deadline opens it in Tasks.
 */

type View = "month" | "week" | "day" | "schedule";
type Props = { onOpenTask: (projectSlug: string, mainTaskId: string) => void };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_PX = 46;
const MAX_PER_CELL = 3;
const VIEW_KEY = "yggdrasil:cal-view";
const ENABLED_KEY = "yggdrasil:cal-enabled";

const CALS = [
  { id: "research", label: "Research", color: "#a77be0" },
  { id: "assignments", label: "Assignments", color: "#f0993e" },
  { id: "meetings", label: "Meetings", color: "#5f86e8" },
  { id: "personal", label: "Personal", color: "#7fb04a" },
  { id: "other", label: "Other", color: "#8f8f8f" },
];
const TASKS_CAL = { id: "tasks", label: "Task deadlines", color: "var(--accent)" };
const colorOf = (id: string) => CALS.find((c) => c.id === id)?.color ?? "#8f8f8f";
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--surface))`;

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}
function weekStart(iso: string): string {
  const d = fromIso(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** [start, end] in minutes for a timed event, or null for all-day. */
function evRange(e: CalEvent): [number, number] | null {
  if (e.all_day || !e.start) return null;
  const s = toMin(e.start);
  let en = e.end ? toMin(e.end) : s + 60;
  if (en <= s) en = s + 30;
  return [s, en];
}

/** "Lunch 13:00-14:00" → { title: "Lunch", start: "13:00", end: "14:00" } */
function parseQuick(text: string): { title: string; start: string; end: string } {
  const range = text.match(/(\d{1,2}):(\d{2})\s*(?:-|–|to)\s*(\d{1,2}):(\d{2})/i);
  if (range) {
    const p = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;
    return { title: text.replace(range[0], "").replace(/\s+/g, " ").trim(), start: p(range[1], range[2]), end: p(range[3], range[4]) };
  }
  const one = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/);
  if (one) {
    const start = `${one[1].padStart(2, "0")}:${one[2]}`;
    return { title: text.replace(one[0], " ").replace(/\s+/g, " ").trim(), start, end: fmtMin(toMin(start) + 60) };
  }
  return { title: text.trim(), start: "", end: "" };
}

/** Side-by-side columns for overlapping events. */
function layoutDay(evs: CalEvent[]): { ev: CalEvent; s: number; e: number; col: number; cols: number }[] {
  const items = evs
    .map((ev) => ({ ev, r: evRange(ev)! }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1]);
  const out: { ev: CalEvent; s: number; e: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => (c.cols = cols));
    out.push(...cluster);
    cluster = [];
  };
  for (const { ev, r } of items) {
    if (cluster.length && r[0] >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.e > r[0]).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ev, s: r[0], e: r[1], col, cols: 1 });
    clusterEnd = Math.max(clusterEnd < 0 ? 0 : clusterEnd, r[1]);
  }
  if (cluster.length) flush();
  return out;
}

function HourGutter({ h0, h1 }: { h0: number; h1: number }) {
  return (
    <div className="cal2-gutter" style={{ height: (h1 - h0) * HOUR_PX }}>
      {Array.from({ length: h1 - h0 }, (_, i) => (
        <div key={i} className="cal2-gutter-h" style={{ top: i * HOUR_PX }}>{String(h0 + i).padStart(2, "0")}:00</div>
      ))}
    </div>
  );
}

function DayTrack({
  iso, evs, h0, h1, isToday, onSlot, onEvent,
}: {
  iso: string; evs: CalEvent[]; h0: number; h1: number; isToday: boolean;
  onSlot: (iso: string, start: string) => void; onEvent: (e: CalEvent) => void;
}) {
  const laid = layoutDay(evs.filter((e) => evRange(e)));
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <div
      className={`cal2-track${isToday ? " today" : ""}`}
      style={{ height: (h1 - h0) * HOUR_PX }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const mins = h0 * 60 + Math.floor(((e.clientY - r.top) / HOUR_PX) * 2) * 30;
        onSlot(iso, fmtMin(Math.max(0, Math.min(23 * 60 + 30, mins))));
      }}
    >
      {Array.from({ length: h1 - h0 }, (_, i) => <div key={i} className="cal2-hline" style={{ top: i * HOUR_PX }} />)}
      {laid.map(({ ev, s, e, col, cols }) => (
        <button
          key={ev.id}
          type="button"
          className="cal2-ev"
          style={{
            top: ((s - h0 * 60) / 60) * HOUR_PX,
            height: Math.max(22, ((e - s) / 60) * HOUR_PX - 2),
            left: `calc(${(col / cols) * 100}% + 2px)`,
            width: `calc(${100 / cols}% - 4px)`,
            background: tint(colorOf(ev.calendar), 30),
            borderColor: colorOf(ev.calendar),
          }}
          onClick={(x) => { x.stopPropagation(); onEvent(ev); }}
          title={`${ev.title} · ${ev.start}–${fmtMin(e)}`}
        >
          <span className="cal2-ev-title">{ev.title}</span>
          <span className="cal2-ev-time">{ev.start} – {fmtMin(e)}</span>
        </button>
      ))}
      {isToday && nowMin >= h0 * 60 && nowMin <= h1 * 60 && (
        <div className="cal2-now" style={{ top: ((nowMin - h0 * 60) / 60) * HOUR_PX }} />
      )}
    </div>
  );
}

function EventModal({
  initial, onSave, onDelete, onClose,
}: {
  initial: Partial<CalEvent> & { date: string };
  onSave: (e: Omit<CalEvent, "id">, id?: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [calendar, setCalendar] = useState(initial.calendar ?? "other");
  const [date, setDate] = useState(initial.date);
  const [allDay, setAllDay] = useState(initial.all_day ?? !initial.start);
  const [start, setStart] = useState(initial.start || "09:00");
  const [end, setEnd] = useState(initial.end || (initial.start ? fmtMin(toMin(initial.start) + 60) : "10:00"));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!title.trim()) { setErr("Give the event a title."); return; }
    setBusy(true);
    try {
      await onSave({ title: title.trim(), calendar, date, all_day: allDay, start: allDay ? "" : start, end: allDay ? "" : end, notes }, initial.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <div className="cal2-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cal2-modal card" role="dialog" aria-label="Event">
        <h3 style={{ margin: "0 0 10px" }}>{initial.id ? "Edit event" : "New event"}</h3>
        <label className="cal2-field">Title
          <input autoFocus type="text" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
        </label>
        <div className="cal2-row">
          <label className="cal2-field">Calendar
            <select value={calendar} onChange={(e) => setCalendar(e.target.value)}>
              {CALS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="cal2-field">Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="cal2-check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
        {!allDay && (
          <div className="cal2-row">
            <label className="cal2-field">Start<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="cal2-field">End<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
        )}
        <label className="cal2-field">Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {err && <div className="cal-error">{err}</div>}
        <div className="cal2-modal-actions">
          {onDelete && <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); await onDelete(); }}>Delete</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default function CalendarView({ onOpenTask }: Props) {
  const todayIso = toIso(new Date());
  const [view, setView] = useState<View>(() => {
    try { const v = localStorage.getItem(VIEW_KEY); if (v === "month" || v === "week" || v === "day" || v === "schedule") return v; } catch { /* ignore */ }
    return "month";
  });
  const [selected, setSelected] = useState<string>(todayIso);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<TaskStatusDef[]>(() => getCachedTaskStatuses());
  const [notify, setNotify] = useState<NotificationSettings | null>(null);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(ENABLED_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set([...CALS.map((c) => c.id), "tasks"]);
  });
  const [modal, setModal] = useState<(Partial<CalEvent> & { date: string }) | null>(null);
  const [quick, setQuick] = useState("");
  const [quickCal, setQuickCal] = useState("other");

  const load = useCallback(async () => {
    try {
      const [t, ev] = await Promise.all([api.tasks.calendar(), api.calendarEvents.list()]);
      setItems(t.items);
      setEvents(ev.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    ensureTaskStatuses(() => api.taskStatuses.get()).then(setStatuses);
    const onUpdate = () => setStatuses(getCachedTaskStatuses());
    window.addEventListener(TASK_STATUSES_EVENT, onUpdate);
    return () => window.removeEventListener(TASK_STATUSES_EVENT, onUpdate);
  }, []);
  useEffect(() => { api.notifications.settings().then(setNotify).catch(() => setNotify(null)); }, []);

  function changeView(v: View) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }
  function toggleCal(id: string) {
    setEnabled((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      try { localStorage.setItem(ENABLED_KEY, JSON.stringify([...n])); } catch { /* ignore */ }
      return n;
    });
  }

  const taskByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const l = map.get(item.deadline) ?? [];
      l.push(item);
      map.set(item.deadline, l);
    }
    return map;
  }, [items]);
  const tasksOn = (iso: string) => (enabled.has("tasks") ? taskByDate.get(iso) ?? [] : []);
  const eventsOn = useCallback(
    (iso: string) =>
      events
        .filter((e) => e.date === iso && enabled.has(e.calendar))
        .sort((a, b) => (a.all_day ? "" : a.start).localeCompare(b.all_day ? "" : b.start)),
    [events, enabled]
  );
  const overdue = useMemo(() => items.filter((i) => !i.done && i.deadline < todayIso), [items, todayIso]);

  const statusDef = (id: string) => statuses.find((s) => s.id === id);
  const glyph = (id: string) => STATUS_ICON_GLYPH[statusDef(id)?.icon ?? ""] || "○";

  /* ---- event CRUD ---- */
  async function saveEvent(e: Omit<CalEvent, "id">, id?: string) {
    if (id) {
      const r = await api.calendarEvents.update(id, e);
      setEvents((prev) => prev.map((x) => (x.id === id ? r.event : x)));
    } else {
      const r = await api.calendarEvents.create(e);
      setEvents((prev) => [...prev, r.event]);
    }
    setSelected(e.date);
    setModal(null);
  }
  async function deleteEvent(id: string) {
    await api.calendarEvents.remove(id);
    setEvents((prev) => prev.filter((x) => x.id !== id));
    setModal(null);
  }
  async function quickAdd() {
    const p = parseQuick(quick);
    if (!p.title) return;
    try {
      const r = await api.calendarEvents.create({ title: p.title, date: selected, start: p.start, end: p.end, all_day: !p.start, calendar: quickCal, notes: "" });
      setEvents((prev) => [...prev, r.event]);
      setQuick("");
      if (!enabled.has(quickCal)) toggleCal(quickCal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the event");
    }
  }

  /* ---- navigation ---- */
  function step(dir: -1 | 1) {
    if (view === "month") {
      const d = fromIso(selected);
      const last = new Date(d.getFullYear(), d.getMonth() + dir + 1, 0).getDate();
      setSelected(toIso(new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), last))));
    } else if (view === "week") setSelected(addDays(selected, 7 * dir));
    else setSelected(addDays(selected, dir));
  }

  /* ---- hour range for timelines ---- */
  function hoursFor(isos: string[]): [number, number] {
    let h0 = 8, h1 = 20;
    for (const iso of isos) for (const e of eventsOn(iso)) {
      const r = evRange(e);
      if (!r) continue;
      h0 = Math.min(h0, Math.floor(r[0] / 60));
      h1 = Math.max(h1, Math.ceil(r[1] / 60));
    }
    return [Math.max(0, h0), Math.min(24, h1)];
  }

  function taskChip(item: CalendarItem) {
    const od = !item.done && item.deadline < todayIso;
    return (
      <button
        key={`${item.kind}-${item.id}`}
        type="button"
        className={`cal2-chip task${item.done ? " done" : ""}${od ? " overdue" : ""}`}
        title={`${item.name} · ${item.project_name} — open in Tasks`}
        onClick={(e) => { e.stopPropagation(); onOpenTask(item.project_slug, item.main_task_id); }}
      >
        <span aria-hidden="true">{od ? "!" : glyph(item.status_id)}</span> <span className="cal2-chip-name">{item.name}</span>
      </button>
    );
  }
  function eventChip(ev: CalEvent) {
    return (
      <button
        key={ev.id}
        type="button"
        className="cal2-chip"
        style={{ background: tint(colorOf(ev.calendar), 22) }}
        title={`${ev.title}${ev.start ? ` · ${ev.start}` : ""}`}
        onClick={(e) => { e.stopPropagation(); setModal(ev); }}
      >
        <i className="cal2-dot" style={{ background: colorOf(ev.calendar) }} />
        <span className="cal2-chip-name">{ev.title}</span>
      </button>
    );
  }

  /* ---- month grid ---- */
  const monthCells = useMemo(() => {
    const d = fromIso(selected);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const startIso = addDays(toIso(first), -((first.getDay() + 6) % 7));
    const rows = Math.ceil(((first.getDay() + 6) % 7 + new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) / 7);
    return { month: d.getMonth(), cells: Array.from({ length: rows * 7 }, (_, i) => addDays(startIso, i)) };
  }, [selected]);

  function renderMonth() {
    return (
      <div className="cal2-month">
        {WEEKDAYS.map((w) => <div key={w} className="cal2-weekday">{w}</div>)}
        {monthCells.cells.map((iso) => {
          const d = fromIso(iso);
          const evs = eventsOn(iso);
          const tks = tasksOn(iso);
          const all = [...evs.map((e) => ({ k: `e${e.id}`, n: eventChip(e) })), ...tks.map((t) => ({ k: `t${t.kind}${t.id}`, n: taskChip(t) }))];
          return (
            <div
              key={iso}
              className={`cal2-cell${d.getMonth() !== monthCells.month ? " out" : ""}${iso === todayIso ? " today" : ""}${iso === selected ? " sel" : ""}`}
              onClick={() => setSelected(iso)}
              onDoubleClick={() => setModal({ date: iso })}
            >
              <span className="cal2-num">{d.getDate()}</span>
              {all.slice(0, MAX_PER_CELL).map((x) => <span key={x.k} className="cal2-chip-wrap">{x.n}</span>)}
              {all.length > MAX_PER_CELL && <span className="cal-more">+{all.length - MAX_PER_CELL} more</span>}
            </div>
          );
        })}
      </div>
    );
  }

  /* ---- day schedule (used by month + day views) ---- */
  function renderDay(iso: string, withNav: boolean) {
    const [h0, h1] = hoursFor([iso]);
    const evs = eventsOn(iso);
    const allDay = [...evs.filter((e) => !evRange(e)).map(eventChip), ...tasksOn(iso).map(taskChip)];
    return (
      <>
        {withNav && (
          <div className="cal2-bar">
            <div className="cal2-stepper">
              <button type="button" className="btn" onClick={() => setSelected(addDays(selected, -1))} aria-label="Previous day">‹</button>
              <button type="button" className="btn" onClick={() => setSelected(addDays(selected, 1))} aria-label="Next day">›</button>
            </div>
            <input type="date" className="cal2-pick" value={selected} onChange={(e) => e.target.value && setSelected(e.target.value)} />
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={() => setSelected(todayIso)}>Today</button>
          </div>
        )}
        <div className="cal2-dayhead">{fromIso(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}{iso === todayIso ? " · today" : ""}</div>
        {allDay.length > 0 && <div className="cal2-allday">{allDay.map((n, i) => <span key={i} className="cal2-chip-wrap">{n}</span>)}</div>}
        <div className="cal2-timeline">
          <HourGutter h0={h0} h1={h1} />
          <DayTrack iso={iso} evs={evs} h0={h0} h1={h1} isToday={iso === todayIso} onSlot={(d, s) => setModal({ date: d, start: s, end: fmtMin(toMin(s) + 60), all_day: false })} onEvent={setModal} />
        </div>
      </>
    );
  }

  function renderWeek() {
    const ws = weekStart(selected);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const [h0, h1] = hoursFor(days);
    return (
      <div className="cal2-week">
        <div className="cal2-week-head">
          <div className="cal2-gutter-sp" />
          {days.map((iso, i) => {
            const all = [...eventsOn(iso).filter((e) => !evRange(e)).map(eventChip), ...tasksOn(iso).map(taskChip)];
            return (
              <div key={iso} className={`cal2-week-col${iso === todayIso ? " today" : ""}${iso === selected ? " sel" : ""}`} onClick={() => setSelected(iso)}>
                <div className="cal2-week-day"><span>{WEEKDAYS[i]}</span> <strong>{fromIso(iso).getDate()}</strong></div>
                {all.slice(0, 4).map((n, k) => <span key={k} className="cal2-chip-wrap">{n}</span>)}
                {all.length > 4 && <span className="cal-more">+{all.length - 4} more</span>}
              </div>
            );
          })}
        </div>
        <div className="cal2-week-body">
          <HourGutter h0={h0} h1={h1} />
          {days.map((iso) => (
            <DayTrack key={iso} iso={iso} evs={eventsOn(iso)} h0={h0} h1={h1} isToday={iso === todayIso}
              onSlot={(d, s) => setModal({ date: d, start: s, end: fmtMin(toMin(s) + 60), all_day: false })} onEvent={setModal} />
          ))}
        </div>
      </div>
    );
  }

  function renderSchedule() {
    const rows: { iso: string; nodes: JSX.Element[] }[] = [];
    for (let i = 0; i < 90; i++) {
      const iso = addDays(selected, i);
      const nodes: JSX.Element[] = [
        ...eventsOn(iso).map((ev) => (
          <button key={ev.id} type="button" className="cal2-srow" onClick={() => setModal(ev)}>
            <i className="cal2-dot" style={{ background: colorOf(ev.calendar) }} />
            <span className="cal2-srow-t">{ev.all_day || !ev.start ? "All day" : `${ev.start}${ev.end ? ` – ${ev.end}` : ""}`}</span>
            <span className="cal2-srow-n">{ev.title}</span>
            <span className="muted">{CALS.find((c) => c.id === ev.calendar)?.label}</span>
          </button>
        )),
        ...tasksOn(iso).map((t) => (
          <button key={`${t.kind}${t.id}`} type="button" className="cal2-srow" onClick={() => onOpenTask(t.project_slug, t.main_task_id)}>
            <i className="cal2-dot" style={{ background: "var(--accent)" }} />
            <span className="cal2-srow-t">Due</span>
            <span className="cal2-srow-n">{t.name}</span>
            <span className="muted">{t.project_name}</span>
          </button>
        )),
      ];
      if (nodes.length) rows.push({ iso, nodes });
    }
    return (
      <div className="cal2-schedule">
        {rows.length === 0 && <p className="cal-empty">Nothing scheduled in the next 90 days.</p>}
        {rows.map((r) => (
          <div key={r.iso} className="cal2-sday">
            <div className="cal2-sdate">{fromIso(r.iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}{r.iso === todayIso ? " · today" : ""}</div>
            <div className="cal2-slist">{r.nodes}</div>
          </div>
        ))}
      </div>
    );
  }

  /* ---- sidebar ---- */
  const upcoming = useMemo(() => {
    const out: { iso: string; time: string; title: string; color: string; onClick: () => void }[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(todayIso, i);
      for (const ev of eventsOn(iso)) out.push({ iso, time: ev.all_day || !ev.start ? "All day" : `${ev.start}${ev.end ? ` – ${ev.end}` : ""}`, title: ev.title, color: colorOf(ev.calendar), onClick: () => setModal(ev) });
      for (const t of tasksOn(iso)) out.push({ iso, time: "Due", title: t.name, color: "var(--accent)", onClick: () => onOpenTask(t.project_slug, t.main_task_id) });
    }
    return out.slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, enabled, items, todayIso]);

  async function toggleNotify(on: boolean) {
    setNotifyMsg(null);
    setNotify((prev) => (prev ? { ...prev, enabled: on } : prev));
    try { setNotify(await api.notifications.save(on)); }
    catch (e) {
      setNotify((prev) => (prev ? { ...prev, enabled: !on } : prev));
      setNotifyMsg(e instanceof Error ? e.message : "Could not save");
    }
  }
  async function sendTest() {
    setNotifyMsg(null);
    try {
      const r = await api.notifications.test();
      setNotifyMsg(r.sent ? "Sent — check your notifications." : "Couldn't show a notification on this system.");
    } catch (e) { setNotifyMsg(e instanceof Error ? e.message : "Test failed"); }
  }

  const sel = fromIso(selected);
  const mainTitle =
    view === "week"
      ? `${fromIso(weekStart(selected)).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${fromIso(addDays(weekStart(selected), 6)).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
      : sel.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="calendar-view cal2">
      <header className="cal2-top">
        <h1 className="cal2-h1">Calendar</h1>
        <div className="cal2-views">
          {([["month", "Month"], ["week", "Week"], ["day", "Day"], ["schedule", "Schedule"]] as [View, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`btn${view === v ? " btn-primary" : ""}`} onClick={() => changeView(v)}>{l}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-primary" onClick={() => setModal({ date: selected })}>+ New Event</button>
      </header>

      {error && <div className="cal-error" role="alert">{error}</div>}
      {loading && <div className="cal-loading">Loading…</div>}

      <div className={`cal2-body view-${view}`}>
        <section className="cal2-main card">
          {view !== "schedule" && view !== "day" && (
            <div className="cal2-bar">
              <div className="cal2-stepper">
                <button type="button" className="btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
                <button type="button" className="btn" onClick={() => step(1)} aria-label="Next">›</button>
              </div>
              <h2 className="cal2-title">{mainTitle}</h2>
              {view === "month" && (
                <input type="month" className="cal2-pick" value={selected.slice(0, 7)} onChange={(e) => e.target.value && setSelected(`${e.target.value}-01`)} title="Jump to month" />
              )}
              <span style={{ flex: 1 }} />
              <button type="button" className="btn" onClick={() => setSelected(todayIso)}>Today</button>
            </div>
          )}
          {view === "month" && renderMonth()}
          {view === "week" && renderWeek()}
          {view === "day" && renderDay(selected, true)}
          {view === "schedule" && (
            <>
              <div className="cal2-bar"><h2 className="cal2-title">Schedule</h2><span className="muted" style={{ fontSize: 12 }}>next 90 days from {selected}</span><span style={{ flex: 1 }} /><button type="button" className="btn" onClick={() => setSelected(todayIso)}>Today</button></div>
              {renderSchedule()}
            </>
          )}
        </section>

        {view === "month" && <section className="cal2-daypanel card">{renderDay(selected, true)}</section>}

        <aside className="cal2-side">
          <div className="card cal2-card">
            <h3 className="cal2-card-t">Quick Add</h3>
            <input type="text" placeholder="Event title… (add 13:00-14:00 for a time)" value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void quickAdd(); }} />
            <div className="cal2-row" style={{ marginTop: 6 }}>
              <select value={quickCal} onChange={(e) => setQuickCal(e.target.value)}>{CALS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
              <button type="button" className="btn btn-primary" disabled={!quick.trim()} onClick={quickAdd}>Add</button>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Adds to {fromIso(selected).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
          </div>

          <div className="card cal2-card">
            <h3 className="cal2-card-t">Calendars</h3>
            {[...CALS, TASKS_CAL].map((c) => (
              <label key={c.id} className="cal2-cal">
                <input type="checkbox" checked={enabled.has(c.id)} onChange={() => toggleCal(c.id)} />
                <i className="cal2-dot big" style={{ background: c.color }} />
                {c.label}
              </label>
            ))}
          </div>

          <div className="card cal2-card">
            <h3 className="cal2-card-t">Upcoming <span className="muted" style={{ fontWeight: 400 }}>(next 7 days)</span></h3>
            {upcoming.length === 0 && <p className="cal-empty">Nothing coming up.</p>}
            {upcoming.map((u, i) => (
              <button key={i} type="button" className="cal2-up" onClick={u.onClick}>
                <span className="cal2-up-d">{fromIso(u.iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <i className="cal2-dot big" style={{ background: u.color }} />
                <span className="cal2-up-m"><span>{u.title}</span><span className="muted">{u.time}</span></span>
              </button>
            ))}
          </div>

          {overdue.length > 0 && (
            <div className="card cal2-card cal-overdue">
              <h3 className="cal2-card-t" style={{ color: "var(--crit)" }}>! Overdue · {overdue.length}</h3>
              {overdue.slice(0, 8).map((t) => (
                <button key={`${t.kind}${t.id}`} type="button" className="cal2-up" onClick={() => onOpenTask(t.project_slug, t.main_task_id)}>
                  <span className="cal2-up-d">{fromIso(t.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <span className="cal2-up-m"><span>{t.name}</span><span className="muted">{t.project_name}</span></span>
                </button>
              ))}
            </div>
          )}

          {notify && (
            <div className="card cal2-card">
              <h3 className="cal2-card-t">Reminders</h3>
              <label className="cal-notify-toggle">
                <input type="checkbox" checked={notify.enabled} disabled={!notify.desktop} onChange={(e) => toggleNotify(e.target.checked)} />
                Desktop reminders
              </label>
              <div className="cal-notify-hint">{notify.desktop ? "A heads-up for tasks due today, tomorrow or overdue." : "Reminders show in the Yggdrasil desktop app."}</div>
              {notify.desktop && <button type="button" className="btn" style={{ marginTop: 6 }} onClick={sendTest}>Send test</button>}
              {notifyMsg && <div className="cal-notify-msg" role="status">{notifyMsg}</div>}
            </div>
          )}
        </aside>
      </div>

      {modal && (
        <EventModal
          key={modal.id ?? `new-${modal.date}-${modal.start ?? ""}`}
          initial={modal}
          onSave={saveEvent}
          onDelete={modal.id ? () => deleteEvent(modal.id as string) : undefined}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
