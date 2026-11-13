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
  /** Research layout: Kanban uses To do / Doing / Waiting / Done and the List drops "Group by Project". */
  research?: boolean;
}

export function mainKeyOf(it: TaskItem): string {
  return it.kind === "main" ? it.ref : `${it.project_slug}/${it.main_task_id}`;
}
