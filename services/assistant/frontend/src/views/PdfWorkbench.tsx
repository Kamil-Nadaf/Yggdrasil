import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api } from "../api/client";
import type { ProjectStats } from "../api/client";
import AbstractText from "../components/AbstractText";
import { markdownToLatexDocument } from "../lib/markdownToLatex";

interface FileMeta {
  id: string;
  name: string;
  size: number;
  status: "ready" | "running" | "done" | "error" | "cancelled";
  tier: string;
  pages: string;
  error?: string;
  created?: string;
}
interface Status { mineru: { installed: boolean; version: string }; tiers: string[] }

const TIERS: { id: string; label: string; note: string }[] = [
  { id: "flash", label: "Flash", note: "Fastest. Reads the text layer, so digital PDFs only." },
  { id: "basic", label: "Basic", note: "CPU-friendly OCR and layout. A good default." },
  { id: "standard", label: "Standard", note: "Adds a vision model. Best tables and formulas, but slow without a GPU." },
  { id: "advanced", label: "Advanced", note: "Highest quality and heaviest." },
];

const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const baseOf = (name: string) => name.replace(/\.pdf$/i, "");

async function readError(resp: Response, fallback: string): Promise<string> {
  const b = await resp.json().catch(() => null);
  return b && typeof b.detail === "string" ? b.detail : fallback;
}

// ── small popover menu ───────────────────────────────────────────────────────

function Popover({ label, children, align = "right", disabled }: { label: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="pw-pop" ref={ref}>
      <button className="btn pw-btn" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>{label}</button>
      {open && <div className={`pw-menu pw-menu--${align}`} role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

// ── original PDF, rendered with pdf.js ───────────────────────────────────────

function PdfPage({ pdf, n, width, root }: { pdf: PDFDocumentProxy; n: number; width: number; root: HTMLElement | null }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.3);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible || !canvas.current || width < 50) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      if (cancelled || !canvas.current) return;
      setRatio(viewport.height / viewport.width);
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task.promise;
    })().catch(() => { /* cancelled renders reject */ });
    return () => { cancelled = true; task?.cancel(); };
  }, [visible, pdf, n, width]);

  return (
    <div ref={holder} className="pw-page" data-page={n} style={{ width, height: width * ratio }}>
      <canvas ref={canvas} />
    </div>
  );
}

function PdfPane({ url, zoom, goto, onInfo }: { url: string; zoom: number; goto: { page: number; tick: number }; onInfo: (page: number, total: number) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState("");
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    let dead = false;
    let doc: PDFDocumentProxy | null = null;
    setPdf(null); setErr("");
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Could not load the PDF (${r.status})`);
      doc = await pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
      if (dead) { void doc.destroy(); return; }
      setPdf(doc);
      onInfo(1, doc.numPages);
    })().catch((e) => { if (!dead) setErr(e instanceof Error ? e.message : "Could not open the PDF"); });
    return () => { dead = true; void doc?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => setW(box.clientWidth));
    ro.observe(box);
    setW(box.clientWidth);
    return () => ro.disconnect();
  }, [box]);

  useEffect(() => {
    if (!box || !goto.page) return;
    box.querySelector<HTMLElement>(`[data-page="${goto.page}"]`)?.scrollIntoView({ block: "start" });
  }, [goto, box]);

  function onScroll() {
    if (!box || !pdf) return;
    const top = box.getBoundingClientRect().top;
    let cur = 1;
    for (const el of Array.from(box.querySelectorAll<HTMLElement>("[data-page]"))) {
      if (el.getBoundingClientRect().top - top <= box.clientHeight * 0.3) cur = Number(el.dataset.page);
      else break;
    }
    onInfo(cur, pdf.numPages);
  }

  const width = Math.max(120, (w - 28) * zoom);
  return (
    <div className="pw-scroll" ref={setBox} onScroll={onScroll}>
      {err && <div className="tl-err" style={{ padding: 14 }}>{err}</div>}
      {!pdf && !err && <div className="tl-empty">Loading PDF…</div>}
      {pdf && box && (
        <div className="pw-pages" style={{ width }}>
          {Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={i + 1} pdf={pdf} n={i + 1} width={width} root={box} />)}
        </div>
      )}
    </div>
  );
}

// ── workbench ────────────────────────────────────────────────────────────────

export default function PdfWorkbench({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [md, setMd] = useState("");
  const [tab, setTab] = useState<"preview" | "markdown" | "latex">("preview");
  const [tier, setTier] = useState("basic");
  const [pages, setPages] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 0 });
  const [goto, setGoto] = useState({ page: 0, tick: 0 });
  const [projects, setProjects] = useState<ProjectStats[]>([]);
  const [saveTo, setSaveTo] = useState("");
  const [tickSec, setTickSec] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = files.find((f) => f.id === sel) ?? null;
  const anyRunning = files.some((f) => f.status === "running");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/tools/pdf/files");
      if (!r.ok) throw new Error(await readError(r, "Could not load files"));
      const list: FileMeta[] = (await r.json()).files;
      setFiles(list);
      let want: string | null = null;
      try { want = localStorage.getItem("yggdrasil:pdf-select"); if (want) localStorage.removeItem("yggdrasil:pdf-select"); } catch { /* ignore */ }
      setSel((cur) => (want && list.some((f) => f.id === want) ? want : cur && list.some((f) => f.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    void refresh();
    fetch("/api/tools/pdf/status").then((r) => r.json()).then(setStatus).catch(() => { /* shown by convert errors */ });
    api.projects.list().then((r) => { setProjects(r.projects); setSaveTo(r.projects[0]?.slug ?? ""); }).catch(() => { /* optional */ });
  }, [refresh]);

  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => { void refresh(); setTickSec((s) => s + 1); }, 1500);
    return () => window.clearInterval(t);
  }, [anyRunning, refresh]);

  // The result text follows the selected file and refreshes when its conversion finishes.
  const curStatus = current?.status;
  useEffect(() => {
    setMd("");
    if (!sel || curStatus !== "done") return;
    let dead = false;
    fetch(`/api/tools/pdf/files/${sel}/markdown`).then((r) => (r.ok ? r.text() : "")).then((t) => { if (!dead) setMd(t); }).catch(() => { /* ignore */ });
    return () => { dead = true; };
  }, [sel, curStatus]);

  useEffect(() => { setPageInfo({ page: 1, total: 0 }); setNote(""); }, [sel]);
  useEffect(() => { if (current) { setTier(current.tier || "basic"); setPages(current.pages || ""); } }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(list: FileList | File[]) {
    setErr("");
    for (const f of Array.from(list)) {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { setErr(`${f.name} is not a PDF`); continue; }
      const form = new FormData();
      form.append("file", f);
      form.append("tier", tier);
      form.append("pages", "");
      try {
        const r = await fetch("/api/tools/pdf/files", { method: "POST", body: form });
        if (!r.ok) throw new Error(await readError(r, "Upload failed"));
        const meta: FileMeta = await r.json();
        setFiles((cur) => [meta, ...cur.filter((x) => x.id !== meta.id)]);
        setSel(meta.id);
        setTickSec(0);
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    }
  }

  async function convertAgain() {
    if (!current) return;
    setErr(""); setTickSec(0);
    const form = new FormData();
    form.append("tier", tier);
    form.append("pages", pages);
    const r = await fetch(`/api/tools/pdf/files/${current.id}/convert`, { method: "POST", body: form });
    if (!r.ok) { setErr(await readError(r, "Could not start the conversion")); return; }
    await refresh();
  }

  async function cancel() {
    if (!current) return;
    await fetch(`/api/tools/pdf/files/${current.id}/cancel`, { method: "POST" }).catch(() => { /* ignore */ });
    await refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/tools/pdf/files/${id}`, { method: "DELETE" }).catch(() => { /* ignore */ });
    await refresh();
  }

  const name = baseOf(current?.name ?? "document");
  const latex = useMemo(() => {
    if (!md) return "";
    try { return markdownToLatexDocument(md, name); } catch { return "% Could not convert this document to LaTeX"; }
  }, [md, name]);
  const textFor = (fmt: "md" | "tex") => (fmt === "md" ? md : latex);

  function download(fmt: "md" | "tex") {
    const url = URL.createObjectURL(new Blob([textFor(fmt)], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${fmt}`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function copy(fmt: "md" | "tex") {
    try { await navigator.clipboard.writeText(textFor(fmt)); setNote(`Copied ${fmt === "md" ? "Markdown" : "LaTeX"}`); } catch { setNote("Copy failed"); }
  }
  async function saveToProject(fmt: "md" | "tex") {
    if (!saveTo) return;
    try {
      await api.projects.upload(saveTo, new File([textFor(fmt)], `${name}.${fmt}`, { type: "text/plain" }));
      setNote(`Saved ${name}.${fmt} to ${projects.find((p) => p.slug === saveTo)?.name ?? saveTo}`);
    } catch (e) { setNote(e instanceof Error ? e.message : "Save failed"); }
  }

  const done = current?.status === "done" && !!md;
  const running = current?.status === "running";
  const pdfUrl = current ? `/api/tools/pdf/files/${current.id}/pdf` : "";
  const mins = Math.floor((tickSec * 1.5) / 60);
  const secs = Math.round(tickSec * 1.5) % 60;

  return (
    <div
      className={`pw${drag ? " pw--drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}
    >
      <aside className="pw-side">
        <button className="btn tl-back" onClick={onBack}>← Tools</button>
        <div className="pw-brand">PDF → Markdown</div>
        <button className="btn pw-add" onClick={() => inputRef.current?.click()}>+ Add PDF</button>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
        <ul className="pw-files">
          {files.map((f) => (
            <li key={f.id}>
              <button className={`pw-file${f.id === sel ? " on" : ""}`} onClick={() => setSel(f.id)}>
                <span className={`pw-dot pw-dot--${f.status}`} title={f.status} />
                <span className="pw-file-main">
                  <span className="pw-file-name">{f.name}</span>
                  <span className="pw-file-meta">{sizeLabel(f.size)} · {f.status === "running" ? "converting…" : f.status === "done" ? f.tier : f.status === "ready" ? "not converted" : f.status}</span>
                </span>
              </button>
              <button className="pw-x" onClick={() => void remove(f.id)} title="Remove this file" aria-label={`Remove ${f.name}`}>×</button>
            </li>
          ))}
        </ul>
        {files.length === 0 && <div className="tl-help" style={{ padding: "0 4px" }}>Added files appear here. Drop PDFs anywhere on this page.</div>}
        <div className="pw-foot">{status === null ? "" : status.mineru.installed ? `MinerU ${status.mineru.version}` : "MinerU is not installed"}</div>
      </aside>

      <section className="pw-main">
        {!current ? (
          <div className="pw-blank">
            <button className="pw-drop" onClick={() => inputRef.current?.click()}>
              <b>Drop a PDF here</b>
              <span>or click to choose · up to 100 MB</span>
            </button>
            {err && <div className="tl-err">{err}</div>}
          </div>
        ) : (
          <>
            <div className="pw-top">
              <div className="pw-title" title={current.name}>{current.name}</div>
              <span className="tl-spacer" />
              <select className="pw-sel" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Quality tier" title={TIERS.find((t) => t.id === tier)?.note}>
                {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input className="pw-pages-in" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="Pages: all" aria-label="Pages to convert" />
              {running
                ? <button className="btn pw-btn" onClick={() => void cancel()}>Cancel</button>
                : <button className="btn pw-btn" onClick={() => void convertAgain()}>{current.status === "done" ? "Convert again" : "Convert"}</button>}
              <button className="btn pw-btn" onClick={() => void copy(tab === "latex" ? "tex" : "md")} disabled={!done}>Copy</button>
              <Popover label="Save ▾" disabled={!done}>
                {(close) => (
                  <>
                    <div className="pw-menu-h">Save to project</div>
                    <select className="pw-sel pw-menu-sel" value={saveTo} onChange={(e) => setSaveTo(e.target.value)} aria-label="Project">
                      {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                    </select>
                    <button className="pw-item" disabled={!saveTo} onClick={() => { void saveToProject("md"); close(); }}>Markdown <i>.md</i></button>
                    <button className="pw-item" disabled={!saveTo} onClick={() => { void saveToProject("tex"); close(); }}>LaTeX <i>.tex</i></button>
                  </>
                )}
              </Popover>
              <Popover label="Download ▾" disabled={!done}>
                {(close) => (
                  <>
                    <div className="pw-menu-h">Download as</div>
                    <button className="pw-item" onClick={() => { download("md"); close(); }}>Markdown <i>.md</i></button>
                    <button className="pw-item" onClick={() => { download("tex"); close(); }}>LaTeX <i>.tex</i></button>
                  </>
                )}
              </Popover>
            </div>
            {(err || note) && <div className={err ? "tl-err pw-msg" : "tl-help pw-msg"}>{err || note}</div>}

            <div className="pw-cols">
              <div className="pw-col">
                <div className="pw-col-bar">
                  <span className="pw-col-title">Original file</span>
                  <span className="tl-spacer" />
                  <button className="pw-ic" onClick={() => setGoto({ page: Math.max(1, pageInfo.page - 1), tick: Date.now() })} disabled={pageInfo.page <= 1} aria-label="Previous page">‹</button>
                  <span className="pw-pg">{pageInfo.page} / {pageInfo.total || "–"}</span>
                  <button className="pw-ic" onClick={() => setGoto({ page: Math.min(pageInfo.total, pageInfo.page + 1), tick: Date.now() })} disabled={pageInfo.page >= pageInfo.total} aria-label="Next page">›</button>
                  <button className="pw-ic" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} aria-label="Zoom out">−</button>
                  <span className="pw-pg">{Math.round(zoom * 100)}%</span>
                  <button className="pw-ic" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))} aria-label="Zoom in">+</button>
                </div>
                <PdfPane url={pdfUrl} zoom={zoom} goto={goto} onInfo={(page, total) => setPageInfo({ page, total })} />
              </div>

              <div className="pw-col">
                <div className="pw-col-bar">
                  <div className="pw-tabs" role="tablist">
                    {(["preview", "markdown", "latex"] as const).map((t) => (
                      <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "latex" ? "LaTeX" : t === "markdown" ? "Markdown" : "Preview"}</button>
                    ))}
                  </div>
                </div>
                <div className="pw-scroll pw-result">
                  {running && (
                    <div className="pw-run">
                      <div className="tl-bar-track"><div className="tl-bar-fill indet" /></div>
                      <div className="tl-help">MinerU ({current.tier}) is reading the document · {mins}:{String(secs).padStart(2, "0")}. The first run downloads models, so it can take a few minutes.</div>
                    </div>
                  )}
                  {current.status === "error" && <div className="tl-err pw-msg">{current.error || "Conversion failed"}</div>}
                  {current.status === "cancelled" && <div className="tl-empty">Cancelled. Press Convert to try again.</div>}
                  {current.status === "ready" && <div className="tl-empty">Added, not converted yet. Pick a tier and pages above, then press Convert. Long books can take a while.</div>}
                  {done && tab === "preview" && <AbstractText text={md} className="pw-md" />}
                  {done && tab === "markdown" && <pre className="tl-out">{md}</pre>}
                  {done && tab === "latex" && <pre className="tl-out">{latex}</pre>}
                  {current.status === "done" && !md && <div className="tl-empty">Loading result…</div>}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
