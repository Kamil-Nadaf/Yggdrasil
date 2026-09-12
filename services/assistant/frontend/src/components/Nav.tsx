import type { View } from "../App";

const ITEMS: { id: View; label: string }[] = [
  { id: "scores", label: "Dashboard" },
  { id: "search", label: "Daily ArXiv" },
  { id: "browse", label: "Search" },
  { id: "editor", label: "Notes" },
  { id: "tasks", label: "Tasks" },
  { id: "graph", label: "Graph" },
  { id: "ask", label: "Ask" },
  { id: "latex", label: "LaTeX" },
];

interface Props {
  current: View;
  onNavigate: (v: View) => void;
  onSettingsOpen?: () => void;
  onPageEdit?: () => void;
  pageEditOpen?: boolean;
}

export default function Nav({ current, onNavigate, onSettingsOpen, onPageEdit, pageEditOpen }: Props) {
  return (
    <nav className="app-nav">
      <div className="nav-brand">
        <span className="nav-logo-img" aria-hidden="true" />
        <span className="nav-logo-text">YGGDRASIL</span>
      </div>
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
        type="button"
        className={`nav-page-edit${pageEditOpen ? " active" : ""}`}
        onClick={onPageEdit}
      >
        Edit page
      </button>
      <button
        type="button"
        className="nav-settings-btn"
        onClick={onSettingsOpen}
        title="Settings"
        aria-label="Settings"
      >
        <svg className="nav-settings-gear" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
          />
        </svg>
      </button>
    </nav>
  );
}
