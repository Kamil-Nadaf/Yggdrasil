import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/client";
import type { ProjectStats } from "../api/client";
import SlidesView from "./SlidesView";
import GraphView from "./GraphView";
import PdfWorkbench from "./PdfWorkbench";
import LaTeXEditor from "./LaTeXEditor";
import ActivityTimer from "../components/ActivityTimer";
import BrowserView from "./BrowserView";
import AddonCard from "../components/AddonCard";
import "./tools.css";

type Page = "hub" | "latex" | "pdf" | "slides" | "graph" | "browser";
const PAGE_KEY = "yggdrasil:tools-page";

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

interface Props {
  onOpenEditor: (citekey: string) => void;
}

/** Tools: a hub for small utilities. Slides and Graph live here; PDF → Markdown / LaTeX is the first real tool. */
export default function ToolsView({ onOpenEditor }: Props) {
  const [page, setPage] = useState<Page>(() => {
    const p = lsGet(PAGE_KEY) as Page | null;
    return p === "latex" || p === "pdf" || p === "slides" || p === "graph" || p === "browser" ? p : "hub";
  });
  const go = (p: Page) => { setPage(p); lsSet(PAGE_KEY, p); };

  if (page === "graph") {
    return (
      <div className="tl-wrap tl-wrap--full">
        <TopBar title="Graph" onBack={() => go("hub")} />
        <div className="tl-fill"><GraphView onOpenEditor={onOpenEditor} /></div>
      </div>
    );
  }
  if (page === "latex") {
    return (
      <div className="tl-wrap tl-wrap--full">
        <TopBar title="LaTeX" onBack={() => go("hub")} />
        <div className="tl-fill"><ActivityTimer category="writing" /><LaTeXEditor /></div>
      </div>
    );
  }
  if (page === "browser") {
    return (
      <div className="tl-wrap tl-wrap--full">
        <TopBar title="Browser" onBack={() => go("hub")} />
        <div className="tl-fill"><BrowserView /></div>
      </div>
    );
  }
  if (page === "slides") return <SlidesTool onBack={() => go("hub")} />;
  if (page === "pdf") {
    return (
      <div className="tl-wrap tl-wrap--full">
        <PdfWorkbench onBack={() => go("hub")} />
      </div>
    );
  }

  const cards: { id: Page; title: string; desc: string; tag: string; icon: ReactNode }[] = [
    { id: "latex", title: "LaTeX", desc: "Write and compile papers with an Overleaf-style editor and live PDF preview.", tag: "Write", icon: <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" /> },
    { id: "pdf", title: "PDF → Markdown / LaTeX", desc: "Turn papers and scans into clean Markdown or LaTeX with MinerU. Original and result side by side.", tag: "MinerU", icon: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" /> },
    { id: "slides", title: "Slides", desc: "Every deck from every project in one place. Filter by project, open, present.", tag: "Decks", icon: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></> },
    { id: "browser", title: "Browser", desc: "Search and read the web for a quick check. Also opens beside any page in split view.", tag: "Web", icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></> },
    { id: "graph", title: "Graph", desc: "The knowledge graph of your notes, papers and keywords.", tag: "Explore", icon: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8 7l8 1M7 8l4 8M17 10l-4 6" /></> },
  ];
  return (
    <div className="tl-wrap">
      <div className="tl-hero">
        <h1>Tools</h1>
        <p>Small utilities that earn their place. New ones land here.</p>
      </div>
      <div className="tl-grid">
        {cards.map((c) => (
          <button key={c.id} className="tl-card" onClick={() => go(c.id)}>
            <span className="tl-card-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{c.icon}</svg></span>
            <span className="tl-card-title">{c.title}</span>
            <span className="tl-card-desc">{c.desc}</span>
            <span className="tl-tag">{c.tag}</span>
          </button>
        ))}
        <div className="tl-card tl-card--ghost"><span className="tl-card-title">More tools soon</span><span className="tl-card-desc">Add one by registering it here.</span></div>
      </div>
      <div className="tl-section">Add-ons</div>
      <div className="tl-help">The app stays small. Heavier engines are downloaded here when you need them, and kept when the app updates.</div>
      <div className="tl-grid">
        <AddonCard id="mineru" />
      </div>
    </div>
  );
}

function TopBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="tl-bar">
      <button className="btn tl-back" onClick={onBack}>← Tools</button>
      <span className="tl-bar-title">{title}</span>
      <span className="tl-spacer" />
      {right}
    </div>
  );
}

// ── Slides across projects ───────────────────────────────────────────────────

const hueOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

type DeckRow = { project: ProjectStats; name: string; updated_at: string };

function SlidesTool({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<DeckRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectStats[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [layout, setLayout] = useState<"list" | "tile">(() => (lsGet("yggdrasil:slides-layout") === "list" ? "list" : "tile"));
  const pickLayout = (l: "list" | "tile") => { setLayout(l); lsSet("yggdrasil:slides-layout", l); };
  const [openDeck, setOpenDeck] = useState<{ slug: string; name: string } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const { projects: ps } = await api.projects.list();
      setProjects(ps);
      const all = await Promise.all(ps.map((p) => api.projects.decks(p.slug).then((r) => r.decks.map((d) => ({ project: p, name: d.name, updated_at: d.updated_at }))).catch(() => [] as DeckRow[])));
      setRows(all.flat().sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    } catch (e) { setErr(String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (openDeck) {
    return (
      <div className="tl-wrap tl-wrap--full">
        <TopBar title={`Slides · ${projects.find((p) => p.slug === openDeck.slug)?.name ?? openDeck.slug}`} onBack={() => { setOpenDeck(null); void load(); }} />
        <div className="tl-fill"><SlidesView lockedProject={openDeck.slug} initialDeck={openDeck.name} /></div>
      </div>
    );
  }
  const counts = new Map<string, number>();
  (rows ?? []).forEach((r) => counts.set(r.project.slug, (counts.get(r.project.slug) ?? 0) + 1));
  const shown = (rows ?? []).filter((r) => filter === "all" || r.project.slug === filter);
  return (
    <div className="tl-wrap">
      <TopBar title="Slides" onBack={onBack} />
      <div className="tl-chips">
        <button className={`tl-chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>All <b>{rows?.length ?? 0}</b></button>
        {projects.map((p) => (
          <button key={p.slug} className={`tl-chip${filter === p.slug ? " on" : ""}`} onClick={() => setFilter(p.slug)}>{p.name} <b>{counts.get(p.slug) ?? 0}</b></button>
        ))}
        <div className="tl-layout" role="group" aria-label="Layout">
          <button className={layout === "tile" ? "on" : ""} onClick={() => pickLayout("tile")} title="Tile view" aria-label="Tile view">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          </button>
          <button className={layout === "list" ? "on" : ""} onClick={() => pickLayout("list")} title="List view" aria-label="List view">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
        {filter !== "all" && <button className="btn" onClick={() => setOpenDeck({ slug: filter, name: "" })}>Manage {projects.find((p) => p.slug === filter)?.name}…</button>}
      </div>
      {err && <div className="tl-err">{err}</div>}
      {rows === null ? <div className="tl-empty">Loading decks…</div> : shown.length === 0 ? (
        <div className="tl-empty">No decks{filter !== "all" ? " in this project" : ""} yet. Open a project's Slides to create one.</div>
      ) : (
        layout === "tile" ? (
          <div className="tl-tiles">
            {shown.map((r) => (
              <button key={r.project.slug + "/" + r.name} className="tl-tile" onClick={() => setOpenDeck({ slug: r.project.slug, name: r.name })}>
                <span className="tl-tile-thumb" style={{ ["--h" as string]: String(hueOf(r.project.slug)) }}>
                  <span className="tl-tile-mark">{r.name.trim().charAt(0).toUpperCase() || "S"}</span>
                </span>
                <span className="tl-tile-name">{r.name}</span>
                <span className="tl-tile-meta"><span className="tl-deck-proj">{r.project.name}</span><span>{r.updated_at.replace("T", " ").slice(0, 10)}</span></span>
              </button>
            ))}
          </div>
        ) : (
          <ul className="tl-decks">
          {shown.map((r) => (
            <li key={r.project.slug + "/" + r.name}>
              <button className="tl-deck" onClick={() => setOpenDeck({ slug: r.project.slug, name: r.name })}>
                <span className="tl-deck-name">{r.name}</span>
                <span className="tl-deck-proj">{r.project.name}</span>
                <span className="tl-deck-date">{r.updated_at.replace("T", " ").slice(0, 16)}</span>
              </button>
            </li>
          ))}
          </ul>
        )
      )}
    </div>
  );
}
