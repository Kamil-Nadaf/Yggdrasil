/** Colour for the Yggdrasil logo (the real artwork at /yggdrasil-logo.png).
 *
 * The image itself is never redrawn or replaced — "colour" here means an
 * optional single-hue tint applied on top via a CSS mask, same technique the
 * nav bar already used. "Original" shows the source image exactly as-is. */

export type LogoColorMode = "original" | "accent" | "custom";

export interface LogoTheme {
  mode: LogoColorMode;
  /** Tint hex, used only when mode === "custom". */
  color: string;
}

export const DEFAULT_LOGO_THEME: LogoTheme = { mode: "accent", color: "#4FC3F7" };

const LOGO_KEY = "yggdrasil:logo-colors";

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function loadLogoTheme(): LogoTheme {
  try {
    const raw = localStorage.getItem(LOGO_KEY);
    if (!raw) return DEFAULT_LOGO_THEME;
    const parsed = JSON.parse(raw) as Partial<LogoTheme>;
    const mode: LogoColorMode =
      parsed.mode === "accent" || parsed.mode === "custom" ? parsed.mode : "original";
    return {
      mode,
      color: isHex(parsed.color) ? parsed.color : DEFAULT_LOGO_THEME.color,
    };
  } catch {
    return DEFAULT_LOGO_THEME;
  }
}

export function saveLogoTheme(theme: LogoTheme) {
  localStorage.setItem(LOGO_KEY, JSON.stringify(theme));
}

/** The tint colour actually painted, given the theme accent currently in use.
 * Irrelevant when mode === "original" (the real image is shown untinted). */
export function resolveLogoColor(accent: string, theme: LogoTheme = loadLogoTheme()): string {
  if (theme.mode === "custom") return theme.color;
  return isHex(accent) ? accent : DEFAULT_LOGO_THEME.color;
}

/** Write the logo mode/colour onto :root so CSS can switch between the plain
 * image and the tinted mask. Called from applyTheme() so it follows the theme. */
export function applyLogoVars(accent: string, theme: LogoTheme = loadLogoTheme()) {
  document.documentElement.setAttribute("data-logo-mode", theme.mode);
  document.documentElement.style.setProperty("--logo-color", resolveLogoColor(accent, theme));
}
