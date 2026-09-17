import { DEFAULT_TITLE_FONT } from "./fonts";

const BRAND_KEY = "yggdrasil:loki-brand";
export const LOKI_BRAND_EVENT = "ygg-loki-brand";

export type LokiTitleMode = "text" | "logo";

export interface LokiBrand {
  name: string;
  titleMode: LokiTitleMode;
  fontId: string;
  /** Hero title size in px, text mode. */
  fontSize: number;
  /** Hero title height in px, logo mode. */
  logoHeight: number;
}

export const MIN_TITLE_SIZE = 16;
export const MAX_TITLE_SIZE = 160;

export const DEFAULT_LOKI_BRAND: LokiBrand = {
  name: "Loki",
  titleMode: "text",
  fontId: DEFAULT_TITLE_FONT,
  fontSize: 40,
  logoHeight: 40,
};

function clampSize(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_TITLE_SIZE, Math.max(MIN_TITLE_SIZE, v));
}

export function loadLokiBrand(): LokiBrand {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LokiBrand>;
      return {
        name: parsed.name?.trim() || DEFAULT_LOKI_BRAND.name,
        titleMode: parsed.titleMode === "logo" ? "logo" : "text",
        fontId: parsed.fontId || DEFAULT_LOKI_BRAND.fontId,
        fontSize: clampSize(parsed.fontSize, DEFAULT_LOKI_BRAND.fontSize),
        logoHeight: clampSize(parsed.logoHeight, DEFAULT_LOKI_BRAND.logoHeight),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_LOKI_BRAND };
}

export function saveLokiBrand(next: LokiBrand) {
  localStorage.setItem(BRAND_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(LOKI_BRAND_EVENT));
}

/** Notify listeners after a server-side change (logo upload/remove) with no localStorage write. */
export function announceLokiBrandChange() {
  window.dispatchEvent(new CustomEvent(LOKI_BRAND_EVENT));
}
