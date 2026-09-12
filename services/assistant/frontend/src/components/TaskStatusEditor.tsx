import { useState } from "react";
import {
  isCoreStatus,
  loadTaskStatuses,
  saveTaskStatuses,
  slugifyStatus,
  type TaskStatusDef,
} from "../lib/theme";

export default function TaskStatusEditor() {
  const [statuses, setStatuses] = useState<TaskStatusDef[]>(() => loadTaskStatuses());
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#F87171");

  function persist(next: TaskStatusDef[]) {
    setStatuses(next);
    saveTaskStatuses(next);
  }

  function update(id: string, patch: Partial<TaskStatusDef>) {
    persist(statuses.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function remove(id: string) {
    if (isCoreStatus(id)) return;
    persist(statuses.filter((s) => s.id !== id));
  }

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    let id = slugifyStatus(label);
    const taken = new Set(statuses.map((s) => s.id));
    if (taken.has(id)) {
      let n = 2;
      while (taken.has(`${id}_${n}`)) n += 1;
      id = `${id}_${n}`;
    }
    persist([...statuses, { id, label, color: newColor }]);
    setNewLabel("");
  }

  return (
    <div className="status-editor">
      <div className="settings-info" style={{ marginBottom: 8 }}>
        Add any status (Blocked, Waiting, …) and pick its colour. To Do and Done stay so scoring still knows when a task is complete.
      </div>

      <div className="status-editor-head">
        <span />
        <span>Status</span>
        <span>Colour</span>
        <span></span>
      </div>

      <div className="status-editor-list">
        {statuses.map((s) => (
          <div key={s.id} className="status-editor-row">
            <span className="status-editor-dot" style={{ background: s.color }} />
            <input
              type="text"
              className="status-editor-label"
              value={s.label}
              onChange={(e) => update(s.id, { label: e.target.value })}
              aria-label={`${s.id} label`}
            />
            <input
              type="color"
              className="status-editor-color"
              value={s.color}
              onChange={(e) => update(s.id, { color: e.target.value })}
              aria-label={`${s.id} color`}
            />
            {isCoreStatus(s.id) ? (
              <span className="status-editor-core-badge">Core</span>
            ) : (
              <button type="button" className="btn btn-crit status-editor-remove" onClick={() => remove(s.id)}>Remove</button>
            )}
          </div>
        ))}
      </div>

      <div className="status-editor-add">
        <input
          type="text"
          placeholder="New status — e.g. Blocked"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <input
          type="color"
          className="status-editor-color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          aria-label="New status color"
        />
        <button type="button" className="btn btn-primary" onClick={add} disabled={!newLabel.trim()}>Add</button>
      </div>
    </div>
  );
}
