import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * "Tags" button for the Notes workspaces. Opens a popover with the note's
 * current tags (removable chips), a box to add tags by hand, and an Auto-tag
 * action that extracts keywords from the note. Tags live in the note's
 * frontmatter, which the indexer embeds so Loki can match on them.
 */
export default function NoteTagsButton({
  tags,
  disabled,
  busy,
  onAdd,
  onRemove,
  onAuto,
}: {
  tags: string[];
  disabled?: boolean;
  busy?: boolean;
  onAdd: (raw: string) => void;
  onRemove: (tag: string) => void;
  onAuto: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const width = 320;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    setPos({ top: r.bottom + 6, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function commit() {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Tag this note so Loki can find it"
        onClick={() => setOpen((v) => !v)}
      >
        Tags{tags.length ? ` (${tags.length})` : ""}
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="note-tags-pop" style={{ top: pos.top, left: pos.left, width }} role="dialog" aria-label="Note tags">
            <div className="note-tags-head">
              <span className="mono">Tags</span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={onAuto}>
                {busy ? "Tagging…" : "Auto-tag"}
              </button>
            </div>
            <div className="note-tags-list">
              {tags.length === 0 && <span className="note-tags-empty">No tags yet — press Auto-tag or add your own.</span>}
              {tags.map((t) => (
                <span key={t} className="note-tag">
                  {t}
                  <button type="button" aria-label={`Remove ${t}`} onClick={() => onRemove(t)}>×</button>
                </span>
              ))}
            </div>
            <input
              className="note-tags-input"
              type="text"
              placeholder="Add tag, press Enter (comma for several)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
            />
            <div className="note-tags-hint">Auto-tag keeps your own tags and saves the note. Manual changes apply on Save.</div>
          </div>,
          document.body
        )}
    </>
  );
}
