import { activeEnginePayload, loadEngines } from "../lib/canvasEngines";
import type { LatexDiagnostic } from "../api/client";

/** Slim status line under the LaTeX panels: compile state, problems, handwriting engine, cursor. */
export function LatexStatusBar({
  compiling,
  compiled,
  dirty,
  diagnostics,
  lineCol,
}: {
  compiling: boolean;
  compiled: boolean;
  dirty: boolean;
  diagnostics: LatexDiagnostic[];
  lineCol: string;
}) {
  const errors = diagnostics.filter((d) => d.kind === "error").length;
  const warnings = diagnostics.filter((d) => d.kind === "warning").length;
  const engine = activeEnginePayload(loadEngines())[0];
  const state = compiling ? "Compiling…" : !compiled ? "Not compiled yet" : dirty ? "Out of date. Recompile" : "Compiled";
  const tone = compiling ? "busy" : errors > 0 ? "bad" : !compiled || dirty ? "warn" : "ok";
  return (
    <div className="latex-statusline" role="status">
      <span className="lsl-item"><span className={`lsl-dot lsl-${tone}`} aria-hidden="true" />{state}</span>
      {compiled && <span className="lsl-item">{errors} error{errors === 1 ? "" : "s"} · {warnings} warning{warnings === 1 ? "" : "s"}</span>}
      <span style={{ flex: 1 }} />
      {engine && <span className="lsl-item" title="Handwriting engine (Settings)">Handwriting: {engine.label}</span>}
      <span className="lsl-item">{lineCol.replace("Line ", "Ln ").replace("Col ", "Col ")}</span>
    </div>
  );
}
