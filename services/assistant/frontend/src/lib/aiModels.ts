/**
 * aiModels.ts — one list of AI models, each with its own key, and a "use for" tick per job:
 *
 *   Loki          the chat / Ask assistant (one model at a time)
 *   Handwriting   handwriting -> LaTeX (Canvas panel, Slides ink box); tried in list order
 *   PDF           PDF -> Markdown / LaTeX with a vision model; tried in list order
 *
 * Keys stay in this browser (localStorage) and are sent with each request. The older stores
 * (yggdrasil:ai-providers, yggdrasil:canvas-engines) are read once to build this list and then left alone.
 */

export type ModelPreset = "ollama" | "lmstudio" | "claude" | "deepseek" | "kimi" | "huggingface" | "gemini" | "openrouter" | "custom";

export interface AiModel {
  id: string;
  preset: ModelPreset;
  label: string;
  base_url: string;
  api_key: string;
  model: string;
  loki: boolean;
  ink: boolean;
  pdf: boolean;
}

export interface PresetMeta {
  label: string;
  base: string;
  model: string;
  needsKey: boolean;
  /** Can it read images (handwriting, PDF pages)? Claude is chat-only here; DeepSeek has no vision. */
  vision: boolean;
  note: string;
}

export const MODEL_PRESETS: Record<ModelPreset, PresetMeta> = {
  lmstudio: { label: "LM Studio", base: "http://127.0.0.1:1234", model: "", needsKey: false, vision: true, note: "Runs on your machine. For handwriting and PDF, load a vision-capable model." },
  ollama: { label: "Ollama", base: "http://localhost:11434", model: "llama3.2", needsKey: false, vision: true, note: "Runs on your machine. For handwriting and PDF, use a vision model such as llava." },
  gemini: { label: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", needsKey: true, vision: true, note: "Free-tier key works. Pages and crops you send are processed by Google." },
  openrouter: { label: "OpenRouter", base: "https://openrouter.ai/api/v1", model: "", needsKey: true, vision: true, note: "One key for many models. Pick a vision model for handwriting and PDF." },
  claude: { label: "Claude (Anthropic)", base: "", model: "claude-sonnet-4-5", needsKey: true, vision: false, note: "Chat only here." },
  deepseek: { label: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-chat", needsKey: true, vision: false, note: "Chat only: no image input." },
  kimi: { label: "Kimi (Moonshot)", base: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", needsKey: true, vision: true, note: "Use a Kimi vision model for handwriting and PDF." },
  huggingface: { label: "Hugging Face", base: "https://router.huggingface.co/v1", model: "meta-llama/Meta-Llama-3-8B-Instruct", needsKey: true, vision: true, note: "Use a vision model for handwriting and PDF." },
  custom: { label: "Custom endpoint", base: "", model: "", needsKey: false, vision: true, note: "Any OpenAI-compatible server. Base URL includes /v1." },
};

export const PRESET_ORDER: ModelPreset[] = ["lmstudio", "ollama", "gemini", "openrouter", "claude", "deepseek", "kimi", "huggingface", "custom"];

const KEY = "yggdrasil:ai-models";

export function newModel(preset: ModelPreset): AiModel {
  const p = MODEL_PRESETS[preset];
  return {
    id: `${preset}-${Math.random().toString(36).slice(2, 8)}`,
    preset, label: p.label, base_url: p.base, api_key: "", model: p.model,
    loki: false, ink: false, pdf: false,
  };
}

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function parse<T>(raw: string | null): T | null { try { return raw ? (JSON.parse(raw) as T) : null; } catch { return null; } }

/** Build the list from the two older stores. Same provider / same URL = one model with both ticks. */
function migrate(): AiModel[] {
  const out: AiModel[] = [];
  const providers = parse<Record<string, Partial<AiModel>>>(lsGet("yggdrasil:ai-providers")) ?? {};
  const active = lsGet("yggdrasil:ai-active-provider") || "lmstudio";
  (Object.keys(MODEL_PRESETS) as ModelPreset[]).forEach((id) => {
    const p = providers[id];
    if (!p && id !== active) return;
    const base = MODEL_PRESETS[id];
    const used = id === active || !!(p?.api_key);
    if (!used) return;
    const m = newModel(id);
    m.base_url = (p?.base_url ?? base.base) || base.base;
    m.api_key = p?.api_key ?? "";
    m.model = (p?.model ?? base.model) || base.model;
    m.loki = id === active;
    out.push(m);
  });

  type Old = { id: string; label: string; preset: string; base_url: string; api_key: string; model: string; enabled: boolean };
  const engines = parse<Old[]>(lsGet("yggdrasil:canvas-engines"));
  const norm = (u: string) => u.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  if (Array.isArray(engines)) {
    for (const e of engines) {
      if (!e || typeof e.base_url !== "string") continue;
      const twin = out.find((m) => m.preset === e.preset && norm(m.base_url) === norm(e.base_url));
      if (twin) { twin.ink = twin.ink || !!e.enabled; if (!twin.api_key) twin.api_key = e.api_key || ""; if (!twin.model && e.model) twin.model = e.model; continue; }
      const preset = (e.preset in MODEL_PRESETS ? e.preset : "custom") as ModelPreset;
      const m = newModel(preset);
      m.label = e.label || m.label; m.base_url = e.base_url; m.api_key = e.api_key || ""; m.model = e.model || ""; m.ink = !!e.enabled;
      out.push(m);
    }
  } else if (!out.some((m) => m.preset === "lmstudio")) {
    // Fresh install: LM Studio is the Loki and handwriting default, as before.
    const lm = newModel("lmstudio"); lm.loki = !out.some((m) => m.loki); lm.ink = true; out.push(lm);
  } else {
    out.filter((m) => m.preset === "lmstudio").forEach((m) => { m.ink = true; });
  }
  if (!out.some((m) => m.loki) && out.length) out.find((m) => MODEL_PRESETS[m.preset])!.loki = true;
  return out;
}

export function loadModels(): AiModel[] {
  const stored = parse<AiModel[]>(lsGet(KEY));
  if (Array.isArray(stored) && stored.every((m) => m && typeof m.id === "string" && m.preset in MODEL_PRESETS)) return stored;
  const made = migrate();
  try { localStorage.setItem(KEY, JSON.stringify(made)); } catch { /* ignore */ }
  return made;
}

export function saveModels(models: AiModel[]) {
  try { localStorage.setItem(KEY, JSON.stringify(models)); } catch { /* ignore */ }
}

/** Only one model can be Loki. */
export function setLoki(models: AiModel[], id: string, on: boolean): AiModel[] {
  return models.map((m) => ({ ...m, loki: on && m.id === id }));
}

/** OpenAI-compatible root including /v1 (local servers are stored without it). */
export function visionBase(m: AiModel): string {
  const b = m.base_url.trim().replace(/\/+$/, "");
  if ((m.preset === "lmstudio" || m.preset === "ollama") && b && !/\/v1$/.test(b)) return `${b}/v1`;
  return b;
}

function engines(models: AiModel[], pick: (m: AiModel) => boolean) {
  return models
    .filter((m) => pick(m) && MODEL_PRESETS[m.preset].vision && visionBase(m))
    .map((m) => ({ id: m.id, label: m.label, base_url: visionBase(m), api_key: m.api_key.trim(), model: m.model.trim() }));
}

/** Handwriting -> LaTeX engines, in list order. */
export const inkEngines = (models: AiModel[] = loadModels()) => engines(models, (m) => m.ink);
/** PDF -> Markdown vision models, in list order. */
export const pdfEngines = (models: AiModel[] = loadModels()) => engines(models, (m) => m.pdf);

/** What /ask and /examine take. Falls back to a local LM Studio when nothing is ticked for Loki. */
export function lokiPayload(models: AiModel[] = loadModels()) {
  const m = models.find((x) => x.loki);
  if (!m) return { provider: "lmstudio", api_key: "", base_url: MODEL_PRESETS.lmstudio.base, model: MODEL_PRESETS.lmstudio.model };
  return { provider: m.preset, api_key: m.api_key, base_url: m.base_url, model: m.model };
}
