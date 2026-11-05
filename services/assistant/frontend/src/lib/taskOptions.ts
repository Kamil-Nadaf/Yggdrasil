/** Custom task priorities + tags (global lists; each project may narrow them). */
import { api } from "../api/client";
import type { TaskPriorityDef, TaskTagDef, TaskProject } from "../api/client";

export const DEFAULT_TASK_PRIORITIES: TaskPriorityDef[] = [
  { id: "urgent", name: "Urgent", color: "#F87171" },
  { id: "high", name: "High", color: "#F59E0B" },
  { id: "normal", name: "Normal", color: "#4FC3F7" },
  { id: "low", name: "Low", color: "#6B7280" },
];

export const TASK_OPTIONS_EVENT = "ygg-task-options";

let priorities: TaskPriorityDef[] | null = null;
let tags: TaskTagDef[] | null = null;

export function getCachedPriorities(): TaskPriorityDef[] {
  return priorities ?? [...DEFAULT_TASK_PRIORITIES];
}

export function getCachedTags(): TaskTagDef[] {
  return tags ?? [];
}

export function setCachedTaskOptions(p: TaskPriorityDef[], t: TaskTagDef[]) {
  priorities = p;
  tags = t;
  window.dispatchEvent(new CustomEvent(TASK_OPTIONS_EVENT));
}

export async function ensureTaskOptions(force = false): Promise<void> {
  if (priorities && tags && !force) return;
  try {
    const r = await api.taskOptions.get();
    setCachedTaskOptions(r.task_priorities, r.task_tags);
  } catch {
    setCachedTaskOptions([...DEFAULT_TASK_PRIORITIES], []);
  }
}

/** Options a project allows: a null list in project.options means "everything from the global list". */
export function allowedFor<T extends { id: string }>(all: T[], allowedIds: string[] | null | undefined): T[] {
  if (!allowedIds) return all;
  const set = new Set(allowedIds);
  return all.filter((x) => set.has(x.id));
}

export function projectPriorities(project: TaskProject | undefined): TaskPriorityDef[] {
  return allowedFor(getCachedPriorities(), project?.options?.priority_ids);
}

export function projectTags(project: TaskProject | undefined): TaskTagDef[] {
  return allowedFor(getCachedTags(), project?.options?.tag_ids);
}

/** "1h 30m" style; 0/null → "". */
export function formatMinutes(min: number | null | undefined): string {
  if (!min || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

/** Accepts "4h", "90m", "1h 30m", "1h30", "1.5h", "2d" (8h days) or bare minutes. null = empty, NaN = unparseable. */
export function parseMinutes(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = /^(?:(\d+(?:\.\d+)?)d)?(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m?)?$/.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) return NaN;
  return Math.round(parseFloat(m[1] || "0") * 480 + parseFloat(m[2] || "0") * 60 + parseFloat(m[3] || "0"));
}

/** hh:mm:ss for live timers. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

/** Seconds tracked so far, including a running timer. Timestamps are naive local ISO strings from the server. */
export function liveTrackedSec(tracked: number, startedAt: string | null, nowMs = Date.now()): number {
  if (!startedAt) return tracked;
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return tracked;
  return tracked + Math.min(12 * 3600, Math.max(0, (nowMs - t) / 1000));
}
