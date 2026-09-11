import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { api, type ArxivPaper } from "../api/client";
import { SlotIndicator, CericSelectionToolbar, useCericAppend } from "../components/CericToolbar";

const SHORTLIST_KEY = "yggdrasil:shortlist";
const MY_LIST_KEY = "yggdrasil:my-list";
const PANEL_SIZES_KEY = "yggdrasil:panel-sizes";

function loadList(key: string): ArxivPaper[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveList(key: string, list: ArxivPaper[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // localStorage unavailable (private mode, quota) — fail silently
  }
}

// Single fixed localStorage key for all panel layouts, per spec.
const panelStorage: LayoutStorage = {
  getItem: () => localStorage.getItem(PANEL_SIZES_KEY),
  setItem: (_key, value) => localStorage.setItem(PANEL_SIZES_KEY, value),
};

interface ToastMsg { text: string; ok: boolean }

function CategoryBadges({ categories }: { categories: string[] }) {
  return (
    <div className="arxiv-row-badges">
      {categories.slice(0, 2).map((c) => (
        <span key={c} className="arxiv-category-tag">{c}</span>
      ))}
    </div>
  );
}

export default function ArxivSearch() {
  const [daily, setDaily] = useState<ArxivPaper[]>([]);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [shortlist, setShortlist] = useState<ArxivPaper[]>(() => loadList(SHORTLIST_KEY));
  const [myList, setMyList] = useState<ArxivPaper[]>(() => loadList(MY_LIST_KEY));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  const { defaultLayout, onLayoutChange } = useDefaultLayout({
    id: "arxiv-search",
    storage: panelStorage,
    panelIds: ["daily", "shortlist", "mylist"],
  });

  function showToast(text: string, ok: boolean) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const { cericStatus, selectedText, selectionPaperId, addingSlot, flashId, handleTextSelect, addSelectionToSlot, refreshCericStatus } =
    useCericAppend(showToast);

  useEffect(() => { fetchDaily(); }, []);
  useEffect(() => { saveList(SHORTLIST_KEY, shortlist); }, [shortlist]);
  useEffect(() => { saveList(MY_LIST_KEY, myList); }, [myList]);
  useEffect(() => {
    if (!activeId && myList.length > 0) setActiveId(myList[0].id);
  }, [myList, activeId]);
  useEffect(() => {
    myList.forEach((p) => {
      if (!(p.id in cericStatus)) refreshCericStatus(p.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myList]);

  function fetchDaily() {
    setDailyLoading(true);
    api.arxiv.daily(200)
      .then(setDaily)
      .catch(() => showToast("Failed to fetch daily arXiv feed", false))
      .finally(() => setDailyLoading(false));
  }

  function toggleAbstract(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addToShortlist(paper: ArxivPaper) {
    setShortlist((prev) => (prev.some((p) => p.id === paper.id) ? prev : [paper, ...prev]));
  }

  function removeFromShortlist(id: string) {
    setShortlist((prev) => prev.filter((p) => p.id !== id));
  }

  function readPaper(paper: ArxivPaper) {
    setMyList((prev) => (prev.some((p) => p.id === paper.id) ? prev : [paper, ...prev]));
    setActiveId(paper.id);
  }

  function clearMyList() {
    if (myList.length === 0) return;
    if (!window.confirm("Clear all papers from My List?")) return;
    setMyList([]);
    setActiveId(null);
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

  const filteredDaily = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return daily;
    return daily.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      p.authors.join(" ").toLowerCase().includes(q) ||
      p.categories.join(" ").toLowerCase().includes(q)
    );
  }, [daily, filterText]);

  const activePaper = myList.find((p) => p.id === activeId) || null;
  const today = new Date().toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)" }}>
      <Group
        id="arxiv-search"
        orientation="horizontal"
        className="arxiv-panel-group"
        defaultLayout={defaultLayout}
        onLayoutChange={onLayoutChange}
      >
        {/* Panel 1 — Daily Papers */}
        <Panel id="daily" defaultSize={25} minSize={15} className="arxiv-panel">
          <div className="arxiv-panel-header">
            <h2>Daily Papers</h2>
            <span className="arxiv-date">{today}</span>
            <div className="arxiv-panel-header-spacer" />
            <span className="arxiv-count">{daily.length}</span>
          </div>
          <div className="arxiv-search-bar">
            <input
              type="text"
              placeholder="Search title, author, keyword..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          <div className="arxiv-panel-list">
            {dailyLoading ? (
              <div className="arxiv-panel-empty">Loading…</div>
            ) : filteredDaily.length === 0 ? (
              <div className="arxiv-panel-empty">No matching papers</div>
            ) : (
              filteredDaily.map((p) => (
                <div
                  key={p.id}
                  className="arxiv-row"
                  onClick={() => window.open(p.arxiv_url, "_blank", "noopener,noreferrer")}
                >
                  <CategoryBadges categories={p.categories} />
                  <div className="arxiv-row-title">{p.title}</div>
                  <div className="arxiv-row-authors">
                    {p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? " et al." : ""}
                  </div>
                  <button
                    className="arxiv-row-abstract-toggle"
                    onClick={(e) => { e.stopPropagation(); toggleAbstract(p.id); }}
                  >
                    {expandedIds.has(p.id) ? "▾ hide abstract" : "▸ show abstract"}
                  </button>
                  {expandedIds.has(p.id) && <div className="arxiv-row-abstract">{p.abstract}</div>}
                  <div className="arxiv-row-actions">
                    <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); addToShortlist(p); }}>
                      ➕ Shortlist
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Separator className="arxiv-resize-handle" />

        {/* Panel 2 — Shortlisted */}
        <Panel id="shortlist" defaultSize={20} minSize={15} className="arxiv-panel">
          <div className="arxiv-panel-header">
            <h2>Shortlisted</h2>
            <div className="arxiv-panel-header-spacer" />
            <span className="arxiv-count">{shortlist.length}</span>
          </div>
          <div className="arxiv-panel-list">
            {shortlist.length === 0 ? (
              <div className="arxiv-panel-empty">Shortlist papers from the Daily Papers panel</div>
            ) : (
              shortlist.map((p) => (
                <div
                  key={p.id}
                  className="arxiv-row"
                  onClick={() => window.open(p.arxiv_url, "_blank", "noopener,noreferrer")}
                >
                  <CategoryBadges categories={p.categories} />
                  <div className="arxiv-row-title">{p.title}</div>
                  <div className="arxiv-row-actions">
                    <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); readPaper(p); }}>
                      → Read
                    </button>
                    <button className="btn" onClick={(e) => { e.stopPropagation(); removeFromShortlist(p.id); }}>
                      ✕ Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Separator className="arxiv-resize-handle" />

        {/* Panel 3 — My List (reading pane) */}
        <Panel id="mylist" defaultSize={55} minSize={30} className="arxiv-panel">
          <div className="arxiv-panel-header">
            <h2>My List</h2>
            <div className="arxiv-panel-header-spacer" />
            {myList.length > 0 && (
              <button className="btn" onClick={clearMyList}>Clear All</button>
            )}
          </div>

          {activePaper ? (
            <div className="arxiv-reading-pane" onMouseUp={() => handleTextSelect(activePaper.id)}>
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                <div className="arxiv-reading-title" style={{ flex: 1 }}>{activePaper.title}</div>
                <SlotIndicator status={cericStatus[activePaper.id]} />
              </div>
              <div className="arxiv-reading-authors">{activePaper.authors.join(", ")}</div>
              <div className="arxiv-reading-meta">
                {activePaper.categories.map((c) => (
                  <span key={c} className="arxiv-category-tag">{c}</span>
                ))}
                {activePaper.submitted && (
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    Submitted {new Date(activePaper.submitted).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                )}
              </div>

              {selectedText && selectionPaperId === activePaper.id && (
                <CericSelectionToolbar
                  selectedText={selectedText}
                  addingSlot={addingSlot}
                  onAdd={(slotKey) => addSelectionToSlot(activePaper, slotKey)}
                />
              )}

              <div className={`arxiv-reading-abstract${flashId === activePaper.id ? " flash" : ""}`}>{activePaper.abstract}</div>
              <div className="arxiv-reading-actions">
                <button className="btn" onClick={() => window.open(activePaper.pdf_url, "_blank", "noopener,noreferrer")}>
                  ↗ Open PDF
                </button>
                <button className="btn" onClick={() => window.open(activePaper.arxiv_url, "_blank", "noopener,noreferrer")}>
                  ↗ Open arXiv
                </button>
                <button className="btn btn-primary" onClick={() => handleAddToZotero(activePaper)}>
                  + Add to Zotero
                </button>
              </div>
            </div>
          ) : (
            <div className="arxiv-panel-empty">Select a paper from Shortlisted to start reading</div>
          )}

          {myList.length > 0 && (
            <div className="arxiv-saved-section">
              <div className="arxiv-saved-header">Saved ({myList.length})</div>
              <div className="arxiv-saved-grid">
                {myList.map((p) => (
                  <div
                    key={p.id}
                    className={`arxiv-saved-card${p.id === activeId ? " active" : ""}`}
                    onClick={() => setActiveId(p.id)}
                  >
                    <span className="arxiv-saved-card-title">{p.title}</span>
                    <SlotIndicator status={cericStatus[p.id]} />
                    <button className="btn" onClick={(e) => { e.stopPropagation(); handleAddToZotero(p); }}>
                      Zotero
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </Group>

      {toast && (
        <div className={`arxiv-toast ${toast.ok ? "ok" : "error"}`}>{toast.text}</div>
      )}
    </div>
  );
}
