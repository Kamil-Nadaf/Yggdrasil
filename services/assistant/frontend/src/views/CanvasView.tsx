import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import katex from "katex";
import { api } from "../api/client";
import { canvasApi } from "../api/canvas";
import { activeEnginePayload, loadEngines } from "../lib/canvasEngines";
import InkSurface from "./canvas/InkSurface";
import { requestSettingsSection } from "../lib/driveSync";
import {
  PAGE_NAME_RE, PAGE_W, asDisplayLatex, emptyPage, pageSlug, renderCrop,
  type Block, type PageData, type Stroke, type Tool,
} from "./canvas/ink";
import "./canvas/canvas.css";

type Mode = "lasso" | "auto" | "page";

const PAGE_KEY = "yggdrasil:canvas-page";
const INK_COLORS = [
  { id: "navy", value: "#1D2B44", label: "Navy" },
  { id: "clay", value: "#C97B4A", label: "Clay" },
  { id: "teal", value: "#2E8B7A", label: "Teal" },
];
const MODE_HINT: Record<Mode, string> = {
  lasso: "Circle your writing with the lasso, then tap Convert.",
  auto: "Converts about a second after you stop writing.",
  page: "Convert reads everything on the page.",
};
const AUTO_DELAY_MS = 1200;

const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: "pen", label: "Pen", icon: <path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19l-4 1zM14 7l3 3" /> },
  { id: "highlighter", label: "Highlighter", icon: <path d="M9 15l6-6 4 4-6 6H9zM9 15l-3 3h4M15 9l-1-3 3-1 2 4" /> },
  { id: "eraser", label: "Eraser", icon: <path d="M7 20h12M5 15l9-9 5 5-7 7H8z" /> },
  { id: "lasso", label: "Lasso select", icon: <><ellipse cx="12" cy="10" rx="8" ry="5" strokeDasharray="3 3" /><path d="M8 14c-1 3 1 5 3 4" /></> },
];

function renderMath(src: string): { html: string } | { error: string } {
  try {
    return { html: katex.renderToString(src, { displayMode: true, throwOnError: true, strict: "ignore" }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "") : "Cannot render" };
  }
}

interface Props {
  onOpenLatex?: () => void;
  /** Used inside the LaTeX / Slides dialogs: hides "Open LaTeX" and swaps the actions for an insert button. */
  embedded?: boolean;
  /** Called with display-ready LaTeX for one block, or all blocks joined. */
  onInsert?: (latex: string, which: "block" | "all") => void;
  insertLabel?: string;
  insertAllLabel?: string;
  onClose?: () => void;
  title?: string;
}

export default function CanvasView({ onOpenLatex, embedded, onInsert, insertLabel = "Insert", insertAllLabel = "Insert all", onClose, title }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageName, setPageName] = useState(() => localStorage.getItem(PAGE_KEY) || "untitled");
  const [pageList, setPageList] = useState<string[]>([]);
  const [data, setData] = useState<PageData>(emptyPage);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const undo = useRef<PageData[]>([]);
  const redo = useRef<PageData[]>([]);
  const [, bump] = useState(0);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(INK_COLORS[0].value);
  const [width, setWidth] = useState(3);
  const [scale, setScale] = useState(1);
  const [fingerDraws, setFingerDraws] = useState(() => localStorage.getItem("yggdrasil:canvas-finger") === "1");
  const [mode, setMode] = useState<Mode>("lasso");
  const [selection, setSelection] = useState<number[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeBlock, setActiveBlock] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const dataRef = useRef(data);
  dataRef.current = data;

  // ── page load / save ──────────────────────────────────────────────────────
  const refreshList = useCallback(() => {
    canvasApi.pages().then((r) => setPageList(r.pages.map((p) => p.name))).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSelection([]);
    setActiveBlock(null);
    undo.current = [];
    redo.current = [];
    canvasApi
      .getPage(pageName)
      .then((d) => { if (!cancelled) { setData({ ...emptyPage(), ...d }); setLoaded(true); } })
      .catch((e: Error & { status?: number }) => {
        if (cancelled) return;
        if (e.status !== 404) setError(`Could not open "${pageName}": ${e.message}`);
        setData(emptyPage());
        setLoaded(true);
      });
    localStorage.setItem(PAGE_KEY, pageName);
    return () => { cancelled = true; };
  }, [pageName]);

  useEffect(() => { refreshList(); }, [refreshList]);

  // Debounced autosave. Skipped until the page has loaded so an empty page never overwrites a real one.
  const dirty = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (!dirty.current) return;
    setSaveState("saving");
    const name = pageName;
    const t = window.setTimeout(() => {
      canvasApi.putPage(name, dataRef.current)
        .then(() => { setSaveState("saved"); dirty.current = false; refreshList(); })
        .catch(() => setSaveState("error"));
    }, 900);
    return () => window.clearTimeout(t);
  }, [data, loaded, pageName, refreshList]);

  // Leaving the view or switching pages inside the debounce window must not lose the last strokes.
  const pageNameRef = useRef(pageName);
  pageNameRef.current = pageName;
  useEffect(() => () => {
    if (dirty.current) canvasApi.putPage(pageNameRef.current, dataRef.current).catch(() => {});
  }, []);

  const switchPage = async (name: string) => {
    if (name === pageName) return;
    if (dirty.current) {
      try {
        await canvasApi.putPage(pageName, dataRef.current);
        dirty.current = false;
      } catch {
        setError("The current page could not be saved, so it was not closed. Check the connection and try again.");
        return;
      }
    }
    setError(null);
    setPageName(name);
  };

  const commit = useCallback((next: PageData, opts?: { history?: boolean }) => {
    if (opts?.history !== false) {
      undo.current.push(dataRef.current);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
    }
    dirty.current = true;
    setData(next);
    bump((n) => n + 1);
  }, []);

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(dataRef.current);
    dirty.current = true;
    setData(prev);
    setSelection([]);
    bump((n) => n + 1);
  };
  const doRedo = () => {
    const nxt = redo.current.pop();
    if (!nxt) return;
    undo.current.push(dataRef.current);
    dirty.current = true;
    setData(nxt);
    setSelection([]);
    bump((n) => n + 1);
  };

  // Zoom fit on first layout.
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc && sc.clientWidth) setScale(Math.min(1.2, Math.max(0.4, (sc.clientWidth - 16) / PAGE_W)));
  }, []);

  // ── ink callbacks ─────────────────────────────────────────────────────────
  const nextId = () => {
    const id = dataRef.current.nextId;
    dataRef.current = { ...dataRef.current, nextId: id + 1 };
    return id;
  };

  const convertRef = useRef<(ids: number[] | "all" | "new") => void>(() => {});
  const autoTimer = useRef(0);

  const onStroke = (s: Stroke) => {
    commit({ ...dataRef.current, strokes: [...dataRef.current.strokes, s] });
    setSelection([]);
    if (mode === "auto" && s.tool === "pen") {
      window.clearTimeout(autoTimer.current);
      autoTimer.current = window.setTimeout(() => convertRef.current("new"), AUTO_DELAY_MS);
    }
  };
  useEffect(() => () => window.clearTimeout(autoTimer.current), []);

  const onErase = (ids: number[]) => {
    const gone = new Set(ids);
    commit({ ...dataRef.current, strokes: dataRef.current.strokes.filter((s) => !gone.has(s.id)) });
    setSelection((sel) => sel.filter((id) => !gone.has(id)));
  };

  const deleteSelection = () => {
    if (selection.length) onErase(selection);
  };

  // ── conversion ────────────────────────────────────────────────────────────
  convertRef.current = async (which) => {
    const d = dataRef.current;
    if (busy) {
      if (which === "new") autoTimer.current = window.setTimeout(() => convertRef.current("new"), AUTO_DELAY_MS);
      return;
    }
    const pen = d.strokes.filter((s) => s.tool === "pen");
    let picked: Stroke[];
    if (which === "all") picked = pen;
    else if (which === "new") {
      const used = new Set(d.blocks.flatMap((b) => b.strokeIds));
      picked = pen.filter((s) => !used.has(s.id));
    } else picked = pen.filter((s) => which.includes(s.id));
    if (!picked.length) { setNote("Nothing to convert. Write something or select it with the lasso."); return; }
    const payload = activeEnginePayload(loadEngines());
    if (!payload.length) { setError("No engine is switched on. Turn one on in Settings, Handwriting engines."); return; }
    const image = renderCrop(picked);
    if (!image) return;

    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await canvasApi.recognize(image, payload);
      const block: Block = { id: dataRef.current.nextId, latex: r.latex, engine: r.engine, ms: r.ms, warnings: r.warnings, strokeIds: picked.map((s) => s.id), at: Date.now() };
      commit({ ...dataRef.current, nextId: block.id + 1, blocks: [...dataRef.current.blocks, block] }, { history: false });
      setActiveBlock(block.id);
      setSelection([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setBusy(false);
    }
  };

  // ── result panel ──────────────────────────────────────────────────────────
  const blocks = data.blocks;
  const current = blocks.find((b) => b.id === activeBlock) ?? blocks[blocks.length - 1] ?? null;
  const rendered = useMemo(() => (current ? renderMath(current.latex.trim().replace(/^\\\[|\\\]$/g, "")) : null), [current]);

  const editBlock = (latex: string) => {
    if (!current) return;
    commit({ ...dataRef.current, blocks: dataRef.current.blocks.map((b) => (b.id === current.id ? { ...b, latex } : b)) }, { history: false });
  };
  const removeBlock = (id: number) => {
    commit({ ...dataRef.current, blocks: dataRef.current.blocks.filter((b) => b.id !== id) }, { history: false });
    setActiveBlock(null);
  };

  const texFile = () => {
    const parts = blocks.map((b) => asDisplayLatex(b.latex)).filter(Boolean);
    return `% Written by hand on the Yggdrasil Canvas page "${pageName}".\n% Needs \\usepackage{amsmath} in the main file; pull it in with \\input{${"canvas-" + pageSlug(pageName)}}.\n\n${parts.join("\n\n")}\n`;
  };
  const saveTex = async () => {
    if (!blocks.length) return;
    const filename = `canvas-${pageSlug(pageName)}.tex`;
    try {
      await api.latex.save(filename, texFile());
      setNote(`Saved ${filename} in the LaTeX files.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the .tex file");
    }
  };
  const copyTex = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.latex);
      setNote("Copied.");
    } catch {
      setError("Copy was blocked by the browser. Select the source text and copy it by hand.");
    }
  };

  // ── pages ─────────────────────────────────────────────────────────────────
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const createPage = () => {
    const n = newName.trim();
    if (!n) { setNaming(false); return; }
    if (!PAGE_NAME_RE.test(n)) { setError("That name is not allowed. Use letters, numbers, spaces, . _ - (up to 80)."); return; }
    setNaming(false);
    setNewName("");
    void switchPage(n);
  };

  const insertCurrent = () => { if (current && onInsert) onInsert(asDisplayLatex(current.latex), "block"); };
  const insertAll = () => {
    const parts = blocks.map((b) => asDisplayLatex(b.latex)).filter(Boolean);
    if (parts.length && onInsert) onInsert(parts.join("\n\n"), "all");
  };

  const pending = useMemo(() => {
    const used = new Set(data.blocks.flatMap((b) => b.strokeIds));
    return data.strokes.filter((s) => s.tool === "pen" && !used.has(s.id)).length;
  }, [data]);

  const setFinger = (on: boolean) => {
    setFingerDraws(on);
    localStorage.setItem("yggdrasil:canvas-finger", on ? "1" : "0");
  };

  const convertLabel = mode === "lasso" ? "Convert selection" : mode === "page" ? "Convert page" : "Convert now";
  const canConvert = !busy && (mode === "lasso" ? selection.length > 0 : pending > 0 || mode === "page");
  const runConvert = () => convertRef.current(mode === "lasso" ? selection : mode === "page" ? "all" : "new");

  return (
    <div className={`cv-shell${embedded ? " cv-embedded" : ""}`}>
      <div className="cv-bar">
        {embedded && title && <div className="cv-embed-title">{title}</div>}
        <div className="cv-bar-title">
          <select className="cv-input cv-page-select" value={pageName} aria-label="Page" onChange={(e) => void switchPage(e.target.value)}>
            {[...new Set([pageName, ...pageList])].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          {naming ? (
            <form className="cv-newpage" onSubmit={(e) => { e.preventDefault(); createPage(); }}>
              <input className="cv-input" autoFocus value={newName} placeholder="Page name" aria-label="New page name" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { setNaming(false); setNewName(""); } }} />
              <button type="submit" className="btn btn-primary cv-touch">Create</button>
              <button type="button" className="btn cv-touch" onClick={() => { setNaming(false); setNewName(""); }}>Cancel</button>
            </form>
          ) : (
            <button type="button" className="btn cv-touch" onClick={() => setNaming(true)}>New page</button>
          )}
          <span className={`cv-save cv-save-${saveState}`} role="status">
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved. Retrying on the next change" : "Saved"}
          </span>
        </div>
        <div className="cv-seg" role="group" aria-label="Convert mode">
          {(["lasso", "auto", "page"] as Mode[]).map((m) => (
            <button key={m} type="button" title={MODE_HINT[m]} className={`cv-seg-btn${mode === m ? " active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "lasso" ? "Lasso" : m === "auto" ? "Auto" : "Whole page"}
            </button>
          ))}
        </div>
        <button type="button" className="btn cv-touch" title="Engines are set up in Settings" onClick={() => { requestSettingsSection("handwriting"); window.dispatchEvent(new CustomEvent("ygg:open-settings")); }}>
          Engines ›
        </button>
        {onClose && <button type="button" className="btn cv-touch" onClick={onClose} aria-label="Close">Close</button>}
      </div>

      <div className="cv-body">
        <div className="cv-rail" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={`cv-tool${tool === t.id ? " active" : ""}`} aria-label={t.label} aria-pressed={tool === t.id} title={t.label} onClick={() => setTool(t.id)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{t.icon}</svg>
            </button>
          ))}
          <div className="cv-rail-sep" />
          <button type="button" className="cv-tool" aria-label="Undo" title="Undo" disabled={!undo.current.length} onClick={doUndo}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></svg>
          </button>
          <button type="button" className="cv-tool" aria-label="Redo" title="Redo" disabled={!redo.current.length} onClick={doRedo}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></svg>
          </button>
          <div className="cv-rail-sep" />
          {INK_COLORS.map((c) => (
            <button key={c.id} type="button" className={`cv-color${color === c.value ? " active" : ""}`} style={{ background: c.value }} aria-label={`Ink colour ${c.label}`} aria-pressed={color === c.value} onClick={() => setColor(c.value)} />
          ))}
          <label className="cv-width" title="Pen width">
            <span className="cv-sr">Pen width</span>
            <input type="range" min={1.5} max={7} step={0.5} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
          </label>
        </div>

        <div className="cv-page">
          <InkSurface
            strokes={data.strokes}
            selection={selection}
            tool={tool}
            color={color}
            width={width}
            scale={scale}
            fingerDraws={fingerDraws}
            scrollRef={scrollRef}
            nextId={nextId}
            onStroke={onStroke}
            onErase={onErase}
            onLasso={setSelection}
          />
          <div className="cv-float">
            {selection.length > 0 && (
              <div className="cv-selbar">
                <span className="cv-muted">{selection.length} stroke{selection.length === 1 ? "" : "s"} selected</span>
                <button type="button" className="btn btn-primary cv-touch" disabled={busy} onClick={() => convertRef.current(selection)}>Convert to LaTeX</button>
                <button type="button" className="btn cv-touch" onClick={deleteSelection}>Delete</button>
                <button type="button" className="btn cv-touch" onClick={() => setSelection([])}>Clear</button>
              </div>
            )}
          </div>
          <div className="cv-status">
            <label className="cv-chip cv-chip-check">
              <input type="checkbox" checked={fingerDraws} onChange={(e) => setFinger(e.target.checked)} />
              Finger draws (no Pencil)
            </label>
            <span className="cv-chip cv-zoom">
              <button type="button" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.3, Math.round((s - 0.1) * 10) / 10))}>−</button>
              {Math.round(scale * 100)}%
              <button type="button" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(2, Math.round((s + 0.1) * 10) / 10))}>+</button>
            </span>
          </div>
        </div>

        <aside className="cv-result" aria-label="LaTeX result">
          <div className="cv-result-head">
            <div className="cv-result-title">LaTeX result</div>
            {busy && <span className="cv-chip">Reading your writing…</span>}
          </div>

          <button type="button" className="btn btn-primary cv-touch cv-convert" disabled={!canConvert} onClick={runConvert}>
            {busy ? "Converting…" : convertLabel}
          </button>

          {error && <div className="cv-banner cv-banner-err" role="alert">{error}</div>}
          {note && !error && <div className="cv-banner" role="status">{note}</div>}

          {blocks.length > 0 && (
            <div className="cv-blocks" role="tablist" aria-label="Converted blocks">
              {blocks.map((b, i) => (
                <button key={b.id} type="button" role="tab" aria-selected={current?.id === b.id} className={`cv-block-tab${current?.id === b.id ? " active" : ""}`} onClick={() => setActiveBlock(b.id)}>
                  {i + 1}
                </button>
              ))}
            </div>
          )}

          {current ? (
            <>
              <div className="cv-preview">
                {rendered && "html" in rendered
                  ? <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
                  : <div className="cv-muted">Preview unavailable: {rendered && "error" in rendered ? rendered.error : ""}</div>}
              </div>
              <div className="cv-meta">
                {current.engine} · {(current.ms / 1000).toFixed(1)} s
              </div>
              {(current.warnings.length > 0 || (rendered && "error" in rendered)) && (
                <ul className="cv-warn">
                  {current.warnings.map((w) => <li key={w}>{w}</li>)}
                  {rendered && "error" in rendered && <li>KaTeX cannot render this. It may still compile in LaTeX.</li>}
                </ul>
              )}
              <label className="cv-field">
                <span>Source (editable)</span>
                <textarea className="cv-source" value={current.latex} onChange={(e) => editBlock(e.target.value)} spellCheck={false} autoCapitalize="off" rows={8} />
              </label>
              <div className="cv-actions">
                {onInsert && <button type="button" className="btn btn-primary cv-touch" onClick={insertCurrent}>{insertLabel}</button>}
                {onInsert && blocks.length > 1 && <button type="button" className="btn cv-touch" onClick={insertAll}>{insertAllLabel}</button>}
                {!embedded && <button type="button" className={`btn cv-touch${onInsert ? "" : " btn-primary"}`} onClick={saveTex}>Save .tex</button>}
                <button type="button" className="btn cv-touch" onClick={copyTex}>Copy</button>
                {!embedded && onOpenLatex && <button type="button" className="btn cv-touch" onClick={onOpenLatex}>Open LaTeX</button>}
                <button type="button" className="btn cv-touch" onClick={() => removeBlock(current.id)}>Discard</button>
              </div>
            </>
          ) : (
            <div className="cv-empty">
              {MODE_HINT[mode]} The result appears here as rendered maths and editable LaTeX.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
