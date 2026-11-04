import { useEffect, useMemo, useRef, useState } from "react";
import { reading, type ReadingBook, type ReadingNote } from "../../api/reading";
import type { ArxivPaper } from "../../api/client";
import PdfViewer, { type PdfDoc } from "../../components/PdfViewer";
import ReadingTimerChip from "../../components/ReadingTimerChip";
import { useCollapsed } from "../../lib/useCollapsed";
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
}

export default function BookReader({ book, onBack, onChanged }: Props) {
  const pageRef = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState(book.status);
  const startPage = useRef(book.last_page || 1);
  const arxiv = arxivIdOf(book.arxiv);
  // Papers (arXiv id, or saved as a paper) get CERIC; books get a notes list instead.
  const isPaper = Boolean(arxiv) || book.kind === "paper";
  const [notes, setNotes] = useState<ReadingNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [barSlim, toggleBar] = useCollapsed("reader-bar");

  useEffect(() => {
    if (isPaper) return;
    let live = true;
    reading.notes(book.slug).then((r) => { if (live) setNotes(r.notes); }).catch(() => {});
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

  return (
    <div className="bk-reader">
      <div className={`bk-reader-bar${barSlim ? " slim" : ""}`}>
        <button type="button" className="btn" onClick={onBack}>← Library</button>
        <div className="bk-reader-title" title={book.title}>
          <strong>{book.title}</strong>
          {book.authors.length > 0 && <span className="muted"> · {book.authors.join(", ")}</span>}
        </div>
        {!isPaper && (
          <button type="button" className={`btn${notesOpen ? " btn-primary" : ""}`} onClick={() => setNotesOpen((v) => !v)}>
            Book notes ({notes.length})
          </button>
        )}
        {/* The timer keeps logging reading time even while the bar is collapsed. */}
        <span className="bk-reader-extra"><ReadingTimerChip slug={book.slug} pageRef={pageRef} /></span>
        <button type="button" className={`btn bk-reader-extra${status === "finished" ? " btn-primary" : ""}`} onClick={() => void toggleFinished()}>
          {status === "finished" ? "Finished ✓" : "Mark finished"}
        </button>
        <button type="button" className="btn" onClick={toggleBar} aria-expanded={!barSlim} title={barSlim ? "Show timer and status" : "Hide timer and status"}>{barSlim ? "▾" : "▴"}</button>
      </div>
      <div className="bk-reader-body">
        {!book.has_file ? (
          <div className="bk-empty muted">This book has no file yet. Go back and choose “Attach file…” from its ⋯ menu.</div>
        ) : book.format === "epub" ? (
          <EpubReader book={book} pageRef={pageRef} onToNotes={isPaper ? undefined : (text, loc) => addNote(text, null, loc)} />
        ) : (
          <PdfViewer doc={doc} onClose={onBack} />
        )}
        {!isPaper && notesOpen && (
          <BookNotesPanel slug={book.slug} notes={notes} onChange={setNotes} onClose={() => setNotesOpen(false)} />
        )}
      </div>
    </div>
  );
}
