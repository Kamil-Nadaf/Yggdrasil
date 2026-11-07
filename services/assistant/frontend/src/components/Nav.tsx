import { useState } from "react";
import type { ReactNode } from "react";
import type { View } from "../App";
import YggdrasilLogo from "./YggdrasilLogo";

export type NotesTab = "editor" | "collection" | "quick-notes" | "documentation" | "meeting-minutes";
export type TasksTab = "planner" | "list" | "board";
export type PapersSection = "daily" | "search";
export type CollectionSection = "all" | "books" | "papers";

const NOTES_TABS: { id: NotesTab; label: string }[] = [
  { id: "editor", label: "Editor" },
  { id: "collection", label: "Collection" },
  { id: "quick-notes", label: "Quick Notes" },
  { id: "documentation", label: "Documentation" },
  { id: "meeting-minutes", label: "Meeting Minutes" },
];

const SUBS: Partial<Record<View, { key: "notes" | "tasks" | "collection" | "papers"; items: { id: string; label: string }[] }>> = {
  editor: { key: "notes", items: NOTES_TABS },
  papers: { key: "papers", items: [{ id: "daily", label: "Daily Archive" }, { id: "search", label: "Search" }] },
  tasks: { key: "tasks", items: [{ id: "planner", label: "Planner" }, { id: "list", label: "List" }, { id: "board", label: "Board" }] },
  books: { key: "collection", items: [{ id: "all", label: "All" }, { id: "books", label: "Books" }, { id: "papers", label: "Papers" }] },
};

const svg = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

const ITEMS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "scores", label: "Dashboard", icon: svg(<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>) },
  { id: "papers", label: "Papers", icon: svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>) },
  { id: "books", label: "Collection", icon: svg(<><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2.5z" /><path d="M4 19.5A2 2 0 0 0 6 21h13" /></>) },
  { id: "editor", label: "Notes", icon: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>) },
  { id: "tasks", label: "Tasks", icon: svg(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>) },
  { id: "graph", label: "Graph", icon: svg(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7l8 1M7 8l4 8M17 10l-4 6" /></>) },
  { id: "ask", label: "Loki", icon: svg(<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />) },
  { id: "latex", label: "LaTeX", icon: svg(<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />) },
];

interface Props {
  current: View;
  onNavigate: (v: View) => void;
  subs: { notes: string; tasks: string; collection: string; papers: string };
  onSub: (key: "notes" | "tasks" | "collection" | "papers", id: string) => void;
  onSettingsOpen?: () => void;
  onPageEdit?: () => void;
  pageEditOpen?: boolean;
}

const KEY = "yg-sidebar-collapsed";

export default function Nav({ current, onNavigate, subs, onSub, onSettingsOpen, onPageEdit, pageEditOpen }: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem(KEY, c ? "0" : "1"); } catch { /* ignore */ }
      return !c;
    });
  }
  const gear = svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);

  return (
    <nav className={`app-nav side${collapsed ? " collapsed" : ""}`} aria-label="Main">
      <div className="side-top">
        <YggdrasilLogo size={28} className="nav-logo-img" />
        {!collapsed && <span className="side-name">YGGDRASIL</span>}
        <button type="button" className="side-toggle" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d={collapsed ? "M14 10l2 2-2 2" : "M16 10l-2 2 2 2"} /></>)}
        </button>
      </div>
      <div className="side-items">
        {ITEMS.map((item) => {
          const active = current === item.id;
          const sub = SUBS[item.id];
          return (
            <div key={item.id} className="side-group">
              <button
                type="button"
                className={`nav-item side-item${active ? " active" : ""}`}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
              >
                {item.icon}
                {!collapsed && <span>{item.label}</span>}
                {!collapsed && sub && <span className="side-caret" aria-hidden="true">{active ? "▾" : "▸"}</span>}
              </button>
              {sub && (active || collapsed) && (
                <div className={collapsed ? "side-fly" : "side-sub"}>
                  {collapsed && <div className="side-fly-h">{item.label}</div>}
                  {sub.items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`side-subitem${active && subs[sub.key] === t.id ? " active" : ""}`}
                      onClick={() => { onSub(sub.key, t.id); onNavigate(item.id); }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="side-bottom">
        <button type="button" className={`nav-item side-item${pageEditOpen ? " active" : ""}`} onClick={onPageEdit} title={collapsed ? "Edit page" : undefined} aria-label="Edit page">
          {svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>)}
          {!collapsed && <span>Edit page</span>}
        </button>
        <button type="button" className="nav-item side-item" onClick={onSettingsOpen} title={collapsed ? "Settings" : undefined} aria-label="Settings">
          {gear}
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </nav>
  );
}
