import { useEffect, useMemo, useState } from "react";
import { reading, type ReadingBook } from "../../api/reading";
import "./books.css";

interface Props {
  /** LaTeX project folder (top-level folder under 70-LaTeX), "" for a loose file. */
  project: string;
  onClose: () => void;
  /** Called with the finished LaTeX once references.bib has been updated. */
  onInsert: (latex: string, count: number, bibPath: string) => void;
}

/** Pick Collection items whose notes you collected while reading, and turn them into LaTeX (quotes + citations). */
export default function NotesImportPicker({ project, onClose, onInsert }: Props) {
  const [items, setItems] = useState<ReadingBook[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pages, setPages] = useState(true);
  const [comments, setComments] = useState(true);
  const [heading, setHeading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    reading.library().then((l) => setItems(l.books.filter((b) => (b.note_count || 0) > 0))).catch((e) => setErr(e instanceof Error ? e.message : "Could not load your Collection"));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((b) => words.every((w) => [b.title, b.authors.join(" "), b.year || ""].join(" ").toLowerCase().includes(w)));
  }, [items, q]);

  async function insert() {
    if (picked.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const parts: string[] = [];
      let count = 0;
      let bib = "";
      for (const slug of picked) {
        const r = await reading.notesLatex(slug, { project, pages, comments, heading });
        parts.push(r.latex.trimEnd());
        count += r.count;
        if (r.citekey && project) bib = `${project}/references.bib`;
      }
      onInsert(parts.join("\n\n") + "\n", count, bib);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not build LaTeX from the notes");
      setBusy(false);
    }
  }

  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));

  return (
    <div className="bk-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bk-modal card ar-modal" role="dialog" aria-modal="true" aria-label="Import notes">
        <div className="bk-modal-head">
          <h2 style={{ margin: 0 }}>Import notes</h2>
          <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        <input autoFocus className="cp-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search books with saved notes…" aria-label="Search" />
        <div className="cp-list" role="listbox" aria-multiselectable="true">
          {shown.length === 0 && (
            <div className="muted" style={{ padding: 10 }}>
              {items.length === 0 ? "No notes yet. Open a book in Collection, select text and choose “→ Notes”." : "Nothing matches."}
            </div>
          )}
          {shown.map((b) => (
            <label key={b.slug} className={`cp-row${picked.includes(b.slug) ? " on" : ""}`} role="option" aria-selected={picked.includes(b.slug)}>
              <input type="checkbox" checked={picked.includes(b.slug)} onChange={() => toggle(b.slug)} />
              <span className="cp-main">
                <strong>{b.title}</strong>
                <span className="muted">{b.authors.slice(0, 3).join(", ")}{b.year ? ` · ${b.year}` : ""} · {b.note_count} note{b.note_count === 1 ? "" : "s"}</span>
              </span>
            </label>
          ))}
        </div>
        {err && <div className="bk-error" role="alert">{err}</div>}
        <div className="bk-modal-foot" style={{ flexWrap: "wrap" }}>
          <label><input type="checkbox" checked={heading} onChange={(e) => setHeading(e.target.checked)} /> Heading</label>
          <label><input type="checkbox" checked={pages} onChange={(e) => setPages(e.target.checked)} /> Page numbers</label>
          <label><input type="checkbox" checked={comments} onChange={(e) => setComments(e.target.checked)} /> My comments</label>
          <span style={{ flex: 1 }} className="muted">{picked.length} selected{project ? " · cites via references.bib" : ""}</span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void insert()} disabled={busy || picked.length === 0}>{busy ? "Building…" : "Insert"}</button>
        </div>
      </div>
    </div>
  );
}
