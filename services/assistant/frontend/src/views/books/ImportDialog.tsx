import { useEffect, useRef, useState } from "react";
import { reading, type NewItem, type ReadingBook } from "../../api/reading";
import { findIdentifier, probePdf, titleFromFilename, type PdfProbe } from "../../lib/bookFiles";

interface Props {
  onClose: () => void;
  onImported: (book: ReadingBook) => void;
  /** Attach the file to an existing book instead of creating a new one. */
  attachTo?: ReadingBook | null;
}

export default function ImportDialog({ onClose, onImported, attachTo = null }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [probe, setProbe] = useState<PdfProbe | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [found, setFound] = useState<NewItem | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function choose(f: File | null | undefined) {
    if (!f) return;
    if (!/\.(pdf|epub)$/i.test(f.name)) {
      setErr("Choose a .pdf or .epub file.");
      return;
    }
    setErr("");
    setFile(f);
    setProbe(null);
    setPreviewUrl("");
    setFound(null);
    if (!attachTo) setTitle((t) => t || titleFromFilename(f.name));
    if (/\.pdf$/i.test(f.name)) {
      const p = await probePdf(f);
      setProbe(p);
      if (p?.cover) setPreviewUrl(URL.createObjectURL(p.cover));
      if (p && !attachTo) {
        setTitle((t) => (t && t !== titleFromFilename(f.name) ? t : p.title || t));
        setAuthors((a) => a || p.author);
      }
      if (!attachTo) {
        // A DOI / arXiv id on the first pages identifies the paper: fetch its real metadata.
        const id = await findIdentifier(f);
        if (id) {
          try {
            const { item } = await reading.lookup(id.doi || id.arxiv || "");
            setFound({ ...item, doi: item.doi || id.doi, arxiv: item.arxiv || id.arxiv });
            setTitle(item.title || "");
            setAuthors((item.authors || []).join("; "));
            setYear(item.year ? String(item.year) : "");
          } catch {
            /* offline or unknown id: keep what the file says */
          }
        }
      }
    }
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      let book: ReadingBook;
      if (attachTo) {
        book = (await reading.attachFile(attachTo.slug, file)).book;
      } else {
        book = (await reading.importBook(file, { title: title.trim(), authors: authors.trim(), year: year.trim() }, probe?.cover)).book;
      }
      if (probe?.pages) {
        book = (await reading.patch(book.slug, { total_pages: probe.pages })).book;
      }
      if (found && !attachTo) {
        book = (await reading.patch(book.slug, {
          kind: "paper", item_type: found.item_type, venue: found.venue || "", doi: found.doi || "", arxiv: found.arxiv || "", url: found.url || "",
          publisher: found.publisher || "", volume: found.volume || "", issue: found.issue || "", pages: found.pages || "", abstract: found.abstract || "",
        })).book;
      }
      onImported(book);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
    }
  }

  return (
    <div className="bk-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="bk-modal card" role="dialog" aria-modal="true" aria-label={attachTo ? "Attach a book file" : "Import a book"}>
        <div className="bk-modal-head">
          <h2 style={{ margin: 0 }}>{attachTo ? `Attach a file to “${attachTo.title}”` : "Import a book"}</h2>
          <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <div
          className={`bk-drop${drag ? " over" : ""}${file ? " has-file" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files?.[0]); }}
        >
          {previewUrl && <img className="bk-drop-cover" src={previewUrl} alt="First page preview" />}
          <div className="bk-drop-body">
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span className="muted">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB{probe?.pages ? ` · ${probe.pages} pages` : ""}
                </span>
              </>
            ) : (
              <>
                <strong>Drop a PDF or EPUB here</strong>
                <span className="muted">or choose a file from your computer</span>
              </>
            )}
            <button type="button" className="btn" onClick={() => input.current?.click()}>{file ? "Choose another" : "Choose file"}</button>
            <input ref={input} type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" hidden onChange={(e) => void choose(e.target.files?.[0])} />
          </div>
        </div>

        {found && !attachTo && <div className="bk-notice" role="status">Paper recognised{found.doi ? ` (DOI ${found.doi})` : found.arxiv ? ` (arXiv:${found.arxiv})` : ""} — details filled in; it will be filed as a paper.</div>}
        {!attachTo && (
          <div className="bk-form">
            <label>
              <span className="muted">Title</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Taken from the file when left blank (EPUB)" />
            </label>
            <label>
              <span className="muted">Authors</span>
              <input type="text" value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Separate several with “;”" />
            </label>
            <label style={{ maxWidth: 120 }}>
              <span className="muted">Year</span>
              <input type="text" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} />
            </label>
          </div>
        )}

        {err && <div className="bk-error" role="alert">{err}</div>}

        <div className="bk-modal-foot">
          <span className="muted" style={{ fontSize: 12 }}>The file is stored in your vault under 15-Books, so it syncs with the rest of your notes.</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={!file || busy}>
            {busy ? "Importing…" : attachTo ? "Attach" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
