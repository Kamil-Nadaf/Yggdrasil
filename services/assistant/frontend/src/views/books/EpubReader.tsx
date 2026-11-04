import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import ePub from "epubjs";
import type { Book, NavItem, Rendition } from "epubjs";
import { reading, type EpubHighlight, type ReadingBook } from "../../api/reading";

const COLORS: { name: string; css: string }[] = [
  { name: "Yellow", css: "rgba(255, 213, 0, 0.45)" },
  { name: "Green", css: "rgba(88, 214, 141, 0.45)" },
  { name: "Blue", css: "rgba(86, 169, 255, 0.42)" },
  { name: "Pink", css: "rgba(255, 128, 191, 0.45)" },
];

const FONT_KEY = "yggdrasil:epub-font-size";
const FLOW_KEY = "yggdrasil:epub-flow";

type Flow = "paginated" | "scrolled-doc";

interface Sel { cfi: string; text: string; chapter: string }

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function EpubReader({ book: meta, pageRef }: { book: ReadingBook; pageRef: MutableRefObject<number | undefined> }) {
  const host = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const rendRef = useRef<Rendition | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const hlRef = useRef<EpubHighlight[]>([]);
  const dirty = useRef(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [toc, setToc] = useState<NavItem[]>([]);
  const [panel, setPanel] = useState<"none" | "toc" | "notes">("none");
  const [highlights, setHighlights] = useState<EpubHighlight[]>([]);
  const [loadedHl, setLoadedHl] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [chapter, setChapter] = useState("");
  const [percent, setPercent] = useState(Math.round(meta.progress * 100));
  const [fontSize, setFontSize] = useState<number>(() => {
    const n = Number(localStorage.getItem(FONT_KEY));
    return n >= 80 && n <= 200 ? n : 110;
  });
  const [flow, setFlow] = useState<Flow>(() => (localStorage.getItem(FLOW_KEY) === "scrolled-doc" ? "scrolled-doc" : "paginated"));
  const [toast, setToast] = useState("");

  hlRef.current = highlights;

  function showToast(t: string) {
    setToast(t);
    window.setTimeout(() => setToast(""), 2400);
  }

  const chapterFor = useCallback((href: string): string => {
    const clean = href.split("#")[0];
    const find = (items: NavItem[]): string => {
      for (const it of items) {
        if (it.href.split("#")[0] === clean) return it.label.trim();
        const sub = it.subitems ? find(it.subitems) : "";
        if (sub) return sub;
      }
      return "";
    };
    return find(toc);
  }, [toc]);

  // ── open the book ──
  useEffect(() => {
    let dead = false;
    let book: Book | null = null;
    setStatus("loading");
    setErr("");
    (async () => {
      const resp = await fetch(reading.fileUrl(meta.slug));
      if (!resp.ok) throw new Error(`Could not load the book (${resp.status})`);
      const data = await resp.arrayBuffer();
      if (dead || !host.current) return;
      book = ePub(data);
      bookRef.current = book;
      const rendition = book.renderTo(host.current, {
        width: "100%",
        height: "100%",
        flow,
        spread: "none",
        allowScriptedContent: false,
      });
      rendRef.current = rendition;

      const text = cssVar("--text", "#222");
      const bg = cssVar("--bg", "#fff");
      const accent = cssVar("--accent", "#2a6");
      rendition.themes.default({
        html: { background: `${bg} !important` },
        body: {
          color: `${text} !important`,
          background: `${bg} !important`,
          "font-family": `${cssVar("--font-title", "Georgia, serif")} !important`,
          "line-height": "1.65 !important",
          padding: "0 6px !important",
        },
        "p, li, span, div": { color: "inherit" },
        a: { color: `${accent} !important` },
        img: { "max-width": "100% !important", height: "auto !important" },
        "::selection": { background: "rgba(86,169,255,0.35)" },
      });
      rendition.themes.fontSize(`${fontSize}%`);

      rendition.on("relocated", (loc: { start: { cfi: string; href: string; percentage: number } }) => {
        const cfi = loc.start.cfi;
        const b = bookRef.current;
        const pct = b && b.locations.length() > 0 ? b.locations.percentageFromCfi(cfi) : loc.start.percentage;
        setPercent(Math.round(pct * 100));
        setChapter(loc.start.href);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void reading.patch(meta.slug, { last_position: cfi, progress: Number.isFinite(pct) ? pct : 0 }).catch(() => {});
        }, 1500);
      });

      rendition.on("selected", (cfiRange: string, contents: { window: Window; document: Document }) => {
        const s = contents.window.getSelection();
        const t = s?.toString().trim() || "";
        if (!t) return;
        const href = (rendition.location as { start?: { href?: string } } | undefined)?.start?.href || "";
        setSel({ cfi: cfiRange, text: t, chapter: href });
      });

      rendition.on("keyup", (e: KeyboardEvent) => {
        if (e.key === "ArrowRight") void rendition.next();
        if (e.key === "ArrowLeft") void rendition.prev();
      });

      await rendition.display(meta.last_position || undefined);
      if (dead) return;
      setStatus("ready");

      void book.loaded.navigation.then((nav) => { if (!dead) setToc(nav.toc); });

      // Locations give an accurate % — generated once, cached per book in this browser.
      const cacheKey = `yggdrasil:epub-locations:${meta.slug}`;
      const cached = localStorage.getItem(cacheKey);
      try {
        if (cached) book.locations.load(cached);
        else {
          await book.ready;
          await book.locations.generate(1600);
          try { localStorage.setItem(cacheKey, book.locations.save()); } catch { /* storage full: regenerate next time */ }
        }
      } catch {
        /* progress falls back to the section-level percentage */
      }
    })().catch((e) => {
      if (!dead) { setStatus("error"); setErr(e instanceof Error ? e.message : "Could not open this EPUB"); }
    });

    reading.highlights(meta.slug)
      .then((r) => { if (!dead) { setHighlights(r.highlights || []); setLoadedHl(true); } })
      .catch(() => { if (!dead) setLoadedHl(true); });

    return () => {
      dead = true;
      window.clearTimeout(saveTimer.current);
      try { rendRef.current?.destroy(); } catch { /* already gone */ }
      try { book?.destroy(); } catch { /* already gone */ }
      rendRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.slug]);

  // ── apply highlights to the rendition whenever the list changes ──
  const painted = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const r = rendRef.current;
    if (!r || status !== "ready") return;
    const want = new Map(highlights.map((h) => [h.cfi, h.color]));
    painted.current.forEach((color, cfi) => {
      if (!want.has(cfi) || want.get(cfi) !== color) {
        try { r.annotations.remove(cfi, "highlight"); } catch { /* not painted */ }
        painted.current.delete(cfi);
      }
    });
    highlights.forEach((h) => {
      if (painted.current.has(h.cfi)) return;
      try {
        r.annotations.highlight(
          h.cfi,
          { id: h.id },
          () => { setPanel("notes"); setFocusId(h.id); },
          "bk-epub-hl",
          { fill: h.color, "fill-opacity": "1", "mix-blend-mode": "multiply" }
        );
        painted.current.set(h.cfi, h.color);
      } catch {
        /* a highlight from another edition of the book may not resolve */
      }
    });
  }, [highlights, status]);

  // ── persist highlights (debounced) ──
  useEffect(() => {
    if (!loadedHl || !dirty.current) return;
    const t = window.setTimeout(() => {
      reading.saveHighlights(meta.slug, highlights).catch(() => showToast("Couldn’t save highlights"));
    }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights]);

  useEffect(() => {
    try { localStorage.setItem(FONT_KEY, String(fontSize)); } catch { /* ignore */ }
    rendRef.current?.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  useEffect(() => {
    try { localStorage.setItem(FLOW_KEY, flow); } catch { /* ignore */ }
    const r = rendRef.current;
    if (r && status === "ready") r.flow(flow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  // page turns from the keyboard when focus is outside the book iframe
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") void rendRef.current?.next();
      if (e.key === "ArrowLeft") void rendRef.current?.prev();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => { pageRef.current = undefined; }, [pageRef]);

  function commit(next: EpubHighlight[]) {
    dirty.current = true;
    setHighlights(next);
  }

  function addHighlight(color: string, openNote = false) {
    if (!sel) return;
    const h: EpubHighlight = {
      id: newId(), cfi: sel.cfi, text: sel.text, color, note: "",
      chapter: chapterFor(sel.chapter) || "", created: new Date().toISOString(),
    };
    commit([...highlights, h]);
    try { (rendRef.current?.getContents() as unknown as { window: Window }[] | undefined)?.forEach((c) => c.window.getSelection()?.removeAllRanges()); } catch { /* ignore */ }
    setSel(null);
    if (openNote) { setPanel("notes"); setFocusId(h.id); }
  }

  function goTo(cfi: string) {
    void rendRef.current?.display(cfi);
  }

  function copyMarkdown() {
    const md = highlights
      .map((h) => `> ${h.text.replace(/\s+/g, " ")}  \n> — ${meta.title}${h.chapter ? `, ${h.chapter}` : ""}${h.note ? `\n\n${h.note}` : ""}`)
      .join("\n\n");
    void navigator.clipboard?.writeText(md);
    showToast("Highlights copied as Markdown");
  }

  const sorted = useMemo(() => [...highlights].sort((a, b) => a.created.localeCompare(b.created)), [highlights]);
  const chapterLabel = chapterFor(chapter);

  function renderToc(items: NavItem[], depth = 0) {
    return items.map((it) => (
      <div key={`${it.id}-${it.href}`}>
        <button type="button" className="bk-toc-item" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => { void rendRef.current?.display(it.href); if (window.innerWidth < 900) setPanel("none"); }}>
          {it.label.trim() || "Untitled"}
        </button>
        {it.subitems && it.subitems.length > 0 && renderToc(it.subitems, depth + 1)}
      </div>
    ));
  }

  return (
    <div className="pdf-viewer epub-viewer">
      <div className="pdf-viewer-bar">
        <span className="pdf-viewer-title" title={chapterLabel || meta.title}>{chapterLabel || meta.title}</span>
        <button type="button" className={`btn${panel === "toc" ? " btn-primary" : ""}`} onClick={() => setPanel(panel === "toc" ? "none" : "toc")} aria-pressed={panel === "toc"}>Contents</button>
        <button type="button" className={`btn${panel === "notes" ? " btn-primary" : ""}`} onClick={() => setPanel(panel === "notes" ? "none" : "notes")} aria-pressed={panel === "notes"}>
          Notes{highlights.length ? ` (${highlights.length})` : ""}
        </button>
      </div>
      <div className="epub-toolbar">
        <button type="button" className="btn" onClick={() => setFontSize((s) => Math.max(80, s - 10))} disabled={fontSize <= 80} aria-label="Smaller text">A−</button>
        <span className="mono muted" style={{ fontSize: 11 }}>{fontSize}%</span>
        <button type="button" className="btn" onClick={() => setFontSize((s) => Math.min(200, s + 10))} disabled={fontSize >= 200} aria-label="Larger text">A+</button>
        <button type="button" className="btn" onClick={() => setFlow(flow === "paginated" ? "scrolled-doc" : "paginated")} title="Switch between pages and continuous scrolling">
          {flow === "paginated" ? "Pages" : "Scroll"}
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => void rendRef.current?.prev()} aria-label="Previous page">‹</button>
        <span className="mono muted" style={{ fontSize: 11, minWidth: 38, textAlign: "center" }}>{status === "ready" ? `${percent}%` : "…"}</span>
        <button type="button" className="btn" onClick={() => void rendRef.current?.next()} aria-label="Next page">›</button>
      </div>

      <div className="pdfv-stage">
        {sel && (
          <div className="pdfv-selbar">
            <span className="pdfv-selbar-text">“{sel.text.length > 50 ? `${sel.text.slice(0, 50)}…` : sel.text}”</span>
            <span className="pdfv-selbar-group">
              {COLORS.map((c) => (
                <button key={c.name} type="button" className="pdfv-swatch" style={{ background: c.css }} title={`Highlight ${c.name.toLowerCase()}`} onClick={() => addHighlight(c.css)} />
              ))}
              <button type="button" className="btn" onClick={() => addHighlight(COLORS[0].css, true)}>+ Note</button>
              <button type="button" className="btn" onClick={() => setSel(null)} aria-label="Dismiss">×</button>
            </span>
          </div>
        )}
        {toast && <div className="pdfv-toast ok">{toast}</div>}

        <div className="epub-body">
          {panel === "toc" && (
            <div className="epub-side">
              <div className="pdfv-notes-head"><strong>Contents</strong><span style={{ flex: 1 }} /><button type="button" className="btn" onClick={() => setPanel("none")} aria-label="Close contents">×</button></div>
              {toc.length === 0 ? <div className="muted" style={{ padding: 10, fontSize: 13 }}>This book has no table of contents.</div> : renderToc(toc)}
            </div>
          )}
          <div className="epub-stage">
            {status === "loading" && <div className="pdfv-msg">Opening book…</div>}
            {status === "error" && <div className="pdfv-msg">{err}</div>}
            <div ref={host} className="epub-host" aria-label={`Reading ${meta.title}`} />
          </div>
          {panel === "notes" && (
            <div className="epub-side epub-side--right">
              <div className="pdfv-notes-head">
                <strong>Highlights &amp; notes</strong>
                <span style={{ flex: 1 }} />
                {highlights.length > 0 && <button type="button" className="btn" onClick={copyMarkdown}>Copy Markdown</button>}
                <button type="button" className="btn" onClick={() => setPanel("none")} aria-label="Close notes">×</button>
              </div>
              {sorted.length === 0 && <div className="muted" style={{ padding: 10, fontSize: 13 }}>Nothing yet. Select text in the book, then choose a colour or “+ Note”.</div>}
              {sorted.map((h) => (
                <div key={h.id} className={`pdfv-note${h.id === focusId ? " focus" : ""}`}>
                  <div className="pdfv-note-top">
                    <button type="button" className="btn" onClick={() => goTo(h.cfi)}>Go to</button>
                    {COLORS.map((c) => (
                      <button key={c.name} type="button" className={`pdfv-swatch small${h.color === c.css ? " on" : ""}`} style={{ background: c.css }} title={c.name}
                        onClick={() => commit(highlights.map((x) => (x.id === h.id ? { ...x, color: c.css } : x)))} />
                    ))}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn" onClick={() => commit(highlights.filter((x) => x.id !== h.id))}>Delete</button>
                  </div>
                  {h.chapter && <div className="muted" style={{ fontSize: 11 }}>{h.chapter}</div>}
                  <div className="pdfv-note-quote" style={{ borderLeftColor: h.color }}>{h.text}</div>
                  <textarea
                    className="pdfv-note-input"
                    placeholder="Add a note…"
                    autoFocus={h.id === focusId}
                    defaultValue={h.note}
                    rows={2}
                    onBlur={(e) => { if (e.target.value !== h.note) commit(highlights.map((x) => (x.id === h.id ? { ...x, note: e.target.value } : x))); }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
