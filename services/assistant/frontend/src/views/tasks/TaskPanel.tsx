import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { TaskItem, TaskRelationType } from "../../api/client";
import DeadlinePicker from "../../components/DeadlinePicker";
import StatusPill from "../../components/StatusPill";
import { allowedFor, formatMinutes, parseMinutes } from "../../lib/taskOptions";
import ExportNoteDialog from "./ExportNoteDialog";
import { KindBadge, MenuPill, PriorityPill, TimerButton, doneStatusId } from "./TaskBits";
import type { TaskData } from "./useTaskData";
import { mainKeyOf } from "./viewTypes";

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function TaskPanel({
  itemRef,
  data,
  now,
  onClose,
  onOpenOther,
}: {
  itemRef: string;
  data: TaskData;
  now: number;
  onClose: () => void;
  onOpenOther: (ref: string) => void;
}) {
  const { items, projects, statuses, priorities, tags, patch, toggleTimer, reload } = data;
  const item = items.find((i) => i.ref === itemRef) || null;
  const project = projects.find((p) => p.slug === item?.project_slug);

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [estimate, setEstimate] = useState("");
  const [saved, setSaved] = useState<"" | "saving" | "saved">("");
  const [flash, setFlash] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [relateOpen, setRelateOpen] = useState(false);
  const [relateQuery, setRelateQuery] = useState("");
  const [relateType, setRelateType] = useState<TaskRelationType | "blocking">("related");
  const [newSub, setNewSub] = useState("");
  const [busyFile, setBusyFile] = useState(false);
  const noteTimer = useRef<number | null>(null);
  const nameTimer = useRef<number | null>(null);
  const loadedFor = useRef<string | null>(null);

  const say = (m: string) => {
    setFlash(m);
    window.setTimeout(() => setFlash(null), 2200);
  };

  // Load the note body and reset local fields when switching tasks.
  useEffect(() => {
    if (!item) return;
    if (loadedFor.current === itemRef) return;
    loadedFor.current = itemRef;
    setNoteLoaded(false);
    setName(item.name);
    setEstimate(formatMinutes(item.estimate_min));
    setRelateOpen(false);
    setNewSub("");
    api.taskItems
      .get(item.project_slug, item.id)
      .then((r) => setNote(r.note))
      .catch(() => setNote(""))
      .finally(() => setNoteLoaded(true));
  }, [itemRef, item]);

  const save = useCallback(
    async (body: Record<string, unknown>) => {
      if (!item) return;
      setSaved("saving");
      await patch(item, body);
      setSaved("saved");
    },
    [item, patch]
  );

  function onName(v: string) {
    setName(v);
    if (nameTimer.current) window.clearTimeout(nameTimer.current);
    nameTimer.current = window.setTimeout(() => {
      if (v.trim()) void save({ name: v.trim() });
    }, 700);
  }

  function onNote(v: string) {
    setNote(v);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => void save({ note: v }), 800);
  }

  // Flush pending debounced edits when the panel closes or switches.
  useEffect(
    () => () => {
      if (noteTimer.current) window.clearTimeout(noteTimer.current);
      if (nameTimer.current) window.clearTimeout(nameTimer.current);
    },
    [itemRef]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exporting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, exporting]);

  if (!item) {
    return (
      <aside className="tk-panel" role="dialog" aria-label="Task">
        <div className="tk-panel-head"><span className="muted">Task not found</span><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </aside>
    );
  }

  const projStatuses = allowedFor(statuses, project?.options?.status_ids);
  const projPriorities = allowedFor(priorities, project?.options?.priority_ids);
  const projTags = allowedFor(tags, project?.options?.tag_ids);
  const subtasks = item.kind === "main" ? items.filter((i) => i.kind === "subtask" && mainKeyOf(i) === item.ref) : [];
  const parent = item.kind === "subtask" ? items.find((i) => i.ref === mainKeyOf(item)) : undefined;
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const done = item.status_id === doneStatusId(statuses);

  function commitEstimate() {
    const v = parseMinutes(estimate);
    if (v !== null && Number.isNaN(v)) {
      say("Use a format like 4h, 90m or 1h 30m");
      setEstimate(formatMinutes(item!.estimate_min));
      return;
    }
    if ((v ?? null) === (item!.estimate_min ?? null)) return;
    void save({ estimate_min: v });
    setEstimate(formatMinutes(v));
  }

  async function copyNote() {
    try {
      await navigator.clipboard.writeText(note);
      say("Note copied");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = note;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      say("Note copied");
    }
  }

  async function addRelation(other: TaskItem) {
    if (relateType === "blocking") {
      const rels = [...other.relations.filter((r) => r.target !== item!.ref), { type: "blocked_by" as const, target: item!.ref }];
      await patch(other, { relations: rels });
    } else {
      await save({ relations: [...item!.relations.filter((r) => r.target !== other.ref), { type: relateType, target: other.ref }] });
    }
    setRelateOpen(false);
    setRelateQuery("");
  }

  async function addSubtask() {
    const n = newSub.trim();
    if (!n || item!.kind !== "main") return;
    setNewSub("");
    await api.subtasks.create(item!.project_slug, item!.id, { name: n });
    await reload();
  }

  async function uploadFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setBusyFile(true);
    try {
      for (const f of Array.from(list)) {
        await api.taskItems.uploadFile(item!.project_slug, item!.id, f.name, await toBase64(f));
      }
      await reload();
    } catch (e) {
      say(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusyFile(false);
    }
  }

  async function removeItem() {
    const what = item!.kind === "main" ? "this task and its subtasks" : "this subtask";
    if (!window.confirm(`Delete ${what}?`)) return;
    await api.taskItems.delete(item!.project_slug, item!.id);
    await reload();
    onClose();
  }

  const q = relateQuery.trim().toLowerCase();
  const candidates = items
    .filter((i) => i.ref !== item.ref && !item.relations.some((r) => r.target === i.ref))
    .filter((i) => !q || i.name.toLowerCase().includes(q) || i.project_name.toLowerCase().includes(q))
    .slice(0, 8);

  return (
    <>
      <div className="tk-panel-backdrop" onMouseDown={onClose} />
      <aside className="tk-panel" role="dialog" aria-label="Task details">
        <div className="tk-panel-head">
          <div className="tk-crumbs muted">
            <KindBadge kind={item.kind} /> {item.project_name}
            {parent && (
              <>
                {" › "}
                <button type="button" className="tk-link" onClick={() => onOpenOther(parent.ref)}>{parent.name}</button>
              </>
            )}
          </div>
          <span className="muted tk-saved">{flash || (saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : "")}</span>
          <button type="button" className="btn btn-crit" onClick={() => void removeItem()} title="Delete">Delete</button>
          <button type="button" className="btn" onClick={onClose} aria-label="Close panel">×</button>
        </div>

        <input className={`tk-title${done ? " done" : ""}`} value={name} onChange={(e) => onName(e.target.value)} placeholder="Task name" aria-label="Task name" />

        <div className="tk-props">
          <div className="tk-prop-label">Status</div>
          <div><StatusPill statuses={projStatuses.length ? projStatuses : statuses} statusId={item.status_id} onChange={(s) => void save({ status_id: s })} /></div>

          <div className="tk-prop-label">Priority</div>
          <div><PriorityPill priorities={projPriorities} value={item.priority_id} onChange={(p) => void save({ priority_id: p })} /></div>

          <div className="tk-prop-label">Dates</div>
          <div className="tk-dates">
            <DeadlinePicker value={item.start} onChange={(v) => void save({ start: v })} title="Start date" />
            <span className="muted">→</span>
            <DeadlinePicker value={item.deadline} onChange={(v) => void save({ deadline: v })} title="Deadline" />
          </div>

          <div className="tk-prop-label">Time estimate</div>
          <div>
            <input
              type="text"
              className="tk-est mono"
              value={estimate}
              placeholder="e.g. 4h, 90m"
              onChange={(e) => setEstimate(e.target.value)}
              onBlur={commitEstimate}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              aria-label="Time estimate"
            />
          </div>

          <div className="tk-prop-label">Timer</div>
          <div><TimerButton item={item} now={now} onToggle={() => void toggleTimer(item)} /></div>

          <div className="tk-prop-label">Tags</div>
          <div className="tk-tag-edit">
            {item.tags.map((id) => {
              const t = tags.find((x) => x.id === id);
              if (!t) return null;
              return (
                <span key={id} className="tk-tag" style={{ borderColor: t.color, background: `color-mix(in srgb, ${t.color} 14%, transparent)` }}>
                  # {t.name}
                  <button type="button" className="tk-x" aria-label={`Remove tag ${t.name}`} onClick={() => void save({ tags: item.tags.filter((x) => x !== id) })}>×</button>
                </span>
              );
            })}
            <MenuPill label={<span>+ Tag</span>} title="Add a tag">
              {(close) =>
                projTags.filter((t) => !item.tags.includes(t.id)).length === 0 ? (
                  <div className="muted" style={{ padding: 8, maxWidth: 220, fontSize: 12 }}>
                    {tags.length === 0 ? "No tags defined yet — add some in Settings → Task Priorities & Tags." : "No more tags available for this project."}
                  </div>
                ) : (
                  projTags
                    .filter((t) => !item.tags.includes(t.id))
                    .map((t) => (
                      <button key={t.id} type="button" role="menuitem" className="status-pill-option" onClick={() => { void save({ tags: [...item.tags, t.id] }); close(); }}>
                        <span aria-hidden="true" style={{ color: t.color }}>#</span><span>{t.name}</span>
                      </button>
                    ))
                )
              }
            </MenuPill>
          </div>

          {item.kind === "main" && (
            <>
              <div className="tk-prop-label">Dashboard</div>
              <div>
                <button type="button" className={`btn${item.is_active ? " btn-primary" : ""}`} aria-pressed={item.is_active} onClick={() => void save({ is_active: !item.is_active })}>
                  {item.is_active ? "★ Starred" : "☆ Star"}
                </button>
              </div>
            </>
          )}
        </div>

        {item.kind === "main" && (
          <section className="tk-section">
            <h3>Subtasks <span className="muted mono">{item.subtask_done}/{item.subtask_total}</span></h3>
            {subtasks.map((s) => {
              const sd = s.status_id === doneStatusId(statuses);
              return (
                <div key={s.ref} className="tk-subrow">
                  <input type="checkbox" checked={sd} aria-label="Done" onChange={() => void patch(s, { status_id: sd ? statuses[0]?.id : doneStatusId(statuses) })} />
                  <button type="button" className={`tk-link tk-subname${sd ? " done" : ""}`} onClick={() => onOpenOther(s.ref)}>{s.name}</button>
                  <StatusPill statuses={statuses} statusId={s.status_id} onChange={(st) => void patch(s, { status_id: st })} />
                </div>
              );
            })}
            <input type="text" className="tk-inline-add" placeholder="+ Add subtask" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addSubtask()} />
          </section>
        )}

        <section className="tk-section">
          <h3>Related items</h3>
          {item.relations.map((r) => {
            const t = byRef.get(r.target);
            if (!t) return null;
            return (
              <div key={r.target} className="tk-subrow">
                <select
                  value={r.type}
                  aria-label="Relation type"
                  onChange={(e) => void save({ relations: item.relations.map((x) => (x.target === r.target ? { ...x, type: e.target.value } : x)) })}
                >
                  <option value="related">Related to</option>
                  <option value="blocked_by">Blocked by</option>
                </select>
                <KindBadge kind={t.kind} />
                <button type="button" className="tk-link tk-subname" onClick={() => onOpenOther(t.ref)}>{t.name}</button>
                <span className="muted tk-rel-proj">{t.project_name}</span>
                <button type="button" className="tk-x" aria-label="Remove link" onClick={() => void save({ relations: item.relations.filter((x) => x.target !== r.target) })}>×</button>
              </div>
            );
          })}
          {item.blocking.map((ref) => {
            const t = byRef.get(ref);
            if (!t) return null;
            return (
              <div key={`b-${ref}`} className="tk-subrow">
                <span className="tk-rel-fixed muted">Blocking</span>
                <KindBadge kind={t.kind} />
                <button type="button" className="tk-link tk-subname" onClick={() => onOpenOther(t.ref)}>{t.name}</button>
                <span className="muted tk-rel-proj">{t.project_name}</span>
              </div>
            );
          })}
          {!relateOpen ? (
            <button type="button" className="btn" onClick={() => setRelateOpen(true)}>+ Relate item</button>
          ) : (
            <div className="tk-relate">
              <div className="tk-subrow">
                <select value={relateType} onChange={(e) => setRelateType(e.target.value as TaskRelationType | "blocking")} aria-label="New relation type">
                  <option value="related">Related to</option>
                  <option value="blocked_by">Blocked by</option>
                  <option value="blocking">Blocking</option>
                </select>
                <input type="text" autoFocus placeholder="Search tasks and subtasks…" value={relateQuery} onChange={(e) => setRelateQuery(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn" onClick={() => setRelateOpen(false)}>Cancel</button>
              </div>
              {candidates.map((c) => (
                <button key={c.ref} type="button" className="tk-export-item" onClick={() => void addRelation(c)}>
                  <KindBadge kind={c.kind} /> {c.name} <span className="muted">· {c.project_name}</span>
                </button>
              ))}
              {candidates.length === 0 && <div className="muted" style={{ padding: 8 }}>No matches.</div>}
            </div>
          )}
        </section>

        <section className="tk-section">
          <h3>Note</h3>
          <textarea className="tk-note" value={note} disabled={!noteLoaded} onChange={(e) => onNote(e.target.value)} placeholder="Markdown notes for this task…" rows={7} />
          <div className="tk-note-actions">
            <button type="button" className="btn" disabled={!note.trim()} onClick={() => void copyNote()}>Copy note</button>
            <button type="button" className="btn btn-primary" onClick={() => setExporting(true)}>Export to notes</button>
          </div>
        </section>

        <section
          className="tk-section"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void uploadFiles(e.dataTransfer.files);
          }}
        >
          <h3>Files</h3>
          {item.files.map((f) => (
            <div key={f.name} className="tk-subrow">
              <a className="tk-subname" href={api.taskItems.fileUrl(item.project_slug, item.id, f.name)} download={f.name}>{f.name}</a>
              <span className="muted mono">{formatSize(f.size)}</span>
              <button
                type="button"
                className="tk-x"
                aria-label={`Remove ${f.name}`}
                onClick={async () => {
                  await api.taskItems.deleteFile(item.project_slug, item.id, f.name);
                  await reload();
                }}
              >
                ×
              </button>
            </div>
          ))}
          <label className="btn" style={{ cursor: "pointer", display: "inline-block" }}>
            {busyFile ? "Uploading…" : "Attach file"}
            <input type="file" multiple hidden onChange={(e) => { void uploadFiles(e.target.files); e.target.value = ""; }} />
          </label>
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>or drop files here (max 20 MB each)</span>
        </section>
      </aside>

      {exporting && (
        <ExportNoteDialog
          task={item}
          note={note}
          onClose={() => setExporting(false)}
          onDone={(m) => {
            setExporting(false);
            say(m);
          }}
        />
      )}
    </>
  );
}
