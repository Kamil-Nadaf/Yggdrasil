import { useState } from "react";
import { api } from "../api/client";

interface Source {
  citekey: string;
  excerpt: string;
}

export default function AskView() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);
    try {
      const r = await api.ask(question);
      setAnswer(r.answer);
      setSources(r.sources);
    } catch (e: unknown) {
      setError((e as Error).message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Ask Your Notes</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Searches your vault via semantic similarity and generates an answer from your own notes only.
        Does not use the Anthropic API — answers come from Ollama + your indexed text.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && handleAsk()}
          placeholder="What mechanisms explain GRB prompt emission variability?"
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={handleAsk} disabled={loading || !question.trim()}>
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {error && <div className="crit" style={{ marginBottom: 12 }}>{error}</div>}

      {answer && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Answer</h2>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{answer}</div>
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <h2 style={{ marginBottom: 8 }}>Sources</h2>
          {sources.map((s, i) => (
            <div key={i} className="card" style={{ marginBottom: 8 }}>
              <div className="mono" style={{ color: "var(--accent)", fontSize: 12, marginBottom: 4 }}>
                [{s.citekey}]
              </div>
              <div className="muted" style={{ fontSize: 13 }}>…{s.excerpt}…</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
