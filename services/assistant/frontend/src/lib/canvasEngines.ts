import { loadProviderStore } from "./aiProvider";

/** Recognition engines for the Canvas view. Same rule as the Ask providers: kept in this browser, sent per request. */

export type EnginePreset = "lmstudio" | "gemini" | "openrouter" | "custom";

export interface Engine {
  id: string;
  label: string;
  preset: EnginePreset;
  /** OpenAI-compatible root, including /v1 (or /v1beta/openai for Gemini). */
  base_url: string;
  api_key: string;
  model: string;
  enabled: boolean;
}

export const PRESETS: Record<EnginePreset, { label: string; base_url: string; model: string; needsKey: boolean; note: string }> = {
  lmstudio: {
    label: "LM Studio",
    base_url: "http://127.0.0.1:1234/v1",
    model: "",
    needsKey: false,
    note: "Runs on your own machine. Load a vision-capable model in LM Studio first.",
  },
  gemini: {
    label: "Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    needsKey: true,
    note: "Free-tier API key. The cropped image is sent to Google.",
  },
  openrouter: {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "",
    needsKey: true,
    note: "API key. Pick a free vision model. The cropped image is sent to the provider.",
  },
  custom: {
    label: "Custom endpoint",
    base_url: "",
    model: "",
    needsKey: false,
    note: "Any OpenAI-compatible server that accepts images.",
  },
};

const KEY = "yggdrasil:canvas-engines";

export function newEngine(preset: EnginePreset): Engine {
  const p = PRESETS[preset];
  return {
    id: `${preset}-${Math.random().toString(36).slice(2, 8)}`,
    label: p.label,
    preset,
    base_url: p.base_url,
    api_key: "",
    model: p.model,
    enabled: true,
  };
}

/** First run: LM Studio on, pointing where the Ask view already points; Gemini added but off until it has a key. */
function seed(): Engine[] {
  const lm = newEngine("lmstudio");
  try {
    const base = (loadProviderStore().lmstudio.base_url || "").trim().replace(/\/+$/, "");
    if (base) lm.base_url = /\/v1$/.test(base) ? base : `${base}/v1`;
  } catch {
    /* keep the default */
  }
  const gem = newEngine("gemini");
  gem.enabled = false;
  return [lm, gem];
}

export function loadEngines(): Engine[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((e) => e && typeof e.id === "string" && typeof e.base_url === "string")) {
        return parsed as Engine[];
      }
    }
  } catch {
    /* fall through to the seed */
  }
  return seed();
}

export function saveEngines(engines: Engine[]) {
  localStorage.setItem(KEY, JSON.stringify(engines));
}

/** What the server needs, in the order to try. */
export function activeEnginePayload(engines: Engine[]) {
  return engines
    .filter((e) => e.enabled && e.base_url.trim())
    .map((e) => ({ id: e.id, label: e.label, base_url: e.base_url.trim(), api_key: e.api_key.trim(), model: e.model.trim() }));
}
