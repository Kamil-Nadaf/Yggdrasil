export type SplitLayout = "1x2" | "2x1" | "2x2" | "1x3" | "3x1" | "2x3" | "3x2" | "1x4";
/** Rows × columns, in the order shown in the picker. */
export const SPLIT_LAYOUTS: SplitLayout[] = ["1x2", "2x1", "2x2", "1x3", "3x1", "2x3", "3x2", "1x4"];

export function layoutDims(l: SplitLayout): [rows: number, cols: number] {
  const [r, c] = l.split("x").map(Number);
  return [r, c];
}

/** Layout picker at the top of the split workspace: one button per rows × columns grid, plus "1×1" to leave split view. */
export default function SplitLayoutBar({ layout, onPick, onClose }: { layout: SplitLayout; onPick: (l: SplitLayout) => void; onClose: () => void }) {
  return (
    <div className="split-bar" role="toolbar" aria-label="Split layout">
      <span className="split-bar-title">Split view</span>
      <span className="split-bar-label">Layout</span>
      <div className="split-bar-btns">
        {SPLIT_LAYOUTS.map((l) => {
          const [r, c] = layoutDims(l);
          return (
            <button key={l} type="button" className={`split-lay${l === layout ? " on" : ""}`} aria-pressed={l === layout} aria-label={`Layout ${r} rows by ${c} columns`} title={`${r} row${r > 1 ? "s" : ""} × ${c} column${c > 1 ? "s" : ""}`} onClick={() => onPick(l)}>
              <span className="split-glyph" style={{ gridTemplateColumns: `repeat(${c}, 1fr)`, gridTemplateRows: `repeat(${r}, 1fr)` }}>
                {Array.from({ length: r * c }, (_, i) => <i key={i} />)}
              </span>
              <span className="split-lay-l">{r}×{c}</span>
            </button>
          );
        })}
        <button type="button" className="split-lay" aria-label="Single pane (close split view)" title="Close split view" onClick={onClose}>
          <span className="split-glyph" style={{ gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }}><i /></span>
          <span className="split-lay-l">1×1</span>
        </button>
      </div>
      <span className="split-bar-hint">rows × columns · up to 6 panes on this screen</span>
    </div>
  );
}
