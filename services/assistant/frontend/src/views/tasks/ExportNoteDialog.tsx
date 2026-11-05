import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { LatexFile, TaskItem } from "../../api/client";

const NAME_OK = /^[A-Za-z0-9._ -]+$/;

function dirOf(name: string): string {
  const i = name.lastIndexOf("/");
  return i === -1 ? "" : name.slice(0, i);
}
function baseOf(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

/** Choose where a task note goes: append to an existing note or create a new one in any folder. */
export default function ExportNoteDialog({
  task,
  note,
  onClose,
  onDone,
}: {
  task: TaskItem;
  note: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<LatexFile[]>([]);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [folder, setFolder] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [position, setPosition] = useState<"end" | "start">("end");
  const [linkBack, setLinkBack] = useState(true);
  const [newName, setNewName] = useState(task.name.replace(/[^A-Za-z0-9._ -]/g, "").trim().slice(0, 60));
  const [newFolder, setNewFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadNotes() {
    try {
      const r = await api.notes.listFiles();
      setFolders(r.folders);
      setFiles(r.files);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load notes");
    }
  }
  useEffect(() => {
    void loadNotes();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const block = useMemo(() => {
    const parts = [`## ${task.name}`, "", note.trim() || "_(no note text)_"];
    if (linkBack) parts.push("", `_From task: ${task.project_name}${task.kind === "subtask" ? ` › ${task.main_task_name}` : ""} › ${task.name}_`);
    return parts.join("\n") + "\n";
  }, [task, note, linkBack]);

  const inFolder = files.filter((f) => dirOf(f.name) === folder);
  const targetPath = mode === "existing" ? picked : `${folder ? folder + "/" : ""}${newName.trim().replace(/\.md$/i, "")}.md`;

  async function createFolder() {
    const n = newFolder.trim();
    if (!n) return;
    if (!NAME_OK.test(n)) {
      setErr("Folder names may use letters, numbers, spaces, . _ -");
      return;
    }
    try {
      const path = folder ? `${folder}/${n}` : n;
      await api.notes.createFolder(path);
      setNewFolder("");
      setFolder(path);
      await loadNotes();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create folder");
    }
  }

  async function doExport() {
    setErr(null);
    if (!targetPath) {
      setErr(mode === "existing" ? "Pick a note first." : "Enter a note name.");
      return;
    }
    if (mode === "new") {
      if (!NAME_OK.test(newName.trim().replace(/\.md$/i, ""))) {
        setErr("Note names may use letters, numbers, spaces, . _ -");
        return;
      }
      if (files.some((f) => f.name.toLowerCase() === targetPath.toLowerCase())) {
        setErr("A note with that name already exists in this folder — use “Add to existing note”.");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "new") {
        await api.notes.save(targetPath, block);
      } else {
        const cur = await api.notes.getFile(targetPath);
        let src = cur.source;
        if (position === "end") {
          src = src.replace(/\s*$/, "") + "\n\n" + block;
        } else {
          const m = /^---\n[\s\S]*?\n---\n?/.exec(src);
          const head = m ? m[0] : "";
          src = head + (head ? "\n" : "") + block + "\n" + src.slice(head.length).replace(/^\s*/, "");
        }
        await api.notes.save(targetPath, src);
      }
      onDone(`Exported to ${targetPath}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="latex-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="latex-modal tk-export" role="dialog" aria-modal="true" aria-label="Export to notes">
        <div className="latex-modal-header">
          <h2>Export note to Notes</h2>
          <button type="button" className="latex-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="tk-seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "existing"} className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>
            Add to existing note
          </button>
          <button type="button" role="tab" aria-selected={mode === "new"} className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
            Create new note
          </button>
        </div>

        <div className="tk-export-cols">
          <div className="tk-export-col">
            <div className="settings-label">Folder</div>
            <button type="button" className={`tk-export-item${folder === "" ? " on" : ""}`} onClick={() => { setFolder(""); setPicked(null); }}>
              ▣ All notes
            </button>
            {folders.map((f) => (
              <button
                key={f}
                type="button"
                className={`tk-export-item${folder === f ? " on" : ""}`}
                style={{ paddingLeft: 10 + (f.split("/").length - 1) * 14 }}
                onClick={() => { setFolder(f); setPicked(null); }}
              >
                ▸ {baseOf(f)}
              </button>
            ))}
            <div className="tk-export-newfolder">
              <input type="text" placeholder="New folder here…" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void createFolder()} />
              <button type="button" className="btn" onClick={() => void createFolder()}>+</button>
            </div>
          </div>

          <div className="tk-export-col">
            {mode === "existing" ? (
              <>
                <div className="settings-label">Note in {folder || "All notes"}</div>
                {inFolder.length === 0 && <div className="muted" style={{ padding: 8 }}>No notes in this folder.</div>}
                {inFolder.map((f) => (
                  <button key={f.name} type="button" className={`tk-export-item${picked === f.name ? " on" : ""}`} onClick={() => setPicked(f.name)}>
                    {baseOf(f.name).replace(/\.md$/, "")}
                  </button>
                ))}
                <label className="tk-export-field">
                  Insert at
                  <select value={position} onChange={(e) => setPosition(e.target.value as "end" | "start")}>
                    <option value="end">End of note</option>
                    <option value="start">Top of note (after front matter)</option>
                  </select>
                </label>
              </>
            ) : (
              <>
                <div className="settings-label">New note name</div>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Note name" style={{ width: "100%" }} />
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Will be created in {folder || "All notes"}.</div>
              </>
            )}
            <label className="tk-check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={linkBack} onChange={(e) => setLinkBack(e.target.checked)} /> Add a line saying which task this came from
            </label>
          </div>
        </div>

        <div className="tk-export-path mono muted">→ {targetPath || "choose a destination"}</div>
        {err && <div className="settings-info" style={{ color: "var(--crit)" }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void doExport()}>
            {busy ? "…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
