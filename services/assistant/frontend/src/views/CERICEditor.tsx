import { useEffect, useState, useCallback } from "react";
import { api, type Paper, type PaperFrontmatter } from "../api/client";
import GateIndicator from "../components/GateIndicator";
import { buildLatexSnippet } from "../components/LatexExportUtils";
import { getActiveProviderPayload } from "../lib/aiProvider";
import {
  ANALYSIS_TAGS_EVENT,
  ensureAnalysisTags,
  getCachedAnalysisSlots,
  type AnalysisSlot,
} from "../lib/analysisTags";
import BooksTab from "./BooksTab";
import MarkdownNotesTab from "./MarkdownNotesTab";

interface Props {
  citekey: string | null;
  onBack: () => void;
  onSelectPaper?: (citekey: string) => void;
  onPaperDeleted?: () => void;
}

function slotsFilledCount(fm: PaperFrontmatter, slots: AnalysisSlot[]): number {
  return slots.filter((s) => ((fm[s.key] as string) || "").trim()).length;
}

function paperLatexSnippet(fm: PaperFrontmatter, slots: AnalysisSlot[]): string {
  return buildLatexSnippet({
    title: fm.title || "Untitled",
    sections: slots.map((s) => ({
      heading: s.label,
      body: ((fm[s.key] as string) || "").trim(),
    })),
  });
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CollectionTab({
  onSelect,
  onDeleted,
  slots,
}: {
  onSelect: (citekey: string) => void;
  onDeleted?: (citekey: string) => void;
  slots: AnalysisSlot[];
}) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "complete">("all");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [zoteroMissing, setZoteroMissing] = useState<Set<string> | null>(null);
  const [zoteroChecking, setZoteroChecking] = useState(false);

  useEffect(() => {
    api.papers.list()
      .then(setPapers)
      .finally(() => setLoading(false));
  }, []);

  function flashCopyMsg(text: string) {
    setCopyMsg(text);
    setTimeout(() => setCopyMsg(null), 2500);
  }

  async function handleCopyMd(citekey: string) {
    try {
      const r = await api.papers.raw(citekey);
      flashCopyMsg((await copyToClipboard(r.raw)) ? `Copied ${citekey}.md` : "Copy failed — clipboard unavailable");
    } catch {
      flashCopyMsg("Copy failed");
    }
  }

  async function handleZoteroAudit() {
    setZoteroChecking(true);
    try {
      const r = await api.zoteroAudit();
      setZoteroMissing(new Set(r.missing.map((m) => m.citekey)));
      flashCopyMsg(`Zotero check: ${r.missing.length} of ${r.total} not in Zotero`);
    } catch (e) {
      flashCopyMsg(e instanceof Error ? e.message : "Zotero check failed");
    } finally {
      setZoteroChecking(false);
    }
  }

  async function handleCopyLatex(fm: PaperFrontmatter) {
    const ok = await copyToClipboard(paperLatexSnippet(fm, slots));
    flashCopyMsg(ok ? "Copied LaTeX snippet" : "Copy failed — clipboard unavailable");
  }

  async function handleDelete(citekey: string, title?: string) {
    const label = title || citekey;
    if (!window.confirm(`Delete note for “${label}”?\n\nThis removes vault/10-Papers/${citekey}.md permanently.`)) {
      return;
    }
    setDeleting(citekey);
    try {
      await api.papers.delete(citekey);
      setPapers((prev) => prev.filter((p) => p.citekey !== citekey));
      flashCopyMsg(`Deleted ${citekey}`);
      onDeleted?.(citekey);
    } catch (e) {
      flashCopyMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  const filtered = papers.filter((p) => {
    const fm = p.frontmatter;
    if (dateFilter && fm.read !== dateFilter) return false;
    if (keyword) {
      const q = keyword.toLowerCase();
      const hay = `${fm.title || ""} ${((fm.tags as string[]) || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const filled = slotsFilledCount(fm, slots);
    const isComplete = filled === slots.length && Boolean(fm.aq_written);
    if (status === "draft" && isComplete) return false;
    if (status === "complete" && !isComplete) return false;
    return true;
  });

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <div>
      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        <input
          type="text"
          placeholder="Search title or tags…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as "all" | "draft" | "complete")}>
          <option value="all">All</option>
          <option value="draft">Draft</option>
          <option value="complete">Complete</option>
        </select>
        <button className="btn" onClick={handleZoteroAudit} disabled={zoteroChecking}>
          {zoteroChecking ? "Checking…" : "Check Zotero"}
        </button>
        {copyMsg && <span className="ok mono" style={{ fontSize: 12 }}>{copyMsg}</span>}
      </div>

      <div style={{ marginTop: 16 }}>
        {filtered.length === 0 ? (
          <div className="muted">No papers match this filter.</div>
        ) : (
          filtered.map((p) => {
            const fm = p.frontmatter;
            const filled = slotsFilledCount(fm, slots);
            return (
              <div key={p.citekey} className="card" style={{ cursor: "pointer" }} onClick={() => onSelect(p.citekey)}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fm.title || p.citekey}
                    </div>
                    <div className="muted mono" style={{ fontSize: 11 }}>
                      {fm.arxiv ? `arXiv:${fm.arxiv}` : p.citekey}{fm.read ? ` · ${fm.read}` : ""}
                      {zoteroMissing && (
                        zoteroMissing.has(p.citekey)
                          ? <span className="crit" style={{ marginLeft: 8 }}>○ not in Zotero</span>
                          : <span className="ok" style={{ marginLeft: 8 }}>● in Zotero</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn" onClick={() => handleCopyMd(p.citekey)}>Copy MD</button>
                    <button className="btn" onClick={() => handleCopyLatex(fm)}>Open in LaTeX</button>
                    <button
                      className="btn btn-crit"
                      disabled={deleting === p.citekey}
                      onClick={() => handleDelete(p.citekey, fm.title)}
                    >
                      {deleting === p.citekey ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${(filled / Math.max(slots.length, 1)) * 100}%`,
                      background: filled === slots.length ? "var(--ok)" : "var(--page-accent)",
                      transition: "width 0.3s",
                    }}
                  />
                </div>
                <div className="muted mono" style={{ fontSize: 10, marginTop: 4 }}>{filled}/{slots.length} slots</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function CERICEditor({ citekey, onBack, onSelectPaper, onPaperDeleted }: Props) {
  const [tab, setTab] = useState<"editor" | "collection" | "books" | "quick-notes" | "documentation" | "meeting-minutes">(citekey ? "editor" : "collection");
  const [slots, setSlots] = useState<AnalysisSlot[]>(() => getCachedAnalysisSlots());
  const [paper, setPaper] = useState<Paper | null>(null);
  const [form, setForm] = useState<Partial<PaperFrontmatter>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [examining, setExamining] = useState(false);
  const [examineResult, setExamineResult] = useState<string | null>(null);
  const [examineError, setExamineError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());
  const [combinedMsg, setCombinedMsg] = useState<string | null>(null);

  useEffect(() => {
    ensureAnalysisTags(() => api.analysisTags.get()).then(setSlots);
    const sync = () => setSlots(getCachedAnalysisSlots());
    window.addEventListener(ANALYSIS_TAGS_EVENT, sync);
    return () => window.removeEventListener(ANALYSIS_TAGS_EVENT, sync);
  }, []);

  function toggleSlot(key: string) {
    setExpandedSlots((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function flashCombinedMsg(text: string) {
    setCombinedMsg(text);
    setTimeout(() => setCombinedMsg(null), 2500);
  }

  useEffect(() => {
    if (!citekey) return;
    setTab("editor");
    api.papers.get(citekey).then((p) => {
      setPaper(p);
      setForm(p.frontmatter);
    });
  }, [citekey]);

  const setField = useCallback((key: string, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }, []);

  async function save() {
    if (!citekey) return;
    setSaving(true);
    await api.papers.update(citekey, form);
    const updated = await api.papers.get(citekey);
    setPaper(updated);
    setDirty(false);
    setSaving(false);
  }

  async function handleDeleteNote() {
    if (!citekey) return;
    const label = (form.title as string) || citekey;
    if (!window.confirm(`Delete note for “${label}”?\n\nThis removes vault/10-Papers/${citekey}.md permanently.`)) {
      return;
    }
    setDeleting(true);
    try {
      await api.papers.delete(citekey);
      setPaper(null);
      setForm({});
      setDirty(false);
      setTab("collection");
      onPaperDeleted?.();
    } catch (e) {
      setExamineError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function handleExamine() {
    if (!citekey) return;
    if (dirty) await save();
    setExamining(true);
    setExamineError(null);
    setExamineResult(null);
    try {
      const r = await api.examine(citekey, getActiveProviderPayload());
      setExamineResult(r.response);
      // Reload paper to show updated body with AI callout
      const updated = await api.papers.get(citekey);
      setPaper(updated);
    } catch (e: unknown) {
      const err = e as Error & { data?: { detail?: string; error?: string } };
      if ("status" in err && (err as { status: number }).status === 423) {
        setExamineError("Gate locked: " + (err.data?.detail || "fill all CERIC slots first"));
      } else {
        setExamineError(err.message || "Examine failed");
      }
    } finally {
      setExamining(false);
    }
  }

  const tabBar = (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <button className={`btn${tab === "editor" ? " btn-primary" : ""}`} onClick={() => setTab("editor")}>Editor</button>
      <button className={`btn${tab === "collection" ? " btn-primary" : ""}`} onClick={() => setTab("collection")}>Collection</button>
      <button className={`btn${tab === "books" ? " btn-primary" : ""}`} onClick={() => setTab("books")}>Books</button>
      <button className={`btn${tab === "quick-notes" ? " btn-primary" : ""}`} onClick={() => setTab("quick-notes")}>Quick Notes</button>
      <button className={`btn${tab === "documentation" ? " btn-primary" : ""}`} onClick={() => setTab("documentation")}>Documentation</button>
      <button className={`btn${tab === "meeting-minutes" ? " btn-primary" : ""}`} onClick={() => setTab("meeting-minutes")}>Meeting Minutes</button>
    </div>
  );

  if (tab === "collection") {
    return (
      <div>
        {tabBar}
        <CollectionTab
          slots={slots}
          onSelect={(ck) => { onSelectPaper?.(ck); }}
          onDeleted={(ck) => { if (ck === citekey) onPaperDeleted?.(); }}
        />
      </div>
    );
  }

  if (tab === "books") {
    return (
      <div className="books-tab-wrap">
        {tabBar}
        <BooksTab />
      </div>
    );
  }

  if (tab === "quick-notes" || tab === "documentation" || tab === "meeting-minutes") {
    return (
      <div>
        {tabBar}
        <MarkdownNotesTab
          section={tab === "quick-notes" ? "Quick Notes" : tab === "documentation" ? "Documentation" : "Meeting Minutes"}
        />
      </div>
    );
  }

  if (!citekey) {
    return (
      <div>
        {tabBar}
        <div className="muted">No paper selected — pick one from Collection or Daily ArXiv.</div>
      </div>
    );
  }
  if (!paper) {
    return (
      <div>
        {tabBar}
        <div className="muted">Loading…</div>
      </div>
    );
  }

  const fm = form;
  const gate = paper.gate;
  const allSlotsFilled = slots.every((s) => (fm[s.key] as string | undefined)?.trim());
  const aqWritten = Boolean(fm.aq_written);

  return (
    <div>
      {tabBar}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button className="btn" onClick={onBack}>← Daily ArXiv</button>
        <h1 style={{ margin: 0, flex: 1 }}>
          {fm.title || citekey}
        </h1>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-crit" onClick={handleDeleteNote} disabled={deleting}>
          {deleting ? "…" : "Delete"}
        </button>
      </div>

      <div className="muted mono" style={{ fontSize: 12, marginBottom: 16 }}>
        {fm.authors?.slice(0, 4).join(", ")}{fm.authors && fm.authors.length > 4 ? " et al." : ""}{" "}
        {fm.year ? `(${fm.year})` : ""}
        {fm.arxiv ? ` · arXiv:${fm.arxiv}` : ""}
        {fm.doi ? ` · doi:${fm.doi}` : ""}
      </div>

      <GateIndicator gate={gate} />

      {/* ── Analysis slots — collapsed by default, click the header to expand ── */}
      {slots.map((slot) => {
        const val = (fm[slot.key] as string) || "";
        const filled = val.trim().length > 0;
        const open = expandedSlots.has(slot.key);
        return (
          <div key={slot.key} className={`slot-block${open ? " open" : ""}`} style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="slot-label slot-collapse-toggle"
              onClick={() => toggleSlot(slot.key)}
              aria-expanded={open}
            >
              <span className={`slot-collapse-caret${open ? " open" : ""}`}>▸</span>
              {slot.letter} — {slot.label}
              {filled && <span className="slot-collapse-dot" title="filled" />}
            </button>
            {open && (
              <textarea
                className={`slot-textarea${filled ? " filled" : ""}`}
                placeholder={`Write your ${slot.label.toLowerCase()} notes…`}
                value={val}
                onChange={(e) => setField(slot.key, e.target.value)}
                autoFocus
              />
            )}
          </div>
        );
      })}

      {/* ── Combined — auto-merges all slots for a quick copy/export ─── */}
      <div className="slot-block combined-block" style={{ marginBottom: 16 }}>
        <div className="slot-label">Combined</div>
        <div className="combined-preview mono">
          {slots.map((s) => ((fm[s.key] as string) || "").trim())
            .filter(Boolean)
            .join("\n\n") || <span className="muted">Fill in slots above to see the combined text here.</span>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button
            className="btn"
            onClick={async () => {
              const combined = slots.map((s) => `${s.label}: ${((fm[s.key] as string) || "").trim()}`)
                .filter((line) => !line.endsWith(": "))
                .join("\n\n");
              flashCombinedMsg((await copyToClipboard(combined)) ? "Copied combined analysis text" : "Copy failed — clipboard unavailable");
            }}
          >
            Copy
          </button>
          <button
            className="btn"
            onClick={async () => {
              flashCombinedMsg(
                (await copyToClipboard(paperLatexSnippet(fm, slots)))
                  ? "Copied LaTeX snippet — paste into any .tex file"
                  : "Copy failed — clipboard unavailable"
              );
            }}
          >
            Add to LaTeX
          </button>
          {combinedMsg && <span className="ok mono" style={{ fontSize: 12 }}>{combinedMsg}</span>}
        </div>
      </div>

      {/* ── Adversarial Question ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div className="slot-label">Adversarial Question</div>
        <textarea
          className={`slot-textarea${(fm.adversarial_question as string || "").trim() ? " filled" : ""}`}
          placeholder="What is the strongest objection to this paper's claim?"
          value={(fm.adversarial_question as string) || ""}
          onChange={(e) => setField("adversarial_question", e.target.value)}
          style={{ minHeight: 60 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={aqWritten}
            onChange={(e) => setField("aq_written", e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 12 }}>aq_written — mark when question is genuinely adversarial</span>
        </label>
      </div>

      {/* ── Metadata ────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Metadata</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            <div className="slot-label">Tier</div>
            <select value={fm.tier ?? 0} onChange={(e) => setField("tier", e.target.value)}>
              <option value={0}>0 — Skimmed</option>
              <option value={1}>1 — Full CERIC</option>
              <option value={2}>2 — Reproduced</option>
            </select>
          </label>
          <label>
            <div className="slot-label">Confidence (0–100)</div>
            <input
              type="number" min={0} max={100}
              value={fm.confidence ?? 0}
              onChange={(e) => setField("confidence", e.target.value)}
            />
          </label>
          <label>
            <div className="slot-label">Concepts (comma-separated)</div>
            <input
              type="text"
              value={((fm.concepts as string[]) || []).join(", ")}
              onChange={(e) => setField("concepts", e.target.value.split(",").map(s => s.trim()).filter(Boolean) as unknown as string)}
              placeholder="internal shocks, Lorentz factor, ..."
            />
          </label>
          <label>
            <div className="slot-label">Methods (comma-separated)</div>
            <input
              type="text"
              value={((fm.methods as string[]) || []).join(", ")}
              onChange={(e) => setField("methods", e.target.value.split(",").map(s => s.trim()).filter(Boolean) as unknown as string)}
              placeholder="spectral fitting, MCMC, ..."
            />
          </label>
        </div>
      </div>

      {/* ── /examine ────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <button
          className={`btn ${allSlotsFilled && aqWritten ? "btn-primary" : "btn-gate"}`}
          onClick={handleExamine}
          disabled={examining}
        >
          {examining ? "Examining…" : "/examine — Run AI analysis"}
        </button>
        {!allSlotsFilled || !aqWritten ? (
          <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
            Fill all {slots.length} slots and mark aq_written to unlock
          </span>
        ) : null}
      </div>

      {examineError && (
        <div className="card" style={{ borderColor: "var(--crit)", marginTop: 12 }}>
          <span className="crit">{examineError}</span>
        </div>
      )}

      {examineResult && (
        <div className="ai-callout" style={{ marginTop: 16 }}>
          <div className="ai-callout-label">AI · /examine</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{examineResult}</div>
        </div>
      )}
    </div>
  );
}
