import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from "react-resizable-panels";
import { api, type ArxivPaper } from "../api/client";
import { SlotIndicator, CericSelectionToolbar, useCericAppend } from "../components/CericToolbar";
import AbstractText from "../components/AbstractText";

const SHORTLIST_KEY = "yggdrasil:shortlist";
const MY_LIST_KEY = "yggdrasil:my-list";
const PANEL_SIZES_KEY = "yggdrasil:panel-sizes";
const TOPIC_KEY = "yggdrasil:arxiv-topic";
const CUSTOM_TOPICS_KEY = "yggdrasil:custom-topics";

const DEFAULT_TOPICS: { id: string; label: string; group?: string }[] = [
  { id: "all", label: "All new papers (every field)", group: "Universal" },

  // Chinese Academy of Social Sciences / NCPSSD
  { id: "chinese:ncpssd-philosophy", label: "NCPSSD / CASS: Philosophy & Thought (哲学与思想)", group: "NCPSSD / CASS (社科院)" },
  { id: "chinese:ncpssd-history", label: "NCPSSD / CASS: History & Archaeology (历史与考古)", group: "NCPSSD / CASS (社科院)" },
  { id: "chinese:ncpssd-literature", label: "NCPSSD / CASS: Literature & Linguistics (文学与语言学)", group: "NCPSSD / CASS (社科院)" },
  { id: "chinese:ncpssd-sociology", label: "NCPSSD / CASS: Social Sciences & Law (社会学与法学)", group: "NCPSSD / CASS (社科院)" },
  { id: "chinese:ncpssd-economics", label: "NCPSSD / CASS: Economics & Politics (经济与政治学)", group: "NCPSSD / CASS (社科院)" },

  // Chinese Academy of Sciences (CAS)
  { id: "chinese:cas-science-china", label: "CAS: Science China & CAS Open Access (中国科学)", group: "Chinese Academy of Sciences (中科院)" },
  { id: "chinese:cas-earth-geography", label: "CAS: Earth & Geographic Sciences (地理与地球科学)", group: "Chinese Academy of Sciences (中科院)" },
  { id: "chinese:cas-physics-math", label: "CAS: Physics & Mathematics (数理科学)", group: "Chinese Academy of Sciences (中科院)" },
  { id: "chinese:cas-life-medicine", label: "CAS: Life Sciences & Bio-Medicine (生命科学与医学)", group: "Chinese Academy of Sciences (中科院)" },
  { id: "chinese:cas-computing-tech", label: "CAS: Computing & Information Technology (信息与计算科学)", group: "Chinese Academy of Sciences (中科院)" },

  // China Academic Journals / CNKI
  { id: "chinese:cnki-humanities", label: "CNKI / CAJ: Literature, History & Philosophy (知网文史哲)", group: "China Academic Journals (CNKI)" },
  { id: "chinese:cnki-social-sciences", label: "CNKI / CAJ: Social Sciences & Education (知网社科与教育)", group: "China Academic Journals (CNKI)" },
  { id: "chinese:cnki-geography-env", label: "CNKI / CAJ: Geography & Urban Planning (知网地理与环境)", group: "China Academic Journals (CNKI)" },
  { id: "chinese:cnki-science-tech", label: "CNKI / CAJ: Natural Sciences & Technology (知网自然科学)", group: "China Academic Journals (CNKI)" },

  // Psychology & Cognitive Sciences
  { id: "field:psychology", label: "Psychology (all)", group: "Psychology & Cognitive Sciences" },
  { id: "field:cognitive-psychology", label: "Cognitive Psychology", group: "Psychology & Cognitive Sciences" },
  { id: "field:neuropsychology", label: "Neuropsychology & Behavioral Neuroscience", group: "Psychology & Cognitive Sciences" },
  { id: "field:developmental-psychology", label: "Developmental Psychology", group: "Psychology & Cognitive Sciences" },
  { id: "field:social-psychology", label: "Social & Personality Psychology", group: "Psychology & Cognitive Sciences" },

  // Linguistics & Language
  { id: "field:linguistics", label: "Linguistics (all)", group: "Linguistics & Language" },
  { id: "field:computational-linguistics", label: "Computational Linguistics & NLP", group: "Linguistics & Language" },
  { id: "field:psycholinguistics", label: "Psycholinguistics & Neurolinguistics", group: "Linguistics & Language" },
  { id: "field:sociolinguistics", label: "Sociolinguistics & Language Evolution", group: "Linguistics & Language" },

  // Philosophy & Ethics
  { id: "field:philosophy", label: "Philosophy (all)", group: "Philosophy & Ethics" },
  { id: "field:philosophy-of-mind", label: "Philosophy of Mind & Consciousness", group: "Philosophy & Ethics" },
  { id: "field:ethics", label: "Ethics & Moral Philosophy", group: "Philosophy & Ethics" },
  { id: "field:chinese-philosophy", label: "Chinese Philosophy & Thought (中国哲学与思想)", group: "Philosophy & Ethics" },
  { id: "field:epistemology", label: "Epistemology & Logic", group: "Philosophy & Ethics" },

  // Geography & Earth Sciences
  { id: "field:geography", label: "Geography (all)", group: "Geography & Earth Sciences" },
  { id: "field:human-geography", label: "Human & Urban Geography", group: "Geography & Earth Sciences" },
  { id: "field:physical-geography", label: "Physical Geography & Geomorphology", group: "Geography & Earth Sciences" },
  { id: "field:gis-spatial", label: "GIS & Spatial Analysis", group: "Geography & Earth Sciences" },
  { id: "physics.geo-ph", label: "Geophysics (arXiv)", group: "Geography & Earth Sciences" },

  // History & Social Sciences
  { id: "field:history", label: "History (all)", group: "History & Social Sciences" },
  { id: "field:chinese-history", label: "Chinese History & East Asian Studies (中国历史与东亚研究)", group: "History & Social Sciences" },
  { id: "field:sociology", label: "Sociology", group: "History & Social Sciences" },
  { id: "field:political-science", label: "Political Science", group: "History & Social Sciences" },
  { id: "field:education", label: "Education & Pedagogy", group: "History & Social Sciences" },

  // Medicine & Life Sciences
  { id: "field:medicine", label: "Medicine & Clinical Research", group: "Medicine & Health" },
  { id: "field:neuroscience", label: "Neuroscience", group: "Medicine & Health" },
  { id: "q-bio", label: "Quantitative Biology (arXiv)", group: "Medicine & Health" },

  // Computer Science & AI
  { id: "cs", label: "Computer Science (all)", group: "Computer Science & AI" },
  { id: "cs.AI", label: "Artificial Intelligence", group: "Computer Science & AI" },
  { id: "cs.CL", label: "Computation & Language (NLP)", group: "Computer Science & AI" },
  { id: "cs.CV", label: "Computer Vision", group: "Computer Science & AI" },

  // Mathematics & Physics
  { id: "math", label: "Mathematics (all)", group: "Mathematics & Physics" },
  { id: "physics.chem-ph", label: "Chemical Physics", group: "Mathematics & Physics" },
  { id: "astro-ph.HE", label: "High Energy Astrophysics", group: "Mathematics & Physics" },
];

function loadTopic(): string {
  try {
    return localStorage.getItem(TOPIC_KEY) || "astro-ph.HE";
  } catch {
    return "astro-ph.HE";
  }
}

function loadCustomTopics(): { id: string; label: string; group?: string }[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TOPICS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomTopics(list: { id: string; label: string; group?: string }[]) {
  try {
    localStorage.setItem(CUSTOM_TOPICS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

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
    // localStorage unavailable
  }
}

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

// Single fixed localStorage key for all panel layouts, per spec.
const panelStorage: LayoutStorage = {
  getItem: () => localStorage.getItem(PANEL_SIZES_KEY),
  setItem: (_key, value) => localStorage.setItem(PANEL_SIZES_KEY, value),
};

interface ToastMsg { text: string; ok: boolean }

function CategoryBadges({ categories, source }: { categories: string[]; source?: string }) {
  return (
    <div className="arxiv-row-badges">
      {source && source !== "arxiv" && (
        <span className="arxiv-category-tag" style={{ background: "var(--accent, #6366f1)", color: "#fff" }}>
          {source.toUpperCase()}
        </span>
      )}
      {categories.slice(0, 3).map((c) => (
        <span key={c} className="arxiv-category-tag">{c}</span>
      ))}
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function ArxivSearch() {
  const [daily, setDaily] = useState<ArxivPaper[]>([]);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [topic, setTopic] = useState(loadTopic);
  const [customTopicInput, setCustomTopicInput] = useState("");
  const [customTopics, setCustomTopics] = useState(loadCustomTopics);
  const [topicQuery, setTopicQuery] = useState("");
  const [editingTopic, setEditingTopic] = useState(false);
  const [serverTopics, setServerTopics] = useState(DEFAULT_TOPICS);
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

  const { slots, cericStatus, selectedText, selectionPaperId, addingSlot, flashId, handleTextSelect, addSelectionToSlot, refreshCericStatus } =
    useCericAppend(showToast);

  useEffect(() => {
    api.arxiv.topics().then((r) => {
      if (r.topics?.length) setServerTopics(r.topics);
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchDaily(false); }, [topic, selectedDate]);
  useEffect(() => { saveList(SHORTLIST_KEY, shortlist); }, [shortlist]);
  useEffect(() => { saveList(MY_LIST_KEY, myList); }, [myList]);
  useEffect(() => { saveCustomTopics(customTopics); }, [customTopics]);
  useEffect(() => {
    if (!activeId && myList.length > 0) setActiveId(myList[0].id);
  }, [myList, activeId]);
  useEffect(() => {
    myList.forEach((p) => {
      if (!(p.id in cericStatus)) refreshCericStatus(p.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myList]);

  const allTopics = useMemo(() => {
    const combined = [...customTopics, ...serverTopics];
    const seen = new Set<string>();
    return combined.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [customTopics, serverTopics]);

  function fetchDaily(refresh: boolean) {
    if (refresh) setRefreshing(true);
    else setDailyLoading(true);
    // Only pin an explicit date when the user picked one other than today — arXiv's
    // announce day can lag a paper's raw submittedDate by up to a day (submission
    // deadline cutoff), so forcing today's exact date range here would exclude papers
    // announced today but submitted yesterday. Omitting date for "today" lets the
    // backend use the RSS "new" listing instead, which reflects true announce day.
    api.arxiv.daily(200, topic, refresh, selectedDate === todayIso() ? undefined : selectedDate)
      .then((r) => {
        setDaily(r.papers || []);
        if (r.warning) {
          showToast(r.warning, false);
        } else if (refresh) {
          showToast(`Updated ${r.papers?.length || 0} papers (${r.cat})`, true);
        }
      })
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to fetch daily papers feed", false))
      .finally(() => {
        setDailyLoading(false);
        setRefreshing(false);
      });
  }

  function applyTopic(next: string) {
    const cleaned = next.trim();
    if (!cleaned) return;
    setTopic(cleaned);
    try { localStorage.setItem(TOPIC_KEY, cleaned); } catch { /* ignore */ }
  }

  function handleAddCustomTopic() {
    const raw = customTopicInput.trim();
    if (!raw) return;
    const topicId = raw.startsWith("field:") || raw.startsWith("custom:") ? raw : `custom:${raw.toLowerCase().replace(/\s+/g, "-")}`;
    const newTopic = { id: topicId, label: raw, group: "Custom Topics" };
    setCustomTopics((prev) => [newTopic, ...prev.filter((t) => t.id !== topicId)]);
    setCustomTopicInput("");
    applyTopic(topicId);
    showToast(`Added topic: "${raw}"`, true);
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
      const r = await api.zotero.addPaper(paper.id, paper.title, paper.authors, resolvePdfUrl(paper));
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
    return daily.filter((p) => {
      const hay = [
        p.title,
        p.authors.join(" "),
        p.categories.join(" "),
        p.abstract || "",
        p.id,
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [daily, filterText]);

  const activePaper = myList.find((p) => p.id === activeId) || null;
  const activePdfUrl = activePaper ? resolvePdfUrl(activePaper) : "";
  const activePaperUrl = activePaper ? resolvePaperUrl(activePaper) : "";

  const topicLabel = allTopics.find((t) => t.id === topic)?.label || topic;

  // arXiv only announces one new-listings batch per business day (evenings US
  // Eastern); when "today" hasn't been announced yet, we're showing the latest
  // available batch instead. Say so plainly rather than looking broken/stale.
  const latestListingDate = useMemo(() => {
    for (const p of daily) {
      if (!p.submitted) continue;
      const d = new Date(p.submitted);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }
    }
    return null;
  }, [daily]);
  const showsOlderListing =
    selectedDate === todayIso() && !!latestListingDate && latestListingDate !== selectedDate;
  
  const topicGroups = useMemo(() => {
    const q = topicQuery.trim().toLowerCase();
    const groups: { name: string; items: { id: string; label: string }[] }[] = [];
    const byName = new Map<string, { id: string; label: string }[]>();
    for (const t of allTopics) {
      if (q && !`${t.label} ${t.id} ${t.group || ""}`.toLowerCase().includes(q)) continue;
      const name = t.group || "Other";
      const list = byName.get(name) || [];
      list.push({ id: t.id, label: t.label });
      byName.set(name, list);
    }
    for (const [name, items] of byName) groups.push({ name, items });
    return groups;
  }, [allTopics, topicQuery]);

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
            <h2>Daily Archive</h2>
            <input
              type="date"
              className="arxiv-date-input"
              value={selectedDate}
              max={todayIso()}
              onChange={(e) => setSelectedDate(e.target.value || todayIso())}
              title="Show papers submitted on this date"
            />
            <div className="arxiv-panel-header-spacer" />
            <span className="arxiv-count">{filteredDaily.length}{filterText ? `/${daily.length}` : ""}</span>
          </div>
          <div className="arxiv-search-bar" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={refreshing}
                onClick={() => fetchDaily(true)}
                title="Fetch papers for the selected date from the live feed"
              >
                {refreshing ? "Updating…" : "Update from web"}
              </button>
              {selectedDate !== todayIso() && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSelectedDate(todayIso())}
                  title="Jump back to today"
                >
                  Today
                </button>
              )}

              <button
                type="button"
                className={`btn${editingTopic ? " btn-primary" : ""}`}
                style={{ flex: 1, textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                onClick={() => setEditingTopic((v) => !v)}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Topic: <strong>{topicLabel}</strong>
                </span>
                <span style={{ marginLeft: 6 }}>{editingTopic ? "▲" : "▼"}</span>
              </button>
            </div>

            {/* Collapsible Topic Slider / Drawer */}
            {editingTopic && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  background: "var(--bg-card, #1a1a24)",
                  border: "1px solid var(--border-color, #2d2d3d)",
                  padding: 10,
                  borderRadius: 8,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="muted mono" style={{ fontSize: 11 }}>Select Field / Academic Database</span>
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 11, padding: "2px 6px" }}
                    onClick={() => setEditingTopic(false)}
                  >
                    Done
                  </button>
                </div>

                <input
                  type="text"
                  placeholder="Filter fields: Chinese Academy of Sciences, NCPSSD, philosophy, geography..."
                  value={topicQuery}
                  onChange={(e) => setTopicQuery(e.target.value)}
                  autoFocus
                />

                <select
                  size={12}
                  value={topic}
                  onChange={(e) => {
                    if (e.target.value) {
                      applyTopic(e.target.value);
                      setEditingTopic(false);
                    }
                  }}
                  style={{ width: "100%", fontSize: 12, padding: 4 }}
                >
                  {topicGroups.map((g) => (
                    <optgroup key={g.name} label={g.name}>
                      {g.items.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>

                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Add custom field or topic..."
                    value={customTopicInput}
                    onChange={(e) => setCustomTopicInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomTopic(); }}
                  />
                  <button type="button" className="btn btn-primary" onClick={handleAddCustomTopic}>+ Add</button>
                </div>
              </div>
            )}

            <input
              type="text"
              placeholder="Filter title, author, abstract, keyword…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          {showsOlderListing && (
            <div className="arxiv-stale-notice">
              arXiv hasn't announced today's listing yet — showing the latest available batch ({latestListingDate}). New papers publish once per business day, evenings US Eastern.
            </div>
          )}
          <div className="arxiv-panel-list">
            {dailyLoading ? (
              <div className="arxiv-panel-empty">Loading…</div>
            ) : filteredDaily.length === 0 ? (
              <div className="arxiv-panel-empty">No matching papers</div>
            ) : (
              filteredDaily.map((p) => {
                const pdf = resolvePdfUrl(p);
                const paperUrl = resolvePaperUrl(p);
                return (
                  <div
                    key={p.id}
                    className="arxiv-row"
                  >
                    <CategoryBadges categories={p.categories} source={p.source} />
                    <div className="arxiv-row-title">{p.title}</div>
                    <div className="arxiv-row-authors">
                      {p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? " et al." : ""}
                    </div>
                    <button
                      className="arxiv-row-abstract-toggle"
                      onClick={() => toggleAbstract(p.id)}
                    >
                      {expandedIds.has(p.id) ? "▾ hide abstract" : "▸ show abstract"}
                    </button>
                    {expandedIds.has(p.id) && <AbstractText text={p.abstract} className="arxiv-row-abstract" />}
                    <div className="arxiv-row-actions" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-primary" onClick={() => addToShortlist(p)}>
                        ➕ Shortlist
                      </button>
                      {pdf && (
                        <a className="btn" href={pdf} target="_blank" rel="noopener noreferrer">
                          ↗ PDF
                        </a>
                      )}
                      {paperUrl && (
                        <a className="btn" href={paperUrl} target="_blank" rel="noopener noreferrer">
                          ↗ Source
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
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
              <div className="arxiv-panel-empty">Shortlist papers from the Daily Archive panel</div>
            ) : (
              shortlist.map((p) => {
                const pdf = resolvePdfUrl(p);
                const paperUrl = resolvePaperUrl(p);
                return (
                  <div
                    key={p.id}
                    className="arxiv-row"
                  >
                    <CategoryBadges categories={p.categories} source={p.source} />
                    <div className="arxiv-row-title">{p.title}</div>
                    <div className="arxiv-row-actions" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn btn-primary" onClick={() => readPaper(p)}>
                        → Read
                      </button>
                      <button className="btn" onClick={() => removeFromShortlist(p.id)}>
                        ✕ Remove
                      </button>
                      {pdf && (
                        <a className="btn" href={pdf} target="_blank" rel="noopener noreferrer">
                          ↗ PDF
                        </a>
                      )}
                      {paperUrl && (
                        <a className="btn" href={paperUrl} target="_blank" rel="noopener noreferrer">
                          ↗ Source
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
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
                <SlotIndicator status={cericStatus[activePaper.id]} slots={slots} />
              </div>
              <div className="arxiv-reading-authors">{activePaper.authors.join(", ")}</div>
              <div className="arxiv-reading-meta">
                {activePaper.source && activePaper.source !== "arxiv" && (
                  <span className="arxiv-category-tag" style={{ background: "var(--accent, #6366f1)", color: "#fff" }}>
                    {activePaper.source.toUpperCase()}
                  </span>
                )}
                {activePaper.categories.map((c) => (
                  <span key={c} className="arxiv-category-tag">{c}</span>
                ))}
                {activePaper.submitted && (
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {new Date(activePaper.submitted).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                )}
              </div>

              {selectedText && selectionPaperId === activePaper.id && (
                <CericSelectionToolbar
                  selectedText={selectedText}
                  addingSlot={addingSlot}
                  slots={slots}
                  onAdd={(slotKey) => addSelectionToSlot(activePaper, slotKey)}
                />
              )}

              <AbstractText
                text={activePaper.abstract}
                className={`arxiv-reading-abstract${flashId === activePaper.id ? " flash" : ""}`}
                onMouseUp={() => handleTextSelect(activePaper.id)}
              />
              <div className="arxiv-reading-actions">
                {activePdfUrl ? (
                  <a className="btn" href={activePdfUrl} target="_blank" rel="noopener noreferrer">
                    ↗ Open PDF
                  </a>
                ) : (
                  <button className="btn" disabled title="No direct PDF URL available">
                    No PDF Link
                  </button>
                )}
                {activePaperUrl ? (
                  <a className="btn" href={activePaperUrl} target="_blank" rel="noopener noreferrer">
                    ↗ {activePaper.source === "openalex" ? "Open Paper / DOI" : "Open Source"}
                  </a>
                ) : null}
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
                    <SlotIndicator status={cericStatus[p.id]} slots={slots} />
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
