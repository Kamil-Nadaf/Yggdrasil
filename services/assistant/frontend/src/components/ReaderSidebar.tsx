import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import BookIcon from "./BookIcons";

export type SidebarTab = "toc" | "thumbs" | "search" | "notes";

export interface FindHit { page: number; nth: number; snippet: string }

interface OutlineNode { title: string; dest: unknown; items: OutlineNode[] }

interface Props {
  pdf: PDFDocumentProxy | null;
  ratio: number;
  current: number;
  onJump: (page: number) => void;
  tab: SidebarTab;
  onTab: (t: SidebarTab) => void;
  query: string;
  hits: FindHit[];
  hitIndex: number;
  searching: { done: number; total: number } | null;
  onHit: (i: number) => void;
  notesCount?: number;
  notes?: ReactNode;
  width?: number;
  onWidth?: (w: number) => void;
}

const TABS: { id: SidebarTab; icon: "contents" | "grid" | "search" | "annot"; label: string }[] = [
  { id: "toc", icon: "contents", label: "Contents" },
  { id: "thumbs", icon: "grid", label: "Pages" },
  { id: "search", icon: "search", label: "Search results" },
];

/** Apple-Books-style left sidebar: table of contents, page thumbnails, search results, annotations. */
export default function ReaderSidebar(p: Props) {
  return (
    <aside className="rsb" aria-label="Reader sidebar" style={p.width ? { flexBasis: p.width, width: p.width } : undefined}>
      <div className="rsb-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={p.tab === t.id} className={`rsb-tab${p.tab === t.id ? " on" : ""}`} title={t.label} onClick={() => p.onTab(t.id)}>
            <BookIcon name={t.icon} size={16} />
            {t.id === "search" && p.hits.length > 0 && <em>{p.hits.length > 999 ? "999+" : p.hits.length}</em>}
          </button>
        ))}
      </div>
      <div className="rsb-body">
        {p.tab === "toc" && <Outline pdf={p.pdf} onJump={p.onJump} />}
        {p.tab === "thumbs" && <Thumbs pdf={p.pdf} ratio={p.ratio} current={p.current} onJump={p.onJump} />}
        {p.tab === "search" && <Results {...p} />}
      </div>
      {p.onWidth && <Resizer width={p.width || 240} onWidth={p.onWidth} />}
    </aside>
  );
}

function Outline({ pdf, onJump }: { pdf: PDFDocumentProxy | null; onJump: (page: number) => void }) {
  const [items, setItems] = useState<OutlineNode[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!pdf) return;
    let dead = false;
    pdf.getOutline().then((o) => { if (!dead) setItems((o as unknown as OutlineNode[] | null) || []); }).catch(() => { if (!dead) setItems([]); });
    return () => { dead = true; };
  }, [pdf]);

  async function go(dest: unknown) {
    if (!pdf || !dest) return;
    try {
      const d = typeof dest === "string" ? await pdf.getDestination(dest) : (dest as unknown[]);
      if (!d) return;
      const ref = d[0] as { num: number; gen: number } | number;
      const idx = typeof ref === "object" ? await pdf.getPageIndex(ref) : ref;
      onJump(idx + 1);
    } catch { /* unresolved destination */ }
  }

  function render(nodes: OutlineNode[], depth: number, path: string): ReactNode {
    return nodes.map((n, i) => {
      const id = `${path}/${i}`;
      const kids = n.items?.length > 0;
      return (
        <div key={id}>
          <div className="rsb-toc-row" style={{ paddingLeft: 6 + depth * 14 }}>
            <button type="button" className="rsb-caret" aria-label={open[id] ? "Collapse" : "Expand"} style={{ visibility: kids ? "visible" : "hidden" }} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
              <BookIcon name={open[id] ? "down" : "next"} size={12} />
            </button>
            <button type="button" className="rsb-toc-item" onClick={() => void go(n.dest)} title={n.title}>{n.title || "Untitled"}</button>
          </div>
          {kids && open[id] && render(n.items, depth + 1, id)}
        </div>
      );
    });
  }

  if (!items) return <div className="rsb-empty muted">Loading…</div>;
  if (items.length === 0) return <div className="rsb-empty muted">This PDF has no table of contents. Use the Pages tab or search.</div>;
  return <div className="rsb-toc">{render(items, 0, "")}</div>;
}

function Thumb({ pdf, num, ratio, active, root, onJump }: { pdf: PDFDocumentProxy; num: number; ratio: number; active: boolean; root: HTMLElement | null; onJump: (n: number) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [vis, setVis] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    const el = btn.current;
    if (!el || !root) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setVis(true); }, { root, rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  useEffect(() => {
    if (!vis || done.current) return;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(num);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: (120 * dpr) / base.width });
      const c = canvas.current;
      if (!c || cancelled) return;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      done.current = true;
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [vis, pdf, num]);
  useEffect(() => { if (active) btn.current?.scrollIntoView({ block: "nearest" }); }, [active]);
  return (
    <button ref={btn} type="button" className={`rsb-thumb${active ? " on" : ""}`} onClick={() => onJump(num)} aria-label={`Page ${num}`} aria-current={active}>
      <span className="rsb-thumb-box" style={{ aspectRatio: `${1 / ratio}` }}><canvas ref={canvas} /></span>
      <span className="rsb-thumb-n">{num}</span>
    </button>
  );
}

function Thumbs({ pdf, ratio, current, onJump }: { pdf: PDFDocumentProxy | null; ratio: number; current: number; onJump: (n: number) => void }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  if (!pdf) return <div className="rsb-empty muted">Loading…</div>;
  return (
    <div ref={setRoot} className="rsb-thumbs">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Thumb key={i + 1} pdf={pdf} num={i + 1} ratio={ratio} active={current === i + 1} root={root} onJump={onJump} />
      ))}
    </div>
  );
}

function Results({ query, hits, hitIndex, searching, onHit }: Props) {
  if (!query) return <div className="rsb-empty muted">Type in the search box above and press Enter. Ctrl/⌘ F focuses it.</div>;
  return (
    <div className="rsb-results">
      <div className="rsb-results-head muted">
        {searching ? `Searching… ${searching.done}/${searching.total}` : `${hits.length} result${hits.length === 1 ? "" : "s"} for “${query}”`}
      </div>
      {hits.map((h, i) => (
        <button key={i} type="button" className={`rsb-hit${i === hitIndex ? " on" : ""}`} onClick={() => onHit(i)}>
          <span className="rsb-hit-page">p. {h.page}</span>
          <span className="rsb-hit-text">{highlight(h.snippet, query)}</span>
        </button>
      ))}
    </div>
  );
}

function highlight(text: string, q: string): ReactNode {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}


/** Drag handle on the sidebar's right edge (also keyboard: ← → keys, and S / M / L presets). */
function Resizer({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const clamp = (n: number) => Math.min(560, Math.max(200, Math.round(n)));
  function down(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const move = (ev: PointerEvent) => onWidth(clamp(startW + ev.clientX - startX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.classList.remove("rsb-dragging"); };
    document.body.classList.add("rsb-dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  return (
    <>
      <div className="rsb-presets" role="group" aria-label="Sidebar width">
        {[["S", 220], ["M", 300], ["L", 420]].map(([l, w]) => (
          <button key={l} type="button" className={Math.abs(width - (w as number)) < 20 ? "on" : ""} onClick={() => onWidth(w as number)} title={`${w}px`}>{l}</button>
        ))}
      </div>
      <div className="rsb-resize" role="separator" aria-orientation="vertical" aria-label="Drag to resize the sidebar" tabIndex={0} onPointerDown={down}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") onWidth(clamp(width - 20)); if (e.key === "ArrowRight") onWidth(clamp(width + 20)); }} />
    </>
  );
}
