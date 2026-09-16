/** Configurable analysis tags (flexible CERIC slot names). */

export const DEFAULT_ANALYSIS_TAGS = [
  "Claim",
  "Evidence",
  "Reasoning",
  "Implications",
  "Context",
] as const;

export const ANALYSIS_TAGS_EVENT = "ygg-analysis-tags";

export function tagToKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "slot";
}

export interface AnalysisSlot {
  key: string;
  label: string;
  letter: string;
}

export function slotsFromTags(tags: string[]): AnalysisSlot[] {
  return tags.map((label) => {
    const key = tagToKey(label);
    const letter = (label.trim()[0] || "?").toUpperCase();
    return { key, label, letter };
  });
}

let cached: { tags: string[]; slots: AnalysisSlot[] } | null = null;

export function getCachedAnalysisSlots(): AnalysisSlot[] {
  return cached?.slots ?? slotsFromTags([...DEFAULT_ANALYSIS_TAGS]);
}

export function getCachedAnalysisTags(): string[] {
  return cached?.tags ?? [...DEFAULT_ANALYSIS_TAGS];
}

export function setCachedAnalysisTags(tags: string[]) {
  cached = { tags, slots: slotsFromTags(tags) };
  window.dispatchEvent(new CustomEvent(ANALYSIS_TAGS_EVENT));
}

export async function ensureAnalysisTags(
  fetcher: () => Promise<{ analysis_tags: string[] }>
): Promise<AnalysisSlot[]> {
  if (cached) return cached.slots;
  try {
    const r = await fetcher();
    setCachedAnalysisTags(r.analysis_tags);
  } catch {
    setCachedAnalysisTags([...DEFAULT_ANALYSIS_TAGS]);
  }
  return getCachedAnalysisSlots();
}
