import type { TaskItem } from "../../api/client";
import type { TaskData } from "./useTaskData";

/** Props shared by List / Board / Timeline / Gantt. `items` is already filtered by project + done toggle. */
export interface TaskViewProps {
  data: TaskData;
  items: TaskItem[];
  now: number;
  /** "all" or a project slug. */
  projectFilter: string;
  onOpen: (it: TaskItem) => void;
}

export function mainKeyOf(it: TaskItem): string {
  return it.kind === "main" ? it.ref : `${it.project_slug}/${it.main_task_id}`;
}
