import { useState } from "react";
import { api, type ArxivPaper, type ArxivSearchField } from "../api/client";
import { SlotIndicator, CericSelectionToolbar, useCericAppend } from "../components/CericToolbar";

interface ToastMsg { text: string; ok: boolean }

const PAGE_SIZE = 50;

const FIELD_OPTIONS: { value: ArxivSearchField; label: string; placeholder: string }[] = [
  { value: "all", label: "Keyword", placeholder: "Search title, abstract, keyword…" },
  { value: "author", label: "Author", placeholder: "e.g. Bin-Bin Zhang" },
  { value: "title", label: "Title", placeholder: "Exact or partial title…" },
  { value: "id", label: "arXiv ID / URL", placeholder: "e.g. 2401.12345 or https://arxiv.org/abs/2401.12345" },
];

export default function ArxivBrowser() {
  const [query, setQuery] = useState("");
  const [field, setField] = useState<ArxivSearchField>("all");
  const [results, setResults] = useState<ArxivPaper[]>([]);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedAuthors, setExpandedAuthors] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastMsg | null>(null);

  function showToast(text: string, ok: boolean) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const { cericStatus, selectedText, selectionPaperId, addingSlot, flashId, handleTextSelect, addSelectionToSlot, refreshCericStatus } =
    useCericAppend(showToast);

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    try {
      const r = await api.arxiv.search(q, field, 0, PAGE_SIZE);
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
      const r = await api.arxiv.search(q, field, results.length, PAGE_SIZE);
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
      const r = await api.zotero.addPaper(paper.id, paper.title, paper.authors, paper.pdf_url);
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
        <h1>Search</h1>
        <div className="browser-field-tabs">
          {FIELD_OPTIONS.map((f) => (
            <button
              key={f.value}
              className={`btn${field === f.value ? " btn-primary" : ""}`}
              onClick={() => setField(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="browser-search-bar">
          <input
            type="text"
            placeholder={activeField.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            autoFocus
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {searched && !loading && total > 0 && (
          <div className="browser-result-count">
            Showing {results.length} of {total} result{total === 1 ? "" : "s"}
            {field === "author" ? ` by "${query.trim()}"` : ""}
          </div>
        )}
      </div>

      <div className="browser-results">
        {!searched ? (
          <div className="arxiv-panel-empty">
            Search arXiv directly — no need to leave the app. Switch to "Author" to pull
            every paper by a specific person (e.g. all of Bin-Bin Zhang's papers), not just
            the first fuzzy-matched few.
          </div>
        ) : loading ? (
          <div className="arxiv-panel-empty">Searching…</div>
        ) : results.length === 0 ? (
          <div className="arxiv-panel-empty">No results for "{query}"</div>
        ) : (
          <>
            {results.map((p) => (
              <div key={p.id} className="browser-card" onMouseUp={() => handleTextSelect(p.id)}>
                <div className="arxiv-row-badges">
                  {p.categories.slice(0, 3).map((c) => (
                    <span key={c} className="arxiv-category-tag">{c}</span>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "flex-start" }}>
                  <div className="browser-card-title" style={{ flex: 1 }}>{p.title}</div>
                  <SlotIndicator status={cericStatus[p.id]} />
                </div>
                <div className="browser-card-authors">
                  {expandedAuthors.has(p.id) || p.authors.length <= 3
                    ? p.authors.join(", ")
                    : p.authors.slice(0, 3).join(", ")}
                  {p.authors.length > 3 && !expandedAuthors.has(p.id) && (
                    <button
                      className="browser-card-authors-more"
                      onClick={() => setExpandedAuthors((prev) => new Set(prev).add(p.id))}
                    >
                      +{p.authors.length - 3} more
                    </button>
                  )}
                </div>
                {!expandedIds.has(p.id) && (
                  <div className="browser-card-abstract-preview">{p.abstract}</div>
                )}
                <button
                  className="arxiv-row-abstract-toggle"
                  onClick={() => toggleAbstract(p.id)}
                >
                  {expandedIds.has(p.id) ? "▾ hide abstract" : "▸ show full abstract"}
                </button>
                {expandedIds.has(p.id) && (
                  <div className={`browser-card-abstract${flashId === p.id ? " flash" : ""}`}>{p.abstract}</div>
                )}
                {selectedText && selectionPaperId === p.id && (
                  <CericSelectionToolbar
                    selectedText={selectedText}
                    addingSlot={addingSlot}
                    onAdd={(slotKey) => addSelectionToSlot(p, slotKey)}
                  />
                )}
                <div className="browser-card-actions">
                  <button className="btn" onClick={() => window.open(p.pdf_url, "_blank", "noopener,noreferrer")}>
                    ↗ Open PDF
                  </button>
                  <button className="btn" onClick={() => window.open(p.arxiv_url, "_blank", "noopener,noreferrer")}>
                    ↗ Open arXiv
                  </button>
                  <button className="btn btn-primary" onClick={() => handleAddToZotero(p)}>
                    + Add to Zotero
                  </button>
                </div>
              </div>
            ))}

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
