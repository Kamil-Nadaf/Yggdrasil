import { useMemo } from "react";
import type { ReadingBook, ReadingGoal } from "../../api/reading";
import { formatDuration } from "../../api/reading";
import BookCover from "../../components/BookCover";
import { statusLine } from "./Shelf";

interface Props {
  books: ReadingBook[];
  goal: ReadingGoal | null;
  onOpen: (b: ReadingBook) => void;
  onGoals: () => void;
  onImport: () => void;
}

export default function Home({ books, goal, onOpen, onGoals, onImport }: Props) {
  const continuing = useMemo(
    () => books.filter((b) => b.status === "reading" && b.has_file).sort((a, b) => (b.last_opened || "").localeCompare(a.last_opened || "")).slice(0, 4),
    [books]
  );
  const recent = useMemo(() => [...books].sort((a, b) => (b.added || "").localeCompare(a.added || "")).slice(0, 8), [books]);
  const goalPct = goal && goal.goal_minutes > 0 ? Math.min(100, Math.round((goal.time_today.books / (goal.goal_minutes * 60)) * 100)) : 0;

  return (
    <>
      {goal && (
        <button type="button" className="ab-goalstrip card" onClick={onGoals}>
          <div>
            <strong>{goal.streak === 0 ? "Start a reading streak" : `${goal.streak}-day reading streak`}</strong>
            <div className="muted">Today: {formatDuration(goal.time_today.books)} of {goal.goal_minutes} min · Papers {formatDuration(goal.time_today.papers)} · Writing {formatDuration(goal.time_today.writing)}</div>
          </div>
          <div className="ab-goalbar" aria-hidden="true"><span style={{ width: `${goalPct}%` }} /></div>
          <span className="ab-link">Reading goals →</span>
        </button>
      )}

      <h2 className="ab-h2">Continue</h2>
      {continuing.length === 0 ? (
        <div className="muted ab-empty">Books you are reading appear here. <button type="button" className="ab-link" onClick={onImport}>Import a book</button></div>
      ) : (
        <div className="ab-continue">
          {continuing.map((b) => (
            <button key={b.slug} type="button" className="ab-cont" onClick={() => onOpen(b)}>
              <div className="ab-cont-cover"><BookCover book={b} /></div>
              <div className="ab-cont-title">{b.title}</div>
              <div className="muted">{statusLine(b)}</div>
              <div className="bk-bar"><span style={{ width: `${Math.round(b.progress * 100)}%` }} /></div>
            </button>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <>
          <h2 className="ab-h2">Recently added</h2>
          <div className="ab-strip">
            {recent.map((b) => (
              <button key={b.slug} type="button" className="ab-strip-item" onClick={() => onOpen(b)} title={b.title}>
                <div className="ab-strip-cover"><BookCover book={b} /></div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
