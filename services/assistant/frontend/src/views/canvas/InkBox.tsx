import { useRef, useState } from "react";
import InkSurface from "./InkSurface";
import { canvasApi } from "../../api/canvas";
import { activeEnginePayload, loadEngines } from "../../lib/canvasEngines";
import { renderCrop, type Stroke, type Tool } from "./ink";
import { requestSettingsSection } from "../../lib/driveSync";
import "./canvas.css";

type Kind = "formula" | "text";

interface Props {
  onPlace: (kind: Kind, value: string) => void;
  onClose: () => void;
}

/** Strip display wrappers so the result can go into a formula element or a text box. */
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

/** A square handwriting box that sits on the slide. Write, press Render, the result is placed on the slide. */
export default function InkBox({ onPlace, onClose }: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [kind, setKind] = useState<Kind>("formula");
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const render = async () => {
    const pen = strokes.filter((s) => s.tool === "pen");
    if (!pen.length) { setMsg("Write something first."); return; }
    const payload = activeEnginePayload(loadEngines());
    if (!payload.length) { setMsg("No engine is on. Turn one on in Settings, Handwriting engines."); return; }
    const image = renderCrop(pen);
    if (!image) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await canvasApi.recognize(image, payload);
      onPlace(kind, kind === "formula" ? plainLatex(r.latex) : plainText(r.latex));
      if (!keep) setStrokes([]);
      setMsg(`Placed on the slide (${r.engine}, ${(r.ms / 1000).toFixed(1)} s)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Conversion failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ib-box" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }} role="group" aria-label="Ink box">
      <div
        className="ib-head"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setPos({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        <span>Ink box</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn cv-touch" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} aria-label="Close ink box">Close</button>
      </div>
      <div className="ib-page">
        <InkSurface
          strokes={strokes}
          selection={[]}
          tool={tool}
          color="#1D2B44"
          width={5}
          scale={0.45}
          fingerDraws
          scrollRef={scrollRef}
          nextId={() => idRef.current++}
          onStroke={(s) => setStrokes((cur) => [...cur, s])}
          onErase={(ids) => setStrokes((cur) => cur.filter((s) => !ids.includes(s.id)))}
          onLasso={() => {}}
        />
      </div>
      <div className="ib-bar">
        <button type="button" className={`btn cv-touch${tool === "pen" ? " btn-primary" : ""}`} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>Pen</button>
        <button type="button" className={`btn cv-touch${tool === "eraser" ? " btn-primary" : ""}`} aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>Eraser</button>
        <button type="button" className="btn cv-touch" onClick={() => setStrokes((c) => c.slice(0, -1))} disabled={!strokes.length}>Undo</button>
        <div className="cv-seg" role="group" aria-label="Convert to">
          {(["formula", "text"] as Kind[]).map((k) => (
            <button key={k} type="button" className={`cv-seg-btn${kind === k ? " active" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "formula" ? "Formula" : "Text"}</button>
          ))}
        </div>
        <button type="button" className="btn btn-primary cv-touch" disabled={busy} onClick={() => void render()}>{busy ? "Rendering…" : "Render"}</button>
      </div>
      <div className="ib-foot">
        <label className="ib-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep ink after rendering</label>
        <button type="button" className="ib-link" onClick={() => { requestSettingsSection("handwriting"); window.dispatchEvent(new CustomEvent("ygg:open-settings")); }}>Engines ›</button>
        {msg && <span className="cv-muted" role="status">{msg}</span>}
      </div>
    </div>
  );
}
