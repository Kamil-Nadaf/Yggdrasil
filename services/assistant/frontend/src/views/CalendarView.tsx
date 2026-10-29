import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CalendarItem, type NotificationSettings, type TaskStatusDef } from "../api/client";
import {
  ensureTaskStatuses,
  getCachedTaskStatuses,
  STATUS_ICON_GLYPH,
  TASK_STATUSES_EVENT,
} from "../lib/taskStatuses";

/**
 * Calendar: every task and subtask with a deadline, laid out by date. Read-only —
 * clicking an item opens it in the Tasks view. Overdue and done items are marked
 * with glyphs as well as colour, so they still read in the grayscale e-ink theme.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_CELL = 3;

type Props = {
  onOpenTask: (projectSlug: string, mainTaskId: string) => void;
};

/** Local calendar date as YYYY-MM-DD (never via toISOString, which shifts the day). */
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default function CalendarView({ onOpenTask }: Props) {
  const todayIso = toIso(new Date());
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string>(todayIso);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<TaskStatusDef[]>(() => getCachedTaskStatuses());
  const [notify, setNotify] = useState<NotificationSettings | null>(null);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.tasks.calendar();
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    ensureTaskStatuses(() => api.taskStatuses.get()).then(setStatuses);
    const onUpdate = () => setStatuses(getCachedTaskStatuses());
    window.addEventListener(TASK_STATUSES_EVENT, onUpdate);
    return () => window.removeEventListener(TASK_STATUSES_EVENT, onUpdate);
  }, []);

  useEffect(() => {
    api.notifications.settings().then(setNotify).catch(() => setNotify(null));
  }, []);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const list = map.get(item.deadline) ?? [];
      list.push(item);
      map.set(item.deadline, list);
    }
    return map;
  }, [items]);

  const overdue = useMemo(
    () => items.filter((i) => !i.done && i.deadline < todayIso),
    [items, todayIso]
  );

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= daysInMonth; day++) {
      out.push(new Date(first.getFullYear(), first.getMonth(), day));
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const statusDef = (id: string): TaskStatusDef | undefined => statuses.find((s) => s.id === id);
  const glyph = (id: string) => STATUS_ICON_GLYPH[statusDef(id)?.icon ?? ""] || "○";

  const selectedItems = byDate.get(selected) ?? [];

  async function toggleNotify(enabled: boolean) {
    setNotifyMsg(null);
    // Optimistic: flip immediately, roll back if the save fails.
    setNotify((prev) => (prev ? { ...prev, enabled } : prev));
    try {
      setNotify(await api.notifications.save(enabled));
    } catch (e) {
      setNotify((prev) => (prev ? { ...prev, enabled: !enabled } : prev));
      setNotifyMsg(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function sendTest() {
    setNotifyMsg(null);
    try {
      const r = await api.notifications.test();
      setNotifyMsg(r.sent ? "Sent — check your notifications." : "Couldn't show a notification on this system.");
    } catch (e) {
      setNotifyMsg(e instanceof Error ? e.message : "Test failed");
    }
  }

  function renderRow(item: CalendarItem, showDate: boolean) {
    const isOverdue = !item.done && item.deadline < todayIso;
    return (
      <button
        key={`${item.kind}-${item.id}`}
        type="button"
        className={`cal-row${item.done ? " cal-row--done" : ""}${isOverdue ? " cal-row--overdue" : ""}`}
        onClick={() => onOpenTask(item.project_slug, item.main_task_id)}
        title="Open in Tasks"
      >
        <span className="cal-row-glyph" aria-hidden="true">{isOverdue ? "!" : glyph(item.status_id)}</span>
        <span className="cal-row-main">
          <span className="cal-row-name">
            {item.kind === "subtask" && <span className="cal-row-kind">Subtask · </span>}
            {item.name}
          </span>
          <span className="cal-row-meta">
            {item.project_name}
            {item.kind === "subtask" && item.main_task_name ? ` › ${item.main_task_name}` : ""}
            {" · "}
            {statusDef(item.status_id)?.name ?? item.status_id}
            {showDate ? ` · ${fromIso(item.deadline).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
          </span>
        </span>
      </button>
    );
  }

  const monthTitle = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="calendar-view">
      <header className="cal-header">
        <div className="cal-nav">
          <button type="button" className="btn" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} aria-label="Previous month">
            ‹
          </button>
          <h2 className="cal-title">{monthTitle}</h2>
          <button type="button" className="btn" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} aria-label="Next month">
            ›
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCursor(startOfMonth(new Date()));
              setSelected(todayIso);
            }}
          >
            Today
          </button>
        </div>

        {notify && (
          <div className="cal-notify">
            <label className="cal-notify-toggle">
              <input
                type="checkbox"
                checked={notify.enabled}
                disabled={!notify.desktop}
                onChange={(e) => toggleNotify(e.target.checked)}
              />
              Desktop reminders
            </label>
            <span className="cal-notify-hint">
              {notify.desktop
                ? "A heads-up for tasks due today, tomorrow or overdue."
                : "Reminders show in the Yggdrasil desktop app."}
            </span>
            {notify.desktop && (
              <button type="button" className="btn" onClick={sendTest}>
                Send test
              </button>
            )}
            {notifyMsg && <span className="cal-notify-msg" role="status">{notifyMsg}</span>}
          </div>
        )}
      </header>

      {error && <div className="cal-error" role="alert">{error}</div>}
      {loading && <div className="cal-loading">Loading…</div>}

      {!loading && overdue.length > 0 && (
        <section className="cal-section cal-overdue" aria-label="Overdue tasks">
          <h3 className="cal-section-title">! Overdue · {overdue.length}</h3>
          <div className="cal-list">{overdue.map((i) => renderRow(i, true))}</div>
        </section>
      )}

      <div className="cal-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">{w}</div>
        ))}
        {cells.map((d, idx) => {
          if (!d) return <div key={`empty-${idx}`} className="cal-cell cal-cell--empty" />;
          const iso = toIso(d);
          const dayItems = byDate.get(iso) ?? [];
          const shown = dayItems.slice(0, MAX_PER_CELL);
          const classes = [
            "cal-cell",
            iso === todayIso ? "cal-cell--today" : "",
            iso === selected ? "cal-cell--selected" : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={iso} className={classes}onClick={() => setSelected(iso)}>
              <span className="cal-day-num">{d.getDate()}</span>
              {shown.map((item) => {
                const isOverdue = !item.done && item.deadline < todayIso;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    className={`cal-chip${item.done ? " cal-chip--done" : ""}${isOverdue ? " cal-chip--overdue" : ""}`}
                    title={`${item.name} · ${item.project_name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTask(item.project_slug, item.main_task_id);
                    }}
                  >
                    <span aria-hidden="true">{isOverdue ? "!" : glyph(item.status_id)}</span>{" "}
                    <span className="cal-chip-name">{item.name}</span>
                  </button>
                );
              })}
              {dayItems.length > MAX_PER_CELL && (
                <span className="cal-more">+{dayItems.length - MAX_PER_CELL} more</span>
              )}
            </div>
          );
        })}
      </div>

      <section className="cal-section cal-agenda" aria-label="Selected day">
        <h3 className="cal-section-title">
          {fromIso(selected).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          {selected === todayIso ? " · today" : ""}
        </h3>
        {selectedItems.length === 0 ? (
          <p className="cal-empty">Nothing due this day.</p>
        ) : (
          <div className="cal-list">{selectedItems.map((i) => renderRow(i, false))}</div>
        )}
      </section>
    </div>
  );
}
