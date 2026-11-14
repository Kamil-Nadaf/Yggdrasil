import type { View } from "../App";
import { ITEMS, SUBS } from "./Nav";

interface Props {
  view: View;
  /** Pane number shown at the right of the header. */
  n: number;
  maximized?: boolean;
  onMax?: () => void;
  sub?: string;
  onSub: (key: "notes" | "tasks" | "collection" | "papers", id: string) => void;
  onView: (v: View) => void;
  onSwap?: () => void;
  onClose?: () => void;
}

/** Slim header on top of each split-view pane: pick the section, its subsection, swap sides or close. */
export default function PaneHeader({ view, n, maximized, onMax, sub, onSub, onView, onSwap, onClose }: Props) {
  const subs = SUBS[view];
  return (
    <div className="pane-head">
      <select className="pane-select" value={view} onChange={(e) => onView(e.target.value as View)} aria-label="Section in this pane">
        {[...ITEMS.map((i) => ({ id: i.id, label: i.label })), { id: "settings" as View, label: "Settings" }]
          .map((i) => (
            <option key={i.id} value={i.id}>{i.label}</option>
          ))}
      </select>
      {subs && (
        <div className="pane-subs">
          {subs.items.map((t) => (
            <button key={t.id} type="button" className={`pane-sub${sub === t.id ? " active" : ""}`} onClick={() => onSub(subs.key, t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <span className="pane-spacer" />
      <span className="pane-num">pane {n}</span>
      {onSwap && <button type="button" className="pane-btn" onClick={onSwap} title="Swap left and right" aria-label="Swap panes">⇄</button>}
      {onMax && <button type="button" className="pane-btn" onClick={onMax} title={maximized ? "Back to the grid" : "Maximize this pane"} aria-label={maximized ? "Restore pane" : "Maximize pane"}>{maximized ? "❐" : "⛶"}</button>}
      {onClose && <button type="button" className="pane-btn" onClick={onClose} title="Close this pane" aria-label="Close pane">×</button>}
    </div>
  );
}
