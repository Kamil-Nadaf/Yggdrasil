/** Customizable task statuses (List status pill + Kanban columns). */
import type { TaskStatusDef } from "../api/client";

export const DEFAULT_TASK_STATUSES: TaskStatusDef[] = [
  { id: "todo", name: "To Do", color: "#6B7280", order: 0, icon: "circle-outline" },
  { id: "in_progress", name: "In Progress", color: "#F59E0B", order: 1, icon: "half-fill" },
  { id: "done", name: "Done", color: "#34D399", order: 2, icon: "full-fill" },
];

export const TASK_STATUSES_EVENT = "ygg-task-statuses";

/** Icon token → grayscale-safe glyph, always drawn in currentColor — color never carries meaning alone. */
export const STATUS_ICON_GLYPH: Record<string, string> = {
  "circle-outline": "○",
  "half-fill": "◐",
  "full-fill": "●",
  square: "■",
  triangle: "▲",
};

export const STATUS_ICON_CYCLE = ["circle-outline", "half-fill", "full-fill", "square", "triangle"] as const;

let cached: TaskStatusDef[] | null = null;

export function getCachedTaskStatuses(): TaskStatusDef[] {
  return cached ?? [...DEFAULT_TASK_STATUSES];
}

export function setCachedTaskStatuses(statuses: TaskStatusDef[]) {
  cached = statuses;
  window.dispatchEvent(new CustomEvent(TASK_STATUSES_EVENT));
}

export async function ensureTaskStatuses(
  fetcher: () => Promise<{ task_statuses: TaskStatusDef[] }>
): Promise<TaskStatusDef[]> {
  if (cached) return cached;
  try {
    const r = await fetcher();
    setCachedTaskStatuses(r.task_statuses);
  } catch {
    setCachedTaskStatuses([...DEFAULT_TASK_STATUSES]);
  }
  return getCachedTaskStatuses();
}
