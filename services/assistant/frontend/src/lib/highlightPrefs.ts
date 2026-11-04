import { useSyncExternalStore } from "react";

/** Highlight colours shared by the PDF and EPUB readers. Colours are stored as hex; the opacity is applied when drawing. */
export interface HighlightPrefs {
  /** Colour used for plain highlights and "+ Note". */
  defaultColor: string;
  /** Palette shown in the selection popup (built-ins first, then your custom colours). */
  colors: string[];
  /** 0.1–0.85, applied to every highlight on screen. */
  opacity: number;
  /** One soft colour per CERIC slot, by slot key. */
  slotColors: Record<string, string>;
}

export const BUILTIN_COLORS = ["#ffd60a", "#ff6b6b", "#5fd068", "#4aa8ff", "#a78bfa", "#f472d0", "#ff9f43", "#a0a0a8"];
export const COLOR_NAMES: Record<string, string> = {
  "#ffd60a": "Yellow", "#ff6b6b": "Red", "#5fd068": "Green", "#4aa8ff": "Blue", "#a78bfa": "Purple", "#f472d0": "Pink", "#ff9f43": "Orange", "#a0a0a8": "Gray",
};
/** Gentle, clearly different hues — meant to be read at low opacity so text stays legible. */
export const SLOT_DEFAULTS = ["#6fcf97", "#7fa8f5", "#f2b26b", "#c49be0", "#ee9db0", "#b4c95c", "#6fd0d6", "#d9b38c"];

const KEY = "yggdrasil:highlight-prefs";
const DEFAULTS: HighlightPrefs = { defaultColor: BUILTIN_COLORS[0], colors: [...BUILTIN_COLORS], opacity: 0.4, slotColors: {} };

const HEX = /^#[0-9a-fA-F]{6}$/;
let state: HighlightPrefs = load();
const listeners = new Set<() => void>();

function load(): HighlightPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const colors: string[] = Array.isArray(raw.colors) ? raw.colors.filter((c: unknown) => typeof c === "string" && HEX.test(c)).slice(0, 16) : [];
    const slotColors: Record<string, string> = {};
    if (raw.slotColors && typeof raw.slotColors === "object") {
      for (const [k, v] of Object.entries(raw.slotColors)) if (typeof v === "string" && HEX.test(v)) slotColors[k] = v;
    }
    return {
      defaultColor: typeof raw.defaultColor === "string" && HEX.test(raw.defaultColor) ? raw.defaultColor : DEFAULTS.defaultColor,
      colors: colors.length ? colors : DEFAULTS.colors,
      opacity: typeof raw.opacity === "number" ? Math.max(0.1, Math.min(0.85, raw.opacity)) : DEFAULTS.opacity,
      slotColors,
    };
  } catch {
    return DEFAULTS;
  }
}

export function getHighlightPrefs(): HighlightPrefs {
  return state;
}

export function setHighlightPrefs(patch: Partial<HighlightPrefs>): void {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage may be unavailable */ }
  listeners.forEach((l) => l());
}

export function resetHighlightPrefs(): void {
  state = DEFAULTS;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useHighlightPrefs(): HighlightPrefs {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => state,
    () => state
  );
}

/** The colour of a CERIC slot: your choice, else a soft default picked by its position. */
export function slotColor(prefs: HighlightPrefs, slotKey: string, index: number): string {
  return prefs.slotColors[slotKey] || SLOT_DEFAULTS[index % SLOT_DEFAULTS.length];
}

/** CSS colour for drawing: hex gets the global opacity; legacy rgba() highlights are drawn as saved. */
export function colorCss(color: string, opacity: number): string {
  if (!HEX.test(color)) return color;
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}
