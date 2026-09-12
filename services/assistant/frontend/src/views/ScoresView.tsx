import { useEffect, useMemo, useState, Fragment, type CSSProperties } from "react";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  type Layout,
} from "react-resizable-panels";
import { api, type ScoreDay, type Task } from "../api/client";
import {
  type HabitDef,
  loadHabitDefs,
  saveHabitDefs,
  habitKeyFromLabel,
} from "../lib/habitDefs";

type RangeMode = "week" | "month" | "year";

const PHD_START_KEY = "yggdrasil:phd-start";
const PHD_END_KEY = "yggdrasil:phd-end";
const DASH_TOP_LAYOUT_KEY = "yggdrasil:dash-top-layout";
const DASH_HEIGHTS_KEY = "yggdrasil:dash-heights";

type DashWidget = "today" | "activity" | "lightcurve" | "rules";

function loadTopLayout(): Layout {
  try {
    const raw = localStorage.getItem(DASH_TOP_LAYOUT_KEY);
    if (!raw) return { week: 65, days: 35 };
    const parsed = JSON.parse(raw) as Layout;
    if (typeof parsed.week === "number" && typeof parsed.days === "number") return parsed;
  } catch {
    /* ignore */
  }
  return { week: 65, days: 35 };
}

function loadHeights(): Partial<Record<DashWidget, number>> {
  try {
    const raw = localStorage.getItem(DASH_HEIGHTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<DashWidget, number>>;
  } catch {
    return {};
  }
}

/** Local calendar YYYY-MM-DD (never UTC via toISOString — that shifts Asia/Shanghai days). */
function isoLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

function rangeFor(mode: RangeMode, anchor: Date): { start: string; end: string; days: string[] } {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const todayLocal = new Date(y, m, anchor.getDate());
  let start: Date;
  let end: Date;
  if (mode === "week") {
    start = startOfWeek(todayLocal);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (mode === "month") {
    start = new Date(y, m, 1);
    end = new Date(y, m + 1, 0); // last day of month
  } else {
    start = new Date(y, 0, 1);
    end = new Date(y, 11, 31);
  }
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(isoLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return { start: isoLocal(start), end: isoLocal(end), days };
}

function daysBetween(startIso: string, endIso: string, todayIso: string): number | null {
  if (!startIso || !endIso) return null;
  const today = parseLocal(todayIso);
  const end = parseLocal(endIso);
  const start = parseLocal(startIso);
  if (Number.isNaN(today.getTime()) || Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) return null;
  const ms = end.getTime() - today.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** SVG lightcurve — daily activity (habits + tasks) vs time */
function Lightcurve({
  days,
  values,
  today,
}: {
  days: string[];
  values: number[];
  today: string;
}) {
  const W = 720;
  const H = 180;
  const pad = { t: 18, r: 16, b: 32, l: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = Math.max(days.length, 1);
  const maxV = Math.max(1, ...values);
  const xAt = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / maxV) * innerH;

  const pts = values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
  const line = pts.length ? `M ${pts.join(" L ")}` : "";
  const area =
    pts.length > 0
      ? `M ${xAt(0).toFixed(1)},${(pad.t + innerH).toFixed(1)} L ${pts.join(" L ")} L ${xAt(n - 1).toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`
      : "";

  const todayIdx = days.indexOf(today);
  const tickIdx =
    n <= 8
      ? days.map((_, i) => i)
      : [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <svg className="lightcurve-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="My lightcurve">
      <line
        className="lightcurve-axis"
        x1={pad.l}
        y1={pad.t + innerH}
        x2={pad.l + innerW}
        y2={pad.t + innerH}
      />
      <line className="lightcurve-axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + innerH} />
      {[0, 0.5, 1].map((f) => {
        const y = yAt(f * maxV);
        return (
          <g key={f}>
            <line className="lightcurve-grid" x1={pad.l} y1={y} x2={pad.l + innerW} y2={y} />
            <text className="lightcurve-tick" x={pad.l - 8} y={y + 3} textAnchor="end">
              {Math.round(f * maxV)}
            </text>
          </g>
        );
      })}
      {area && <path className="lightcurve-area" d={area} />}
      {line && <path className="lightcurve-line" d={line} fill="none" />}
      {values.map((v, i) => (
        <circle
          key={days[i]}
          className={`lightcurve-dot${days[i] === today ? " today" : ""}`}
          cx={xAt(i)}
          cy={yAt(v)}
          r={days[i] === today ? 4 : 2.5}
        >
          <title>{`${days[i]}: ${v}`}</title>
        </circle>
      ))}
      {todayIdx >= 0 && (
        <line
          className="lightcurve-today"
          x1={xAt(todayIdx)}
          y1={pad.t}
          x2={xAt(todayIdx)}
          y2={pad.t + innerH}
        />
      )}
      {tickIdx.map((i) => (
        <text key={days[i]} className="lightcurve-tick" x={xAt(i)} y={H - 10} textAnchor="middle">
          {days[i].slice(5)}
        </text>
      ))}
    </svg>
  );
}

export default function ScoresView() {
  const [week, setWeek] = useState<{ days: ScoreDay[]; week_total: number; week_target: number } | null>(null);
  const [mode, setMode] = useState<RangeMode>("month");
  const [habitDays, setHabitDays] = useState<{ date: string; habits: Record<string, boolean | number> }[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayHabits, setTodayHabits] = useState<Record<string, boolean | number>>({});
  const [habitDefs, setHabitDefs] = useState<HabitDef[]>(() => loadHabitDefs());
  const [customizing, setCustomizing] = useState(false);
  const [newHabitLabel, setNewHabitLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [phdStart, setPhdStart] = useState(() => localStorage.getItem(PHD_START_KEY) || "");
  const [phdEnd, setPhdEnd] = useState(() => localStorage.getItem(PHD_END_KEY) || "");
  const [topLayout, setTopLayout] = useState<Layout>(() => loadTopLayout());
  const [heights, setHeights] = useState<Partial<Record<DashWidget, number>>>(() => loadHeights());

  const today = isoLocal(new Date());
  const range = useMemo(() => rangeFor(mode, new Date()), [mode]);
  const labelOf = useMemo(() => Object.fromEntries(habitDefs.map((h) => [h.key, h.label])), [habitDefs]);
  const remaining = daysBetween(phdStart, phdEnd, today);

  async function reload() {
    const [w, h, t, todayH] = await Promise.all([
      api.scores.week(),
      api.habits.range(range.start, range.end),
      api.tasks.list(),
      api.habits.get(today),
    ]);
    setWeek(w);
    setHabitDays(h.days);
    setTasks(t.tasks);
    const keys = habitDefs.map((d) => d.key);
    const habits = { ...Object.fromEntries(keys.map((k) => [k, false])), ...todayH.habits };
    setTodayHabits(habits);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function patchTodayInHeatmap(habits: Record<string, boolean | number>) {
    setHabitDays((prev) => {
      const found = prev.some((d) => d.date === today);
      if (found) {
        return prev.map((d) => (d.date === today ? { date: today, habits: { ...habits } } : d));
      }
      return [...prev, { date: today, habits: { ...habits } }];
    });
  }

  async function toggleHabit(key: string) {
    const prev = todayHabits;
    const next = { ...prev, [key]: !Boolean(prev[key]) };
    setTodayHabits(next);
    patchTodayInHeatmap(next);
    try {
      const r = await api.habits.set(today, next);
      // Keep only known keys for display; server may merge defaults
      const merged = { ...next, ...r.habits };
      setTodayHabits(merged);
      patchTodayInHeatmap(merged);
      api.scores.week().then(setWeek).catch(() => {});
    } catch {
      setTodayHabits(prev);
      patchTodayInHeatmap(prev);
    }
  }

  function persistDefs(next: HabitDef[]) {
    setHabitDefs(next);
    saveHabitDefs(next);
  }

  async function addHabit() {
    const label = newHabitLabel.trim();
    if (!label) return;
    const key = habitKeyFromLabel(label, habitDefs);
    const nextDefs = [...habitDefs, { key, label }];
    persistDefs(nextDefs);
    setNewHabitLabel("");
    const habits = { ...todayHabits, [key]: false };
    setTodayHabits(habits);
    patchTodayInHeatmap(habits);
    await api.habits.set(today, habits);
  }

  async function removeHabit(key: string) {
    if (!window.confirm(`Remove habit “${labelOf[key] || key}” from Today? Past heatmap data for it stays in vault files.`)) {
      return;
    }
    const nextDefs = habitDefs.filter((h) => h.key !== key);
    persistDefs(nextDefs);
    const { [key]: _removed, ...rest } = todayHabits;
    setTodayHabits(rest);
    patchTodayInHeatmap(rest);
    await api.habits.set(today, rest);
  }

  function savePhdDates(start: string, end: string) {
    setPhdStart(start);
    setPhdEnd(end);
    if (start) localStorage.setItem(PHD_START_KEY, start);
    else localStorage.removeItem(PHD_START_KEY);
    if (end) localStorage.setItem(PHD_END_KEY, end);
    else localStorage.removeItem(PHD_END_KEY);
  }

  function saveTopLayout(layout: Layout) {
    setTopLayout(layout);
    localStorage.setItem(DASH_TOP_LAYOUT_KEY, JSON.stringify(layout));
  }

  function persistWidgetHeight(id: DashWidget, el: HTMLElement | null) {
    if (!el) return;
    const h = Math.round(el.getBoundingClientRect().height);
    if (h < 60) return;
    setHeights((prev) => {
      const next = { ...prev, [id]: h };
      localStorage.setItem(DASH_HEIGHTS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function widgetStyle(id: DashWidget): CSSProperties | undefined {
    const h = heights[id];
    if (!h) return undefined;
    return { height: h, marginBottom: 20 };
  }

  const habitKeys = habitDefs.map((h) => h.key);

  const habitByDate = useMemo(() => {
    const m = new Map<string, Record<string, boolean | number>>();
    habitDays.forEach((d) => m.set(d.date, d.habits || {}));
    m.set(today, { ...(m.get(today) || {}), ...todayHabits });
    return m;
  }, [habitDays, todayHabits, today]);

  const tasksDoneByDate = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => {
      if (t.status === "done" && t.completed_date) {
        m.set(t.completed_date, (m.get(t.completed_date) || 0) + 1);
      }
    });
    return m;
  }, [tasks]);

  /** Daily "flux": habits checked + tasks done — updates live with the heatmap */
  const lightcurveValues = useMemo(() => {
    return range.days.map((d) => {
      const habits = habitByDate.get(d) || {};
      const habitPts = Object.values(habits).filter((v) => Boolean(v)).length;
      const taskPts = tasksDoneByDate.get(d) || 0;
      return habitPts + taskPts;
    });
  }, [range.days, habitByDate, tasksDoneByDate]);

  if (loading && !week) return <div className="muted">Loading…</div>;
  if (!week) return <div className="crit">Failed to load scores</div>;

  const pct = Math.min(100, Math.round((week.week_total / week.week_target) * 100));

  return (
    <div className={`dashboard${customizing ? " is-editing" : ""}`}>
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <button
          type="button"
          className={`btn${customizing ? " btn-primary" : ""}`}
          onClick={() => setCustomizing((v) => !v)}
          aria-pressed={customizing}
        >
          {customizing ? "Done" : "Edit"}
        </button>
      </div>

      <PanelGroup
        id="dash-top"
        orientation="horizontal"
        className="dash-top-row"
        defaultLayout={topLayout}
        disabled={!customizing}
        onLayoutChanged={(layout) => {
          if (customizing) saveTopLayout(layout);
        }}
      >
        <Panel id="week" defaultSize="65" minSize="30" className="dash-panel">
          <div className="card dash-week-card">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>This Week</h2>
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
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{pct}% of weekly target</div>
          </div>
        </Panel>

        <PanelResizeHandle className="dash-resize-handle" disabled={!customizing} />

        <Panel id="days" defaultSize="35" minSize="20" className="dash-panel">
          <div className="card dash-days-card">
            <div className="today-header" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Days Remaining</h2>
            </div>
            {customizing ? (
              <div className="phd-date-edit">
                <label>
                  <span className="muted">PhD start</span>
                  <input type="date" value={phdStart} onChange={(e) => savePhdDates(e.target.value, phdEnd)} />
                </label>
                <label>
                  <span className="muted">PhD end</span>
                  <input type="date" value={phdEnd} onChange={(e) => savePhdDates(phdStart, e.target.value)} />
                </label>
              </div>
            ) : remaining === null ? (
              <div className="muted" style={{ fontSize: 13 }}>
                Click Edit to set PhD start &amp; end.
              </div>
            ) : (
              <>
                <div className="dash-days-count mono" style={{ color: remaining <= 30 ? "var(--crit)" : "var(--text)" }}>
                  {remaining < 0 ? 0 : remaining}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {remaining < 0
                    ? "Past end date"
                    : remaining === 0
                      ? "Last day"
                      : `day${remaining === 1 ? "" : "s"} until ${phdEnd}`}
                </div>
              </>
            )}
          </div>
        </Panel>
      </PanelGroup>

      <div
        className="card dash-widget"
        style={{ marginBottom: 20, ...widgetStyle("today") }}
        onMouseUp={(e) => customizing && persistWidgetHeight("today", e.currentTarget)}
      >
        <div className="today-header">
          <h2 style={{ margin: 0 }}>Today · {today}</h2>
        </div>

        {customizing && (
          <div className="habit-edit-bar">
            <input
              type="text"
              placeholder="New habit name…"
              value={newHabitLabel}
              onChange={(e) => setNewHabitLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addHabit(); }}
            />
            <button className="btn btn-primary" onClick={addHabit} disabled={!newHabitLabel.trim()}>Add</button>
          </div>
        )}

        <div className="habit-checkin">
          {habitDefs.map((h) => (
            <div key={h.key} className={`habit-chip-wrap${todayHabits[h.key] ? " on" : ""}`}>
              <label className={`habit-chip${todayHabits[h.key] ? " on" : ""}`}>
                <input type="checkbox" checked={Boolean(todayHabits[h.key])} onChange={() => toggleHabit(h.key)} />
                {h.label}
              </label>
              {customizing && (
                <button type="button" className="habit-remove" title="Remove habit" onClick={() => removeHabit(h.key)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div
        className="card heatmap-card dash-widget"
        style={{ marginBottom: 20, ...widgetStyle("activity") }}
        onMouseUp={(e) => customizing && persistWidgetHeight("activity", e.currentTarget)}
      >
        <div className="heatmap-toolbar">
          <h2 style={{ margin: 0 }}>Activity</h2>
          <div className="browser-field-tabs">
            {(["week", "month", "year"] as RangeMode[]).map((m) => (
              <button key={m} className={`btn${mode === m ? " btn-primary" : ""}`} onClick={() => setMode(m)}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="heatmap-scroll">
          <div
            className="heatmap-grid"
            style={{
              gridTemplateColumns: `minmax(120px, 148px) repeat(${range.days.length}, 14px)`,
            }}
          >
            <div className="heatmap-corner" />
            {range.days.map((d) => (
              <div
                key={d}
                className={`heatmap-day-label${d === today ? " today" : ""}`}
                title={d}
              >
                {d.slice(8)}
              </div>
            ))}
            {habitKeys.map((key) => (
              <Fragment key={key}>
                <div className="heatmap-row-label">{labelOf[key] || key}</div>
                {range.days.map((d) => {
                  const on = Boolean(habitByDate.get(d)?.[key]);
                  return (
                    <div
                      key={`${key}-${d}`}
                      className={`heatmap-cell${on ? " filled" : ""}${d === today ? " today-col" : ""}`}
                      title={`${labelOf[key] || key} · ${d}`}
                    />
                  );
                })}
              </Fragment>
            ))}
            <div className="heatmap-row-label">Tasks done</div>
            {range.days.map((d) => {
              const n = tasksDoneByDate.get(d) || 0;
              const level = n === 0 ? "" : n >= 4 ? " l3" : n >= 2 ? " l2" : " l1";
              return (
                <div
                  key={`tasks-${d}`}
                  className={`heatmap-cell${n ? ` filled${level}` : ""}${d === today ? " today-col" : ""}`}
                  title={`${n} tasks · ${d}`}
                />
              );
            })}
          </div>
        </div>
        <div className="heatmap-legend muted mono">
          <span>less</span>
          <span className="heatmap-cell" />
          <span className="heatmap-cell filled l1" />
          <span className="heatmap-cell filled l2" />
          <span className="heatmap-cell filled l3" />
          <span>more</span>
        </div>
      </div>

      <div
        className="card lightcurve-card dash-widget"
        style={{ marginBottom: 20, ...widgetStyle("lightcurve") }}
        onMouseUp={(e) => customizing && persistWidgetHeight("lightcurve", e.currentTarget)}
      >
        <div className="heatmap-toolbar">
          <h2 style={{ margin: 0 }}>My Lightcurve</h2>
          <span className="muted mono" style={{ fontSize: 11 }}>
            daily habits + tasks · {mode}
          </span>
        </div>
        <Lightcurve days={range.days} values={lightcurveValues} today={today} />
      </div>

      <div
        className="card dash-widget"
        style={widgetStyle("rules")}
        onMouseUp={(e) => customizing && persistWidgetHeight("rules", e.currentTarget)}
      >
        <h2>Scoring Rules</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            {[
              ["Paper triage verdict", "1 pt each", "cap 10/day"],
              ["T1 CERIC complete", "5 pts", "all 5 slots filled"],
              ["AQ written", "2 pts", "aq_written = true"],
              ["Concept note updated", "4 pts", "updated: today"],
              ["Weekly synthesis", "10 pts", "cap 1/day"],
              ["Task completed", "2 pts each", "cap 15 pts/day"],
              ["Habit checked", "1 pt each", "from Daily-YYYY-MM-DD.md"],
            ].map(([action, pts, note]) => (
              <tr key={action} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 0", color: "var(--text)" }}>{action}</td>
                <td style={{ padding: "6px 8px", color: "var(--accent)", fontFamily: "var(--font-mono)", textAlign: "right" }}>{pts}</td>
                <td style={{ padding: "6px 0 6px 8px", color: "var(--muted)", fontSize: 12 }}>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
