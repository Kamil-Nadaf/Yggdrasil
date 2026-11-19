import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePdfOpener } from "../components/PdfViewer";
import AddToCollection from "../components/AddToCollection";
import ConvertButton from "../components/ConvertButton";
import ZoteroCollectionSelect, { getZoteroCollection } from "../components/ZoteroCollectionSelect";
import { api, type ArxivPaper, type ArxivSearchField } from "../api/client";
import { SlotIndicator, CericSelectionToolbar, useCericAppend } from "../components/CericToolbar";
import AbstractText from "../components/AbstractText";

interface ToastMsg { text: string; ok: boolean }

const PAGE_SIZE = 50;

const CATEGORY_KEY = "yggdrasil:search-category";
const HISTORY_KEY = "yggdrasil:search-history";
const HISTORY_MAX = 25;

interface HistoryItem { q: string; field: ArxivSearchField; category: string }
function loadHistory(): HistoryItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((h) => h && typeof h.q === "string").slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}
function saveHistory(list: HistoryItem[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch { /* optional */ }
}

/** The search view moves in the tree when the PDF reader opens beside it, which remounts it. Keeping the last
 *  search at module level means the results (and where you were scrolled) are still there when you come back. */
interface SavedSearch { query: string; field: ArxivSearchField; results: ArxivPaper[]; total: number; searched: boolean; expandedIds: Set<string>; expandedAuthors: Set<string>; scroll: number }
let saved: Partial<SavedSearch> = {};

/** arXiv category presets for the fast, focused search. "" = every source (slower, widest coverage). */
const SEARCH_CATEGORIES: { group: string; items: { value: string; label: string }[] }[] = [
  { group: "Everything", items: [{ value: "", label: "All fields (all sources — slower)" }] },
  {
    group: "Astrophysics",
    items: [
      { value: "astro-ph", label: "All astrophysics" },
      { value: "astro-ph.HE", label: "High Energy Astrophysics" },
      { value: "astro-ph.CO", label: "Cosmology & Nongalactic" },
      { value: "astro-ph.GA", label: "Astrophysics of Galaxies" },
      { value: "astro-ph.SR", label: "Solar & Stellar" },
      { value: "astro-ph.EP", label: "Earth & Planetary" },
      { value: "astro-ph.IM", label: "Instrumentation & Methods" },
      { value: "astro-ph.HE,astro-ph.CO,astro-ph.GA", label: "HE + Cosmology + Galaxies" },
    ],
  },
  {
    group: "Gravity & High-Energy Physics",
    items: [
      { value: "gr-qc", label: "General Relativity & Quantum Cosmology" },
      { value: "hep-ph", label: "HEP — Phenomenology" },
      { value: "hep-th", label: "HEP — Theory" },
      { value: "hep-ex", label: "HEP — Experiment" },
      { value: "nucl-th,nucl-ex", label: "Nuclear" },
    ],
  },
  {
    group: "Other physics, maths & CS",
    items: [
      { value: "physics", label: "Physics (all)" },
      { value: "quant-ph", label: "Quantum Physics" },
      { value: "cond-mat", label: "Condensed Matter" },
      { value: "math", label: "Mathematics" },
      { value: "stat", label: "Statistics" },
      { value: "cs.LG,cs.AI,stat.ML", label: "Machine Learning & AI" },
      { value: "cs", label: "Computer Science" },
    ],
  },
];

const FIELD_OPTIONS: { value: ArxivSearchField; label: string; short: string; placeholder: string }[] = [
  { value: "all", label: "Keyword", short: "Keyword", placeholder: "Search title, abstract, keyword (any discipline, multilingual)…" },
  { value: "author", label: "Author", short: "Author", placeholder: "e.g. Noam Chomsky, Jean Piaget, or Bin-Bin Zhang" },
  { value: "title", label: "Title", short: "Title", placeholder: "Exact or partial title…" },
  { value: "id", label: "DOI / arXiv ID / URL", short: "ID", placeholder: "e.g. 10.1016/… or 2401.12345 or openalex.org/W…" },
];

function resolvePdfUrl(paper: ArxivPaper): string {
  if (paper.pdf_url) return paper.pdf_url;
  if (paper.id && !paper.id.startsWith("10.") && !paper.id.startsWith("W") && !paper.id.includes("/")) {
    return `https://arxiv.org/pdf/${paper.id}`;
  }
  return "";
}

function resolvePaperUrl(paper: ArxivPaper): string {
  if (paper.arxiv_url) return paper.arxiv_url;
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  if (paper.id) {
    if (paper.id.startsWith("10.")) return `https://doi.org/${paper.id}`;
    return `https://arxiv.org/abs/${paper.id}`;
  }
  return "";
}

export default function ArxivBrowser() {
  const openPdf = usePdfOpener();
  const [category, setCategory] = useState<string>(() => {
    try { return localStorage.getItem(CATEGORY_KEY) || ""; } catch { return ""; }
  });
  function pickCategory(v: string) {
    setCategory(v);
    try { localStorage.setItem(CATEGORY_KEY, v); } catch { /* ignore */ }
  }
  const [query, setQuery] = useState(saved.query ?? "");
  const [field, setField] = useState<ArxivSearchField>(saved.field ?? "all");
  const [results, setResults] = useState<ArxivPaper[]>(saved.results ?? []);
  const [total, setTotal] = useState(saved.total ?? 0);
  const [searched, setSearched] = useState(saved.searched ?? false);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [histOpen, setHistOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(saved.expandedIds ?? new Set());
  const [expandedAuthors, setExpandedAuthors] = useState<Set<string>>(saved.expandedAuthors ?? new Set());
  const [toast, setToast] = useState<ToastMsg | null>(null);

  function showToast(text: string, ok: boolean) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const { slots, cericStatus, selectedText, selectionPaperId, addingSlot, flashId, handleTextSelect, addSelectionToSlot, refreshCericStatus } =
    useCericAppend(showToast);

  useEffect(() => {
    saved = { ...saved, query, field, results, total, searched, expandedIds, expandedAuthors };
  }, [query, field, results, total, searched, expandedIds, expandedAuthors]);
  // Back to where you were scrolled after a remount.
  useLayoutEffect(() => {
    if (resultsRef.current && saved.scroll) resultsRef.current.scrollTop = saved.scroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched]);

  function remember(item: HistoryItem) {
    setHistory((prev) => {
      const next = [item, ...prev.filter((h) => !(h.q.toLowerCase() === item.q.toLowerCase() && h.field === item.field && h.category === item.category))].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  }
  function forget(item: HistoryItem | null) {
    setHistory((prev) => {
      const next = item ? prev.filter((h) => h !== item) : [];
      saveHistory(next);
      return next;
    });
  }
  function runHistory(h: HistoryItem) {
    setQuery(h.q);
    setField(h.field);
    if (h.category !== category) pickCategory(h.category);
    setHistOpen(false);
    void handleSearch(h);
  }

  async function handleSearch(over?: HistoryItem) {
    const q = (over?.q ?? query).trim();
    const f = over?.field ?? field;
    const cat = over ? over.category : category;
    if (!q) return;
    setHistOpen(false);
    setLoading(true);
    setSearched(true);
    remember({ q, field: f, category: cat });
    saved.scroll = 0;
    try {
      const r = await api.arxiv.search(q, f, 0, PAGE_SIZE, "all", cat);
      setResults(r.papers);
      setTotal(r.total);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Search failed — try again", false);
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoadMore() {
    const q = query.trim();
    if (!q || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.arxiv.search(q, field, results.length, PAGE_SIZE, "all", category);
      setResults((prev) => [...prev, ...r.papers]);
      setTotal(r.total);
    } catch {
      showToast("Failed to load more results", false);
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleAbstract(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!(id in cericStatus)) refreshCericStatus(id);
      }
      return next;
    });
  }

  async function handleAddToZotero(paper: ArxivPaper) {
    try {
      const r = await api.zotero.addPaper(paper.id, paper.title, paper.authors, resolvePdfUrl(paper), getZoteroCollection());
      if (r.status === "ok") {
        showToast("Added to Zotero ✓", true);
      } else {
        showToast(r.message || "Zotero add failed", false);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Zotero add failed", false);
    }
  }

  const activeField = FIELD_OPTIONS.find((f) => f.value === field)!;

  return (
    <div>
      <div className="browser-header">
        <h1>Search Academic Papers</h1>

        {/* Field Tabs */}
        <div className="browser-field-tabs">
          {FIELD_OPTIONS.map((f) => (
            <button
              key={f.value}
              className={`btn${field === f.value ? " btn-primary" : ""}`}
              onClick={() => setField(f.value)}
            >
              <span className="long">{f.label}</span><span className="short">{f.short}</span>
            </button>
          ))}
        </div>

        {/* Category: restricts to arXiv within the chosen categories — much faster than searching every source */}
        <div className="browser-category">
          <label>
            <span className="muted">Category</span>
            <select value={category} onChange={(e) => pickCategory(e.target.value)} title="Pick a category for a faster, focused search">
              {SEARCH_CATEGORIES.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {category && <span className="muted mono" style={{ fontSize: 11 }}>arXiv only · faster</span>}
        </div>

        {/* Search Bar */}
        <div className="browser-search-bar">
          <input
            type="text"
            placeholder={activeField.placeholder}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHistOpen(true); }}
            onFocus={() => setHistOpen(true)}
            onBlur={() => window.setTimeout(() => setHistOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(); else if (e.key === "Escape") setHistOpen(false); }}
            autoFocus
          />
          <button className="btn btn-primary" onClick={() => void handleSearch()} disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
          {histOpen && (() => {
            const typed = query.trim().toLowerCase();
            const items = history.filter((h) => !typed || h.q.toLowerCase().includes(typed)).slice(0, 8);
            if (!items.length) return null;
            return (
              <div className="search-history" role="listbox" aria-label="Search history">
                <div className="search-history-head"><span>Recent searches</span><button type="button" className="search-history-clear" onMouseDown={(e) => { e.preventDefault(); forget(null); }}>Clear</button></div>
                {items.map((h) => (
                  <div key={`${h.q}|${h.field}|${h.category}`} className="search-history-item" role="option" aria-selected={false}>
                    <button type="button" className="search-history-run" onMouseDown={(e) => { e.preventDefault(); runHistory(h); }}>
                      <span className="search-history-q">{h.q}</span>
                      <span className="search-history-meta">{h.field === "all" ? "Keyword" : h.field === "id" ? "ID" : h.field[0].toUpperCase() + h.field.slice(1)}{h.category ? ` · ${h.category}` : ""}</span>
                    </button>
                    <button type="button" className="search-history-x" aria-label={`Remove ${h.q} from history`} onMouseDown={(e) => { e.preventDefault(); forget(h); }}>×</button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {searched && !loading && total > 0 && (
          <div className="browser-result-count">
            Showing {results.length} of {total} result{total === 1 ? "" : "s"}
            {field === "author" ? ` by "${query.trim()}"` : ""}
          </div>
        )}
      </div>

      <div className="browser-results" ref={resultsRef} onScroll={(e) => { saved.scroll = (e.currentTarget as HTMLDivElement).scrollTop; }}>
        {!searched ? (
          <div className="arxiv-panel-empty" style={{ lineHeight: 1.6 }}>
            Search millions of papers across all fields of human knowledge — including Psychology, Linguistics, Philosophy, Geography, History, Computer Science, Physics, Medicine, Chinese literature/scholarship, and international open-access archives.
          </div>
        ) : loading ? (
          <div className="arxiv-panel-empty">Searching across academic archives…</div>
        ) : results.length === 0 ? (
          <div className="arxiv-panel-empty">No results found for "{query}"</div>
        ) : (
          <>
            {results.map((p) => {
              const pdfUrl = resolvePdfUrl(p);
              const paperUrl = resolvePaperUrl(p);

              return (
                <div key={p.id} className="browser-card" onMouseUp={() => handleTextSelect(p.id)}>
                  <div className="arxiv-row-badges">
                    {p.source && (
                      <span className="arxiv-category-tag" style={{ background: "var(--accent, #6366f1)", color: "#fff" }}>
                        {p.source.toUpperCase()}
                      </span>
                    )}
                    {p.categories.slice(0, 4).map((c) => (
                      <span key={c} className="arxiv-category-tag">{c}</span>
                    ))}
                    {p.submitted && (
                      <span className="arxiv-category-tag" style={{ opacity: 0.7 }}>
                        {p.submitted}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <div className="browser-card-title" style={{ flex: 1 }}>{p.title}</div>
                    <SlotIndicator status={cericStatus[p.id]} slots={slots} />
                  </div>
                  <div className="browser-card-authors">
                    {expandedAuthors.has(p.id) || p.authors.length <= 4
                      ? p.authors.join(", ")
                      : p.authors.slice(0, 4).join(", ")}
                    {p.authors.length > 4 && !expandedAuthors.has(p.id) && (
                      <button
                        className="browser-card-authors-more"
                        onClick={() => setExpandedAuthors((prev) => new Set(prev).add(p.id))}
                      >
                        +{p.authors.length - 4} more
                      </button>
                    )}
                  </div>
                  {!expandedIds.has(p.id) && p.abstract && (
                    <AbstractText
                      text={p.abstract}
                      className="browser-card-abstract-preview"
                      onMouseUp={() => handleTextSelect(p.id)}
                    />
                  )}
                  {p.abstract && (
                    <button
                      className="arxiv-row-abstract-toggle"
                      onClick={() => toggleAbstract(p.id)}
                    >
                      {expandedIds.has(p.id) ? "▾ hide abstract" : "▸ show full abstract"}
                    </button>
                  )}
                  {expandedIds.has(p.id) && p.abstract && (
                    <AbstractText
                      text={p.abstract}
                      className={`browser-card-abstract${flashId === p.id ? " flash" : ""}`}
                      onMouseUp={() => handleTextSelect(p.id)}
                    />
                  )}
                  {selectedText && selectionPaperId === p.id && (
                    <CericSelectionToolbar
                      selectedText={selectedText}
                      addingSlot={addingSlot}
                      slots={slots}
                      onAdd={(slotKey) => addSelectionToSlot(p, slotKey)}
                    />
                  )}
                  <div className="browser-card-actions">
                    {pdfUrl ? (
                      openPdf ? (
                        <button type="button" className="btn" onClick={() => openPdf({ url: pdfUrl, title: p.title, paper: p })}>▤ Open PDF</button>
                      ) : (
                        <a className="btn" href={pdfUrl} target="_blank" rel="noopener noreferrer">↗ Open PDF</a>
                      )
                    ) : (
                      <button className="btn" disabled title="No direct PDF link found">No PDF</button>
                    )}
                    {paperUrl && (
                      <a className="btn" href={paperUrl} target="_blank" rel="noopener noreferrer">
                        ↗ {p.source === "openalex" ? "Open Paper / DOI" : p.source === "europepmc" ? "Open Europe PMC" : "Open Source"}
                      </a>
                    )}
                    <AddToCollection paper={p} pdfUrl={pdfUrl} onResult={showToast} />
                    <ConvertButton fileKey={p.id} url={pdfUrl} name={p.title} kind="paper" onResult={showToast} disabled={!pdfUrl} />
                    <ZoteroCollectionSelect />
                    <button className="btn btn-primary" onClick={() => handleAddToZotero(p)}>
                      + Add to Zotero
                    </button>
                  </div>
                </div>
              );
            })}

            {field !== "id" && results.length < total && (
              <button className="btn browser-load-more" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : `Load more (${total - results.length} remaining)`}
              </button>
            )}
          </>
        )}
      </div>

      {toast && (
        <div className={`arxiv-toast ${toast.ok ? "ok" : "error"}`}>{toast.text}</div>
      )}
    </div>
  );
}
