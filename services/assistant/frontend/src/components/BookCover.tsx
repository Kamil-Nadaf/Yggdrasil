import { useState } from "react";
import { reading, type ReadingBook } from "../api/reading";

const PALETTE: [string, string][] = [
  ["#2f4a46", "#e8f1ee"],
  ["#5a3b2e", "#f6e9df"],
  ["#262f52", "#e6e9fb"],
  ["#4a4a2b", "#f3f2dc"],
  ["#3a2a4a", "#efe6f6"],
  ["#4d2a35", "#f8e6ea"],
  ["#2a4256", "#e2eef7"],
  ["#52402a", "#f7ecdc"],
  ["#23403a", "#dff2ec"],
  ["#40312a", "#f2e7e0"],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Uploaded/extracted cover when there is one, otherwise a typographic cover coloured from the title. */
export default function BookCover({ book, className = "" }: { book: Pick<ReadingBook, "slug" | "title" | "authors" | "has_cover">; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [bg, ink] = PALETTE[hash(book.slug) % PALETTE.length];
  if (book.has_cover && !failed) {
    return (
      <div className={`bk-cover ${className}`}>
        <img src={reading.coverUrl(book.slug)} alt={`Cover of ${book.title}`} loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className={`bk-cover bk-cover--type ${className}`} style={{ background: bg, color: ink }} role="img" aria-label={`Cover of ${book.title}`}>
      <span className="bk-cover-title">{book.title}</span>
      {book.authors[0] && <span className="bk-cover-author">{book.authors[0]}</span>}
    </div>
  );
}
