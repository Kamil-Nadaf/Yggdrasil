import { applyAppFonts } from "./fonts";

export interface ThemeDef {
  id: string;
  label: string;
  swatch: { bg: string; surface: string; text: string; accent: string };
}

export const THEMES: ThemeDef[] = [
  { id: "dark", label: "Dark", swatch: { bg: "#0D1117", surface: "#161B27", text: "#CDD9E5", accent: "#4FC3F7" } },
  { id: "paper", label: "Paper", swatch: { bg: "#FAFAF8", surface: "#F5F5F2", text: "#1A1A1A", accent: "#000000" } },
  { id: "tactile", label: "Tactile", swatch: { bg: "#EAE3D8", surface: "#F3EEE4", text: "#3A322C", accent: "#C97B4A" } },
  { id: "observatory", label: "Observatory", swatch: { bg: "#f0f0e8", surface: "#e8e8dc", text: "#141414", accent: "#1a1a1a" } },
  { id: "manuscript", label: "Manuscript", swatch: { bg: "#fdf6e3", surface: "#fff8e8", text: "#3d2e14", accent: "#e8a020" } },
  { id: "custom", label: "Custom", swatch: { bg: "#1B1B1B", surface: "#2A2A2A", text: "#F2F2F2", accent: "#E8B86D" } },
];

export const DEFAULT_THEME = "paper";
export const BUILTIN_THEMES = new Set(["dark", "paper", "tactile", "observatory", "manuscript"]);

export type PageId = "scores" | "search" | "browse" | "editor" | "tasks" | "graph" | "ask" | "latex";

export const PAGE_LABELS: Record<PageId, string> = {
  scores: "Dashboard",
  search: "Daily Archive",
  browse: "Search",
  editor: "Notes",
  tasks: "Tasks",
  graph: "Graph",
  ask: "Ask",
  latex: "LaTeX",
};

export interface CustomTheme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  ok: string;
  gate: string;
  crit: string;
  fontFamily: string;
}

export interface PageTheme {
  accent?: string;
  heatmapEmpty?: string;
  heatmapFill?: string;
  graphFolders?: Record<string, string>;
  graphWikilink?: string;
  graphCitation?: string;
  graphSuggested?: string;
  latexKeyword?: string;
  latexString?: string;
  latexComment?: string;
  latexBracket?: string;
  latexNumber?: string;
}

const CUSTOM_KEY = "yggdrasil:custom-theme";
const PAGE_KEY = "yggdrasil:page-themes";
export const THEME_EVENT = "ygg-theme";

/** Dark tokens — used as the Custom starting point. */
export const CUSTOM_DEFAULTS: CustomTheme = {
  bg: "#0D1117",
  surface: "#161B27",
  border: "#2A3447",
  text: "#CDD9E5",
  muted: "#6B7280",
  accent: "#4FC3F7",
  ok: "#34D399",
  gate: "#F59E0B",
  crit: "#F87171",
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
};

const PAPER_PRESET: CustomTheme = {
  bg: "#FAFAF8",
  surface: "#F5F5F2",
  border: "#D9D6D1",
  text: "#1A1A1A",
  muted: "#5A5A5A",
  accent: "#000000",
  ok: "#333333",
  gate: "#666666",
  crit: "#999999",
  fontFamily: "Georgia, Garamond, serif",
};

/** Paper — dark mode: same monochrome e-ink character, inverted. */
export const PAPER_DARK_PRESET: CustomTheme = {
  bg: "#121212",
  surface: "#1B1B1A",
  border: "#3A3835",
  text: "#ECECE8",
  muted: "#9C978D",
  accent: "#FFFFFF",
  ok: "#CFCFCF",
  gate: "#9A9A9A",
  crit: "#6E6E6E",
  fontFamily: "Georgia, Garamond, serif",
};

/** Tactile — neo-skeuomorphic / soft-3D: warm neutral surfaces, raised & inset
 * shapes via box-shadow (see index.css), copper/terracotta accent. */
export const TACTILE_PRESET: CustomTheme = {
  bg: "#EAE3D8",
  surface: "#F3EEE4",
  border: "#D8CBB8",
  text: "#3A322C",
  muted: "#8A7C6B",
  accent: "#C97B4A",
  ok: "#6B8E6B",
  gate: "#C99A4A",
  crit: "#B5544A",
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
};

export const OBSERVATORY_PRESET: CustomTheme = {
  bg: "#f0f0e8",
  surface: "#e8e8dc",
  border: "#1a1a1a",
  text: "#141414",
  muted: "#5a5a52",
  accent: "#1a1a1a",
  ok: "#1a1a1a",
  gate: "#1a1a1a",
  crit: "#1a1a1a",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const OBSERVATORY_DARK_PRESET: CustomTheme = {
  bg: "#141412",
  surface: "#1c1c18",
  border: "#e8e8dc",
  text: "#f0f0e8",
  muted: "#9a9a90",
  accent: "#f0f0e8",
  ok: "#f0f0e8",
  gate: "#f0f0e8",
  crit: "#f0f0e8",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const MANUSCRIPT_PRESET: CustomTheme = {
  bg: "#fdf6e3",
  surface: "#fff8e8",
  border: "#ead9b8",
  text: "#3d2e14",
  muted: "#8a7344",
  accent: "#e8a020",
  ok: "#6a7a32",
  gate: "#c47b10",
  crit: "#b42318",
  fontFamily: "Palatino, 'Palatino Linotype', Georgia, serif",
};

export const MANUSCRIPT_DARK_PRESET: CustomTheme = {
  bg: "#1c1810",
  surface: "#262016",
  border: "#4a3d24",
  text: "#fdf6e3",
  muted: "#b8a06a",
  accent: "#e8a020",
  ok: "#8a9a4a",
  gate: "#e8a020",
  crit: "#e06050",
  fontFamily: "Palatino, 'Palatino Linotype', Georgia, serif",
};

/** Dark theme — light mode: same cyan accent, inverted GitHub-style surfaces. */
export const DARK_LIGHT_PRESET: CustomTheme = {
  bg: "#F6F8FA",
  surface: "#FFFFFF",
  border: "#D0D7DE",
  text: "#1F2328",
  muted: "#656D76",
  accent: "#4FC3F7",
  ok: "#1A7F37",
  gate: "#9A6700",
  crit: "#CF222E",
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
};

/** Tactile — dark mode: same soft-3D clay shapes, on a charcoal base. Surface
 * is kept noticeably lighter than bg (unlike a typical dark UI) because the
 * neumorphic look depends on that separation being visible — shadows alone
 * don't read well against a very dark backdrop. */
export const TACTILE_DARK_PRESET: CustomTheme = {
  bg: "#1D1A15",
  surface: "#332B21",
  border: "#4A4032",
  text: "#F1EAE0",
  muted: "#B3A791",
  accent: "#C97B4A",
  ok: "#7FA378",
  gate: "#D9A857",
  crit: "#D06A5D",
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
};

export type ThemeMode = "light" | "dark";

/** Every named theme has Light/Dark. Custom stays a free colour grid. */
export const MODE_TOGGLE_THEMES = new Set(["dark", "paper", "tactile", "observatory", "manuscript"]);

const MODE_KEY = "yggdrasil:theme-mode";

function loadThemeModes(): Record<string, ThemeMode> {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ThemeMode>;
  } catch {
    return {};
  }
}

export function defaultThemeMode(themeId: string): ThemeMode {
  return themeId === "dark" ? "dark" : "light";
}

export function loadThemeMode(themeId: string): ThemeMode {
  const stored = loadThemeModes()[themeId];
  if (stored === "dark" || stored === "light") return stored;
  return defaultThemeMode(themeId);
}

export function saveThemeMode(themeId: string, mode: ThemeMode) {
  const all = loadThemeModes();
  all[themeId] = mode;
  localStorage.setItem(MODE_KEY, JSON.stringify(all));
  applyTheme();
}

/** Preset accent hues offered as a colour bar for the Tactile theme —
 * surfaces/shadows stay the same, only the accent hue changes. */
export interface TactileAccentDef {
  id: string;
  label: string;
  hex: string;
}

export const TACTILE_ACCENTS: TactileAccentDef[] = [
  { id: "copper", label: "Copper", hex: "#C97B4A" },
  { id: "blue", label: "Blue", hex: "#4C7EA8" },
  { id: "cyan", label: "Cyan", hex: "#4A9B9E" },
  { id: "sky", label: "Sky", hex: "#4FC3F7" },
  { id: "green", label: "Green", hex: "#5E8C5A" },
  { id: "gray", label: "Gray", hex: "#6B6B66" },
  { id: "purple", label: "Purple", hex: "#8B6BA8" },
  { id: "rose", label: "Rose", hex: "#B5657A" },
  { id: "amber", label: "Amber", hex: "#E8A020" },
  { id: "ink", label: "Ink", hex: "#1A1A1A" },
];

/** Shared accent swatches — same bar for every named theme. */
export const THEME_ACCENTS = TACTILE_ACCENTS;

const TACTILE_ACCENT_KEY = "yggdrasil:tactile-accent";
const THEME_ACCENT_KEY = "yggdrasil:theme-accents";

function loadThemeAccents(): Record<string, string> {
  try {
    const raw = localStorage.getItem(THEME_ACCENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (!hexOk(parsed.tactile)) {
      const legacy = localStorage.getItem(TACTILE_ACCENT_KEY);
      if (hexOk(legacy)) parsed.tactile = legacy;
    }
    return parsed;
  } catch {
    return {};
  }
}

export function defaultThemeAccent(themeId: string, mode: ThemeMode = loadThemeMode(themeId)): string {
  if (themeId === "paper") return mode === "dark" ? "#FFFFFF" : "#000000";
  if (themeId === "tactile") return TACTILE_PRESET.accent;
  if (themeId === "observatory") return mode === "dark" ? OBSERVATORY_DARK_PRESET.accent : OBSERVATORY_PRESET.accent;
  if (themeId === "manuscript") return MANUSCRIPT_PRESET.accent;
  if (themeId === "custom") return loadCustomTheme().accent;
  return CUSTOM_DEFAULTS.accent;
}

export function loadThemeAccent(themeId: string): string {
  if (themeId === "custom") return loadCustomTheme().accent;
  const saved = loadThemeAccents()[themeId];
  return hexOk(saved) ? saved : defaultThemeAccent(themeId);
}

export function saveThemeAccent(themeId: string, hex: string) {
  if (!hexOk(hex)) return;
  if (themeId === "custom") {
    saveCustomTheme({ ...loadCustomTheme(), accent: hex });
    applyTheme();
    return;
  }
  const all = loadThemeAccents();
  all[themeId] = hex;
  localStorage.setItem(THEME_ACCENT_KEY, JSON.stringify(all));
  if (themeId === "tactile") localStorage.setItem(TACTILE_ACCENT_KEY, hex);
  applyTheme();
}

export function loadTactileAccent(): string {
  return loadThemeAccent("tactile");
}

export function saveTactileAccent(hex: string) {
  saveThemeAccent("tactile", hex);
}

const CSS_VARS: Record<keyof Omit<CustomTheme, "fontFamily">, string> = {
  bg: "--bg",
  surface: "--surface",
  border: "--border",
  text: "--text",
  muted: "--muted",
  accent: "--accent",
  ok: "--ok",
  gate: "--gate",
  crit: "--crit",
};

export const DEFAULT_FOLDER_COLORS: Record<string, string> = {
  "10-Papers": "#4FC3F7",
  "15-Books": "#F59E0B",
  "20-Concepts": "#34D399",
  "30-Questions": "#F59E0B",
  "40-MOC": "#A78BFA",
  "50-Syntheses": "#FB923C",
  "60-Meta": "#6B7280",
  external: "#374151",
  "00-Inbox": "#9CA3AF",
};

let currentPageId: PageId = "scores";

export function hexOk(v: string | null | undefined): v is string {
  return Boolean(v && /^#[0-9A-Fa-f]{6}$/.test(v));
}

function mixHex(a: string, b: string, t: number): string {
  if (!hexOk(a) || !hexOk(b)) return a;
  const n = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ar, ag, ab] = n(a);
  const [br, bg, bb] = n(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

export function notifyTheme() {
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function loadCustomTheme(): CustomTheme {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CustomTheme>;
      return { ...CUSTOM_DEFAULTS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  const migrated: CustomTheme = { ...CUSTOM_DEFAULTS };
  const oldBg = localStorage.getItem("themeOverride:bg");
  const oldText = localStorage.getItem("themeOverride:text");
  const oldAccent = localStorage.getItem("themeOverride:accent");
  const oldFont = localStorage.getItem("themeOverride:fontFamily");
  if (hexOk(oldBg)) migrated.bg = oldBg;
  if (hexOk(oldText)) migrated.text = oldText;
  if (hexOk(oldAccent)) migrated.accent = oldAccent;
  if (oldFont) migrated.fontFamily = oldFont;
  return migrated;
}

export function saveCustomTheme(theme: CustomTheme) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(theme));
}

export function customFromPreset(id: "dark" | "paper" | "tactile"): CustomTheme {
  if (id === "paper") return { ...PAPER_PRESET };
  if (id === "tactile") return { ...TACTILE_PRESET };
  return { ...CUSTOM_DEFAULTS };
}

export function loadAllPageThemes(): Partial<Record<PageId, PageTheme>> {
  try {
    const raw = localStorage.getItem(PAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<PageId, PageTheme>>;
  } catch {
    return {};
  }
}

export function loadPageTheme(page: PageId): PageTheme {
  return loadAllPageThemes()[page] || {};
}

export function savePageTheme(page: PageId, theme: PageTheme) {
  const all = loadAllPageThemes();
  all[page] = theme;
  localStorage.setItem(PAGE_KEY, JSON.stringify(all));
  applyTheme(page);
}

export function resetPageTheme(page: PageId) {
  const all = loadAllPageThemes();
  delete all[page];
  localStorage.setItem(PAGE_KEY, JSON.stringify(all));
  applyTheme(page);
}

export function getFolderColors(page: PageTheme = loadPageTheme("graph")): Record<string, string> {
  return { ...DEFAULT_FOLDER_COLORS, ...page.graphFolders };
}

export function getGraphEdgeColors(page: PageTheme = loadPageTheme("graph")): {
  wikilink: string;
  citation: string;
  suggested: string;
} {
  const tokens = themeTokens();
  return {
    wikilink: hexOk(page.graphWikilink) ? page.graphWikilink : tokens.border,
    citation: hexOk(page.graphCitation) ? page.graphCitation : page.accent || tokens.accent,
    suggested: hexOk(page.graphSuggested) ? page.graphSuggested : "#A78BFA",
  };
}

function resolveThemeId(): string {
  const raw = localStorage.getItem("theme") || DEFAULT_THEME;
  if (raw === "custom" || BUILTIN_THEMES.has(raw)) return raw;
  localStorage.setItem("theme", "custom");
  return "custom";
}

function basePreset(themeId: string, mode: ThemeMode): CustomTheme {
  if (themeId === "paper") return { ...(mode === "dark" ? PAPER_DARK_PRESET : PAPER_PRESET) };
  if (themeId === "observatory") return { ...(mode === "dark" ? OBSERVATORY_DARK_PRESET : OBSERVATORY_PRESET) };
  if (themeId === "manuscript") return { ...(mode === "dark" ? MANUSCRIPT_DARK_PRESET : MANUSCRIPT_PRESET) };
  if (themeId === "tactile") return { ...(mode === "dark" ? TACTILE_DARK_PRESET : TACTILE_PRESET) };
  if (themeId === "dark") return { ...(mode === "light" ? DARK_LIGHT_PRESET : CUSTOM_DEFAULTS) };
  return { ...CUSTOM_DEFAULTS };
}

function presetTokens(themeId: string): CustomTheme {
  if (themeId === "custom") return loadCustomTheme();
  const mode = loadThemeMode(themeId);
  return { ...basePreset(themeId, mode), accent: loadThemeAccent(themeId) };
}

/** Tokens for a theme card swatch, including that theme's own saved mode + accent. */
export function themePreviewTokens(themeId: string): CustomTheme {
  return presetTokens(themeId);
}

function themeTokens(): CustomTheme {
  return presetTokens(resolveThemeId());
}

function clearInlineThemeVars() {
  const root = document.documentElement.style;
  for (const cssVar of Object.values(CSS_VARS)) root.removeProperty(cssVar);
}

function applyCustomVars(theme: CustomTheme) {
  const root = document.documentElement.style;
  for (const [key, cssVar] of Object.entries(CSS_VARS) as [keyof typeof CSS_VARS, string][]) {
    root.setProperty(cssVar, theme[key]);
  }
}

function applyPageVars(pageId: PageId, themeId: string) {
  const page = loadPageTheme(pageId);
  const tokens = presetTokens(themeId);
  const root = document.documentElement.style;
  const pageAccent = hexOk(page.accent) ? page.accent : tokens.accent;
  root.setProperty("--page-accent", pageAccent);

  const mode = loadThemeMode(themeId);
  const emptyDefault =
    themeId === "paper"
      ? mode === "dark"
        ? "#3A3835"
        : "#e8e4dc"
      : themeId === "observatory"
        ? mode === "dark"
          ? "#2a2a24"
          : "#d8d8ce"
        : themeId === "manuscript"
          ? mode === "dark"
            ? "#4a3d24"
            : "#ead9b8"
          : themeId === "custom" || themeId === "tactile"
            ? mixHex(tokens.bg, tokens.text, 0.14)
            : tokens.border;
  const fillDefault =
    themeId === "paper"
      ? mode === "dark"
        ? "#ECECE8"
        : "#1a1a1a"
      : themeId === "dark"
        ? mode === "light"
          ? "#1F2328"
          : "#cdd9e5"
        : themeId === "observatory"
          ? mode === "dark"
            ? "#f0f0e8"
            : "#141414"
          : themeId === "manuscript"
            ? tokens.accent
            : pageAccent;
  root.setProperty("--heatmap-empty", hexOk(page.heatmapEmpty) ? page.heatmapEmpty : emptyDefault);
  root.setProperty("--heatmap-fill", hexOk(page.heatmapFill) ? page.heatmapFill : fillDefault);

  root.setProperty("--latex-keyword", hexOk(page.latexKeyword) ? page.latexKeyword : pageAccent);
  root.setProperty("--latex-string", hexOk(page.latexString) ? page.latexString : tokens.ok);
  root.setProperty("--latex-comment", hexOk(page.latexComment) ? page.latexComment : tokens.muted);
  root.setProperty("--latex-bracket", hexOk(page.latexBracket) ? page.latexBracket : tokens.text);
  root.setProperty("--latex-number", hexOk(page.latexNumber) ? page.latexNumber : tokens.ok);

  const folders = getFolderColors(page);
  for (const [folder, color] of Object.entries(folders)) {
    root.setProperty(`--graph-folder-${folder.replace(/[^a-z0-9]/gi, "")}`, color);
  }
  const edges = getGraphEdgeColors(page);
  root.setProperty("--graph-wikilink", edges.wikilink);
  root.setProperty("--graph-citation", edges.citation);
  root.setProperty("--graph-suggested", edges.suggested);
}

/** Apply the saved theme to <html>. Call on boot and after any change. */
export function applyTheme(pageId?: PageId) {
  if (pageId) currentPageId = pageId;
  const theme = resolveThemeId();
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-page", currentPageId);
  if (MODE_TOGGLE_THEMES.has(theme)) {
    document.documentElement.setAttribute("data-mode", loadThemeMode(theme));
  } else {
    document.documentElement.removeAttribute("data-mode");
  }
  if (theme === "custom") {
    applyCustomVars(loadCustomTheme());
  } else {
    clearInlineThemeVars();
    document.documentElement.style.setProperty("--accent", loadThemeAccent(theme));
  }
  applyPageVars(currentPageId, theme);
  applyAppFonts();
  notifyTheme();
}

export function currentPage(): PageId {
  return currentPageId;
}

export function cssColorToHex(value: string, fallback = "#888888"): string {
  const raw = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) return raw;
  const rgb = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
  }
  return /^#[0-9A-Fa-f]{6}$/.test(fallback) ? fallback : "#888888";
}

export function readCssVar(name: string, fallback = ""): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
