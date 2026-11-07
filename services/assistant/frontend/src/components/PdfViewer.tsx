import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ActivityTimer from "./ActivityTimer";
import BookIcon from "./BookIcons";
import ReaderSidebar, { type FindHit, type SidebarTab } from "./ReaderSidebar";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { api, type ArxivPaper, type PdfAnnotation } from "../api/client";
import { useCericAppend } from "./CericToolbar";
import { PreviewToolbar, useFullscreenPane, useZoom } from "./WorkspacePreviewPane";
import { useCollapsed } from "../lib/useCollapsed";
import PdfSelectionPopup, { type Markup } from "./PdfSelectionPopup";
import { colorCss, slotColor, useHighlightPrefs } from "../lib/highlightPrefs";
import "./pdfAnnotate.css";
import ReaderNotes from "./ReaderNotes";

export interface PdfDoc {
  url: string;
  title: string;
  /** When known, enables "add to CERIC" from the PDF text and keys the saved highlights. */
  paper?: ArxivPaper;
  /** Explicit storage key (books use `book-{slug}`); beats the paper id / URL hash. */
  key?: string;
  /** Scroll to this page once the document has loaded. */
  initialPage?: number;
  /** Called (throttled) with the page at the top of the viewport and the page count. */
  onPage?: (page: number, total: number) => void;
  /** Hide controls that only make sense for papers fetched from the web. */
  embedded?: boolean;
  /** Books: selected text can be sent straight to the book's notes (no CERIC). */
  notes?: { add: (text: string, page: number) => Promise<void> };
}

/** Provided by PapersView; null outside it (callers then fall back to a normal link). */
export const PdfContext = createContext<((doc: PdfDoc) => void) | null>(null);

export function usePdfOpener() {
  return useContext(PdfContext);
}

type AnnKind = "highlight" | "underline" | "note" | "text" | "area" | "ink";
type Tool = "select" | "note" | "text" | "area" | "ink";
type Pt = [number, number];
/** Stored verbatim by the backend, so extra fields need no server change. */
type Ann = PdfAnnotation & { kind?: AnnKind; slot?: string; pts?: Pt[]; paths?: Pt[][]; zkey?: string; zpos?: ZPos };
/** Zotero-style position in PDF user-space units (origin bottom-left), kept next to our on-screen fractions. */
interface ZPos { pageIndex: number; rects?: [number, number, number, number][]; paths?: number[][]; ph?: number }
type View = number[];

/** Fill in whichever of the two coordinate systems an annotation is missing (needed for Zotero sync). */
function computeGeom(a: Ann, v: View): Partial<Ann> | null {
  const W = v[2] - v[0], H = v[3] - v[1];
  if (!(W > 0 && H > 0)) return null;
  const has = a.rects.length > 0 || !!a.pts?.length || !!a.paths?.length;
  if (has && !a.zpos && a.kind !== "area") {
    const z: ZPos = { pageIndex: a.page - 1, ph: H };
    if (a.kind === "ink") {
      const lines = a.paths?.length ? a.paths : a.pts?.length ? [a.pts] : [];
      z.paths = lines.map((l) => l.flatMap(([x, y]) => [v[0] + x * W, v[3] - y * H]));
    } else {
      z.rects = a.rects.map(([x, y, w, h]) => [v[0] + x * W, v[3] - (y + h) * H, v[0] + (x + w) * W, v[3] - y * H] as [number, number, number, number]);
    }
    return { zpos: z };
  }
  if (!has && a.zpos) {
    if (a.zpos.paths?.length) {
      const paths = a.zpos.paths.map((flat) => {
        const out: Pt[] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) out.push([(flat[i] - v[0]) / W, (v[3] - flat[i + 1]) / H]);
        return out;
      });
      const all = paths.flat();
      if (!all.length) return null;
      const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { paths, pts: paths[0], rects: [[x, y, Math.max(...xs) - x, Math.max(...ys) - y]] };
    }
    if (a.zpos.rects?.length) {
      return { rects: a.zpos.rects.map(([x1, y1, x2, y2]) => [(x1 - v[0]) / W, (v[3] - y2) / H, (x2 - x1) / W, (y2 - y1) / H] as Rect) };
    }
  }
  return null;
}
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

type Rect = [number, number, number, number];
interface Sel { text: string; page: number; rects: Rect[] }

function PdfPage({
  pdf, num, width, ratio, rootEl, anns, onTextError, tool, color, opacity, onCreate, find, findNth,
}: {
  pdf: PDFDocumentProxy; num: number; width: number; ratio: number; rootEl: HTMLElement | null; anns: Ann[]; onTextError?: (m: string) => void;
  tool: Tool; color: string; opacity: number; onCreate: (a: Partial<Ann>) => void;
  /** Search term to mark in the text layer, and which marked span (on this page) is the current hit. */
  find: string; findNth: number | null;
}) {
  const [drag, setDrag] = useState<[number, number, number, number] | null>(null);
  const [path, setPath] = useState<Pt[] | null>(null);
  const [draft, setDraft] = useState<Pt | null>(null);
  const draftEl = useRef<HTMLTextAreaElement>(null);
  const hasDraft = !!draft;
  useEffect(() => { if (hasDraft) { const t = window.setTimeout(() => draftEl.current?.focus(), 30); return () => window.clearTimeout(t); } }, [hasDraft]);
  const norm = (e: React.PointerEvent): Pt => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  function down(e: React.PointerEvent) {
    if (e.button > 0) return;
    const [x, y] = norm(e);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (tool === "note") onCreate({ kind: "note", page: num, rects: [[x, y, 0.04, 0.03]] });
    else if (tool === "text") setDraft([x, y]);
    else if (tool === "area") setDrag([x, y, x, y]);
    else if (tool === "ink") setPath([[x, y]]);
  }
  function move(e: React.PointerEvent) {
    const [x, y] = norm(e);
    if (drag) setDrag([drag[0], drag[1], x, y]);
    else if (path) setPath((p) => (p ? [...p, [x, y]] : p));
  }
  function up() {
    if (drag) {
      const x = Math.min(drag[0], drag[2]), y = Math.min(drag[1], drag[3]);
      const w = Math.abs(drag[2] - drag[0]), h = Math.abs(drag[3] - drag[1]);
      if (w > 0.01 && h > 0.01) onCreate({ kind: "area", page: num, rects: [[x, y, w, h]] });
      setDrag(null);
    } else if (path) {
      if (path.length > 1) {
        const xs = path.map((p) => p[0]), ys = path.map((p) => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        onCreate({ kind: "ink", page: num, pts: path, rects: [[x, y, Math.max(...xs) - x, Math.max(...ys) - y]] });
      }
      setPath(null);
    }
  }
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(width * ratio);
  const done = useRef(0);
  const [rendered, setRendered] = useState(0);

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
      if (!cancelled) { done.current = width; setRendered((n) => n + 1); }
    })().catch(() => { /* cancelled renders throw */ });
    return () => { cancelled = true; task?.cancel(); };
  }, [visible, width, pdf, num]);

  // Mark search matches in the text layer (matches that span two text runs are not marked).
  useEffect(() => {
    const tl = textBox.current;
    if (!tl) return;
    const q = find.trim().toLowerCase();
    let n = 0;
    tl.querySelectorAll("span").forEach((sp) => {
      if (sp.classList.contains("markedContent") || sp.querySelector("span")) return;
      const m = !!q && (sp.textContent || "").toLowerCase().includes(q);
      sp.classList.toggle("pdfv-find", m);
      sp.classList.toggle("cur", m && findNth !== null && n === findNth);
      if (m) n++;
    });
  }, [find, findNth, rendered]);

  return (
    <div ref={wrap} className="pdfv-page" data-page={num} style={{ width, height }}>
      <canvas ref={canvas} />
      <div className="pdfv-hl">
        {anns.flatMap((a): ReactNode[] => {
          const k = a.kind || "highlight";
          if (k === "ink") {
            const lines = a.paths?.length ? a.paths : [a.pts || []];
            return [<svg key={a.id} className="ink" viewBox="0 0 1 1" preserveAspectRatio="none">{lines.map((l, li) => <polyline key={li} points={l.map((p) => p.join(",")).join(" ")} stroke={a.color} />)}</svg>];
          }
          return a.rects.map((r, i) => {
            const pos = { left: `${r[0] * 100}%`, top: `${r[1] * 100}%` };
            const box = { ...pos, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` };
            if (k === "text") return <span key={`${a.id}-${i}`} className="tx" style={{ ...pos, color: a.color }}>{a.text}</span>;
            if (k === "note") return <i key={`${a.id}-${i}`} className="pin" style={{ ...pos, background: a.color }} />;
            if (k === "underline") return <i key={`${a.id}-${i}`} className="ul" style={{ ...box, borderBottomColor: a.color }} />;
            if (k === "area") return <i key={`${a.id}-${i}`} className="area" style={{ ...box, background: colorCss(a.color, opacity), borderColor: a.color }} />;
            return <i key={`${a.id}-${i}`} style={{ ...box, background: colorCss(a.color, opacity) }} />;
          });
        })}
        {drag && <i className="area" style={{ left: `${Math.min(drag[0], drag[2]) * 100}%`, top: `${Math.min(drag[1], drag[3]) * 100}%`, width: `${Math.abs(drag[2] - drag[0]) * 100}%`, height: `${Math.abs(drag[3] - drag[1]) * 100}%`, background: colorCss(color, opacity), borderColor: color }} />}
        {path && <svg className="ink" viewBox="0 0 1 1" preserveAspectRatio="none"><polyline points={path.map((p) => p.join(",")).join(" ")} stroke={color} /></svg>}
      </div>
      {tool !== "select" && <div className={`pdfv-tool ${tool}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />}
      {draft && (
        <textarea
          ref={draftEl} className="pdfv-draft" style={{ left: `${draft[0] * 100}%`, top: `${draft[1] * 100}%` }} placeholder="Type…"
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const t = e.target.value.trim();
            if (t) onCreate({ kind: "text", page: num, text: t, rects: [[draft[0], draft[1], 0.3, 0.04]] });
            setDraft(null);
          }}
          onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}
        />
      )}
      <div ref={textBox} className="textLayer" />
    </div>
  );
}

/** Right-hand reader: pdf.js pages with selectable text, highlights/notes saved in the vault, and “add to CERIC”. */
export default function PdfViewer({ doc, onClose, lead, trail }: {
  doc: PdfDoc; onClose: () => void;
  /** Embedded (Collection) reader: buttons placed at the start / end of the thin top bar. */
  lead?: ReactNode; trail?: ReactNode;
}) {
  const key = useMemo(() => doc.key || doc.paper?.id || `url-${hashStr(doc.url)}`, [doc.key, doc.paper?.id, doc.url]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState("");
  const [ratio, setRatio] = useState(1.3);
  const [pages, setPages] = useState(0);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [loadedAnns, setLoadedAnns] = useState(false);
  const [savedCopy, setSavedCopy] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const prefs = useHighlightPrefs();
  const [markup, setMarkup] = useState<Markup>("highlight");
  const [slim, toggleSlim] = useCollapsed(doc.embedded ? "pdf-controls-embedded" : "pdf-controls");
  const [tool, setTool] = useState<Tool>("select");
  const [toolColor, setToolColor] = useState("#e5484d");
  const [notesOpen, setNotesOpen] = useState(false);
  const [rnOpen, setRnOpen] = useState(false);
  const [rnQueue, setRnQueue] = useState<string[]>([]);
  const [rnSrc, setRnSrc] = useState("");
  const embedded = !!doc.embedded;
  const [sbHidden, toggleSb, setSbHidden] = useCollapsed("reader-sidebar", typeof window !== "undefined" && window.innerWidth < 900);
  const [sbTab, setSbTab] = useState<SidebarTab>("thumbs");
  const [curPage, setCurPage] = useState(1);
  const [findInput, setFindInput] = useState("");
  const [findQ, setFindQ] = useState("");
  const [hits, setHits] = useState<FindHit[]>([]);
  const [hitIdx, setHitIdx] = useState(-1);
  const [findBusy, setFindBusy] = useState<{ done: number; total: number } | null>(null);
  const findToken = useRef(0);
  const findInputEl = useRef<HTMLInputElement>(null);
  const textCache = useRef<Map<number, string[]>>(new Map());
  const sbOpen = embedded && !sbHidden;
  /** Show the highlights/notes list: in the sidebar (Collection reader) or the drawer below the pages. */
  function openNotes() {
    if (embedded) { setSbHidden(false); setSbTab("notes"); } else setNotesOpen(true);
  }
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Send an annotation (quote + your comment + page) into the "My notes" markdown note. */
  function quoteToNotes(a: Ann) {
    const q = (a.text || "").replace(/\s+/g, " ").trim();
    const lines = [q ? `> ${q}` : `> (page note)`, `> — p. ${a.page}`];
    if (a.note) lines.push("", a.note);
    setRnOpen(true);
    setRnQueue((x) => [...x, lines.join("\n")]);
  }
  const inNotes = (a: Ann) => !!a.text && rnSrc.includes(a.text.replace(/\s+/g, " ").trim().slice(0, 40));
  const rnPane = rnOpen ? (
    <ReaderNotes title={doc.title} page={curPage} queue={rnQueue} onQueueDone={() => setRnQueue([])} onSource={setRnSrc} onClose={() => setRnOpen(false)} />
  ) : null;
  const [textFail, setTextFail] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);
  const dirty = useRef(false);
  const { zoom, zoomIn, zoomOut, atMinZoom, atMaxZoom, resetZoom } = useZoom(1);
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

  function commit(next: Ann[]) {
    dirty.current = true;
    setAnns(next);
  }

  // Keep on-screen fractions and PDF-unit positions (used by Zotero sync) in step, using the real page geometry.
  const geomBusy = useRef(false);
  useEffect(() => {
    if (!pdf || !loadedAnns || geomBusy.current) return;
    const todo = anns.filter((a) => computeGeom(a, [0, 0, 1, 1]) !== null);
    if (!todo.length) return;
    geomBusy.current = true;
    (async () => {
      const views = new Map<number, View | null>();
      const patches = new Map<string, Partial<Ann>>();
      for (const a of todo) {
        if (!views.has(a.page)) {
          try { const pg = await pdf.getPage(a.page); views.set(a.page, pg.rotate ? null : (pg.view as View)); } catch { views.set(a.page, null); }
        }
        const v = views.get(a.page);
        const patch = v ? computeGeom(a, v) : null;
        if (patch) patches.set(a.id, patch);
      }
      if (patches.size) {
        dirty.current = true;
        setAnns((cur) => cur.map((a) => (patches.has(a.id) ? { ...a, ...patches.get(a.id) } : a)));
      }
    })().catch(() => {}).finally(() => { geomBusy.current = false; });
  }, [pdf, loadedAnns, anns]);

  function clearBrowserSelection() {
    window.getSelection()?.removeAllRanges();
    setSel(null);
    setAnchor(null);
    cer.clearSelection();
  }

  /** Reads the browser selection after any mouse-up / key-up (also when the drag ends outside the pages). */
  function processSelection(e: Event) {
    const target = e.target as Element | null;
    if (target?.closest?.(".pdfv-selpop, .pdfv-tools, .pdfv-draft")) return;
    if (tool !== "select") return;
    const s = window.getSelection();
    const text = s?.toString().trim() || "";
    const inside = !!rootEl && !!target && rootEl.contains(target);
    if (!s || !text || s.rangeCount === 0) {
      if (!inside) return;
      setSel(null);
      setAnchor(null);
      if (doc.paper) cer.handleTextSelect(doc.paper.id);
      // plain click on a highlight → open it in the notes drawer
      const me = e as MouseEvent;
      const pageEl = target?.closest?.(".pdfv-page") as HTMLElement | null;
      if (pageEl && typeof me.clientX === "number") {
        const pr = pageEl.getBoundingClientRect();
        const x = (me.clientX - pr.left) / pr.width;
        const y = (me.clientY - pr.top) / pr.height;
        const hit = anns.find((a) => a.page === Number(pageEl.dataset.page) && a.rects.some((r) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]));
        if (hit) { openNotes(); setFocusId(hit.id); }
      }
      return;
    }
    const range = s.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const ancEl = anc.nodeType === 1 ? (anc as Element) : anc.parentElement;
    if (!rootEl || !ancEl || !rootEl.contains(ancEl)) return;
    const startNode = range.startContainer;
    const startEl = (startNode.nodeType === 1 ? (startNode as Element) : startNode.parentElement)?.closest(".pdfv-page") as HTMLElement | null;
    if (!startEl) { setSel(null); setAnchor(null); return; }
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
    placePopup(range);
    if (doc.paper) cer.handleTextSelect(doc.paper.id);
  }
  /** Anchor the palette just under (or above, near the bottom edge) the end of the selection. */
  function placePopup(range: Range) {
    const list = Array.from(range.getClientRects()).filter((r) => r.width > 1);
    const last = list[list.length - 1] || range.getBoundingClientRect();
    const below = last.bottom + 140 < window.innerHeight;
    setAnchor({ x: Math.min(last.right, Math.max(last.left, last.left + 40)) - 20, y: below ? last.bottom + 8 : (list[0] || last).top - 8, below });
  }
  const selHandler = useRef(processSelection);
  selHandler.current = processSelection;
  useEffect(() => {
    const h = (e: Event) => { window.setTimeout(() => selHandler.current(e), 0); };
    document.addEventListener("mouseup", h);
    document.addEventListener("touchend", h);
    document.addEventListener("keyup", h);
    return () => { document.removeEventListener("mouseup", h); document.removeEventListener("touchend", h); document.removeEventListener("keyup", h); };
  }, []);

  function currentPage(): number {
    if (!rootEl) return 1;
    const top = rootEl.getBoundingClientRect().top;
    for (const el of Array.from(rootEl.querySelectorAll<HTMLElement>(".pdfv-page"))) {
      if (el.getBoundingClientRect().bottom > top + 40) return Number(el.dataset.page);
    }
    return 1;
  }

  // Reading position: jump to the saved page once, then report scrolling back to the host.
  const onPageRef = useRef(doc.onPage);
  onPageRef.current = doc.onPage;
  const jumped = useRef(false);
  useEffect(() => { jumped.current = false; }, [key]);
  useEffect(() => {
    if (!rootEl || !pdf || jumped.current) return;
    jumped.current = true;
    const target = doc.initialPage || 1;
    if (target > 1) {
      window.setTimeout(() => rootEl.querySelector(`.pdfv-page[data-page="${target}"]`)?.scrollIntoView({ block: "start" }), 80);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootEl, pdf]);
  useEffect(() => {
    if (!rootEl || !pages) return;
    let raf = 0;
    let last = 0;
    const report = () => {
      raf = 0;
      const p = currentPage();
      if (p !== last) { last = p; setCurPage(p); onPageRef.current?.(p, pages); }
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(report); };
    rootEl.addEventListener("scroll", onScroll, { passive: true });
    return () => { rootEl.removeEventListener("scroll", onScroll); if (raf) window.cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootEl, pages]);

  /** A note without any selected text, pinned to the page you are looking at. */
  function addPageNote() {
    const a: Ann = {
      id: newId(), page: currentPage(), rects: [], text: "", color: prefs.defaultColor, note: "", created: new Date().toISOString(),
    };
    commit([...anns, a]);
    openNotes();
    setFocusId(a.id);
  }

  /** Turn the selection (or a snapshot of it) into a highlight / underline in `color`. */
  function applySel(color: string, opts: { note?: boolean; slot?: string; from?: Sel } = {}) {
    const sl = opts.from || sel;
    if (!sl || sl.rects.length === 0) return;
    const a: Ann = {
      id: newId(), kind: markup, page: sl.page, rects: sl.rects, text: sl.text, color, note: "", created: new Date().toISOString(),
      ...(opts.slot ? { slot: opts.slot } : {}),
    };
    commit([...anns, a]);
    clearBrowserSelection();
    if (opts.note) { openNotes(); setFocusId(a.id); }
  }

  async function toNotes() {
    if (!doc.notes || !sel) return;
    const snap = sel;
    try {
      await doc.notes.add(snap.text, snap.page);
      applySel(prefs.defaultColor, { from: snap });
      showToast("Added to notes ✓", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn’t add to notes", false);
    }
  }

  async function addToCeric(slotKey: string, index: number) {
    if (!doc.paper || !sel) return;
    const snap = sel;
    const ok = await cer.addSelectionToSlot(doc.paper, slotKey);
    if (ok) applySel(slotColor(prefs, slotKey, index), { slot: slotKey, from: snap });
    else setSel(snap);
  }

  /** Pen / area / text / note tools drop a new annotation on a page. */
  function createFromTool(p: Partial<Ann>) {
    const k = p.kind as AnnKind;
    const a: Ann = {
      id: newId(), kind: k, page: p.page || 1, rects: p.rects || [], text: p.text || "",
      color: toolColor, note: "", created: new Date().toISOString(), ...(p.pts ? { pts: p.pts } : {}),
    };
    commit([...anns, a]);
    if (k === "note") { setTool("select"); openNotes(); setFocusId(a.id); }
  }

  // Keyboard: Esc leaves a tool; "h" highlights the selection in the default colour.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === "Escape") { setTool("select"); return; }
    if ((e.key === "h" || e.key === "H") && sel && !e.metaKey && !e.ctrlKey) { e.preventDefault(); applySel(prefs.defaultColor); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);
  // keep the palette attached to the text while scrolling
  useEffect(() => {
    if (!rootEl || !sel) return;
    const onScroll = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && s.toString().trim()) placePopup(s.getRangeAt(0));
    };
    rootEl.addEventListener("scroll", onScroll, { passive: true });
    return () => rootEl.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootEl, !!sel]);

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

  async function pageItems(p: number): Promise<string[]> {
    const c = textCache.current.get(p);
    if (c) return c;
    const pg = await pdf!.getPage(p);
    const tc = await pg.getTextContent();
    const arr = tc.items.map((it) => ("str" in it ? it.str : ""));
    textCache.current.set(p, arr);
    return arr;
  }
  useEffect(() => { textCache.current.clear(); findToken.current++; setHits([]); setFindQ(""); setFindInput(""); setHitIdx(-1); setFindBusy(null); }, [key]);

  async function runSearch(raw: string) {
    const q = raw.trim();
    const tok = ++findToken.current;
    setFindQ(q); setHitIdx(-1); setHits([]);
    if (!q || !pdf) { setFindBusy(null); return; }
    setSbHidden(false); setSbTab("search");
    const lq = q.toLowerCase();
    const out: FindHit[] = [];
    const total = pdf.numPages;
    setFindBusy({ done: 0, total });
    for (let p = 1; p <= total; p++) {
      if (tok !== findToken.current) return;
      let items: string[];
      try { items = await pageItems(p); } catch { continue; }
      let nth = 0;
      items.forEach((t, i) => {
        if (!t.toLowerCase().includes(lq)) return;
        const ctx = [items[i - 1] || "", t, items[i + 1] || ""].join(" ").replace(/\s+/g, " ").trim();
        const at = ctx.toLowerCase().indexOf(lq);
        const snippet = ctx.length > 120 ? `${at > 40 ? "…" : ""}${ctx.slice(Math.max(0, at - 40), at + 80)}…` : ctx;
        out.push({ page: p, nth: nth++, snippet });
      });
      if (p % 15 === 0 || p === total) { setHits([...out]); setFindBusy({ done: p, total }); }
    }
    if (tok !== findToken.current) return;
    setFindBusy(null);
    setHits([...out]);
    if (out.length) goHit(0, out);
  }

  function goHit(i: number, list: FindHit[] = hits) {
    const h = list[i];
    if (!h || !rootEl) return;
    setHitIdx(i);
    rootEl.querySelector(`.pdfv-page[data-page="${h.page}"]`)?.scrollIntoView({ block: "start" });
    let tries = 0;
    const t = window.setInterval(() => {
      const el = rootEl.querySelector(`.pdfv-page[data-page="${h.page}"] .pdfv-find.cur`);
      tries++;
      if (el) { el.scrollIntoView({ block: "center" }); window.clearInterval(t); } else if (tries > 20) window.clearInterval(t);
    }, 150);
  }
  function stepHit(d: number) {
    if (!hits.length) return;
    goHit((hitIdx + d + hits.length) % hits.length);
  }
  useEffect(() => {
    if (!embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); findInputEl.current?.focus(); findInputEl.current?.select(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [embedded]);

  const sorted = useMemo(() => [...anns].sort((a, b) => a.page - b.page || a.created.localeCompare(b.created)), [anns]);

  const toolButtons = (
    <>
          <button type="button" className={`pdfv-tool-btn${tool === "select" && markup === "highlight" ? " on" : ""}`} title="Highlight selected text (select text, then pick a colour)" onClick={() => { setTool("select"); setMarkup("highlight"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" stroke="none" fontFamily="serif">A</text></svg>
          </button>
          <button type="button" className={`pdfv-tool-btn${tool === "select" && markup === "underline" ? " on" : ""}`} title="Underline selected text" onClick={() => { setTool("select"); setMarkup("underline"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><text x="12" y="16" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor" stroke="none" fontFamily="serif">A</text><path d="M5 20.5h14" /></svg>
          </button>
          <button type="button" className={`pdfv-tool-btn${tool === "note" ? " on" : ""}`} title="Note — tap the page to pin a note" onClick={() => setTool(tool === "note" ? "select" : "note")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4h16v10l-6 6H4z" /><path d="M14 20v-6h6" /></svg>
          </button>
          <button type="button" className={`pdfv-tool-btn${tool === "text" ? " on" : ""}`} title="Text — tap the page and type" onClick={() => setTool(tool === "text" ? "select" : "text")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 6V4.5h14V6M12 4.5V20M9 20h6" /></svg>
          </button>
          <button type="button" className={`pdfv-tool-btn${tool === "area" ? " on" : ""}`} title="Area — drag a box over a figure or equation" onClick={() => setTool(tool === "area" ? "select" : "area")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.4"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /></svg>
          </button>
          <button type="button" className={`pdfv-tool-btn${tool === "ink" ? " on" : ""}`} title="Draw — finger, mouse or Apple Pencil" onClick={() => setTool(tool === "ink" ? "select" : "ink")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></svg>
          </button>
          <input type="color" value={toolColor} onChange={(e) => setToolColor(e.target.value)} title="Colour for note / text / area / draw" aria-label="Tool colour" />
    </>
  );

  const notesList = (
    <div className="pdfv-notes-list">
      <div className="pdfv-notes-head">
        <strong>Highlights &amp; notes</strong>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={addPageNote} title="Add a note to the page you are viewing">+ Page note</button>
        {anns.length > 0 && <button type="button" className="btn" onClick={copyMarkdown}>Copy Markdown</button>}
        {!embedded && <button type="button" className="btn" onClick={() => setNotesOpen(false)}>×</button>}
      </div>
      {sorted.length === 0 && <div className="muted" style={{ padding: 10, fontSize: 13 }}>Nothing yet. Select text in the PDF, then choose a highlight colour or “+ Note”.</div>}
      {sorted.map((a) => (
        <div key={a.id} className={`pdfv-note${a.id === focusId ? " focus" : ""}`}>
          <div className="pdfv-note-top">
            <button type="button" className="btn" onClick={() => jumpTo(a.page)}>p. {a.page}</button>
            {a.kind && a.kind !== "highlight" && <span className="muted" style={{ fontSize: 11 }}>{a.kind}</span>}
            {a.slot && <span className="muted" style={{ fontSize: 11 }}>{cer.slots.find((x) => x.key === a.slot)?.label || a.slot}</span>}
            {prefs.colors.map((c) => (
              <button key={c} type="button" className={`pdfv-swatch small${a.color === c ? " on" : ""}`} style={{ background: c }}
                onClick={() => commit(anns.map((x) => (x.id === a.id ? { ...x, color: c } : x)))} />
            ))}
            <span style={{ flex: 1 }} />
            {inNotes(a) && <span className="rn-in" title="Already quoted in My notes">in notes ✓</span>}
            <button type="button" className="btn" title="Quote this into My notes" onClick={() => quoteToNotes(a)}>❝ Notes</button>
            <button type="button" className="btn" title="Delete highlight" onClick={() => commit(anns.filter((x) => x.id !== a.id))}>Delete</button>
          </div>
          <div className="pdfv-note-quote" style={{ borderLeftColor: a.color }}>{a.kind === "ink" ? <span className="muted">Drawing</span> : a.kind === "area" ? <span className="muted">Area</span> : a.text || <span className="muted">{a.kind === "note" ? "Pinned note" : "Page note"}</span>}</div>
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
  );

  const pagesEl = (
    <div ref={setRootEl} className="pdfv-scroll">
      {err ? (
        <div className="pdfv-msg">{err}</div>
      ) : !pdf ? (
        <div className="pdfv-msg">Loading PDF…</div>
      ) : (
        Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage key={`${key}-${i + 1}`} pdf={pdf} num={i + 1} width={pageWidth} ratio={ratio} rootEl={rootEl} anns={anns.filter((a) => a.page === i + 1)} onTextError={() => setTextFail(true)} tool={tool} color={toolColor} opacity={prefs.opacity} onCreate={createFromTool}
            find={findQ} findNth={hits[hitIdx]?.page === i + 1 ? hits[hitIdx].nth : null} />
        ))
      )}
    </div>
  );

  const floating = (
    <>
      {sel && anchor && (
        <PdfSelectionPopup
          x={anchor.x} y={anchor.y} below={anchor.below} prefs={prefs} markup={markup} onMarkup={setMarkup} text={sel.text}
          onPick={(c) => applySel(c)} onNote={() => applySel(prefs.defaultColor, { note: true })}
          onToNotes={doc.notes ? () => void toNotes() : undefined}
          slots={doc.paper ? cer.slots : null} addingSlot={cer.addingSlot} onCeric={(k) => addToCeric(k, cer.slots.findIndex((x) => x.key === k))}
        />
      )}
      {textFail && <div className="pdfv-warn">Text selection isn’t available for this PDF (see the console for details). You can still add a page note from the Notes list.</div>}
      {toast && <div className={`pdfv-toast ${toast.ok ? "ok" : "error"}`}>{toast.text}</div>}
    </>
  );

  if (embedded) {
    const ib = (on = false) => `pdfv-ib${on ? " on" : ""}`;
    return (
      <div className={`pdf-viewer pdfv-books${fullscreen ? " is-full" : ""}`}>
        <div className="pdfv-topbar" role="toolbar" aria-label="Reader toolbar">
          <button type="button" className={ib(sbOpen)} onClick={toggleSb} aria-pressed={sbOpen} title={sbOpen ? "Hide sidebar" : "Show sidebar (contents, pages, search, notes)"}><BookIcon name="sidebar" size={17} /></button>
          {lead}
          <span className="pdfv-tb-title" title={doc.title}>{doc.title}</span>
          <span className="pdfv-pg" title="Page">
            <input key={curPage} defaultValue={curPage} aria-label="Page number" inputMode="numeric"
              onKeyDown={(e) => { if (e.key === "Enter") { const n = Math.min(pages || 1, Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 1)); jumpTo(n); (e.target as HTMLInputElement).blur(); } }} />
            <span className="muted">/ {pages || "…"}</span>
          </span>
          <span className="pdfv-find-box">
            <BookIcon name="search" size={14} />
            <input
              ref={findInputEl} type="search" value={findInput} placeholder="Search" aria-label="Search in document"
              onChange={(e) => setFindInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { if (findInput.trim() === findQ && hits.length) stepHit(e.shiftKey ? -1 : 1); else void runSearch(findInput); }
                else if (e.key === "Escape") { setFindInput(""); void runSearch(""); (e.target as HTMLInputElement).blur(); }
              }}
            />
            {findQ && <span className="pdfv-find-count muted">{findBusy ? "…" : hits.length ? `${hitIdx + 1}/${hits.length}` : "0"}</span>}
            {findQ && hits.length > 1 && (
              <>
                <button type="button" className="pdfv-ib sm" onClick={() => stepHit(-1)} title="Previous match (Shift+Enter)"><BookIcon name="up" size={13} /></button>
                <button type="button" className="pdfv-ib sm" onClick={() => stepHit(1)} title="Next match (Enter)"><BookIcon name="down" size={13} /></button>
              </>
            )}
          </span>
          <span className="pdfv-tb-sep" />
          <button type="button" className={ib()} onClick={zoomOut} disabled={atMinZoom} title="Zoom out"><BookIcon name="zoomout" size={17} /></button>
          <button type="button" className="pdfv-zoom-pct" onClick={resetZoom} title="Fit to width">{Math.round(zoom * 100)}%</button>
          <button type="button" className={ib()} onClick={zoomIn} disabled={atMaxZoom} title="Zoom in"><BookIcon name="zoomin" size={17} /></button>
          <button type="button" className={ib()} onClick={() => setFullscreen(!fullscreen)} title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}><BookIcon name="expand" size={16} /></button>
          <button type="button" className={ib()} onClick={download} title="Download PDF"><BookIcon name="download" size={16} /></button>
          <span className="pdfv-tb-sep" />
          <span className="pdfv-tb-tools">{toolButtons}</span>
          {tool !== "select" && <span className="pdfv-hint">Esc</span>}
          <span className="pdfv-tb-sep" />
          <button type="button" className={ib(rnOpen)} onClick={() => setRnOpen((v) => !v)} title="My notes" aria-pressed={rnOpen}>My notes</button>
          {trail}
        </div>
        <div className="pdfv-body">
          {sbOpen && (
            <ReaderSidebar
              pdf={pdf} ratio={ratio} current={curPage} onJump={jumpTo} tab={sbTab} onTab={setSbTab}
              query={findQ} hits={hits} hitIndex={hitIdx} searching={findBusy} onHit={(i) => goHit(i)}
              notesCount={anns.length} notes={notesList}
            />
          )}
          <div className="pdfv-stage">
            {floating}
            {pagesEl}
          </div>
          {rnPane}
        </div>
      </div>
    );
  }

  return (
    <div className={`pdf-viewer${fullscreen ? " is-full" : ""}`}>
      {!doc.embedded && <ActivityTimer category="papers" />}
      <div className="pdf-viewer-bar">
        <button type="button" className="btn pdfv-collapse" onClick={() => { toggleSlim(); setTool("select"); }} aria-expanded={!slim} title={slim ? "Show zoom and annotation tools" : "Hide zoom and annotation tools"}>
          {slim ? "▾ Tools" : "▴ Tools"}
        </button>
        <span className="pdf-viewer-title" title={doc.title}>{doc.title}</span>
        {!savedCopy && <button type="button" className="btn" onClick={keepCopy} title="Keep a copy of this PDF in your vault">Keep copy</button>}
        {savedCopy && <span className="muted mono" style={{ fontSize: 11 }} title="Stored in your vault: 10-Papers/pdfs">saved locally ✓</span>}
        <button type="button" className={`btn${notesOpen ? " btn-primary" : ""}`} onClick={() => setNotesOpen((v) => !v)} title="Highlights and notes">
          Notes{anns.length ? ` (${anns.length})` : ""}
        </button>
        <button type="button" className={`btn${rnOpen ? " btn-primary" : ""}`} onClick={() => setRnOpen((v) => !v)} title="Write your own notes next to the PDF">My notes</button>
        <a className="btn" href={doc.url} target="_blank" rel="noopener noreferrer" title="Open in your browser">↗</a>
        <button type="button" className="btn" onClick={onClose} title="Close reader">×</button>
      </div>
      {!slim && <PreviewToolbar
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
      />}
      <div className="rn-row">
      <div className="pdfv-stage">
        {!slim && (
          <div className="pdfv-tools" role="toolbar" aria-label="Annotation tools">
            {toolButtons}
            {tool !== "select" && <span className="hint">Esc to stop</span>}
          </div>
        )}
        {floating}
        {pagesEl}
        {notesOpen && <div className="pdfv-notes">{notesList}</div>}
      </div>
      {rnPane}
      </div>
    </div>
  );
}
