import type { View } from "../App";

const ITEMS: { id: View; label: string }[] = [
  { id: "scores",  label: "Dashboard" },
  { id: "search",  label: "Daily ArXiv" },
  { id: "browse",  label: "Search" },
  { id: "triage",  label: "Triage" },
  { id: "editor",  label: "CERIC Editor" },
  { id: "graph",   label: "Graph" },
  { id: "ask",     label: "Ask" },
  { id: "latex",   label: "LaTeX" },
];

interface Props {
  current: View;
  onNavigate: (v: View) => void;
  onSettingsOpen?: () => void;
}

export default function Nav({ current, onNavigate, onSettingsOpen }: Props) {
  return (
    <nav className="app-nav">
      <div className="nav-logo">YGGDRASIL</div>
      <div className="nav-tabs">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item${current === item.id ? " active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <button
        className="nav-item nav-settings-btn"
        onClick={onSettingsOpen}
        title="Settings"
      >
        ⚙
      </button>
    </nav>
  );
}
