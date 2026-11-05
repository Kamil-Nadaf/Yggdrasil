/** Date helpers for the Tasks timeline/gantt (all dates are local YYYY-MM-DD strings). */

export const DAY_MS = 86400000;

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS);
}

export interface Span {
  start: string;
  end: string;
}

/** The inclusive day range a task occupies, or null when it has no dates at all. */
export function spanOf(it: { start: string | null; deadline: string | null }): Span | null {
  const a = it.start || it.deadline;
  const b = it.deadline || it.start;
  if (!a || !b) return null;
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/** Greedy lane packing so overlapping bars sit on separate sub-rows. Returns lane index per key. */
export function packLanes<T>(rows: T[], span: (r: T) => Span, key: (r: T) => string): { lanes: Map<string, number>; count: number } {
  const sorted = [...rows].sort((x, y) => span(x).start.localeCompare(span(y).start));
  const laneEnds: string[] = [];
  const lanes = new Map<string, number>();
  for (const r of sorted) {
    const s = span(r);
    let i = laneEnds.findIndex((end) => end < s.start);
    if (i === -1) {
      i = laneEnds.length;
      laneEnds.push(s.end);
    } else {
      laneEnds[i] = s.end;
    }
    lanes.set(key(r), i);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

export function fmtShort(iso: string | null): string {
  if (!iso) return "";
  return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtRange(start: string | null, deadline: string | null): string {
  if (start && deadline && start !== deadline) return `${fmtShort(start)} → ${fmtShort(deadline)}`;
  if (deadline) return fmtShort(deadline);
  if (start) return `from ${fmtShort(start)}`;
  return "";
}
