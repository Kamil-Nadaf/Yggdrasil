import { useState } from "react";
import { canvasApi } from "../api/canvas";
import { MODEL_PRESETS, PRESET_ORDER, newModel, setLoki, visionBase, type AiModel, type ModelPreset } from "../lib/aiModels";

interface Props {
  models: AiModel[];
  onChange: (next: AiModel[]) => void;
}

type Probe = { state: "busy" } | { state: "ok"; models: string[] } | { state: "err"; message: string };

/** One list of AI models. Each has its own key and ticks for what it is used for (Loki, handwriting, PDF). */
export default function AiModelsSettings({ models, onChange }: Props) {
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const patch = (id: string, change: Partial<AiModel>) => onChange(models.map((m) => (m.id === id ? { ...m, ...change } : m)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= models.length) return;
    const next = models.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const probe = async (m: AiModel) => {
    setProbes((p) => ({ ...p, [m.id]: { state: "busy" } }));
    try {
      const { models: list } = await canvasApi.models(visionBase(m), m.api_key);
      setProbes((p) => ({ ...p, [m.id]: { state: "ok", models: list } }));
    } catch (err) {
      setProbes((p) => ({ ...p, [m.id]: { state: "err", message: err instanceof Error ? err.message : "Failed" } }));
    }
  };

  return (
    <div className="cv-inline-engines">
      <div className="cv-muted" style={{ marginBottom: 12 }}>
        Add a model once, with one API key, then tick what it is used for. <strong>Loki</strong> uses the one model you tick.
        {" "}<strong>Handwriting</strong> and <strong>PDF</strong> try every ticked model from top to bottom and use the first good answer.
        Keys stay in this browser and are sent only with each request.
      </div>
      <div className="cv-engine-list">
        {models.map((m, i) => {
          const meta = MODEL_PRESETS[m.preset];
          const pr = probes[m.id];
          const listId = `ai-models-${m.id}`;
          const noVision = meta.vision ? undefined : "This provider has no image input here";
          return (
            <div key={m.id} className="cv-engine">
              <div className="cv-engine-top">
                <span className="cv-rank">{i + 1}</span>
                <input className="cv-input cv-engine-label" value={m.label} aria-label="Model name" onChange={(e) => patch(m.id, { label: e.target.value })} />
                <button type="button" className="btn cv-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn cv-icon" aria-label="Move down" disabled={i === models.length - 1} onClick={() => move(i, 1)}>↓</button>
              </div>
              <div className="cv-muted">{meta.note}</div>
              <div className="cv-engine-uses" role="group" aria-label={`What ${m.label} is used for`}>
                <span className="cv-muted">Use for</span>
                <label className="cv-use"><input type="checkbox" checked={m.loki} onChange={(e) => onChange(setLoki(models, m.id, e.target.checked))} /> Loki</label>
                <label className="cv-use" title={noVision}><input type="checkbox" checked={m.ink} disabled={!meta.vision} onChange={(e) => patch(m.id, { ink: e.target.checked })} /> Handwriting → LaTeX</label>
                <label className="cv-use" title={noVision}><input type="checkbox" checked={m.pdf} disabled={!meta.vision} onChange={(e) => patch(m.id, { pdf: e.target.checked })} /> PDF → Markdown / LaTeX</label>
              </div>
              <div className="cv-engine-fields">
                <label className="cv-field cv-field-wide">
                  <span>Base URL</span>
                  <input className="cv-input cv-mono" value={m.base_url} onChange={(e) => patch(m.id, { base_url: e.target.value })} placeholder={meta.base || (m.preset === "claude" ? "(Claude uses the Anthropic API)" : "https://…/v1")} spellCheck={false} autoCapitalize="off" />
                </label>
                <label className="cv-field">
                  <span>Model</span>
                  <input className="cv-input cv-mono" list={listId} value={m.model} onChange={(e) => patch(m.id, { model: e.target.value })} placeholder={meta.model || "choose a model"} spellCheck={false} autoCapitalize="off" />
                  <datalist id={listId}>{pr && pr.state === "ok" ? pr.models.map((x) => <option key={x} value={x} />) : null}</datalist>
                </label>
                <label className="cv-field cv-field-wide">
                  <span>API key{meta.needsKey ? "" : " (optional)"}</span>
                  <input className="cv-input cv-mono" type="password" value={m.api_key} onChange={(e) => patch(m.id, { api_key: e.target.value })} autoComplete="off" spellCheck={false} />
                </label>
              </div>
              <div className="cv-engine-actions">
                {m.preset !== "claude" && (
                  <button type="button" className="btn cv-touch" disabled={!m.base_url.trim() || pr?.state === "busy"} onClick={() => probe(m)}>
                    {pr?.state === "busy" ? "Checking…" : "Test and load models"}
                  </button>
                )}
                {pr?.state === "ok" && <span className="cv-ok">Connected · {pr.models.length} models</span>}
                {pr?.state === "err" && <span className="cv-err">{pr.message}</span>}
                <span style={{ flex: 1 }} />
                <button type="button" className="btn cv-touch" onClick={() => onChange(models.filter((x) => x.id !== m.id))}>Remove</button>
              </div>
            </div>
          );
        })}
        {models.length === 0 && <div className="cv-muted">No models yet. Add one below.</div>}
      </div>
      <div className="cv-add-row">
        <span className="cv-muted">Add model</span>
        {PRESET_ORDER.map((p: ModelPreset) => (
          <button key={p} type="button" className="btn cv-touch" onClick={() => onChange([...models, { ...newModel(p), loki: models.length === 0, ink: false, pdf: false }])}>
            + {MODEL_PRESETS[p].label}
          </button>
        ))}
      </div>
    </div>
  );
}
