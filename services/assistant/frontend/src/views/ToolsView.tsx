import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/client";
import type { ProjectStats } from "../api/client";
import { activeEnginePayload, loadEngines } from "../lib/canvasEngines";
import { markdownToLatexDocument } from "../lib/markdownToLatex";
import SlidesView from "./SlidesView";
import GraphView from "./GraphView";
import "./tools.css";

type Page = "hub" | "pdf" | "slides" | "graph";
const PAGE_KEY = "yggdrasil:tools-page";

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

interface Props {
  onOpenEditor: (citekey: string) => void;
}

/** Tools: a hub for small utilities. Slides and Graph live here; PDF → Markdown / LaTeX is the first real tool. */
export default function ToolsView({ onOpenEditor }: Props) {
  const [page, setPage] = useState<Page>(() => {
    const p = lsGet(PAGE_KEY) as Page | null;
    return p === "pdf" || p === "slides" || p === "graph" ? p : "hub";
  });
  const go = (p: Page) => { setPage(p); lsSet(PAGE_KEY, p); };

  if (page === "graph") {
    return (
      <div className="tl-wrap tl-wrap--full">
        <TopBar title="Graph" onBack={() => go("hub")} />
        <div className="tl-fill"><GraphView onOpenEditor={onOpenEditor} /></div>
      </div>
    );
  }
  if (page === "slides") return <SlidesTool onBack={() => go("hub")} />;
  if (page === "pdf") {
    return (
      <div className="tl-wrap">
        <TopBar title="PDF → Markdown / LaTeX" onBack={() => go("hub")} />
        <PdfTool />
      </div>
    );
  }

  const cards: { id: Page; title: string; desc: string; tag: string; icon: ReactNode }[] = [
    { id: "pdf", title: "PDF → Markdown / LaTeX", desc: "Turn papers and scans into clean Markdown or LaTeX. Uses MinerU when installed, otherwise your vision engines.", tag: "MinerU", icon: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" /> },
    { id: "slides", title: "Slides", desc: "Every deck from every project in one place. Filter by project, open, present.", tag: "Decks", icon: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></> },
    { id: "graph", title: "Graph", desc: "The knowledge graph of your notes, papers and keywords.", tag: "Explore", icon: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7l8 1M7 8l4 8M17 10l-4 6" /></> },
  ];
  return (
    <div className="tl-wrap">
      <div className="tl-hero">
        <h1>Tools</h1>
        <p>Small utilities that earn their place. New ones land here.</p>
      </div>
      <div className="tl-grid">
        {cards.map((c) => (
          <button key={c.id} className="tl-card" onClick={() => go(c.id)}>
            <span className="tl-card-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{c.icon}</svg></span>
            <span className="tl-card-title">{c.title}</span>
            <span className="tl-card-desc">{c.desc}</span>
            <span className="tl-tag">{c.tag}</span>
          </button>
        ))}
        <div className="tl-card tl-card--ghost"><span className="tl-card-title">More tools soon</span><span className="tl-card-desc">Add one by registering it here.</span></div>
      </div>
    </div>
  );
}

function TopBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="tl-bar">
      <button className="btn tl-back" onClick={onBack}>← Tools</button>
      <span className="tl-bar-title">{title}</span>
      <span className="tl-spacer" />
      {right}
    </div>
  );
}

// ── Slides across projects ───────────────────────────────────────────────────

type DeckRow = { project: ProjectStats; name: string; updated_at: string };

function SlidesTool({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<DeckRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectStats[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [openDeck, setOpenDeck] = useState<{ slug: string; name: string } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const { projects: ps } = await api.projects.list();
      setProjects(ps);
      const all = await Promise.all(ps.map((p) => api.projects.decks(p.slug).then((r) => r.decks.map((d) => ({ project: p, name: d.name, updated_at: d.updated_at }))).catch(() => [] as DeckRow[])));
      setRows(all.flat().sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (openDeck) {
    return (
      <div className="tl-wrap tl-wrap--full">
        <TopBar title={`Slides · ${projects.find((p) => p.slug === openDeck.slug)?.name ?? openDeck.slug}`} onBack={() => { setOpenDeck(null); void load(); }} />
        <div className="tl-fill"><SlidesView lockedProject={openDeck.slug} initialDeck={openDeck.name} /></div>
      </div>
    );
  }
  const counts = new Map<string, number>();
  (rows ?? []).forEach((r) => counts.set(r.project.slug, (counts.get(r.project.slug) ?? 0) + 1));
  const shown = (rows ?? []).filter((r) => filter === "all" || r.project.slug === filter);
  return (
    <div className="tl-wrap">
      <TopBar title="Slides" onBack={onBack} />
      <div className="tl-chips">
        <button className={`tl-chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>All <b>{rows?.length ?? 0}</b></button>
        {projects.map((p) => (
          <button key={p.slug} className={`tl-chip${filter === p.slug ? " on" : ""}`} onClick={() => setFilter(p.slug)}>{p.name} <b>{counts.get(p.slug) ?? 0}</b></button>
        ))}
        {filter !== "all" && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setOpenDeck({ slug: filter, name: "" })}>Manage {projects.find((p) => p.slug === filter)?.name}…</button>}
      </div>
      {err && <div className="tl-err">{err}</div>}
      {rows === null ? <div className="tl-empty">Loading decks…</div> : shown.length === 0 ? (
        <div className="tl-empty">No decks{filter !== "all" ? " in this project" : ""} yet. Open a project's Slides to create one.</div>
      ) : (
        <ul className="tl-decks">
          {shown.map((r) => (
            <li key={r.project.slug + "/" + r.name}>
              <button className="tl-deck" onClick={() => setOpenDeck({ slug: r.project.slug, name: r.name })}>
                <span className="tl-deck-name">{r.name}</span>
                <span className="tl-deck-proj">{r.project.name}</span>
                <span className="tl-deck-date">{r.updated_at.replace("T", " ").slice(0, 16)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── PDF → Markdown / LaTeX ───────────────────────────────────────────────────

interface PdfStatus { mineru: { installed: boolean; version: string }; vision: { available: boolean }; tiers: string[]; hint: string }
interface Job { id: string; status: "running" | "done" | "error" | "cancelled"; done: number; total: number; message: string; error?: string; result?: { text: string; format: "markdown" | "latex"; converter: string; pages: number }; partial?: string }

const TIER_NOTE: Record<string, string> = {
  flash: "Fastest. Reads the text layer — digital PDFs only.",
  basic: "CPU-friendly OCR and layout. Good default.",
  standard: "Adds a vision model: best tables and formulas, slow without a GPU.",
  advanced: "Highest quality, heaviest.",
};

function PdfTool() {
  const [status, setStatus] = useState<PdfStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState<"markdown" | "latex">("markdown");
  const [tier, setTier] = useState("basic");
  const [pages, setPages] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState<"text" | "source">("text");
  const [projects, setProjects] = useState<ProjectStats[]>([]);
  const [saveTo, setSaveTo] = useState("");
  const [note, setNote] = useState("");
  const pollRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/tools/pdf/status").then((r) => r.json()).then(setStatus).catch((e) => setErr(String(e)));
    api.projects.list().then((r) => { setProjects(r.projects); setSaveTo(r.projects[0]?.slug ?? ""); }).catch(() => { /* optional */ });
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const engines = useMemo(() => activeEnginePayload(loadEngines()), []);
  const running = job?.status === "running";

  function stopPoll() { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } }

  async function start() {
    if (!file) return;
    setErr(""); setNote(""); setJob(null);
    const form = new FormData();
    form.append("file", file);
    form.append("output", output);
    form.append("tier", tier);
    form.append("pages", pages);
    form.append("engines", JSON.stringify(engines));
    try {
      const resp = await fetch("/api/tools/pdf/convert", { method: "POST", body: form });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not start the conversion");
      const id = body.job_id as string;
      setJob({ id, status: "running", done: 0, total: 0, message: "Starting" });
      pollRef.current = window.setInterval(async () => {
        try {
          const j: Job = await fetch(`/api/tools/pdf/jobs/${id}`).then((r) => r.json());
          setJob(j);
          if (j.status !== "running") stopPoll();
        } catch { /* keep polling */ }
      }, 1200);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  async function cancel() {
    if (!job) return;
    stopPoll();
    await fetch(`/api/tools/pdf/jobs/${job.id}`, { method: "DELETE" }).catch(() => { /* ignore */ });
    setJob({ ...job, status: "cancelled", message: "Cancelled" });
  }

  const baseName = (file?.name ?? "document.pdf").replace(/\.pdf$/i, "");
  // MinerU hands back Markdown; LaTeX output converts it here with the same converter Notes uses.
  const finalText = useMemo(() => {
    const r = job?.result;
    if (!r) return "";
    if (output === "latex" && r.format === "markdown") return markdownToLatexDocument(r.text, baseName);
    if (output === "latex" && !/\\begin\{document\}/.test(r.text)) {
      return `\\documentclass{article}\n\\usepackage{amsmath,amssymb,graphicx}\n\\begin{document}\n\n${r.text}\n\n\\end{document}\n`;
    }
    return r.text;
  }, [job?.result, output, baseName]);
  const ext = output === "latex" ? "tex" : "md";

  function download() {
    const url = URL.createObjectURL(new Blob([finalText], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${baseName}.${ext}`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(finalText); setNote("Copied"); } catch { setNote("Copy failed"); }
  }
  async function saveToProject() {
    if (!saveTo) return;
    try {
      await api.projects.upload(saveTo, new File([finalText], `${baseName}.${ext}`, { type: "text/plain" }));
      setNote(`Saved to ${projects.find((p) => p.slug === saveTo)?.name ?? saveTo} as ${baseName}.${ext}`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Save failed"); }
  }

  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const noEngine = status && !status.mineru.installed && engines.length === 0;
  const preview = job?.result ? finalText : job?.partial ?? "";

  return (
    <div className="tl-pdf">
      <div className="tl-pdf-side">
        <div
          className={`tl-drop${drag ? " drag" : ""}${file ? " has" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
          onClick={() => inputRef.current?.click()}
          role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.click(); }}
        >
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
          {file ? <><b>{file.name}</b><span>{(file.size / 1048576).toFixed(1)} MB · click to change</span></> : <><b>Drop a PDF here</b><span>or click to choose · up to 100 MB</span></>}
        </div>

        <label className="tl-lab">Output</label>
        <div className="theme-mode-toggle">
          <button className={output === "markdown" ? "active" : ""} onClick={() => setOutput("markdown")}>Markdown</button>
          <button className={output === "latex" ? "active" : ""} onClick={() => setOutput("latex")}>LaTeX</button>
        </div>

        {status?.mineru.installed && (
          <>
            <label className="tl-lab">Quality tier</label>
            <div className="theme-mode-toggle">
              {status.tiers.map((t) => <button key={t} className={tier === t ? "active" : ""} onClick={() => setTier(t)}>{t}</button>)}
            </div>
            <div className="tl-help">{TIER_NOTE[tier]}</div>
          </>
        )}

        <label className="tl-lab">Pages <span>(optional)</span></label>
        <input className="tl-input" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="all — or e.g. 1-5, 8" />

        <div className="tl-engine">
          {status === null ? "Checking converters…" : status.mineru.installed
            ? <>Converter: <b>MinerU {status.mineru.version}</b></>
            : <>Converter: <b>vision engines</b>{engines.length ? ` (${engines[0].label || "first enabled engine"})` : ""}</>}
        </div>
        {status && !status.mineru.installed && <div className="tl-help">{status.hint}</div>}
        {noEngine && <div className="tl-warn">No vision engine is enabled. Add LM Studio or a free Gemini key in the Canvas engine settings, then come back.</div>}

        <div className="tl-actions">
          <button className="btn tl-primary" onClick={() => void start()} disabled={!file || running || !!noEngine}>{running ? "Converting…" : "Convert"}</button>
          {running && <button className="btn" onClick={() => void cancel()}>Cancel</button>}
        </div>
        {err && <div className="tl-err">{err}</div>}
      </div>

      <div className="tl-pdf-main">
        {!job ? (
          <div className="tl-empty">The result appears here. Pick a PDF and press Convert.</div>
        ) : (
          <>
            <div className="tl-prog">
              <div className="tl-prog-top">
                <span>{job.status === "error" ? "Failed" : job.status === "cancelled" ? "Cancelled" : job.status === "done" ? `Done · ${job.result?.converter}` : job.message}</span>
                {job.total > 0 && job.status === "running" && <span>{job.done}/{job.total} pages</span>}
              </div>
              <div className="tl-bar-track"><div className={`tl-bar-fill${job.status === "running" && !job.total ? " indet" : ""}`} style={{ width: job.status === "done" ? "100%" : `${pct}%` }} /></div>
              {job.error && <div className="tl-err">{job.error}</div>}
            </div>
            {preview && (
              <>
                <div className="tl-res-bar">
                  <div className="theme-mode-toggle">
                    <button className={view === "text" ? "active" : ""} onClick={() => setView("text")}>Text</button>
                    <button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>Wrap</button>
                  </div>
                  <span className="tl-spacer" />
                  {job.status === "done" && (
                    <>
                      <button className="btn" onClick={() => void copy()}>Copy</button>
                      <button className="btn" onClick={download}>Download .{ext}</button>
                      {projects.length > 0 && (
                        <>
                          <select value={saveTo} onChange={(e) => setSaveTo(e.target.value)} aria-label="Project">
                            {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                          </select>
                          <button className="btn" onClick={() => void saveToProject()}>Save to project</button>
                        </>
                      )}
                    </>
                  )}
                </div>
                {note && <div className="tl-help">{note}</div>}
                <pre className={`tl-out${view === "source" ? " wrap" : ""}`}>{preview}</pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
