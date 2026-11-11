import { useEffect, useMemo, useState } from "react";
import { reading, type BookCollection, type ReadingBook } from "../../api/reading";
import BookCover from "../../components/BookCover";
import BookIcon from "../../components/BookIcons";

export type Sort = "recent" | "title" | "progress";
export type ViewMode = "grid" | "list";

export function statusLine(b: ReadingBook): string {
  if (b.status === "finished") return "Finished";
  if (b.progress > 0) return `${Math.round(b.progress * 100)}% read`;
  return b.status === "want" ? "Want to read" : "Not started";
}

export function sortBooks(list: ReadingBook[], sort: Sort): ReadingBook[] {
  return [...list].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "progress"
        ? b.progress - a.progress
        : (b.last_opened || b.added || "").localeCompare(a.last_opened || a.added || "")
  );
}

interface Props {
  books: ReadingBook[];
  collections: BookCollection[];
  mode: ViewMode;
  /** When set, tiles show a "remove from collection" action instead of the full menu's delete only. */
  onOpen: (b: ReadingBook) => void;
  onAttach: (b: ReadingBook) => void;
  onInfo: (b: ReadingBook) => void;
  onChanged: () => void;
  onCollectionsChange: (next: BookCollection[]) => void;
  emptyText?: string;
}

/** Apple-Books-style shelf: a grid of bottom-aligned covers, or a list with a Read button. */
export default function Shelf({ books, collections, mode, onOpen, onAttach, onInfo, onChanged, onCollectionsChange, emptyText }: Props) {
  const [menu, setMenu] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".ab-menu, .ab-more")) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  async function run(fn: () => Promise<unknown>) {
    setErr("");
    try { await fn(); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); }
    setMenu(null);
  }

  function toggleIn(slug: string, c: BookCollection) {
    const has = c.slugs.includes(slug);
    onCollectionsChange(collections.map((x) => (x.id === c.id ? { ...x, slugs: has ? x.slugs.filter((s) => s !== slug) : [...x.slugs, slug] } : x)));
  }

  const menuFor = (b: ReadingBook) => menu === b.slug && (
    <div className="ab-menu card" role="menu">
      <button type="button" role="menuitem" onClick={() => { setMenu(null); onInfo(b); }}>Show info &amp; cite…</button>
      <button type="button" role="menuitem" onClick={() => {
        const name = window.prompt("Rename", b.title)?.trim();
        if (name && name !== b.title) void run(() => reading.patch(b.slug, { title: name }));
        else setMenu(null);
      }}>Rename…</button>
      <button type="button" role="menuitem" onClick={() => void run(() => reading.patch(b.slug, { favorite: !b.favorite }))}>{b.favorite ? "Remove from Favorites" : "Add to Favorites"}</button>
      <div className="ab-menu-sep" role="separator" />
      {b.status !== "reading" && <button type="button" role="menuitem" onClick={() => void run(() => reading.patch(b.slug, { status: "reading" }))}>Mark as reading</button>}
      {b.status !== "want" && <button type="button" role="menuitem" onClick={() => void run(() => reading.patch(b.slug, { status: "want" }))}>Want to read</button>}
      {b.status !== "finished" && <button type="button" role="menuitem" onClick={() => void run(() => reading.patch(b.slug, { status: "finished" }))}>Mark as finished</button>}
      <button type="button" role="menuitem" onClick={() => { setMenu(null); onAttach(b); }}>{b.has_file ? "Replace file…" : "Attach file…"}</button>
      <div className="ab-menu-sep" role="separator" />
      <div className="ab-menu-label">Collections</div>
      {collections.length === 0 && <div className="ab-menu-label">None yet — use “New Collection”</div>}
      {collections.map((c) => (
        <button key={c.id} type="button" role="menuitemcheckbox" aria-checked={c.slugs.includes(b.slug)} onClick={() => toggleIn(b.slug, c)}>
          <span className="ab-check">{c.slugs.includes(b.slug) ? "✓" : ""}</span>{c.name}
        </button>
      ))}
      <div className="ab-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="ab-danger"
        onClick={() => {
          if (window.confirm(`Delete “${b.title}”, its file, highlights and section notes from your vault? This cannot be undone.`)) void run(() => reading.remove(b.slug));
        }}
      >
        Delete…
      </button>
    </div>
  );

  const items = useMemo(() => books, [books]);
  if (items.length === 0) return <div className="muted ab-empty">{emptyText || "Nothing here yet."}</div>;

  return (
    <>
      {err && <div className="bk-error" role="alert">{err}</div>}
      {mode === "grid" ? (
        <div className="ab-grid">
          {items.map((b) => {
            const isNew = !b.last_opened && b.progress === 0 && b.status !== "finished";
            return (
              <div key={b.slug} className="ab-tile">
                <button type="button" className="ab-cover-slot" onClick={() => onOpen(b)} title={b.has_file ? b.title : `${b.title} — no file attached yet`}>
                  <BookCover book={b} />
                </button>
                <div className="ab-tile-title" title={b.title}>{b.favorite ? "★ " : ""}{b.title}</div>
                <div className="ab-tile-foot">
                  {isNew ? <span className="ab-new">NEW</span> : <span className="ab-pct">{b.status === "finished" ? "Finished" : b.progress > 0 ? `${Math.round(b.progress * 100)}%` : b.kind === "paper" ? "PAPER" : "0%"}</span>}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="ab-more" aria-label={`Actions for ${b.title}`} aria-haspopup="menu" aria-expanded={menu === b.slug} onClick={() => setMenu(menu === b.slug ? null : b.slug)}>•••</button>
                </div>
                {menuFor(b)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ab-list">
          {items.map((b) => (
            <div key={b.slug} className="ab-row">
              <button type="button" className="ab-row-cover" onClick={() => onOpen(b)} aria-label={`Open ${b.title}`}>
                <BookCover book={b} />
              </button>
              <div className="ab-row-body">
                <button type="button" className="ab-row-title" onClick={() => onOpen(b)}>{b.title}</button>
                <div className="muted">{b.authors.join(", ") || "Unknown Author"}{b.year ? ` · ${b.year}` : ""}{b.venue ? ` · ${b.venue}` : ""}</div>
                <div className="muted ab-row-meta">
                  <span className="ab-tag">{b.kind === "paper" ? "PAPER" : b.format === "none" ? "BOOK" : b.format.toUpperCase()}</span>
                  {b.tags.slice(0, 4).map((t) => <span key={t} className="ab-tag">{t}</span>)}
                  {statusLine(b)}
                  {b.format === "pdf" && b.total_pages ? ` · ${b.total_pages} pages` : ""}
                  {b.highlights ? ` · ${b.highlights} highlights` : ""}
                </div>
                {b.progress > 0 && b.status !== "finished" && <div className="bk-bar ab-row-bar"><span style={{ width: `${Math.round(b.progress * 100)}%` }} /></div>}
              </div>
              <div className="ab-row-actions">
                <button type="button" className="btn" onClick={() => onInfo(b)}>Info</button>
                <button type="button" className="btn ab-read" onClick={() => onOpen(b)}>{b.progress > 0 && b.status !== "finished" ? "Continue" : "Read"}</button>
                <button type="button" className="ab-more" aria-label={`Actions for ${b.title}`} aria-haspopup="menu" aria-expanded={menu === b.slug} onClick={() => setMenu(menu === b.slug ? null : b.slug)}>•••</button>
                {menuFor(b)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="ab-toggle" role="group" aria-label="Layout">
      <button type="button" className={mode === "grid" ? "on" : ""} aria-pressed={mode === "grid"} onClick={() => onChange("grid")} title="Grid"><BookIcon name="grid" size={16} /></button>
      <button type="button" className={mode === "list" ? "on" : ""} aria-pressed={mode === "list"} onClick={() => onChange("list")} title="List"><BookIcon name="rows" size={16} /></button>
    </div>
  );
}
