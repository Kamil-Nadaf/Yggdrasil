import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reading, type BookCollection, type NewItem } from "../api/reading";
import "./addToCollection.css";

/** The slice of an arXiv / OpenAlex / Europe PMC search hit this needs. */
export interface CollectablePaper {
  id: string;
  title: string;
  authors: string[];
  abstract?: string;
  arxiv_url?: string;
  pdf_url?: string;
  submitted?: string;
  source?: string;
  doi?: string;
}

const NEW_ARXIV = /^\d{4}\.\d{4,5}(v\d+)?$/;
const OLD_ARXIV = /^[a-z-]+(\.[A-Za-z]{2})?\/\d{7}(v\d+)?$/;

export function paperToItem(p: CollectablePaper, pdfUrl: string): NewItem {
  const isArxiv = (!p.source || p.source === "arxiv") && (NEW_ARXIV.test(p.id) || OLD_ARXIV.test(p.id));
  const doi = p.doi || (p.id.startsWith("10.") ? p.id : "");
  const year = parseInt((p.submitted || "").slice(0, 4), 10);
  return {
    title: p.title.replace(/\s+/g, " ").trim(),
    kind: "paper",
    authors: p.authors,
    year: Number.isFinite(year) ? year : null,
    item_type: isArxiv ? "preprint" : "article",
    arxiv: isArxiv ? p.id.replace(/v\d+$/, "") : "",
    doi,
    url: p.arxiv_url || (doi ? `https://doi.org/${doi}` : ""),
    pdf_url: pdfUrl,
    abstract: p.abstract || "",
    fetch_pdf: true,
  };
}

interface Props {
  paper: CollectablePaper;
  pdfUrl: string;
  /** Show a toast in the host view. */
  onResult?: (text: string, ok: boolean) => void;
  compact?: boolean;
}

/** "+ Collection" button with a collection picker. Saves the paper (and its PDF when reachable) into the Collection library. */
export default function AddToCollection({ paper, pdfUrl, onResult, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState<BookCollection[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState("");
  const [newName, setNewName] = useState("");
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => setSaved(false), [paper.id]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".atc-pop, .atc-btn")) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 268));
      setPos(r.bottom + 280 > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
    }
    setOpen(true);
    try { setCols((await reading.collections()).collections); } catch { setCols([]); }
  }

  async function save(collection?: string) {
    setBusy(true);
    setFailed("");
    try {
      const r = await reading.addItem({ ...paperToItem(paper, pdfUrl), collection });
      setSaved(true);
      setOpen(false);
      const where = collection ? ` → ${cols.find((c) => c.id === collection)?.name || "collection"}` : "";
      onResult?.(r.duplicate ? `Already in your Collection${where} ✓` : `Added to Collection${where}${r.pdf_saved ? " (PDF saved)" : ""} ✓`, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not add to Collection";
      setFailed(msg);
      setOpen(false);
      onResult?.(msg, false);
    } finally {
      setBusy(false);
    }
  }

  async function createAndSave() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const fresh = (await reading.collections()).collections;
      const next = [...fresh, { id, name, slugs: [] }];
      await reading.saveCollections(next);
      setCols(next);
      setNewName("");
      await save(id);
    } catch (e) {
      setBusy(false);
      onResult?.(e instanceof Error ? e.message : "Could not create the collection", false);
    }
  }

  return (
    <>
      <button ref={btn} type="button" className={`btn atc-btn${saved ? " atc-saved" : ""}${failed ? " atc-failed" : ""}`} onClick={toggle} aria-haspopup="menu" aria-expanded={open} title={failed || "Save to your Collection (library + PDF)"}>
        {busy ? "Saving…" : saved ? "✓ In Collection" : failed ? "⚠ Retry — failed" : compact ? "Collection" : "+ Collection"}
      </button>
      {open && createPortal(
        <div className="atc-pop card" role="menu" style={pos} onClick={(e) => e.stopPropagation()}>
          <div className="atc-label">Save to…</div>
          <button type="button" role="menuitem" disabled={busy} onClick={() => void save()}>Library only (no collection)</button>
          {cols.length > 0 && <div className="atc-sep" />}
          {cols.map((c) => (
            <button key={c.id} type="button" role="menuitem" disabled={busy} onClick={() => void save(c.id)}>
              {c.name}<span className="muted">{c.slugs.length}</span>
            </button>
          ))}
          <div className="atc-sep" />
          <form onSubmit={(e) => { e.preventDefault(); void createAndSave(); }} className="atc-new">
            <input value={newName} maxLength={80} placeholder="New collection…" aria-label="New collection name" onChange={(e) => setNewName(e.target.value)} />
            <button type="submit" disabled={busy || !newName.trim()}>Create</button>
          </form>
        </div>,
        document.body
      )}
    </>
  );
}
