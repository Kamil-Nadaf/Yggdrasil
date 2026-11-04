import { useEffect, useRef, useState } from "react";
import { reading, type ReadingNote } from "../../api/reading";

interface Props {
  slug: string;
  notes: ReadingNote[];
  onChange: (notes: ReadingNote[]) => void;
  onJump?: (n: ReadingNote) => void;
  onClose: () => void;
}

/** Quotes collected while reading a book. Each can carry your own comment; the whole set imports into a LaTeX document. */
export default function BookNotesPanel({ slug, notes, onChange, onJump, onClose }: Props) {
  const [msg, setMsg] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function flash(t: string) {
    setMsg(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 2500);
  }

  async function persist(next: ReadingNote[]) {
    onChange(next);
    try { await reading.saveNotes(slug, next); } catch { flash("Couldn’t save notes"); }
  }

  async function copy(kind: "md" | "tex") {
    try {
      const text = kind === "md"
        ? (await reading.notesMarkdown(slug)).markdown
        : (await reading.notesLatex(slug, {})).latex;
      await navigator.clipboard.writeText(text);
      flash(kind === "md" ? "Markdown copied" : "LaTeX copied");
    } catch {
      flash("Copy failed");
    }
  }

  return (
    <aside className="bk-notes" aria-label="Book notes">
      <div className="bk-notes-head">
        <strong>Book notes ({notes.length})</strong>
        <span className="bk-notes-actions">
          <button type="button" className="btn" disabled={!notes.length} onClick={() => void copy("md")}>Copy MD</button>
          <button type="button" className="btn" disabled={!notes.length} onClick={() => void copy("tex")}>Copy LaTeX</button>
          <button type="button" className="btn" onClick={onClose} aria-label="Close notes">×</button>
        </span>
      </div>
      {msg && <div className="bk-notes-msg">{msg}</div>}
      {notes.length === 0 ? (
        <p className="muted bk-notes-empty">
          Select text in the book and choose <b>→ Notes</b>. Your quotes collect here, and the LaTeX editor’s <b>Import notes</b> turns them into a document with citations.
        </p>
      ) : (
        <ul className="bk-notes-list">
          {notes.map((n) => (
            <li key={n.id}>
              <blockquote onClick={() => onJump?.(n)} title={onJump ? "Jump to this passage" : undefined}>{n.text}</blockquote>
              <div className="bk-note-meta">
                {n.page ? <span>p. {n.page}</span> : <span />}
                <button type="button" className="btn" onClick={() => void persist(notes.filter((x) => x.id !== n.id))} aria-label="Delete note">Delete</button>
              </div>
              <textarea
                defaultValue={n.comment}
                placeholder="Your comment (optional)…"
                rows={2}
                onBlur={(e) => {
                  if (e.target.value !== n.comment) void persist(notes.map((x) => (x.id === n.id ? { ...x, comment: e.target.value } : x)));
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
