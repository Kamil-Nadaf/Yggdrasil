import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { TaskItem, TaskPriorityDef, TaskProject, TaskStatusDef, TaskTagDef } from "../../api/client";
import { ensureTaskStatuses, getCachedTaskStatuses, TASK_STATUSES_EVENT } from "../../lib/taskStatuses";
import {
  ensureTaskOptions,
  getCachedPriorities,
  getCachedTags,
  TASK_OPTIONS_EVENT,
} from "../../lib/taskOptions";

/** Everything the Tasks views share: all items, projects, and the custom status/priority/tag lists. */
export function useTaskData() {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [statuses, setStatuses] = useState<TaskStatusDef[]>(() => getCachedTaskStatuses());
  const [priorities, setPriorities] = useState<TaskPriorityDef[]>(() => getCachedPriorities());
  const [tags, setTags] = useState<TaskTagDef[]>(() => getCachedTags());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api.tasks.all();
      setItems(r.items);
      setProjects(r.projects);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks");
    }
  }, []);

  useEffect(() => {
    void ensureTaskStatuses(() => api.taskStatuses.get()).then(setStatuses);
    void ensureTaskOptions().then(() => {
      setPriorities(getCachedPriorities());
      setTags(getCachedTags());
    });
    const onStatuses = () => setStatuses(getCachedTaskStatuses());
    const onOptions = () => {
      setPriorities(getCachedPriorities());
      setTags(getCachedTags());
    };
    window.addEventListener(TASK_STATUSES_EVENT, onStatuses);
    window.addEventListener(TASK_OPTIONS_EVENT, onOptions);
    void reload().finally(() => setLoading(false));
    return () => {
      window.removeEventListener(TASK_STATUSES_EVENT, onStatuses);
      window.removeEventListener(TASK_OPTIONS_EVENT, onOptions);
    };
  }, [reload]);

  /** Optimistic field update on one item, then re-sync. */
  const patch = useCallback(
    async (it: TaskItem, body: Record<string, unknown>) => {
      setItems((prev) => prev.map((x) => (x.ref === it.ref ? ({ ...x, ...body } as TaskItem) : x)));
      try {
        await api.taskItems.update(it.project_slug, it.id, body);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      }
      await reload();
    },
    [reload]
  );

  const toggleTimer = useCallback(
    async (it: TaskItem) => {
      try {
        await api.taskItems.timer(it.project_slug, it.id, it.timer_started_at ? "stop" : "start");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Timer failed");
      }
      await reload();
    },
    [reload]
  );

  return { items, projects, statuses, priorities, tags, loading, error, setError, reload, patch, toggleTimer };
}

export type TaskData = ReturnType<typeof useTaskData>;

/** Re-render every second while `active` (live timer clocks). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}
