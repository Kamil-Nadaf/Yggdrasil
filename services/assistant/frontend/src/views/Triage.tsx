import { useEffect, useState } from "react";
import { api, type Paper } from "../api/client";

interface Props {
  onOpenEditor: (citekey: string) => void;
}

export default function Triage({ onOpenEditor }: Props) {
  const [brief, setBrief] = useState<string>("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);
  const [triaging, setTriaging] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.brief.today(), api.papers.list()])
      .then(([b, ps]) => {
        setBrief(b.raw);
        setPapers(ps);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleVerdict(citekey: string, verdict: "read" | "skip" | "later") {
    setTriaging(citekey);
    await api.papers.triage(citekey, verdict);
    setPapers((prev) =>
      prev.map((p) =>
        p.citekey === citekey
          ? { ...p, frontmatter: { ...p.frontmatter, verdict } }
          : p
      )
    );
    setTriaging(null);
    if (verdict === "read") onOpenEditor(citekey);
  }

  const untriaged = papers.filter((p) => !p.frontmatter.verdict);
  const triaged = papers.filter((p) => p.frontmatter.verdict);

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <div>
      <h1>Triage</h1>

      {brief && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2>Today's Brief</h2>
          <pre style={{ fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "pre-wrap", color: "var(--text)", margin: 0 }}>
            {brief}
          </pre>
        </div>
      )}

      {untriaged.length > 0 && (
        <section>
          <h2 style={{ marginBottom: 12 }}>To Triage ({untriaged.length})</h2>
          {untriaged.map((paper) => (
            <PaperRow
              key={paper.citekey}
              paper={paper}
              busy={triaging === paper.citekey}
              onVerdict={handleVerdict}
              onEdit={() => onOpenEditor(paper.citekey)}
            />
          ))}
        </section>
      )}

      {triaged.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ marginBottom: 12 }}>Done Today ({triaged.length})</h2>
          {triaged.map((paper) => (
            <PaperRow
              key={paper.citekey}
              paper={paper}
              busy={false}
              onVerdict={handleVerdict}
              onEdit={() => onOpenEditor(paper.citekey)}
            />
          ))}
        </section>
      )}

      {papers.length === 0 && (
        <div className="muted">No papers in the vault yet. The daily cron runs at 06:30 CST.</div>
      )}
    </div>
  );
}

function PaperRow({
  paper,
  busy,
  onVerdict,
  onEdit,
}: {
  paper: Paper;
  busy: boolean;
  onVerdict: (k: string, v: "read" | "skip" | "later") => void;
  onEdit: () => void;
}) {
  const fm = paper.frontmatter;
  const verdict = fm.verdict as string | undefined;

  return (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>
          {fm.title || paper.citekey}
        </div>
        <div className="muted mono" style={{ fontSize: 12 }}>
          {fm.authors?.slice(0, 3).join(", ")}
          {fm.authors && fm.authors.length > 3 ? " et al." : ""}
          {fm.year ? ` (${fm.year})` : ""}
          {fm.arxiv ? ` · arXiv:${fm.arxiv}` : ""}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        {verdict ? (
          <>
            <span className={`chip chip-${verdict}`}>{verdict}</span>
            <button className="btn" onClick={onEdit} style={{ fontSize: 12 }}>Edit</button>
          </>
        ) : (
          <>
            <button
              className="btn btn-ok"
              disabled={busy}
              onClick={() => onVerdict(paper.citekey, "read")}
            >Read</button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => onVerdict(paper.citekey, "later")}
            >Later</button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => onVerdict(paper.citekey, "skip")}
            >Skip</button>
          </>
        )}
      </div>
    </div>
  );
}
