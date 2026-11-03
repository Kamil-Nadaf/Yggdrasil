import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { api, type ArxivPaper, type PdfAnnotation } from "../api/client";
import { useCericAppend } from "./CericToolbar";
import { PreviewToolbar, useFullscreenPane, useZoom } from "./WorkspacePreviewPane";

export interface PdfDoc {
  url: string;
  title: string;
  /** When known, enables "add to CERIC" from the PDF text and keys the saved highlights. */
  paper?: ArxivPaper;
}

/** Provided by PapersView; null outside it (callers then fall back to a normal link). */
export const PdfContext = createContext<((doc: PdfDoc) => void) | null>(null);

export function usePdfOpener() {
  return useContext(PdfContext);
}

const COLORS: { name: string; css: string }[] = [
  { name: "Yellow", css: "rgba(255, 213, 0, 0.45)" },
  { name: "Green", css: "rgba(88, 214, 141, 0.45)" },
  { name: "Blue", css: "rgba(86, 169, 255, 0.42)" },
  { name: "Pink", css: "rgba(255, 128, 191, 0.45)" },
];

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

type Rect = [number, number, number, number];
interface Sel { text: string; page: number; rects: Rect[] }

function PdfPage({
  pdf, num, width, ratio, rootEl, anns, onTextError,
}: {
  pdf: PDFDocumentProxy; num: number; width: number; ratio: number; rootEl: HTMLElement | null; anns: PdfAnnotation[]; onTextError?: (m: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(width * ratio);
  const done = useRef(0);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !rootEl) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setVisible(true); }, { root: rootEl, rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [rootEl]);

  useEffect(() => { setHeight(width * ratio); done.current = 0; }, [width, ratio]);

  useEffect(() => {
    if (!visible || !width || done.current === width) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await pdf.getPage(num);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      if (cancelled || !canvas.current) return;
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
      if (cancelled) return;
      setHeight(viewport.height);
      const tl = textBox.current;
      if (!tl || !wrap.current) return;
      tl.innerHTML = "";
      wrap.current.style.setProperty("--scale-factor", String(viewport.scale));
      wrap.current.style.setProperty("--total-scale-factor", String(viewport.scale));
      const pdfjs = await import("pdfjs-dist");
      try {
        await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport }).render();
      } catch (err) {
        console.error("PDF text layer failed", err);
        onTextError?.(err instanceof Error ? err.message : String(err));
      }
      if (!cancelled) done.current = width;
    })().catch(() => { /* cancelled renders throw */ });
    return () => { cancelled = true; task?.cancel(); };
  }, [visible, width, pdf, num]);

  return (
    <div ref={wrap} className="pdfv-page" data-page={num} style={{ width, height }}>
      <canvas ref={canvas} />
      <div className="pdfv-hl">
        {anns.flatMap((a) =>
          a.rects.map((r, i) => (
            <i key={`${a.id}-${i}`} style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%`, background: a.color }} />
          ))
        )}
      </div>
      <div ref={textBox} className="textLayer" />
    </div>
  );
}

/** Right-hand reader: pdf.js pages with selectable text, highlights/notes saved in the vault, and “add to CERIC”. */
export default function PdfViewer({ doc, onClose }: { doc: PdfDoc; onClose: () => void }) {
  const key = useMemo(() => doc.paper?.id || `url-${hashStr(doc.url)}`, [doc.paper?.id, doc.url]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState("");
  const [ratio, setRatio] = useState(1.3);
  const [pages, setPages] = useState(0);
  const [anns, setAnns] = useState<PdfAnnotation[]>([]);
  const [loadedAnns, setLoadedAnns] = useState(false);
  const [savedCopy, setSavedCopy] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [textFail, setTextFail] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);
  const dirty = useRef(false);
  const { zoom, zoomIn, zoomOut, atMinZoom, atMaxZoom } = useZoom(1);
  const { fullscreen, setFullscreen } = useFullscreenPane();

  function showToast(text: string, ok: boolean) {
    setToast({ text, ok });
    window.setTimeout(() => setToast(null), 2600);
  }
  const cer = useCericAppend(showToast);

  const fileUrl = `/api/pdf-file?key=${encodeURIComponent(key)}&url=${encodeURIComponent(doc.url)}`;

  useEffect(() => {
    let dead = false;
    dirty.current = false;
    setTextFail(false); setPdf(null); setErr(""); setAnns([]); setLoadedAnns(false); setSel(null); setPages(0);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const r = await fetch(fileUrl);
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error((j && j.detail) || `Could not load the PDF (${r.status})`);
      }
      const data = new Uint8Array(await r.arrayBuffer());
      const d = await pdfjs.getDocument({ data }).promise;
      if (dead) { void d.destroy(); return; }
      const p1 = await d.getPage(1);
      const v = p1.getViewport({ scale: 1 });
      setRatio(v.height / v.width);
      setPages(d.numPages);
      setPdf(d);
    })().catch((e) => { if (!dead) setErr(e instanceof Error ? e.message : "Could not open the PDF"); });
    api.pdf.annotations(key)
      .then((r) => { if (!dead) { setAnns(r.annotations || []); setSavedCopy(r.saved_copy); setLoadedAnns(true); } })
      .catch(() => { if (!dead) setLoadedAnns(true); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc.url]);

  useEffect(() => {
    if (!loadedAnns || !dirty.current) return;
    const t = window.setTimeout(() => {
      api.pdf.saveAnnotations(key, doc.url, doc.title, anns).then((r) => setSavedCopy(r.saved_copy)).catch(() => showToast("Couldn’t save notes", false));
    }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anns]);

  useEffect(() => {
    if (!rootEl) return;
    const ro = new ResizeObserver(() => setBoxW(rootEl.clientWidth));
    ro.observe(rootEl);
    setBoxW(rootEl.clientWidth);
    return () => ro.disconnect();
  }, [rootEl]);

  const pageWidth = Math.max(200, boxW - 28) * zoom;

  function commit(next: PdfAnnotation[]) {
    dirty.current = true;
    setAnns(next);
  }

  function clearBrowserSelection() {
    window.getSelection()?.removeAllRanges();
    setSel(null);
    cer.clearSelection();
  }

  /** Reads the browser selection after any mouse-up / key-up (also when the drag ends outside the pages). */
  function processSelection(e: Event) {
    const target = e.target as Element | null;
    if (target?.closest?.(".pdfv-selbar")) return;
    const s = window.getSelection();
    const text = s?.toString().trim() || "";
    const inside = !!rootEl && !!target && rootEl.contains(target);
    if (!s || !text || s.rangeCount === 0) {
      if (!inside) return;
      setSel(null);
      if (doc.paper) cer.handleTextSelect(doc.paper.id);
      // plain click on a highlight → open it in the notes drawer
      const me = e as MouseEvent;
      const pageEl = target?.closest?.(".pdfv-page") as HTMLElement | null;
      if (pageEl && typeof me.clientX === "number") {
        const pr = pageEl.getBoundingClientRect();
        const x = (me.clientX - pr.left) / pr.width;
        const y = (me.clientY - pr.top) / pr.height;
        const hit = anns.find((a) => a.page === Number(pageEl.dataset.page) && a.rects.some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]));
        if (hit) { setNotesOpen(true); setFocusId(hit.id); }
      }
      return;
    }
    const range = s.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const ancEl = anc.nodeType === 1 ? (anc as Element) : anc.parentElement;
    if (!rootEl || !ancEl || !rootEl.contains(ancEl)) return;
    const startNode = range.startContainer;
    const startEl = (startNode.nodeType === 1 ? (startNode as Element) : startNode.parentElement)?.closest(".pdfv-page") as HTMLElement | null;
    if (!startEl) { setSel(null); return; }
    const pr = startEl.getBoundingClientRect();
    let rects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 1 && r.height > 1 && r.left >= pr.left - 2 && r.right <= pr.right + 2 && r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2
    );
    rects = rects.filter(
      (r, i) => !rects.some((o, j) => j !== i && o.left <= r.left + 0.5 && o.right >= r.right - 0.5 && o.top <= r.top + 0.5 && o.bottom >= r.bottom - 0.5 && (o.width > r.width || o.height > r.height || j < i))
    );
    setSel({
      text,
      page: Number(startEl.dataset.page),
      rects: rects.map((r) => [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height] as Rect),
    });
    if (doc.paper) cer.handleTextSelect(doc.paper.id);
  }
  const selHandler = useRef(processSelection);
  selHandler.current = processSelection;
  useEffect(() => {
    const h = (e: Event) => { window.setTimeout(() => selHandler.current(e), 0); };
    document.addEventListener("mouseup", h);
    document.addEventListener("keyup", h);
    return () => { document.removeEventListener("mouseup", h); document.removeEventListener("keyup", h); };
  }, []);

  function currentPage(): number {
    if (!rootEl) return 1;
    const top = rootEl.getBoundingClientRect().top;
    for (const el of Array.from(rootEl.querySelectorAll<HTMLElement>(".pdfv-page"))) {
      if (el.getBoundingClientRect().bottom > top + 40) return Number(el.dataset.page);
    }
    return 1;
  }

  /** A note without any selected text, pinned to the page you are looking at. */
  function addPageNote() {
    const a: PdfAnnotation = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      page: currentPage(), rects: [], text: "", color: COLORS[0].css, note: "", created: new Date().toISOString(),
    };
    commit([...anns, a]);
    setNotesOpen(true);
    setFocusId(a.id);
  }

  function highlight(color: string, openNote = false) {
    if (!sel || sel.rects.length === 0) return;
    const a: PdfAnnotation = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      page: sel.page, rects: sel.rects, text: sel.text, color, note: "", created: new Date().toISOString(),
    };
    commit([...anns, a]);
    clearBrowserSelection();
    if (openNote) { setNotesOpen(true); setFocusId(a.id); }
  }

  async function addToCeric(slotKey: string) {
    if (!doc.paper) return;
    await cer.addSelectionToSlot(doc.paper, slotKey);
    setSel(null);
  }

  function download() {
    const a = document.createElement("a");
    a.href = fileUrl;
    a.download = `${(doc.title || key).replace(/[^\w .-]+/g, "").slice(0, 80) || "paper"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function keepCopy() {
    try {
      await api.pdf.saveCopy(key, doc.url);
      setSavedCopy(true);
      showToast("PDF copy saved in your vault (10-Papers/pdfs)", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn’t save a copy", false);
    }
  }

  function jumpTo(page: number) {
    rootEl?.querySelector(`.pdfv-page[data-page="${page}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function copyMarkdown() {
    const md = [...anns]
      .sort((a, b) => a.page - b.page)
      .map((a) => `> ${a.text.replace(/\s+/g, " ")}  \n> — p. ${a.page}${a.note ? `\n\n${a.note}` : ""}`)
      .join("\n\n");
    void navigator.clipboard?.writeText(md);
    showToast("Highlights copied as Markdown", true);
  }

  const sorted = useMemo(() => [...anns].sort((a, b) => a.page - b.page || a.created.localeCompare(b.created)), [anns]);

  return (
    <div className={`pdf-viewer${fullscreen ? " is-full" : ""}`}>
      <div className="pdf-viewer-bar">
        <span className="pdf-viewer-title" title={doc.title}>{doc.title}</span>
        {!savedCopy && <button type="button" className="btn" onClick={keepCopy} title="Keep a copy of this PDF in your vault">Keep copy</button>}
        {savedCopy && <span className="muted mono" style={{ fontSize: 11 }} title="Stored in your vault: 10-Papers/pdfs">saved locally ✓</span>}
        <button type="button" className={`btn${notesOpen ? " btn-primary" : ""}`} onClick={() => setNotesOpen((v) => !v)} title="Highlights and notes">
          Notes{anns.length ? ` (${anns.length})` : ""}
        </button>
        <a className="btn" href={doc.url} target="_blank" rel="noopener noreferrer" title="Open in your browser">↗</a>
        <button type="button" className="btn" onClick={onClose} title="Close reader">×</button>
      </div>
      <PreviewToolbar
        statusLabel={err ? "error" : pages ? `${pages} page${pages === 1 ? "" : "s"}` : "loading…"}
        zoom={zoom}
        atMinZoom={atMinZoom}
        atMaxZoom={atMaxZoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        fullscreen={fullscreen}
        onEnterFullscreen={() => setFullscreen(true)}
        onExitFullscreen={() => setFullscreen(false)}
        onDownload={download}
      />
      <div className="pdfv-stage">
        {sel && (
          <div className="pdfv-selbar">
            <span className="pdfv-selbar-text">“{sel.text.length > 50 ? `${sel.text.slice(0, 50)}…` : sel.text}”</span>
            <span className="pdfv-selbar-group">
              {COLORS.map((c) => (
                <button key={c.name} type="button" className="pdfv-swatch" style={{ background: c.css }} title={`Highlight ${c.name.toLowerCase()}`} onClick={() => highlight(c.css)} />
              ))}
              <button type="button" className="btn" onClick={() => highlight(COLORS[0].css, true)} title="Highlight and write a note">+ Note</button>
            </span>
            {doc.paper && (
              <span className="pdfv-selbar-group">
                <span className="muted" style={{ fontSize: 11 }}>CERIC:</span>
                {cer.slots.map((s) => (
                  <button key={s.key} type="button" className="btn" disabled={cer.addingSlot === s.key} onClick={() => addToCeric(s.key)} title={`Add to ${s.label}`}>
                    {cer.addingSlot === s.key ? "…" : s.letter}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
        {textFail && <div className="pdfv-warn">Text selection isn’t available for this PDF (see the console for details). You can still add a page note from the Notes drawer.</div>}
        {toast && <div className={`pdfv-toast ${toast.ok ? "ok" : "error"}`}>{toast.text}</div>}
        <div ref={setRootEl} className="pdfv-scroll">
          {err ? (
            <div className="pdfv-msg">{err}</div>
          ) : !pdf ? (
            <div className="pdfv-msg">Loading PDF…</div>
          ) : (
            Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage key={`${key}-${i + 1}`} pdf={pdf} num={i + 1} width={pageWidth} ratio={ratio} rootEl={rootEl} anns={anns.filter((a) => a.page === i + 1)} onTextError={() => setTextFail(true)} />
            ))
          )}
        </div>
        {notesOpen && (
          <div className="pdfv-notes">
            <div className="pdfv-notes-head">
              <strong>Highlights &amp; notes</strong>
              <span className="muted" style={{ fontSize: 11 }}>select text in the PDF to add</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn" onClick={addPageNote} title="Add a note to the page you are viewing">+ Page note</button>
              {anns.length > 0 && <button type="button" className="btn" onClick={copyMarkdown}>Copy Markdown</button>}
              <button type="button" className="btn" onClick={() => setNotesOpen(false)}>×</button>
            </div>
            {sorted.length === 0 && <div className="muted" style={{ padding: 10, fontSize: 13 }}>Nothing yet. Select text in the PDF, then choose a highlight colour or “+ Note”.</div>}
            {sorted.map((a) => (
              <div key={a.id} className={`pdfv-note${a.id === focusId ? " focus" : ""}`}>
                <div className="pdfv-note-top">
                  <button type="button" className="btn" onClick={() => jumpTo(a.page)}>p. {a.page}</button>
                  {COLORS.map((c) => (
                    <button key={c.name} type="button" className={`pdfv-swatch small${a.color === c.css ? " on" : ""}`} style={{ background: c.css }} title={c.name}
                      onClick={() => commit(anns.map((x) => (x.id === a.id ? { ...x, color: c.css } : x)))} />
                  ))}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="btn" title="Delete highlight" onClick={() => commit(anns.filter((x) => x.id !== a.id))}>Delete</button>
                </div>
                <div className="pdfv-note-quote" style={{ borderLeftColor: a.color }}>{a.text || <span className="muted">Page note</span>}</div>
                <textarea
                  className="pdfv-note-input"
                  placeholder="Add a note…"
                  autoFocus={a.id === focusId}
                  defaultValue={a.note}
                  rows={2}
                  onBlur={(e) => { if (e.target.value !== a.note) commit(anns.map((x) => (x.id === a.id ? { ...x, note: e.target.value } : x))); }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
