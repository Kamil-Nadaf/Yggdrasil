import { useState } from "react";
import { api, type ArxivPaper } from "../api/client";

export const CERIC_SLOTS = [
  { key: "claim", letter: "C", label: "Claim" },
  { key: "evidence", letter: "E", label: "Evidence" },
  { key: "reasoning", letter: "R", label: "Reasoning" },
  { key: "implications", letter: "I", label: "Implications" },
  { key: "context", letter: "C", label: "Context" },
] as const;

export type CericSlotKey = (typeof CERIC_SLOTS)[number]["key"];
export type CericStatus = Partial<Record<CericSlotKey, boolean>>;

export function SlotIndicator({ status }: { status?: CericStatus }) {
  return (
    <span className="arxiv-slot-indicator">
      {CERIC_SLOTS.map((s, i) => (
        <span key={i} className={status?.[s.key] ? "filled" : ""}>
          {s.letter}{status?.[s.key] ? "✓" : "·"}
        </span>
      ))}
    </span>
  );
}

/**
 * Shared "select text → push into a CERIC slot" behavior, used by both the
 * Daily ArXiv reading pane and the Search view's result cards. A single
 * `window.getSelection()` is browser-wide, so we track which paper the current
 * selection belongs to (`selectionPaperId`) alongside the text itself.
 */
export function useCericAppend(showToast: (text: string, ok: boolean) => void) {
  const [cericStatus, setCericStatus] = useState<Record<string, CericStatus>>({});
  const [selectedText, setSelectedText] = useState("");
  const [selectionPaperId, setSelectionPaperId] = useState<string | null>(null);
  const [addingSlot, setAddingSlot] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  async function refreshCericStatus(citekey: string) {
    try {
      const p = await api.papers.get(citekey);
      const status: CericStatus = {};
      for (const s of CERIC_SLOTS) status[s.key] = Boolean((p.frontmatter[s.key] as string || "").trim());
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
      const label = CERIC_SLOTS.find((s) => s.key === slotKey)?.label || slotKey;
      showToast(`Added to ${label} ✓`, true);
      await refreshCericStatus(paper.id);
      setFlashId(paper.id);
      setTimeout(() => setFlashId(null), 900);
      clearSelection();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add to CERIC", false);
    } finally {
      setAddingSlot(null);
    }
  }

  return {
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
}: {
  selectedText: string;
  addingSlot: string | null;
  onAdd: (slotKey: string) => void;
}) {
  return (
    <div className="arxiv-ceric-toolbar">
      <span className="arxiv-ceric-toolbar-preview">
        "{selectedText.length > 60 ? selectedText.slice(0, 60) + "…" : selectedText}"
      </span>
      <span className="arxiv-ceric-toolbar-label">Add to:</span>
      {CERIC_SLOTS.map((s) => (
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
