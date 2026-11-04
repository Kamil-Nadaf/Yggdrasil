import { useEffect, useRef, useState } from "react";
import { ITEM_TYPES, reading, type ItemType, type ReadingBook } from "../../api/reading";

interface Props {
  collectionId?: string;
  onClose: () => void;
  onAdded: (book: ReadingBook | null, message: string) => void;
}

const blank = { title: "", authors: "", year: "", venue: "", doi: "", arxiv: "", url: "", publisher: "", volume: "", issue: "", pages: "", abstract: "" };

/** Add a reference by DOI / arXiv id / manual entry, or import a BibTeX / RIS file. */
export default function AddReference({ collectionId, onClose, onAdded }: Props) {
  const [mode, setMode] = useState<"one" | "bulk">("one");
  const [ident, setIdent] = useState("");
  const [type, setType] = useState<ItemType>("article");
  const [f, setF] = useState(blank);
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function lookup() {
    if (!ident.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const { item } = await reading.lookup(ident);
      setType(item.item_type || "article");
      setF({
        title: item.title || "", authors: (item.authors || []).join("; "), year: item.year ? String(item.year) : "", venue: item.venue || "", doi: item.doi || "",
        arxiv: item.arxiv || "", url: item.url || "", publisher: item.publisher || "", volume: item.volume || "", issue: item.issue || "", pages: item.pages || "", abstract: item.abstract || "",
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveOne() {
    if (!f.title.trim()) { setErr("A title is required."); return; }
    setBusy(true);
    setErr("");
    try {
      const yr = parseInt(f.year, 10);
      const r = await reading.addItem({
        title: f.title, kind: type === "book" ? "book" : "paper", item_type: type,
        authors: f.authors.split(/;|\n|\s+and\s+/).map((a) => a.trim()).filter(Boolean),
        year: Number.isFinite(yr) ? yr : null, venue: f.venue, doi: f.doi.trim(), arxiv: f.arxiv.trim(), url: f.url.trim(), publisher: f.publisher,
        volume: f.volume, issue: f.issue, pages: f.pages, abstract: f.abstract, collection: collectionId, fetch_pdf: true,
      });
      onAdded(r.book, r.duplicate ? "That reference is already in your Collection." : r.pdf_saved ? "Added — PDF saved too." : "Added.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the reference");
      setBusy(false);
    }
  }

  async function saveBulk() {
    if (!bulk.trim()) { setErr("Paste BibTeX / RIS text or choose a file."); return; }
    setBusy(true);
    setErr("");
    try {
      const r = await reading.importRefs(bulk, collectionId);
      onAdded(null, `Imported ${r.added} reference${r.added === 1 ? "" : "s"}${r.duplicates ? ` (${r.duplicates} already in your library)` : ""}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
    }
  }

  return (
    <div className="bk-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bk-modal card ar-modal" role="dialog" aria-modal="true" aria-label="Add reference">
        <div className="bk-modal-head">
          <h2>Add reference</h2>
          <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        <div className="ar-tabs" role="tablist">
          <button type="button" role="tab" className={mode === "one" ? "on" : ""} aria-selected={mode === "one"} onClick={() => { setMode("one"); setErr(""); }}>By identifier / manual</button>
          <button type="button" role="tab" className={mode === "bulk" ? "on" : ""} aria-selected={mode === "bulk"} onClick={() => { setMode("bulk"); setErr(""); }}>Import BibTeX / RIS</button>
        </div>

        {mode === "one" ? (
          <>
            <form className="ar-lookup" onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
              <input autoFocus value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="DOI, arXiv id, or any article web address — e.g. 1706.03762" aria-label="DOI or arXiv id" />
              <button type="submit" className="btn" disabled={busy || !ident.trim()}>Look up</button>
            </form>
            <div className="ar-grid">
              <label className="ar-wide"><span>Type</span>
                <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>{ITEM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              </label>
              <label className="ar-wide"><span>Title</span><input value={f.title} onChange={set("title")} /></label>
              <label className="ar-wide"><span>Authors <em className="muted">(separate with “;”)</em></span><input value={f.authors} onChange={set("authors")} /></label>
              <label><span>Year</span><input value={f.year} onChange={set("year")} inputMode="numeric" /></label>
              <label><span>{type === "book" ? "Series" : type === "conference" ? "Proceedings" : "Journal / venue"}</span><input value={f.venue} onChange={set("venue")} /></label>
              <label><span>DOI</span><input value={f.doi} onChange={set("doi")} /></label>
              <label><span>arXiv id</span><input value={f.arxiv} onChange={set("arxiv")} /></label>
              <label className="ar-wide"><span>URL</span><input value={f.url} onChange={set("url")} /></label>
              <label><span>Publisher</span><input value={f.publisher} onChange={set("publisher")} /></label>
              <label><span>Volume / issue / pages</span>
                <span className="ar-triple"><input value={f.volume} onChange={set("volume")} placeholder="vol" /><input value={f.issue} onChange={set("issue")} placeholder="no" /><input value={f.pages} onChange={set("pages")} placeholder="pp" /></span>
              </label>
              <label className="ar-wide"><span>Abstract</span><textarea rows={3} value={f.abstract} onChange={set("abstract")} /></label>
            </div>
            <p className="muted ar-hint">With an arXiv id the PDF is downloaded into your library automatically. You can also attach a PDF later.</p>
          </>
        ) : (
          <>
            <p className="muted">Paste BibTeX or RIS (exports from Zotero, Mendeley, Google Scholar, ADS, journals…) or choose a file. Existing items are skipped.</p>
            <textarea className="ar-bulk" rows={9} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="@article{key, title={…}, author={…}, …}" aria-label="BibTeX or RIS" />
            <input ref={file} type="file" accept=".bib,.bibtex,.ris,.txt" hidden onChange={async (e) => { const t = await e.target.files?.[0]?.text(); if (t) setBulk(t); e.target.value = ""; }} />
            <button type="button" className="btn" onClick={() => file.current?.click()}>Choose file…</button>
          </>
        )}

        {err && <div className="bk-error" role="alert">{err}</div>}
        <div className="bk-modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void (mode === "one" ? saveOne() : saveBulk())}>{busy ? "Working…" : mode === "one" ? "Add" : "Import"}</button>
        </div>
      </div>
    </div>
  );
}
