import { useEffect, useMemo, useRef, useState } from "react";
import { reading, type ReadingBook } from "../../api/reading";
import PdfViewer, { type PdfDoc } from "../../components/PdfViewer";
import ReadingTimerChip from "../../components/ReadingTimerChip";
import EpubReader from "./EpubReader";

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
    [book.slug, book.title]
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
      <div className="bk-reader-bar">
        <button type="button" className="btn" onClick={onBack}>← Library</button>
        <div className="bk-reader-title" title={book.title}>
          <strong>{book.title}</strong>
          {book.authors.length > 0 && <span className="muted"> · {book.authors.join(", ")}</span>}
        </div>
        <ReadingTimerChip slug={book.slug} pageRef={pageRef} />
        <button type="button" className={`btn${status === "finished" ? " btn-primary" : ""}`} onClick={() => void toggleFinished()}>
          {status === "finished" ? "Finished ✓" : "Mark finished"}
        </button>
      </div>
      <div className="bk-reader-body">
        {!book.has_file ? (
          <div className="bk-empty muted">This book has no file yet. Go back and choose “Attach file…” from its ⋯ menu.</div>
        ) : book.format === "epub" ? (
          <EpubReader book={book} pageRef={pageRef} />
        ) : (
          <PdfViewer doc={doc} onClose={onBack} />
        )}
      </div>
    </div>
  );
}
