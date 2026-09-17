import { api } from "../api/client";

export type FontCategory = "sans" | "serif" | "mono" | "display" | "script" | "blackletter" | "custom";

export interface FontDef {
  id: string;
  label: string;
  stack: string;
  category: FontCategory;
}

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
  { id: "display", label: "Display" },
  { id: "script", label: "Script" },
  { id: "blackletter", label: "Blackletter" },
  { id: "custom", label: "Custom" },
];

/** Installed catalog — user list plus a few extras suited to long-form reading. */
export const APP_FONTS: FontDef[] = [
  { id: "archivo", label: "Archivo", stack: '"Archivo", system-ui, sans-serif', category: "sans" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", stack: '"IBM Plex Sans", system-ui, sans-serif', category: "sans" },
  { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif', category: "sans" },
  { id: "source-sans-3", label: "Source Sans 3", stack: '"Source Sans 3", system-ui, sans-serif', category: "sans" },
  { id: "atkinson", label: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", system-ui, sans-serif', category: "sans" },
  { id: "libre-franklin", label: "Libre Franklin", stack: '"Libre Franklin", system-ui, sans-serif', category: "sans" },

  { id: "ibm-plex-serif", label: "IBM Plex Serif", stack: '"IBM Plex Serif", Georgia, serif', category: "serif" },
  { id: "baskervville", label: "Baskervville", stack: '"Baskervville", Georgia, serif', category: "serif" },
  { id: "libre-baskerville", label: "Libre Baskerville", stack: '"Libre Baskerville", Georgia, serif', category: "serif" },
  { id: "cormorant-garamond", label: "Cormorant Garamond", stack: '"Cormorant Garamond", Garamond, serif', category: "serif" },
  { id: "eb-garamond", label: "EB Garamond", stack: '"EB Garamond", Garamond, serif', category: "serif" },
  { id: "instrument-serif", label: "Instrument Serif", stack: '"Instrument Serif", Georgia, serif', category: "serif" },
  { id: "fraunces", label: "Fraunces", stack: '"Fraunces", Georgia, serif', category: "serif" },
  { id: "spectral", label: "Spectral", stack: '"Spectral", Georgia, serif', category: "serif" },
  { id: "lora", label: "Lora", stack: '"Lora", Georgia, serif', category: "serif" },
  { id: "source-serif-4", label: "Source Serif 4", stack: '"Source Serif 4", Georgia, serif', category: "serif" },
  { id: "newsreader", label: "Newsreader", stack: '"Newsreader", Georgia, serif', category: "serif" },
  { id: "literata", label: "Literata", stack: '"Literata", Georgia, serif', category: "serif" },
  { id: "crimson-pro", label: "Crimson Pro", stack: '"Crimson Pro", Georgia, serif', category: "serif" },
  { id: "cardo", label: "Cardo", stack: '"Cardo", Georgia, serif', category: "serif" },
  { id: "merriweather", label: "Merriweather", stack: '"Merriweather", Georgia, serif', category: "serif" },
  { id: "stix-two", label: "STIX Two Text", stack: '"STIX Two Text", "Times New Roman", serif', category: "serif" },
  { id: "vollkorn", label: "Vollkorn", stack: '"Vollkorn", Georgia, serif', category: "serif" },
  { id: "alegreya", label: "Alegreya", stack: '"Alegreya", Georgia, serif', category: "serif" },

  { id: "ibm-plex-mono", label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace', category: "mono" },
  { id: "jetbrains-mono", label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, monospace', category: "mono" },

  { id: "playfair", label: "Playfair Display", stack: '"Playfair Display", Georgia, serif', category: "display" },
  { id: "cinzel", label: "Cinzel", stack: '"Cinzel", Georgia, serif', category: "display" },
  { id: "cinzel-decorative", label: "Cinzel Decorative", stack: '"Cinzel Decorative", Georgia, serif', category: "display" },
  { id: "dm-serif", label: "DM Serif Display", stack: '"DM Serif Display", Georgia, serif', category: "display" },

  { id: "great-vibes", label: "Great Vibes", stack: '"Great Vibes", cursive', category: "script" },
  { id: "allura", label: "Allura", stack: '"Allura", cursive', category: "script" },

  { id: "unifraktur", label: "UnifrakturCook", stack: '"UnifrakturCook", serif', category: "blackletter" },
  { id: "medieval-sharp", label: "MedievalSharp", stack: '"MedievalSharp", serif', category: "blackletter" },
  { id: "uncial", label: "Uncial Antiqua", stack: '"Uncial Antiqua", serif', category: "blackletter" },
  { id: "im-fell", label: "IM Fell English", stack: '"IM Fell English", serif', category: "blackletter" },
];

const FONT_BY_ID = new Map(APP_FONTS.map((f) => [f.id, f]));
const FONT_KEY = "yggdrasil:app-fonts";

export const DEFAULT_BODY_FONT = "ibm-plex-sans";
export const DEFAULT_TITLE_FONT = "ibm-plex-serif";

export interface AppFonts {
  body: string;
  title: string;
}

export function resolveFont(id: string, fallbackId: string): FontDef {
  if (id?.startsWith(CUSTOM_FONT_PREFIX)) {
    const filename = id.slice(CUSTOM_FONT_PREFIX.length);
    const entry = customFontsCache.find((e) => e.filename === filename);
    if (entry) {
      return { id, label: entry.label, stack: `"${entry.family}", sans-serif`, category: "custom" };
    }
  }
  return FONT_BY_ID.get(id) || FONT_BY_ID.get(fallbackId) || APP_FONTS[0];
}

export function loadAppFonts(): AppFonts {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppFonts>;
      return {
        body: FONT_BY_ID.has(parsed.body || "") ? parsed.body! : DEFAULT_BODY_FONT,
        title: FONT_BY_ID.has(parsed.title || "") ? parsed.title! : DEFAULT_TITLE_FONT,
      };
    }
  } catch {
    /* ignore */
  }
  return { body: DEFAULT_BODY_FONT, title: DEFAULT_TITLE_FONT };
}

export function saveAppFonts(next: AppFonts) {
  localStorage.setItem(FONT_KEY, JSON.stringify(next));
}

export function applyAppFonts(fonts: AppFonts = loadAppFonts()) {
  const root = document.documentElement.style;
  root.setProperty("--font-sans", resolveFont(fonts.body, DEFAULT_BODY_FONT).stack);
  root.setProperty("--font-title", resolveFont(fonts.title, DEFAULT_TITLE_FONT).stack);
}

// ── Custom (user-uploaded) fonts ────────────────────────────────────────────
// We never bundle or fetch third-party font files ourselves — only what the
// user uploads via Settings, stored in their own vault and served locally.

export const CUSTOM_FONT_PREFIX = "custom:";

export interface CustomFontEntry {
  filename: string;
  url: string;
  family: string;
  label: string;
}

let customFontsCache: CustomFontEntry[] = [];

function familyNameFor(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return `ygg-custom-${base}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function injectCustomFontFaces(entries: CustomFontEntry[]) {
  let styleEl = document.getElementById("ygg-custom-fonts") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "ygg-custom-fonts";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = entries
    .map((e) => `@font-face { font-family: "${e.family}"; src: url("${e.url}"); font-display: swap; }`)
    .join("\n");
}

export function getCustomFonts(): CustomFontEntry[] {
  return customFontsCache;
}

export async function refreshCustomFonts(): Promise<CustomFontEntry[]> {
  const { fonts } = await api.uploads.fonts.list();
  customFontsCache = fonts.map((f) => ({
    filename: f.filename,
    url: f.url,
    family: familyNameFor(f.filename),
    label: f.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
  }));
  injectCustomFontFaces(customFontsCache);
  return customFontsCache;
}

/** Curated + custom fonts, for pickers that should offer both. */
export function getSelectableFonts(): FontDef[] {
  return [
    ...APP_FONTS,
    ...customFontsCache.map((e) => ({
      id: `${CUSTOM_FONT_PREFIX}${e.filename}`,
      label: e.label,
      stack: `"${e.family}", sans-serif`,
      category: "custom" as FontCategory,
    })),
  ];
}
