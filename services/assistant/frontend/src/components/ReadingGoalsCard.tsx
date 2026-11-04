import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock, formatDuration, localDate, reading, type ReadingGoal, type TimeCategory, type TimeTotals } from "../api/reading";
import { lastCategory, onManualFlushed, startManualTimer, stopManualTimer, useManualTimer } from "../lib/manualTimer";
import ReadingArc from "./ReadingArc";

type DayRow = TimeTotals & { date: string; goal_met: boolean };

const CATS: { id: TimeCategory; label: string }[] = [
  { id: "papers", label: "Papers" },
  { id: "books", label: "Books" },
  { id: "writing", label: "Writing" },
];

function dayLabel(iso: string, offset: number): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Yesterday";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Dashboard card: reading/writing time for a day against the daily goal, a start/stop timer that adds up
 * across the day, and ◀ ▶ to browse earlier days. Reaching the thresholds ticks the habits that feed the lightcurve.
 */
export default function ReadingGoalsCard({ onOpenBooks, onHabitsChanged }: { onOpenBooks?: () => void; onHabitsChanged?: () => void }) {
  const [goal, setGoal] = useState<ReadingGoal | null>(null);
  const [history, setHistory] = useState<DayRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [cat, setCat] = useState<TimeCategory>(() => lastCategory());
  const timer = useManualTimer();
  const changed = useRef(onHabitsChanged);
  changed.current = onHabitsChanged;
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    reading.goal().then((g) => { setGoal(g); setFailed(false); }).catch(() => setFailed(true));
    reading.history(90).then((h) => setHistory(h.days)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const off = onManualFlushed(() => { load(); changed.current?.(); });
    return () => { window.clearInterval(t); window.removeEventListener("focus", onFocus); off(); };
  }, [load]);

  useEffect(() => {
    if (!timer.running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [timer.running]);

  const row: DayRow | null = useMemo(() => (offset === 0 ? null : history[offset] || null), [history, offset]);
  const viewing: TimeTotals | null = offset === 0 ? goal?.time_today || null : row;
  const viewDate = offset === 0 ? localDate() : row?.date || "";
  const goalS = goal ? goal.goal_minutes * 60 : 0;
  const booksS = viewing?.books ?? 0;
  const running = timer.running;
  const elapsed = running ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0;

  return (
    <div className="card dash-widget rg-card">
      <div className="rg-head">
        <div className="week-progress-title" style={{ margin: 0 }}>Reading goals</div>
        <button type="button" className="rg-link" onClick={onOpenBooks} aria-label="Open Collection">Collection →</button>
      </div>
      {!goal ? (
        <div className="muted" style={{ fontSize: 13 }}>{failed ? "Reading data isn’t available right now." : "Loading…"}</div>
      ) : (
        <>
          <div className="rg-daynav" role="group" aria-label="Browse days">
            <button type="button" className="rg-nav-btn" onClick={() => setOffset((o) => Math.min(history.length - 1, o + 1))} disabled={offset >= history.length - 1} aria-label="Previous day">‹</button>
            <span className="rg-day">{dayLabel(viewDate, offset)}{offset === 1 && <span className="muted"> · {viewDate.slice(5)}</span>}</span>
            <button type="button" className="rg-nav-btn" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} aria-label="Next day">›</button>
          </div>
          <div className="rg-arc-box">
            <ReadingArc fraction={goalS > 0 ? booksS / goalS : 0} width={240} stroke={10} fluid>
              <div className="rd-arc-time rg-time">{formatClock(booksS)}</div>
              <div className="muted rg-of">of {goal.goal_minutes} min{booksS >= goalS && goalS > 0 ? " ✓" : ""}</div>
            </ReadingArc>
          </div>
          {offset === 0 && (
            <div className="bk-weekdots rg-dots" role="list" aria-label="This week">
              {goal.week.map((d) => (
                <div key={d.date} role="listitem" aria-label={`${d.date}: ${d.state}`} className={`bk-dot ${d.state}${d.met ? " met" : ""}`} title={`${d.date} · ${Math.round(d.seconds / 60)} min`}>
                  {d.met && d.state !== "today" ? "✓" : d.letter}
                </div>
              ))}
            </div>
          )}
          <div className="rg-times" aria-label="Time on this day">
            <div className="rg-time-item" title="Papers opened in the Papers reader, or the timer set to Papers"><span className="muted">Papers</span><strong>{formatDuration(viewing?.papers ?? 0)}</strong></div>
            <div className="rg-time-item" title="Books opened in Books, or the timer set to Books"><span className="muted">Books</span><strong>{formatDuration(booksS)}</strong></div>
            <div className="rg-time-item" title="The LaTeX editor, or the timer set to Writing"><span className="muted">Writing</span><strong>{formatDuration(viewing?.writing ?? 0)}</strong></div>
          </div>
          {offset === 0 ? (
            <div className="rg-timer">
              <select value={running ? timer.category : cat} disabled={running} onChange={(e) => setCat(e.target.value as TimeCategory)} aria-label="What are you timing?">
                {CATS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button
                type="button"
                className={`btn rg-timer-btn${running ? " running" : " btn-primary"}`}
                onClick={() => { if (running) void stopManualTimer(); else startManualTimer(cat); }}
                aria-pressed={running}
              >
                {running ? `■ Stop · ${formatClock(elapsed)}` : "▶ Start timer"}
              </button>
            </div>
          ) : (
            <div className="muted rg-foot">{row?.goal_met ? "Goal reached ✓" : "Goal not reached"}</div>
          )}
          <div className="rg-foot">
            <strong>{goal.streak === 0 ? "No streak yet" : `${goal.streak}-day streak`}</strong>
            <span className="muted"> · {Math.round(goal.week_seconds / 60)} min this week</span>
          </div>
        </>
      )}
    </div>
  );
}
