import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { ProjectFile, ProjectStats, TaskItem } from "../api/client";
import { reading, type ReadingBook } from "../api/reading";
import { LatexPromptModal } from "../components/LatexMenuBar";
import MarkdownNotesTab from "./MarkdownNotesTab";
import TasksView, { type TasksTab } from "./TasksView";
import SlidesView from "./SlidesView";
import BookReader from "./books/BookReader";
import TaskPanel from "./tasks/TaskPanel";
import { doneStatusId } from "./tasks/TaskBits";
import { useNow, useTaskData } from "./tasks/useTaskData";
import "./projects.css";

type Tab = "overview" | "tasks" | "notes" | "documents" | "slides" | "paper" | "reading";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
  { id: "documents", label: "Documents" },
  { id: "slides", label: "Slides" },
  { id: "paper", label: "Paper writing" },
  { id: "reading", label: "Reading" },
];
const OPEN_KEY = "yggdrasil:project-open";
const TAB_KEY = "yggdrasil:project-tab";
const tagOf = (slug: string) => `project:${slug}`;

function ls(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function setLs(key: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* optional */ }
}
function today(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function dueLabel(d: string | null | undefined): { text: string; cls: string } | null {
  if (!d) return null;
  const t = today();
  const days = Math.round((Date.parse(d.slice(0, 10)) - Date.parse(t)) / 86400000);
  const when = new Date(d.slice(0, 10) + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (days < 0) return { text: `${when} · ${-days}d overdue`, cls: "pj-over" };
  if (days === 0) return { text: "Today", cls: "pj-soon" };
  if (days <= 7) return { text: `${when} · in ${days}d`, cls: "pj-soon" };
  return { text: when, cls: "" };
}
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export default function ProjectsView({ onOpenLatex }: { onOpenLatex?: () => void }) {
  const [list, setList] = useState<ProjectStats[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(() => ls(OPEN_KEY));
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await api.projects.list()).projects);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load projects");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Phone/desktop stay consistent: refresh when the app comes back to the foreground.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const openProject = (slug: string | null) => { setOpen(slug); setLs(OPEN_KEY, slug); };
  const current = list?.find((p) => p.slug === open) ?? null;

  async function createProject(name: string) {
    setNewOpen(false);
    try {
      const r = await api.taskProjects.create(name);
      await load();
      openProject(r.project.slug);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create project");
    }
  }

  if (open && list && !current) {
    // The project was deleted elsewhere.
    setOpen(null);
    setLs(OPEN_KEY, null);
  }

  return (
    <div className="pj-page">
      {err && <div className="tk-error" role="alert">{err} <button type="button" className="tk-link" onClick={() => setErr(null)}>dismiss</button></div>}
      {current ? (
        <Workspace project={current} onBack={() => { openProject(null); void load(); }} onChanged={() => void load()} onOpenLatex={onOpenLatex} />
      ) : (
        <>
          <div className="pj-head">
            <h2>Projects</h2>
            <span className="muted">Tasks, notes, documents, papers and reading — one place per project.</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>+ New project</button>
          </div>
          {!list && <div className="muted tk-empty">Loading…</div>}
          {list && list.length === 0 && <div className="muted tk-empty">No projects yet. Create one to start.</div>}
          <div className="pj-grid">
            {list?.map((p) => {
              const due = dueLabel(p.next_deadline);
              return (
                <button key={p.slug} type="button" className="pj-card" onClick={() => openProject(p.slug)}>
                  <div className="pj-card-top">
                    <strong>{p.name}</strong>
                    {p.overdue > 0 && <span className="pj-badge pj-over">{p.overdue} overdue</span>}
                  </div>
                  <div className="pj-bar" aria-label={`${p.progress}% done`}><i style={{ width: `${p.progress}%` }} /></div>
                  <div className="pj-meta muted">{p.done_count}/{p.task_count} tasks · {p.progress}%{due ? <> · next <span className={due.cls}>{due.text}</span></> : null}</div>
                  <div className="pj-chips">
                    <span>{p.starred} ★</span><span>{p.notes} notes</span><span>{p.files} docs</span><span>{p.latex.length} drafts</span><span>{p.reading} readings</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
      <LatexPromptModal open={newOpen} title="New project" label="Project name" confirmLabel="Create" onClose={() => setNewOpen(false)} onConfirm={(v) => v.trim() && void createProject(v.trim())} />
    </div>
  );
}

function Workspace({ project, onBack, onChanged, onOpenLatex }: { project: ProjectStats; onBack: () => void; onChanged: () => void; onOpenLatex?: () => void }) {
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === ls(TAB_KEY)) ? (ls(TAB_KEY) as Tab) : "overview"));
  const go = (t: Tab) => { setTab(t); setLs(TAB_KEY, t); };
  const count: Partial<Record<Tab, number>> = { tasks: project.task_count, notes: project.notes, documents: project.files, paper: project.latex.length, reading: project.reading };
  return (
    <div className="pj-ws">
      <div className="pj-head">
        <button type="button" className="btn" onClick={onBack}>← Projects</button>
        <h2>{project.name}</h2>
        <div className="pj-bar pj-bar-lg"><i style={{ width: `${project.progress}%` }} /></div>
        <span className="muted">{project.progress}% · {project.done_count}/{project.task_count}</span>
      </div>
      <div className="tk-seg pj-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tk-seg-b${tab === t.id ? " on" : ""}`} onClick={() => go(t.id)}>
            {t.label}{count[t.id] ? <em>{count[t.id]}</em> : null}
          </button>
        ))}
      </div>
      <div className="pj-body">
        {tab === "overview" && <Overview project={project} onChanged={onChanged} onGo={go} />}
        {tab === "tasks" && <ProjectTasks slug={project.slug} onChanged={onChanged} />}
        {tab === "notes" && <div className="pj-notes"><MarkdownNotesTab key={project.slug} section={project.name} rootFolder={`Projects/${project.slug}`} /></div>}
        {tab === "documents" && <Documents project={project} onChanged={onChanged} />}
        {tab === "slides" && <div className="pj-slides"><SlidesView lockedProject={project.slug} /></div>}
        {tab === "paper" && <PaperWriting project={project} onChanged={onChanged} onOpenLatex={onOpenLatex} />}
        {tab === "reading" && <Reading project={project} onChanged={onChanged} />}
      </div>
    </div>
  );
}

function ProjectTasks({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const [t, setT] = useState<TasksTab>("list");
  useEffect(() => () => onChanged(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="tk-seg pj-sub" role="tablist">
        {(["list", "board"] as TasksTab[]).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={t === x} className={`tk-seg-b${t === x ? " on" : ""}`} onClick={() => setT(x)}>{x === "list" ? "List" : "Kanban"}</button>
        ))}
      </div>
      <TasksView lockedProject={slug} requestTab={t} onTabChange={setT} />
    </>
  );
}

function Overview({ project, onChanged, onGo }: { project: ProjectStats; onChanged: () => void; onGo: (t: Tab) => void }) {
  const data = useTaskData();
  const [openRef, setOpenRef] = useState<string | null>(null);
  const items = data.items.filter((i) => i.project_slug === project.slug);
  const doneId = doneStatusId(data.statuses);
  const now = useNow(items.some((i) => i.timer_started_at));
  const t = today();
  const open = items.filter((i) => i.status_id !== doneId);
  const overdue = open.filter((i) => i.deadline && i.deadline.slice(0, 10) < t);
  const soon = open.filter((i) => i.deadline && i.deadline.slice(0, 10) >= t && Date.parse(i.deadline.slice(0, 10)) - Date.parse(t) <= 7 * 86400000);
  const starred = open.filter((i) => i.kind === "main" && i.is_active);
  const sorted = (a: TaskItem[]) => [...a].sort((x, y) => (x.deadline || "9").localeCompare(y.deadline || "9"));
  const toggle = async (it: TaskItem) => { await data.patch(it, { status_id: it.status_id === doneId ? data.statuses[0]?.id ?? "todo" : doneId }); onChanged(); };
  const star = async (it: TaskItem) => { if (it.kind !== "main") return; await data.patch(it, { is_active: !it.is_active }); onChanged(); };

  const group = (title: string, arr: TaskItem[], cls = "") => arr.length === 0 ? null : (
    <section className="pj-group">
      <h3 className={cls}>{title} <em>{arr.length}</em></h3>
      {sorted(arr).map((it) => {
        const d = dueLabel(it.deadline);
        return (
          <div key={it.ref} className="pj-task">
            <input type="checkbox" checked={it.status_id === doneId} onChange={() => void toggle(it)} aria-label={`Mark ${it.name} done`} />
            <button type="button" className="tk-link pj-task-name" onClick={() => setOpenRef(it.ref)}>{it.kind === "subtask" ? `${it.main_task_name} › ` : ""}{it.name}</button>
            {d && <span className={`pj-due ${d.cls}`}>{d.text}</span>}
            {it.kind === "main" && <button type="button" className={`pj-star${it.is_active ? " on" : ""}`} onClick={() => void star(it)} aria-label={it.is_active ? "Unstar" : "Star"}>★</button>}
          </div>
        );
      })}
    </section>
  );

  return (
    <div className="pj-overview">
      <div className="pj-stats">
        <div><b>{project.progress}%</b><span>{project.done_count}/{project.task_count} done</span></div>
        <div><b className={project.overdue ? "pj-over" : ""}>{project.overdue}</b><span>overdue</span></div>
        <div><b>{project.due_soon}</b><span>due in 7 days</span></div>
        <div><b>{project.starred}</b><span>starred</span></div>
        <button type="button" onClick={() => onGo("notes")}><b>{project.notes}</b><span>notes</span></button>
        <button type="button" onClick={() => onGo("documents")}><b>{project.files}</b><span>documents</span></button>
        <button type="button" onClick={() => onGo("reading")}><b>{project.reading}</b><span>readings</span></button>
      </div>
      {data.loading && <div className="muted tk-empty">Loading…</div>}
      {group("Overdue", overdue, "pj-over")}
      {group("Due in the next 7 days", soon)}
      {group("Starred", starred.filter((i) => !overdue.includes(i) && !soon.includes(i)))}
      {!data.loading && overdue.length + soon.length + starred.length === 0 && <div className="muted tk-empty">Nothing due or starred. <button type="button" className="tk-link" onClick={() => onGo("tasks")}>Open tasks</button></div>}
      {openRef && <TaskPanel key={openRef} itemRef={openRef} data={data} now={now} onClose={() => { setOpenRef(null); onChanged(); }} onOpenOther={setOpenRef} />}
    </div>
  );
}

function Documents({ project, onChanged }: { project: ProjectStats; onChanged: () => void }) {
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [msg, setMsg] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try { setFiles((await api.projects.files(project.slug)).files); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not load files"); }
  }, [project.slug]);
  useEffect(() => { void load(); }, [load]);
  async function add(fl: FileList | null) {
    if (!fl) return;
    for (const f of Array.from(fl)) {
      setMsg(`Uploading ${f.name}…`);
      try { await api.projects.upload(project.slug, f); } catch (e) { setMsg(e instanceof Error ? e.message : "Upload failed"); return; }
    }
    setMsg("");
    await load();
    onChanged();
  }
  async function del(name: string) {
    if (!window.confirm(`Delete ${name}?`)) return;
    await api.projects.deleteFile(project.slug, name).catch((e) => setMsg(e instanceof Error ? e.message : "Delete failed"));
    await load();
    onChanged();
  }
  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}>
      <div className="pj-bar-row">
        <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>Upload files</button>
        <input ref={input} type="file" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <span className="muted">{msg || "Drop files here — PDFs, data, figures, slides (up to 100 MB each)."}</span>
      </div>
      {files && files.length === 0 && <div className="muted tk-empty">No documents yet.</div>}
      <div className="pj-files">
        {files?.map((f) => (
          <div key={f.name} className="pj-file">
            <a href={api.projects.fileUrl(project.slug, f.name)} target="_blank" rel="noreferrer">{f.name}</a>
            <span className="muted">{fmtSize(f.size)} · {f.modified.slice(0, 10)}</span>
            <button type="button" className="tk-x" aria-label={`Delete ${f.name}`} onClick={() => void del(f.name)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaperWriting({ project, onChanged, onOpenLatex }: { project: ProjectStats; onChanged: () => void; onOpenLatex?: () => void }) {
  const [folders, setFolders] = useState<string[]>([]);
  const [linked, setLinked] = useState<string[]>(project.latex);
  const [newOpen, setNewOpen] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.latex.listFiles().then((r) => setFolders((r.folders ?? []).filter((f) => !f.startsWith("_") && !f.includes("/")))).catch(() => {}); }, []);
  async function save(next: string[]) {
    try { const r = await api.projects.setLatex(project.slug, next); setLinked(r.latex); onChanged(); setErr(""); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
  }
  async function create(name: string) {
    setNewOpen(false);
    const clean = name.trim().replace(/[^A-Za-z0-9._ -]+/g, "-");
    if (!clean) return;
    try { await api.latex.createFolder(clean); setFolders((f) => (f.includes(clean) ? f : [...f, clean])); await save([...linked, clean]); } catch (e) { setErr(e instanceof Error ? e.message : "Could not create folder"); }
  }
  const openIn = (folder: string) => { setLs("yggdrasil:latex-open-folder", folder); onOpenLatex?.(); };
  const unlinked = folders.filter((f) => !linked.includes(f));
  return (
    <div>
      <div className="pj-bar-row">
        <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>+ New paper</button>
        {unlinked.length > 0 && (
          <select value="" aria-label="Link an existing LaTeX folder" onChange={(e) => e.target.value && void save([...linked, e.target.value])}>
            <option value="">Link existing LaTeX folder…</option>
            {unlinked.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {err && <span className="pj-over">{err}</span>}
      </div>
      {linked.length === 0 && <div className="muted tk-empty">No drafts linked. Create a paper or link an existing LaTeX folder.</div>}
      <div className="pj-files">
        {linked.map((f) => (
          <div key={f} className="pj-file">
            <button type="button" className="tk-link" onClick={() => openIn(f)}>{f}</button>
            <span className="muted">{folders.includes(f) ? "LaTeX folder" : "folder not found"}</span>
            <button type="button" className="btn" onClick={() => openIn(f)}>Open in LaTeX</button>
            <button type="button" className="tk-x" aria-label={`Unlink ${f}`} onClick={() => void save(linked.filter((x) => x !== f))}>×</button>
          </div>
        ))}
      </div>
      <LatexPromptModal open={newOpen} title="New paper" label="Folder name" confirmLabel="Create" onClose={() => setNewOpen(false)} onConfirm={(v) => void create(v)} />
    </div>
  );
}

function Reading({ project, onChanged }: { project: ProjectStats; onChanged: () => void }) {
  const [all, setAll] = useState<ReadingBook[] | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const tag = tagOf(project.slug);
  const load = useCallback(async () => { try { setAll((await reading.library()).books); } catch { setAll([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  const mine = useMemo(() => (all ?? []).filter((b) => b.tags.includes(tag)), [all, tag]);
  const candidates = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (all ?? []).filter((b) => !b.tags.includes(tag) && (!n || `${b.title} ${b.authors.join(" ")} ${b.year ?? ""}`.toLowerCase().includes(n))).slice(0, 30);
  }, [all, tag, q]);
  async function setMember(b: ReadingBook, on: boolean) {
    const tags = on ? [...b.tags, tag] : b.tags.filter((t) => t !== tag);
    await reading.patch(b.slug, { tags }).catch(() => {});
    await load();
    onChanged();
  }
  const opened = openSlug ? mine.find((b) => b.slug === openSlug) ?? null : null;
  if (opened) {
    const i = mine.findIndex((b) => b.slug === opened.slug);
    return (
      <div className="pj-reader">
        <BookReader key={opened.slug} book={opened} onBack={() => { setOpenSlug(null); void load(); }} onChanged={() => void load()}
          onPrev={i > 0 ? () => setOpenSlug(mine[i - 1].slug) : undefined}
          onNext={i < mine.length - 1 ? () => setOpenSlug(mine[i + 1].slug) : undefined} />
      </div>
    );
  }
  return (
    <div>
      <div className="pj-bar-row">
        <button type="button" className="btn btn-primary" onClick={() => setAdding((v) => !v)}>{adding ? "Done" : "+ Add from collection"}</button>
        <span className="muted">Tagged <code>{tag}</code> — also visible in Collection.</span>
      </div>
      {adding && (
        <div className="pj-add">
          <input type="search" placeholder="Search your collection…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {candidates.map((b) => (
            <div key={b.slug} className="pj-file">
              <span className="pj-rt">{b.title}</span><span className="muted">{b.kind} · {b.authors[0] ?? ""}{b.year ? ` ${b.year}` : ""}</span>
              <button type="button" className="btn" onClick={() => void setMember(b, true)}>Add</button>
            </div>
          ))}
          {all && candidates.length === 0 && <div className="muted">No matches.</div>}
        </div>
      )}
      {all && mine.length === 0 && !adding && <div className="muted tk-empty">Nothing tagged yet. Add items here, or use “Add to project” on any paper or book in Collection.</div>}
      <div className="pj-files">
        {mine.map((b) => (
          <div key={b.slug} className="pj-file">
            <button type="button" className="tk-link pj-rt" onClick={() => (b.has_file ? setOpenSlug(b.slug) : undefined)} disabled={!b.has_file} title={b.has_file ? "Open reader" : "No file attached"}>{b.title}</button>
            <span className="muted">{b.kind} · {b.status}{b.progress ? ` · ${Math.round(b.progress)}%` : ""}</span>
            <button type="button" className="tk-x" aria-label={`Remove ${b.title} from project`} onClick={() => void setMember(b, false)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
