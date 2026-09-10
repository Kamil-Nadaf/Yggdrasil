import { useEffect, useState } from "react";
import { api, type ScoreDay } from "../api/client";

export default function ScoresView() {
  const [week, setWeek] = useState<{ days: ScoreDay[]; week_total: number; week_target: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.scores.week().then((w) => { setWeek(w); setLoading(false); });
  }, []);

  if (loading) return <div className="muted">Loading…</div>;
  if (!week) return <div className="crit">Failed to load scores</div>;

  const pct = Math.min(100, Math.round((week.week_total / week.week_target) * 100));

  return (
    <div>
      <h1>Scores</h1>

      {/* Weekly total */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <h2>This Week</h2>
          <span className="mono" style={{ fontSize: 20, color: pct >= 100 ? "var(--ok)" : "var(--accent)" }}>
            {week.week_total} / {week.week_target} pts
          </span>
        </div>
        <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: pct >= 100 ? "var(--ok)" : "var(--accent)",
              borderRadius: 4,
              transition: "width 0.5s ease",
            }}
          />
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{pct}% of weekly target (55 pts)</div>
      </div>

      {/* Day-by-day */}
      <h2 style={{ marginBottom: 8 }}>Daily Breakdown</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginBottom: 20 }}>
        {week.days.map((day) => (
          <DayTile key={day.date} day={day} />
        ))}
      </div>

      {/* Scoring legend */}
      <div className="card">
        <h2>Scoring Rules</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {[
              ["Triage (any verdict)", "1 pt each", "cap 10/day"],
              ["T1 CERIC complete", "5 pts", "all 5 slots filled"],
              ["AQ written", "2 pts", "aq_written = true"],
              ["Concept note updated", "4 pts", "updated: today"],
              ["New concept/question", "5 pts", "created: today"],
              ["T2 reproduced result", "15 pts", "tier = 2"],
              ["Weekly synthesis", "10 pts", "cap 1/week"],
            ].map(([action, pts, note]) => (
              <tr key={action} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 0", color: "var(--text)" }}>{action}</td>
                <td style={{ padding: "6px 8px", color: "var(--accent)", fontFamily: "var(--font-mono)", textAlign: "right" }}>{pts}</td>
                <td style={{ padding: "6px 0 6px 8px", color: "var(--muted)", fontSize: 12 }}>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Weekly target: 55 pts</div>
      </div>
    </div>
  );
}

function DayTile({ day }: { day: ScoreDay }) {
  const d = new Date(day.date);
  const label = d.toLocaleDateString("en", { weekday: "short" });
  const pts = day.points;
  const isToday = day.date === new Date().toISOString().slice(0, 10);

  return (
    <div
      className="card"
      style={{
        textAlign: "center",
        padding: "10px 6px",
        borderColor: isToday ? "var(--accent)" : "var(--border)",
      }}
    >
      <div className="mono muted" style={{ fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div
        className="mono"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: pts >= 10 ? "var(--ok)" : pts >= 5 ? "var(--accent)" : "var(--muted)",
        }}
      >
        {pts}
      </div>
      <div className="muted" style={{ fontSize: 10 }}>pts</div>
    </div>
  );
}
