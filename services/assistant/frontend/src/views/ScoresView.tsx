import { useEffect, useMemo, useState, Fragment, type CSSProperties } from "react";
import { api, type ActiveMainTask } from "../api/client";
import {
  type HabitDef,
  loadHabitDefs,
  saveHabitDefs,
  habitKeyFromLabel,
} from "../lib/habitDefs";

type RangeMode = "week" | "month" | "year";

const PHD_START_KEY = "yggdrasil:phd-start";
const PHD_END_KEY = "yggdrasil:phd-end";
const PROGRAM_LABEL_KEY = "yggdrasil:program-label";
const DASH_HEIGHTS_KEY = "yggdrasil:dash-heights";

type DashWidget = "active" | "today" | "activity";

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

/** SVG lightcurve — Habits and Subtasks completed vs time (from the heatmap data, not points). */
function Lightcurve({
  days,
  habits,
  subtasks,
  today,
}: {
  days: string[];
  habits: number[];
  subtasks: number[];
  today: string;
}) {
  const W = 720;
  const H = 180;
  const pad = { t: 18, r: 16, b: 32, l: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = Math.max(days.length, 1);
  const maxV = Math.max(1, ...habits, ...subtasks) * 1.15;
  const xAt = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / maxV) * innerH;

  function pathFor(values: number[]) {
    const pts = values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    const line = pts.length ? `M ${pts.join(" L ")}` : "";
    const area =
      pts.length > 0
        ? `M ${xAt(0).toFixed(1)},${(pad.t + innerH).toFixed(1)} L ${pts.join(" L ")} L ${xAt(n - 1).toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`
        : "";
    return { line, area };
  }

  const hab = pathFor(habits);
  const sub = pathFor(subtasks);
  const todayIdx = days.indexOf(today);
  const tickIdx =
    n <= 8
      ? days.map((_, i) => i)
      : [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <svg className="lightcurve-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Habits and Subtasks lightcurve">
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
      {hab.area && <path className="lightcurve-area habits" d={hab.area} />}
      {sub.area && <path className="lightcurve-area subtasks" d={sub.area} />}
      {hab.line && <path className="lightcurve-line habits" d={hab.line} fill="none" />}
      {sub.line && <path className="lightcurve-line subtasks" d={sub.line} fill="none" />}
      {habits.map((v, i) => (
        <circle
          key={`h-${days[i]}`}
          className={`lightcurve-dot habits${days[i] === today ? " today" : ""}`}
          cx={xAt(i)}
          cy={yAt(v)}
          r={days[i] === today ? 4 : 2.5}
        >
          <title>{`${days[i]} habits: ${v}`}</title>
        </circle>
      ))}
      {subtasks.map((v, i) => (
        <circle
          key={`s-${days[i]}`}
          className={`lightcurve-dot subtasks${days[i] === today ? " today" : ""}`}
          cx={xAt(i)}
          cy={yAt(v)}
          r={days[i] === today ? 3.5 : 2}
        >
          <title>{`${days[i]} subtasks: ${v}`}</title>
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

/** Fill-weight progress bar — no hue, per the e-ink theme constraint. */
function TaskProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="dash-task-bar-track" title={`${pct}%`}>
      <div className="dash-task-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ScoresView({
  onOpenTask,
}: {
  onOpenTask?: (projectSlug: string, mainTaskId: string) => void;
}) {
  const [activeTasks, setActiveTasks] = useState<ActiveMainTask[]>([]);
  const [mode, setMode] = useState<RangeMode>("month");
  const [habitDays, setHabitDays] = useState<{ date: string; habits: Record<string, boolean | number> }[]>([]);
  const [taskCompletionDays, setTaskCompletionDays] = useState<{ date: string; count: number }[]>([]);
  const [todayHabits, setTodayHabits] = useState<Record<string, boolean | number>>({});
  const [habitDefs, setHabitDefs] = useState<HabitDef[]>(() => loadHabitDefs());
  const [customizing, setCustomizing] = useState(false);
  const [newHabitLabel, setNewHabitLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [phdStart, setPhdStart] = useState(() => localStorage.getItem(PHD_START_KEY) || "");
  const [phdEnd, setPhdEnd] = useState(() => localStorage.getItem(PHD_END_KEY) || "");
  const [programLabel, setProgramLabel] = useState(() => localStorage.getItem(PROGRAM_LABEL_KEY) || "");
  const [heights, setHeights] = useState<Partial<Record<DashWidget, number>>>(() => loadHeights());

  const today = isoLocal(new Date());
  const range = useMemo(() => rangeFor(mode, new Date()), [mode]);
  const labelOf = useMemo(() => Object.fromEntries(habitDefs.map((h) => [h.key, h.label])), [habitDefs]);
  const remaining = daysBetween(phdStart, phdEnd, today);

  async function reload() {
    const [active, h, todayH, completed] = await Promise.all([
      api.tasks.activeSummary(),
      api.habits.range(range.start, range.end),
      api.habits.get(today),
      api.tasks.completedByDay(range.start, range.end),
    ]);
    setActiveTasks(active.active);
    setHabitDays(h.days);
    setTaskCompletionDays(completed.days);
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
      const merged = { ...next, ...r.habits };
      setTodayHabits(merged);
      patchTodayInHeatmap(merged);
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

  function saveProgramLabel(label: string) {
    const next = label.trim();
    setProgramLabel(next);
    if (next) localStorage.setItem(PROGRAM_LABEL_KEY, next);
    else localStorage.removeItem(PROGRAM_LABEL_KEY);
  }

  const [exportingDigest, setExportingDigest] = useState(false);

  async function handleExportDigest() {
    setExportingDigest(true);
    try {
      const r = await api.digest("week");
      const blob = new Blob([r.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reading-digest-${r.start}-to-${r.end}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export digest");
    } finally {
      setExportingDigest(false);
    }
  }

  function persistHeight(id: DashWidget, h: number) {
    if (h < 60) return;
    setHeights((prev) => {
      const next = { ...prev, [id]: h };
      localStorage.setItem(DASH_HEIGHTS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function persistWidgetHeight(id: DashWidget, el: HTMLElement | null) {
    if (!el) return;
    persistHeight(id, Math.round(el.getBoundingClientRect().height));
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
    taskCompletionDays.forEach((d) => m.set(d.date, d.count));
    return m;
  }, [taskCompletionDays]);

  const habitCountValues = useMemo(
    () => range.days.map((d) => habitKeys.filter((k) => Boolean(habitByDate.get(d)?.[k])).length),
    [range.days, habitKeys, habitByDate]
  );
  const subtaskCountValues = useMemo(
    () => range.days.map((d) => tasksDoneByDate.get(d) || 0),
    [range.days, tasksDoneByDate]
  );

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <div className={`dashboard${customizing ? " is-editing" : ""}`}>
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn" onClick={handleExportDigest} disabled={exportingDigest}>
            {exportingDigest ? "…" : "Export Digest"}
          </button>
          <button
            type="button"
            className={`btn${customizing ? " btn-primary" : ""}`}
            onClick={() => setCustomizing((v) => !v)}
            aria-pressed={customizing}
          >
            {customizing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      <div
        className="card dash-widget"
        style={{ marginBottom: 20, ...widgetStyle("active") }}
        onMouseUp={(e) => customizing && persistWidgetHeight("active", e.currentTarget)}
      >
        <h2 style={{ margin: "0 0 10px" }}>Active Tasks</h2>
        {activeTasks.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            No active main tasks yet — mark one ★ active in the Tasks section to pin its progress here.
          </div>
        ) : (
          <div className="dash-task-list">
            {activeTasks.map((t) => (
              <button
                type="button"
                key={`${t.project_slug}:${t.main_task_id}`}
                className="dash-task-bar"
                onClick={() => onOpenTask?.(t.project_slug, t.main_task_id)}
              >
                <div className="dash-task-bar-label">
                  <span>{t.project_name} › {t.main_task_name}</span>
                  <span className="muted mono">
                    {t.subtask_done}/{t.subtask_total} subtasks{t.deadline ? ` · due ${t.deadline}` : ""}
                  </span>
                </div>
                <TaskProgressBar done={t.subtask_done} total={t.subtask_total} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="card dash-widget"
        style={{ marginBottom: 20, ...widgetStyle("today") }}
        onMouseUp={(e) => customizing && persistWidgetHeight("today", e.currentTarget)}
      >
        <div className="today-header">
          <h2 style={{ margin: 0 }}>
            Today · {today}
            {remaining !== null && programLabel ? ` · ${remaining < 0 ? 0 : remaining} days left in ${programLabel}` : ""}
          </h2>
        </div>

        {customizing && (
          <>
            <div className="phd-date-edit">
              <label style={{ gridColumn: "1 / -1" }}>
                <span className="muted">Program / role name (optional countdown)</span>
                <input
                  type="text"
                  value={programLabel}
                  placeholder="PhD, Masters, Bachelor, Professor…"
                  onChange={(e) => saveProgramLabel(e.target.value)}
                />
              </label>
              <label>
                <span className="muted">Start</span>
                <input type="date" value={phdStart} onChange={(e) => savePhdDates(e.target.value, phdEnd)} />
              </label>
              <label>
                <span className="muted">End</span>
                <input type="date" value={phdEnd} onChange={(e) => savePhdDates(phdStart, e.target.value)} />
              </label>
            </div>
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
          </>
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
        style={widgetStyle("activity")}
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
            <div className="heatmap-row-label">Subtasks done</div>
            {range.days.map((d) => {
              const n = tasksDoneByDate.get(d) || 0;
              const level = n === 0 ? "" : n >= 4 ? " l3" : n >= 2 ? " l2" : " l1";
              return (
                <div
                  key={`tasks-${d}`}
                  className={`heatmap-cell${n ? ` filled${level}` : ""}${d === today ? " today-col" : ""}`}
                  title={`${n} subtasks · ${d}`}
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

      <div className="card lightcurve-card" style={{ marginTop: 20 }}>
        <div className="heatmap-toolbar">
          <h2 style={{ margin: 0 }}>My Lightcurve</h2>
          <span className="muted mono" style={{ fontSize: 11 }}>
            <span className="lightcurve-legend-dot habits">● Habits</span>
            {"  "}
            <span className="lightcurve-legend-dot subtasks">● Subtasks</span>
            {" · "}
            {mode}
          </span>
        </div>
        <Lightcurve days={range.days} habits={habitCountValues} subtasks={subtaskCountValues} today={today} />
      </div>
    </div>
  );
}
