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
  { id: "custom", label: "Custom", swatch: { bg: "#1B1B1B", surface: "#2A2A2A", text: "#F2F2F2", accent: "#E8B86D" } },
];

export const DEFAULT_THEME = "paper";
export const BUILTIN_THEMES = new Set(["dark", "paper", "tactile"]);

export type PageId = "scores" | "search" | "browse" | "editor" | "tasks" | "graph" | "ask" | "latex";

export const PAGE_LABELS: Record<PageId, string> = {
  scores: "Dashboard",
  search: "Daily ArXiv",
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

export interface TaskStatusDef {
  id: string;
  label: string;
  color: string;
}

const CUSTOM_KEY = "yggdrasil:custom-theme";
const PAGE_KEY = "yggdrasil:page-themes";
const STATUS_KEY = "yggdrasil:task-statuses";
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
  { id: "green", label: "Green", hex: "#5E8C5A" },
  { id: "gray", label: "Gray", hex: "#6B6B66" },
  { id: "purple", label: "Purple", hex: "#8B6BA8" },
  { id: "rose", label: "Rose", hex: "#B5657A" },
];

const TACTILE_ACCENT_KEY = "yggdrasil:tactile-accent";

export function loadTactileAccent(): string {
  const raw = localStorage.getItem(TACTILE_ACCENT_KEY);
  return hexOk(raw) ? raw : TACTILE_PRESET.accent;
}

export function saveTactileAccent(hex: string) {
  localStorage.setItem(TACTILE_ACCENT_KEY, hex);
  applyTheme();
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
  "20-Concepts": "#34D399",
  "30-Questions": "#F59E0B",
  "40-MOC": "#A78BFA",
  "50-Syntheses": "#FB923C",
  "60-Meta": "#6B7280",
  external: "#374151",
  "00-Inbox": "#9CA3AF",
};

export const DEFAULT_TASK_STATUSES: TaskStatusDef[] = [
  { id: "todo", label: "To Do", color: "#6B7280" },
  { id: "in_progress", label: "In Progress", color: "#F59E0B" },
  { id: "done", label: "Done", color: "#34D399" },
];

const CORE_STATUS_IDS = new Set(["todo", "done"]);

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

export function loadTaskStatuses(): TaskStatusDef[] {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (!raw) return DEFAULT_TASK_STATUSES.map((s) => ({ ...s }));
    const parsed = JSON.parse(raw) as TaskStatusDef[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TASK_STATUSES.map((s) => ({ ...s }));
    const cleaned = parsed.filter((s) => s && typeof s.id === "string" && s.id.trim());
    for (const core of DEFAULT_TASK_STATUSES) {
      if (CORE_STATUS_IDS.has(core.id) && !cleaned.some((s) => s.id === core.id)) {
        cleaned.unshift({ ...core });
      }
    }
    return cleaned.map((s) => ({
      id: s.id,
      label: s.label || s.id,
      color: hexOk(s.color) ? s.color : "#6B7280",
    }));
  } catch {
    return DEFAULT_TASK_STATUSES.map((s) => ({ ...s }));
  }
}

export function saveTaskStatuses(statuses: TaskStatusDef[]) {
  localStorage.setItem(STATUS_KEY, JSON.stringify(statuses));
  notifyTheme();
}

export function isCoreStatus(id: string): boolean {
  return CORE_STATUS_IDS.has(id);
}

export function slugifyStatus(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return slug || "status";
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

function presetTokens(themeId: string): CustomTheme {
  if (themeId === "custom") return loadCustomTheme();
  if (themeId === "paper") return { ...PAPER_PRESET };
  if (themeId === "tactile") return { ...TACTILE_PRESET, accent: loadTactileAccent() };
  return { ...CUSTOM_DEFAULTS };
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

  const emptyDefault =
    themeId === "paper"
      ? "#e8e4dc"
      : themeId === "custom" || themeId === "tactile"
        ? mixHex(tokens.bg, tokens.text, 0.14)
        : tokens.border;
  const fillDefault = themeId === "paper" ? "#1a1a1a" : themeId === "dark" ? "#cdd9e5" : pageAccent;
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
  if (theme === "custom") {
    applyCustomVars(loadCustomTheme());
  } else {
    clearInlineThemeVars();
    if (theme === "tactile") {
      document.documentElement.style.setProperty("--accent", loadTactileAccent());
    }
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
