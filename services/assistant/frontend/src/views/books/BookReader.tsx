import { useEffect, useMemo, useRef, useState } from "react";
import { reading, type ReadingBook, type ReadingNote } from "../../api/reading";
import type { ArxivPaper } from "../../api/client";
import PdfViewer, { type PdfDoc } from "../../components/PdfViewer";
import ReadingTimerChip from "../../components/ReadingTimerChip";
import BookIcon from "../../components/BookIcons";
import EpubReader from "./EpubReader";
import BookNotesPanel from "./BookNotesPanel";

/** An arXiv id (new `2301.01234` or old `hep-th/9901001` style) found anywhere in the field. */
export function arxivIdOf(raw: string): string {
  const m = (raw || "").match(/(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/);
  return m ? m[1] : "";
}

interface Props {
  book: ReadingBook;
  onBack: () => void;
  onChanged: () => void;
  /** Open the previous (-1) / next (+1) item of the list being browsed; undefined when there is none. */
  onPrev?: () => void;
  onNext?: () => void;
}

export default function BookReader({ book, onBack, onChanged, onPrev, onNext }: Props) {
  const pageRef = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState(book.status);
  const startPage = useRef(book.last_page || 1);
  const arxiv = arxivIdOf(book.arxiv);
  // Papers (arXiv id, or saved as a paper) get CERIC; books get a notes list instead.
  const isPaper = Boolean(arxiv) || book.kind === "paper";
  const [notes, setNotes] = useState<ReadingNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (isPaper) return;
    let live = true;
    reading.notes(book.slug).then((r) => { if (live) setNotes(r.notes || []); }).catch(() => {});
    return () => { live = false; };
  }, [book.slug, isPaper]);

  async function addNote(text: string, page: number | null, loc = "") {
    const r = await reading.addNote(book.slug, { text, page, loc });
    setNotes((n) => [...n, r.note]);
    onChanged();
  }

  useEffect(() => {
    // Opening a book moves it to "Reading" unless it is finished.
    if (book.status === "want") {
      setStatus("reading");
      void reading.patch(book.slug, { status: "reading" }).catch(() => {});
    }
    return () => window.clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.slug]);

  const doc = useMemo<PdfDoc>(
    () => ({
      url: reading.fileUrl(book.slug),
      title: book.title,
      key: `book-${book.slug}`,
      initialPage: startPage.current,
      embedded: true,
      ...(isPaper
        ? {
            paper: {
              id: arxiv ? arxiv.replace("/", "_") : book.citekey || book.slug,
              title: book.title,
              authors: book.authors,
              abstract: book.abstract || "",
              arxiv_url: arxiv ? `https://arxiv.org/abs/${arxiv}` : book.url || "",
              pdf_url: reading.fileUrl(book.slug),
              categories: [],
              submitted: book.year ? `${book.year}-01-01` : "",
              source: "collection",
            } as ArxivPaper,
          }
        : { notes: { add: (text: string, page: number) => addNote(text, page) } }),
      onPage: (page, total) => {
        pageRef.current = page;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void reading
            .patch(book.slug, { last_page: page, total_pages: total, progress: total > 1 ? Math.min(1, (page - 1) / (total - 1)) : 0 })
            .catch(() => {});
        }, 1200);
      },
    }),
    [book.slug, book.title, isPaper, arxiv]
  );

  async function toggleFinished() {
    const next = status === "finished" ? "reading" : "finished";
    setStatus(next);
    try {
      await reading.patch(book.slug, { status: next });
      onChanged();
    } catch {
      setStatus(status);
    }
  }

  const authors = book.authors.length ? ` — ${book.authors.join(", ")}` : "";
  const lead = (
    <>
      <button type="button" className="pdfv-ib" onClick={onBack} title="Back to library" aria-label="Back to library"><BookIcon name="arrowleft" size={18} /></button>
      <button type="button" className="pdfv-ib" onClick={onPrev} disabled={!onPrev} title="Previous item in this list" aria-label="Previous item"><BookIcon name="up" size={17} /></button>
      <button type="button" className="pdfv-ib" onClick={onNext} disabled={!onNext} title="Next item in this list" aria-label="Next item"><BookIcon name="down" size={17} /></button>
    </>
  );
  const trail = (
    <>
      {!isPaper && (
        <button type="button" className={`pdfv-ib${notesOpen ? " on" : ""}`} onClick={() => setNotesOpen((v) => !v)} title={`Book notes (${notes.length}) — quotes you sent with “→ Notes”`} aria-label="Book notes">
          <BookIcon name="quote" size={17} />{notes.length > 0 && <em className="pdfv-badge">{notes.length}</em>}
        </button>
      )}
      <ReadingTimerChip slug={book.slug} pageRef={pageRef} />
      <button type="button" className={`pdfv-ib${status === "finished" ? " done" : ""}`} onClick={() => void toggleFinished()} aria-pressed={status === "finished"}
        title={status === "finished" ? "Finished — click to mark as reading again" : "Mark as finished"}>
        <BookIcon name="finished" size={18} />
      </button>
    </>
  );

  return (
    <div className="bk-reader">
      <div className="bk-reader-body">
        {!book.has_file ? (
          <div className="bk-empty-wrap">
            <div className="pdfv-topbar">{lead}<span className="pdfv-tb-title" title={book.title + authors}>{book.title}</span></div>
            <div className="bk-empty muted">This book has no file yet. Go back and choose “Attach file…” from its ⋯ menu.</div>
          </div>
        ) : book.format === "epub" ? (
          <EpubReader book={book} pageRef={pageRef} lead={lead} trail={trail} onToNotes={isPaper ? undefined : (text, loc) => addNote(text, null, loc)} />
        ) : (
          <PdfViewer doc={doc} onClose={onBack} lead={lead} trail={trail} />
        )}
        {!isPaper && notesOpen && (
          <BookNotesPanel slug={book.slug} notes={notes} onChange={setNotes} onClose={() => setNotesOpen(false)} />
        )}
      </div>
    </div>
  );
}
