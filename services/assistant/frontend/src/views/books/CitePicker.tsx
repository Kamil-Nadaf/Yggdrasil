import { useEffect, useMemo, useState } from "react";
import { reading, type ReadingBook } from "../../api/reading";
import "./books.css";

export type CiteCommand = "\\citep" | "\\citet" | "\\cite";

interface Props {
  /** LaTeX project folder (top-level folder under 70-LaTeX), "" for a loose file. */
  project: string;
  onClose: () => void;
  /** Called with the final citekeys once references.bib has been updated. */
  onInsert: (keys: string[], command: CiteCommand, bibPath: string) => void;
}

/** Pick papers from the Collection to cite: writes them to the project's references.bib and returns the keys. */
export default function CitePicker({ project, onClose, onInsert }: Props) {
  const [items, setItems] = useState<ReadingBook[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [cmd, setCmd] = useState<CiteCommand>("\\citep");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    reading.library().then((l) => setItems(l.books)).catch((e) => setErr(e instanceof Error ? e.message : "Could not load your Collection"));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((b) => words.every((w) => [b.title, b.authors.join(" "), b.year || "", b.venue, b.tags.join(" "), b.citekey].join(" ").toLowerCase().includes(w)))
      .sort((a, b) => Number(b.kind === "paper") - Number(a.kind === "paper") || a.title.localeCompare(b.title));
  }, [items, q]);

  async function insert() {
    if (picked.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const r = await reading.latexBib(project, picked);
      onInsert(picked.map((s) => r.keys[s]).filter(Boolean), cmd, r.path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update references.bib");
      setBusy(false);
    }
  }

  const toggle = (slug: string) => setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));

  return (
    <div className="bk-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bk-modal card ar-modal" role="dialog" aria-modal="true" aria-label="Insert citation">
        <div className="bk-modal-head">
          <h2 style={{ margin: 0 }}>Insert citation</h2>
          <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        <input autoFocus className="cp-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your Collection by title, author, year, tag…" aria-label="Search your Collection" />
        <div className="cp-list" role="listbox" aria-multiselectable="true">
          {shown.length === 0 && <div className="muted" style={{ padding: 10 }}>{items.length === 0 ? "Your Collection is empty — add papers from Papers → “+ Collection”." : "Nothing matches."}</div>}
          {shown.map((b) => (
            <label key={b.slug} className={`cp-row${picked.includes(b.slug) ? " on" : ""}`} role="option" aria-selected={picked.includes(b.slug)}>
              <input type="checkbox" checked={picked.includes(b.slug)} onChange={() => toggle(b.slug)} />
              <span className="cp-main"><strong>{b.title}</strong><span className="muted">{b.authors.slice(0, 3).join(", ")}{b.authors.length > 3 ? " et al." : ""}{b.year ? ` · ${b.year}` : ""}{b.venue ? ` · ${b.venue}` : ""}</span></span>
            </label>
          ))}
        </div>
        {err && <div className="bk-error" role="alert">{err}</div>}
        <div className="bk-modal-foot">
          <select value={cmd} onChange={(e) => setCmd(e.target.value as CiteCommand)} aria-label="Citation command">
            <option value="\citep">\citep (Author, Year)</option>
            <option value="\citet">\citet (Author (Year))</option>
            <option value="\cite">\cite</option>
          </select>
          <span style={{ flex: 1 }} className="muted">{picked.length} selected · saved to references.bib</span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void insert()} disabled={busy || picked.length === 0}>{busy ? "Adding…" : "Insert"}</button>
        </div>
      </div>
    </div>
  );
}
