import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canvasApi } from "../../api/canvas";
import { activeEnginePayload, loadEngines } from "../../lib/canvasEngines";
import { boundsOf, drawStroke, renderCrop, type Stroke } from "./ink";
import { requestSettingsSection } from "../../lib/driveSync";
import "./canvas.css";

type Kind = "formula" | "text";
export interface PlaceRect { x: number; y: number; w: number; h: number }

interface Props {
  /** `rect` is the written area in px relative to this overlay, which sits exactly over the slide editor. */
  onPlace: (kind: Kind, value: string, rect: PlaceRect) => void;
  onClose: () => void;
  /** Where the controls go: the Slides top bar. */
  slot: HTMLElement | null;
}

const INK = "#1D2B44";
const PAUSE_MS = 1400;

function plainLatex(src: string): string {
  return src
    .trim()
    .replace(/^\\\[\s*|\s*\\\]$/g, "")
    .replace(/^\\begin\{(align|equation|gather)\*?\}\s*|\s*\\end\{(align|equation|gather)\*?\}$/g, "")
    .trim();
}
function plainText(src: string): string {
  return plainLatex(src)
    .replace(/\\text(?:bf|it|rm)?\{([^{}]*)\}/g, "$1")
    .replace(/\\\\\s*/g, "\n")
    .replace(/\s*&\s*/g, " ")
    .trim();
}

/** Transparent writing layer over the slide editor. Write anywhere on the slide; on Render (or after a pause)
 *  the writing is recognised and placed on the slide where you wrote it. */
export default function SlideInk({ onPlace, onClose, slot }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const live = useRef<Stroke | null>(null);
  const erasing = useRef(false);
  const idRef = useRef(1);
  const timer = useRef(0);
  const [, bump] = useState(0);
  const [eraser, setEraser] = useState(false);
  const [kind, setKind] = useState<Kind>("formula");
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const kindRef = useRef(kind); kindRef.current = kind;
  const busyRef = useRef(busy); busyRef.current = busy;

  const redraw = useCallback(() => {
    const c = cv.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    const W = w.clientWidth, H = w.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const s of strokes.current) drawStroke(ctx, s, 1);
    if (live.current) drawStroke(ctx, live.current, 1);
  }, []);

  useEffect(() => {
    redraw();
    const ro = new ResizeObserver(redraw);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [redraw]);

  const render = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (busyRef.current) return;
    const pen = strokes.current.filter((s) => s.tool === "pen");
    if (!pen.length) return;
    const payload = activeEnginePayload(loadEngines());
    if (!payload.length) { setMsg("No engine is on. Turn one on in Settings, Handwriting engines."); return; }
    const image = renderCrop(pen);
    const b = boundsOf(pen);
    if (!image || !b) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await canvasApi.recognize(image, payload);
      const k = kindRef.current;
      const value = k === "formula" ? plainLatex(r.latex) : plainText(r.latex);
      if (!value) { setMsg("Nothing was recognised."); return; }
      onPlace(k, value, { x: b.x, y: b.y, w: b.w, h: b.h });
      strokes.current = [];
      redraw();
      setMsg(`Placed (${r.engine}, ${(r.ms / 1000).toFixed(1)} s)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setBusy(false);
      bump((n) => n + 1);
    }
  }, [onPlace, redraw]);

  const arm = () => {
    window.clearTimeout(timer.current);
    if (auto) timer.current = window.setTimeout(() => void render(), PAUSE_MS);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const pt = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure > 0 ? e.pressure : 0.5 };
  };
  const eraseAt = (x: number, y: number) => {
    const keep = strokes.current.filter((s) => {
      for (let i = 0; i < s.pts.length; i += 3) if (Math.hypot(s.pts[i] - x, s.pts[i + 1] - y) < 12) return false;
      return true;
    });
    if (keep.length !== strokes.current.length) { strokes.current = keep; redraw(); }
  };

  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    window.clearTimeout(timer.current);
    const q = pt(e);
    if (eraser) { erasing.current = true; eraseAt(q.x, q.y); return; }
    live.current = { id: idRef.current++, tool: "pen", color: INK, w: 3, pts: [q.x, q.y, q.p] };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    const q = pt(e);
    if (erasing.current) { eraseAt(q.x, q.y); return; }
    const l = live.current;
    if (!l) return;
    l.pts.push(q.x, q.y, q.p);
    redraw();
  };
  const up = () => {
    if (erasing.current) { erasing.current = false; arm(); return; }
    const l = live.current;
    if (l) { strokes.current = [...strokes.current, l]; live.current = null; redraw(); bump((n) => n + 1); arm(); }
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const count = strokes.current.length;
  return (
    <div ref={wrap} className="si-layer" role="group" aria-label="Write on the slide">
      <canvas ref={cv} className="si-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {slot && createPortal(<div className="si-tools" role="toolbar" aria-label="Write on slide">      
        <button type="button" className={`btn cv-touch${!eraser ? " btn-primary" : ""}`} aria-pressed={!eraser} onClick={() => setEraser(false)}>Pen</button>
        <button type="button" className={`btn cv-touch${eraser ? " btn-primary" : ""}`} aria-pressed={eraser} onClick={() => setEraser(true)}>Eraser</button>
        <button type="button" className="btn cv-touch" disabled={!count} onClick={() => { strokes.current = strokes.current.slice(0, -1); redraw(); bump((n) => n + 1); }}>Undo</button>
        <div className="cv-seg" role="group" aria-label="Convert to">
          {(["formula", "text"] as Kind[]).map((k) => (
            <button key={k} type="button" className={`cv-seg-btn${kind === k ? " active" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "formula" ? "Formula" : "Text"}</button>
          ))}
        </div>
        <label className="si-auto" title="Convert on its own when you stop writing"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto</label>
        <button type="button" className="btn btn-primary cv-touch" disabled={busy || !count} onClick={() => void render()}>{busy ? "Rendering…" : "Render"}</button>
        <button type="button" className="btn cv-touch" onClick={onClose}>Done</button>
        <button type="button" className="ib-link" onClick={() => { requestSettingsSection("handwriting"); window.dispatchEvent(new CustomEvent("ygg:open-settings")); }}>Engines ›</button>
        {msg && <span className="si-msg" role="status">{msg}</span>}
      
</div>, slot)}
    </div>
  );
}
