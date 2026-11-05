import { useEffect, useMemo, useRef, useState, Fragment, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import "./dashboard-resize.css";
import FitContent from "../components/FitContent";
import ReadingGoalsCard from "../components/ReadingGoalsCard";
import { api, type ActiveMainTask, type Goal, type Subtask, type TaskPriorityDef, type TaskStatusDef } from "../api/client";
import StatusPill from "../components/StatusPill";
import { PriorityPill, TimerButton } from "./tasks/TaskBits";
import { useNow } from "./tasks/useTaskData";
import { ensureTaskStatuses, getCachedTaskStatuses, TASK_STATUSES_EVENT } from "../lib/taskStatuses";
import { ensureTaskOptions, getCachedPriorities, TASK_OPTIONS_EVENT } from "../lib/taskOptions";
import {
  type HabitDef,
  loadHabitDefs,
  saveHabitDefs,
  habitKeyFromLabel,
} from "../lib/habitDefs";

const MENTAL_HEALTH_KEY = "mental_health";
type MentalHealthValue = -1 | 0 | 1;

function mentalHealthLabel(v: MentalHealthValue | null | undefined): string {
  if (v === -1) return "Low";
  if (v === 1) return "Good";
  return "Neutral";
}

type RangeMode = "week" | "month" | "year";
const DASH_HEIGHTS_KEY = "yggdrasil:dash-heights";

type DashWidget = "active" | "today" | "activity";

type SlotId = "active" | "progress" | "phd" | "activity" | "charts";
const SLOT_LABEL: Record<SlotId, string> = {
  active: "Active Tasks",
  progress: "Task Progress",
  phd: "Day Timer + Week",
  activity: "Activity",
  charts: "Mental Health + Lightcurve",
};
const DEFAULT_ORDER: SlotId[] = ["active", "progress", "phd", "activity", "charts"];
const DEFAULT_SPANS: Record<SlotId, number> = { active: 5, progress: 4, phd: 3, activity: 7, charts: 5 };
const PINS_KEY = "yggdrasil:progress-pins";
const DASH_LAYOUT_KEY = "yggdrasil:dash-layout-v4";

interface DashLayout {
  order: SlotId[];
  spans: Record<SlotId, number>;
  /** Explicit card heights in px (set by dragging the bottom edge in layout-edit mode). Absent = auto. */
  heights: Partial<Record<SlotId, number>>;
  /** "Fit to screen": card heights are computed from the window height and follow it when it changes. */
  fit?: boolean;
  hidden: SlotId[];
}

function loadLayout(): DashLayout {
  const base: DashLayout = { order: [...DEFAULT_ORDER], spans: { ...DEFAULT_SPANS }, heights: {}, hidden: [] };
  try {
    const p = JSON.parse(localStorage.getItem(DASH_LAYOUT_KEY) || "{}") as Partial<DashLayout>;
    if (Array.isArray(p.order)) {
      const known = p.order.filter((id): id is SlotId => DEFAULT_ORDER.includes(id as SlotId));
      base.order = [...known, ...DEFAULT_ORDER.filter((id) => !known.includes(id))];
    }
    if (p.spans) for (const id of DEFAULT_ORDER) {
      const v = Number((p.spans as Record<string, number>)[id]);
      if (v >= 2 && v <= 12) base.spans[id] = Math.round(v);
    }
    if (p.heights && typeof p.heights === "object") for (const id of DEFAULT_ORDER) {
      const v = Number((p.heights as Record<string, number>)[id]);
      if (v >= 80 && v <= 2400) base.heights[id] = Math.round(v);
    }
    if (p.fit === true) base.fit = true;
    if (Array.isArray(p.hidden)) base.hidden = p.hidden.filter((id): id is SlotId => DEFAULT_ORDER.includes(id as SlotId));
  } catch {
    /* defaults */
  }
  return base;
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

/** Monotone cubic through the points (no overshoot): returns the "C …" segments that follow an initial "M x0,y0". */
function smoothSegs(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return "";
  const dx: number[] = [];
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    sl.push(dx[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = new Array(n).fill(0);
  t[0] = sl[0];
  t[n - 1] = sl[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / sl[i];
    const b = t[i + 1] / sl[i];
    const sq = a * a + b * b;
    if (sq > 9) {
      const tau = 3 / Math.sqrt(sq);
      t[i] = tau * a * sl[i];
      t[i + 1] = tau * b * sl[i];
    }
  }
  const f = (v: number) => v.toFixed(1);
  let d = "";
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${f(pts[i][0] + h)},${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
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
  const top = Math.max(1, Math.ceil(Math.max(...habits, ...subtasks, 1)));
  const maxV = top * 1.1;
  const yTicks = top <= 3 ? Array.from({ length: top + 1 }, (_, i) => i) : [0, Math.round(top / 2), top];
  const xAt = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / maxV) * innerH;

  function pathFor(values: number[]) {
    const pts = values.map((v, i) => [xAt(i), yAt(v)] as [number, number]);
    if (pts.length === 0) return { line: "", area: "" };
    const base = (pad.t + innerH).toFixed(1);
    const head = `${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    const segs = smoothSegs(pts);
    return {
      line: `M ${head}${segs}`,
      area: `M ${pts[0][0].toFixed(1)},${base} L ${head}${segs} L ${pts[pts.length - 1][0].toFixed(1)},${base} Z`,
    };
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
      {yTicks.map((v) => {
        const y = yAt(v);
        return (
          <g key={v}>
            <line className="lightcurve-grid" x1={pad.l} y1={y} x2={pad.l + innerW} y2={y} />
            <text className="lightcurve-tick" x={pad.l - 8} y={y + 3} textAnchor="end">
              {v}
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
          r={days[i] === today ? 4 : 1.8}
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

/** Mental Health wave — a smooth curve through the days you recorded (Bad −1 · Fine 0 · Good +1). */
function MentalHealthChart({
  days,
  values,
  today,
}: {
  days: string[];
  values: (number | null)[];
  today: string;
}) {
  const W = 720;
  const H = 120;
  const pad = { t: 18, r: 16, b: 32, l: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const n = Math.max(days.length, 1);
  const xAt = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - ((v + 1) / 2) * innerH; // map -1..+1

  const recorded: [number, number][] = [];
  values.forEach((v, i) => { if (v !== null && v !== undefined) recorded.push([xAt(i), yAt(v)]); });
  const pathD = recorded.length >= 2 ? `M ${recorded[0][0].toFixed(1)},${recorded[0][1].toFixed(1)}${smoothSegs(recorded)}` : "";

  const todayIdx = days.indexOf(today);
  const tickIdx =
    n <= 8
      ? days.map((_, i) => i)
      : [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <svg className="lightcurve-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mental Health trend">
      {/* axes */}
      <line
        className="lightcurve-axis"
        x1={pad.l}
        y1={pad.t + innerH}
        x2={pad.l + innerW}
        y2={pad.t + innerH}
      />
      <line className="lightcurve-axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + innerH} />
      {/* gridlines at -1, 0, +1 */}
      {[-1, 0, 1].map((v) => {
        const y = yAt(v);
        return (
          <g key={v}>
            <line className="lightcurve-grid" x1={pad.l} y1={y} x2={pad.l + innerW} y2={y} />
            <text className="lightcurve-tick" x={pad.l - 8} y={y + 3} textAnchor="end">
              {v === 1 ? "+1" : String(v)}
            </text>
          </g>
        );
      })}
      {/* line */}
      {pathD && <path className="lightcurve-line mental-health" d={pathD} fill="none" />}
      {/* dots */}
      {values.map((v, i) =>
        v === null || v === undefined ? null : (
          <circle
            key={`mh-${days[i]}`}
            className={`lightcurve-dot mental-health${days[i] === today ? " today" : ""}`}
            cx={xAt(i)}
            cy={yAt(v)}
            r={days[i] === today ? 4 : 2.5}
          >
            <title>{`${days[i]} · ${mentalHealthLabel(v as MentalHealthValue)}`}</title>
          </circle>
        )
      )}
      {/* today vertical */}
      {todayIdx >= 0 && (
        <line
          className="lightcurve-today"
          x1={xAt(todayIdx)}
          y1={pad.t}
          x2={xAt(todayIdx)}
          y2={pad.t + innerH}
        />
      )}
      {/* x ticks */}
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

/** Segmented progress ring: 12 arcs, filled ones fade from dark to light around the ring. */
function ProgressRing({ pct, size = 72, stroke = 7 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const N = 12;
  const gap = 7;
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = clamped > 0 ? Math.max(1, Math.round((clamped / 100) * N)) : 0;
  const pt = (deg: number): [number, number] => [c + r * Math.cos((deg * Math.PI) / 180), c + r * Math.sin((deg * Math.PI) / 180)];
  return (
    <div className="progress-ring-wrap" style={{ width: size, height: size }} title={`${clamped}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {Array.from({ length: N }, (_, i) => {
          const a0 = -90 + i * (360 / N) + gap / 2;
          const a1 = a0 + 360 / N - gap;
          const [x0, y0] = pt(a0);
          const [x1, y1] = pt(a1);
          const on = i < filled;
          return (
            <path
              key={i}
              className={`ring-seg${on ? " on" : ""}`}
              d={`M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`}
              fill="none"
              strokeWidth={stroke}
              style={on ? { opacity: 1 - 0.6 * (i / Math.max(filled, 1)) } : undefined}
            />
          );
        })}
      </svg>
      <div className="progress-ring-center">{clamped}%</div>
    </div>
  );
}

const isSubDone = (st: Subtask) => st.done || st.status_id === "done";

/** One dot per subtask — click a dot to tick it off (or undo it). The first open one is highlighted. */
function SubtaskStepper({ subs, onToggle }: { subs: Subtask[]; onToggle: (st: Subtask) => void }) {
  if (subs.length === 0) {
    return <div className="muted" style={{ fontSize: 12, padding: "4px 2px" }}>No subtasks yet — add some in Tasks.</div>;
  }
  const firstOpen = subs.findIndex((x) => !isSubDone(x));
  return (
    <div className="stepper sub-stepper">
      {subs.map((st, i) => {
        const d = isSubDone(st);
        const state = d ? "done" : i === firstOpen ? "cur" : "todo";
        return (
          <Fragment key={st.id}>
            <button type="button" className={`step ${state}`} onClick={() => onToggle(st)} title={`${st.name}${st.deadline ? ` · due ${st.deadline}` : ""} — click to ${d ? "undo" : "mark done"}`}>
              <span className="step-node">{d ? "✓" : state === "cur" ? <i /> : null}</span>
              <span className="step-lab">{st.name}</span>
              {st.deadline && <span className="step-due mono">{st.deadline.slice(5)}</span>}
            </button>
            {i < subs.length - 1 && <div className={`step-line${d ? " on" : ""}`} />}
          </Fragment>
        );
      })}
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] || "th";
}

/** Rotary day timer: a thin arc whose current position always sits at 3 o'clock, faded
 * tilted year/month numerals around it, and one big number — days left. */
function PhdDial({ dayNum, totalDays, daysLeft, compact = false }: { dayNum: number; totalDays: number; daysLeft: number | null; compact?: boolean }) {
  const cx = compact ? -12 : -70, cy = compact ? 72 : 150, R = compact ? 68 : 140;
  const yearly = totalDays > 730;
  const unitDays = yearly ? 365.25 : 30.44;
  const degPer = yearly ? 35 : 22;
  const units = Math.max(1, Math.min(60, Math.round(totalDays / unitDays)));
  const f = totalDays > 0 ? Math.max(0, Math.min(1, dayNum / totalDays)) : 0;
  const span = units * degPer;
  const theta = (t: number) => (t - f) * span;
  const at = (deg: number, rad: number): [number, number] => [cx + rad * Math.cos((deg * Math.PI) / 180), cy + rad * Math.sin((deg * Math.PI) / 180)];
  const VIS = 78;
  const [ax, ay] = at(-VIS, R);
  const [bx, by] = at(VIS, R);
  const label = daysLeft === null ? "—" : daysLeft < 0 ? "0" : String(daysLeft);
  return (
    <div className={`phd-dial${compact ? " compact" : ""}`} title={`Day ${dayNum} of ${totalDays}`}>
      <svg viewBox={compact ? "0 0 330 144" : "0 0 300 300"} width="100%" aria-hidden="true">
        <path className="phd-dial-track" d={`M ${ax} ${ay} A ${R} ${R} 0 0 1 ${bx} ${by}`} fill="none" strokeWidth="1.5" />
        {Array.from({ length: units + 1 }, (_, i) => {
          const d = theta(i / units);
          if (Math.abs(d) > VIS || Math.abs(d) < 3) return null;
          const [x, y] = at(d, R);
          return <circle key={`t${i}`} className="phd-dial-tick" cx={x} cy={y} r="3" />;
        })}
        {Array.from({ length: units }, (_, i) => {
          const d = theta((i + 0.5) / units);
          if (Math.abs(d) > VIS + 6) return null;
          const [x, y] = at(d, R + (compact ? 17 : 34));
          return (
            <text key={`n${i}`} className="phd-dial-num" x={x} y={y} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${d} ${x} ${y})`}>
              {String(i + 1).padStart(2, "0")}
            </text>
          );
        })}
        <circle className="phd-dial-dot" cx={cx + R} cy={cy} r={compact ? 4 : 5} />
        <text className="phd-dial-left" x={cx + R + 22} y={compact ? cy + 12 : cy + 20}>
          {dayNum}
          <tspan className="phd-dial-suf">{ordinal(dayNum)} Day</tspan>
        </text>
        <text className="phd-dial-cap" x={cx + R + 24} y={compact ? cy + 34 : cy + 48}>{label} days remaining</text>
        <text className="phd-dial-of" x={cx + R + 24} y={compact ? cy + 50 : cy + 66}>of {totalDays} days</text>
      </svg>
    </div>
  );
}

function goalStats(goal: Goal, today: string) {
  const start = parseLocal(goal.start_date).getTime();
  const end = parseLocal(goal.end_date).getTime();
  const now = parseLocal(today).getTime();
  const total = end - start;
  const elapsed = Math.max(0, Math.min(total, now - start));
  const dayMs = 86400000;
  const totalDays = Math.max(1, Math.round(total / dayMs));
  return {
    pct: total > 0 ? Math.round((elapsed / total) * 100) : 0,
    totalDays,
    dayNum: Math.max(1, Math.min(totalDays, Math.floor(elapsed / dayMs) + 1)),
    daysLeft: daysBetween(goal.start_date, goal.end_date, today),
  };
}

/** A long-term goal as a ring tile inside Task Progress (elapsed share of its date range). */
function GoalRing({
  goal,
  today,
  onUpdate,
  onDelete,
}: {
  goal: Goal;
  today: string;
  onUpdate: (id: string, patch: { name: string; start_date: string; end_date: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(goal.name);
  const [start, setStart] = useState(goal.start_date);
  const [end, setEnd] = useState(goal.end_date);
  const st = goalStats(goal, today);
  if (editing) {
    return (
      <div className="goal-add-form tp-item">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="muted" style={{ fontSize: 11 }}>Start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="muted" style={{ fontSize: 11 }}>End<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <div className="goal-add-form-actions">
          <button type="button" className="btn btn-primary" disabled={!name.trim() || !start || !end}
            onClick={() => { onUpdate(goal.id, { name: name.trim(), start_date: start, end_date: end }); setEditing(false); }}>Save</button>
          <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="tp-item tp-goal">
      <div className="tp-goal-actions">
        <button type="button" title="Edit goal" onClick={() => { setName(goal.name); setStart(goal.start_date); setEnd(goal.end_date); setEditing(true); }}>✎</button>
        <button type="button" title="Remove goal" onClick={() => onDelete(goal.id)}>×</button>
      </div>
      <ProgressRing pct={st.pct} size={96} stroke={13} />
      <div className="tp-cap" title={goal.name}>{goal.name}</div>
      <div className="tp-sub muted mono">
        {st.daysLeft === null ? "—" : st.daysLeft < 0 ? "ended" : `${st.daysLeft}d left`}
      </div>
    </div>
  );
}

/** A single long-running goal countdown card — name, days left, elapsed/total progress bar. */
function GoalCard({
  goal,
  today,
  onUpdate,
  onDelete,
}: {
  goal: Goal;
  today: string;
  onUpdate: (id: string, patch: { name: string; start_date: string; end_date: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(goal.name);
  const [editStart, setEditStart] = useState(goal.start_date);
  const [editEnd, setEditEnd] = useState(goal.end_date);

  const daysLeft = daysBetween(goal.start_date, goal.end_date, today);
  const start = parseLocal(goal.start_date).getTime();
  const end = parseLocal(goal.end_date).getTime();
  const now = parseLocal(today).getTime();
  const total = end - start;
  const elapsed = Math.max(0, Math.min(total, now - start));
  const dayMs = 86400000;
  const totalDays = Math.max(1, Math.round(total / dayMs));
  const dayNum = Math.max(1, Math.min(totalDays, Math.floor(elapsed / dayMs) + 1));

  function startEditing() {
    setEditName(goal.name);
    setEditStart(goal.start_date);
    setEditEnd(goal.end_date);
    setEditing(true);
  }

  function save() {
    const name = editName.trim();
    if (!name || !editStart || !editEnd) return;
    onUpdate(goal.id, { name, start_date: editStart, end_date: editEnd });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="goal-add-form">
        <input type="text" placeholder="Goal name (e.g. PhD)" value={editName} onChange={(e) => setEditName(e.target.value)} />
        <label className="muted" style={{ fontSize: 11 }}>
          Start
          <input type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
        </label>
        <label className="muted" style={{ fontSize: 11 }}>
          End
          <input type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
        </label>
        <div className="goal-add-form-actions">
          <button type="button" className="btn btn-primary" onClick={save} disabled={!editName.trim() || !editStart || !editEnd}>
            Save
          </button>
          <button type="button" className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="goal-timer">
      <div className="goal-card-actions">
        <button type="button" className="goal-card-edit" title="Edit goal" onClick={startEditing}>
          ✎
        </button>
        <button type="button" className="goal-card-remove" title="Remove goal" onClick={() => onDelete(goal.id)}>
          ×
        </button>
      </div>
      <div className="week-progress-title goal-card-name">{goal.name} Remaining Day Timer</div>
      <PhdDial compact dayNum={dayNum} totalDays={totalDays} daysLeft={daysLeft} />
    </div>
  );
}

export default function ScoresView({
  onOpenTask,
  onOpenBooks,
}: {
  onOpenTask?: (projectSlug: string, mainTaskId: string) => void;
  onOpenBooks?: () => void;
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
  const [layout, setLayout] = useState<DashLayout>(() => loadLayout());
  const [drag, setDrag] = useState<{ id: SlotId; span: number; height?: number } | null>(null);
  const [viewport, setViewport] = useState(() => ({ h: window.innerHeight, top: 150 }));
  const gridRef = useRef<HTMLDivElement>(null);
  const [subtasksByMain, setSubtasksByMain] = useState<Record<string, Subtask[]>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<string>(() => isoLocal(new Date()));
  const [addingHabit, setAddingHabit] = useState(false);
  const [editingHabits, setEditingHabits] = useState(false);
  const [allTasks, setAllTasks] = useState<(ActiveMainTask & { active: boolean })[]>([]);
  const [taskStatuses, setTaskStatuses] = useState<TaskStatusDef[]>(() => getCachedTaskStatuses());
  const [taskPriorities, setTaskPriorities] = useState<TaskPriorityDef[]>(() => getCachedPriorities());
  const timerNow = useNow(allTasks.some((t) => t.active && t.timer_started_at));
  useEffect(() => {
    void ensureTaskStatuses(() => api.taskStatuses.get()).then(setTaskStatuses);
    void ensureTaskOptions().then(() => setTaskPriorities(getCachedPriorities()));
    const onS = () => setTaskStatuses(getCachedTaskStatuses());
    const onO = () => setTaskPriorities(getCachedPriorities());
    window.addEventListener(TASK_STATUSES_EVENT, onS);
    window.addEventListener(TASK_OPTIONS_EVENT, onO);
    return () => {
      window.removeEventListener(TASK_STATUSES_EVENT, onS);
      window.removeEventListener(TASK_OPTIONS_EVENT, onO);
    };
  }, []);
  const [heights, setHeights] = useState<Partial<Record<DashWidget, number>>>(() => loadHeights());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [addingGoal, setAddingGoal] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalStart, setGoalStart] = useState("");
  const [goalEnd, setGoalEnd] = useState("");
  const [pins, setPins] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(PINS_KEY) || "[]") as string[]; } catch { return []; }
  });
  const [pinChoice, setPinChoice] = useState("");
  function savePins(next: string[]) {
    setPins(next);
    try { localStorage.setItem(PINS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const today = isoLocal(new Date());
  const range = useMemo(() => rangeFor(mode, new Date()), [mode]);
  const labelOf = useMemo(() => Object.fromEntries(habitDefs.map((h) => [h.key, h.label])), [habitDefs]);
  const weekProgress = useMemo(() => {
    const dow = (new Date().getDay() + 6) % 7; // 0=Mon .. 6=Sun
    const pct = Math.round(((dow + 1) / 7) * 100);
    const daysLeft = 6 - dow;
    return { pct, daysLeft };
  }, [today]);
  const primaryGoal = goals[0];
  const otherGoals = goals.slice(1);

  async function reload() {
    const [active, h, todayH, completed] = await Promise.all([
      api.tasks.activeSummary(),
      api.habits.range(range.start, range.end),
      api.habits.get(today),
      api.tasks.completedByDay(range.start, range.end),
    ]);
    setActiveTasks(active.active);
    try {
      const activeIds = new Set(active.active.map((t) => `${t.project_slug}:${t.main_task_id}`));
      const { projects } = await api.taskProjects.list();
      const lists = await Promise.all(
        projects.map((pr) =>
          api.mainTasks
            .list(pr.slug)
            .then((r) =>
              r.main_tasks.map((m) => ({
                project_slug: pr.slug,
                project_name: pr.name,
                main_task_id: m.id,
                main_task_name: m.name,
                deadline: m.deadline,
                subtask_done: m.subtask_done,
                subtask_total: m.subtask_total,
                status_id: m.status_id,
                priority_id: m.priority_id,
                estimate_min: m.estimate_min,
                tracked_sec: m.tracked_sec,
                timer_started_at: m.timer_started_at,
                active: activeIds.has(`${pr.slug}:${m.id}`) || m.is_active,
              }))
            )
            .catch(() => [])
        )
      );
      const flat = lists
        .flat()
        .sort((a, b) => Number(b.active) - Number(a.active) || (a.deadline || "9999").localeCompare(b.deadline || "9999"));
      setAllTasks(flat);
      const subs = await Promise.all(
        flat.map((t) =>
          api.subtasks
            .list(t.project_slug, t.main_task_id)
            .then((r) => [`${t.project_slug}:${t.main_task_id}`, r.subtasks] as const)
            .catch(() => [`${t.project_slug}:${t.main_task_id}`, [] as Subtask[]] as const)
        )
      );
      setSubtasksByMain(Object.fromEntries(subs));
    } catch {
      setAllTasks(active.active.map((t) => ({ ...t, active: true })));
    }
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

  useEffect(() => {
    api.goals.list().then((r) => setGoals(r.goals));
  }, []);

  async function submitGoal() {
    const name = goalName.trim();
    if (!name || !goalStart || !goalEnd) return;
    const r = await api.goals.add({ name, start_date: goalStart, end_date: goalEnd });
    setGoals(r.goals);
    setGoalName("");
    setGoalStart("");
    setGoalEnd("");
    setAddingGoal(false);
  }

  async function deleteGoal(id: string) {
    const r = await api.goals.remove(id);
    setGoals(r.goals);
  }

  async function updateGoal(id: string, patch: { name: string; start_date: string; end_date: string }) {
    const r = await api.goals.update(id, patch);
    setGoals(r.goals);
  }

  function patchTodayInHeatmap(habits: Record<string, boolean | number>) {
    setHabitDays((prev) => {
      const found = prev.some((d) => d.date === today);
      if (found) {
        return prev.map((d) => (d.date === today ? { date: today, habits: { ...habits } } : d));
      }
      return [...prev, { date: today, habits: { ...habits } }];
    });
  }

  async function toggleHabit(key: string, explicitValue?: number) {
    const prev = todayHabits;
    let next: Record<string, boolean | number>;
    if (key === MENTAL_HEALTH_KEY && explicitValue !== undefined) {
      next = { ...prev, [key]: explicitValue };
    } else {
      next = { ...prev, [key]: !Boolean(prev[key]) };
    }
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
    setAddingHabit(false);
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
    void id;
    return undefined;
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

  const mentalHealthValues = useMemo(() => {
    return range.days.map((d) => {
      const raw = habitByDate.get(d)?.[MENTAL_HEALTH_KEY] as unknown as string | number | boolean | undefined;
      if (typeof raw === "number") return raw;
      if (raw === "-1") return -1;
      if (raw === "1") return 1;
      if (raw === "0") return 0;
      return null;
    });
  }, [habitByDate, range.days]);

  async function quickPatch(t: ActiveMainTask & { active: boolean }, body: Record<string, unknown>) {
    setAllTasks((prev) =>
      prev.map((x) => (x.project_slug === t.project_slug && x.main_task_id === t.main_task_id ? { ...x, ...body } : x))
    );
    try {
      await api.taskItems.update(t.project_slug, t.main_task_id, body);
      api.tasks.completedByDay(range.start, range.end).then((r) => setTaskCompletionDays(r.days)).catch(() => undefined);
    } finally {
      void reload();
    }
  }

  async function quickTimer(t: ActiveMainTask & { active: boolean }) {
    try {
      await api.taskItems.timer(t.project_slug, t.main_task_id, t.timer_started_at ? "stop" : "start");
    } finally {
      void reload();
    }
  }

  async function toggleSubtask(t: ActiveMainTask & { active: boolean }, st: Subtask) {
    const key = `${t.project_slug}:${t.main_task_id}`;
    const nowDone = !isSubDone(st);
    const status_id = nowDone ? "done" : "todo";
    setSubtasksByMain((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((x) => (x.id === st.id ? { ...x, status_id, done: nowDone } : x)),
    }));
    setAllTasks((prev) =>
      prev.map((x) =>
        x.project_slug === t.project_slug && x.main_task_id === t.main_task_id
          ? { ...x, subtask_done: Math.max(0, Math.min(x.subtask_total, x.subtask_done + (nowDone ? 1 : -1))) }
          : x
      )
    );
    try {
      await api.subtasks.update(t.project_slug, t.main_task_id, st.id, { status_id });
      api.tasks.completedByDay(range.start, range.end).then((r) => setTaskCompletionDays(r.days)).catch(() => undefined);
    } catch {
      reload();
    }
  }

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  const mhNum = (raw: unknown): number | null => {
    if (typeof raw === "number") return raw;
    if (raw === "-1" || raw === "0" || raw === "1") return Number(raw);
    return null;
  };

  /** Click a heatmap box: toggle that habit on that day (Mental health cycles Low → Neutral → Good → off). */
  async function toggleCell(date: string, key: string) {
    const cur = { ...(habitByDate.get(date) || {}) } as Record<string, boolean | number>;
    let next: Record<string, boolean | number>;
    if (key === MENTAL_HEALTH_KEY) {
      const v = mhNum(cur[key]);
      next = { ...cur, [key]: v === null ? -1 : v === -1 ? 0 : v === 0 ? 1 : false };
    } else {
      next = { ...cur, [key]: !Boolean(cur[key]) };
    }
    setSelectedDay(date);
    setHabitDays((prev) =>
      prev.some((d) => d.date === date)
        ? prev.map((d) => (d.date === date ? { date, habits: next } : d))
        : [...prev, { date, habits: next }]
    );
    if (date === today) setTodayHabits(next);
    try {
      await api.habits.set(date, next);
    } catch {
      reload();
    }
  }

  /** Set (or, tapping the same one again, clear) the mood for a day: Good +1 · Fine 0 · Bad −1. */
  async function setMood(date: string, value: MentalHealthValue) {
    const cur = { ...(habitByDate.get(date) || {}) } as Record<string, boolean | number>;
    const next = { ...cur, [MENTAL_HEALTH_KEY]: mhNum(cur[MENTAL_HEALTH_KEY]) === value ? false : value };
    setHabitDays((prev) =>
      prev.some((d) => d.date === date)
        ? prev.map((d) => (d.date === date ? { date, habits: next } : d))
        : [...prev, { date, habits: next }]
    );
    if (date === today) setTodayHabits(next);
    try {
      await api.habits.set(date, next);
    } catch {
      reload();
    }
  }

  function renameHabit(key: string, label: string) {
    const l = label.trim();
    if (!l || l === labelOf[key]) return;
    persistDefs(habitDefs.map((h) => (h.key === key ? { ...h, label: l } : h)));
  }

  function moveHabit(key: string, dir: -1 | 1) {
    const i = habitDefs.findIndex((h) => h.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= habitDefs.length) return;
    const next = [...habitDefs];
    [next[i], next[j]] = [next[j], next[i]];
    persistDefs(next);
  }

  // Fit-to-screen: split the visible window height between the grid rows (rows follow the 12-column flow).
  const fitHeights = useMemo(() => {
    const out: Partial<Record<SlotId, number>> = {};
    const ids = layout.order.filter((id) => !layout.hidden.includes(id));
    const rows: SlotId[][] = [];
    let used = 12;
    for (const id of ids) {
      if (used + layout.spans[id] > 12) { rows.push([]); used = 0; }
      rows[rows.length - 1].push(id);
      used += layout.spans[id];
    }
    if (rows.length === 0) return out;
    const gap = 20;
    const avail = viewport.h - viewport.top - 28;
    const rowH = Math.max(190, Math.floor((avail - gap * (rows.length - 1)) / rows.length));
    rows.forEach((r) => r.forEach((id) => { out[id] = rowH; }));
    return out;
  }, [layout.order, layout.hidden, layout.spans, viewport]);
  const heightOf = (id: SlotId): number | undefined => (layout.fit ? fitHeights[id] : layout.heights[id]);

  useEffect(() => {
    const measure = () => {
      const top = gridRef.current ? gridRef.current.getBoundingClientRect().top + window.scrollY : 150;
      setViewport((v) => (v.h === window.innerHeight && Math.abs(v.top - top) < 1 ? v : { h: window.innerHeight, top }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [customizing]);

  function toggleFit() {
    if (layout.fit) commitLayout({ ...layout, fit: false, heights: {} });
    else commitLayout({ order: layout.order, spans: { ...DEFAULT_SPANS }, heights: {}, hidden: layout.hidden, fit: true });
  }

  function commitLayout(next: DashLayout) {
    setLayout(next);
    try {
      localStorage.setItem(DASH_LAYOUT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  function moveSlot(id: SlotId, dir: -1 | 1) {
    const vis = layout.order.filter((x) => !layout.hidden.includes(x));
    const i = vis.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    const order = [...layout.order];
    const a = order.indexOf(vis[i]);
    const b = order.indexOf(vis[j]);
    [order[a], order[b]] = [order[b], order[a]];
    commitLayout({ ...layout, order });
  }
  function resizeSlot(id: SlotId, delta: number) {
    commitLayout({ ...layout, fit: false, heights: layout.fit ? { ...fitHeights } : layout.heights, spans: { ...layout.spans, [id]: Math.max(2, Math.min(12, layout.spans[id] + delta)) } });
  }
  /** Drag a card's right edge (width, snaps to the 12-column grid), bottom edge (height) or corner (both). */
  function startResize(e: ReactPointerEvent<HTMLElement>, id: SlotId, axis: "w" | "h" | "wh") {
    e.preventDefault();
    e.stopPropagation();
    const slot = e.currentTarget.closest(".dash-slot") as HTMLElement | null;
    const grid = slot?.parentElement as HTMLElement | null;
    if (!slot || !grid) return;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 20;
    const colW = (grid.getBoundingClientRect().width - gap * 11) / 12 + gap;
    const rect = slot.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    const span0 = layout.spans[id];
    let last = { span: span0, height: heightOf(id) };
    const target = e.currentTarget;
    target.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      const span = axis === "h" ? span0 : Math.max(2, Math.min(12, Math.round((rect.width + (ev.clientX - x0) + gap) / colW)));
      const height = axis === "w" ? last.height : Math.max(100, Math.min(2400, Math.round(rect.height + (ev.clientY - y0))));
      last = { span, height };
      setDrag({ id, span, height });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDrag(null);
      const heights = { ...(layout.fit ? fitHeights : layout.heights) };
      if (last.height) heights[id] = last.height;
      commitLayout({ ...layout, fit: false, spans: { ...layout.spans, [id]: last.span }, heights });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }
  function autoHeight(id: SlotId) {
    const heights = { ...(layout.fit ? fitHeights : layout.heights) };
    delete heights[id];
    commitLayout({ ...layout, fit: false, heights });
  }
  function hideSlot(id: SlotId) {
    commitLayout({ ...layout, hidden: [...layout.hidden, id] });
  }
  function showSlot(id: SlotId) {
    commitLayout({ ...layout, hidden: layout.hidden.filter((x) => x !== id) });
  }

  if (loading) return <div className="muted">Loading…</div>;

  const weekItem = {
    key: "week",
    label: "This week",
    sub: weekProgress.daysLeft <= 0 ? "last day" : `${weekProgress.daysLeft}d left`,
    pct: weekProgress.pct,
  };
  const pinCatalog = [
    weekItem,
    ...allTasks.map((t) => ({
      key: `${t.project_slug}:${t.main_task_id}`,
      label: `${t.project_name} › ${t.main_task_name}`,
      sub: `${t.subtask_done}/${t.subtask_total}`,
      pct: t.subtask_total > 0 ? Math.round((t.subtask_done / t.subtask_total) * 100) : 0,
    })),
  ];
  const pinnedItems = pins.map((k) => pinCatalog.find((c) => c.key === k)).filter((x): x is (typeof pinCatalog)[number] => !!x);
  const pinOptions = pinCatalog.filter((c) => !pins.includes(c.key));
  const widgets: Record<SlotId, ReactNode> = {
    active: (
      <div
        className="card dash-widget active-tasks-card"
        style={widgetStyle("active")}
        onMouseUp={(e) => customizing && persistWidgetHeight("active", e.currentTarget)}
      >
        <h2 style={{ margin: "0 0 10px" }}>Active Tasks</h2>
        {allTasks.filter((t) => t.active).length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            No starred tasks — star a main task in the Tasks section to show it here.
          </div>
        ) : (
          <div className="dash-task-list">
            {allTasks.filter((t) => t.active).map((t) => {
              const key = `${t.project_slug}:${t.main_task_id}`;
              const subs = subtasksByMain[key] || [];
              const open = !collapsed.has(key);
              return (
                <div key={key} className="dash-task-bar dash-task-main">
                  <div className="dash-task-bar-label">
                    <button type="button" className="dash-task-toggle" onClick={() => toggleCollapsed(key)} aria-expanded={open}>
                      {open ? "▾" : "▸"} ★ {t.project_name} › {t.main_task_name}
                    </button>
                    <span className="muted mono">
                      {subs.length ? subs.filter(isSubDone).length : t.subtask_done}/{subs.length || t.subtask_total}{t.deadline ? ` · due ${t.deadline}` : ""}
                    </span>
                    <button type="button" className="dash-task-open" title="Open in Tasks" onClick={() => onOpenTask?.(t.project_slug, t.main_task_id)}>↗</button>
                  </div>
                  <div className="dash-task-quick">
                    <StatusPill statuses={taskStatuses} statusId={t.status_id} onChange={(sid) => void quickPatch(t, { status_id: sid })} />
                    <PriorityPill priorities={taskPriorities} value={t.priority_id} onChange={(pid) => void quickPatch(t, { priority_id: pid })} />
                    <TimerButton item={t} now={timerNow} onToggle={() => void quickTimer(t)} />
                  </div>
                  {open && <SubtaskStepper subs={subs} onToggle={(st) => toggleSubtask(t, st)} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    ),
    phd: (
      <div className="phd-stack">
        <div className="card dash-widget phd-card">
          {primaryGoal ? (
            <GoalCard goal={primaryGoal} today={today} onUpdate={updateGoal} onDelete={deleteGoal} />
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>
              Day Timer — add a goal with start and end dates (for example your PhD) using “+ Add” in Task Progress; the first goal becomes this timer.
            </div>
          )}
        </div>
        <ReadingGoalsCard onOpenBooks={onOpenBooks} onHabitsChanged={() => void reload()} />
      </div>
    ),
    progress: (
      <div className="card dash-widget task-progress-card">
        <h2 style={{ margin: "0 0 10px", textAlign: "center" }}>Task Progress</h2>
        <div className="task-progress-grid">
          {pinnedItems.map((it) => (
            <div key={it.key} className="tp-item tp-goal">
              <div className="tp-goal-actions">
                <button type="button" title="Remove from dashboard" onClick={() => savePins(pins.filter((k) => k !== it.key))}>×</button>
              </div>
              <ProgressRing pct={it.pct} size={96} stroke={13} />
              <div className="tp-cap" title={it.label}>{it.label}</div>
              <div className="tp-sub muted mono">{it.sub}</div>
            </div>
          ))}
          {otherGoals.map((g) => (
            <GoalRing key={g.id} goal={g} today={today} onUpdate={updateGoal} onDelete={deleteGoal} />
          ))}
          {addingGoal ? (
            <div className="goal-add-form tp-item">
              <select value={pinChoice} onChange={(e) => setPinChoice(e.target.value)}>
                <option value="">Choose what to add…</option>
                {pinOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                <option value="__goal__">+ New goal (with dates)…</option>
              </select>
              {pinChoice === "__goal__" && (
                <>
                  <input type="text" placeholder="Goal name (first goal = day timer)" value={goalName} onChange={(e) => setGoalName(e.target.value)} />
                  <label className="muted" style={{ fontSize: 11 }}>Start<input type="date" value={goalStart} onChange={(e) => setGoalStart(e.target.value)} /></label>
                  <label className="muted" style={{ fontSize: 11 }}>End<input type="date" value={goalEnd} onChange={(e) => setGoalEnd(e.target.value)} /></label>
                </>
              )}
              <div className="goal-add-form-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!pinChoice || (pinChoice === "__goal__" && (!goalName.trim() || !goalStart || !goalEnd))}
                  onClick={() => {
                    if (pinChoice === "__goal__") { void submitGoal(); }
                    else { savePins([...pins, pinChoice]); setAddingGoal(false); }
                    setPinChoice("");
                  }}
                >Add</button>
                <button type="button" className="btn" onClick={() => { setAddingGoal(false); setPinChoice(""); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className="tp-add" onClick={() => setAddingGoal(true)} title="Add a ring to the dashboard">
              <span>+</span>
              <small>Add</small>
            </button>
          )}
        </div>
      </div>
    ),
    activity: (
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
            <button type="button" className={`btn${editingHabits ? " btn-primary" : ""}`} onClick={() => { setEditingHabits((v) => !v); setAddingHabit(false); }} title="Rename, reorder, add or remove habits">
              {editingHabits ? "Done" : "Edit"}
            </button>
          </div>
        </div>
        <div className="heatmap-scroll">
          <div
            className="heatmap-grid"
            style={{
              gridTemplateColumns: `${editingHabits ? "minmax(210px, 250px)" : "minmax(120px, 148px)"} repeat(${range.days.length}, ${mode === "year" ? "14px" : "minmax(14px, 1fr)"})`,
            }}
          >
            <div className="heatmap-corner" />
            {range.days.map((d) => (
              <div
                key={d}
                className={`heatmap-day-label clickable${d === today ? " today" : ""}${d === selectedDay ? " sel" : ""}`}
                title={d}
                onClick={() => setSelectedDay(d)}
              >
                {d.slice(8)}
              </div>
            ))}
            {habitKeys.map((key, hi) => (
              <Fragment key={key}>
                {editingHabits ? (
                  <div className="heatmap-row-label editing">
                    <button type="button" className="heatmap-row-mv" disabled={hi === 0} onClick={() => moveHabit(key, -1)} title="Move up">▲</button>
                    <button type="button" className="heatmap-row-mv" disabled={hi === habitKeys.length - 1} onClick={() => moveHabit(key, 1)} title="Move down">▼</button>
                    <input
                      type="text"
                      key={`${key}-${labelOf[key]}`}
                      defaultValue={labelOf[key] || key}
                      onBlur={(e) => renameHabit(key, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    />
                    <button type="button" className="heatmap-row-x on" title={`Remove “${labelOf[key] || key}”`} onClick={() => removeHabit(key)}>×</button>
                  </div>
                ) : (
                  <div className="heatmap-row-label">
                    <span className="heatmap-row-text">{labelOf[key] || key}</span>
                  </div>
                )}
                {range.days.map((d) => {
                  const raw = habitByDate.get(d)?.[key];
                  const mh = key === MENTAL_HEALTH_KEY ? mhNum(raw) : null;
                  const on = key === MENTAL_HEALTH_KEY ? mh !== null : Boolean(raw);
                  const level = key === MENTAL_HEALTH_KEY && mh !== null ? (mh === -1 ? " l1" : mh === 0 ? " l2" : " l3") : "";
                  return (
                    <div
                      key={`${key}-${d}`}
                      className={`heatmap-cell clickable${on ? ` filled${level}` : ""}${d === selectedDay ? " sel-col" : ""}`}
                      title={`${labelOf[key] || key} · ${d}${mh !== null ? ` · ${mentalHealthLabel(mh as MentalHealthValue)}` : ""} — click to change`}
                      onClick={() => toggleCell(d, key)}
                    />
                  );
                })}
              </Fragment>
            ))}
            <div className="heatmap-row-label"><span className="heatmap-row-text">Subtasks done</span></div>
            {range.days.map((d) => {
              const n = tasksDoneByDate.get(d) || 0;
              const level = n === 0 ? "" : n >= 4 ? " l3" : n >= 2 ? " l2" : " l1";
              return (
                <div
                  key={`tasks-${d}`}
                  className={`heatmap-cell${n ? ` filled${level}` : ""}${d === selectedDay ? " sel-col" : ""}`}
                  title={`${n} subtasks · ${d}`}
                  onClick={() => setSelectedDay(d)}
                />
              );
            })}
          </div>
        </div>
        {editingHabits && <div className="heatmap-add-row">
          {addingHabit ? (
            <>
              <input
                type="text"
                autoFocus
                placeholder="New habit…"
                value={newHabitLabel}
                onChange={(e) => setNewHabitLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addHabit(); if (e.key === "Escape") setAddingHabit(false); }}
              />
              <button type="button" className="btn btn-primary" onClick={addHabit} disabled={!newHabitLabel.trim()}>Add</button>
              <button type="button" className="btn" onClick={() => { setAddingHabit(false); setNewHabitLabel(""); }}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn heatmap-add" onClick={() => setAddingHabit(true)} title="Add a habit row">+ habit</button>
          )}
        </div>}
        <div className="heatmap-legend muted mono">
          <span>less</span>
          <span className="heatmap-cell" />
          <span className="heatmap-cell filled l1" />
          <span className="heatmap-cell filled l2" />
          <span className="heatmap-cell filled l3" />
          <span>more</span>
        </div>
      </div>
    ),
    charts: (
      <div className="card lightcurve-card dash-widget charts-card">
        <div className="subplot">
          <div className="heatmap-toolbar">
            <h2 style={{ margin: 0 }}>Mental Health</h2>
            <span className="muted mono" style={{ fontSize: 11 }}>
              <span className="lightcurve-legend-dot mental-health">● Trend</span>
              {" · "}
              {mode}
            </span>
          </div>
          <div className="mood-row">
            <span className="muted mono">{selectedDay === today ? "How is today?" : `How was ${selectedDay}?`}</span>
            {([[1, "Good", "+1"], [0, "Fine", "0"], [-1, "Bad", "−1"]] as [MentalHealthValue, string, string][]).map(([v, label, sign]) => (
              <button
                key={v}
                type="button"
                className={`mood-btn m${v === 1 ? "g" : v === 0 ? "f" : "b"}${mhNum(habitByDate.get(selectedDay)?.[MENTAL_HEALTH_KEY]) === v ? " on" : ""}`}
                onClick={() => setMood(selectedDay, v)}
                title={`${label} (${sign}) for ${selectedDay}`}
              >
                {label} <small>{sign}</small>
              </button>
            ))}
          </div>
          <MentalHealthChart days={range.days} values={mentalHealthValues} today={selectedDay} />
        </div>
        <div className="subplot">
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
          <Lightcurve days={range.days} habits={habitCountValues} subtasks={subtaskCountValues} today={selectedDay} />
        </div>
      </div>
    ),
  };
  const visible = layout.order.filter((id) => !layout.hidden.includes(id) && widgets[id] !== null);

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
          <button
            type="button"
            className={`btn dash-fit-btn${layout.fit ? " btn-primary" : ""}`}
            onClick={toggleFit}
            aria-pressed={!!layout.fit}
            title={layout.fit ? "Fit to screen is on — click to go back to automatic card heights" : "Reset layout and fit all cards to the screen size"}
            aria-label="Reset and fit dashboard to screen"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3.5v5.2h-5.2" fill="currentColor" /></svg>
          </button>
        </div>
      </div>

      {customizing && (
        <div className="dash-edit-banner">
          <span>Editing layout — drag a card’s right edge, bottom edge or corner to resize it; use ◀ ▶ to move, × to hide.</span>
          {layout.hidden.map((id) => (
            <button key={id} type="button" className="btn" onClick={() => showSlot(id)}>+ {SLOT_LABEL[id]}</button>
          ))}
          <button type="button" className="btn" onClick={() => commitLayout({ order: [...DEFAULT_ORDER], spans: { ...DEFAULT_SPANS }, heights: {}, fit: false, hidden: [] })}>
            Reset layout
          </button>
        </div>
      )}

      <div className="dash-grid" ref={gridRef}>
        {visible.map((id, idx) => (
          <div
            key={id}
            className={`dash-slot dash-slot-${id}${(drag?.id === id ? drag.height : heightOf(id)) ? " has-height" : ""}${drag?.id === id ? " is-resizing" : ""}`}
            style={{
              ["--span" as string]: drag?.id === id ? drag.span : layout.spans[id],
              height: (drag?.id === id ? drag.height : heightOf(id)) || undefined,
            } as CSSProperties}
          >
            {customizing && (
              <div className="dash-slot-bar">
                <span className="dash-slot-name">{SLOT_LABEL[id]}</span>
                <button type="button" title="Move earlier" disabled={idx === 0} onClick={() => moveSlot(id, -1)}>◀</button>
                <button type="button" title="Move later" disabled={idx === visible.length - 1} onClick={() => moveSlot(id, 1)}>▶</button>
                <button type="button" title="Narrower" onClick={() => resizeSlot(id, -1)}>−</button>
                <button type="button" title="Wider" onClick={() => resizeSlot(id, 1)}>+</button>
                <button type="button" title="Auto height" disabled={!heightOf(id)} onClick={() => autoHeight(id)}>↕</button>
                <button type="button" title="Hide" onClick={() => hideSlot(id)}>×</button>
              </div>
            )}
            {(drag?.id === id ? drag.height : heightOf(id)) ? <FitContent>{widgets[id]}</FitContent> : widgets[id]}
            {customizing && (
              <>
                <div className="dash-grip dash-grip-e" title="Drag to change width" onPointerDown={(e) => startResize(e, id, "w")} />
                <div className="dash-grip dash-grip-s" title="Drag to change height" onPointerDown={(e) => startResize(e, id, "h")} />
                <div className="dash-grip dash-grip-se" title="Drag to resize" onPointerDown={(e) => startResize(e, id, "wh")} />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
