import { useEffect, useState } from "react";
import { api, type ArxivPaper } from "../api/client";
import {
  ANALYSIS_TAGS_EVENT,
  ensureAnalysisTags,
  getCachedAnalysisSlots,
  type AnalysisSlot,
} from "../lib/analysisTags";

export type CericStatus = Record<string, boolean>;

export function SlotIndicator({
  status,
  slots,
}: {
  status?: CericStatus;
  slots?: AnalysisSlot[];
}) {
  const list = slots || getCachedAnalysisSlots();
  return (
    <span className="arxiv-slot-indicator">
      {list.map((s, i) => (
        <span key={`${s.key}-${i}`} className={status?.[s.key] ? "filled" : ""}>
          {s.letter}{status?.[s.key] ? "✓" : "·"}
        </span>
      ))}
    </span>
  );
}

/**
 * Shared "select text → push into an analysis slot" behavior, used by both the
 * Daily ArXiv reading pane and the Search view's result cards.
 */
export function useCericAppend(showToast: (text: string, ok: boolean) => void) {
  const [slots, setSlots] = useState<AnalysisSlot[]>(() => getCachedAnalysisSlots());
  const [cericStatus, setCericStatus] = useState<Record<string, CericStatus>>({});
  const [selectedText, setSelectedText] = useState("");
  const [selectionPaperId, setSelectionPaperId] = useState<string | null>(null);
  const [addingSlot, setAddingSlot] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    ensureAnalysisTags(() => api.analysisTags.get()).then(setSlots);
    const sync = () => setSlots(getCachedAnalysisSlots());
    window.addEventListener(ANALYSIS_TAGS_EVENT, sync);
    return () => window.removeEventListener(ANALYSIS_TAGS_EVENT, sync);
  }, []);

  async function refreshCericStatus(citekey: string) {
    try {
      const p = await api.papers.get(citekey);
      const status: CericStatus = {};
      for (const s of slots) status[s.key] = Boolean((p.frontmatter[s.key] as string || "").trim());
      setCericStatus((prev) => ({ ...prev, [citekey]: status }));
    } catch {
      setCericStatus((prev) => ({ ...prev, [citekey]: {} }));
    }
  }

  function handleTextSelect(paperId: string) {
    const sel = window.getSelection()?.toString().trim() || "";
    setSelectedText(sel);
    setSelectionPaperId(sel ? paperId : null);
  }

  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    setSelectedText("");
    setSelectionPaperId(null);
  }

  async function addSelectionToSlot(paper: ArxivPaper, slotKey: string) {
    if (!selectedText) return;
    setAddingSlot(slotKey);
    try {
      const year = paper.submitted ? String(new Date(paper.submitted).getFullYear()) : undefined;
      await api.papers.appendSlot(paper.id, slotKey, selectedText, {
        title: paper.title,
        authors: paper.authors,
        arxiv: paper.id,
        year,
      });
      const label = slots.find((s) => s.key === slotKey)?.label || slotKey;
      showToast(`Added to ${label} ✓`, true);
      await refreshCericStatus(paper.id);
      setFlashId(paper.id);
      setTimeout(() => setFlashId(null), 900);
      clearSelection();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add to analysis slot", false);
    } finally {
      setAddingSlot(null);
    }
  }

  return {
    slots,
    cericStatus,
    selectedText,
    selectionPaperId,
    addingSlot,
    flashId,
    handleTextSelect,
    addSelectionToSlot,
    refreshCericStatus,
    clearSelection,
  };
}

export function CericSelectionToolbar({
  selectedText,
  addingSlot,
  onAdd,
  slots,
}: {
  selectedText: string;
  addingSlot: string | null;
  onAdd: (slotKey: string) => void;
  slots?: AnalysisSlot[];
}) {
  const list = slots || getCachedAnalysisSlots();
  return (
    <div className="arxiv-ceric-toolbar">
      <span className="arxiv-ceric-toolbar-preview">
        "{selectedText.length > 60 ? selectedText.slice(0, 60) + "…" : selectedText}"
      </span>
      <span className="arxiv-ceric-toolbar-label">Add to:</span>
      {list.map((s) => (
        <button
          key={s.key}
          className="btn"
          disabled={addingSlot === s.key}
          onClick={() => onAdd(s.key)}
          title={s.label}
        >
          {addingSlot === s.key ? "…" : s.letter}
        </button>
      ))}
    </div>
  );
}

/** @deprecated Use getCachedAnalysisSlots — kept for import compatibility */
export const CERIC_SLOTS = getCachedAnalysisSlots();
