import { useState } from "react";
import { canvasApi } from "../../api/canvas";
import { PRESETS, newEngine, type Engine, type EnginePreset } from "../../lib/canvasEngines";

interface Props {
  engines: Engine[];
  onChange: (next: Engine[]) => void;
  onClose: () => void;
}

type Probe = { state: "busy" } | { state: "ok"; models: string[] } | { state: "err"; message: string };

export default function EngineSettings({ engines, onChange, onClose }: Props) {
  const [probes, setProbes] = useState<Record<string, Probe>>({});

  const patch = (id: string, change: Partial<Engine>) =>
    onChange(engines.map((e) => (e.id === id ? { ...e, ...change } : e)));

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= engines.length) return;
    const next = engines.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const probe = async (e: Engine) => {
    setProbes((p) => ({ ...p, [e.id]: { state: "busy" } }));
    try {
      const { models } = await canvasApi.models(e.base_url, e.api_key);
      setProbes((p) => ({ ...p, [e.id]: { state: "ok", models } }));
    } catch (err) {
      setProbes((p) => ({ ...p, [e.id]: { state: "err", message: err instanceof Error ? err.message : "Failed" } }));
    }
  };

  return (
    <div className="cv-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="cv-modal" role="dialog" aria-modal="true" aria-label="Recognition engines" onClick={(e) => e.stopPropagation()}>
        <div className="cv-modal-head">
          <div>
            <div className="cv-modal-title">Recognition engines</div>
            <div className="cv-muted">Tried from top to bottom. The first answer that is well-formed LaTeX is used. Keys stay in this browser and are sent only with each request.</div>
          </div>
          <button type="button" className="btn cv-touch" onClick={onClose}>Done</button>
        </div>

        <div className="cv-engine-list">
          {engines.map((e, i) => {
            const pr = probes[e.id];
            const meta = PRESETS[e.preset];
            const listId = `cv-models-${e.id}`;
            return (
              <div key={e.id} className={`cv-engine${e.enabled ? "" : " is-off"}`}>
                <div className="cv-engine-top">
                  <span className="cv-rank">{i + 1}</span>
                  <input
                    className="cv-input cv-engine-label"
                    value={e.label}
                    aria-label="Engine name"
                    onChange={(ev) => patch(e.id, { label: ev.target.value })}
                  />
                  <button type="button" className="btn cv-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button type="button" className="btn cv-icon" aria-label="Move down" disabled={i === engines.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <label className="cv-switch" title={e.enabled ? "On" : "Off"}>
                    <input type="checkbox" checked={e.enabled} onChange={(ev) => patch(e.id, { enabled: ev.target.checked })} aria-label={`Use ${e.label}`} />
                    <span />
                  </label>
                </div>
                <div className="cv-muted">{meta.note}</div>
                <div className="cv-engine-fields">
                  <label className="cv-field cv-field-wide">
                    <span>Base URL</span>
                    <input className="cv-input cv-mono" value={e.base_url} onChange={(ev) => patch(e.id, { base_url: ev.target.value })} placeholder="http://127.0.0.1:1234/v1" spellCheck={false} autoCapitalize="off" />
                  </label>
                  <label className="cv-field">
                    <span>Model</span>
                    <input className="cv-input cv-mono" list={listId} value={e.model} onChange={(ev) => patch(e.id, { model: ev.target.value })} placeholder={e.preset === "lmstudio" ? "loaded model" : "choose a model"} spellCheck={false} autoCapitalize="off" />
                    <datalist id={listId}>{pr && pr.state === "ok" ? pr.models.map((m) => <option key={m} value={m} />) : null}</datalist>
                  </label>
                  <label className="cv-field cv-field-wide">
                    <span>API key{meta.needsKey ? "" : " (optional)"}</span>
                    <input className="cv-input cv-mono" type="password" value={e.api_key} onChange={(ev) => patch(e.id, { api_key: ev.target.value })} autoComplete="off" spellCheck={false} />
                  </label>
                </div>
                <div className="cv-engine-actions">
                  <button type="button" className="btn cv-touch" disabled={!e.base_url.trim() || pr?.state === "busy"} onClick={() => probe(e)}>
                    {pr?.state === "busy" ? "Checking…" : "Test and load models"}
                  </button>
                  {pr?.state === "ok" && <span className="cv-ok">Connected · {pr.models.length} models</span>}
                  {pr?.state === "err" && <span className="cv-err">{pr.message}</span>}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="btn cv-touch" onClick={() => onChange(engines.filter((x) => x.id !== e.id))}>Remove</button>
                </div>
              </div>
            );
          })}
          {engines.length === 0 && <div className="cv-muted">No engines yet. Add one below.</div>}
        </div>

        <div className="cv-add-row">
          <span className="cv-muted">Add engine</span>
          {(Object.keys(PRESETS) as EnginePreset[]).map((p) => (
            <button key={p} type="button" className="btn cv-touch" onClick={() => onChange([...engines, newEngine(p)])}>
              + {PRESETS[p].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
