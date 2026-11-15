import { setNavPrefs, useNavPrefs, type NavEdge, type NavMode } from "../lib/navPrefs";

const MODES: { id: NavMode; label: string; hint: string }[] = [
  { id: "fixed", label: "Fixed bar", hint: "Docked to an edge; the page sits beside it" },
  { id: "floating", label: "Floating dock", hint: "A compact bar floating over the page" },
  { id: "hidden", label: "Hidden", hint: "Out of the way — touch the screen edge or press Ctrl/⌘+\\" },
];
const EDGES: { id: NavEdge; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];

export default function NavSettings() {
  const p = useNavPrefs();
  const seg = (on: boolean) => `tk-seg-b${on ? " on" : ""}`;
  return (
    <div className="settings-item">
      <label>Navigation bar</label>
      <div className="navset-row">
        <span className="navset-k">Style</span>
        <div className="tk-seg" role="radiogroup" aria-label="Navigation bar style">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={p.mode === m.id} className={seg(p.mode === m.id)}
              title={m.hint} onClick={() => setNavPrefs({ mode: m.id })}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="navset-row">
        <span className="navset-k">Position</span>
        <div className="tk-seg" role="radiogroup" aria-label="Navigation bar position">
          {EDGES.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={p.edge === e.id} className={seg(p.edge === e.id)}
              onClick={() => setNavPrefs({ edge: e.id })}>{e.label}</button>
          ))}
        </div>
      </div>
      <label className="navset-check">
        <input type="checkbox" checked={p.autoHide || p.mode === "hidden"} disabled={p.mode === "hidden"}
          onChange={(e) => setNavPrefs({ autoHide: e.target.checked })} />
        Auto-hide until I move the pointer to the edge
      </label>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
        Shortcut: Ctrl/⌘+\ hides or shows the bar. Settings are remembered on this device.
      </p>
    </div>
  );
}
