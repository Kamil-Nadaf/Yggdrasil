import { useEffect, useState, type MouseEvent as RMouseEvent } from "react";
import { define, lookupTerm, type LookupResult } from "../lib/lookup";

type State = { kind: "loading" } | { kind: "done"; res: LookupResult };

/** Meaning of the selected word. Opened from the "Meaning" button in the selection palette, on the opposite side of the selection. */
export default function PdfDefineCard({ text, below, onClose }: { text: string; below: boolean; onClose: () => void }) {
  const term = lookupTerm(text);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pos, setPos] = useState<{ x: number; y: number; flip: boolean } | null>(null);

  useEffect(() => {
    const s = window.getSelection();
    if (!s || s.rangeCount === 0) { setPos(null); return; }
    const rects = Array.from(s.getRangeAt(0).getClientRects()).filter((r) => r.width > 1);
    if (!rects.length) { setPos(null); return; }
    const first = rects[0], last = rects[rects.length - 1];
    const x = Math.max(160, Math.min(window.innerWidth - 160, first.left + 20));
    setPos(below ? { x, y: first.top - 8, flip: true } : { x, y: last.bottom + 8, flip: false });
  }, [text, below]);

  useEffect(() => {
    if (!term) return;
    const ctl = new AbortController();
    setState({ kind: "loading" });
    const t = window.setTimeout(() => ctl.abort(), 8000);
    define(term, ctl.signal).then((res) => setState({ kind: "done", res })).catch(() => setState({ kind: "done", res: { ok: false, reason: "offline" } }));
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [term]);

  if (!term || !pos) return null;
  const def = state.kind === "done" && state.res.ok ? state.res.def : null;
  const style = { left: pos.x, top: pos.y, transform: pos.flip ? "translate(-50%, -100%)" : "translate(-50%, 0)" } as const;
  const keep = (e: RMouseEvent) => { if (!(e.target as HTMLElement).closest("input, a")) e.preventDefault(); };

  return (
    <div className="pdfv-define" style={style} onMouseDown={keep} onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={`Meaning of ${term}`}>
      <div className="pdfv-define-head">
        <strong>{def?.term ?? term}</strong>
        {def?.phonetic && <span className="muted">{def.phonetic}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="pdfv-define-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      {state.kind === "loading" && <div className="muted pdfv-define-body">Looking up…</div>}
      {state.kind === "done" && !state.res.ok && (
        <div className="muted pdfv-define-body">
          {state.res.reason === "offline" ? "Can’t reach the dictionary. Meanings need an internet connection." : "No definition found for this selection."}
        </div>
      )}
      {def && (
        <div className="pdfv-define-body">
          {def.summary && <p>{def.summary}</p>}
          {def.meanings.map((m, i) => (
            <div key={i} className="pdfv-define-m">
              {m.pos && <em>{m.pos}</em>}
              <ol>{m.defs.map((d, j) => <li key={j}>{d}</li>)}</ol>
            </div>
          ))}
          <div className="muted pdfv-define-src">
            {def.url ? <a href={def.url} target="_blank" rel="noopener noreferrer">{def.source} ↗</a> : def.source}
          </div>
        </div>
      )}
    </div>
  );
}
