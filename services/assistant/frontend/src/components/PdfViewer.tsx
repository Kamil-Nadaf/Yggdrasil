import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
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
import PdfDefineCard from "./PdfDefineCard";
import { lookupTerm } from "../lib/lookup";
import { colorCss, slotColor, useHighlightPrefs } from "../lib/highlightPrefs";
import "./pdfAnnotate.css";
import ReaderNotes from "./ReaderNotes";
import ConvertButton from "./ConvertButton";
import { MenuDropdown, type MenuId, type MenuItem } from "./WorkspaceMenuBar";

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
  /** Collection items: papers convert in the background, books are only added to Tools → PDF. */
  kind?: "paper" | "book";
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


type Rect4 = [number, number, number, number];
/** A clickable link from the PDF's own annotations (citations, figure/section refs, URLs), as page fractions. */
interface PdfLink { r: Rect4; dest?: unknown; url?: string }
interface Cite { x: number; y: number; page: number; frac: number | null; text: string; busy: boolean; arxiv: string; doi: string; name: string; finding: boolean; pdfUrl: string; landing: string; title: string; previewUrl: string }
type ReaderTheme = "original" | "dark" | "black" | "snow" | "sepia" | "custom";
const THEMES: { id: Exclude<ReaderTheme, "custom">; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "dark", label: "Dark" },
  { id: "black", label: "Black" },
  { id: "snow", label: "Snow" },
  { id: "sepia", label: "Sepia" },
];
type ScrollMode = "vertical" | "wrapped" | "horizontal";
type SpreadMode = "none" | "odd" | "even";
interface CustomTheme { bg: string; fg: string }
const DEFAULT_CUSTOM: CustomTheme = { bg: "#1f2b24", fg: "#d8e4d2" };
const SCROLL_MODES: { id: ScrollMode; label: string }[] = [{ id: "vertical", label: "Vertical" }, { id: "wrapped", label: "Wrapped" }, { id: "horizontal", label: "Horizontal" }];
const SPREADS: { id: SpreadMode; label: string }[] = [{ id: "none", label: "None" }, { id: "odd", label: "Odd" }, { id: "even", label: "Even" }];
function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  const n = parseInt(m ? m[1] : "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const isDarkHex = (h: string) => { const [r, g, b] = hexRgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128; };
function stored<T extends string>(k: string, ok: readonly T[], d: T): T {
  try { const v = localStorage.getItem(k) as T | null; return v && ok.includes(v) ? v : d; } catch { return d; }
}

/** Where a PDF destination (named or explicit) points: page, and how far down it (0..1) and how far across (pdf units). */
async function resolveDest(pdf: PDFDocumentProxy, dest: unknown): Promise<{ page: number; frac: number | null; top: number | null; left: number | null } | null> {
  try {
    const d: unknown = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(d) || !d.length) return null;
    const ref = d[0];
    const idx = typeof ref === "number" ? ref : await pdf.getPageIndex(ref as { num: number; gen: number });
    const kind = (d[1] as { name?: string } | null)?.name;
    const n = (v: unknown) => (typeof v === "number" ? v : null);
    let left: number | null = null, top: number | null = null;
    if (kind === "XYZ") { left = n(d[2]); top = n(d[3]); }
    else if (kind === "FitH" || kind === "FitBH") top = n(d[2]);
    else if (kind === "FitR") { left = n(d[2]); top = n(d[5]); }
    const page = await pdf.getPage(idx + 1);
    const [, y0, , y1] = page.view;
    return { page: idx + 1, top, left, frac: top == null ? null : Math.min(1, Math.max(0, (y1 - top) / Math.max(1, y1 - y0))) };
  } catch {
    return null;
  }
}

/** A picture of the page area a citation points at (like Zotero's hover preview): a window of the page around the
 *  destination, with a red dot on the exact spot. Both columns are visible because the full page width is used. */
async function renderRegion(pdf: PDFDocumentProxy, pageNum: number, top: number | null, left: number | null, w = 720, h = 340): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = (w / base.width) * dpr;
  const flat = page.getViewport({ scale });
  const destY = top == null ? 0 : flat.convertToViewportPoint(0, top)[1];
  const H = h * dpr;
  const offset = Math.max(0, Math.min(Math.max(0, flat.height - H), destY - H * 0.3));
  const vp = page.getViewport({ scale, offsetY: -offset });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(Math.min(H, flat.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (top != null) {
    const x = left == null ? 10 * dpr : Math.max(8 * dpr, vp.convertToViewportPoint(left, 0)[0] - 8 * dpr);
    const y = destY - offset;
    ctx.fillStyle = "rgba(240,70,70,0.9)";
    ctx.beginPath();
    ctx.arc(x, Math.max(6 * dpr, y), 6 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toDataURL("image/jpeg", 0.88);
}

/** The reference-list entry a citation points at, read from the page text just below the destination. */
async function bibEntry(pdf: PDFDocumentProxy, pageNum: number, top: number | null, left: number | null): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const [x0, , x1] = page.view;
  const mid = (x0 + x1) / 2;
  const tc = await page.getTextContent();
  type It = { s: string; x: number; y: number; w: number; h: number };
  let items: It[] = [];
  for (const raw of tc.items) {
    const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
    if (!it.str || !it.str.trim() || !it.transform) continue;
    items.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || 10 });
  }
  // Two-column pages share y values across columns, so keep only the column the entry is in.
  const rowsRight = new Set(items.filter((i) => i.x > mid - 8 && i.x < mid + 40).map((i) => Math.round(i.y)));
  if (rowsRight.size >= 8 && left != null) {
    const right = left >= mid - 20;
    items = items.filter((i) => (right ? i.x >= mid - 20 : i.x < mid - 20));
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  type Ln = { y: number; x: number; s: string };
  const lines: Ln[] = [];
  let cur: It[] = [];
  const flush = () => {
    if (!cur.length) return;
    cur.sort((a, b) => a.x - b.x);
    let s = "";
    cur.forEach((it, i) => {
      const prev = cur[i - 1];
      if (prev && it.x - (prev.x + prev.w) > 0.15 * it.h && !s.endsWith(" ")) s += " ";
      s += it.s;
    });
    lines.push({ y: cur[0].y, x: cur[0].x, s: s.replace(/\s+/g, " ").trim() });
    cur = [];
  };
  for (const it of items) {
    if (cur.length && Math.abs(it.y - cur[0].y) > 2.5) flush();
    cur.push(it);
  }
  flush();
  if (!lines.length) return "";
  let start = top == null ? 0 : lines.findIndex((l) => l.y <= top - 2);
  if (start < 0) start = lines.length - 1;
  const first = lines[start];
  const out = [first];
  let hanging: boolean | null = null;
  for (let i = start + 1; i < lines.length && out.length < 7; i++) {
    const ln = lines[i], prev = out[out.length - 1];
    if (NUM_REF.test(first.s) && NUM_REF.test(ln.s)) break; // "4. Next entry" after "3. …"
    const acc = out.map((l) => l.s).join(" ");
    if (prev.y - ln.y > 2.2 * Math.max(10, out.length > 1 ? out[out.length - 2].y - prev.y : 12)) break;
    if (ln.x <= first.x + 1.5) {
      if (hanging === true) break;
      // No hanging indent (A&A style): a flush line that opens like "Rees, M. J." after a dated entry starts the next one.
      if (YEAR_RE.test(acc) && AUTHOR_START.test(ln.s)) break;
      if (hanging === null && /[.\d\])]$/.test(prev.s) && /^[A-Z\[\d]/.test(ln.s)) break;
    } else hanging = true;
    out.push(ln);
  }
  return out.reduce((acc, l) => (acc.endsWith("-") ? acc.slice(0, -1) + l.s : acc ? `${acc} ${l.s}` : l.s), "");
}

const YEAR_RE = /\b(1[89]|20)\d{2}[a-z]?\b/;
const AUTHOR_START = /^(?:[—–-]+\.|\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?,\s+\p{Lu}\.)/u;
const NUM_REF = /^\[?\d{1,3}[.\]]\s/;
/** Does this text read like a reference-list entry (years, authors) rather than a caption or a heading? */
function looksLikeBib(t: string): boolean {
  return t.length > 25 && /\b(1[89]|20)\d{2}[a-z]?\b/.test(t) && !/^(fig|figure|table|extended data|supplementary|section|eq)/i.test(t);
}

function bibIds(text: string): { arxiv: string; doi: string } {
  const a = text.match(/arXiv\s*[:\s]\s*((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7}))/i);
  const d = text.match(/(10\.\d{4,9}\/[^\s"<>]+)(?:\s(\d+-\d+)\b)?/);
  let doi = d ? d[1].replace(/[.,;)\]]+$/, "") : "";
  // Springer chapter DOIs ("…-0_151-1") lose their underscore in the PDF text and read "…-0 151-1".
  if (d && d[2] && /-\d{4}-\d$/.test(doi)) doi = `${doi}_${d[2]}`;
  return { arxiv: a ? a[1] : "", doi };
}

type Rect = [number, number, number, number];
interface Sel { text: string; page: number; rects: Rect[] }

/** Boxes (0..1 of the page) holding figures: images and coloured vector drawings, so dark themes can leave plots untouched. */
async function figureBoxes(page: import("pdfjs-dist").PDFPageProxy): Promise<[number, number, number, number][]> {
  const pdfjs = await import("pdfjs-dist");
  const O = pdfjs.OPS as Record<string, number>;
  const vp = page.getViewport({ scale: 1 });
  const ol = await page.getOperatorList({ intent: "display", annotationMode: 0 } as never);
  type M = number[];
  const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const boxes: { r: [number, number, number, number]; img: boolean }[] = [];
  let fillC = false, strokeC = false, path: [number, number, number, number] | null = null;
  const colourful = (a: number[]) => { const hi = Math.max(a[0], a[1], a[2]), lo = Math.min(a[0], a[1], a[2]); return hi - lo > (hi > 1 ? 40 : 0.16); };
  const add = (x0: number, y0: number, x1: number, y1: number, img: boolean) => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => vp.convertToViewportPoint(x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]));
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    boxes.push({ r: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], img });
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], a = ol.argsArray[i] as any;
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) { if (stack.length) ctm = stack.pop()!; }
    else if (fn === O.transform) ctm = mul(a, ctm);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (a?.[0]) ctm = mul(a[0], ctm); }
    else if (fn === O.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop()!; }
    else if (fn === O.setFillRGBColor) fillC = colourful(a);
    else if (fn === O.setStrokeRGBColor) strokeC = colourful(a);
    else if (fn === O.setFillGray) fillC = false;
    else if (fn === O.setStrokeGray) strokeC = false;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintJpegXObject) add(0, 0, 1, 1, true);
    else if (fn === O.constructPath) {
      const mm = a?.[2];
      if (Array.isArray(mm) || (mm && mm.length === 4)) path = [mm[0], mm[1], mm[2], mm[3]];
      else { const c: number[] = a?.[1] || []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let k = 0; k + 1 < c.length; k += 2) { x0 = Math.min(x0, c[k]); x1 = Math.max(x1, c[k]); y0 = Math.min(y0, c[k + 1]); y1 = Math.max(y1, c[k + 1]); } path = x0 < 1e9 ? [x0, y0, x1, y1] : null; }
    } else if (fn === O.endPath) path = null;
    else if (fn === O.fill || fn === O.eoFill || fn === O.fillStroke || fn === O.eoFillStroke || fn === O.closeFillStroke || fn === O.closeEOFillStroke || fn === O.stroke || fn === O.closeStroke) {
      const paintsFill = fn !== O.stroke && fn !== O.closeStroke, paintsStroke = fn !== O.fill && fn !== O.eoFill;
      if (path && ((paintsFill && fillC) || (paintsStroke && strokeC))) add(path[0], path[1], path[2], path[3], false);
      path = null;
    }
  }
  const GAP = 8, W = vp.width, H = vp.height;
  let cl = boxes.filter((b) => (b.r[2] - b.r[0]) < W * 0.95 || (b.r[3] - b.r[1]) < H * 0.95).map((b) => ({ r: [...b.r] as [number, number, number, number], n: 1, img: b.img }));
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
      const a = cl[i].r, b = cl[j].r;
      if (a[0] - GAP < b[2] && b[0] - GAP < a[2] && a[1] - GAP < b[3] && b[1] - GAP < a[3]) {
        cl[i] = { r: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], n: cl[i].n + cl[j].n, img: cl[i].img || cl[j].img };
        cl.splice(j, 1); again = true; break outer;
      }
    }
  }
  const PAD = 16;
  return cl
    .filter((c) => (c.r[2] - c.r[0] >= 70 && c.r[3] - c.r[1] >= 55) && (c.img || c.n >= 6))
    .map((c) => {
      const x0 = Math.max(0, c.r[0] - PAD), y0 = Math.max(0, c.r[1] - PAD), x1 = Math.min(W, c.r[2] + PAD), y1 = Math.min(H, c.r[3] + PAD);
      return [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H] as [number, number, number, number];
    });
}

function PdfPage({
  pdf, num, width, ratio, rootEl, anns, onTextError, tool, color, opacity, onCreate, find, findNth, onLink, onLinkHover,
}: {
  pdf: PDFDocumentProxy; num: number; width: number; ratio: number; rootEl: HTMLElement | null; anns: Ann[]; onTextError?: (m: string) => void;
  tool: Tool; color: string; opacity: number; onCreate: (a: Partial<Ann>) => void;
  /** Search term to mark in the text layer, and which marked span (on this page) is the current hit. */
  find: string; findNth: number | null;
  /** A citation / internal link was clicked (links to the web open normally). */
  onLink: (l: PdfLink, e: React.MouseEvent) => void;
  onLinkHover?: (l: PdfLink | null, e?: React.MouseEvent) => void;
}) {
  const [links, setLinks] = useState<PdfLink[]>([]);
  const [figs, setFigs] = useState<[number, number, number, number][]>([]);
  const figEls = useRef<(HTMLCanvasElement | null)[]>([]);
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
      figureBoxes(page).then((f) => { if (!cancelled) setFigs(f); }).catch(() => { /* no figure detection */ });
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

  // The PDF's own link annotations: citations, "Figure 1", "Section 2", URLs.
  useEffect(() => {
    if (!visible) return;
    let dead = false;
    (async () => {
      const page = await pdf.getPage(num);
      const vp = page.getViewport({ scale: 1 });
      const raw = (await page.getAnnotations({ intent: "display" })) as { subtype?: string; rect?: number[]; dest?: unknown; url?: string; unsafeUrl?: string }[];
      const out: PdfLink[] = [];
      for (const a of raw) {
        if (a.subtype !== "Link" || !a.rect) continue;
        const url = a.url || a.unsafeUrl;
        if (!a.dest && !url) continue;
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect as Rect4);
        out.push({ r: [Math.min(x1, x2) / vp.width, Math.min(y1, y2) / vp.height, Math.abs(x2 - x1) / vp.width, Math.abs(y2 - y1) / vp.height], dest: a.dest, url });
      }
      if (!dead) setLinks(out);
    })().catch(() => { /* a page without annotations */ });
    return () => { dead = true; };
  }, [visible, pdf, num]);

  // Figures keep their original pixels: copy them out of the (CSS-filtered) page canvas.
  useEffect(() => {
    const src = canvas.current;
    if (!src || !rendered) return;
    figs.forEach((f, i) => {
      const el = figEls.current[i];
      if (!el) return;
      const sx = Math.round(f[0] * src.width), sy = Math.round(f[1] * src.height);
      const sw = Math.max(1, Math.round(f[2] * src.width)), sh = Math.max(1, Math.round(f[3] * src.height));
      el.width = sw; el.height = sh;
      el.getContext("2d")?.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    });
  }, [figs, rendered, width]);

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
      {figs.map((f, i) => (
        <canvas key={i} ref={(el) => { figEls.current[i] = el; }} className="pdfv-fig" style={{ left: `${f[0] * 100}%`, top: `${f[1] * 100}%`, width: `${f[2] * 100}%`, height: `${f[3] * 100}%` }} />
      ))}
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
      {tool === "select" && links.length > 0 && (
        <div className="pdfv-links">
          {links.map((l, i) => {
            const st = { left: `${l.r[0] * 100}%`, top: `${l.r[1] * 100}%`, width: `${l.r[2] * 100}%`, height: `${l.r[3] * 100}%` };
            return l.url
              ? <a key={i} className="pdfv-link" style={st} href={l.url} target="_blank" rel="noopener noreferrer" title={l.url} />
              : <a key={i} className="pdfv-link" style={st} href="#" title="Open reference" onClick={(e) => { e.preventDefault(); onLink(l, e); }} onMouseEnter={(e) => onLinkHover?.(l, e)} onMouseLeave={() => onLinkHover?.(null)} />;
          })}
        </div>
      )}
    </div>
  );
}

/** Right-hand reader: pdf.js pages with selectable text, highlights/notes saved in the vault, and “add to CERIC”. */
/** "File" menu for the reader: save, save as, export and print. */
function PdfFileMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState<MenuId>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".latex-menu") || t?.closest?.(".latex-menu-dropdown")) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return <span className="pdfv-filemenu"><MenuDropdown id="file" label="File" open={open} onOpen={setOpen} items={items} /></span>;
}

export default function PdfViewer({ doc, onClose, lead, trail }: {
  doc: PdfDoc; onClose: () => void;
  /** Embedded (Collection) reader: buttons placed at the start / end of the thin top bar. */
  lead?: ReactNode; trail?: ReactNode;
}) {
  const key = useMemo(() => doc.key || doc.paper?.id || `url-${hashStr(doc.url)}`, [doc.key, doc.paper?.id, doc.url]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [dropOver, setDropOver] = useState(false);
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
  const [rsOpen, setRsOpen] = useState(() => { try { return localStorage.getItem("reader-rside") !== "0"; } catch { return true; } });
  const [rsTab, setRsTab] = useState<"paper" | "mine">("paper");
  const [defineFor, setDefineFor] = useState<string | null>(null);
  useEffect(() => { if (!sel) setDefineFor(null); }, [sel]);
  const [sbW, setSbW] = useState(() => { try { return Number(localStorage.getItem("reader-sb-w")) || 280; } catch { return 280; } });
  useEffect(() => { try { localStorage.setItem("reader-sb-w", String(sbW)); localStorage.setItem("reader-rside", rsOpen ? "1" : "0"); } catch { /* ignore */ } }, [sbW, rsOpen]);
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
    if (embedded) { setRsOpen(true); setRsTab("paper"); } else setNotesOpen(true);
  }
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Send an annotation (quote + your comment + page) into the "My notes" markdown note. */
  function quoteToNotes(a: Ann) {
    const q = (a.text || "").replace(/\s+/g, " ").trim();
    const lines = [q ? `> ${q}` : `> (page note)`, `> — p. ${a.page}`];
    if (a.note) lines.push("", a.note);
    setRnOpen(true);
    if (embedded) { setRsOpen(true); setRsTab("mine"); }
    setRnQueue((x) => [...x, lines.join("\n")]);
  }
  const inNotes = (a: Ann) => !!a.text && rnSrc.includes(a.text.replace(/\s+/g, " ").trim().slice(0, 40));
  const rnPane = rnOpen && !embedded ? (
    <ReaderNotes title={doc.title} page={curPage} queue={rnQueue} onQueueDone={() => setRnQueue([])} onSource={setRnSrc} onClose={() => setRnOpen(false)} />
  ) : null;
  const [textFail, setTextFail] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [cite, setCite] = useState<Cite | null>(null);
  const [back, setBack] = useState<number | null>(null);
  const [theme, setThemeState] = useState<ReaderTheme>(() => {
    try {
      const t = localStorage.getItem("reader-theme");
      if (t === "light") return "original";
      if (t === "warm") return "sepia";
      return t && ["original", "dark", "black", "snow", "sepia", "custom"].includes(t) ? (t as ReaderTheme) : "original";
    } catch { return "original"; }
  });
  const [themeMenu, setThemeMenu] = useState(false);
  /** 0-100: how warm (sepia) the page looks, on top of the chosen theme. */
  const [warmth, setWarmthState] = useState(() => { try { const w = Number(localStorage.getItem("reader-warmth")); return Number.isFinite(w) ? Math.min(100, Math.max(0, w)) : 0; } catch { return 0; } });
  function setWarmth(w: number) { setWarmthState(w); try { localStorage.setItem("reader-warmth", String(w)); } catch { /* private mode */ } }
  const [custom, setCustomState] = useState<CustomTheme>(() => {
    try { const c = JSON.parse(localStorage.getItem("reader-custom") || "null"); if (c && /^#[0-9a-f]{6}$/i.test(c.bg) && /^#[0-9a-f]{6}$/i.test(c.fg)) return c; } catch { /* ignore */ }
    return DEFAULT_CUSTOM;
  });
  function setCustom(c: CustomTheme) { setCustomState(c); setThemeState("custom"); try { localStorage.setItem("reader-custom", JSON.stringify(c)); localStorage.setItem("reader-theme", "custom"); } catch { /* private mode */ } }
  const [keepFigs, setKeepFigsState] = useState(() => { try { return localStorage.getItem("reader-keepfigs") !== "0"; } catch { return true; } });
  function setKeepFigs(v: boolean) { setKeepFigsState(v); try { localStorage.setItem("reader-keepfigs", v ? "1" : "0"); } catch { /* private mode */ } }
  const [scrollMode, setScrollModeState] = useState<ScrollMode>(() => stored("reader-scroll", ["vertical", "wrapped", "horizontal"] as const, "vertical"));
  const [spread, setSpreadState] = useState<SpreadMode>(() => stored("reader-spread", ["none", "odd", "even"] as const, "none"));
  function setScrollMode(m: ScrollMode) { setScrollModeState(m); try { localStorage.setItem("reader-scroll", m); } catch { /* private mode */ } }
  function setSpread(m: SpreadMode) { setSpreadState(m); try { localStorage.setItem("reader-spread", m); } catch { /* private mode */ } }
  const themeDark = theme === "dark" || theme === "black" || (theme === "custom" && isDarkHex(custom.bg));
  const filterId = useId().replace(/:/g, "");
  const citeSeq = useRef(0);
  const openPdf = usePdfOpener();
  function setTheme(t: ReaderTheme) { setThemeState(t); try { localStorage.setItem("reader-theme", t); } catch { /* private mode */ } }
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
  }, [key, doc.url, reloadTick]);

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

  const GAP = 12;
  const avail = Math.max(200, boxW - 28);
  const twoUp = scrollMode === "vertical" && spread !== "none";
  const basePage = scrollMode === "wrapped" ? (avail - 2 * GAP) / 3 : twoUp ? (avail - GAP) / 2 : avail;
  const pageWidth = Math.max(120, basePage) * zoom;

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
    if (target?.closest?.(".pdfv-selpop, .pdfv-define, .pdfv-tools, .pdfv-draft")) return;
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
    const box = rootEl.getBoundingClientRect();
    const horiz = scrollMode === "horizontal";
    for (const el of Array.from(rootEl.querySelectorAll<HTMLElement>(".pdfv-page"))) {
      const r = el.getBoundingClientRect();
      if (horiz ? r.right > box.left + 40 : r.bottom > box.top + 40) return Number(el.dataset.page);
    }
    return 1;
  }

  // Keep the reading position when the page width changes (zoom, split view, window or pane resize).
  // Pages are laid out with estimated heights until they render, so the raw scroll offset would land on a
  // different page. We remember the page and how far into it we are, and put the view back after relayout.
  const anchorRef = useRef<{ page: number; frac: number } | null>(null);
  const restoreUntil = useRef(0);
  function recordAnchor(p: number) {
    if (!rootEl || Date.now() < restoreUntil.current) return;
    const el = rootEl.querySelector<HTMLElement>(`.pdfv-page[data-page="${p}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    anchorRef.current = { page: p, frac: (rootEl.getBoundingClientRect().top - r.top) / Math.max(1, r.height) };
  }
  useEffect(() => {
    const a = anchorRef.current;
    if (!rootEl || !a) return;
    restoreUntil.current = Date.now() + 1200;
    const apply = () => {
      const el = rootEl.querySelector<HTMLElement>(`.pdfv-page[data-page="${a.page}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const delta = a.frac * r.height - (rootEl.getBoundingClientRect().top - r.top);
      if (scrollMode !== "horizontal" && Math.abs(delta) > 1) rootEl.scrollTop += delta;
    };
    apply();
    let n = 0;
    const t = window.setInterval(() => { apply(); if (++n >= 9) window.clearInterval(t); }, 130);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageWidth, ratio]);

  // Changing the scroll mode or spreads re-lays out every page: keep the current page in view.
  const curPageRef = useRef(1);
  curPageRef.current = curPage;
  const modeSeen = useRef(false);
  useEffect(() => {
    if (!modeSeen.current) { modeSeen.current = true; return; }
    const t = window.setTimeout(() => rootEl?.querySelector(`.pdfv-page[data-page="${curPageRef.current}"]`)?.scrollIntoView({ block: "start", inline: "start" }), 120);
    return () => window.clearTimeout(t);
  }, [scrollMode, spread, rootEl]);

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
      recordAnchor(p);
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

  const fileBase = () => (doc.title || key).replace(/[^\w .-]+/g, "").slice(0, 80) || "paper";

  function saveNow() {
    api.pdf.saveAnnotations(key, doc.url, doc.title, anns)
      .then((r) => { setSavedCopy(r.saved_copy); showToast("Highlights and notes saved", true); })
      .catch(() => showToast("Couldn’t save notes", false));
  }

  async function saveAs() {
    const name = `${fileBase()}.pdf`;
    const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> };
    if (!w.showSaveFilePicker) { download(); return; }
    try {
      const blob = await (await fetch(fileUrl)).blob();
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
      const wr = await h.createWritable();
      await wr.write(blob);
      await wr.close();
      showToast("PDF saved", true);
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") showToast("Couldn’t save the PDF", false);
    }
  }

  function saveText(text: string, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function annotationsMarkdown() {
    const body = [...anns]
      .sort((a, b) => a.page - b.page)
      .map((a) => `> ${a.text.replace(/\s+/g, " ")}  \n> — p. ${a.page}${a.note ? `\n\n${a.note}` : ""}`)
      .join("\n\n");
    return `# ${doc.title || key}\n\n${body}\n`;
  }

  async function printPdf() {
    try {
      const blob = await (await fetch(fileUrl)).blob();
      const url = URL.createObjectURL(blob);
      const f = document.createElement("iframe");
      f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      f.src = url;
      f.onload = () => {
        window.setTimeout(() => {
          try { f.contentWindow?.focus(); f.contentWindow?.print(); }
          catch { window.open(url, "_blank"); }
        }, 300);
      };
      document.body.appendChild(f);
      window.setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120000);
    } catch { showToast("Couldn’t open the PDF for printing", false); }
  }

  const fileItems: MenuItem[] = [
    { type: "item", label: "Save highlights & notes", shortcut: "Ctrl/⌘+S", onClick: saveNow },
    { type: "item", label: savedCopy ? "PDF copy kept in vault ✓" : "Keep a copy in vault", disabled: savedCopy, hint: "Already saved", onClick: () => void keepCopy() },
    { type: "item", label: "Save PDF as…", onClick: () => void saveAs() },
    { type: "sep" },
    { type: "item", label: "Download PDF", onClick: download },
    { type: "item", label: "Export highlights (Markdown)", disabled: anns.length === 0, hint: "No highlights yet", onClick: () => saveText(annotationsMarkdown(), `${fileBase()}-highlights.md`, "text/markdown") },
    { type: "item", label: "Export highlights (JSON)", disabled: anns.length === 0, hint: "No highlights yet", onClick: () => saveText(JSON.stringify(anns, null, 2), `${fileBase()}-highlights.json`, "application/json") },
    { type: "item", label: "Copy highlights as Markdown", disabled: anns.length === 0, hint: "No highlights yet", onClick: copyMarkdown },
    { type: "sep" },
    { type: "item", label: "Print…", shortcut: "Ctrl/⌘+P", onClick: () => void printPdf() },
    { type: "item", label: "Open in browser", onClick: () => { window.open(doc.url, "_blank", "noopener,noreferrer"); } },
    { type: "sep" },
    { type: "item", label: "Close", onClick: onClose },
  ];
  const fileMenu = <PdfFileMenu items={fileItems} />;

  // Ctrl/⌘+S saves highlights now; Ctrl/⌘+P prints the PDF rather than the whole app page.
  const keysRef = useRef({ save: () => {}, print: () => {} });
  keysRef.current = { save: saveNow, print: () => void printPdf() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && e.key.toLowerCase() === "p") return;
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); keysRef.current.save(); }
      else if (k === "p") { e.preventDefault(); keysRef.current.print(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Scroll to a destination, remembering where we were so the "Back" chip can return. */
  function goDest(page: number, frac: number | null) {
    if (!rootEl) return;
    const el = rootEl.querySelector<HTMLElement>(`.pdfv-page[data-page="${page}"]`);
    if (!el) return;
    setBack(rootEl.scrollTop);
    window.setTimeout(() => setBack(null), 20000);
    if (scrollMode === "horizontal") { el.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" }); return; }
    const r = el.getBoundingClientRect();
    rootEl.scrollTo({ top: rootEl.scrollTop + (r.top - rootEl.getBoundingClientRect().top) + (frac ?? 0) * r.height - 70, behavior: "smooth" });
  }

  /** Clicking a citation opens the cited paper right here (when it can be found); otherwise the reference card stays. */
  const [citeAutoOpen, setCiteAutoOpenState] = useState(() => { try { return localStorage.getItem("reader-cite-open") !== "0"; } catch { return true; } });
  function setCiteAutoOpen(v: boolean) { setCiteAutoOpenState(v); try { localStorage.setItem("reader-cite-open", v ? "1" : "0"); } catch { /* private mode */ } }
  const hoverTimer = useRef(0);
  const leaveTimer = useRef(0);
  const citeFromHover = useRef(false);

  async function showCite(l: PdfLink, x: number, y: number, hover: boolean) {
    if (!pdf || !l.dest) return;
    const d = await resolveDest(pdf, l.dest);
    if (!d) return;
    const name = typeof l.dest === "string" ? l.dest : "";
    const named = /^(cite|bib|ref\b|reference|b\d)/i.test(name);
    const seq = ++citeSeq.current;
    // Link names differ between journals ("cite.X", "bib12", or the whole entry text), so we also judge by what the target says.
    let text = "";
    try { text = await bibEntry(pdf, d.page, d.top, d.left); } catch { /* not a text target */ }
    if (seq !== citeSeq.current) return;
    if (!named && !looksLikeBib(text)) { if (!hover) goDest(d.page, d.frac); return; }
    const ids = bibIds(text);
    citeFromHover.current = hover;
    setCite({ x, y, page: d.page, frac: d.frac, text, busy: false, ...ids, name, finding: !!text, pdfUrl: "", landing: ids.doi ? `https://doi.org/${ids.doi}` : "", title: "", previewUrl: "" });
    renderRegion(pdf, d.page, d.top, d.left)
      .then((url) => { if (seq === citeSeq.current && url) setCite((c) => (c ? { ...c, previewUrl: url } : c)); })
      .catch(() => { /* the text card is enough */ });
    if (!text) return;
    // Find the paper itself (arXiv id, DOI via OpenAlex, or journal + volume + page) so it can be opened here.
    api.citation.resolve(text, name)
      .then((r) => {
        if (seq !== citeSeq.current) return;
        setCite((c) => (c ? { ...c, finding: false, arxiv: r.arxiv || c.arxiv, doi: r.doi || c.doi, pdfUrl: r.pdf_url, landing: r.landing_url || c.landing, title: r.title } : c));
        const url = r.pdf_url || (r.arxiv ? `https://arxiv.org/pdf/${r.arxiv}` : "");
        if (!hover && citeAutoOpen && url && openPdf) { openPdf({ url, title: r.title || (r.arxiv ? `arXiv:${r.arxiv}` : "Cited paper") }); setCite(null); }
      })
      .catch(() => { if (seq === citeSeq.current) setCite((c) => (c ? { ...c, finding: false } : c)); });
  }

  async function openLink(l: PdfLink, e: React.MouseEvent) {
    window.clearTimeout(hoverTimer.current);
    await showCite(l, e.clientX, e.clientY, false);
  }

  /** Hovering a citation shows the reference page after a short delay, like Zotero; leaving closes it unless you move onto the card. */
  function hoverLink(l: PdfLink | null, e?: React.MouseEvent) {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(leaveTimer.current);
    if (!l) { leaveTimer.current = window.setTimeout(() => { if (citeFromHover.current) setCite(null); }, 450); return; }
    if (!l.dest || !e) return;
    const x = e.clientX, y = e.clientY;
    hoverTimer.current = window.setTimeout(() => { void showCite(l, x, y, true); }, 350);
  }

  function openCitedPaper(c: Cite) {
    const url = c.pdfUrl || (c.arxiv ? `https://arxiv.org/pdf/${c.arxiv}` : "");
    if (url && openPdf) { openPdf({ url, title: c.title || (c.arxiv ? `arXiv:${c.arxiv}` : "Cited paper") }); setCite(null); }
    else if (c.arxiv) window.open(`https://arxiv.org/abs/${c.arxiv}`, "_blank", "noopener");
    else if (c.landing) window.open(c.landing, "_blank", "noopener");
    else if (url) window.open(url, "_blank", "noopener");
  }

  useEffect(() => {
    if (!cite && !themeMenu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (cite && !t?.closest(".pdfv-cite") && !t?.closest(".pdfv-link")) setCite(null);
      if (themeMenu && !t?.closest(".pdfv-theme")) setThemeMenu(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setCite(null); setThemeMenu(false); } };
    const onWheel = () => setCite(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    rootEl?.addEventListener("wheel", onWheel, { passive: true });
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); rootEl?.removeEventListener("wheel", onWheel); };
  }, [cite, themeMenu, rootEl]);

  function jumpTo(page: number) {
    rootEl?.querySelector(`.pdfv-page[data-page="${page}"]`)?.scrollIntoView({ block: "start", inline: "start", behavior: "smooth" });
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

  async function importPdf(f: File) {
    try { await api.pdf.upload(key, f); showToast("PDF imported", true); setReloadTick((t) => t + 1); }
    catch (e) { showToast(e instanceof Error ? e.message : "Couldn’t import that PDF", false); }
  }

  const renderPage = (n: number) => (
    <PdfPage key={`${key}-${n}`} pdf={pdf!} num={n} width={pageWidth} ratio={ratio} rootEl={rootEl} anns={anns.filter((a) => a.page === n)} onTextError={() => setTextFail(true)} tool={tool} color={toolColor} opacity={prefs.opacity} onCreate={createFromTool}
      find={findQ} findNth={hits[hitIdx]?.page === n ? hits[hitIdx].nth : null} onLink={(l, e) => void openLink(l, e)} onLinkHover={hoverLink} />
  );
  /** Spreads: "odd" pairs (1,2)(3,4)…, "even" leaves page 1 alone then pairs (2,3)(4,5)…. */
  const spreadRows = (total: number): number[][] => {
    const rows: number[][] = [];
    let i = 1;
    if (spread === "even" && total >= 1) { rows.push([1]); i = 2; }
    for (; i <= total; i += 2) rows.push(i + 1 <= total ? [i, i + 1] : [i]);
    return rows;
  };
  const customFilter = theme === "custom" ? (() => {
    const [fr, fg, fb] = hexRgb(custom.fg), [br, bgc, bb] = hexRgb(custom.bg);
    const t = (a: number, b: number) => `${(a / 255).toFixed(4)} ${(b / 255).toFixed(4)}`;
    return (
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
        <filter id={`pdfv-cf-${filterId}`} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={t(fr, br)} />
            <feFuncG type="table" tableValues={t(fg, bgc)} />
            <feFuncB type="table" tableValues={t(fb, bb)} />
          </feComponentTransfer>
        </filter>
      </svg>
    );
  })() : null;

  const pagesEl = (
    <div ref={setRootEl} className={`pdfv-scroll pdfv-m-${scrollMode}`}>
      {customFilter}
      {err ? (
        <div className="pdfv-msg pdfv-fail" onDragOver={(e) => { e.preventDefault(); setDropOver(true); }} onDragLeave={() => setDropOver(false)} onDrop={(e) => { e.preventDefault(); setDropOver(false); const f = e.dataTransfer.files?.[0]; if (f) void importPdf(f); }}>
          <p>{err}</p>
          <div className={`pdfv-drop${dropOver ? " over" : ""}`}>
            <span>Open it in your browser (your university access works there), save the PDF, then drop it here</span>
            <label className="btn">Choose PDF…<input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importPdf(f); e.target.value = ""; }} /></label>
            {doc.url && <a className="btn" href={doc.url} target="_blank" rel="noopener noreferrer">Open in browser ↗</a>}
          </div>
        </div>
      ) : !pdf ? (
        <div className="pdfv-msg">Loading PDF…</div>
      ) : twoUp ? (
        spreadRows(pdf.numPages).map((row) => <div key={row[0]} className="pdfv-spread">{row.map(renderPage)}</div>)
      ) : (
        Array.from({ length: pdf.numPages }, (_, i) => renderPage(i + 1))
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
          onDefine={lookupTerm(sel.text) ? () => setDefineFor((d) => (d === sel.text ? null : sel.text)) : undefined} defineOn={defineFor === sel.text}
          slots={doc.paper ? cer.slots : null} addingSlot={cer.addingSlot} onCeric={(k) => addToCeric(k, cer.slots.findIndex((x) => x.key === k))}
        />
      )}
      {sel && anchor && defineFor === sel.text && lookupTerm(sel.text) && (
        <PdfDefineCard key={defineFor} text={sel.text} below={anchor.below} onClose={() => setDefineFor(null)} />
      )}
      {cite && (
        <div className={`pdfv-cite${cite.previewUrl ? " has-preview" : ""}`} role="dialog" aria-label="Reference"
          style={{ left: Math.max(8, Math.min(cite.x - 20, window.innerWidth - (cite.previewUrl ? 756 : 396))), top: Math.max(8, Math.min(cite.y + 16, window.innerHeight - (cite.previewUrl ? 560 : 250))) }}
          onMouseEnter={() => window.clearTimeout(leaveTimer.current)}
          onMouseLeave={() => { if (citeFromHover.current) leaveTimer.current = window.setTimeout(() => setCite(null), 300); }}
          onPointerDown={() => { citeFromHover.current = false; }}>
          {cite.previewUrl && <img className="pdfv-cite-preview" src={cite.previewUrl} alt="Where this reference is" />}
          <div className="pdfv-cite-text">{cite.busy ? "Reading reference…" : cite.text || "Couldn’t read the reference text — use “Go to reference”."}</div>
          <div className="pdfv-cite-actions">
            {cite.finding && <button type="button" className="btn" disabled>Finding paper…</button>}
            {!cite.finding && (cite.pdfUrl || cite.arxiv || cite.landing) && <button type="button" className="btn btn-primary" onClick={() => openCitedPaper(cite)}>{cite.pdfUrl || cite.arxiv ? "Open paper" : "Open DOI"}</button>}
            {!cite.busy && cite.text && <a className="btn" href={`https://scholar.google.com/scholar?q=${encodeURIComponent(cite.text.slice(0, 220))}`} target="_blank" rel="noopener noreferrer">Search</a>}
            <button type="button" className="btn" onClick={() => { goDest(cite.page, cite.frac); setCite(null); }}>Go to reference</button>
            {!cite.busy && cite.text && <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(cite.text); showToast("Reference copied", true); }}>Copy</button>}
            <button type="button" className="btn pdfv-cite-x" onClick={() => setCite(null)} aria-label="Close">×</button>
          </div>
          <label className="pdfv-cite-pref"><input type="checkbox" checked={citeAutoOpen} onChange={(e) => setCiteAutoOpen(e.target.checked)} /> Clicking a citation opens the paper on the right</label>
        </div>
      )}
      {back !== null && <button type="button" className="btn pdfv-back" onClick={() => { rootEl?.scrollTo({ top: back, behavior: "smooth" }); setBack(null); }}>↩ Back</button>}
      {textFail && <div className="pdfv-warn">Text selection isn’t available for this PDF (see the console for details). You can still add a page note from the Notes list.</div>}
      {toast && <div className={`pdfv-toast ${toast.ok ? "ok" : "error"}`}>{toast.text}</div>}
    </>
  );

  const themeCtl = (btnClass: string) => (
    <span className="pdfv-theme">
      <button type="button" className={`${btnClass}${themeMenu ? " on" : ""}`} onClick={() => setThemeMenu((v) => !v)} aria-haspopup="menu" aria-expanded={themeMenu} title="Reading mode: scrolling, spreads, theme">
        <BookIcon name="theme" size={16} />
      </button>
      {themeMenu && (
        <div className="pdfv-theme-menu" role="menu" aria-label="Reading mode">
          <div className="pdfv-rm-title">Reading Mode</div>
          <div className="pdfv-rm-row"><span>Scrolling</span>
            <div className="pdfv-seg" role="radiogroup" aria-label="Scrolling">
              {SCROLL_MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={scrollMode === m.id} className={scrollMode === m.id ? "on" : ""} onClick={() => setScrollMode(m.id)}>{m.label}</button>)}
            </div>
          </div>
          <div className="pdfv-rm-row"><span>Spreads</span>
            <div className="pdfv-seg" role="radiogroup" aria-label="Spreads">
              {SPREADS.map((m) => <button key={m.id} type="button" role="radio" aria-checked={spread === m.id} className={spread === m.id ? "on" : ""} disabled={scrollMode !== "vertical"} title={scrollMode !== "vertical" ? "Spreads need vertical scrolling" : undefined} onClick={() => setSpread(m.id)}>{m.label}</button>)}
            </div>
          </div>
          <div className="pdfv-rm-row"><span>Themes</span>
            <div className="pdfv-themegrid" role="radiogroup" aria-label="Themes">
              {THEMES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`pdfv-themesw ${t.id}${theme === t.id ? " on" : ""}`} onClick={() => setTheme(t.id)}>{t.label}</button>
              ))}
              <button type="button" role="radio" aria-checked={theme === "custom"} className={`pdfv-themesw custom${theme === "custom" ? " on" : ""}`} title="Custom colours" aria-label="Custom theme"
                style={theme === "custom" ? { background: custom.bg, color: custom.fg } : undefined} onClick={() => setCustom(custom)}>{theme === "custom" ? "Aa" : "+"}</button>
            </div>
          </div>
          {theme === "custom" && (
            <div className="pdfv-custom">
              <label>Page <input type="color" value={custom.bg} onChange={(e) => setCustom({ ...custom, bg: e.target.value })} /></label>
              <label>Text <input type="color" value={custom.fg} onChange={(e) => setCustom({ ...custom, fg: e.target.value })} /></label>
            </div>
          )}
          <label className="pdfv-keepfigs-opt"><input type="checkbox" checked={keepFigs} onChange={(e) => setKeepFigs(e.target.checked)} /> Keep figures &amp; plots in original colours</label>
          <label className="pdfv-warmth">
            <span>Warmth <em>{warmth}%</em></span>
            <input type="range" min={0} max={100} step={1} value={warmth} onChange={(e) => setWarmth(Number(e.target.value))} aria-label="Page warmth" />
            <span className="pdfv-warmth-ends"><small>Cool</small><small>Warm</small></span>
          </label>
        </div>
      )}
    </span>
  );

  if (embedded) {
    const ib = (on = false) => `pdfv-ib${on ? " on" : ""}`;
    return (
      <div className={`pdf-viewer pdfv-books pdfv-theme-${theme}${themeDark ? " pdfv-dark" : ""}${keepFigs ? " pdfv-keepfigs" : ""}${fullscreen ? " is-full" : ""}`} style={{ "--pdfv-warm": warmth / 100, "--pdfv-cf": theme === "custom" ? `url(#pdfv-cf-${filterId})` : "none", "--pdfv-bg": custom.bg } as React.CSSProperties}>
        <div className="pdfv-topbar" role="toolbar" aria-label="Reader toolbar">
          {fileMenu}
          <button type="button" className={ib(sbOpen)} onClick={toggleSb} aria-pressed={sbOpen} title={sbOpen ? "Hide sidebar" : "Show sidebar (contents, pages, search, notes)"}><BookIcon name="sidebar" size={17} /></button>
          {doc.kind && <ConvertButton iconOnly fileKey={key} url={doc.url} name={doc.title} kind={doc.kind} onResult={showToast} />}
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
          {themeCtl(ib())}
          <span className="pdfv-tb-sep" />
          <span className="pdfv-tb-tools">{toolButtons}</span>
          {tool !== "select" && <span className="pdfv-hint">Esc</span>}
          <span className="pdfv-tb-sep" />
          <span className="pdfv-tb-sep" />
          {trail}
          <button type="button" className={ib(rsOpen)} onClick={() => setRsOpen((v) => !v)} aria-pressed={rsOpen} title={rsOpen ? "Hide notes panel" : "Show notes panel (highlights and my notes)"}>
            <BookIcon name="annot" size={17} />{anns.length > 0 && <em className="pdfv-badge">{anns.length}</em>}
          </button>
        </div>
        <div className="pdfv-body">
          {sbOpen && (
            <ReaderSidebar
              pdf={pdf} ratio={ratio} current={curPage} onJump={jumpTo} tab={sbTab} onTab={setSbTab}
              query={findQ} hits={hits} hitIndex={hitIdx} searching={findBusy} onHit={(i) => goHit(i)}
              width={sbW} onWidth={setSbW}
            />
          )}
          <div className="pdfv-stage">
            {floating}
            {pagesEl}
          </div>
          {rsOpen && (
            <aside className="pdfv-rside" aria-label="Notes panel">
              <div className="pdfv-rside-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={rsTab === "paper"} className={rsTab === "paper" ? "on" : ""} onClick={() => setRsTab("paper")}>This paper{anns.length > 0 && <em>{anns.length}</em>}</button>
                <button type="button" role="tab" aria-selected={rsTab === "mine"} className={rsTab === "mine" ? "on" : ""} onClick={() => { setRnOpen(true); setRsTab("mine"); }}>My notes</button>
              </div>
              <div className="pdfv-rside-body" style={{ display: rsTab === "paper" ? "flex" : "none" }}>{notesList}</div>
              <div className="pdfv-rside-body" style={{ display: rsTab === "mine" ? "flex" : "none" }}>
                {(rnOpen || rsTab === "mine") && <ReaderNotes title={doc.title} page={curPage} queue={rnQueue} onQueueDone={() => setRnQueue([])} onSource={setRnSrc} onClose={() => setRsTab("paper")} />}
              </div>
            </aside>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`pdf-viewer pdfv-theme-${theme}${themeDark ? " pdfv-dark" : ""}${keepFigs ? " pdfv-keepfigs" : ""}${fullscreen ? " is-full" : ""}`} style={{ "--pdfv-warm": warmth / 100, "--pdfv-cf": theme === "custom" ? `url(#pdfv-cf-${filterId})` : "none", "--pdfv-bg": custom.bg } as React.CSSProperties}>
      {!doc.embedded && <ActivityTimer category="papers" />}
      <div className="pdf-viewer-bar">
        {fileMenu}
        <button type="button" className="btn pdfv-collapse" onClick={() => { toggleSlim(); setTool("select"); }} aria-expanded={!slim} title={slim ? "Show zoom and annotation tools" : "Hide zoom and annotation tools"}>
          {slim ? "▾ Tools" : "▴ Tools"}
        </button>
        <span className="pdf-viewer-title" title={doc.title}>{doc.title}</span>
        {themeCtl("btn")}
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
