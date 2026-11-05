import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TaskItem } from "../../api/client";
import { addDaysISO, diffDays, parseISO, spanOf, todayISO } from "../../lib/taskDates";

export const ZOOMS = [10, 16, 24, 36, 52];
const ZOOM_KEY = "yggdrasil:tasks-zoom";

export function useZoom(): [number, (z: number) => void] {
  const [z, setZ] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(ZOOM_KEY));
      return ZOOMS.includes(v) ? v : 24;
    } catch {
      return 24;
    }
  });
  return [
    z,
    (n) => {
      setZ(n);
      try {
        localStorage.setItem(ZOOM_KEY, String(n));
      } catch {
        /* optional */
      }
    },
  ];
}

export function ZoomControls({ zoom, setZoom, onToday }: { zoom: number; setZoom: (z: number) => void; onToday: () => void }) {
  const i = ZOOMS.indexOf(zoom);
  return (
    <div className="tk-list-bar">
      <button type="button" className="btn" onClick={onToday}>Today</button>
      <button type="button" className="btn" disabled={i <= 0} onClick={() => setZoom(ZOOMS[i - 1])} aria-label="Zoom out">−</button>
      <button type="button" className="btn" disabled={i >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[i + 1])} aria-label="Zoom in">+</button>
    </div>
  );
}

/** Visible day range covering every dated task, today, and some breathing room. */
export function useAxis(items: TaskItem[]): { origin: string; days: number } {
  return useMemo(() => {
    const today = todayISO();
    let lo = today;
    let hi = today;
    for (const it of items) {
      const s = spanOf(it);
      if (!s) continue;
      if (s.start < lo) lo = s.start;
      if (s.end > hi) hi = s.end;
    }
    const origin = addDaysISO(lo, -7);
    const days = Math.min(730, Math.max(60, diffDays(origin, hi) + 22));
    return { origin, days };
  }, [items]);
}

export const xOf = (origin: string, iso: string, dayW: number) => diffDays(origin, iso) * dayW;

export function AxisHeader({ origin, days, dayW }: { origin: string; days: number; dayW: number }) {
  const months: { label: string; left: number; width: number }[] = [];
  let cur = "";
  for (let i = 0; i < days; i++) {
    const d = parseISO(addDaysISO(origin, i));
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== cur) {
      cur = key;
      months.push({ label: d.toLocaleDateString(undefined, { month: "short", year: "numeric" }), left: i * dayW, width: 0 });
    }
    months[months.length - 1].width += dayW;
  }
  const labelEvery = dayW >= 24 ? 1 : dayW >= 14 ? 2 : 7;
  return (
    <div className="tk-axis" style={{ width: days * dayW }}>
      <div className="tk-axis-months">
        {months.map((m) => (
          <div key={m.left} className="tk-axis-month" style={{ left: m.left, width: m.width }}>
            {m.width > 60 ? m.label : ""}
          </div>
        ))}
      </div>
      <div className="tk-axis-days">
        {Array.from({ length: days }, (_, i) => {
          const d = parseISO(addDaysISO(origin, i));
          const show = labelEvery === 7 ? d.getDay() === 1 : i % labelEvery === 0;
          return (
            <div key={i} className="tk-axis-day mono" style={{ left: i * dayW, width: dayW }}>
              {show ? d.getDate() : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Weekend shading + today line behind the bars. */
export function GridBackdrop({ origin, days, dayW, height }: { origin: string; days: number; dayW: number; height: number }) {
  const weekends: number[] = [];
  for (let i = 0; i < days; i++) {
    const dow = parseISO(addDaysISO(origin, i)).getDay();
    if (dow === 0 || dow === 6) weekends.push(i);
  }
  const t = xOf(origin, todayISO(), dayW);
  return (
    <div className="tk-grid" style={{ width: days * dayW, height }} aria-hidden="true">
      {weekends.map((i) => (
        <div key={i} className="tk-weekend" style={{ left: i * dayW, width: dayW }} />
      ))}
      <div className="tk-today" style={{ left: t + dayW / 2 }} />
    </div>
  );
}

export function shiftBody(it: TaskItem, delta: number): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (it.start) body.start = addDaysISO(it.start, delta);
  if (it.deadline) body.deadline = addDaysISO(it.deadline, delta);
  return body;
}

/** A draggable (horizontal move) task bar. A click without movement opens the task. */
export function Bar({
  left,
  width,
  top,
  height,
  dayW,
  label,
  tint,
  progress,
  done,
  title,
  onOpen,
  onShift,
  children,
}: {
  left: number;
  width: number;
  top: number;
  height: number;
  dayW: number;
  label: ReactNode;
  tint: string;
  progress: number; // 0..1
  done: boolean;
  title: string;
  onOpen: () => void;
  onShift: (deltaDays: number) => void;
  children?: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; moved: boolean } | null>(null);
  return (
    <div
      className={`tk-bar${done ? " done" : ""}${dx ? " moving" : ""}${width < 90 ? " narrow" : ""}`}
      title={title}
      role="button"
      tabIndex={0}
      style={{
        left: left + dx,
        width,
        top,
        height,
        borderColor: tint,
        background: `color-mix(in srgb, ${tint} 18%, var(--surface))`,
      }}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const d = e.clientX - s.x;
        if (Math.abs(d) > 4) s.moved = true;
        if (s.moved) setDx(Math.round(d / dayW) * dayW);
      }}
      onPointerUp={() => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const delta = Math.round(dx / dayW);
        setDx(0);
        if (!s.moved) onOpen();
        else if (delta !== 0) onShift(delta);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDx(0);
      }}
    >
      {progress > 0 && <div className="tk-bar-fill" style={{ width: `${Math.min(1, progress) * 100}%`, background: tint }} />}
      <span className="tk-bar-label">{done ? "✓ " : ""}{label}</span>
      {children}
    </div>
  );
}
