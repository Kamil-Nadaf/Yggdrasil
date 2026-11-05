/** Settings editor for custom task priorities and tags (statuses have their own section). */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { TaskPriorityDef, TaskTagDef } from "../api/client";
import { DEFAULT_TASK_PRIORITIES, setCachedTaskOptions } from "../lib/taskOptions";

type Usage = { priorities: Record<string, number>; tags: Record<string, number> };

export default function TaskOptionsSettings() {
  const [priorities, setPriorities] = useState<TaskPriorityDef[]>([...DEFAULT_TASK_PRIORITIES]);
  const [tags, setTags] = useState<TaskTagDef[]>([]);
  const [usage, setUsage] = useState<Usage>({ priorities: {}, tags: {} });
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await api.taskOptions.get();
      setPriorities(r.task_priorities);
      setTags(r.task_tags);
      setUsage(r.usage);
      setCachedTaskOptions(r.task_priorities, r.task_tags);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load task options");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await api.taskOptions.set({
        task_priorities: priorities.filter((p) => p.name.trim()),
        task_tags: tags.filter((t) => t.name.trim()),
      });
      setPriorities(r.task_priorities);
      setTags(r.task_tags);
      setCachedTaskOptions(r.task_priorities, r.task_tags);
      setMsg("Saved. Removed priorities/tags were cleared from the tasks that used them.");
      const u = await api.taskOptions.get();
      setUsage(u.usage);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function row<T extends { id: string; name: string; color: string }>(
    list: T[],
    setList: (l: T[]) => void,
    kind: "priorities" | "tags",
    minCount: number
  ) {
    return list.map((x, i) => {
      const n = usage[kind][x.id] || 0;
      return (
        <div key={x.id || `new-${i}`} className="task-status-edit-row tk-opt-row">
          {kind === "priorities" && (
            <span className="mono muted" style={{ minWidth: 18 }} title="Order: top = highest">
              {i + 1}
            </span>
          )}
          <input
            type="text"
            value={x.name}
            placeholder={kind === "priorities" ? "Priority name" : "Tag name"}
            onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
            style={{ flex: 1 }}
            aria-label={`${kind === "priorities" ? "Priority" : "Tag"} ${i + 1} name`}
          />
          <input
            type="color"
            value={x.color}
            title="Color (secondary accent only)"
            onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, color: e.target.value } : y)))}
          />
          {kind === "priorities" && (
            <>
              <button
                type="button"
                className="btn"
                disabled={i === 0}
                title="Move up"
                onClick={() => {
                  const next = [...list];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  setList(next);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn"
                disabled={i === list.length - 1}
                title="Move down"
                onClick={() => {
                  const next = [...list];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  setList(next);
                }}
              >
                ↓
              </button>
            </>
          )}
          <span className="muted mono" style={{ fontSize: 11, minWidth: 24, textAlign: "right" }} title={`${n} task${n === 1 ? "" : "s"} use this`}>
            {n}
          </span>
          <button
            type="button"
            className="btn btn-crit"
            disabled={list.length <= minCount}
            title={list.length <= minCount ? "At least one is required" : n ? `Removed from ${n} task(s) on save` : "Delete"}
            onClick={() => setList(list.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      );
    });
  }

  return (
    <div className="settings-item">
      <div className="settings-info" style={{ marginBottom: 10 }}>
        Define the priorities and tags you can pick from on tasks. Each project can narrow these
        lists from the Tasks page (&ldquo;Project options&rdquo;). The name always labels a priority or tag;
        color is a secondary accent.
      </div>

      <div className="settings-label" style={{ marginBottom: 6 }}>Priorities (highest first)</div>
      {row(priorities, setPriorities, "priorities", 1)}
      <button
        type="button"
        className="btn"
        style={{ marginTop: 6 }}
        onClick={() => setPriorities([...priorities, { id: "", name: "", color: "#6B7280" }])}
      >
        + Add priority
      </button>

      <div className="settings-label" style={{ margin: "16px 0 6px" }}>Tags</div>
      {tags.length === 0 && <div className="settings-info">No tags yet.</div>}
      {row(tags, setTags, "tags", 0)}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <button
          type="button"
          className="btn"
          onClick={() => setTags([...tags, { id: "", name: "", color: "#6B7280" }])}
        >
          + Add tag
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? "…" : "Save priorities & tags"}
        </button>
      </div>
      {msg && <div className="settings-info" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
