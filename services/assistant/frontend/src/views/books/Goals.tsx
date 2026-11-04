import { useState } from "react";
import { formatClock, formatDuration, type ReadingGoal } from "../../api/reading";
import ReadingArc from "../../components/ReadingArc";

interface Props {
  goal: ReadingGoal | null;
  error: string;
  onSetGoal: (minutes: number) => void;
  onContinue: (slug: string) => void;
}

const PRESETS = [15, 30, 45, 60];

export default function Goals({ goal, error, onSetGoal, onContinue }: Props) {
  const [custom, setCustom] = useState("");
  const [editing, setEditing] = useState(false);

  if (!goal) {
    return (
      <div className="bk-page">
        <header className="bk-head"><div><h1 className="bk-title">Reading goals</h1></div></header>
        <div className={error ? "bk-error" : "muted"}>{error || "Loading…"}</div>
      </div>
    );
  }

  const goalS = goal.goal_minutes * 60;
  const frac = goalS > 0 ? goal.today_seconds / goalS : 0;
  const maxS = Math.max(goalS * 1.25, ...goal.week.map((d) => d.seconds), 60);
  const streakText = goal.streak === 0 ? "Start a new streak." : `${goal.streak}-day streak`;

  return (
    <div className="bk-page">
      <header className="bk-head">
        <div>
          <h1 className="bk-title">Reading goals</h1>
          <p className="muted bk-sub">Set a daily target and keep a steady habit. Reaching it ticks “Extra reading” on your dashboard.</p>
        </div>
      </header>

      <div className="bk-goals-grid">
        <section className="card bk-goal-card" aria-label="Today's reading">
          <button type="button" className="bk-goal-edit btn" onClick={() => setEditing((v) => !v)} aria-expanded={editing} aria-label="Goal settings" title="Goal settings">⚙</button>
          {editing && (
            <div className="bk-goal-popover card" role="group" aria-label="Daily goal">
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Daily goal (minutes)</div>
              <div className="bk-presets">
                {PRESETS.map((m) => (
                  <button key={m} type="button" className={`btn${goal.goal_minutes === m ? " btn-primary" : ""}`} onClick={() => { onSetGoal(m); setEditing(false); }}>{m}</button>
                ))}
              </div>
              <form className="bk-inline" onSubmit={(e) => { e.preventDefault(); const n = parseInt(custom, 10); if (n >= 1 && n <= 600) { onSetGoal(n); setCustom(""); setEditing(false); } }}>
                <input type="text" inputMode="numeric" placeholder="Other" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} aria-label="Custom goal in minutes" style={{ width: 80 }} />
                <button type="submit" className="btn" disabled={!custom}>Set</button>
              </form>
            </div>
          )}
          <ReadingArc fraction={frac}>
            <div className="rd-arc-label">Today’s reading</div>
            <div className="rd-arc-time">{formatClock(goal.today_seconds)}</div>
            <div className="muted">of your {goal.goal_minutes}-minute goal{goal.goal_met ? " — reached ✓" : ""}</div>
          </ReadingArc>
          {goal.current ? (
            <button type="button" className="btn btn-primary bk-pill" onClick={() => onContinue(goal.current!.slug)}>
              Continue “{goal.current.title}”
            </button>
          ) : (
            <div className="muted">Open a book from the Library to start counting.</div>
          )}

          <div className="bk-goal-week">
            <div className="bk-weekdots" role="list" aria-label="This week">
              {goal.week.map((d) => (
                <div key={d.date} role="listitem" aria-label={`${d.date}: ${d.state}`} className={`bk-dot ${d.state}${d.met ? " met" : ""}`} title={`${d.date} · ${Math.round(d.seconds / 60)} min`}>
                  {d.met && d.state !== "today" ? "✓" : d.letter}
                </div>
              ))}
            </div>
            <div className="bk-streak"><strong>{streakText}</strong></div>
            <div className="muted">Your record is {goal.record} {goal.record === 1 ? "day" : "days"}.</div>
          </div>
        </section>

        <section className="card bk-week-card" aria-label="This week">
          <div className="bk-week-head">
            <h2 className="bk-h2" style={{ margin: 0 }}>This week</h2>
            <span className="muted">{Math.round(goal.week_seconds / 60)} min total</span>
          </div>
          <div className="bk-chart" role="img" aria-label="Minutes read each day this week">
            <div className="bk-chart-goal" style={{ bottom: `${(goalS / maxS) * 100}%` }}><span className="muted">{goal.goal_minutes} min goal</span></div>
            {goal.week.map((d) => (
              <div key={d.date} className="bk-chart-col">
                <div className="bk-chart-bar-wrap">
                  <div className={`bk-chart-bar${d.met ? " met" : ""}${d.seconds === 0 ? " zero" : ""}`} style={{ height: `${Math.max(2, (d.seconds / maxS) * 100)}%` }} title={`${Math.round(d.seconds / 60)} min`} />
                </div>
                <span className={`bk-chart-l${d.state === "today" ? " today" : ""}`}>{d.letter}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="bk-stats" aria-label="Reading stats">
        <div className="card bk-stat"><span className="muted">Pages read this week</span><strong>{goal.pages_week}</strong></div>
        <div className="card bk-stat"><span className="muted">Papers · today / week</span><strong>{formatDuration(goal.time_today.papers)} / {formatDuration(goal.time_week.papers)}</strong></div>
        <div className="card bk-stat"><span className="muted">Writing · today / week</span><strong>{formatDuration(goal.time_today.writing)} / {formatDuration(goal.time_week.writing)}</strong></div>
        <div className="card bk-stat"><span className="muted">Highlights saved</span><strong>{goal.highlights_total}</strong></div>
        <div className="card bk-stat"><span className="muted">Books finished this year</span><strong>{goal.finished_this_year}</strong></div>
      </section>
    </div>
  );
}
