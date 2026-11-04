import { useCallback, useEffect, useMemo, useState } from "react";
import { reading, type BookCollection, type CiteStyle, type ReadingBook, type ReadingGoal, type SavedSearch } from "../api/reading";
import BookIcon, { type BookIconName } from "../components/BookIcons";
import Goals from "./books/Goals";
import Home from "./books/Home";
import ImportDialog from "./books/ImportDialog";
import BookReader from "./books/BookReader";
import AddReference from "./books/AddReference";
import ZoteroImport from "./books/ZoteroImport";
import AnnotationSync from "./books/AnnotationSync";
import ItemInfo from "./books/ItemInfo";
import Shelf, { sortBooks, ViewToggle, type Sort, type ViewMode } from "./books/Shelf";
import "./books/books.css";

type Section = "home" | "goals" | "all" | "papers" | "books" | "fav" | "reading" | "want" | "finished" | "unfiled" | "dupes" | `col:${string}` | `tag:${string}`;

const LIBRARY: { id: Section; label: string; icon: BookIconName; title: string; list?: boolean }[] = [
  { id: "all", label: "All items", icon: "all", title: "All items" },
  { id: "papers", label: "Papers", icon: "pdf", title: "Papers", list: true },
  { id: "books", label: "Books", icon: "epub", title: "Books" },
  { id: "fav", label: "Favorites", icon: "star", title: "Favorites" },
  { id: "reading", label: "Reading", icon: "reading", title: "Reading", list: true },
  { id: "want", label: "Want to Read", icon: "want", title: "Want to Read", list: true },
  { id: "finished", label: "Finished", icon: "finished", title: "Finished", list: true },
  { id: "unfiled", label: "Unfiled", icon: "inbox", title: "Unfiled — not in any collection" },
];

function norm(t: string): string { return t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, ""); }
/** Search syntax: free words, "quoted phrases", tag:x, type:paper|book|article…, year:2020 or year:2018-2022, author:name, status:reading, is:fav, has:pdf. */
function matches(b: ReadingBook, needle: string): boolean {
  const hay = [b.title, b.authors.join(" "), b.venue, b.doi, b.arxiv, b.tags.join(" "), b.year ? String(b.year) : "", b.abstract, b.citekey, b.notes].join(" ").toLowerCase();
  const re = /(\w+):"([^"]+)"|(\w+):(\S+)|"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(needle)) !== null) {
    const key = (m[1] || m[3] || "").toLowerCase();
    const val = (m[2] || m[4] || "").toLowerCase();
    if (!key) {
      if (!hay.includes((m[5] || m[6] || "").toLowerCase())) return false;
    } else if (key === "tag") {
      if (!b.tags.some((t) => t.toLowerCase().includes(val))) return false;
    } else if (key === "type") {
      if (b.kind !== val && b.item_type !== val) return false;
    } else if (key === "author") {
      if (!b.authors.join(" ").toLowerCase().includes(val)) return false;
    } else if (key === "status") {
      if (b.status !== val) return false;
    } else if (key === "year") {
      const [lo, hi] = val.includes("-") ? val.split("-").map(Number) : [Number(val), Number(val)];
      if (!b.year || b.year < lo || b.year > (hi || lo)) return false;
    } else if (key === "is") {
      if (val === "fav" && !b.favorite) return false;
    } else if (key === "has") {
      if ((val === "pdf" || val === "file") && !b.has_file) return false;
      if (val === "notes" && !b.notes) return false;
    } else if (!hay.includes(`${key}:${val}`)) {
      return false;
    }
  }
  return true;
}

/** Books, laid out like Apple Books: a sidebar (Home, Library, Collections) and a shelf of covers. */
export default function BooksView() {
  const [section, setSection] = useState<Section>("home");
  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [collections, setCollections] = useState<BookCollection[]>([]);
  const [goal, setGoal] = useState<ReadingGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [attachTo, setAttachTo] = useState<ReadingBook | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [modes, setModes] = useState<Partial<Record<string, ViewMode>>>({});
  const [newCol, setNewCol] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addRef, setAddRef] = useState(false);
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [newParent, setNewParent] = useState<string | undefined>(undefined);
  const [infoSlug, setInfoSlug] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [lib, cols, g, ss] = await Promise.all([reading.library(), reading.collections(), reading.goal(), reading.searches().catch(() => ({ searches: [] as SavedSearch[] }))]);
      setBooks(lib.books);
      setCollections(cols.collections);
      setSearches(ss.searches);
      setGoal(g);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your books");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function saveCollections(next: BookCollection[]) {
    const prev = collections;
    setCollections(next);
    try { await reading.saveCollections(next); } catch (e) { setCollections(prev); setError(e instanceof Error ? e.message : "Could not save collections"); }
  }
  async function setGoalMinutes(minutes: number) {
    try { await reading.setGoal(minutes); setGoal(await reading.goal()); } catch (e) { setError(e instanceof Error ? e.message : "Could not save the goal"); }
  }

  const col = section.startsWith("col:") ? collections.find((c) => c.id === section.slice(4)) || null : null;
  const searching = q.trim().length > 0;
  const meta = LIBRARY.find((l) => l.id === section);
  const colIds = useMemo(() => new Set(collections.map((c) => c.id)), [collections]);
  const colTree = useMemo(() => {
    const out: { c: BookCollection; depth: number }[] = [];
    const walk = (parent: string | undefined, depth: number) => {
      collections
        .filter((c) => (parent === undefined ? !c.parent || !colIds.has(c.parent) : c.parent === parent))
        .forEach((c) => { out.push({ c, depth }); if (depth < 8) walk(c.id, depth + 1); });
    };
    walk(undefined, 0);
    return out;
  }, [collections, colIds]);
  const tagName = section.startsWith("tag:") ? section.slice(4) : "";
  const inAnyCollection = useMemo(() => new Set(collections.flatMap((c) => c.slugs)), [collections]);
  const dupes = useMemo(() => {
    const groups = new Map<string, ReadingBook[]>();
    const add = (k: string, b: ReadingBook) => groups.set(k, [...(groups.get(k) || []), b]);
    for (const b of books) {
      if (b.doi) add(`d:${b.doi.toLowerCase()}`, b);
      if (b.arxiv) add(`a:${b.arxiv.toLowerCase().replace(/v\d+$/, "")}`, b);
      if (norm(b.title).length > 12) add(`t:${norm(b.title)}`, b);
    }
    const out = new Map<string, ReadingBook>();
    for (const g of groups.values()) if (new Set(g.map((x) => x.slug)).size > 1) g.forEach((b) => out.set(b.slug, b));
    return [...out.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [books]);
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    books.forEach((b) => b.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [books]);
  const title = searching ? "Search" : section === "home" ? "Home" : section === "goals" ? "Reading goals" : col ? col.name : tagName ? `Tag: ${tagName}` : section === "dupes" ? "Possible duplicates" : meta?.title || "All items";
  const mode: ViewMode = modes[searching ? "search" : section] || (searching ? "grid" : meta?.list ? "list" : "grid");

  const shown = useMemo(() => {
    let list = books;
    if (searching) {
      const needle = q.trim().toLowerCase();
      list = books.filter((b) => matches(b, needle));
    } else if (col) {
      list = col.slugs.map((s) => books.find((b) => b.slug === s)).filter((b): b is ReadingBook => !!b);
    } else if (section === "reading" || section === "want" || section === "finished") {
      list = books.filter((b) => b.status === section);
    } else if (section === "papers" || section === "books") {
      list = books.filter((b) => b.kind === (section === "papers" ? "paper" : "book"));
    } else if (section === "fav") {
      list = books.filter((b) => b.favorite);
    } else if (section === "unfiled") {
      list = books.filter((b) => !inAnyCollection.has(b.slug));
    } else if (tagName) {
      list = books.filter((b) => b.tags.includes(tagName));
    } else if (section === "dupes") {
      return dupes;
    }
    return sortBooks(list, sort);
  }, [books, q, searching, col, section, sort, inAnyCollection, tagName, dupes]);

  const opened = openSlug ? books.find((b) => b.slug === openSlug) || null : null;
  if (opened) {
    return (
      <div className="books-view books-view--reader">
        <BookReader key={opened.slug} book={opened} onBack={() => { setOpenSlug(null); void refresh(); }} onChanged={() => void refresh()} />
      </div>
    );
  }

  const go = (s: Section) => { setSection(s); setQ(""); setAdding(false); setRenaming(null); };
  const open = (b: ReadingBook) => { if (b.has_file) setOpenSlug(b.slug); else setInfoSlug(b.slug); };
  const info = infoSlug ? books.find((b) => b.slug === infoSlug) || null : null;
  const candidates = col ? books.filter((b) => !col.slugs.includes(b.slug)) : [];
  const count = (s: Section) =>
    s === "all" ? books.length : s === "reading" || s === "want" || s === "finished" ? books.filter((b) => b.status === s).length : s === "papers" ? books.filter((b) => b.kind === "paper").length : s === "books" ? books.filter((b) => b.kind === "book").length : s === "fav" ? books.filter((b) => b.favorite).length : s === "unfiled" ? books.filter((b) => !inAnyCollection.has(b.slug)).length : 0;

  function createCollection() {
    const n = (newCol || "").trim();
    setNewCol(null);
    if (!n) return;
    const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    void saveCollections([...collections, { id, name: n, slugs: [], ...(newParent ? { parent: newParent } : {}) }]);
    setNewParent(undefined);
    setSection(`col:${id}`);
  }

  const showShelf = searching || section !== "home" && section !== "goals";

  return (
    <div className={`books-view ab-shell${info ? " has-info" : ""}`}>
      <aside className="ab-side" aria-label="Collection navigation">
        <label className="ab-search">
          <BookIcon name="search" size={17} />
          <input type="search" placeholder="Search — try tag:grb type:paper year:2020-2024" aria-label="Search your collection" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <nav className="ab-nav">
          <button type="button" className={`ab-item${!searching && section === "home" ? " on" : ""}`} onClick={() => go("home")}><BookIcon name="home" /><span>Home</span></button>
          <button type="button" className={`ab-item${!searching && section === "goals" ? " on" : ""}`} onClick={() => go("goals")}><BookIcon name="goals" /><span>Reading goals</span></button>
        </nav>
        <div className="ab-sidehead">Library</div>
        <nav className="ab-nav">
          {LIBRARY.map((l) => (
            <button key={l.id} type="button" className={`ab-item${!searching && section === l.id ? " on" : ""}`} onClick={() => go(l.id)}>
              <BookIcon name={l.icon} /><span>{l.label}</span><em>{count(l.id) || ""}</em>
            </button>
          ))}
        </nav>
        {dupes.length > 0 && (
          <nav className="ab-nav">
            <button type="button" className={`ab-item${!searching && section === "dupes" ? " on" : ""}`} onClick={() => go("dupes")}><BookIcon name="dupes" /><span>Duplicates</span><em>{dupes.length}</em></button>
          </nav>
        )}
        <div className="ab-sidehead">My Collections</div>
        <nav className="ab-nav">
          {colTree.map(({ c, depth }) => (
            <button key={c.id} type="button" className={`ab-item${!searching && section === `col:${c.id}` ? " on" : ""}`} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => go(`col:${c.id}`)}>
              <BookIcon name={depth ? "rows" : "list"} size={depth ? 15 : 20} /><span>{c.name}</span><em>{c.slugs.length || ""}</em>
            </button>
          ))}
          {newCol === null ? (
            <button type="button" className="ab-item" onClick={() => { setNewParent(undefined); setNewCol(""); }}><BookIcon name="plus" /><span>New Collection</span></button>
          ) : (
            <form className="ab-newcol" onSubmit={(e) => { e.preventDefault(); createCollection(); }}>
              <input autoFocus value={newCol} maxLength={80} placeholder={newParent ? `Sub-collection of ${collections.find((c) => c.id === newParent)?.name || "…"}` : "Collection name"} aria-label="New collection name" onChange={(e) => setNewCol(e.target.value)} onBlur={createCollection} onKeyDown={(e) => { if (e.key === "Escape") { setNewCol(null); setNewParent(undefined); } }} />
            </form>
          )}
        </nav>
        {searches.length > 0 && (
          <>
            <div className="ab-sidehead">Saved searches</div>
            <nav className="ab-nav">
              {searches.map((s) => (
                <button key={s.id} type="button" className={`ab-item${searching && q.trim() === s.q ? " on" : ""}`} title={s.q} onClick={() => setQ(s.q)}>
                  <BookIcon name="search" size={16} /><span>{s.name}</span>
                  <span role="button" tabIndex={0} className="ab-tree-x" aria-label={`Delete saved search ${s.name}`} onClick={(e) => { e.stopPropagation(); const next = searches.filter((x) => x.id !== s.id); setSearches(next); void reading.saveSearches(next).catch(() => {}); }}>×</span>
                </button>
              ))}
            </nav>
          </>
        )}
        {tags.length > 0 && (
          <>
            <div className="ab-sidehead">Tags</div>
            <nav className="ab-nav">
              {tags.slice(0, 40).map(([t, n]) => (
                <button key={t} type="button" className={`ab-item${!searching && section === `tag:${t}` ? " on" : ""}`} onClick={() => go(`tag:${t}`)}><BookIcon name="tag" size={16} /><span>{t}</span><em>{n}</em></button>
              ))}
            </nav>
          </>
        )}
        <div className="ab-sidehead">Tools</div>
        <nav className="ab-nav">
          <button type="button" className="ab-item" onClick={() => setZoteroOpen(true)}><BookIcon name="plus" size={16} /><span>Import from Zotero…</span></button>
          <button type="button" className="ab-item" onClick={() => setSyncOpen(true)} title="Two-way sync of highlights, underlines, notes and drawings with Zotero"><BookIcon name="sync" size={16} /><span>Sync with Zotero</span></button>
        </nav>
      </aside>

      <main className="ab-main">
        <header className="ab-head">
          {col && renaming !== null ? (
            <form className="bk-inline" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) void saveCollections(collections.map((c) => (c.id === col.id ? { ...c, name: renaming.trim() } : c))); setRenaming(null); }}>
              <input className="ab-title-input" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={80} aria-label="Collection name" />
              <button type="submit" className="btn btn-primary">Save</button>
              <button type="button" className="btn" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : (
            <h1 className="ab-title">{title}</h1>
          )}
          <span style={{ flex: 1 }} />
          {showShelf && (
            <>
              <label className="ab-sort"><span className="muted">Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="recent">Recent</option>
                  <option value="title">Title</option>
                  <option value="progress">Progress</option>
                </select>
              </label>
              <ViewToggle mode={mode} onChange={(m) => setModes((s) => ({ ...s, [searching ? "search" : section]: m }))} />
            </>
          )}
          {col && !searching && (
            <>
              <button type="button" className={`btn${adding ? " btn-primary" : ""}`} onClick={() => setAdding((v) => !v)}>Add items</button>
              <button type="button" className="btn" onClick={() => { setNewParent(col.id); setNewCol(""); }}>+ Sub-collection</button>
              <button type="button" className="btn" onClick={() => setRenaming(col.name)}>Rename</button>
              <button type="button" className="btn btn-crit" onClick={() => { if (window.confirm(`Delete the collection “${col.name}”? The items stay in your library.`)) { void saveCollections(collections.filter((c) => c.id !== col.id).map((c) => (c.parent === col.id ? { ...c, parent: col.parent } : c))); go("all"); } }}>Delete</button>
            </>
          )}
          {searching && shown.length >= 0 && !searches.some((s) => s.q === q.trim()) && (
            <button type="button" className="btn" title="Save this search in the sidebar" onClick={() => {
              const name = window.prompt("Name this saved search", q.trim().slice(0, 40));
              if (!name || !name.trim()) return;
              const next = [...searches, { id: `s_${Date.now().toString(36)}`, name: name.trim(), q: q.trim() }];
              setSearches(next);
              void reading.saveSearches(next).then((r) => setSearches(r.searches)).catch(() => {});
            }}>Save search</button>
          )}
          {showShelf && shown.length > 0 && (
            <select className="ab-export" value="" aria-label="Export citations" title="Export the references shown here" onChange={(e) => {
              const f = e.target.value as CiteStyle;
              if (!f) return;
              const opts = col ? { collection: col.id } : shown.length === books.length || shown.length > 80 ? {} : { slugs: shown.map((b) => b.slug) };
              window.location.href = reading.exportUrl(f, opts);
            }}>
              <option value="">Export…</option>
              <option value="bibtex">BibTeX (.bib)</option>
              <option value="ris">RIS</option>
              <option value="csljson">CSL-JSON</option>
              <option value="apa">APA 7 list</option>
              <option value="ieee">IEEE list</option>
              <option value="harvard">Harvard list</option>
              <option value="chicago">Chicago list</option>
              <option value="mla">MLA list</option>
            </select>
          )}
          <button type="button" className="btn" onClick={() => setImporting(true)}>Import file</button>
          <button type="button" className="btn btn-primary" onClick={() => setAddRef(true)}>+ Add reference</button>
        </header>
        {notice && <div className="bk-notice" role="status">{notice} <button type="button" className="ab-link" onClick={() => setNotice("")}>dismiss</button></div>}

        {error && section !== "goals" && <div className="bk-error" role="alert">{error}</div>}

        {col && adding && !searching && (
          <div className="ab-picker card">
            {candidates.length === 0 ? <span className="muted">Every item is already in this collection.</span> : candidates.map((b) => (
              <button key={b.slug} type="button" className="ab-picker-row" onClick={() => void saveCollections(collections.map((c) => (c.id === col.id ? { ...c, slugs: [...c.slugs, b.slug] } : c)))}>
                <span className="ab-picker-plus">+</span><span>{b.title}</span><span className="muted">{b.authors[0] || ""}</span>
              </button>
            ))}
          </div>
        )}

        <div className="ab-content">
          {!searching && section === "home" && <Home books={books} goal={goal} onOpen={open} onGoals={() => go("goals")} onImport={() => setImporting(true)} />}
          {!searching && section === "goals" && <Goals goal={goal} error={error} onSetGoal={(m) => void setGoalMinutes(m)} onContinue={(slug) => { const b = books.find((x) => x.slug === slug); if (b) open(b); }} />}
          {showShelf && (loading && books.length === 0 ? <div className="muted">Loading…</div> : (
            <Shelf
              books={shown}
              collections={collections}
              mode={mode}
              onOpen={open}
              onAttach={(b) => setAttachTo(b)}
              onInfo={(b) => setInfoSlug(b.slug)}
              onChanged={() => void refresh()}
              onCollectionsChange={(c) => void saveCollections(c)}
              emptyText={searching ? "Nothing matches your search." : col ? "This collection is empty. Use “Add items”." : section === "all" ? "Your collection is empty. Add a reference, import a book, or use “+ Collection” on a paper in Papers." : section === "dupes" ? "No duplicates found." : "Nothing here yet."}
            />
          ))}
        </div>
      </main>

      {info && (
        <ItemInfo
          book={info}
          collections={collections}
          onClose={() => setInfoSlug(null)}
          onOpen={(b) => { setInfoSlug(null); setOpenSlug(b.slug); }}
          onAttach={(b) => setAttachTo(b)}
          onChanged={() => void refresh()}
          onCollectionsChange={(c) => void saveCollections(c)}
          all={books}
          dupes={dupes.filter((x) => x.slug !== info.slug && (!!info.doi && x.doi.toLowerCase() === info.doi.toLowerCase() || !!info.arxiv && x.arxiv.toLowerCase() === info.arxiv.toLowerCase() || norm(x.title) === norm(info.title)))}
          onSelect={(s) => setInfoSlug(s)}
        />
      )}

      {syncOpen && <AnnotationSync onClose={() => setSyncOpen(false)} />}
      {zoteroOpen && <ZoteroImport onClose={() => setZoteroOpen(false)} onDone={() => void refresh()} />}

      {addRef && (
        <AddReference
          collectionId={col?.id}
          onClose={() => setAddRef(false)}
          onAdded={(b, msg) => { setAddRef(false); setNotice(msg); void refresh(); if (b) setInfoSlug(b.slug); }}
        />
      )}

      {(importing || attachTo) && (
        <ImportDialog
          attachTo={attachTo}
          onClose={() => { setImporting(false); setAttachTo(null); }}
          onImported={() => { setImporting(false); setAttachTo(null); void refresh(); }}
        />
      )}
    </div>
  );
}
