import { inkEngines } from "./aiModels";

/** Handwriting recognition engines for the Canvas panel and the Slides ink box.
 *  The models themselves are configured in Settings -> AI & integrations (lib/aiModels.ts); this keeps the
 *  shape the views already use. Keys stay in this browser and are sent with each request. */

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

export function loadEngines(): Engine[] {
  return inkEngines().map((e) => ({ ...e, preset: "custom" as EnginePreset, enabled: true }));
}

/** What the server needs, in the order to try. */
export function activeEnginePayload(engines: Engine[]) {
  return engines
    .filter((e) => e.enabled && e.base_url.trim())
    .map((e) => ({ id: e.id, label: e.label, base_url: e.base_url.trim(), api_key: e.api_key.trim(), model: e.model.trim() }));
}
