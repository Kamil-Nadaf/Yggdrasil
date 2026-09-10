import { useEffect, useState, useCallback } from "react";
import { api, type Paper, type PaperFrontmatter } from "../api/client";
import GateIndicator from "../components/GateIndicator";

const SLOTS = [
  { key: "claim",       label: "C — Claim",       hint: "What is the paper's central claim?" },
  { key: "evidence",    label: "E — Evidence",     hint: "What data/observations support it?" },
  { key: "reasoning",   label: "R — Reasoning",    hint: "What is the logical chain from E to C?" },
  { key: "implications",label: "I — Implications", hint: "What does this mean for GRB physics?" },
  { key: "context",     label: "C — Context",      hint: "Where does this fit in the literature? [[wikilink]] references." },
] as const;

interface Props {
  citekey: string | null;
  onBack: () => void;
}

export default function CERICEditor({ citekey, onBack }: Props) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [form, setForm] = useState<Partial<PaperFrontmatter>>({});
  const [saving, setSaving] = useState(false);
  const [examining, setExamining] = useState(false);
  const [examineResult, setExamineResult] = useState<string | null>(null);
  const [examineError, setExamineError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!citekey) return;
    api.papers.get(citekey).then((p) => {
      setPaper(p);
      setForm(p.frontmatter);
    });
  }, [citekey]);

  const setField = useCallback((key: string, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }, []);

  async function save() {
    if (!citekey) return;
    setSaving(true);
    await api.papers.update(citekey, form);
    const updated = await api.papers.get(citekey);
    setPaper(updated);
    setDirty(false);
    setSaving(false);
  }

  async function handleExamine() {
    if (!citekey) return;
    if (dirty) await save();
    setExamining(true);
    setExamineError(null);
    setExamineResult(null);
    try {
      const r = await api.examine(citekey);
      setExamineResult(r.response);
      // Reload paper to show updated body with AI callout
      const updated = await api.papers.get(citekey);
      setPaper(updated);
    } catch (e: unknown) {
      const err = e as Error & { data?: { detail?: string; error?: string } };
      if ("status" in err && (err as { status: number }).status === 423) {
        setExamineError("Gate locked: " + (err.data?.detail || "fill all CERIC slots first"));
      } else {
        setExamineError(err.message || "Examine failed");
      }
    } finally {
      setExamining(false);
    }
  }

  if (!citekey) return <div className="muted">No paper selected — go to Triage and click Read.</div>;
  if (!paper) return <div className="muted">Loading…</div>;

  const fm = form;
  const gate = paper.gate;
  const allSlotsFilled = SLOTS.every((s) => (fm[s.key] as string | undefined)?.trim());
  const aqWritten = Boolean(fm.aq_written);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button className="btn" onClick={onBack}>← Triage</button>
        <h1 style={{ margin: 0, flex: 1 }}>
          {fm.title || citekey}
        </h1>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="muted mono" style={{ fontSize: 12, marginBottom: 16 }}>
        {fm.authors?.slice(0, 4).join(", ")}{fm.authors && fm.authors.length > 4 ? " et al." : ""}{" "}
        {fm.year ? `(${fm.year})` : ""}
        {fm.arxiv ? ` · arXiv:${fm.arxiv}` : ""}
        {fm.doi ? ` · doi:${fm.doi}` : ""}
      </div>

      <GateIndicator gate={gate} />

      {/* ── CERIC Slots ─────────────────────────────────────────────────── */}
      {SLOTS.map((slot) => {
        const val = (fm[slot.key] as string) || "";
        const filled = val.trim().length > 0;
        return (
          <div key={slot.key} style={{ marginBottom: 16 }}>
            <div className="slot-label">{slot.label}</div>
            <textarea
              className={`slot-textarea${filled ? " filled" : ""}`}
              placeholder={slot.hint}
              value={val}
              onChange={(e) => setField(slot.key, e.target.value)}
            />
          </div>
        );
      })}

      {/* ── Adversarial Question ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div className="slot-label">Adversarial Question</div>
        <textarea
          className={`slot-textarea${(fm.adversarial_question as string || "").trim() ? " filled" : ""}`}
          placeholder="What is the strongest objection to this paper's claim?"
          value={(fm.adversarial_question as string) || ""}
          onChange={(e) => setField("adversarial_question", e.target.value)}
          style={{ minHeight: 60 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={aqWritten}
            onChange={(e) => setField("aq_written", e.target.checked)}
          />
          <span className="mono" style={{ fontSize: 12 }}>aq_written — mark when question is genuinely adversarial</span>
        </label>
      </div>

      {/* ── Metadata ────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Metadata</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            <div className="slot-label">Tier</div>
            <select value={fm.tier ?? 0} onChange={(e) => setField("tier", e.target.value)}>
              <option value={0}>0 — Skimmed</option>
              <option value={1}>1 — Full CERIC</option>
              <option value={2}>2 — Reproduced</option>
            </select>
          </label>
          <label>
            <div className="slot-label">Confidence (0–100)</div>
            <input
              type="number" min={0} max={100}
              value={fm.confidence ?? 0}
              onChange={(e) => setField("confidence", e.target.value)}
            />
          </label>
          <label>
            <div className="slot-label">Concepts (comma-separated)</div>
            <input
              type="text"
              value={((fm.concepts as string[]) || []).join(", ")}
              onChange={(e) => setField("concepts", e.target.value.split(",").map(s => s.trim()).filter(Boolean) as unknown as string)}
              placeholder="internal shocks, Lorentz factor, ..."
            />
          </label>
          <label>
            <div className="slot-label">Methods (comma-separated)</div>
            <input
              type="text"
              value={((fm.methods as string[]) || []).join(", ")}
              onChange={(e) => setField("methods", e.target.value.split(",").map(s => s.trim()).filter(Boolean) as unknown as string)}
              placeholder="spectral fitting, MCMC, ..."
            />
          </label>
        </div>
      </div>

      {/* ── /examine ────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <button
          className={`btn ${allSlotsFilled && aqWritten ? "btn-primary" : "btn-gate"}`}
          onClick={handleExamine}
          disabled={examining}
        >
          {examining ? "Examining…" : "/examine — Run AI analysis"}
        </button>
        {!allSlotsFilled || !aqWritten ? (
          <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
            Fill all 5 slots and mark aq_written to unlock
          </span>
        ) : null}
      </div>

      {examineError && (
        <div className="card" style={{ borderColor: "var(--crit)", marginTop: 12 }}>
          <span className="crit">{examineError}</span>
        </div>
      )}

      {examineResult && (
        <div className="ai-callout" style={{ marginTop: 16 }}>
          <div className="ai-callout-label">AI · /examine</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{examineResult}</div>
        </div>
      )}
    </div>
  );
}
