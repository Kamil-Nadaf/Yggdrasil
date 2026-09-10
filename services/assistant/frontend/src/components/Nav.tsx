import type { View } from "../App";

const ITEMS: { id: View; label: string }[] = [
  { id: "triage",  label: "Triage" },
  { id: "editor",  label: "CERIC Editor" },
  { id: "graph",   label: "Graph" },
  { id: "ask",     label: "Ask" },
  { id: "scores",  label: "Scores" },
];

interface Props {
  current: View;
  onNavigate: (v: View) => void;
}

export default function Nav({ current, onNavigate }: Props) {
  return (
    <nav className="app-nav">
      <div className="nav-logo">YGGDRASIL</div>
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={`nav-item${current === item.id ? " active" : ""}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
